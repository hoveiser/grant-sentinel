"""Pre-seed one fresh SCREENING proposal plus a reviewer endorsement on the
deployed GrantSentinel contract, so the demo video can exercise submitting a
review, upvoting a review, and triggering the live audit against a real
in-progress proposal. Writes a small state file the recorder reads.
"""

import json
import os
from pathlib import Path

from genlayer_py import create_account, create_client
from genlayer_py.chains import studionet
from genlayer_py.types.transactions import TransactionStatus

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads((ROOT / "evidence" / "studionet_deploy.json").read_text())["contract_address"]
KEYFILE = ROOT / "tools" / "_demo" / ".reviewer.key"
STATE = ROOT / "tools" / "_demo" / ".demo_state.json"


def read_env():
    for raw in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def retry(fn, label, attempts=6):
    import time

    last = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as exc:
            last = exc
            print(f"  [retry] {label} {i + 1}: {str(exc)[:100]}")
            time.sleep(4 * (i + 1))
    raise last


def finalize(client, tx_id, label):
    r = retry(
        lambda: client.wait_for_transaction_receipt(
            tx_id, status=TransactionStatus.FINALIZED, interval=3000, retries=60, full_transaction=True
        ),
        f"finalize {label}",
    )
    lr = r["consensus_data"]["leader_receipt"]
    lr = lr if isinstance(lr, list) else [lr]
    print(f"{label}: {r.get('status_name')} exec={lr[0].get('execution_result')}")


def main():
    read_env()
    owner = create_account(os.environ["GENLAYER_PRIVATE_KEY"])
    if KEYFILE.exists():
        reviewer = create_account(KEYFILE.read_text().strip())
    else:
        reviewer = create_account()
        KEYFILE.parent.mkdir(parents=True, exist_ok=True)
        KEYFILE.write_text(reviewer.key.hex())

    client = create_client(studionet, account=owner)

    summary = retry(
        lambda: client.read_contract(CONTRACT, "get_sentinel_summary", args=[]),
        "read summary",
    )
    count = int(summary["proposal_count"])
    next_id = count + 1
    title = f"Reputation Oracle {next_id}"

    tx = retry(
        lambda: client.write_contract(
            CONTRACT, "submit_grant_proposal", account=owner,
            args=[
                title,
                "AI_RESEARCH",
                "Public reputation oracle with verifiable attestations and an open API.",
                "https://example.com/",
                "SENTINEL-REP-2026",
                150000,
            ],
        ),
        "submit proposal",
    )
    finalize(client, tx, "demo proposal")

    tx2 = retry(
        lambda: client.write_contract(
            CONTRACT, "submit_delegate_review", account=reviewer,
            args=[next_id, "ada-reviewdao", "ENDORSE_CONVICTION",
                  "Attestation schema is sound and independently reproducible."],
        ),
        "reviewer endorse",
    )
    finalize(client, tx2, "demo reviewer endorse")

    STATE.write_text(json.dumps({
        "proposal_id": next_id,
        "title": title,
        "review_author": str(reviewer.address),
    }))
    print("demo proposal id:", next_id, "title:", title)


if __name__ == "__main__":
    main()
