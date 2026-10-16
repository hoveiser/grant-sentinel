# GrantSentinel adversarial fund-safety review

Every party in a grant allocator is treated as adversarial: an applicant who
wants to over-collect, a delegate ring that wants to inflate conviction scores,
a page author who wants to inject instructions into the audit prompt, and a
front-runner racing state transitions. Each finding below is fixed in the
contract and covered by a named test in `tests/test_grant_sentinel_direct.py`
(67 direct tests) and verified live on studionet in
`tests/test_grant_sentinel_integration.py`.

Review posture per project rules: exact validator consensus on anything that
moves funds, independent on-chain re-fetch of the external proof URL, floors
and ceilings on every numeric window, and explicit race checks between
competing transitions.

## State machine

| Status | Who may act | Transition | Fund effect |
| --- | --- | --- | --- |
| (none) | any account | submit_grant_proposal -> SCREENING | none |
| SCREENING | non-applicant delegate | submit_delegate_review (stays SCREENING) | none (reputation only) |
| SCREENING | non-author upvoter | upvote_delegate_review (stays SCREENING) | none (reputation only) |
| SCREENING | applicant | withdraw_proposal -> WITHDRAWN | none |
| SCREENING | any account | audit_grant_live -> APPROVED_FUNDED / PARTIAL_GRANT / REJECTED | treasury -> claimable |
| SCREENING | owner | audit_grant_deterministic -> tier | treasury -> claimable |
| APPROVED_FUNDED / PARTIAL_GRANT | applicant | claim_grant_payout | claimable -> paid out |
| APPROVED_FUNDED / PARTIAL_GRANT / REJECTED / WITHDRAWN | (terminal) | no further transition | locked |

Liveness: the only state that holds funds is `claimable_grants`, and its owner
can always exit via `claim_grant_payout` with no deadline, so funds are never
stuck. A proposal left in SCREENING locks no funds (nothing was credited yet);
it is advanced by any auditor or withdrawn by its applicant. The contract uses
no wall-clock or block-timestamp windows, so there is no time-based lockup and
no deadline to bound. Every audit path is guarded by `status == SCREENING`, and
`withdraw` and both audits are mutually exclusive on that same guard, so no two
transitions can both move a proposal out of SCREENING.

## Findings (all FIXED)

### F1. Double payout across the two audit paths
Both `audit_grant_live` and `audit_grant_deterministic` mint a payout, so an
audited proposal must not be auditable again. Every audit path first asserts
`status == SCREENING` and the winner flips the status in the same transaction.
- Tests: `test_double_audit_reverts`, `test_live_audit_rejects_non_screening`,
  `test_reject_review_after_audit`, `test_withdraw_after_audit_reverts`.
- Live proof: `test_seeded_proposals_present` (no proposal stays SCREENING after
  the seeded live and deterministic audits).

### F2. Treasury overdraw
The approved payout is clamped to the remaining `treasury_budget` before it is
deducted, so the pool can never go negative and grants can never exceed 50,000,000
units in aggregate.
- Tests: `test_treasury_conservation`, `test_rejected_pays_nothing`,
  `test_live_audit_treasury_conservation`.
- Live invariant: `test_treasury_conservation_invariant` asserts
  `treasury_budget + total_granted == 50000000`.

### F3. Applicant self-endorsement (collusion to inflate conviction)
A delegate review is rejected when `sender == proposal.applicant`, so an
applicant cannot mint their own conviction endorsements.
- Tests: `test_applicant_cannot_review_own`.
- Live proof: the seeded applicant self-review transaction was FINALIZED with
  execution FAILED, see `test_rollback_reverted`.

### F4. Ballot stuffing and vote buying
One review is allowed per `(proposal_id, delegate)` and one upvote per
`(review_id, delegate)`, and a delegate cannot upvote their own review, so
endorsements, red flags and helpful votes cannot be double-counted.
- Tests: `test_one_review_per_delegate`, `test_no_duplicate_upvote`,
  `test_cannot_upvote_own_review`.

### F5. Conviction-score manipulation
The community modifier is only applied when there is a net imbalance between
endorsements and red flags, and its result is bounded: the red-flag penalty is
floored at 0 and the endorsement bonus is capped at 100. A single extra review
can never push a score outside the tier it was earned in by more than the fixed
modifier.
- Tests: `test_red_flag_modifier_subtracts_15`, `test_endorse_modifier_adds_5`,
  `test_endorse_bonus_capped_at_100`, `test_red_flag_penalty_floors_at_zero`.

