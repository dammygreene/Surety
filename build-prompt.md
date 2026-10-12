# Master build prompt: Surety

You are the senior full-stack engineer, smart-contract engineer, and product-minded designer responsible for shipping Surety for the Colosseum Crypto World's Fair Tempo track. Work directly in the existing repository. Your job is to implement a tested, demoable product, not just produce a plan or scaffold.

## Product in one sentence

**Surety makes people accountable for open-source submissions with refundable stablecoin bonds, then lowers the bond to $0 as a contributor earns a trustworthy record.**

A contributor submits a pull request, issue, bug report or security report. A small bond is required unless the contributor has earned a trusted tier. If the work is accepted, the bond is refunded. If the maintainer marks the submission as slop under a published policy, the bond may be forfeited to the project's triage fund. If the maintainer does nothing before the review deadline, the bond is refunded by default.

## Read before coding

Read `AGENTS.md`, `SPEC.md`, `decisions.md`, `plan.md`, `product-spec.md`, `design.md`, `architecture.md`, `ui-ux.md`, `tempo-mpp-spike.md`, `data-model.md`, `api-spec.md`, `github-app.md`, `security.md`, `testing.md`, `demo-script.md`, `deployment.md`, and `environment.md`.

`SPEC.md` is the original user brief. Preserve its product thesis and MVP. The rest of the docs clarify how to make it implementable. If two docs conflict, follow `decisions.md`; if the conflict concerns current Tempo/MPP SDK behavior, verify the official current docs and package types, document the evidence, and do not blindly follow stale API examples.

## Required first milestone: prove the bond mechanism

Before building a broad UI, execute the D1 spike in `tempo-mpp-spike.md`. Test current `mppx` / MPP on Tempo Moderato with small test funds. Establish with evidence:

1. Whether a session can hold/reserve the amount relevant to a bond without immediately and irrevocably transferring it to Surety.
2. What action claims/settles funds, whether a partial or zero claim is supported, and who can perform it.
3. What happens when a session expires, who can recover the unclaimed amount, and whether this behavior is protocol-enforced rather than a client convention.
4. Whether the expiry can be configured per submission at the required review-window scale.
5. Whether a contributor can complete the required payment flow from a normal browser wallet/passkey without a terminal-only setup.
6. Whether the GitHub checkout flow can safely bind the payment to a specific repo, PR/report, author and challenge without replay.

Use current official docs, package source/types and a small reproducible integration test. Do not describe a behavior as guaranteed until the test proves it.

### Mechanism decision

- **Choose session-native MPP only if** the spike proves the reservation/claim/refund semantics needed for the product, expiry behavior, identity binding, and a workable demo payment UX.
- **Otherwise use the contract fallback** described in `tempo-mpp-spike.md`: a TIP-20 escrow contract with `postBond`, `release`, `flagSlop`/`forfeit`, and `reclaim`, plus a configurable timelock and public reason/audit log. Use Foundry tests for the contract.
- Write the decision and evidence to `docs/technical-spike.md` (create `docs/` if needed) and update `decisions.md`. Do not wait for user confirmation if the evidence makes the path clear.
- Do not build both paths fully unless it is genuinely small and avoids delaying the vertical slice. Keep the application behind a `BondProvider` interface so the unused path remains a future adapter.

## Build the smallest complete vertical slice

### A. Contributor flow

1. A GitHub PR or security report appears in the Surety intake.
2. Surety resolves the GitHub numeric user ID and repo identity, checks the linked payer identity and reputation, and calculates the bond.
3. The contributor receives a signed, single-use checkout URL bound to that exact submission.
4. The contributor can inspect the amount, token, network, review timeout and forfeiture rules before paying.
5. The app executes the actual MPP payment or contract bond flow on Moderato. No fake success state is allowed.
6. Server-side verification confirms the payment/reservation, maps its receipt or transaction to the submission, and changes status to `BONDED`.
7. Surety comments on the PR/report and updates the configured check/label to show that the bond requirement is satisfied.

### B. Maintainer flow

1. A maintainer opens the Surety dashboard and sees a queue with submission, repo, author, age, bond, review deadline and state.
2. They can mark a submission **Valid** or **Slop**. Both require explicit confirmation; Slop additionally requires a reason.
3. Valid causes a verifiable full bond release/refund.
4. Slop follows the selected mechanism's safe forfeiture path and sends funds to the configured triage destination. Expose any timelock/pending state honestly.
5. If the review deadline passes without a decision, Surety triggers or enables the protocol-backed refund. An ordinary application timer alone must never be represented as a guaranteed trustless refund if a maintainer/operator can block it.
6. Each decision creates an append-only audit record and visible transaction/receipt reference.

### C. Reputation flow

- Reputation identity uses the verified MPP payer identity (`Credential.source`/DID where supported) linked to a stable GitHub numeric user ID. Verify the exact identity API against current docs.
- Reputation is deterministic, inspectable, and stored as event history, not a black-box score.
- For the MVP demo: after one settled Valid submission and zero Slop outcomes, the same linked contributor's next submission requires `$0` bond. A project's configuration may disable this rule.
- Store why the bond was calculated. Do not allow a client to submit an arbitrary reputation tier.
- Sponsored newcomers may be shown as a roadmap/secondary path; do not let sponsor accounting delay the main loop.

