# Runtime architecture and event flow

## Core modules

| Module | Responsibility | Must not do |
|---|---|---|
| `SubmissionService` | Creates submissions, state transitions, deadlines and policy snapshots | Move funds directly |
| `ReputationService` | Computes required bond from recorded outcome history and verified identity link | Accept reputation tier from a client |
| `BondProvider` | Wraps MPP session or escrow-contract mechanics | Decide whether content is Slop |
| `PaymentVerifier` | Validates MPP receipts or onchain token/contract events | Trust client assertions |
| `GitHubAppService` | Comments, checks, labels, repository/installation access | Treat a webhook payload as authentic before signature check |
| `MaintainerDecisionService` | Authorizes and records Valid/Slop decisions and reasons | Bypass policy, timelock or idempotency |
| `DeadlineWorker` | Finds overdue undecided bonds, enables or initiates reclaim/refund | Be the only mechanism that protects funds |
| `AuditService` | Creates append-only records of consequential actions | Rewrite historic decisions silently |

## Identity linking

Keep these identifiers separate:

- GitHub numeric user ID: stable account identifier for the submitting GitHub user.
- GitHub login: display-only, can change.
- MPP payer identity/DID (`Credential.source` where currently supported): payment identity from a verified credential.
- EVM address: wallet/address used by the selected bond mechanism if relevant.
- Surety contributor ID: internal database UUID.

Store an explicit, verified link between the internal contributor, GitHub numeric ID and payment identity. Never merge reputations solely because usernames are equal. The UI should explain what account is linked to a $0 tier.

## Bond provider interface

Create an application interface rather than coupling routes to one protocol:

```ts
export interface BondProvider {
  quote(input: QuoteInput): Promise<BondQuote>;
  createIntent(input: CreateIntentInput): Promise<BondIntent>;
  verify(input: VerifyBondInput): Promise<VerifiedBond>;
  refund(input: RefundInput): Promise<BondOperationResult>;
  flagForfeiture(input: FlagForfeitureInput): Promise<BondOperationResult>;
  settleForfeiture(input: SettleForfeitureInput): Promise<BondOperationResult>;
  reclaim(input: ReclaimInput): Promise<BondOperationResult>;
  status(input: BondStatusInput): Promise<BondStatus>;
}
```

Treat this as a design sketch. Adjust types and omit unsupported operations if the actual adapter semantics differ, but never weaken the product guarantees silently. If a selected mechanism cannot support one guarantee, update the UI and docs honestly or select the fallback.

## Transaction/state model

Application submission outcome and bond money status should be modeled separately.

Example:

```text
submission outcome: PENDING -> VALID | SLOP | IGNORED
bond status:        NONE -> CHALLENGED -> BONDED -> REFUND_PENDING -> REFUNDED
                                               \-> FORFEITURE_PENDING -> FORFEITED
                                               \-> EXPIRED / RECLAIMABLE -> REFUNDED
```

The state diagram is illustrative; use only transitions supported by the chosen mechanism. For session-native MPP, do not use `BONDED` if there is no verified, enforceable reservation of the bond amount. Use a more accurate label such as `PAYMENT_AUTHORIZED` or `SESSION_FUNDED` if that is what the primitive actually means.

## Failure handling

- If payment verification fails, do not unlock the submission.
- If the payment succeeds but the DB write fails, persist/reconcile from the receipt or chain event. Do not ask the contributor to pay twice.
- If a GitHub comment/check update fails, keep bond state correct and retry the GitHub side effect.
- If a refund transaction fails, show `Refund pending/failed` and provide retry/support instructions. Do not show refunded.
- If an event arrives late or twice, use idempotency keys and legal state-transition checks.
- If a contributor changes GitHub login, use numeric ID to preserve identity.
