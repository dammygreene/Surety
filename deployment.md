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

## Verified Moderato deployment

The current deployment is on Tempo Moderato (chain ID `42431`), not mainnet:

- Contract: `0x9eb4ffc29d5d5c636616225b3bb7d296ab5f8f95`
- Deployment transaction: `0x3314fe3e4ae81e0d8f45ae8fa05a32b0715ddb6cc81624ac8911906baf3dcf24`
- Token: `PathUSD`, `0x20c0000000000000000000000000000000000000`, 6 decimals
- Explorer: https://explore.testnet.tempo.xyz/address/0x9eb4ffc29d5d5c636616225b3bb7d296ab5f8f95

Deployment used a local Tempo/Viem signer and a transaction-level PathUSD fee token. Before any future broadcast, verify `eth_chainId == 42431`, read back the deployed token and triage addresses, and wait for a successful receipt plus non-empty bytecode. If address persistence fails, recover it from the receipt/transaction hash and write only the public address to `.env.local`; never print private keys.

The reproducible lifecycle command is:

```powershell
node --import tsx scripts/testnet-lifecycle.ts
```

It records public transaction hashes and intentionally reports Slop finalization as blocked until the configured 604800-second timelock. It must not be run against a mainnet RPC.

## GitHub App deployment

Set the GitHub App and OAuth variables from `.env.example` in the server
secret manager. Register `SURETY_PUBLIC_URL/auth/github/callback` as the
GitHub OAuth callback URL.
Create the webhook at `/api/webhooks/github`, use the raw-body HMAC secret,
install the App on a test repository, and require the `Surety Bond` Check Run
in branch protection or a ruleset. The local implementation uses SQLite for
the MVP; use durable storage and a separate worker before production. No live
GitHub installation was claimed in this milestone because credentials and a
disposable repository were unavailable.
