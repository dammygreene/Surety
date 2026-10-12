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
- `reclaim` is callable by an unrelated caller at the exact expiry boundary and pays only the recorded contributor.
- Reclaim remains available without maintainer cooperation; repeated reclaim attempts fail.
- The enabled keeper scans expired bonds, submits permissionless reclaim, waits for confirmation, and resumes a recorded transaction hash after restart without a duplicate settlement.

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

## Latest verification status

- GitHub App unit/integration tests: PASS, 3 focused tests covering signature
  rejection, durable delivery deduplication, pending check creation, bond
  confirmation, label/comment updates, and duplicate PR handling.
- GitHub live installation/webhook test: NOT RUN; no App credentials or
  disposable repository were available.
- Browser payment checkout: rendered and inspected with the injected-wallet
  controls. A funded Tempo-compatible wallet was unavailable, so approval,
  `postBond`, fee-token behavior, wrong-network switching, and receipt
  confirmation remain unverified.
- Contributor identity binding: PASS locally. Tests cover an authenticated
  numeric GitHub author, current head SHA, wallet signature, wrong author and
  challenge replay. Live OAuth and funded browser-wallet verification remain
  BLOCKED because credentials and a funded Tempo-compatible wallet were not
  available.

- `forge build`: PASS with Foundry `1.8.5`, Solidity `0.8.24`.
- `forge test -vvvv`: PASS, 11 tests and 0 failures; fuzz tests ran 256 cases each for amounts, deadlines and unauthorized callers.
- `npm run build`: PASS.
- `npm test`: PASS, 10 tests and 0 failures, including local OAuth/session
  persistence and wallet challenge binding tests.
- `npm audit --json`: PASS, 0 vulnerabilities across all severity levels.
- Bond lifecycle transaction evidence: PARTIAL PASS. A real Moderato run confirmed Valid release, Slop flagging plus early-finalization rejection, and ignored-bond reclaim. Final Slop forfeiture is not yet confirmed because the deployed timelock is 604800 seconds.
- Moderato deployment configuration: PASS. Contract address, deployment receipt, bytecode, `PathUSD` token at `0x20c0000000000000000000000000000000000000`, triage address and timelock were verified.
- Automatic keeper lifecycle: PARTIAL. The dedicated keeper address triggered the real reclaim and received no bond funds. SQLite restart/idempotency integration was not run in this proof.

## Real Moderato proof

Network: Tempo Moderato, chain ID `42431`. Explorer base: https://explore.testnet.tempo.xyz/tx/

- Valid post: `0x6eb710a119911e606a1ac9376ce2440059981d0e8f62d6a5a2c4c52e72f47cf8`
- Valid release: `0x721e4ab435990df8b990b252128827a84c571170727076259de66bc4f659c631`
- Slop post: `0x1015e3461cac186617989cc55e44a557c48a1aee81df0bae55c9ed4cf4d1cfec`
- Slop flag: `0x98976437f5365489c6ff0390f0214fbf4c067a0440702bab03fccdd19f58db09`
- Ignored post: `0xaf228b7c203ec0182df02b2934002d3fbeea6bb4e24b8c9f870bda48f3bf8963`
- Ignored reclaim: `0x80c0c416ea23000cda06c655cc5d1500c5865db2d2b816bf3a6aa717a50aa256`

The run observed one expected event for each confirmed terminal action, rejected reclaim before expiry, rejected early forfeiture, and confirmed that the keeper-triggered reclaim paid the recorded contributor rather than the keeper. Fees account for the contributor balance changing by slightly more than the bond amount.
- Browser visual QA: desktop dashboard was verified; mobile QA was not run.

## API/dashboard integration proof

- `npm run demo:import-live`: PASS. Existing Valid release and Ignored reclaim receipts were verified against chain `42431`, persisted with their contract bond IDs, and survived SQLite reopen.
- Keeper restart/idempotency: PASS for the existing reclaim evidence. The persisted reclaim hash was resumed and verified after reopening SQLite; a second keeper run found no reclaim candidate and submitted no duplicate transaction.
- Escrow simulation rejection: PASS. `simulation:*` evidence is rejected while `SURETY_PAYMENT_MODE=escrow`.
- `GET /api/health`: PASS against the deployed configuration; reports escrow mode, chain `42431`, and configured provider.
- `GET /api/submissions`: PASS; the dashboard receives `bondId`, receipt hashes, settlement hashes, and Tempo explorer URLs.
- Browser QA: PASS for the dashboard at the local desktop viewport used in this session. Mobile viewport and GitHub integration remain unverified.

Record exact commands and outcomes. If a browser cannot be installed or accessed, say visual browser QA is unverified. Do not fabricate pass rates.
