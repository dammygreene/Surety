# GitHub App integration

## Purpose

Connect Surety to one real repository for the MVP. GitHub is the submission and collaboration surface; Tempo/MPP is the bond and settlement surface; Surety joins their identities and lifecycle.

## Permissions

Use the least-privilege permissions needed for the chosen features. A likely starting point is:

- Metadata: read-only.
- Pull requests: read/write only if Surety must comment or manage labels/checks; use the narrowest available permissions.
- Issues: read/write only if adding comments/labels or accepting issue submissions.
- Checks: write if creating Check Runs for merge gating.
- Contents: none unless a demonstrated feature needs it.

Verify the current GitHub App permission matrix before registering the app. Do not request broad repository administration permission for convenience.

## Webhook handling

- Subscribe only to required events: pull request opened/closed/reopened/synchronize as needed; issue opened/closed as needed; installation and repository changes as needed.
- Validate `X-Hub-Signature-256` over the exact raw request bytes with constant-time comparison.
- Require a known `X-GitHub-Delivery`, event header and valid JSON after signature check.
- Store delivery ID with a unique constraint before running side effects.
- If duplicate, return success without posting duplicate comments or re-running payments.
- Treat untrusted webhook fields as data after signature validation. Validate type and required IDs.
- Avoid logging complete webhook payloads when they contain private or irrelevant content.

Official docs to check live:
- Webhook events and payloads: https://docs.github.com/en/webhooks/webhook-events-and-payloads
- Building an app that responds to webhook events: https://docs.github.com/en/apps/creating-github-apps/writing-code-for-a-github-app/building-a-github-app-that-responds-to-webhook-events
- Building CI checks with a GitHub App: https://docs.github.com/en/apps/creating-github-apps/writing-code-for-a-github-app/building-ci-checks-with-a-github-app

## PR workflow

1. Receive `pull_request.opened`.
2. Resolve installation, repo numeric ID, PR number, node ID, author numeric ID and head SHA.
3. Create or get the corresponding Surety submission. Make handling of reopen/rebase/synchronize events explicit.
4. If the required bond is nonzero, add `bond-pending` label if allowed, create a check that remains pending/failing, and add one comment with the checkout URL and policy summary.
5. The comment must explain the purpose and amount, link to the Surety terms, and never expose security report content or payment secrets.
6. On verified bond, update check and comment to `bonded`/eligible.
7. On a maintainer decision and final settlement, update the check/comment if relevant.

## Merge gating truth

Surety cannot stop users from opening an issue or PR. To gate merge, Surety must publish a required status check/Check Run and the repository owner must configure branch protection or a repository ruleset to require it. The onboarding UI must give exact setup guidance and verify what it can, or clearly state when gating is not configured.

Do not claim the repo is merge-gated merely because a label or comment was added.

## Checkout link safety

- Use a high-entropy random token; store only a hash.
- Bind token to project, repo ID, submission ID, intended author ID, required amount, token/network snapshot and expiration.
- Make it short-lived and single-use where compatible with retries; support retry without allowing replay to another submission.
- Authenticate the contributor before showing report details or allowing payment.
- Never put wallet secrets, MPP credentials or transaction authority inside the URL.
- Do not allow changing the amount, recipient or submission ID via client request after challenge creation.

## Comment idempotency

Store the GitHub comment ID and last content version. On retries, update the existing comment where possible instead of posting another. Include a hidden marker or durable mapping so a preexisting Surety comment can be found safely. Do not remove unrelated user comments.

## Security-report privacy

Private reports may contain unpatched vulnerabilities. Use private access-controlled storage and a separate permission model. Public GitHub comments should reveal only that a report was received and its Surety status, never its exploit details. Avoid storing report contents onchain; store a hash or opaque reference only when useful.
