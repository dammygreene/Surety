# Surety: refundable bonds for open submissions

Colosseum Crypto World's Fair, Tempo track. Working repo name: `surety`.

**One line:** To submit a bug report or pull request, you post a small stablecoin bond over HTTP 402. Valid work gets the bond back. Slop forfeits it. Silence refunds it. Trusted contributors post $0.

---

## 1. Problem (verified, Jan to Oct 2026)

- curl ended its HackerOne bug bounty on Jan 31 2026 after AI-generated reports pushed confirmed-vulnerability rates from about 15% to under 5%.
- HackerOne's Internet Bug Bounty paused new submissions on Mar 27 2026.
- Godot has 4,600+ open pull requests; Jazzband shut down; Ghostty bans AI-generated code; GitHub is weighing a pull-request kill switch.
- Bugcrowd lists "deposit systems" as a remedy, but I found no product that implements it.

The cost of producing a submission fell to about zero. The cost of reviewing one did not. Surety puts a price on the sender's side that honest senders get back.

## 2. Mechanism

States of a submission: `PENDING_BOND -> BONDED -> (VALID | SLOP | IGNORED) -> SETTLED`

| Outcome | What happens to the bond |
|---|---|
| VALID (maintainer accepts) | Refunded in full, plus any bounty the project pays |
| SLOP (maintainer flags) | Forfeited to the project's triage fund |
| IGNORED (no action in N days) | Auto-refunded; the sender is never cheated by silence |
| Trusted contributor | Bond is $0 (zero-dollar auth proves identity, no funds move) |
| Sponsored newcomer | A foundation or company stakes on the newcomer's behalf |

Reputation is keyed on the payer's identity (the Credential `source`, a `did:pkh:eip155:<chain>:<address>`). Each settled submission updates a contributor record. Good history lowers the required bond; slop history raises it.

## 3. Bond mechanics: decision D1 (spike in the first 2 hours)

**Option A (preferred if the spike passes): session-native bond.** In MPP's session flow, funds are reserved in a Tempo channel but not claimed. If the server never claims, they return to the client after expiry. If it claims a partial amount, the remainder returns. So a bond is a payment channel that is only claimed on misbehavior. Refund-by-default is built into the protocol, and no custom escrow is needed. Story for judges: "a bond is a payment channel nobody claims unless you misbehave."

**Option B (fallback): charge plus escrow contract.** In the charge flow, funds move to the server at once, and refunds are out-of-protocol (the server sends funds back to the Credential `source`). To avoid custody, write `Surety.sol`:
- `postBond(id, project, amount, expiry)`: pulls TIP-20 via `transferFrom`
- `release(id)`: project returns the bond to the sender
- `forfeit(id)`: project claims it; subject to a timelock so the sender can see why
- `reclaim(id)`: sender recovers after `expiry` if the project did nothing
- `sponsorPool`: sponsors fund bonds for newcomers

Foundry tests cover: double-post, wrong caller, forfeit before and after expiry, reclaim before and after expiry, sponsor accounting.

**Spike checklist for D1:**
1. Can the server claim a partial or zero amount on a `tempo.session` channel and let the rest expire?
2. Can the channel expiry be set per bond (for example 7 days)?
3. Does a browser-wallet flow exist for humans (push mode), or is session CLI/agent-only?
4. Can an MPP charge target a contract call (MPP supports generic EVM payments per its June 2026 post), or must the client call the contract directly?

## 4. Architecture

- **Surety API** (Hono or Next.js with `mppx` middleware): `/submit/intent` (zero-dollar auth to identify the sender and return the required bond), `/submit` (bond challenge, then accept the payload), `/review` (maintainer actions), `/reputation/:address`.
- **GitHub App**: on `pull_request.opened` and `issues.opened` from a non-trusted author, label `bond-pending`, comment with the bond link, and keep the item gated until the bond is posted. On merge, call `release`; on a "slop" label, call `forfeit`.
- **Security-report intake**: a form for vulnerability reports, same bond flow. This is the paying-customer wedge (bug-bounty programs).
- **Maintainer dashboard**: inbox of bonded submissions, one-tap Valid / Slop, triage-time saved, forfeits earned, refund queue (batched).
- **Agent surface**: CLI and MCP tool `submit_with_bond(project, payload)` so legitimate agents can contribute accountably.
- **Store**: SQLite or Postgres for submissions and reputation; chain is the source of truth for money.
- **Hooks**: use `onPaymentSuccess` to record the bond, the Receipt reference and the challenge id against the submission.

