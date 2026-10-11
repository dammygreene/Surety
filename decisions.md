# Decisions and assumptions

This document keeps product decisions explicit. Do not silently change them during implementation.

## Locked product decisions

1. Product name is **Surety**; repo name may be `surety`.
2. Product is refundable stablecoin bonds for open submissions, not invoice finance, a trading tool, or a generic payment proxy.
3. Valid submissions get their full bond back.
4. Silence after the stated review window defaults to a refund/reclaim.
5. Slop forfeiture requires an explicit authorized maintainer decision and a reason.
6. Trusted contributors can post `$0` after meeting the disclosed, deterministic policy.
7. The first live integration is one GitHub repository, with PRs as the integration demo and security-report intake as the target paying-customer wedge.
8. Tempo Moderato testnet first; no mainnet funds are needed for the hackathon demo.
9. No token, ML slop scoring, multi-chain, fiat on-ramp, enterprise SSO or arbitration court in the MVP.
10. The app must show authentic receipt/transaction evidence and never pretend a mock payment is real.

## Initial demo defaults

- Default bond: `$2.00` equivalent.
- Review timeout: seven days in normal demo configuration; a short timeout may be used only in a clearly labeled demo project to prove the flow quickly.
- Trusted policy: after one settled Valid submission and zero Slop outcomes, the same linked contributor qualifies for `$0` in the MVP demo.
- One supported test TIP-20 token, address verified against current official Tempo docs/faucet and configured explicitly.

All defaults remain configurable per project; they are not immutable protocol rules.

## Open technical decision: bond provider

**Do not decide by preference. Decide from the spike.**

- Preferred if proven: session-native MPP, because it can make unclaimed funds and expiry central to the product narrative.
- Fallback: TIP-20 escrow contract with release, timelocked forfeiture and expired reclaim.
- Required evidence: `tempo-mpp-spike.md` and `docs/technical-spike.md`.

## Assumptions that must be tested

- MPP session semantics can represent a bond rather than ordinary pay-as-you-go charges.
- Expiry and refund behavior match the stated default-refund promise.
- A browser contributor can perform the intended flow without developer-only tooling.
- MPP identity proof can be safely associated with GitHub numeric identity.
- Maintainers understand and accept a small bond as a way to reduce low-value submissions.
- A security-report intake program will pay for the workflow. This is a business hypothesis, not validated demand.

## Important implementation caveats

- GitHub cannot prevent opening PRs/issues. Surety can comment, label, create checks, and gate merge if the project configures a required check.
- A GitHub `merged` event can be treated as Valid only when the project explicitly configures that policy; do not assume all merged PRs meet every bond/refund rule.
- Session/provider terminology must match verified semantics. If funds are not truly locked/reserved, do not label them “bonded” in a way that overstates guarantees.
- The original spec says identity uses `Credential.source`; verify this is the supported current API and only trust it after credential validation.
- The MPP server docs currently recommend `broadcastCredential` for new integrations and mark `verifyCredential` as deprecated alias. Use current API guidance.
- A forfeiture proceeds to the configured triage destination; any platform fee or share of forfeitures must be separately disclosed and should be avoided in the hackathon MVP if it creates incentive conflicts.

## Decision log template

Add dated entries below when the spike forces a choice:

- `YYYY-MM-DD`: Decision: ...
- Evidence: docs/package version/test name/receipt link.
- Alternatives considered: ...
- Consequences and remaining limitations: ...
