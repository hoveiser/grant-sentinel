"""Deploy GrantSentinel to studionet, seed a funded-custody live scenario, verify.

Runs a full live scenario with three distinct signing accounts, waits for every
transaction to reach FINALIZED, records transaction evidence, and performs a
three-way sha256 identity check (local file vs submitted bytes vs the code read
back from the finalized deploy transaction). The seeded scenario exercises the
steward-requested flow end to end on-chain:

  funded custody deposit -> delegate screening -> a REAL validator-consensus
  live audit that approves the exact credited payout and reserves custody ->
  a REAL claim that transfers SGT from the vault into the applicant wallet ->
  a REAL on-chain token transfer proving the payout is a transferable asset ->
  an expected rollback (applicant self-review must revert).

Resilient to interruptions via an evidence checkpoint file, and retries
provider-level transient errors. Never prints secrets; credentials come only
from this project's own .env.
"""

import base64
import hashlib
import json
import os
import sys
import time
from pathlib import Path

from genlayer_py import create_account, create_client
from genlayer_py.chains import studionet
from genlayer_py.types.transactions import TransactionStatus

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "contracts" / "grant_sentinel.py"
EVIDENCE_DIR = ROOT / "evidence"
CHECKPOINT = EVIDENCE_DIR / "_checkpoint.json"
EVIDENCE_MD = ROOT / "docs" / "evidence.md"

# studionet is rate limited per IP: keep a conservative spacing between writes.
PACING_SECONDS = 2.0
PROVIDER_RETRIES = 5
FINALIZE_RETRIES = 120
FINALIZE_INTERVAL_MS = 3000

# A stable, reachable page whose rendered text literally contains the mandatory
# artifact token, so validators independently verify the artifact on-chain.
PROOF_URL = "https://example.com/"
ARTIFACT_TOKEN = "Example Domain"

CLAIM_TRANSFER_AMOUNT = 5000


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_env_file(path: Path) -> None:
    # Minimal .env reader (no external dependency). Never logs values.
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def load_checkpoint() -> dict:
    if CHECKPOINT.exists():
        return json.loads(CHECKPOINT.read_text(encoding="utf-8"))
    return {"txs": {}, "contract_address": None}


