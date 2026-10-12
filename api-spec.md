# API specification

This defines application behavior, not exact MPP SDK method names. Let the installed current SDK issue and validate protocol-shaped challenges. Preserve its required headers and response formats.

## General requirements

- JSON API under `/api` unless the current repository already has a consistent convention.
- Validate request bodies with a schema library.
- Use server-side authentication and role checks.
- Return a request/correlation ID for debugging.
- Use idempotency keys on payment and decision mutation requests.
- Never include secrets or full sensitive security reports in error bodies/logs.

## Endpoints

### `GET /api/health`

Returns liveness plus dependency status safe for public display. Do not expose credentials, database connection strings or full RPC configuration.

### `POST /api/submit/intent`

Purpose: zero-dollar identity/auth intent before exposing a bond quote.

Input: submission reference or one-time checkout token and the protocol's supported identity-proof payload. The actual proof shape must follow the current MPP docs.

Success: verified contributor identity/link state, bond quote, token/network information, and any missing identity-link step.

Rules:
- Do not accept `payerDid` from the client as verified identity.
- Do not accept a client-supplied reputation tier.
- Avoid returning private security-report details unless the user is authorized.

### `POST /api/submit`

Purpose: protocol entry point for submission/paying flow as described in the original spec.

Expected behavior:
- Without a valid payment credential where the route requires one, return the proper MPP HTTP 402 Challenge produced by the current SDK.
- With a valid credential, verify it using the current non-deprecated SDK path, verify the challenge matches the submission and amount, and persist the payment/bond idempotently.
- Never treat receipt parsing as payment verification.

If the GitHub checkout path requires a separate endpoint to keep protocol challenges scoped to a particular submission, use `POST /api/submissions/:id/bond` and document the alias/actual path. The requirement is the verified behavior, not a particular path string.

### `GET /api/submissions`

Maintainer-only list with pagination, filters and bounded page sizes. Fields include title/URL, repo, author, current bond quote, money status, outcome, deadline and last event.

### `GET /api/submissions/:id`

Returns authorized details, timeline, event/receipt metadata, current policy snapshot and available actions. Never returns a raw checkout token.

### `POST /api/submissions/:id/decision`

Input:

```json
{
  "outcome": "valid",
  "reason": "Accepted and merged"
}
```

For `slop`, a meaningful `reason` is required. `valid` may also have an optional note. Validate `outcome` as enum. Require an `Idempotency-Key` or equivalent unique decision token.

Behavior:
- Authenticates a maintainer authorized for this project/repository.
- Verifies legal state transition and deadline rules.
- Stores a durable decision event.
- Starts the bond provider operation and returns `pending` until the adapter confirms settlement.
- Repeated identical decision request returns the original result. Conflicting decisions return `409`.

### `POST /api/submissions/:id/reclaim`

Available for an authorized contributor after expiry if supported by the selected mechanism. The API must not require a maintainer approval for the promised ignored-submission refund. Verify eligibility in contract/provider state, not only from a client timestamp.

### `GET /api/reputation/:contributorId`

Returns linked identity status, summarized settled outcomes, current tier, required bond calculation and a human-readable explanation. Only show sensitive identity details to the contributor and authorized maintainers.

### `GET /api/projects/:id/settings`

Maintainer-only settings view. Redact secrets.

### `PATCH /api/projects/:id/settings`

Maintainer-only validated settings update. Record a settings audit event. Block configurations that the current bond provider cannot actually enforce.

### GitHub webhook endpoint

Use the current repository convention, e.g. `POST /api/webhooks/github`.

- Read raw body first and verify HMAC signature.
- Enforce request/body size limits.
- Deduplicate `X-GitHub-Delivery`.
- Return promptly after durable enqueue/persistence; long work can be retried in a durable worker.
- Reply 2xx to safely handled duplicates, without replaying side effects.

### Internal reconciliation endpoint/worker

Not publicly callable without auth. Reconcile pending receipt/transaction states, retry GitHub side effects, expire checkout tokens and process ignored deadlines. Provide a local CLI or protected admin action for operator recovery.

## Error semantics

- `400`: malformed/invalid schema.
- `401`: no valid authentication.
- `403`: authenticated but not authorized.
- `404`: missing/hidden resource.
- `409`: invalid state transition, duplicate conflicting decision, or already settled bond.
- `410`: expired or consumed checkout token.
- `422`: well-formed request violates product policy.
- `429`: rate limit exceeded.
- `500/502/503`: safe generic server or dependency error.
- `402`: only for a legitimate MPP payment challenge where the current protocol expects it. Do not substitute an arbitrary JSON error for the SDK's proper challenge format.

## Audit fields

Mutations should emit structured, redacted logs with `requestId`, `projectId`, `submissionId`, `actorId`, action, previous/new state, provider receipt/transaction reference and result. Never log private keys, full MPP credentials, passkey material, GitHub tokens, webhook secrets, raw report content or unredacted auth headers.
