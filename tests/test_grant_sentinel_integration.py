"""Integration test: verify the seeded GrantSentinel state on studionet.

These are read-only calls against the deployed contract recorded in
evidence/studionet_deploy.json, so they do not consume the write rate limit.
Run with: pytest tests/test_grant_sentinel_integration.py -v -s
"""

import json
from pathlib import Path

import pytest

from genlayer_py import create_account, create_client
from genlayer_py.chains import studionet

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "evidence" / "studionet_deploy.json"


def _read_env() -> str:
    import os

    env_path = ROOT / ".env"
    pk = os.getenv("GENLAYER_PRIVATE_KEY")
    if pk:
        return pk
    if env_path.exists():
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                if k.strip() == "GENLAYER_PRIVATE_KEY":
                    return v.strip().strip('"').strip("'")
    return None


pytestmark = pytest.mark.skipif(
    not EVIDENCE.exists(), reason="no studionet deployment evidence yet"
)


@pytest.fixture(scope="module")
def deployed():
    evidence = json.loads(EVIDENCE.read_text(encoding="utf-8"))
    pk = _read_env()
    if not pk:
        pytest.skip("GENLAYER_PRIVATE_KEY not available")
    client = create_client(studionet, account=create_account(pk))
    return client, evidence


def test_deploy_tx_finalized(deployed):
    client, evidence = deployed
    tx = client.get_transaction(evidence["deploy_tx"])
    assert tx.get("status_name") == "FINALIZED"
    leader = tx["consensus_data"]["leader_receipt"][0]
    assert leader["execution_result"] == "SUCCESS"


def test_three_way_source_identity(deployed):
    _, evidence = deployed
    ident = evidence["identity"]
    assert ident["local_file_sha256"] == ident["submitted_bytes_sha256"]
    assert ident["onchain_readback_sha256"] == ident["local_file_sha256"]


def test_seeded_proposals_present(deployed):
    client, evidence = deployed
    address = evidence["contract_address"]
    allp = client.read_contract(address, "get_all_proposals", args=[])
    assert len(allp) == 2
    # No proposal may still be in SCREENING: both were audited.
    for p in allp:
        assert p["status"] != "SCREENING"


def test_deterministic_approved_payout(deployed):
    client, evidence = deployed
    address = evidence["contract_address"]
    p2 = client.read_contract(address, "get_proposal", args=[2])
    assert p2["status"] == "APPROVED_FUNDED"
    assert int(p2["verified_impact_score"]) == 87  # 82 base + 5 conviction bonus
    assert int(p2["approved_payout"]) == 90000


def test_live_audit_executed(deployed):
    client, evidence = deployed
    address = evidence["contract_address"]
    p1 = client.read_contract(address, "get_proposal", args=[1])
    # The live audit ran and produced a verdict stored on-chain.
    assert p1["status"] in ("APPROVED_FUNDED", "PARTIAL_GRANT", "REJECTED")
    assert p1["sentinel_audit_report"] != ""


def test_delegate_reviews_recorded(deployed):
    client, evidence = deployed
    address = evidence["contract_address"]
    reviews = client.read_contract(address, "get_proposal_reviews", args=[1])
    stances = {r["verdict_stance"] for r in reviews}
    assert "ENDORSE_CONVICTION" in stances
    assert "RED_FLAG_CHALLENGE" in stances
    assert int(reviews[0]["helpful_votes"]) >= 1


def test_treasury_conservation_invariant(deployed):
    client, evidence = deployed
    address = evidence["contract_address"]
    summary = client.read_contract(address, "get_sentinel_summary", args=[])
    assert int(summary["treasury_budget"]) + int(summary["total_granted"]) == 50000000
    assert int(summary["approved_count"]) == 1
    assert int(summary["proposal_count"]) == 2
    assert int(summary["review_count"]) == 3


def test_claim_cleared_owner_credit(deployed):
    client, evidence = deployed
    address = evidence["contract_address"]
    owner = evidence["owner"]
    credited = int(client.read_contract(address, "get_claimable_grant", args=[owner]))
    # The approved payout was claimed on-chain, so the owner credit is zero.
    assert credited == 0


def test_rollback_reverted(deployed):
    _, evidence = deployed
    assert evidence["rollback_execution_failed"] is True