def save_checkpoint(state: dict) -> None:
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    CHECKPOINT.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _retry_call(fn, label: str):
    last = None
    for attempt in range(PROVIDER_RETRIES):
        try:
            return fn()
        except Exception as exc:  # transient RPC / consensus / rate errors
            last = exc
            msg = str(exc)
            transient = any(
                token in msg
                for token in ("429", "-32429", "-32028", "timed out", "Timeout", "Connection")
            )
            wait = 5.0 * (attempt + 1) if transient else 2.0
            print(f"  [retry] {label} attempt {attempt + 1} failed: {msg[:120]} -> sleep {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"{label} failed after {PROVIDER_RETRIES} attempts: {last}")


def wait_finalized(client, tx_id: str, label: str) -> dict:
    receipt = _retry_call(
        lambda: client.wait_for_transaction_receipt(
            tx_id,
            status=TransactionStatus.FINALIZED,
            interval=FINALIZE_INTERVAL_MS,
            retries=FINALIZE_RETRIES,
            full_transaction=True,
        ),
        f"wait FINALIZED {label}",
    )
    status_name = receipt.get("status_name") or receipt.get("status")
    exec_ok = _execution_succeeded(receipt)
    print(f"  [ok] {label}: tx={tx_id} status={status_name} exec={'SUCCESS' if exec_ok else 'FAILED'}")
    return receipt


def _execution_succeeded(receipt: dict) -> bool:
    try:
        cd = receipt.get("consensus_data") or {}
        lr = cd.get("leader_receipt")
        if isinstance(lr, dict):
            lr = [lr]
        if not lr:
            return False
        return lr[0].get("execution_result") == "SUCCESS"
    except Exception:
        return False


def _extract_contract_address(receipt: dict):
    data = receipt.get("data") if isinstance(receipt, dict) else None
    if isinstance(data, dict):
        addr = data.get("contract_address")
        if isinstance(addr, str) and addr.startswith("0x"):
            return addr
    found = []

    def walk(node):
        if isinstance(node, dict):
            for k, v in node.items():
                if k == "contract_address" and isinstance(v, str) and v.startswith("0x"):
                    found.append(v)
                walk(v)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(receipt)
    return found[0] if found else None


def _extract_deployed_code(receipt: dict):
    data = receipt.get("data") if isinstance(receipt, dict) else None
    if isinstance(data, dict):
        code = data.get("contract_code")
        if isinstance(code, str):
            try:
                return base64.b64decode(code)
            except Exception:
                return code.encode("utf-8")
    return None


def do_write(client, address, fn_name, account, args, label, state, key):
    if key in state["txs"]:
        print(f"  [skip] {label} already done: {state['txs'][key]}")
        return state["txs"][key]
    tx_id = _retry_call(
        lambda: client.write_contract(address, fn_name, account=account, args=args),
        f"submit {label}",
    )
    wait_finalized(client, tx_id, label)
    state["txs"][key] = tx_id
    save_checkpoint(state)
    time.sleep(PACING_SECONDS)
    return tx_id


def main():
    read_env_file(ROOT / ".env")
    pk = os.getenv("GENLAYER_PRIVATE_KEY")
    if not pk:
        print("GENLAYER_PRIVATE_KEY missing from .env")
        sys.exit(1)

    raw_bytes = CONTRACT_PATH.read_bytes()
    # Normalize to LF so the local hash, the submitted bytes and the on-chain
    # readback all refer to identical bytes regardless of working-copy EOL.
    source_bytes = raw_bytes.replace(b"\r\n", b"\n")
    source_text = source_bytes.decode("utf-8")
    local_hash = sha256_bytes(source_bytes)
    submitted_hash = sha256_bytes(source_bytes)

    owner = create_account(pk)          # deployer, treasury funder, proposal-1 applicant
    signer2 = create_account()          # delegate / reviewer + transfer recipient
    signer3 = create_account()          # second reviewer + upvoter
    client = create_client(studionet, account=owner)

    print("== GrantSentinel studionet deploy ==")
    print(f"owner address: {owner.address}")
    print(f"signer2 address: {signer2.address}")
    print(f"signer3 address: {signer3.address}")

    state = load_checkpoint()

    # ---- Deploy (or resume) ----
    if not state.get("contract_address"):
        deploy_tx = _retry_call(
            lambda: client.deploy_contract(code=source_text, account=owner, args=[]),
            "submit deploy",
        )
        receipt = wait_finalized(client, deploy_tx, "deploy")
        address = _extract_contract_address(receipt)
        if not address:
            print("Could not resolve deployed contract address from receipt")
            save_checkpoint(state)
            sys.exit(2)
        state["txs"]["deploy"] = deploy_tx
        state["contract_address"] = address
        code_back = _extract_deployed_code(receipt)
        state["readback_code_hash"] = sha256_bytes(code_back) if code_back else None
        save_checkpoint(state)
        time.sleep(PACING_SECONDS)
    address = state["contract_address"]
    print(f"contract address: {address}")

    # ---- Explicit funded custody deposit (top up the vault from the wallet) ----
    do_write(
        client, address, "deposit_treasury_funds", owner, [1000000],
        "deposit treasury funds into custody", state, "deposit",
    )

    # ---- Funded-custody scenario data -------------------------------------
    # Approve candidates use stable, text-rich, self-evidencing public-good pages
    # that literally contain the mandatory artifact token, so validators can
    # independently verify the artifact on-chain and score a real deliverable.
    CANDIDATES = [
        (
            "Sustain the Wikipedia Free-Encyclopedia Commons",
            "ECOSYSTEM_GROWTH",
            "Grant to keep the world's largest free, ad-free encyclopedia running and "
            "open: server costs, edit-time tooling and community moderation for a "
            "public good every researcher on earth depends on.",
            "https://www.wikipedia.org/",
            "Wikipedia",
            200000,
        ),
        (
            "Sustain CPython Core Open-Source Development",
            "DEVELOPER_TOOLS",
            "Grant to fund full-time core maintainers of the Python programming "
            "language and its standard library, the backbone of open data, AI and "
            "web infrastructure worldwide.",
            "https://www.python.org/",
            "Python",
            250000,
        ),
        (
            "Sustain the Ethereum Open Documentation Commons",
            "ECOSYSTEM_GROWTH",
            "Multi-year public-good grant to maintain, translate and harden the "
            "world's most-used Ethereum documentation site, keeping content accurate "
            "and accessible to millions of builders.",
            "https://ethereum.org/en/",
            "Ethereum",
            220000,
        ),
        (
            "Sustain the Linux Kernel Core Infrastructure",
            "PROTOCOL_INFRA",
            "Grant supporting Linux kernel maintainership and CI, the foundation of "
            "nearly all servers, cloud and embedded systems on the planet.",
            "https://www.kernel.org/",
            "Linux",
            240000,
        ),
    ]

    # Proposal id 1 = first approve candidate (reviewed before its consensus audit).
    do_write(client, address, "submit_grant_proposal", owner, list(CANDIDATES[0]),
             "submit approve candidate 1", state, "proposal_1")

    # Proposal id 2 = a real proposal left in SCREENING for reviewers to interact with.
    do_write(
        client, address, "submit_grant_proposal", owner,
        ["Realtime MEV-Watch Public Indexer", "PROTOCOL_INFRA",
         "Public mempool analytics API for researchers, with a reproducible open data pipeline.",
         "https://example.org/", "MEV-WATCH-TOKEN", 90000],
        "submit screening proposal 2", state, "proposal_2",
    )

    # ---- Delegate reviews + upvote on the reviewed candidate (id1), two signers ----
    do_write(
        client, address, "submit_delegate_review", signer2,
        [1, "sentinel-delegate-oveis", "ENDORSE_CONVICTION",
         "Reproducible build, tests pass locally, deliverable matches the manifest."],
        "delegate endorse review p1", state, "review_endorse_p1",
    )
    do_write(
        client, address, "submit_delegate_review", signer3,
        [1, "tech-reviewer-ada", "TECHNICAL_NOTE",
         "Documentation is thorough; a note for future license clarity."],
        "delegate technical note p1", state, "review_note_p1",
    )
    do_write(
        client, address, "upvote_delegate_review", signer3,
        [1], "upvote endorse review", state, "upvote_1",
    )

    # ---- REAL validator-consensus live audits with a bounded candidate loop ----
    audited_ids = []
    chosen_id = None
    chosen_payout = 0
    next_slot = 3  # ids from 3 onward are extra approve candidates
    for cand_index, candidate in enumerate(CANDIDATES):
        pid = 1 if cand_index == 0 else next_slot
        if cand_index > 0:
            do_write(client, address, "submit_grant_proposal", owner, list(candidate),
                     f"submit approve candidate {cand_index + 1}", state, f"proposal_{pid}")
            next_slot += 1
        do_write(client, address, "audit_grant_live", owner, [pid],
                 f"live consensus audit candidate {cand_index + 1}", state, f"audit_live_{pid}")
        verdict = client.read_contract(address, "get_proposal", args=[pid])
        audited_ids.append(pid)
        print(f"  [audit] proposal {pid} status={verdict.get('status')} "
              f"score={verdict.get('verified_impact_score')} payout={verdict.get('approved_payout')}")
        if verdict.get("status") in ("APPROVED_FUNDED", "PARTIAL_GRANT") and int(verdict.get("approved_payout", 0)) > 0:
            chosen_id = pid
            chosen_payout = int(verdict.get("approved_payout", 0))
            break

    # ---- REAL claim (custody -> wallet) + token transfer on a consensus approval ----
    if chosen_id is not None:
        do_write(client, address, "claim_grant_payout", owner, [chosen_id],
                 f"claim proposal {chosen_id} payout into wallet", state, f"claim_{chosen_id}")
        do_write(client, address, "transfer_grant_tokens", owner,
                 [str(signer2.address), CLAIM_TRANSFER_AMOUNT],
                 "transfer claimed SGT to signer2 wallet", state, "transfer_1")
    else:
        print("  [warn] no live candidate reached a claimable consensus approval; "
              "claim/transfer skipped")

    # ---- Expected rollback: applicant self-review on the SCREENING proposal 2 ----
    rollback_tx = _retry_call(
        lambda: client.write_contract(
            address, "submit_delegate_review", account=owner,
            args=[2, "self-praise", "ENDORSE_CONVICTION", "applicant reviewing own grant"],
        ),
        "submit applicant self-review (expect revert)",
    )
    rb_receipt = wait_finalized(client, rollback_tx, "applicant self-review (rollback)")
    rollback_ok = not _execution_succeeded(rb_receipt)
    state["txs"]["rollback_self_review"] = rollback_tx
    state["rollback_execution_failed"] = rollback_ok
    save_checkpoint(state)

    # ---- Read back final state ----
    summary = client.read_contract(address, "get_sentinel_summary", args=[])
    proposal1 = client.read_contract(address, "get_proposal", args=[1])
    proposal2 = client.read_contract(address, "get_proposal", args=[2])
    leaderboard = client.read_contract(address, "get_delegate_leaderboard", args=[])
    reviews1 = client.read_contract(address, "get_proposal_reviews", args=[1])
    receipts = client.read_contract(address, "get_transfer_receipts", args=[])
    owner_wallet = client.read_contract(address, "get_wallet_token_balance", args=[str(owner.address)])
    signer2_wallet = client.read_contract(address, "get_wallet_token_balance", args=[str(signer2.address)])

    print("\n== Final on-chain state ==")
    print("summary:", json.dumps(summary, indent=2, default=str))
    print("proposal1 status:", proposal1.get("status"),
          "score:", proposal1.get("verified_impact_score"),
          "payout:", proposal1.get("approved_payout"),
          "claimed:", proposal1.get("claimed"))
    print("proposal2 status:", proposal2.get("status"))
    print("owner wallet SGT:", owner_wallet, "signer2 wallet SGT:", signer2_wallet)
    print("receipts:", json.dumps(receipts, indent=2, default=str))

    # ---- Custody conservation invariant ----
    total_supply = int(summary["total_supply"])
    vault = int(summary["vault_custody_balance"])
    allocated = int(summary["total_allocated_unclaimed"])
    wallet_sum = int(owner_wallet) + int(signer2_wallet) + int(
        client.read_contract(address, "get_wallet_token_balance", args=[str(signer3.address)])
    )
    custody_conserved = vault + wallet_sum == total_supply
    reservation_ok = allocated <= vault
    print(f"total_supply={total_supply} vault={vault} allocated={allocated} "
          f"wallet_sum={wallet_sum} custody_conserved={custody_conserved} reservation_ok={reservation_ok}")

    # ---- 3-way sha256 identity ----
    readback_hash = state.get("readback_code_hash")
    identity = {
        "local_file_sha256": local_hash,
        "submitted_bytes_sha256": submitted_hash,
        "onchain_readback_sha256": readback_hash,
    }
    three_way = (
        local_hash == submitted_hash
        and readback_hash is not None
        and readback_hash == local_hash
    )
    print("3-way sha256 identity:", "PASS" if three_way else "CHECK", identity)

    payout1 = int(proposal1.get("approved_payout", 0))
    claimed_proposal = (
        client.read_contract(address, "get_proposal", args=[chosen_id])
        if chosen_id is not None else None
    )

    # ---- Write evidence ----
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    evidence = {
        "chain_id": 61999,
        "network": "studionet",
        "contract_address": address,
        "owner": str(owner.address),
        "signer2": str(signer2.address),
        "signer3": str(signer3.address),
        "deploy_tx": state["txs"].get("deploy"),
        "transactions": state["txs"],
        "rollback_execution_failed": rollback_ok,
        "summary": summary,
        "proposal1": proposal1,
        "proposal2": proposal2,
        "claimed_proposal_id": chosen_id,
        "claimed_proposal": claimed_proposal,
        "reviews_proposal1": reviews1,
        "leaderboard": leaderboard,
        "transfer_ledger": receipts,
        "wallets": {
            "owner": int(owner_wallet),
            "signer2": int(signer2_wallet),
        },
        "custody_conserved": custody_conserved,
        "reservation_ok": reservation_ok,
        "live_audit_claimed_payout": chosen_payout,
        "identity": identity,
        "identity_pass": three_way,
    }
    (EVIDENCE_DIR / "studionet_deploy.json").write_text(
        json.dumps(evidence, indent=2, default=str), encoding="utf-8"
    )
    EVIDENCE_MD.parent.mkdir(parents=True, exist_ok=True)
    write_evidence_md(evidence)

    print("\nDEPLOY_RESULT",
          json.dumps({"address": address, "identity_pass": three_way,
                      "rollback_ok": rollback_ok, "custody_conserved": custody_conserved,
                      "reservation_ok": reservation_ok, "live_payout": payout1}))
    if not (three_way and rollback_ok and custody_conserved and reservation_ok):
        sys.exit(3)


def write_evidence_md(e: dict) -> None:
    lines = [
        "# studionet deployment evidence",
        "",
        f"- Network: studionet (chain id {e['chain_id']})",
        f"- Contract address: `{e['contract_address']}`",
        f"- Owner (deployer, funder, proposal-1 applicant): `{e['owner']}`",
        f"- Reviewer / transfer recipient (signer2): `{e['signer2']}`",
        f"- Second reviewer (signer3): `{e['signer3']}`",
        f"- Deploy tx: `{e['deploy_tx']}`",
        "",
        "## Transactions",
        "",
        "| step | tx hash |",
        "| --- | --- |",
    ]
    for step, tx in e["transactions"].items():
        lines.append(f"| {step} | `{tx}` |")
    lines += [
        "",
        "## Verification",
        "",
        f"- Applicant self-review rollback executed and reverted as expected: {e['rollback_execution_failed']}",
        f"- Custody conservation (vault + all wallets == total supply): {e['custody_conserved']}",
        f"- Custody reservation (allocated <= vault): {e['reservation_ok']}",
        f"- Live consensus audit reserved payout that was claimed on-chain: {e['live_audit_claimed_payout']}",
        f"- 3-way sha256 source identity: {e['identity_pass']}",
        "",
        "```json",
        json.dumps(e["identity"], indent=2),
        "```",
        "",
        "## Final custody summary",
        "",
        "```json",
        json.dumps(e["summary"], indent=2, default=str),
        "```",
        "",
        "## On-chain custody & transfer ledger",
        "",
        "```json",
        json.dumps(e["transfer_ledger"], indent=2, default=str),
        "```",
        "",
        "Source-of-record note: the deployed source identity is taken from the code",
        "field embedded in the finalized deploy transaction and cross-checked against",
        "the local file hash.",
    ]
    EVIDENCE_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
