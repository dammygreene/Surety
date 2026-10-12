# Security and abuse model

## Assets to protect

- Contributors' bond funds and refund rights.
- Project triage funds.
- GitHub installation credentials and webhook secret.
- MPP credentials, wallet/private key material and API secrets.
- Private security reports and unpublished vulnerability details.
- Contributor identity and reputation history.
- Integrity of decision, payment and audit records.

## Threats and required controls

### Forged GitHub events

Verify webhook signatures against raw request bytes. Reject invalid signatures before parsing/acting. Deduplicate deliveries.

### Duplicate/replayed checkout or payment

Use high-entropy one-time tokens bound to a submission, expected contributor and quote. Persist challenge/receipt identifiers. Check idempotency in both the database and provider/contract state. Reject a receipt that was used for another submission.

### Fake payment success

Verify using official MPP server logic or read chain receipts/logs and check chain ID, token, amount, sender/owner, contract/recipient, event and final state. Never trust a browser's `success` flag or an unverified transaction hash.

### Double refund/forfeiture

State transitions must be monotonic and enforced by contract where possible. The provider operation and DB state update must be idempotent. Reconcile any partial failure.

### Maintainer abuse of forfeiture

Require a reason for Slop. Show the reason and triage destination before finalization. Use the fallback contract's timelock if that path is selected. Publish a durable audit record. Never allow the Surety operator to silently edit settled history. A full decentralized appeal mechanism is out of scope, so disclose this limitation.

### Maintainer silence or operator outage

The contract makes ignored submissions recoverable by any caller at the deadline, and the optional keeper provides the automatic product experience. The keeper uses a dedicated key, waits for a confirmed receipt, persists the transaction hash before final application settlement, and resumes recorded transactions after restart. Recovery remains safe if the keeper is offline because the contributor or another caller can invoke the same permissionless contract function.

### Sybil or identity-link abuse

Use GitHub OAuth with PKCE, a single-use hashed state, an HttpOnly SameSite
session cookie, and the stable numeric GitHub ID. The server fetches the
pull-request author and current head SHA with the OAuth token. A short-lived,
single-use wallet challenge binds that GitHub ID, submission, repository,
pull request, head SHA, wallet, and chain 42431; `personal_sign` is verified
server-side before escrow evidence can be attached. Do not key on display
name. OAuth tokens are server-only; the current SQLite MVP stores them
server-side but does not yet encrypt the database at rest.

### Malicious token or arbitrary destination

Configure an allowlist of supported TIP-20 stablecoins and validate token metadata against current official Tempo docs. Do not allow an arbitrary ERC-20 as a user-supplied token in the MVP. Snapshot the triage address for a bond and block unauthorized changes.

### Smart-contract reentrancy or token behavior

The current fallback uses a configured immutable TIP-20 token, checks-effects-interactions, a reentrancy guard, boolean-return checks, events and explicit project/triage destinations. The Foundry test suite includes a callback token that attempts reentrancy. Before production deployment, add a vetted safe-transfer library or formally verify compatibility with the selected TIP-20 implementation.

## Moderato evidence boundary

The deployed contract is `0x9eb4ffc29d5d5c636616225b3bb7d296ab5f8f95` on chain `42431`, configured for `PathUSD` (`0x20c0000000000000000000000000000000000000`, 6 decimals). The real proof confirmed Valid release and permissionless expired reclaim, and confirmed the Slop timelock prevents early forfeiture. Final forfeiture after the seven-day timelock and application restart/idempotency keeper integration remain unverified.

### Secret leakage

Use environment variables/secret manager. Never return secrets to the client, embed them in public `NEXT_PUBLIC_*` variables, log auth headers, commit `.env`, or store private keys in the database. Redact errors and telemetry.

### Denial of service and spam

Rate-limit submission and identity endpoints, cap body sizes, expire checkout links, bound GitHub API retries, and use a durable queue if external actions can exceed the webhook timeout. Keep the actual bond small and support a $0 trusted tier.

### Information leakage in security reports

Keep report body and evidence access-controlled and offchain. Never include sensitive descriptions in public comments, analytics, URLs, logs or onchain calldata/events.

## Invariants to assert

1. A single bond can settle once only.
2. Valid and ignored outcomes return the full bond, excluding explicitly disclosed network fees if applicable; do not deduct an undisclosed Surety fee.
3. Forfeiture cannot happen without an authorized maintainer decision and reason.
4. No decision action can override a completed refund/reclaim.
5. No user can decide a submission from another project without authorization.
6. The required bond is derived server-side from a policy snapshot and verified identity.
7. Chain/provider state and database state can be reconciled after interrupted operations.
8. Every material decision and fund movement has an audit reference.

### Contract-specific invariants

- `reclaim` is permissionless only after `block.timestamp >= expiry`; the recipient is always the immutable contributor stored at `postBond`.
- `release` and `flagSlop` are restricted to the bond's recorded project.
- `finalizeForfeit` can only pay the immutable triage fund after the recorded timelock.
- Every terminal status is written before an external token transfer and cannot be settled twice.

## Production caveats

The MVP is not a legal determination that a submission is objectively spam, nor is a smart contract alone a complete legal framework for security-report handling. Keep project rules explicit and seek legal/security review before handling material funds or confidential third-party vulnerability reports.
