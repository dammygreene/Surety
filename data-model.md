# Data model

Use migrations and foreign keys. Exact ORM is up to the existing repository; keep monetary and identity fields semantically equivalent to the model below.

## `projects`

- `id` UUID primary key
- `name`
- `slug` unique
- `github_installation_id` nullable until installed
- `default_bond_amount_base_units` string/decimal-safe value
- `token_address` and `token_symbol`
- `chain_id` integer
- `review_window_seconds` integer
- `triage_address`
- `require_surety_check` boolean
- `trusted_policy_json` validated JSON
- `slop_policy_markdown` or policy reference
- `active` boolean
- `created_at`, `updated_at`

## `repositories`

- `id` UUID primary key
- `project_id` foreign key
- `github_repository_id` numeric string, unique per GitHub repository
- `owner_login`, `repo_name` display snapshots
- `default_branch` nullable
- `active`
- `created_at`, `updated_at`

## `contributors`

- `id` UUID primary key
- `github_user_id` numeric string, indexed
- `github_login` display snapshot
- `payer_did` nullable, indexed where supported
- `wallet_address` nullable
- `identity_verified_at` nullable
- `created_at`, `updated_at`

Do not assume a GitHub login is stable. Enforce the appropriate unique/linking rules so one identity cannot silently claim multiple histories. Allow an explicit, verified relink process if supported.

## `submissions`

- `id` UUID primary key
- `project_id`, `repository_id` foreign keys
- `kind`: `pull_request`, `issue`, `security_report`, `manual_demo`
- `external_number` nullable
- `external_node_id` nullable
- `external_url` nullable
- `github_head_sha` nullable
- `github_author_id` nullable
- `contributor_id` nullable until identity link
- `title_snapshot` sanitized; for sensitive security reports, use private storage/reference
- `payload_hash` nullable
- `checkout_token_hash` nullable, unique; never persist the raw bearer token
- `checkout_token_expires_at` nullable
- `outcome`: `pending`, `valid`, `slop`, `ignored`
- `money_status`: adapter-specific explicit states such as `not_required`, `awaiting_payment`, `reserved`, `bonded`, `refund_pending`, `refunded`, `forfeiture_pending`, `forfeited`, `reclaimable`, `failed`
- `required_amount_base_units`
- `actual_amount_base_units` nullable
- `token_address`, `token_symbol`, `chain_id`
- `review_deadline_at`
- `decided_by_contributor_id` nullable
- `decision_reason` nullable; restrict access for private reports
- `decision_reason_hash` nullable
- `decided_at` nullable
- `settled_at` nullable
- `provider_type`: `mpp_session` or `escrow_contract`
- `provider_intent_id` nullable
- `provider_receipt_id` nullable
- `transaction_hash` nullable
- `contract_address` nullable
- `created_at`, `updated_at`

For GitHub PR natural identity, use repository ID + PR number/node ID + a generation/reopen policy. A PR reopen must not create a new funded submission silently. Security-report submissions need a unique generated ID and idempotency key.

## `bond_intents`

- `id` UUID
- `submission_id` foreign key, unique for active bond intent
- `provider_intent_id` nullable
- `nonce` or challenge reference unique
- `amount_base_units`
- `token_address`, `chain_id`
- `status`
- `expires_at`
- `created_at`, `consumed_at`

## `payment_events`

Append-only audit of protocol or chain events:

- `id` UUID
- `submission_id` foreign key
- `provider_event_id` unique/idempotent key
- `event_type`
- `amount_base_units` nullable
- `token_address`, `chain_id`
- `transaction_hash`, `receipt_reference` nullable
- `from_address`, `to_address` nullable
- `confirmation_status`
- sanitized `metadata_json`
- `occurred_at`, `recorded_at`

## `reputation_events`

Append-only and deterministic:

- `id` UUID
- `contributor_id` foreign key
- `submission_id` nullable foreign key
- `event_type`: `valid_settled`, `slop_finalized`, `ignored_refund`, `identity_linked`, `manual_correction`
- `source_event_id` unique where applicable
- `value_json`/reason
- `created_at`

Prefer deriving current tier from these events and storing a cached summary that can be rebuilt. Never alter past events silently.

## `github_installations`

- `id` UUID
- `github_installation_id` numeric string unique
- `account_id` numeric string
- `account_login`
- `account_type`
- `status`
- `created_at`, `updated_at`

## `webhook_deliveries`

- `id` UUID
- `provider` (`github` etc.)
- `delivery_id` unique per provider
- `event_type`
- `repository_id` nullable
- `payload_sha256`
- `processing_status`: `received`, `processing`, `processed`, `retryable_error`, `failed`
- `attempt_count`
- `last_error_safe` nullable
- `received_at`, `processed_at`

Do not store every raw webhook body indefinitely. If raw retention is needed for debugging, redact and expire it according to an explicit policy.

## `audit_events`

- `id` UUID
- `actor_type`: `maintainer`, `contributor`, `system`, `github`, `chain`
- `actor_id` nullable
- `project_id`, `submission_id` nullable foreign keys
- `action`
- `reason` nullable
- `before_state_json`, `after_state_json` sanitized
- `correlation_id`
- `created_at`

Append-only at the application layer. Avoid storing secrets, full report contents, or private keys in audit details.

## `jobs` (if a lightweight durable job queue is used)

- `id` UUID
- `kind`
- `dedupe_key` unique
- `payload_json` sanitized
- `status`, `attempt_count`, `run_after`, `last_error_safe`, `created_at`, `updated_at`

## Required database invariants

- A provider receipt/event is processed at most once.
- A GitHub delivery ID is processed at most once successfully.
- A submission has at most one active bond intent.
- Settled bonds cannot settle again.
- Bond amount and token are snapshotted at intent creation. Later project setting edits do not silently change an existing bond.
- All status transitions go through a central state-transition function with authorization checks.
- Store currency/token decimals and base units explicitly; do not use JS floating point.