### F6. Prompt injection through the live proof URL
The rendered page is treated as untrusted evidence: control characters are
stripped, any embedded `untrusted_`/`SENTINEL_` delimiter tags are rewritten to
`[defused]` so the page cannot close the evidence block and issue instructions,
and the snippet is truncated to 5000 characters before it reaches the audit
prompt. The audit prompt wraps the body between explicit untrusted markers and
forbids following instructions inside them.
- Tests: `test_live_audit_prompt_injection_defused` (the LLM mock only matches
  if the injected closing tag was rewritten to `[defused]` before prompting),
  `test_live_audit_control_chars_stripped`, `test_live_audit_report_trimmed`.

### F7. Unverified artifact score inflation
A high self-reported impact score with an unverified mandatory artifact is
capped to 70, which is below the 75 full-funding threshold, so a missing or
unverifiable artifact can never produce a 100 percent disbursement.
- Tests: `test_live_audit_unverified_caps_score`.

### F8. Independent on-chain verification, not leader trust
`audit_grant_live` uses `gl.eq_principle.prompt_comparative`, so each validator
re-fetches the proof URL and re-runs the audit prompt, and agreement is required
on the tier band and the artifact-verified flag before funds move. The
deterministic owner path is a separate, explicitly owner-only authority used for
re-checks, not a bypass.
- Live proof: `test_deploy_tx_finalized` (leader execution SUCCESS) and
  `test_live_audit_executed` (an on-chain audit report was stored).

### F9. Input fuzzing and numeric overflow
Every field has a hard length window and `requested_grant` is bounded to
100..5000000; categories and stances are exact-match enums. The deterministic
audit rejects a score above 100 instead of silently clamping owner input.
- Tests: `test_reject_empty_title`, `test_reject_title_too_long`,
  `test_accept_title_max_length`, `test_reject_manifest_too_long`,
  `test_reject_manifest_empty`, `test_reject_url_too_short`,
  `test_reject_url_too_long`, `test_reject_url_whitespace`,
  `test_reject_url_control_char`, `test_reject_url_bad_scheme`,
  `test_reject_grant_below_min`, `test_reject_grant_above_max`,
  `test_accept_grant_boundaries`, `test_reject_token_too_long`,
  `test_deterministic_rejects_score_above_100`.

### F10. Unauthorized deterministic audit
`audit_grant_deterministic` reverts for any caller other than the owner.
- Tests: `test_deterministic_owner_only`, `test_rejects_non_screening` guards.

### F11. Withdrawal races
Withdrawal is restricted to the applicant and only while `status == SCREENING`;
once audited or funded it is locked.
- Tests: `test_withdraw_by_applicant`, `test_withdraw_only_applicant`,
  `test_withdraw_after_audit_reverts`.

### F12. Claim double-spend
`claim_grant_payout` zeroes the caller's credit before returning and reverts on
a zero balance, so a payout cannot be claimed twice.
- Tests: `test_claim_payout`, `test_claim_zero_reverts`.
- Live proof: `test_claim_cleared_owner_credit` (owner credit is 0 after the
  seeded claim).

## Known residual limitations (disclosed)
- Consensus precision on the exact partial amount: `audit_grant_live` requires
  validators to agree on the tier band (reject / partial / full) and on the
  `artifact_verified` flag. The material decision (which tier, and therefore
  0% versus a partial tranche versus 100%) is consensus-gated. Within the
  PARTIAL band the proportional amount is derived from the leader's reported
  score, so two honest validators in the same band could differ by up to the
  band width. This is bounded (never crosses a tier boundary and never exceeds
  the requested grant) and the exact-settlement path is the owner-only
  `audit_grant_deterministic`. It is NOT claimed that the live audit pins the
  exact partial figure by consensus; only the tier is guaranteed agreed.
- Direct-mode tests exercise the leader path only; they do not prove validator
  agreement. Validator behavior for the live audit is covered by the studionet
  run recorded in `docs/evidence.md`.
- The community modifier operates on the snapshot taken at audit time; a review
  submitted after the audit snapshot but in the same block does not affect that
  audit, by design, to keep the disbursement deterministic and race-free.
- `gl.nondet.web.render` and the LLM verdict depend on validator external
  access. Consensus requires validators to reach the same tier band; if the
  external page changes mid-consensus, the transaction can rotate or fail
  rather than settle on a stale verdict. No funds move unless the audit
  FINALIZED with SUCCESS.
