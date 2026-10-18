# GrantSentinel

AI-audited public goods and milestone grant allocator for DAOs, built as a
GenLayer Intelligent Contract on `studionet` (chain id 61999) with a live
interactive custody and screening terminal on GitHub Pages.

Builders submit grant applications tied to a live proof-of-work URL and a
treasury tranche request. Community delegates cast conviction endorsements or
file red-flag challenges on-chain. GenLayer validators then independently
re-fetch the live proof URL, verify the mandatory artifact token, and agree on a
funding band through an equivalence-principle audit. The contract derives the
exact payout deterministically from that consensus-agreed band, reserves it
against a funded custody vault, and delivers it to the applicant as transferable
Sentinel Grant Tokens (SGT) on claim.

## Live resources

- Frontend (GitHub Pages): https://hoveiser.github.io/grant-sentinel/
- Contract on studionet: `0x8d256ce6Af9Fa9419b82F3E2555aB742b341D6bD`
- Deployment evidence: [docs/evidence.md](docs/evidence.md)
- Adversarial fund-safety review: [docs/adversarial-review.md](docs/adversarial-review.md)

### Deployment identity

- Deploy tx (studionet): `0x6eebb24b3e33110ff8932edfd61586a00b37befb60b50ac4272640d76e61b649`
- Contract file sha256 (LF, matches local, submitted and on-chain readback):
  `754dfebc50f7b107fabdbd945d359830eec2e645302353f44322b4aa0e73d3d3`
- Git tag for the deployed contract: `studionet-v1`
- Pinned runner: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`

## Why GenLayer

The grant decision is a subjective, externally-evidenced judgment that must be
settled reproducibly enough for multiple validators to agree, and it moves
funds. That is exactly the boundary GenLayer is for:

- Evidence: the live proof URL is re-fetched by every validator with
  `gl.nondet.web.render`, and the mandatory artifact token must be present.
- Judgment: an audit prompt returns a raw impact score and an artifact-verified
  flag; the score is snapped to a 5-point grid, mapped to a funding band, and
  agreed through `gl.eq_principle.prompt_comparative`.
- Settlement: the contract derives the exact payout deterministically from the
  consensus-agreed band, reserves it against funded custody, and pays it to the
  applicant's transferable SGT wallet on claim.

The frontend is a convenience layer only; the contract is the source of truth.

## Architecture

- `contracts/grant_sentinel.py`: the Intelligent Contract. Pinned runner header,
  `@allow_storage @dataclass` structures, eight write methods and eight views.
- `tests/test_grant_sentinel_direct.py`: 74 fast direct-mode tests covering intake
  validation, self-review rejection, conviction versus red-flag band shifts, the
  consensus-bound funding bands, funded custody reservation, custody-to-wallet
  claims, transferable SGT, total-supply conservation, and prompt-injection
  defusing.
- `tests/test_grant_sentinel_integration.py`: read-only verification of the seeded
  on-chain state on studionet.
- `scripts/deploy_studionet.py`: deploys, funds custody, seeds a live scenario with
  three distinct signing accounts, drives a real validator-consensus approval,
  claims it into a wallet, transfers the claimed tokens, waits for FINALIZED on
  every transaction, performs a three-way sha256 source identity check, and
  records evidence.
- `frontend/`: Vite + React custody and screening terminal using `genlayer-js`.

## Funded custody model

There is no owner or admin path that can approve or score a proposal. The only
route from `SCREENING` to a payout is `audit_grant_live`, gated by validator
consensus on independently re-fetched evidence. The treasury is a funded custody
vault holding a real, transferable token (SGT), not a counter:

- `__init__` mints 100,000,000 SGT total supply to the deployer wallet and locks
  50,000,000 of it into `vault_custody_balance` (deducted from that wallet), so
  custody is genuinely backed by an account balance.
- `deposit_treasury_funds(amount)` moves SGT from any holder's wallet into
  custody and records a `TREASURY_DEPOSIT` receipt.
- A consensus approval reserves the exact payout against unencumbered custody:
  `vault_custody_balance - total_allocated_unclaimed >= approved_payout`, and
  credits the applicant's claimable balance.
- `claim_grant_payout(proposal_id)` performs the real custody-to-wallet transfer:
  it debits the vault and the reservation and credits `token_balances[applicant]`,
  records a `GRANT_DISBURSEMENT` receipt, and marks the proposal claimed.
- `transfer_grant_tokens(recipient, amount)` moves claimed SGT between wallets and
  records a `TOKEN_TRANSFER` receipt, proving the payout is a transferable asset.

Total supply is conserved at every step:
`total_supply == vault_custody_balance + sum(all token_balances)`.

Settlement bands (deterministic, derived from the consensus-agreed band):

- The raw impact score is snapped to a 5-point grid.
- Community conviction modifier: red flags over endorsements subtract 15 (floor
  0); endorsements over red flags add 5 (cap 100); the result stays on-grid.
- An unverified artifact caps a 75+ score at 70, so it can never reach the full
  band.
- Bands: 75+ APPROVED_FUNDED (the full request); 45..74 PARTIAL_GRANT (the fixed
  on-grid PARTIAL representative applied to the request); below 45 REJECTED (zero).
- The exact `approved_payout` is recomputed by the contract from the agreed band
  and `requested_grant`, never from any single validator's continuous score.

## Frontend features

- Funded Custody Vault balance, Unclaimed Reserved Escrow, the caller's Wallet SGT
  balance, and the live On-Chain Custody and Transfer Ledger.
- Fund Treasury Custody, Claim Grant to Wallet, and Transfer Claimed SGT actions,
  alongside submit proposal, submit review, upvote, and the live AI audit.
- Dual identity: one-click instant delegate burner wallet, Switch Identity, and
  MetaMask EIP-1193.
- Interactive impact and tranche simulator mirroring the on-chain band settlement.
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
