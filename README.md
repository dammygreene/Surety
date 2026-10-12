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

## Local lifecycle

Install and validate the application with:

```powershell
npm install
npm run build
npm test
npm run dev
```

Copy `.env.example` to `.env` and set `SURETY_MAINTAINER_TOKEN` for dashboard decisions. The default `SURETY_PAYMENT_MODE=escrow` refuses to mark a payment settled until it can verify a Tempo receipt from the configured `Surety.sol` address. For deterministic local tests only, set `SURETY_PAYMENT_MODE=simulation`; every resulting reference is prefixed `simulation:` and is not onchain evidence.

The escrow fallback is defined in [`contracts/Surety.sol`](./contracts/Surety.sol). A real testnet run requires a deployed contract, supported Moderato TIP-20 token, project/triage addresses, and server-side project/keeper signers. The contributor submits a confirmed `BondPosted` transaction to `POST /api/submissions/:id/bond`; Valid calls `release`, Slop first calls `flagSlop` and remains timelocked until `finalizeForfeit`, and ignored submissions can be recovered by any caller after expiry, with the contract sending funds only to the recorded contributor.

For the promised automatic experience, set `SURETY_KEEPER_ENABLED=true` and configure a dedicated `SURETY_KEEPER_PRIVATE_KEY`. The keeper periodically finds expired bonded submissions, submits permissionless `reclaim` transactions, waits for confirmation, verifies the `BondReclaimed` event, and then updates SQLite. Its idempotency record stores the transaction hash so a restart can resume confirmation without sending a second reclaim.

The MPP session spike and mechanism decision are recorded in [`docs/technical-spike.md`](./docs/technical-spike.md). Session-native MPP is not used as the Surety bond provider because the server cannot independently create the maintainer-authorized Slop claim required by the product.

The local application and Solidity tests are supplemented by a real Moderato proof run. Valid release and ignored recovery have confirmed receipts; Slop flagging and early-finalization rejection have confirmed receipts, but final forfeiture remains pending the deployed contract's seven-day timelock. Keeper/database restart integration is not claimed as complete. See [`testing.md`](./testing.md) and [`docs/technical-spike.md`](./docs/technical-spike.md).

The Surety contract is deployed to Moderato at `0x9eb4ffc29d5d5c636616225b3bb7d296ab5f8f95`; the deployment receipt, bytecode, token, triage address and timelock were verified. The proof used `PathUSD` at `0x20c0000000000000000000000000000000000000` (6 decimals). The keeper remains disabled by default.

## GitHub App MVP

Configure the variables in `.env.example`, create a GitHub App with Checks,
Pull requests, Issues and Metadata permissions, and subscribe to the required
pull-request and issue events. Set the App webhook to
`https://<public-host>/api/webhooks/github`, install it on a test repository,
and require the `Surety Bond` check in branch protection/rulesets. An
unbonded PR receives a pending check, `bond-pending` label, and one payment
comment. The check is successful only after verified escrow evidence or the
stored trusted-contributor policy qualifies the author. GitHub App private
keys and webhook secrets stay server-side.

The payment page is `/pay/:submissionId`. It now supports an injected
EIP-1193 wallet for Tempo-compatible approval and `postBond` transactions,
checks chain `42431`, waits for both receipts, and sends only the confirmed
bond receipt to the server. The server independently verifies the event and
derives the payer DID from the recorded contributor address. Wallet support
still requires a wallet that can submit Tempo fee-token transactions; that
browser path has not been run against a funded wallet in this environment.
Before escrow payment, the checkout uses GitHub OAuth with PKCE and a
short-lived, single-use wallet signature challenge bound to the submission,
current PR head SHA, GitHub numeric author ID, wallet and chain. The server
must verify both identities before accepting the confirmed bond receipt.
Live OAuth and funded-wallet execution still require external credentials and
a Tempo-compatible wallet.
Live GitHub installation testing requires App credentials and a disposable
repository and is not claimed by the local tests.

## 90-second demo

With `.env.local` configured and the existing Moderato deployment unchanged:

```powershell
npm run demo:import-live
npm run dev
```

Open `http://localhost:3000/`. The dashboard shows the confirmed Valid release and Ignored reclaim, with links to each `BondPosted` and settlement receipt plus the deployed escrow contract. The Slop scenario is represented by the existing confirmed `SlopFlagged` transaction and the rejected early-forfeiture attempt; do not present final forfeiture as successful until the seven-day timelock has elapsed. `demo:import-live` is read-only with respect to the chain: it verifies the existing receipts, persists them in SQLite, reopens the database, and reruns the keeper path using the persisted reclaim hash without broadcasting a duplicate reclaim.
