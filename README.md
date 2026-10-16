# GrantSentinel

AI-audited public goods and milestone grant allocator for DAOs, built as a
GenLayer Intelligent Contract on `studionet` (chain id 61999) with a live
interactive treasury and screening terminal on GitHub Pages.

Builders submit grant applications tied to a live proof-of-work URL and a
treasury tranche request. Community delegates cast conviction endorsements or
file red-flag challenges on-chain. GenLayer validators then independently
re-fetch the live proof URL and score impact through an equivalence-principle
audit, and the contract mints an impact-adjusted, tiered disbursement from a
fixed treasury pool.

## Live resources

- Frontend (GitHub Pages): https://hoveiser.github.io/grant-sentinel/
- Contract on studionet: `0x2736a79F03d36080e63FA2ab164F7E9151D03978`
- Deployment evidence: [docs/evidence.md](docs/evidence.md)
- Adversarial fund-safety review: [docs/adversarial-review.md](docs/adversarial-review.md)

## Why GenLayer

The grant decision is a subjective, externally-evidenced judgment that must be
settled reproducibly enough for multiple validators to agree, and it moves
funds. That is exactly the boundary GenLayer is for:

- Evidence: the live proof URL is re-fetched by every validator with
  `gl.nondet.web.render`.
- Judgment: an audit prompt returns an impact score, an artifact-verified flag
  and a report, agreed through `gl.eq_principle.prompt_comparative`.
- Settlement: the contract applies deterministic floors, ceilings, a community
  conviction modifier and tiered disbursement, then credits a claimable payout.

The frontend is a convenience layer only; the contract is the source of truth.

## Architecture

- `contracts/grant_sentinel.py`: the Intelligent Contract. Pinned runner header,
  `@allow_storage @dataclass` structures, seven write methods and six views.
- `tests/test_grant_sentinel_direct.py`: 67 fast direct-mode tests covering
  intake validation, self-review rejection, conviction versus red-flag score
  modifiers, full/partial/reject disbursement tiers, treasury conservation,
  withdrawal, claims, and prompt-injection defusing.
- `tests/test_grant_sentinel_integration.py`: read-only verification of the
  seeded on-chain state on studionet.
- `scripts/deploy_studionet.py`: deploys, seeds rich on-chain data with two
  distinct signing accounts, waits for FINALIZED on every transaction, performs
  a three-way sha256 source identity check, and records evidence.
- `frontend/`: Vite + React treasury and screening terminal using `genlayer-js`.

## Contract model

GrantProposal tracks the applicant, project metadata, a strict proof URL, a
mandatory artifact token, the requested grant, conviction endorsements, red-flag
challenges, review count, status, verified impact score, approved payout and the
sentinel audit report. DelegateReview captures a delegate's verdict stance,
rationale and helpful votes.

Disbursement rules (deterministic, applied after the audit):

- Impact score is clamped to 0..100.
- Community conviction modifier: red flags over endorsements subtract 15 (floor
  0); endorsements over red flags add 5 (cap 100).
- An unverified artifact caps a 75+ score at 70.
- Tiers: 75+ APPROVED_FUNDED (full grant); 45..74 PARTIAL_GRANT (proportional);
  below 45 REJECTED.
- Payout is bounded by the remaining treasury and credited to the applicant as a
  claimable grant.

## Frontend features

- Dual identity: one-click instant delegate burner wallet, Switch Identity, and
  MetaMask EIP-1193.
- Interactive impact and tranche simulator mirroring the on-chain rules.
- Submit grant proposal with a quick-fill preset, submit delegate review,
  upvote a review, trigger the live AI sentinel audit, and claim a payout.
- Reads live on-chain state and parses `status_name === "FINALIZED"` receipts.

## Development

```bash
pip install -r requirements.txt
genvm-lint check contracts/grant_sentinel.py
pytest tests/test_grant_sentinel_direct.py -v
python scripts/deploy_studionet.py
pytest tests/test_grant_sentinel_integration.py -v -s

cd frontend
npm install
npm run build
```
