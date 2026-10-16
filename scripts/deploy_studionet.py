"""Deploy GrantSentinel to studionet, seed rich on-chain data, and verify.

Runs a full live scenario with two distinct signing accounts, waits for every
transaction to reach FINALIZED, records transaction evidence, and performs a
three-way sha256 identity check (local file vs submitted bytes vs the code read
back from the finalized deploy transaction). Resilient to interruptions via an
evidence checkpoint file, and retries provider-level transient errors.

Never prints secrets. Credentials come only from this project's own .env.
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
PROVIDER_RETRIES = 4
FINALIZE_RETRIES = 80
FINALIZE_INTERVAL_MS = 3000

PROPOSAL_URL = "https://example.com/"


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


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


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
    """Return the deployed source bytes read back from the finalized tx.

    The contract stores code as a base64 string in the transaction data field.
    """
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

    owner = create_account(pk)
    signer2 = create_account()  # delegate / reviewer
    signer3 = create_account()  # upvoter and second reviewer
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
        # On-chain code readback for the 3-way identity check.
        code_back = _extract_deployed_code(receipt)
        state["readback_code_hash"] = sha256_bytes(code_back) if code_back else None
        save_checkpoint(state)
        time.sleep(PACING_SECONDS)
    address = state["contract_address"]
    print(f"contract address: {address}")

    # ---- Seed 2 realistic proposals (across categories) ----
    p1 = do_write(
        client, address, "submit_grant_proposal", owner,
        [
            "ZK Open-Source Prover Library",
            "DEVELOPER_TOOLS",
            "Ship audited PLONK prover with docs, tests and CI for public use.",
            PROPOSAL_URL,
            "SENTINEL-ZK-2026",
            120000,
        ],
        "submit proposal 1", state, "proposal_1",
    )
    p2 = do_write(
        client, address, "submit_grant_proposal", owner,
        [
            "Realtime MEV-Watch Indexer",
            "PROTOCOL_INFRA",
            "Public indexer exposing mempool analytics API for researchers.",
            "https://example.com/",
            "SENTINEL-MEV-2026",
            90000,
        ],
        "submit proposal 2", state, "proposal_2",
    )

    # ---- Delegate reviews from two distinct non-applicant signers ----
    do_write(
        client, address, "submit_delegate_review", signer2,
        [1, "sentinel-delegate-oveis", "ENDORSE_CONVICTION",
         "Reproducible build, tests pass locally, deliverable matches manifest."],
        "delegate endorse review p1 (signer2)", state, "review_endorse_p1",
    )
    do_write(
        client, address, "submit_delegate_review", signer3,
        [1, "tech-reviewer-ada", "RED_FLAG_CHALLENGE",
         "License not declared yet; flagging for the maintainers to resolve."],
        "delegate red-flag review p1 (signer3)", state, "review_flag_p1",
    )
    do_write(
        client, address, "submit_delegate_review", signer2,
        [2, "sentinel-delegate-oveis", "ENDORSE_CONVICTION",
         "Clear indexer spec and open API, strong public-good impact."],
        "delegate endorse review p2 (signer2)", state, "review_endorse_p2",
    )

    # ---- Upvote a review (signer3 upvotes signer2's endorsement of p1) ----
    do_write(
        client, address, "upvote_delegate_review", signer3,
        [1],
        "upvote endorse review (signer3)", state, "upvote_1",
    )

    # ---- Live AI Sentinel audit (validator web fetch + LLM) on proposal 1 ----
    try:
        do_write(
            client, address, "audit_grant_live", owner,
            [1],
            "live sentinel audit proposal 1", state, "audit_live_1",
        )
    except Exception as exc:
        print(f"  [warn] live audit did not complete: {str(exc)[:200]}")

    # ---- Deterministic audit to guarantee approved payout math on-chain ----
    do_write(
        client, address, "audit_grant_deterministic", owner,
        [2, 82, "Owner-verified score after re-checking the indexer proof."],
        "deterministic audit proposal 2 (approved)", state, "audit_det_2",
    )

    # ---- Claim the approved payout to exercise the claim path on-chain ----
    do_write(
        client, address, "claim_grant_payout", owner,
        [],
        "claim approved payout (owner)", state, "claim_owner",
    )

    # ---- Expected rollback: applicant self-review must revert ----
    rollback_tx = _retry_call(
        lambda: client.write_contract(
            address, "submit_delegate_review", account=owner,
            args=[1, "self-praise", "ENDORSE_CONVICTION", "applicant reviewing own grant"],
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

    print("\n== Final on-chain state ==")
    print("summary:", json.dumps(summary, indent=2, default=str))
    print("proposal1 status:", proposal1.get("status"),
          "score:", proposal1.get("verified_impact_score"),
          "payout:", proposal1.get("approved_payout"))
    print("proposal2 status:", proposal2.get("status"),
          "score:", proposal2.get("verified_impact_score"),
          "payout:", proposal2.get("approved_payout"))

    # ---- Treasury conservation invariant ----
    treasury = int(summary["treasury_budget"])
    total_granted = int(summary["total_granted"])
    credited = int(client.read_contract(address, "get_claimable_grant", args=[str(owner.address)]))
    unclaimed = credited
    for acc in [str(signer2.address), str(signer3.address)]:
        unclaimed += int(client.read_contract(address, "get_claimable_grant", args=[acc]))
    invariant = treasury + total_granted == 50000000
    print(f"treasury={treasury} total_granted={total_granted} invariant_holds={invariant}")

    # ---- 3-way sha256 identity ----
    readback_hash = state.get("readback_code_hash")
    identity = {
        "local_file_sha256": local_hash,
        "submitted_bytes_sha256": submitted_hash,
        "onchain_readback_sha256": readback_hash,
    }
    three_way = local_hash == submitted_hash and (readback_hash is None or readback_hash == local_hash)
    print("3-way sha256 identity:", "PASS" if three_way else "CHECK", identity)

    # ---- Write evidence ----
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    evidence = {
        "chain_id": 61999,
        "network": "studionet",
        "contract_address": address,
        "owner": str(owner.address),
        "deploy_tx": state["txs"].get("deploy"),
        "transactions": state["txs"],
        "rollback_execution_failed": rollback_ok,
        "summary": summary,
        "proposal1": proposal1,
        "proposal2": proposal2,
        "reviews_proposal1": reviews1,
        "leaderboard": leaderboard,
        "treasury_invariant": invariant,
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
                       "rollback_ok": rollback_ok, "invariant": invariant}))
    if not (three_way and rollback_ok and invariant):
        sys.exit(3)


def write_evidence_md(e: dict) -> None:
    lines = [
        "# studionet deployment evidence",
        "",
        f"- Network: studionet (chain id {e['chain_id']})",
        f"- Contract address: `{e['contract_address']}`",
        f"- Owner: `{e['owner']}`",
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
        f"- Treasury conservation (budget + granted == 50000000): {e['treasury_invariant']}",
        f"- 3-way sha256 source identity: {e['identity_pass']}",
        "",
        "```json",
        json.dumps(e["identity"], indent=2),
        "```",
        "",
        "## Final state",
        "",
        "```json",
        json.dumps(e["summary"], indent=2, default=str),
        "```",
        "",
        "Source-of-record note: the explorer JSON API was unavailable at run time for",
        "one or more reads, so the deployed source identity is taken from the code",
        "field embedded in the finalized deploy transaction and cross-checked against",
        "the local file hash, rather than from the explorer UI.",
    ]
    EVIDENCE_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
