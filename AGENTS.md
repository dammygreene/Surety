# Instructions for coding agents

## First actions

1. Inspect the existing repository, package manager, scripts, tests, deployment files and current implementation before changing anything.
2. Read all project markdown files, especially `SPEC.md`, `decisions.md`, and `tempo-mpp-spike.md`.
3. Send a concise initial plan, then start work. Do not ask the user to restate requirements already documented here.
4. Run the Tempo/MPP spike first and save evidence in `docs/technical-spike.md` or update `tempo-mpp-spike.md` with tested package versions, exact commands, outcomes and links.

## Product rules

- The product is **Surety**, not invoice finance and not a general payment gateway.
- A bond is a submission-quality commitment. The purpose is to reduce spam and review burden without punishing people who submit good work.
- Valid work gets its bond back. Silence after the defined deadline defaults to refund. Forfeiture requires a maintainer decision and a reason that the contributor can inspect.
- A trusted contributor can submit with a $0 bond under the explicit reputation policy.
- Never automatically forfeit a bond using AI, content heuristics, or a failed CI check.
- Do not claim Surety can prevent a user from opening a GitHub issue or pull request. It can comment, label, create/update checks, and gate eligible merge flows when repository rules are configured to require Surety's check.

## Technical rules

- Use official current Tempo and MPP documentation, package exports, TypeScript types and runnable examples as the authority for API details.
- Do not invent package methods, transaction behavior, expiry guarantees, browser-wallet behavior, or token addresses.
- Avoid deprecated APIs for new integrations when official docs identify a replacement.
- Keep chain interactions behind a provider/service adapter so the native MPP implementation and contract fallback cannot leak into product routes.
- Use decimal strings or integer base units for token amounts. Never use floating-point arithmetic for money.
- Verify payments server-side. Never trust client-submitted `paid: true`, transaction hashes without receipt verification, or browser-only state.
- Use idempotency keys for GitHub webhook deliveries and payment settlement handlers.
- Persist application state. The chain is the source of truth for money; the database is the source of truth for application metadata, with reconciliation for chain events.
- Use least-privilege GitHub permissions and verify each webhook signature against the raw request body.
- Keep private keys and secrets server-side. Never add real secrets to source control.

## Delivery rules

- Build a working vertical slice before expanding scope.
- Prefer understandable and testable code over abstractions that do not serve the MVP.
- Add loading, empty, error, pending, refunded, forfeited and expired states. Make irreversible actions clear and deliberate.
- Every user-facing claim must match actual behavior. Clearly label testnet assets and demo-only fixtures.
- Run lint, typecheck, unit tests, integration tests and a production build. Report each result accurately.
- Do not say browser QA passed unless the app was actually rendered in a browser at relevant viewports.
- Do not leave fake buttons, dead links, placeholder actions, TODO-only core behavior, or silent exception swallowing.
- When blocked, state the specific blocker, complete other independent work, and leave actionable evidence and a next step.

## Required final report

Summarize: implemented features; the selected bond mechanism and why; exact Tempo network/token used; commands run and their results; deployed URLs if any; known limitations; required environment variables; and steps to reproduce the 90-second demo. Distinguish verified results from assumptions.
