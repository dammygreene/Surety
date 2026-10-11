# Surety: agent build pack

Surety is a refundable-bond and reputation layer for open-source submissions. A contributor posts a small stablecoin bond to submit a pull request, bug report, or security report. Accepted work is refunded, clearly marked low-quality work may be forfeited under the project's published policy, and silence past the review deadline results in an automatic refund. Trusted contributors can qualify for a $0 bond.

## Start here

1. Read [`AGENTS.md`](./AGENTS.md) for non-negotiable implementation rules.
2. Give the coding agent [`build-prompt.md`](./build-prompt.md) as its top-level task.
3. Follow [`plan.md`](./plan.md), starting with the MPP session/refund spike in [`tempo-mpp-spike.md`](./tempo-mpp-spike.md).
4. Use [`product-spec.md`](./product-spec.md), [`architecture.md`](./architecture.md), [`data-model.md`](./data-model.md), and [`api-spec.md`](./api-spec.md) as implementation references.
5. Apply [`design.md`](./design.md) and [`ui-ux.md`](./ui-ux.md) to the interface.
6. Do not claim end-to-end completion until the acceptance criteria in [`testing.md`](./testing.md) and [`demo-script.md`](./demo-script.md) have been run.

## Documents

| File | Purpose |
|---|---|
| `AGENTS.md` | Persistent instructions for the coding agent |
| `build-prompt.md` | Master prompt to give the agent |
| `plan.md` | Milestones, scope, acceptance gates and prioritization |
| `product-spec.md` | Product requirements and user stories |
| `design.md` | System design, component boundaries and core flows |
| `architecture.md` | Runtime architecture, trust boundaries and event sequence |
| `ui-ux.md` | Visual language, accessibility and interaction details |
| `tempo-mpp-spike.md` | Mandatory validation of Tempo/MPP payment and refund behavior |
| `data-model.md` | Database entities, states and invariants |
| `api-spec.md` | Application API behavior and error contracts |
| `github-app.md` | GitHub installation, webhooks, statuses and permission scope |
| `security.md` | Threat model and security requirements |
| `testing.md` | Unit, integration, contract, webhook and end-to-end tests |
| `demo-script.md` | A truthful 90-second demo and backup path |
| `deployment.md` | Environment, hosting and deployment guidance |
| `environment.md` | Environment variables and safe configuration |
| `decisions.md` | Fixed decisions, assumptions and unresolved decisions |
| `SPEC.md` | Original user-authored specification, copied without intentional edits |

## Truth and scope rules

- `SPEC.md` is the original product brief. Preserve its core product decisions.
- Tempo/MPP API names and payment semantics are version-sensitive. Verify current official documentation and installed package types before coding. Do not treat the original brief's proposed APIs as guaranteed current APIs.
- The session-native bond path is a hypothesis until the spike proves it. If it fails any critical test, implement the escrow-contract fallback and document the reason.
- A successful HTTP response is not proof a payment settled. Read and verify the payment receipt and/or onchain state.
- Never show fake transactions, fake balances, fabricated savings metrics, or pretend a local simulation is onchain. Label mock/demo state explicitly.
- Do not use AI or heuristics to automatically forfeit funds in the MVP. A maintainer decision requires an explanation and an audit event.

## Current initial defaults

- Product name: **Surety**
- First target: one GitHub repository, with pull requests as the integration demo and security-report intake as the paying-customer use case
- Chain: Tempo Moderato testnet first; do not use mainnet funds for the initial demo
- Stablecoin: choose an officially supported test TIP-20 asset after checking current Tempo docs/faucet, and keep token address configurable
- Required default bond: `$2.00` equivalent, configurable per project
- Review timeout: 7 days by default, configurable per project
- Trusted contributor: a contributor with at least one settled valid submission and no recorded slop outcomes qualifies for the demo's `$0` tier; keep the rule configurable and transparent
- Repository, author, and submission identity are linked by stable GitHub IDs and the payer's verified MPP identity. Do not key reputation on display names alone.

These defaults are for a demo, not claims about a production pricing or credit policy.
