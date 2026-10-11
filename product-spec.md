# Product specification

## 1. Summary

**Surety** is an accountability layer for open submissions. A project can ask a contributor to post a small stablecoin bond before a submission is considered eligible for review/merge workflows. Accepted work receives a full refund. A maintainer may classify a submission as low-quality/spam and initiate forfeiture under a published policy. If the maintainer does nothing within the configured review window, the default outcome is refund. Contributor reputation can reduce the required bond to zero.

## 2. Problem and target users

### Problem

AI-assisted generation has lowered the cost of creating large numbers of bug reports, pull requests and security submissions, while human review still has a meaningful cost. A blanket block or ban also harms genuine first-time contributors.

### Primary users

- **Maintainers:** need fewer low-value submissions and a clear, auditable triage queue.
- **Contributors:** need a fair process, clear bond rules and confidence that silence will not confiscate their money.
- **Security programs:** need a structured intake with accountability, evidence handling and transparent payout/refund policies.
- **Sponsors/foundations:** can sponsor a newcomer bond later so the price does not exclude useful contributors.

## 3. Product promises

1. Every required bond amount and decision policy is shown before payment.
2. Valid outcomes return the full bond.
3. Silence after the stated deadline defaults to refund.
4. A forfeiture is never automatic model output. A maintainer must choose the outcome and supply a reason.
5. Contributor reputation is deterministic and inspectable.
6. Payment claims are server-verified and traceable to a receipt or chain transaction.
7. First-time contributors can be sponsored in a later release; the MVP does not pretend the bond is universally accessible.

## 4. MVP use cases

### PR bond

- A configured GitHub repository receives a pull request.
- Surety creates a pending submission record and posts a one-time checkout link.
- Until bonded, a Surety check can remain pending/failing. Merge gating works only if the repository rules require the check.
- After bond verification, Surety updates the check and comment.
- A maintainer can mark Valid or Slop in the dashboard. A merge event may be mapped to Valid if the repo's configured policy explicitly says so.

### Security-report intake

- A program uses a Surety form or unique intake URL.
- The report contents are stored privately offchain. Only a hash/reference and necessary metadata are committed onchain.
- The contributor posts a bond, unless the contributor is in a trusted tier.
- Maintainer resolution follows the same valid/slop/ignored lifecycle.
- Never publish vulnerable details in public GitHub comments or onchain data.

### Reputation

- Contributor identity is linked to a stable GitHub numeric user ID and verified MPP payer identifier.
- Settled outcomes update the contributor record.
- MVP rule: one settled Valid outcome and zero Slop outcomes yields a `$0` bond tier for the same linked contributor, subject to project policy.
- The dashboard shows the reason for the tier and previous outcomes.

## 5. Required submission state model

Persist outcome and money status separately if needed, so an outcome can be decided while a timelocked settlement is still pending.

### Product lifecycle labels

- `PENDING_BOND`: created, but the required bond has not been verified.
- `BONDED`: payment/reservation is verified and attached to the submission.
- `VALID`: maintainer accepted the work or a configured valid trigger fired.
- `SLOP`: maintainer flagged the submission and supplied a reason.
- `IGNORED`: the review window elapsed without a decision.
- `SETTLED`: the money outcome is complete, with a refund or forfeiture recorded.

### Money states

Use explicit values appropriate to the chosen adapter, for example: `NOT_REQUIRED`, `AWAITING_PAYMENT`, `RESERVED`, `CLAIMED`, `REFUND_PENDING`, `REFUNDED`, `FORFEITURE_PENDING`, `FORFEITED`, `EXPIRED`, `FAILED`. Do not imply reserved funds are an onchain escrow unless the chosen protocol actually provides that guarantee.

## 6. Default configuration for demo

- Bond: `$2.00` equivalent, configurable per repository/program.
- Review window: 7 days, configurable.
- Currency: one supported test TIP-20 stablecoin on Moderato, address held in configuration.
- Valid action: full bond refund.
- Slop action: documented forfeiture flow to a configured triage fund; if the selected contract uses a timelock, the UI shows `Forfeiture pending` until settlement completes.
- Ignored action: refund/reclaim after the deadline, with no maintainer approval required where the selected mechanism allows it.
- Trusted tier: after one settled Valid outcome and no Slop outcomes, the same verified contributor requires `$0` for the demo.

## 7. Out of scope

Do not build for MVP:

- A token or token sale.
- Multi-chain bonds.
- Fiat on-ramp/off-ramp.
- An arbitration court or full appeal system.
- ML or LLM-based automated slop scoring.
- Enterprise SSO.
- A fully decentralized reputation oracle.
- A generalized bug bounty marketplace.
- A large sponsor pool with complex accounting.

## 8. Business model hypothesis

Potential future revenue includes a platform subscription for security programs, a per-submission or per-settlement platform fee, and API access for larger projects. A share of forfeitures is mentioned in the original concept but should not become the primary incentive; it would create a conflict of interest. Do not add a hidden fee to the bond. Keep the MVP transparent, and validate willingness to pay with real maintainers before claiming product-market fit.

## 9. MVP success signals

Measure actual application events, not fabricated metrics:

- Submissions received and percentage that post a bond.
- Median time to resolution.
- Valid vs Slop vs Ignored outcomes.
- Amount refunded vs forfeited.
- Repeated contributor rate and count of contributors who qualify for `$0`.
- Duplicate webhook/payment events safely ignored.

Do not claim triage time saved unless the product measures review time or a customer provides a grounded comparison.
