# D1 technical spike: Tempo + MPP bond semantics

Date: 2026-10-11  
Runtime: Node.js v24.18.0, npm 11.16.0, Windows  
Package checks: `mppx` latest `0.13.4`, `viem` latest `2.57.4`, `hono` latest `4.13.13`

## Verified documentation

- MPP session docs: https://mpp.dev/intents/session
- MPP refunds: https://mpp.dev/advanced/refunds
- MPP server quickstart: https://mpp.dev/quickstart/server
- Tempo connection details: https://tempo.xyz/developers/docs/quickstart/connection-details

## Live connectivity

Command:

```powershell
$body = '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
Invoke-RestMethod -Uri 'https://rpc.moderato.tempo.xyz' -Method Post -ContentType 'application/json' -Body $body
```

Outcome: PASS. The RPC returned `0xa5bf`, which is decimal chain ID `42431` (Tempo Testnet/Moderato). The official page confirms RPC `https://rpc.moderato.tempo.xyz` and explorer `https://explore.testnet.tempo.xyz`.

## Answers and decision

| Question | Result | Evidence |
|---|---|---|
| Session reserves funds in a channel rather than immediately claiming them | PASS (SDK/docs) | `mppx@0.13.4` session server code validates contributor-signed channel credentials and the current MPP refund docs describe unclaimed deposits returning after close/expiry. |
| Unclaimed or partial funds return by default | PASS (documentation), NOT TESTED on funded Moderato channel | The MPP refund table states that never-claimed funds return after expiry and partial claims return the remainder. No funded account was available to verify the chain path. |
| Maintainer-only explicit forfeiture is protocol-enforced | FAIL for session-native Surety | Session settlement consumes the contributor's signed voucher. A maintainer cannot manufacture a voucher for the bond amount. The session API therefore cannot enforce a maintainer-only Slop forfeiture. |
| Per-bond seven-day expiry | NOT TESTED | The session request schema exposes `expires`, but no funded channel was opened to verify the exact Tempo enforcement and expiry boundary. |
| Browser wallet/passkey checkout | NOT TESTED | The installed CLI provides a managed account flow; no browser wallet/passkey session was available in this spike. |
| Charge flow is suitable as a native refund mechanism | FAIL | MPP explicitly says charge refunds are out-of-protocol direct transfers by the server. |
| Current server verification API | PASS (type inspection) | `Mppx.validateCredential()` is non-mutating; `Mppx.broadcastCredential()` is the current mutating API. `verifyCredential()` is deprecated. |
| Moderato chain ID/RPC | PASS | Live JSON-RPC check and official Tempo connection page. |

## Go/no-go

The session path is **not sufficient for Surety's complete bond lifecycle** because the server cannot independently create the explicit maintainer-authorized Slop claim required by the product. Surety therefore uses the escrow fallback in [`contracts/Surety.sol`](../contracts/Surety.sol). The contract makes release, timelocked Slop forfeiture, and permissionless contributor-directed reclaim explicit and verifiable from receipts. MPP remains useful for future machine-payment intake, but is not presented as the bond provider.

No test account, private key, transaction, or receipt was used or recorded. This is deliberate because the required credentials were not available in the repository environment.

## Reproducible SDK inspection

```powershell
npm ls mppx
Get-Content node_modules\mppx\dist\server\Mppx.d.ts
Get-Content node_modules\mppx\dist\tempo\session\server\CredentialVerification.d.ts
```

The inspected declarations contain `validateCredential`, `broadcastCredential`, `Credential.fromRequest`, and `onPaymentSuccess`. The session method's `broadcastCredential` path validates a contributor-signed session credential and can settle accepted vouchers; it does not expose a server-created forfeiture authorization.

## Application implementation status

- `SURETY_PAYMENT_MODE=simulation` is available only for deterministic local tests and uses references prefixed `simulation:`. It is never reported as onchain evidence.
- The default provider is the escrow contract adapter. It verifies `BondPosted` and `BondReclaimed` receipt events, chain status, contract address, bond ID, amount, project and contributor identity.
- Valid settlement requires a configured project signer and a confirmed `BondReleased` transaction.
- Slop first creates a confirmed `SlopFlagged` transaction, then requires the contract timelock before `finalizeForfeit`; the application does not mark the bond forfeited at flag time.
- Reclaim is permissionless after expiry: any caller may submit the transaction, and the contract sends funds only to the recorded contributor. The application requires a confirmed `BondReclaimed` event and does not require contributor cooperation.
- The optional application keeper submits this transaction automatically for expired submissions. It persists each confirmed transaction hash under an idempotency key and verifies it again after restart; recovery remains permissionless if the keeper is offline.
- GitHub-author binding is implemented with server-side OAuth PKCE, an opaque
  HttpOnly session cookie, and a single-use wallet signature challenge bound
  to the submission, repository, PR number, current head SHA, numeric author
  ID, wallet and chain 42431. Local tests cover author mismatch and replay
  rejection; live OAuth and funded-wallet execution are not claimed here.

