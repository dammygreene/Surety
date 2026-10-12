# Build plan

## Goal

Deliver one end-to-end Surety workflow on Tempo Moderato with a GitHub PR intake, bond checkout, maintainer resolution, default refund on inaction, and reputation that removes the bond for the next valid contributor submission.

## Priorities

- **P0: correctness and demo loop.** Payment mechanics, persisted states, maintainer decision, repayment/refund and reputation.
- **P1: GitHub integration and credible UI.** Webhooks, labels/checks/comments, responsive dashboard, setup steps.
- **P2: roadmap only.** Sponsorship pool, MCP/CLI, multiple repos beyond the first configuration, arbitration court, multi-chain, fiat rails, ML classification.

## Phase 0: inspect and spike

Tasks:

- Inspect the existing repo and preserve current work that is already correct.
- Record runtime, package manager, deployment target, current tests and environment setup.
- Read the live MPP refund/session/identity/payment-hook docs and Tempo connection details.
- Prototype a bond-sized payment/reservation on Moderato and test claim, partial claim, expiry and refund behavior.
- Confirm a usable human checkout path. If the only supported flow is CLI/agent-driven, prove it and decide whether the contract fallback is needed for the UI demo.
- Record exact package versions, commands, chain ID, token address, transaction hashes/receipts, and a written go/no-go decision.

Exit gate: `tempo-mpp-spike.md` has evidence for each required question. No speculative refund behavior remains in product copy.

## Phase 1: state and payment core

Tasks:

- Implement the database schema and migrations from `data-model.md`.
- Implement the `BondProvider` interface and the selected production/testnet adapter.
- Implement idempotent create bond, verify bond, release/refund, flag slop, settle forfeiture, and expire/reclaim operations supported by the chosen mechanism.
- Create an append-only money-event and decision audit trail.
- Add unit and integration tests for amount calculation, transition validity, authorization and idempotency.

Exit gate: a CLI/test harness can create and settle a bond on Moderato and verify the receipt or contract state.

## Phase 2: contribution checkout and reputation

Tasks:

- Generate short-lived, single-use checkout tokens bound to a submission and expected GitHub identity.
- Show bond amount, network, token, review window and consequences before any payment.
- Verify payment at the server and bind the returned receipt/transaction to the submission.
- Calculate the contributor tier from immutable outcome events and the linked MPP identity.
- Show why the current bond is `$2`, lower, sponsored, or `$0`.

Exit gate: first valid submission refunds; second eligible submission is actually accepted at `$0` with no token transfer. No user-controlled tier is trusted.

## Phase 3: GitHub App

Tasks:

- Configure least-privilege app permissions and event subscriptions.
- Verify webhook signatures against raw bytes and deduplicate `X-GitHub-Delivery`.
- On PR opened, create one submission record, label/comment once, and create a pending/failing Surety check where configured.
- On bond verification, update the check/comment to show bonded.
- On merge/maintainer valid decision, release the bond. For Slop, collect a reason and apply selected mechanism.
- Explain that merge gating depends on a repository ruleset requiring Surety's check; GitHub cannot prevent opening the PR itself.

Exit gate: a real test repository completes a PR-opened-to-bonded loop without duplicate records or repeated comments.

## Phase 4: dashboard and finish

Tasks:

- Overview, inbox, submission details, contributor reputation, project settings and transaction receipt views.
- Empty, loading, error, awaiting bond, bonded, decision pending, refunded, forfeited, ignored, expired and transaction-pending states.
- Responsive layouts and keyboard/accessibility pass using `ui-ux.md`.
- Add onboarding instructions for installing GitHub App, setting repository rules, setting treasury/triage address and using testnet faucet.

Exit gate: the demo can be done from the product UI without direct database edits or hidden manual state changes.

## Phase 5: prove, deploy, record

- Run all commands and acceptance criteria in `testing.md`.
- Deploy to an appropriate Node-capable runtime and persistent database. Confirm webhook reachability and correct raw-body signature validation in production-like deployment.
- Record environment variable names only, never values, in deployment notes.
- Run `demo-script.md` against the deployed build or clearly label a local demo.
- Save real testnet explorer links, screenshots only if actually captured, and any known constraints.

## If time is running out

Keep this order:

1. Actual testnet bond and refund/forfeiture loop.
2. Real reputation-to-$0 loop.
3. One real GitHub PR and idempotent webhook processing.
4. Clean dashboard and demo.
5. Everything else is cut.

Do not substitute animated UI or mocked chain state for any of the first three items.
