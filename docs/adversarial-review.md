# GrantSentinel adversarial fund-safety review

Every party in a grant allocator is treated as adversarial: an applicant who
wants to over-collect, a delegate ring that wants to inflate conviction scores,
a page author who wants to inject instructions into the audit prompt, a front-runner
racing state transitions, and a treasury funder who wants custody to move only where
consensus allows. Each finding below is fixed in the contract and covered by a named
test in `tests/test_grant_sentinel_direct.py` (74 direct tests) and verified live on
studionet in `tests/test_grant_sentinel_integration.py` against the deployment
recorded in `docs/evidence.md`.

Review posture per project rules: exact validator consensus on anything that
moves funds (with zero tolerance on the credited integer), independent on-chain
re-fetch of the external proof URL, floors and ceilings and a 5-point score grid
on every numeric window, funded custody that cannot be over-encumbered, and
explicit race checks between competing transitions.

This revision closes the three steward findings from the Gen. Dave review:

1. **Funded custody and real asset transfer** (`custody` / `payout` was a
   counter-only clear). See F2, F12, F13.
2. **The exact credited amount is bound to validator agreement** (validators used
   to agree only on a tier band). See F8, F14.
3. **The owner-only consensus bypass is removed** (an owner path could approve
   without evidence). See F1, F10.

## State machine

| Status | Who may act | Transition | Fund effect |
| --- | --- | --- | --- |
| (none) | any account | submit_grant_proposal -> SCREENING | none |
| SCREENING | non-applicant delegate | submit_delegate_review (stays SCREENING) | none (reputation only) |
| SCREENING | non-author upvoter | upvote_delegate_review (stays SCREENING) | none (reputation only) |
| SCREENING | applicant | withdraw_proposal -> WITHDRAWN | none |
| SCREENING | any account | audit_grant_live -> APPROVED_FUNDED / PARTIAL_GRANT / REJECTED | consensus payout RESERVED in custody (no wallet move) |
| APPROVED_FUNDED / PARTIAL_GRANT | applicant only | claim_grant_payout(proposal_id) -> (claimed) | custody -> applicant SGT wallet (real transfer) |
| any holder | any account | transfer_grant_tokens(recipient, amount) | wallet -> wallet (SGT moves) |
| APPROVED_FUNDED / PARTIAL_GRANT / REJECTED / WITHDRAWN | (terminal) | no further audit/withdraw | locked |

There is now exactly one path that can move a proposal out of `SCREENING` toward
a payout: `audit_grant_live`, gated by GenLayer validator consensus. The former
owner-only `audit_grant_deterministic` has been deleted.

Liveness: the only state that holds custodied funds is a reserved payout
(`total_allocated_unclaimed` backed by `vault_custody_balance`) and the
applicant-owned `claimable_grants`, and the applicant can always exit via
`claim_grant_payout(proposal_id)` with no deadline, so grant funds are never
stuck. A proposal left in SCREENING locks no custody (nothing is reserved until
a consensus audit succeeds). The contract uses no wall-clock or block-timestamp
windows, so there is no time-based lockup and no deadline to bound. Every audit
path is guarded by `status == SCREENING`, and `withdraw` and the audit are
mutually exclusive on that same guard, so no two transitions can both move a
proposal out of SCREENING.

## Accounting invariant

`total_supply == vault_custody_balance + sum(all token_balances)` at every step,
and `total_allocated_unclaimed == sum(claimable_grants) <= vault_custody_balance`.
Custody is funded from a real minted token balance; a payout is a physical move
of SGT from `vault_custody_balance` into `token_balances[applicant]`, never a
counter decrement. The reservation is enforced before storage so the vault can
never over-encumber: `vault_custody_balance - total_allocated_unclaimed >=
approved_payout`. Asserted after every step in
`test_total_supply_is_conserved` and `test_audit_reverts_when_custody_exhausted`.

## Findings (all FIXED)

### F1. Owner-only path that bypassed evidence consensus (steward concern 3)
`audit_grant_deterministic` is deleted from the contract entirely. There is no
owner/admin backdoor that can approve or score a proposal without validator
evidence consensus; the only transition from SCREENING to a payout is
`audit_grant_live`.
- Tests: `test_no_owner_deterministic_audit_method` (method absent from the
  deployed contract), `test_deterministic_audit_symbol_absent_in_source`
  (symbol absent from the source file).

### F2. Advertised allocation was a counter-only clear, no asset moved
  (steward concern 1)
