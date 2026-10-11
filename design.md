# Technical design

## 1. Design principles

- Payment correctness comes before dashboard breadth.
- The chain is authoritative for money movement. The relational database stores submissions, configuration, identity links, decisions and a reconciled view of chain/payment state.
- All external systems are unreliable and deliver events more than once. Every handler must be idempotent.
- The MPP session path and escrow-contract fallback must be hidden behind a small `BondProvider` interface.
- Keep sensitive security-report contents offchain and out of public logs.
- Make every material state change explainable to a contributor and maintainer.

## 2. High-level components

### Web app

- Maintainer dashboard and project settings.
- Contributor bond checkout page.
- Security-report submission form.
- Server-side authentication/session management.

### API/runtime

- REST handlers for submissions, checkout, decisions, reputation and project configuration.
- MPP payment challenge/credential processing or contract transaction verification.
- GitHub webhook receiver.
- Expiry/reconciliation worker or scheduled task.
- Audit logger and notification/comment service.

### Bond provider adapter

Expected application-facing operations, adapted to what the chosen mechanism can actually guarantee:

- `getQuote(submission, contributor)`: required amount, token, expiry and reason.
- `createBondIntent(submission, contributor)`: creates a unique payment/bond challenge.
- `verifyBond(intent, proof)`: server-verifies payment/reservation and returns stable receipt metadata.
- `refundBond(submission)`: requests or executes valid/ignored refund.
- `flagForfeiture(submission, reason)`: records a maintainer decision and starts permitted forfeiture flow.
- `settleForfeiture(submission)`: finalizes when permitted.
- `reclaimExpiredBond(submission, actor)`: lets the contributor recover funds after the deadline where supported.
- `getBondStatus(submission)`: reconciles local metadata with the payment/contract state.

These are conceptual interfaces, not names to expect from MPP SDKs. Implement the adapter using real current APIs.

### Storage

- Postgres for deployed environments.
- SQLite may be used for local development and fast tests behind a repository layer.
- Database migrations are checked into source control.
- Store money as token base-unit strings plus currency/token metadata.
- Store raw GitHub webhook delivery IDs and safe hashes/metadata, not indiscriminately all payload contents.

## 3. Trust boundaries

1. **Browser to API:** untrusted. Validate all inputs and identity claims.
2. **GitHub to webhook endpoint:** verify `X-Hub-Signature-256` against the raw body and configured webhook secret.
3. **MPP credential to server:** verify with the official MPP method. A parsed credential or identity string alone is not proof of a successful payment.
4. **Browser wallet transaction:** untrusted until the server verifies the chain receipt/logs, correct token, amount, recipient/contract, and submission binding.
5. **Maintainer decision:** authorization must be checked against the connected GitHub App installation/repo membership or a narrowly-scoped configured maintainer allowlist.
6. **Database to chain:** reconcile after success. Never assume a DB write means funds moved.
7. **Chain to database:** process confirmed events idempotently. Handle reorg/failed status as appropriate to the network and SDK.

## 4. Required sequence: GitHub PR to bonded

1. GitHub emits `pull_request.opened`.
2. Webhook endpoint verifies signature and delivery idempotency.
3. Resolve repository ID, PR number/node ID, head SHA, author numeric ID and installation ID.
4. Create or retrieve the submission by its natural key. Set `PENDING_BOND` unless the calculated required bond is zero.
5. Create a cryptographically random, hashed, single-use checkout token with a short expiry. Store only the hash where possible.
6. Comment on the PR with a checkout link and explicit bond details, once only. Create a pending/failing check if configured.
7. Contributor opens the link. Server validates token, authenticated GitHub identity, project policy and required bond.
8. MPP or contract adapter creates the challenge/transaction.
9. Server verifies success and binds the payment receipt/transaction to that exact submission. Set `BONDED`.
10. Update GitHub check/comment and append an audit/payment event.

## 5. Required sequence: Valid, Slop, and Ignored

### Valid

- Verify the caller is an authorized maintainer for the repository/program.
- Require a deliberate confirmation.
- Record outcome, actor, timestamp and any notes.
- Invoke the adapter's safe refund flow.
- Mark money `REFUNDED` only after protocol/contract confirmation.
- Update reputation and GitHub state idempotently.

### Slop

- Require a reason and show the configured triage destination.
- Record the reason and a hash/reference if details should be private.
- The UI must show whether the bond is `FORFEITURE_PENDING` or truly `FORFEITED`.
- Use a configured timelock in the fallback contract. Do not bypass it for the demo.
- A decision alone does not prove the money has settled.

### Ignored

- At the configured deadline, record `IGNORED` and initiate or expose the refund/reclaim supported by the mechanism.
- The contributor must not need a maintainer's discretionary approval to recover after silence, to the extent promised by the selected payment primitive.
- Use a scheduled scan/worker plus a user-triggerable `reclaim` path where possible. Scheduled tasks are not the sole source of refund correctness.

## 6. Reliability patterns

- Webhook inbox table with unique `delivery_id`.
- Unique natural key for a GitHub submission generation.
- Unique bond intent per submission generation.
- Payment hook/receipt idempotency key.
- Transactional DB writes for application state transitions.
- Outbox pattern for GitHub comments/check updates if time permits; otherwise use a retryable job record.
- Exponential backoff for transient external errors and a dead-letter/error state after bounded retries.
- Reconciliation endpoint/worker that compares local state to the adapter's actual state.

## 7. Suggested repo layout

Adapt to the existing repository. If starting fresh, keep the layout pragmatic:

```text
apps/
  web/                 # Next.js dashboard and checkout
  api/                 # Node API and GitHub webhook (can be merged with web for MVP)
packages/
  core/                # state transitions, validation, reputation and policies
  storage/             # DB schema, migrations, repositories
  bond-provider/       # provider interface + selected implementation
  github/              # webhook verification, GitHub API wrapper
contracts/             # only if contract fallback is selected
  src/Surety.sol
  test/Surety.t.sol
docs/
  technical-spike.md
  demo-evidence.md
```

Do not split into services solely to match this drawing. One Node application is fine for the MVP if trust boundaries and modules remain clear.
