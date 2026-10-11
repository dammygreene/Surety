# Deployment guide

## Environments

Keep separate `development`, `testnet/demo`, and `production` environments. The initial hackathon deployment should use Tempo Moderato and test funds only.

## Runtime requirements

- Node.js runtime for current MPP libraries, GitHub SDK and secure webhook processing.
- Persistent Postgres database in any deployment where ephemeral filesystem storage is not guaranteed.
- Public HTTPS URL for GitHub webhook callbacks and contributor checkout links.
- A durable scheduled job or worker for deadline scanning and reconciliation, plus a contributor reclaim path where supported.
- Secrets available at runtime through the host's environment/secret manager.

Vercel can work for stateless Next.js routes if the selected SDK and request duration fit its runtime limits. Do not assume it can run a long-lived worker or durable scheduler. Run workers separately or use a scheduler that triggers a protected job. Test real webhook retries and database persistence on the chosen host.

## Deploy steps

1. Add required variables from `environment.md` to the deployment host.
2. Configure Postgres and run migrations.
3. Configure the selected testnet chain/RPC and verify chain ID at startup.
4. Verify supported token address and decimals against official Tempo docs/faucet; never default to an unchecked address.
5. Deploy the app and confirm health endpoint is live.
6. Register/update GitHub App webhook URL and secret. Subscribe only to required events.
7. Install the GitHub App on the test repository.
8. Configure GitHub branch protection/ruleset to require Surety's check if merge gating is part of the demo.
9. Fund test accounts from the current official faucet.
10. Run the end-to-end acceptance test and record explorer links.
11. Check logs for secret redaction and ensure database backups/retention are understood.

## Startup checks

Fail closed or show a configuration error if:

- Network chain ID does not match configured chain ID.
- Required token address is unset/invalid.
- Required escrow contract address is missing when fallback is selected.
- GitHub App credentials are partially configured.
- Production secrets are missing.

Do not print full credentials in startup logs. Public status may show network name, short token/contract address and build version only.

## Recovery

- Provide a protected reconciliation job/CLI that checks pending payment intents against provider/chain state.
- Make retries idempotent.
- Document how to recover a payment that settled while a DB transaction failed.
- Back up Postgres and test a restore before a production launch.
- Never use a manual database edit to claim money was refunded or forfeited.
