# Reference links

These links are starting points only. Verify current docs and package versions at implementation time.

## User-provided original specification

- Original Surety brief: [`SPEC.md`](./SPEC.md)

## Tempo and MPP

- Tempo connection details: https://tempo.xyz/docs/quickstart/connection-details
- MPP quick start: https://mpp.dev/quickstart/server
- MPP session intent: https://mpp.dev/intents/session
- MPP charge intent: https://mpp.dev/intents/charge
- MPP refunds: https://mpp.dev/advanced/refunds
- MPP identity: https://mpp.dev/advanced/identity
- MPP payment hooks: https://mpp.dev/advanced/payment-hooks
- MPP security best practices: https://mpp.dev/advanced/security
- Current MPP server SDK `verifyCredential` reference, which advises using `broadcastCredential` for new integrations: https://mpp.dev/sdk/typescript/server/Mppx.verifyCredential
- MPP general docs: https://mpp.dev/

## GitHub

- Webhook events and payloads: https://docs.github.com/en/webhooks/webhook-events-and-payloads
- Build a GitHub App that responds to webhooks: https://docs.github.com/en/apps/creating-github-apps/writing-code-for-a-github-app/building-a-github-app-that-responds-to-webhook-events
- Build CI checks with a GitHub App: https://docs.github.com/en/apps/creating-github-apps/writing-code-for-a-github-app/building-ci-checks-with-a-github-app

## Notes

- `Tempo Moderato` chain ID `42431`, RPC `https://rpc.moderato.tempo.xyz`, and explorer `https://explore.testnet.tempo.xyz` are taken from the original spec and must be confirmed against the live official Tempo connection page during the spike.
- The original spec listed OUSD on Tempo mainnet as `0x20c0000000000000000000006a37DA5C996874BE`. Do not use a mainnet address for Moderato or assume the asset is faucet-supported without checking official docs.
