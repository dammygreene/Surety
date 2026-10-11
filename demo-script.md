# 90-second Surety demo

## Setup before recording

- Deploy Surety to a stable URL or confirm the local URL.
- Ensure a real GitHub test repository is installed.
- Fund the test contributor with the supported Moderato test token.
- Prepare one non-trusted contributor, one authorized maintainer and one trusted contributor identity or history that has earned the `$0` tier.
- Have explorer links and app views ready in tabs, but do not fake transactions.
- Use a short review window in the dedicated demo project if needed, labeled as demo-only configuration.
- Confirm all shown values come from real persisted state and real testnet/provider evidence.

## Run of show (about 90 seconds)

### 0-10 seconds: the problem

"AI made it almost free to produce submissions. It didn't make reviewing them free. Surety adds a small refundable commitment, and rewards contributors who build a record of useful work."

Show the Surety inbox and the policy in one sentence.

### 10-25 seconds: a real submission is gated

Open a real test PR in GitHub. Show the `bond-pending` state, Surety check, and checkout comment. Explain that the repo must require the Surety check for merge gating.

### 25-40 seconds: post the bond

Open the checkout link. Show `$2`, the network/token, deadline, refund default and forfeiture policy. Complete the actual testnet flow. Show the verified bond state with a receipt or transaction link.

### 40-55 seconds: maintainer decision

In the dashboard, mark a bonded submission Valid and show the refund operation moving to a confirmed/verified state. If using the contract fallback timelock for Slop, briefly show a second submission with a reason and `Forfeiture pending`, not a false instant settlement.

### 55-70 seconds: reputation changes the economics

Open a second submission from the same linked contributor. Show that the required bond is `$0` because a previous Valid outcome settled and the policy's eligibility conditions are met. Confirm no token transfer was requested.

### 70-82 seconds: ignored means refund

Show a submission whose review deadline has expired and invoke/verify the real reclaim path. Explain the critical rule: silence should not give the maintainer indefinite control over the contributor's funds.

### 82-90 seconds: close

"Surety is not an AI judge. It is an accountability and reputation layer for open contributions. The bond discourages low-cost spam; the refund default and zero-dollar trust tier protect good contributors."

## If the native MPP path fails

Use the tested escrow-contract fallback and say plainly that funds are held by a testnet escrow contract. Do not tell judges the session-native path works if it did not pass the spike.

## Backup demo

If GitHub webhook delivery is unreliable during a live session, use a previously created real testnet submission in the dashboard and open the corresponding GitHub PR/explorer link to verify it. Do not use local seeded “paid” records. Label any fixture data in the UI.

## Evidence to capture

- GitHub PR URL.
- Surety submission detail URL.
- Real MPP receipt or testnet transaction URL.
- Refund/forfeiture event or contract transaction.
- Second submission showing verified `$0` policy.
- Test results and known limitations.