### D. GitHub App

- Handle `pull_request.opened`, relevant pull-request lifecycle events, `issues.opened`, installation/repository events and required status/check updates.
- Verify raw-body webhook signatures. Deduplicate webhook deliveries.
- On new PRs, create/reuse one pending submission record, add the `bond-pending` label where allowed, comment once with the checkout link, and publish a check state when possible.
- GitHub does not let the app stop a user from opening a PR or issue. For PR merge gating, create a check/status that fails or remains pending until bonded and require repository rules to enforce it. Explain that setup in the dashboard.
- Do not post repeated comments on webhook retries. Handle closed, reopened, merged, edited and deleted/reinstalled cases deliberately.

### E. Dashboard

Build these screens/states, not just a landing page:

- Overview: counts that are real and query-derived, not hardcoded.
- Submission inbox: Pending bond, Bonded, Valid, Slop/pending forfeiture, Ignored/expired, Settled/refunded.
- Submission detail: GitHub link, author identity, amount/token/network, due date, review timeline, maintainer decision and evidence/receipt/explorer links.
- Reputation: contributor identity linkage, settled outcomes, tier calculation and next required bond.
- Project settings: accepted repositories, bond amount, review window, triage recipient, trusted-contributor policy and setup guidance.
- Payment/transaction detail: exact network and real explorer URL when available.
- Clearly visible testnet indicator.

## Stack direction

Inspect the repo first and retain existing working conventions. If no meaningful stack exists, use a small TypeScript-first web application with:

- Next.js App Router for dashboard and checkout UI.
- Node.js runtime route handlers or Hono for MPP/GitHub webhooks. Do not use Edge runtime for dependencies requiring Node APIs.
- `mppx` and the currently documented Tempo adapter for the selected MPP path.
- `viem` for EVM reads and fallback-contract interaction.
- Octokit / official GitHub App libraries for GitHub integration.
- Postgres in deployed environments; SQLite is fine for local tests only if repository persistence is explicit and the adapter makes deployment-safe migration possible.
- Foundry only if the contract fallback is selected.
- Vitest or the repository's existing test framework; Playwright only if already usable or installable in this environment.

Pin dependency versions based on official compatibility and the lockfile. Do not blindly use `latest`. Use the current documented credential broadcast/verification flow; the MPP docs mark `verifyCredential` as a deprecated alias for new integrations, so verify the currently recommended API before choosing methods.

## Money and state invariants

- Token amount math must use integer base units or decimal-safe strings, never JS floats.
- One bond can be posted only once for a unique submission ID.
- One settled bond must not be refunded or forfeited twice.
- Only the configured authorized maintainer/project can decide Valid or Slop for that repo.
- Reclaims after expiry must respect the selected mechanism and cannot be blocked indefinitely by the project/operator.
- The project triage wallet is explicitly configured and shown before a forfeiture.
- Every payment, decision, release and forfeiture is idempotent and auditable.
- A failed chain transaction never produces a success UI state.
- Do not allow the same invoice-like artifact or report identity to be silently attached to a second bond; implement duplicate detection on GitHub repo ID + item number + submission generation and document reopen behavior.

## Design direction

Use a polished developer tool aesthetic: quiet, confident, neutral, information-dense but not cluttered. This is financial infrastructure for maintainers, so prioritize clarity and trust over crypto neon, gradients, 3D tokens, excessive glass effects or generic AI dashboard patterns. Use a restrained light/dark palette, excellent typography, strong alignment, thin dividers, small status colors and generous whitespace. See `design.md` and `ui-ux.md`.

## Work order

1. Repo inspection and current-doc research.
2. D1 payment/refund spike and evidence.
3. Database and state model.
4. Implement the chosen bond adapter with automated tests.
5. Build API and checkout flow.
6. Build contributor reputation calculation.
7. Build maintainer dashboard and auditable decision flow.
8. Add GitHub webhook and merge/status integration.
9. Finish accessible responsive UI, error states and setup guidance.
10. Run testing checklist, deploy/test on Moderato, and record the real demo evidence.

Keep the first release narrow. Do not add a token, multi-chain support, an arbitration court, a fiat on-ramp, enterprise SSO, or ML slop detection. Do not spend the deadline on features outside the vertical slice.

## Acceptance criteria

The build is only complete when all critical criteria in `testing.md` pass, including:

- A real Moderato bond flow from challenge to verified bond.
- Valid outcome returns the full bond.
- Slop outcome follows configured rules, requires a reason, and routes funds to the correct destination after any timelock.
- Ignored submission is refundable by default after the configured deadline.
- First valid settlement changes the subsequent bond for the same verified contributor to `$0`.
- GitHub webhook duplicate delivery does not duplicate rows, comments, or payments.
- Unauthorized maintainers cannot decide an outcome.
- Dashboard and GitHub state agree with persisted and onchain/receipt state.
- Tests, lint, typecheck and production build pass.
- Demo steps point to verifiable testnet receipts/transactions; any limitation is disclosed.

## Report back

Do not stop after writing more plans. Implement the product. At the end, report what actually works, the tested mechanism and versions, the exact testnet flow to reproduce it, test results, deployed links if any, and remaining blockers. Never claim a test passed unless it was run.
