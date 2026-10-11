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

Ignored submissions should be reclaimable after the deadline without requiring a discretionary action. This is a core protocol selection test. A cron job alone is not a trustless refund guarantee.

### Sybil or identity-link abuse

Use verified payer identity plus a stable GitHub numeric ID. Do not key on display name. Require re-authentication before linking/unlinking identities. Log changes and prevent opportunistic history merges.

### Malicious token or arbitrary destination

Configure an allowlist of supported TIP-20 stablecoins and validate token metadata against current official Tempo docs. Do not allow an arbitrary ERC-20 as a user-supplied token in the MVP. Snapshot the triage address for a bond and block unauthorized changes.

### Smart-contract reentrancy or token behavior

If contract fallback is selected, use battle-tested safe token transfer patterns, reentrancy guard where appropriate, checks-effects-interactions, explicit token allowlist, events, access controls and Foundry fuzz/invariant tests. Do not upgrade the contract or introduce proxies unless essential.

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

## Production caveats

The MVP is not a legal determination that a submission is objectively spam, nor is a smart contract alone a complete legal framework for security-report handling. Keep project rules explicit and seek legal/security review before handling material funds or confidential third-party vulnerability reports.
