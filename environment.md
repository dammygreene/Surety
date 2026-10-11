# Environment configuration

Create `.env.example` with empty placeholders. Never commit real values. Validate required variables at startup and print actionable messages without printing their contents.

Names are proposed defaults; preserve the repository's existing names when equivalent and update this document to match the actual code.

## App

```bash
NODE_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_URL=http://localhost:3000
SESSION_SECRET=
DATABASE_URL=
LOG_LEVEL=info
```

Use a cryptographically random `SESSION_SECRET` for deployed environments. `NEXT_PUBLIC_APP_URL` may be public; secrets must never use `NEXT_PUBLIC_`.

## Tempo network

```bash
TEMPO_NETWORK=moderato
TEMPO_CHAIN_ID=42431
TEMPO_RPC_URL=https://rpc.moderato.tempo.xyz
TEMPO_EXPLORER_URL=https://explore.testnet.tempo.xyz
TEMPO_TOKEN_ADDRESS=
TEMPO_TOKEN_SYMBOL=
TEMPO_TOKEN_DECIMALS=6
```

Verify every network/token value against current official docs before filling the deployment environment. The values above reflect the original project spec and must be checked live. Do not ship with a blank token address or pretend an arbitrary symbol is a verified stablecoin.

If the contract fallback is selected:

```bash
SURETY_BOND_PROVIDER=escrow_contract
SURETY_ESCROW_ADDRESS=
SURETY_TRIAGE_ADDRESS=
```

If MPP session-native is selected, use only the environment variables the current SDK actually requires. Never add seed phrases or raw private keys to a client-visible variable. Prefer hosted wallet/provider tooling or an isolated test key in local development.

## MPP

```bash
SURETY_BOND_PROVIDER=mpp_session
MPP_REALM=surety.local
```

Additional MPP options depend on the currently installed SDK. Do not invent `MPP_*` configuration options. Document any required session store or channel key securely.

## GitHub App

```bash
GITHUB_APP_ID=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
GITHUB_APP_SLUG=
```

Use the exact auth flow implemented. Store the private key as a secret; normalize escaped newlines carefully at runtime. Never log private key material or install tokens.

## Optional operations

```bash
CRON_SECRET=
SENTRY_DSN=
```

A cron endpoint must require a strong secret or authenticated scheduler. Do not expose it as an unauthenticated public route.

## Startup validation

- Parse numeric chain ID and verify RPC response chain ID matches.
- Validate token and triage addresses.
- Validate required secrets as non-empty in deployment mode.
- Verify GitHub App setup and callback URLs.
- Report missing variable names, not values.
