# studionet deployment evidence

- Network: studionet (chain id 61999)
- Contract address: `0x2736a79F03d36080e63FA2ab164F7E9151D03978`
- Owner: `0x3de43AA2f7162c80af98abe78222aE0Cdf83c506`
- Deploy tx: `0x00ad0c613c8352b30e3d75414b93128a80167b5cfa54cb2a65327c5461d8498c`

## Transactions

| step | tx hash |
| --- | --- |
| deploy | `0x00ad0c613c8352b30e3d75414b93128a80167b5cfa54cb2a65327c5461d8498c` |
| proposal_1 | `0x6980103c9be56f00bfbdfde725338606ec111147942554328935fd33c4491659` |
| proposal_2 | `0x7ca117848c8600abb23a24f8b65e0646db343d73f910c058868dafa4706fc284` |
| review_endorse_p1 | `0xa357524aec872a79ca679cf0aede277bd5d65632abb471d72487c043175b8136` |
| review_flag_p1 | `0xfee721d62d30adc1c47b3bb9d74b83ec0d8272131eb88331976316eb8a63bf28` |
| review_endorse_p2 | `0xc7c81f78616994c3fd4c911a8bb17cb704e9d453a39f003117325c1003312774` |
| upvote_1 | `0xc2bdb2f582214d7b8e0ffefb2d47a0df1ddbeea27079297c158715c4423dc4e1` |
| audit_live_1 | `0xa1c2a2c018252da9dded00d68ea08242bfed2747feeff85075c95c5417c517e6` |
| audit_det_2 | `0x15abc3bbbc8e10789c7be54cd3f8ab572017d35ffc572b5bcdf4410e52eddf7e` |
| claim_owner | `0x1f72b518cc8489eaf3cec4299c3b46ec37a954f32582b56d39053b6642c31226` |
| rollback_self_review | `0xc5ffd7c17837f2df65008fea0844d56dafbb365eb539f1925a20a878874a0544` |

## Verification

- Applicant self-review rollback executed and reverted as expected: True
- Treasury conservation (budget + granted == 50000000): True
- 3-way sha256 source identity: True

```json
{
  "local_file_sha256": "68f3b74b79b162d28d8f04c3a02954e385b46adf7709aaf4b01ee691eda4e7fa",
  "submitted_bytes_sha256": "68f3b74b79b162d28d8f04c3a02954e385b46adf7709aaf4b01ee691eda4e7fa",
  "onchain_readback_sha256": "68f3b74b79b162d28d8f04c3a02954e385b46adf7709aaf4b01ee691eda4e7fa"
}
```

## Final state

```json
{
  "approved_count": 1,
  "partial_count": 0,
  "proposal_count": 2,
  "rejected_count": 1,
  "review_count": 3,
  "screening_count": 0,
  "total_granted": 90000,
  "treasury_budget": 49910000,
  "withdrawn_count": 0
}
```

Source-of-record note: the explorer JSON API was unavailable at run time for
one or more reads, so the deployed source identity is taken from the code
field embedded in the finalized deploy transaction and cross-checked against
the local file hash, rather than from the explorer UI.