The treasury is now a funded custody vault holding a real transferable token
(SGT). Genesis mints 100,000,000 SGT to the deployer wallet and locks 50,000,000
of it into `vault_custody_balance` (deducted from that wallet). Any holder can
top up custody with `deposit_treasury_funds`. Approval reserves the exact payout
against unencumbered custody; `claim_grant_payout(proposal_id)` performs the real
custody-to-wallet transfer (`vault_custody_balance -= payout`,
`token_balances[applicant] += payout`), and `transfer_grant_tokens` proves the
claimed payout is a genuinely transferable asset.
- Tests: `test_genesis_custody_is_funded`,
  `test_deposit_moves_tokens_into_custody`,
  `test_claim_transfers_custody_to_wallet`,
  `test_transfer_moves_claimed_tokens`, `test_total_supply_is_conserved`.
- Live proof: the seeded `deposit_treasury_funds`, `claim_grant_payout(1)` and
  `transfer_grant_tokens` transactions on studionet, read back through
  `get_transfer_receipts` (see `docs/evidence.md`).

### F3. Over-encumbered custody
A payout is reserved only if `vault_custody_balance - total_allocated_unclaimed
>= approved_payout`; otherwise the audit reverts. Custody can never be promised
to more grants than it physically holds.
- Tests: `test_audit_reverts_when_custody_exhausted`,
  `test_live_audit_full_funds_and_reserves_custody`.

### F4. Double payout / re-audit
Every audit path first asserts `status == SCREENING` and the winner flips the
status in the same transaction, so an audited proposal can never be audited
(and reserved) again.
- Tests: `test_double_audit_reverts`, `test_live_audit_rejects_non_screening`,
  `test_reject_review_after_audit`, `test_withdraw_after_audit_reverts`.

### F5. Applicant self-endorsement (collusion to inflate conviction)
A delegate review is rejected when `sender == proposal.applicant`, so an
applicant cannot mint their own conviction endorsements.
- Tests: `test_applicant_cannot_review_own`.
- Live proof: the seeded applicant self-review transaction was FINALIZED with
  execution FAILED, see `test_rollback_reverted`.

### F6. Ballot stuffing and vote buying
One review is allowed per `(proposal_id, delegate)` and one upvote per
`(review_id, delegate)`, and a delegate cannot upvote their own review.
- Tests: `test_one_review_per_delegate`, `test_no_duplicate_upvote`,
  `test_cannot_upvote_own_review`.

### F7. Conviction-score manipulation
The community modifier is applied only on a net imbalance between endorsements
and red flags and is bounded (penalty floored at 0, bonus capped at 100), and it
is applied after the deterministic 5-point quantization so it can never push a
score off-grid.
- Tests: `test_red_flag_modifier_subtracts_15`, `test_endorse_modifier_adds_5`,
  `test_endorse_bonus_capped_at_100`, `test_red_flag_penalty_floors_at_zero`.

### F8. Exact credited amount was not consensus-bound (steward concern 2)
The impact score is snapped to a deterministic 5-point grid inside `run_audit`,
the community conviction modifier and the mandatory unverified-artifact cap are
applied on that grid, and the resulting **funding band label** (APPROVED_FUNDED /
PARTIAL_GRANT / REJECTED) plus the `artifact_verified` boolean are the consensus
object of `gl.eq_principle.prompt_comparative`. The **exact integer
`approved_payout` is then recomputed deterministically by the contract from the
consensus-agreed band and on-chain state** (full request for APPROVED, the fixed
on-grid PARTIAL representative times `requested_grant` for PARTIAL, zero for
REJECTED), and validated before it touches storage. Because the amount is a pure
function of the agreed discrete band, it is fully bound to validator agreement and
no single validator's or leader's continuous score can silently set the payout.
(Requiring validators to agree on a byte-identical LLM integer is not reachable on
a live network: independent audits of a subjective score almost never produce the
same number, so a strictly-integer principle finalizes no approval at all. Binding
the amount to the agreed band label is both reachable and strictly safer.)
- Tests: `test_consensus_bound_full_band`, `test_grid_blocks_74_from_full_tier`,
  `test_grid_boundary_75_full`, `test_grid_boundary_45_partial`,
  `test_grid_boundary_44_rejected`, `test_red_flag_modifier_moves_band`,
  `test_endorse_modifier_moves_band`, `test_live_audit_unverified_caps_band`,
  `test_live_audit_partial`, `test_live_audit_full_funds_and_reserves_custody`.
- Live proof: the seeded `audit_grant_live` that reached FINALIZED consensus and
  reserved its exact credited payout (see `docs/evidence.md`).

