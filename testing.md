# Testing and acceptance criteria

## Testing philosophy

Tests must prove product invariants and money-state behavior. Do not mark a test complete because the page renders or an API returns HTTP 200. No fake chain success is permitted in integration tests that claim to verify the live path.

## Unit tests

### Policy and reputation

- New contributor requires configured default bond.
- Amount is returned in integer base units and displayed consistently.
- One Valid settled event and zero Slop events gives `$0` for the specified MVP policy.
- A Slop outcome removes trusted eligibility if that is the documented policy.
- Ignored/refunded history does not incorrectly count as Valid.
- Client-supplied tier or payer DID cannot override server-derived reputation.
- Project configuration snapshot is retained for existing bonds when defaults later change.

### State machine

- Legal transitions succeed.
- Invalid transitions fail, including second settlement, Slop after refund, double release and reclaim before expiry.
- Decision outcome and money settlement remain distinct.
- Timelocked forfeiture cannot be finalized early.
- Amounts use exact base-unit arithmetic.

### Security and validation

- Invalid schema, unknown token, unsupported chain, invalid address, expired checkout token and reused token are rejected.
- Secrets and credentials are redacted from logs/errors.
- Unauthorized maintainer action fails.

## GitHub webhook tests

- Valid signature accepted.
- Invalid signature rejected.
- Signature is checked over raw body, not reserialized JSON.
- Duplicate delivery ID creates no second submission, comment or job.
- PR open creates one pending item and one checkout comment/check.
- Reopen/synchronize/close/merge events follow the documented policy without creating duplicate bonds.
- Deleted/uninstalled repository disables future app actions safely.
- API errors from GitHub are retryable and do not roll back verified payment.

## MPP/provider integration tests

Run against current official SDK mocks for deterministic edge cases and against Moderato for the real path.

- Valid challenge/credential is accepted by the current non-deprecated verification API.
- Incorrect amount/token/recipient/scope/submission binding is rejected.
- Credential replay to another submission is rejected.
- Expired challenge is rejected.
- Payment receipt/transaction is stored idempotently.
- Payment succeeds but DB persistence fails: reconciliation recovers the bond without asking for a second payment.
- Valid settlement refunds full bond.
- Ignored deadline permits contributor reclaim/refund without maintainer action, using the selected mechanism.
- Slop starts explicit forfeiture flow and pays only the configured triage destination.
- For session-native path, tests explicitly prove what “reserved,” “claimed” and “expired” mean. If not provable, do not claim that the path passes.

## Contract tests if fallback is selected

Use Foundry. Required cases:

- Post bond successfully.
- Reject duplicate bond ID.
- Reject unsupported token and wrong amount/arguments.
- Reject release by unauthorized caller.
- Release full bond once.
- Flag Slop with a reason hash.
- Reject forfeiture before timelock expiry.
- Finalize forfeiture after timelock to the configured triage destination only.
- Reclaim undecided expired bond; reject reclaim before expiry.
- Reject refund/forfeit/reclaim after final settlement.
- Verify events and state after every transition.
- Fuzz invalid actors, IDs, amounts and timing boundaries.
- Run an invariant that total accounted amounts cannot be paid out more than once per bond.

## End-to-end acceptance test

The following must work on Moderato, with real protocol or chain evidence:

1. Install/configure the GitHub App for a test repository.
2. Open a real test PR from a non-trusted account.
3. Surety creates one pending submission and comments with a unique checkout link.
4. Contributor sees the terms and posts the configured `$2` test bond.
5. Server verifies the challenge/receipt or transaction and marks the submission bonded.
6. Surety updates its GitHub check/comment accurately.
7. Maintainer marks the first submission Valid; full refund is confirmed.
8. The same linked contributor opens a second eligible submission.
9. Surety explains why that contributor's required bond is `$0` and accepts the submission without a token transfer.
10. For a separate submission, maintainer marks Slop with a reason; the forfeiture is either finalized or clearly shown pending the timelock. Show the correct destination and explorer reference.
11. For an undecided submission, advance/wait to the configured deadline and show refund/reclaim without maintainer cooperation, to the limit supported by the real mechanism.
12. Replay a GitHub webhook delivery and verify no duplicate comment, submission or bond.

If the deadline is too long for a live demo, configure a short review deadline in a dedicated test project and clearly label it as demo configuration. Do not use a hidden admin state edit to simulate a refund.

## Quality gates

Run the repository's actual scripts for:

- Format/lint.
- Typecheck.
- Unit tests.
- API/provider integration tests.
- Contract tests if applicable.
- Production build.
- Browser-based QA at mobile and desktop widths, if a browser is available.

Record exact commands and outcomes. If a browser cannot be installed or accessed, say visual browser QA is unverified. Do not fabricate pass rates.