## 5. Tempo specifics (from the official docs)

- Testnet "Moderato": chain ID `42431`, RPC `https://rpc.moderato.tempo.xyz`, explorer `https://explore.testnet.tempo.xyz`, faucet gives test stablecoins.
- Mainnet RPC `https://rpc.tempo.xyz` (chain ID 4217).
- No native gas token; fees are paid in stablecoins. TIP-20 tokens have 6 decimals and ERC-20-style `approve`/`transfer`.
- OUSD on Tempo mainnet: `0x20c0000000000000000000006a37DA5C996874BE` (from the mppx docs).
- `mppx`: `tempo.charge({ currencies, recipient, testnet })`, push and pull modes, optional `feePayer` so the server sponsors gas for pull-mode clients.
- Test with `npx mppx validate <server>`, `npx mppx account create --network testnet`, `npx mppx account fund --network testnet`.
- Identity: `Credential.fromRequest(request).source` is the payer DID; zero-dollar auth uses a `proof` payload, no transaction.

## 6. MVP scope

**Must have**
1. 402 bond flow on testnet, then mainnet.
2. Bond lifecycle (valid, slop, ignored) working end to end for one repo.
3. Reputation tier: second submission by a good contributor requires $0.
4. Maintainer dashboard with one-tap actions.
5. Demo script and a public repo with tests.

**Cut** (mention as roadmap): token, arbitration court, multi-chain, fiat on-ramp, enterprise SSO, ML slop detection.

## 7. Demo (about 90 seconds)

1. A repo with Surety installed. An "AI slop agent" opens 20 pull requests; all are gated with `bond-pending`; it doesn't pay.
2. A real contributor opens a pull request, gets the 402, pays a $2 bond with one passkey tap; the item unlocks.
3. The maintainer reviews: one merge (bond refunded), one slop (bond forfeited to the triage fund).
4. The same contributor opens a second pull request: bond is $0 because reputation carries over.
5. Show the dashboard: triage time saved, forfeits earned, and the explorer links.

## 8. Judging map

- **Functionality:** live loop on Tempo, contract and server tests.
- **Impact:** a documented, acute problem with named victims, and a buyer (bug-bounty programs).
- **Novelty:** the bond as an MPP session that is only claimed on misbehavior; reputation-priced bonds.
- **UX:** one request to bond, one tap to refund, $0 for the trusted.
- **Open source:** public repo, MIT.
- **Business plan:** B2B intake for bug-bounty and security teams; a small share of forfeits; platform API.

## 9. Risks to be honest about

- Bonds can discourage first-time contributors. Mitigation: sponsored bonds, $0 for known contributors, small amounts.
- Maintainers could abuse forfeiture. Mitigation for v1: public forfeit log with reasons and reputation for projects; timelocked appeals on the roadmap.
- GitHub could ship its own gating. The portable reputation record is the defensible part.
- Whether companies will pay is unvalidated.

## 10. Stack

TypeScript, Hono, `mppx`, viem, SQLite, Next.js dashboard, Octokit (GitHub App), Foundry (only if Option B), Vercel or Railway free tier.

Repo layout: `apps/api`, `apps/dashboard`, `apps/github-app`, `packages/sdk`, `contracts/` (Option B), `docs/`.

## Sources

- https://tempo.xyz/docs/quickstart/connection-details
- https://mpp.dev/quickstart/server
- https://mpp.dev/advanced/refunds
- https://mpp.dev/advanced/identity
- https://mpp.dev/advanced/payment-hooks
- https://daniel.haxx.se/blog/2026/01/26/the-end-of-the-curl-bug-bounty/
