# D1 technical spike: Tempo + MPP bond semantics

## Why this spike is mandatory

The product's strongest technical claim is that a bond is a payment session that is only claimed on misbehavior, with unclaimed funds recoverable by default. That claim must be validated against the current MPP/Tempo SDK and testnet before product copy or architecture depends on it.

## Official references to verify at build time

- Tempo connection details: https://tempo.xyz/docs/quickstart/connection-details
- MPP quick start: https://mpp.dev/quickstart/server
- MPP session intent: https://mpp.dev/intents/session
- MPP charge intent: https://mpp.dev/intents/charge
- MPP refunds: https://mpp.dev/advanced/refunds
- MPP identity: https://mpp.dev/advanced/identity
- MPP payment hooks: https://mpp.dev/advanced/payment-hooks
- MPP security best practices: https://mpp.dev/advanced/security
- MPP server SDK reference: https://mpp.dev/sdk/typescript/server/Mppx.verifyCredential
- Tempo chain connection details should be checked live; original spec names Moderato chain ID `42431` and `https://rpc.moderato.tempo.xyz`.

The live MPP server reference currently describes `verifyCredential` as a deprecated alias and directs new integrations to `broadcastCredential`. Do not copy old examples without checking the current preferred API and types: https://mpp.dev/sdk/typescript/server/Mppx.verifyCredential

## Questions to prove with code, not assumptions

### A. Reservation and claim

- When a session begins, where are the funds held? Are they only authorized/reserved, already deposited into a channel, or transferred to a recipient?
- What exact action causes the payee to claim settlement?
- Can the payee claim zero, a partial amount or the full amount?
- Can a bond be released to the payer in the valid case without the project/payee first taking custody?
- Can a Slop outcome route the intended amount to a project triage wallet under the supported mechanism?
- Is the mechanism enforceable from protocol/contract rules, or does it depend on a server voluntarily not claiming?

### B. Expiry and reclaim

- Can expiry be set for each bond, including a 7-day review window?
- What exactly becomes reclaimable at expiry?
- Who can trigger reclaim, and does reclaim require the maintainer/server to be online?
- Does a server have any way to prevent an expired contributor refund indefinitely?
- What happens if the browser closes, network drops, or the Surety API is offline?

### C. Identity and browser UX

- Confirm the official current API for extracting verified payer identity (`Credential.source` or successor) from a verified MPP request.
- Does zero-dollar auth/proof work in the selected browser flow without moving funds?
- Can a human use a browser/passkey/wallet UI for the bond? If a CLI session is needed, record that limitation and decide whether contract fallback is the better hackathon demo.
- How is a challenge bound to the exact submission and protected against replay across repos/users?

### D. Hooks, persistence and retries

- Which current payment hooks exist, and what receipt/challenge details are exposed?
- What happens if payment settlement succeeds but the database write fails?
- What does the SDK return for partial payment, duplicate credential, expired credential and failed settlement?
- How should the API persist and reconcile the receipt?

## Reproducible spike procedure

1. Record date, runtime version, package manager, `mppx` version, related Tempo package versions and exact package lockfile entries.
2. Create/fund a test account on Moderato using the current official quickstart. Do not paste a private key or seed phrase into notes/logs.
3. Deploy a tiny isolated test server or script that can create one session and expose only the operations needed for the tests.
4. Use a low, clearly documented test amount.
5. Test the full claim path, a partial/zero claim if supported, expiry/reclaim after a short development timeout, and the target review-window timeout if practical.
6. Test the human checkout path in a real browser if available. If browser automation is unavailable, record that it was not verified rather than claiming it works.
7. Save transaction/receipt IDs, logs with secrets removed, test outcomes and any limitations in `docs/technical-spike.md`.
8. Reset test state and repeat the result at least once where practical.

## Go/no-go rule

**Use session-native MPP only if all product-critical guarantees are demonstrated:** a bond-sized amount is effectively committed to the submission; valid/ignored outcomes can be refunded by default; the project can obtain forfeiture only through an explicit maintainer action; expiry/reclaim cannot be indefinitely blocked by the project; and the browser/user identity flow is viable for the demo.

If the mechanism is merely pay-as-you-go billing where money has already been charged and refunding requires a separate discretionary transfer, it does not satisfy the product promise by itself. Use the contract fallback or describe the user experience and guarantees more narrowly, with explicit product approval from the owner. Do not quietly call a discretionary refund “trustless.”

## Contract fallback outline

If the spike fails, implement `Surety.sol` with the smallest auditable state machine:

- `postBond(id, project, token, amount, expiry)` pulls the configured TIP-20 from the contributor and creates a unique bond.
- `release(id)` returns the full bond to the recorded contributor, authorized by the project policy for a Valid outcome.
- `flagSlop(id, reasonHash)` records the proposed forfeiture and starts a timelock. The reason text remains visible to the contributor offchain; store a hash/reference where appropriate.
- `finalizeForfeit(id)` moves the bond to the configured triage fund only after the timelock and only if the bond is still eligible for forfeiture.
- `reclaim(id)` lets the contributor recover an undecided bond after expiry if no decision/forfeiture is already validly pending under the contract policy.
- Rework this exact API if needed to preserve security and avoid impossible transitions. Do not use a mutable project-provided token address without validating supported tokens.

### Contract constraints

- One bond ID can never be reused.
- No double release/forfeit/reclaim.
- Explicit project authorization and triage destination.
- Reentrancy-safe token interactions and safe token transfer helpers.
- Fixed/configured token handling with exact decimal math.
- Events for every critical state change.
- Foundry tests cover the invariants in `testing.md`.
- Be honest about any centralized maintainer decision and timelock. The contract cannot determine whether code is objectively “slop.”

## Evidence template

Create `docs/technical-spike.md` with:

- Date and machine/runtime details.
- Package versions and official docs URLs.
- Test account address only, no secrets.
- Chain ID, RPC and token address verified against the official docs/faucet.
- Each question above marked PASS, FAIL or NOT TESTED.
- Commands and test names.
- Relevant transaction/receipt/explorer links.
- Decision: session-native or contract fallback, with rationale.
- Known limitations and UX limitations.
