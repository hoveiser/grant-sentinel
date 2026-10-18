# studionet deployment evidence

- Network: studionet (chain id 61999)
- Contract address: `0x8d256ce6Af9Fa9419b82F3E2555aB742b341D6bD`
- Owner (deployer, funder, proposal-1 applicant): `0x3de43AA2f7162c80af98abe78222aE0Cdf83c506`
- Reviewer / transfer recipient (signer2): `0x84B42CFC0a00cf0530657F6021D58B10DE7a0156`
- Second reviewer (signer3): `0xD48761955B69d6EA5f0fc5c62CACA99198663C9c`
- Deploy tx: `0x6eebb24b3e33110ff8932edfd61586a00b37befb60b50ac4272640d76e61b649`

## Transactions

| step | tx hash |
| --- | --- |
| deploy | `0x6eebb24b3e33110ff8932edfd61586a00b37befb60b50ac4272640d76e61b649` |
| deposit | `0xc59aceb512d23fd14e3d6e516a914b8441b43c9d0bf6d1cd6ea6870160088853` |
| proposal_1 | `0x8dd55ba1eea31753b1268a1d98ffb2b001ebada765b5e4a910f1c27b83ae6a5a` |
| proposal_2 | `0x0dbf7e0a6409478d602dd578ecf80b6e61219e82f51f1ee1e5e4d8cb595f6712` |
| review_endorse_p1 | `0x6cc28e6fb5b1e0e8b6575b1db85be3e5da1b0b254935c65fb7fb191c7adc63a1` |
| review_note_p1 | `0x31ee249b48ada04b41a743af3fb4c327d2d4463a9554687c89bf2eb829b00b67` |
| upvote_1 | `0xc251ee5920cabbbfd9d362c8038c010a7a7f0d5faa6116d745988f179c1e989f` |
| audit_live_1 | `0x09b61372b9de678b99582d6ee633c033881bde2f47f1c8cf16fce9840f758730` |
| claim_1 | `0x82fcf399751c174f9fdb00c94f9a6cab14583318ba4b6e3b6765a80f2cb38dcf` |
| transfer_1 | `0x58f16108670240b53c45c9494fc52241eae0d1f88beeb7415c19d6a2eeaf5aa8` |
| rollback_self_review | `0x640101f97f36fccc9070d72b31c693f902567d8e8b51639a05560b31936fdded` |

## Verification

- Applicant self-review rollback executed and reverted as expected: True
- Custody conservation (vault + all wallets == total supply): True
- Custody reservation (allocated <= vault): True
- Live consensus audit reserved payout that was claimed on-chain: 200000
- 3-way sha256 source identity: True

```json
{
  "local_file_sha256": "754dfebc50f7b107fabdbd945d359830eec2e645302353f44322b4aa0e73d3d3",
  "submitted_bytes_sha256": "754dfebc50f7b107fabdbd945d359830eec2e645302353f44322b4aa0e73d3d3",
  "onchain_readback_sha256": "754dfebc50f7b107fabdbd945d359830eec2e645302353f44322b4aa0e73d3d3"
}
```

## Final custody summary

```json
{
  "approved_count": 1,
  "partial_count": 0,
  "proposal_count": 2,
  "receipt_count": 4,
  "rejected_count": 0,
  "review_count": 2,
  "screening_count": 1,
  "total_allocated_unclaimed": 0,
  "total_disbursed": 200000,
  "total_supply": 100000000,
  "unencumbered_custody": 50800000,
  "vault_custody_balance": 50800000,
  "withdrawn_count": 0
}
```

## On-chain custody & transfer ledger

```json
[
  {
    "amount": 50000000,
    "proposal_id": 0,
    "receipt_id": 1,
    "recipient": "0x3de43AA2f7162c80af98abe78222aE0Cdf83c506",
    "tx_type": "TREASURY_DEPOSIT"
  },
  {
    "amount": 1000000,
    "proposal_id": 0,
    "receipt_id": 2,
    "recipient": "0x3de43AA2f7162c80af98abe78222aE0Cdf83c506",
    "tx_type": "TREASURY_DEPOSIT"
  },
  {
    "amount": 200000,
    "proposal_id": 1,
    "receipt_id": 3,
    "recipient": "0x3de43AA2f7162c80af98abe78222aE0Cdf83c506",
    "tx_type": "GRANT_DISBURSEMENT"
  },
  {
    "amount": 5000,
    "proposal_id": 0,
    "receipt_id": 4,
    "recipient": "0x84B42CFC0a00cf0530657F6021D58B10DE7a0156",
    "tx_type": "TOKEN_TRANSFER"
  }
]
```

Source-of-record note: the deployed source identity is taken from the code
field embedded in the finalized deploy transaction and cross-checked against
the local file hash.