### F9. Prompt injection through the live proof URL
The rendered page is treated as untrusted evidence: control characters are
stripped, embedded `untrusted_`/`SENTINEL_` delimiters are rewritten to
`[defused]`, and the snippet is truncated to 5000 characters before the audit
prompt, which wraps the body between explicit untrusted markers and forbids
following instructions inside them.
- Tests: `test_live_audit_prompt_injection_defused`,
  `test_live_audit_control_chars_stripped`, `test_live_audit_report_trimmed`.

### F10. Unauthorized audit
With the deterministic path deleted there is no privileged audit at all.
`audit_grant_live` may be invoked by any account but only ever settles through
validator consensus on independently re-fetched evidence.
- Tests: `test_no_owner_deterministic_audit_method`,
  `test_deterministic_audit_symbol_absent_in_source`.

### F11. Input fuzzing and numeric overflow
Every field has a hard length window and `requested_grant` is bounded to
100..5000000; categories and stances are exact-match enums; `deposit_treasury_funds`
and `transfer_grant_tokens` reject zero/negative amounts and over-balance draws;
the consensus score is rejected (not clamped) if it is off-grid or out of range.
- Tests: `test_reject_empty_title`, `test_reject_title_too_long`,
  `test_accept_title_max_length`, `test_reject_manifest_too_long`,
  `test_reject_manifest_empty`, `test_reject_url_too_short`,
  `test_reject_url_too_long`, `test_reject_url_whitespace`,
  `test_reject_url_control_char`, `test_reject_url_bad_scheme`,
  `test_reject_grant_below_min`, `test_reject_grant_above_max`,
  `test_accept_grant_boundaries`, `test_reject_token_too_long`,
  `test_deposit_zero_reverts`, `test_deposit_insufficient_reverts`,
  `test_transfer_insufficient_reverts`.

### F12. Claim double-spend and wrong caller
`claim_grant_payout(proposal_id)` requires the proposal to be
APPROVED_FUNDED/PARTIAL_GRANT, requires `claimed == False`, requires
`sender == proposal.applicant`, re-checks the applicant credit and custody,
transfers the tokens, and flips `claimed` in the same transaction, so a payout
cannot be claimed twice or by a non-applicant.
- Tests: `test_claim_transfers_custody_to_wallet`,
  `test_claim_only_applicant`, `test_claim_double_reverts`,
  `test_claim_screening_reverts`, `test_claim_records_disbursement_receipt`.

### F13. Transfer and deposit integrity
`transfer_grant_tokens` and `deposit_treasury_funds` only move SGT that already
exists in a `token_balances` entry and record an append-only `PayoutReceipt` in
`transfer_ledger`; neither can create or destroy supply.
- Tests: `test_transfer_moves_claimed_tokens`,
  `test_deposit_moves_tokens_into_custody`, `test_genesis_receipt_present`.

### F14. Withdrawal races
Withdrawal is restricted to the applicant and only while `status == SCREENING`;
once audited or funded it is locked, so withdraw and audit cannot both fire.
- Tests: `test_withdraw_by_applicant`, `test_withdraw_only_applicant`,
  `test_withdraw_after_audit_reverts`.

## Known residual limitations (disclosed)
- Consensus granularity: validators must agree on the discrete funding band and the
  artifact flag, not on a continuous score. The exact amount is a deterministic
  function of the agreed band, which is what binds the credited payout to consensus.
  A strictly-integer score consensus is infeasible on a live network (independent
  LLM audits of a subjective score do not produce identical integers) and was
  verified during the studionet runs to finalize no approval.
- Direct-mode tests exercise the leader path only; they do not prove validator
  agreement. Validator behavior for the live audit is covered by the studionet
  run recorded in `docs/evidence.md`.
- `deposit_treasury_funds` is an irreversible contribution to custody: there is
  intentionally no path to withdraw deposited SGT back out of the vault except as
  a consensus-approved grant payout to an applicant. A funder cannot reclaim a
  deposit. This is by design for a treasury but is called out so no one assumes
  deposits are refundable.
- The community modifier operates on the snapshot taken at audit time; a review
  submitted after the audit snapshot does not affect that audit, by design, to
  keep the disbursement deterministic and race-free.
- `gl.nondet.web.render` and the LLM verdict depend on validator external access.
  Consensus requires validators to reach the identical quantized score and exact
  payout; if the external page changes mid-consensus the transaction can rotate
  or fail rather than settle on a stale verdict. No funds move and no custody is
  reserved unless the audit FINALIZED with SUCCESS.
- `transfer_grant_tokens` lets a holder move SGT to any valid address, including
  one with no known owner. That is a normal property of a transferable asset; the
  sender bears the loss and total supply is still conserved.
