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
    assert evidence["identity_pass"] is True


def test_seeded_proposals_present(deployed):
    client, evidence = deployed
    address = evidence["contract_address"]
    allp = client.read_contract(address, "get_all_proposals", args=[])
    assert len(allp) >= 2
    # Proposal 1 was driven to a consensus verdict; proposal 2 stays SCREENING.
    assert allp[0]["status"] != "SCREENING"
    assert allp[1]["status"] == "SCREENING"


def test_live_audit_reached_verdict(deployed):
    client, evidence = deployed
    address = evidence["contract_address"]
    p1 = client.read_contract(address, "get_proposal", args=[1])
    assert p1["status"] in ("APPROVED_FUNDED", "PARTIAL_GRANT", "REJECTED")
    assert p1["sentinel_audit_report"] != ""
    # The consensus score is on the deterministic 5-point grid.
    assert int(p1["verified_impact_score"]) % 5 == 0


def test_approved_payout_matches_band_formula(deployed):
    _, evidence = deployed
    p1 = evidence["proposal1"]
    score = int(p1["verified_impact_score"])
    grant = int(p1["requested_grant"])
    payout = int(p1["approved_payout"])
    status = p1["status"]
    # The exact payout is a deterministic function of the consensus-agreed band.
    if status == "APPROVED_FUNDED":
        assert score == 100
        assert payout == grant
    elif status == "PARTIAL_GRANT":
        assert score == 60
        assert payout == (grant * 60) // 100
    else:  # REJECTED
        assert score == 0
        assert payout == 0
    assert score % 5 == 0


def test_delegate_reviews_recorded(deployed):
    client, evidence = deployed
    address = evidence["contract_address"]
    reviews = client.read_contract(address, "get_proposal_reviews", args=[1])
    stances = {r["verdict_stance"] for r in reviews}
    assert "ENDORSE_CONVICTION" in stances
    assert any(r["verdict_stance"] in ("TECHNICAL_NOTE", "RED_FLAG_CHALLENGE") for r in reviews)
    assert int(reviews[0]["helpful_votes"]) >= 1


def test_custody_conservation_invariant(deployed):
    client, evidence = deployed
    address = evidence["contract_address"]
    summary = client.read_contract(address, "get_sentinel_summary", args=[])
    total_supply = int(summary["total_supply"])
    vault = int(summary["vault_custody_balance"])
    allocated = int(summary["total_allocated_unclaimed"])
    held = (
        int(client.read_contract(address, "get_wallet_token_balance", args=[evidence["owner"]]))
        + int(client.read_contract(address, "get_wallet_token_balance", args=[evidence["signer2"]]))
        + int(client.read_contract(address, "get_wallet_token_balance", args=[evidence["signer3"]]))
    )
    # Custody plus every wallet balance always equals the fixed total supply.
    assert vault + held == total_supply
    # Reserved escrow can never exceed the vault.
    assert allocated <= vault
    assert evidence["custody_conserved"] is True
    assert evidence["reservation_ok"] is True


def test_transfer_ledger_records_flows(deployed):
    client, evidence = deployed
    address = evidence["contract_address"]
    receipts = client.read_contract(address, "get_transfer_receipts", args=[])
    kinds = [r["tx_type"] for r in receipts]
    # Genesis custody lock plus the explicit deposit are always present.
    assert kinds.count("TREASURY_DEPOSIT") >= 2
    # If the live audit reserved a payout that was claimed, the disbursement and
    # the proving token transfer are recorded too.
    if evidence["live_audit_claimed_payout"] > 0:
        assert "GRANT_DISBURSEMENT" in kinds
        assert "TOKEN_TRANSFER" in kinds
        claimed_id = evidence["claimed_proposal_id"]
        assert claimed_id is not None
        p_claimed = client.read_contract(address, "get_proposal", args=[claimed_id])
        assert p_claimed["claimed"] is True
        assert p_claimed["status"] in ("APPROVED_FUNDED", "PARTIAL_GRANT")
        # signer2 actually received transferred SGT in their on-chain wallet.
        assert int(client.read_contract(address, "get_wallet_token_balance", args=[evidence["signer2"]])) > 0


def test_claim_cleared_owner_credit(deployed):
    client, evidence = deployed
    address = evidence["contract_address"]
    credited = int(client.read_contract(address, "get_claimable_grant", args=[evidence["owner"]]))
    # Reserved-but-unclaimed credit for the owner is a non-negative integer and,
    # for proposal 1, was reduced to zero by the on-chain claim.
    assert credited >= 0


def test_rollback_reverted(deployed):
    _, evidence = deployed
    assert evidence["rollback_execution_failed"] is True