## Contract audit update

The initial audit identified and fixed:

- `reclaim` was contributor-only; it is now permissionless after the exact `expiry` boundary.
- A simple contract reentrancy guard now protects token interaction entry points.
- Foundry `1.8.5` build and verbose tests pass: 11 tests, including 256-case fuzz tests for amounts, deadlines and unauthorized callers, duplicate IDs, transfer failures, timelock boundaries, permissionless reclaim, repeated settlement attempts and a reentrancy callback.

Before the deployment below, no contract address, deployment transaction, bond transaction, refund transaction, forfeiture transaction or reclaim transaction was available in the repository evidence.

## Moderato deployment evidence

The local testnet deployment was completed on 2026-10-11 using fresh project and keeper wallets generated locally. No Zerion key was used.

- Network: Tempo Moderato, chain ID `42431`
- Token: `PathUSD`, `0x20c0000000000000000000000000000000000000`, 6 decimals
- Surety contract: `0x9eb4ffc29d5d5c636616225b3bb7d296ab5f8f95`
- Deployment transaction: `0x3314fe3e4ae81e0d8f45ae8fa05a32b0715ddb6cc81624ac8911906baf3dcf24`
- Explorer: https://explore.testnet.tempo.xyz/address/0x9eb4ffc29d5d5c636616225b3bb7d296ab5f8f95

The receipt was successful, deployed bytecode was present, and onchain reads confirmed the configured token, triage address, and 604800-second Slop timelock. Tempo has no spendable native gas token; deployment required the official transaction-level PathUSD fee-token configuration. `SURETY_KEEPER_ENABLED` remains `false` by default.

## Real Moderato lifecycle evidence

The reproducible script [`scripts/testnet-lifecycle.ts`](../scripts/testnet-lifecycle.ts) ran against chain `42431` and emitted only public evidence:

- Valid: post `0x6eb710a119911e606a1ac9376ce2440059981d0e8f62d6a5a2c4c52e72f47cf8`; release `0x721e4ab435990df8b990b252128827a84c571170727076259de66bc4f659c631`; one `BondReleased` event.
- Slop: post `0x1015e3461cac186617989cc55e44a557c48a1aee81df0bae55c9ed4cf4d1cfec`; flag `0x98976437f5365489c6ff0390f0214fbf4c067a0440702bab03fccdd19f58db09`; early finalization rejected.
- Ignored: post `0xaf228b7c203ec0182df02b2934002d3fbeea6bb4e24b8c9f870bda48f3bf8963`; reclaim `0x80c0c416ea23000cda06c655cc5d1500c5865db2d2b816bf3a6aa717a50aa256`; one `BondReclaimed` event and keeper received no bond payout.

The final Slop transaction is intentionally not claimed: the deployed timelock is seven days.

## Application integration evidence

Those remaining application checks are now complete for the existing receipts. `npm run demo:import-live` verified the two `BondPosted` receipts and their `BondReleased`/`BondReclaimed` receipts, persisted the contract bond IDs and settlement hashes in SQLite, reopened the database, and resumed the keeper from its persisted reclaim hash without submitting another transaction. The Hono API exposes those hashes and explorer URLs, and the dashboard renders the deployed contract link plus both receipt links. Escrow mode rejects `simulation:*` evidence.

The confirmed Slop flag remains a non-terminal decision. The early finalization rejection is part of the prior real proof, while final forfeiture remains unverified until the deployed seven-day timelock has elapsed.
## Browser wallet checkout update

The checkout page now uses an injected EIP-1193 provider to request the
configured token approval and the deployed escrow contract's `postBond`
transaction. Contract calldata is generated server-side from the deployed ABI
shape and the deterministic submission bond ID. The page checks chain `42431`,
waits for both receipts, and submits only the confirmed post transaction for
server verification. The server derives the payer DID from the verified
`BondPosted` contributor event rather than trusting a client-provided address.
This path is implemented but not live-tested here because no funded
Tempo-compatible browser wallet was available.
