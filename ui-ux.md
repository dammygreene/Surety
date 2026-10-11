# UI/UX specification

## Product feeling

Surety should feel like a serious developer tool handling money fairly: calm, legible, predictable and auditable. The design should make users feel that the rules are clear and that neither the contributor nor the maintainer can silently change the record.

Avoid the generic AI-dashboard look: no giant gradient hero, floating glass cards everywhere, unnecessary glow, decorative 3D coins, oversized rounded pills, excessive shadows, or invented analytics. Use visual hierarchy and real product detail instead.

## Visual direction

- **Style:** restrained developer tooling with a light-first interface and a well-tested dark mode if time allows.
- **Palette:** warm off-white or very light neutral canvas, dark charcoal text, quiet slate borders, a single deep indigo/blue accent. Use green only for confirmed success/refund, amber for pending/needs attention, red for forfeiture/error. Status color is always paired with a text label and icon.
- **Typography:** use a highly legible sans-serif for UI and monospace only for IDs, addresses, hashes and technical metadata. Prefer one type family plus a mono companion.
- **Shapes:** small consistent radii, thin borders, modest shadows only for overlays. Avoid excessive capsule buttons.
- **Density:** compact enough for maintainer triage, spacious enough that financial decisions never feel cramped.
- **Motion:** brief and purposeful. Respect reduced-motion preferences. No animated balances or celebratory money effects.

## App shell

Desktop:

- Left navigation: Overview, Submissions, Contributors, Project settings.
- Top bar: current repository/program, testnet indicator, connected maintainer identity and account menu.
- Main content uses a readable max width. Dense lists can be full width within the shell.

Mobile:

- Collapse sidebar into a menu or bottom navigation only if it remains clear.
- Submission detail and decision controls stack vertically.
- Bond amount, deadline, network and current money status remain visible without horizontal scrolling.

## Required pages

### 1. Overview

Display only real values calculated from the database:

- Active submissions awaiting bond.
- Bonded submissions needing review.
- Submissions nearing/past deadline.
- Refunded and forfeited amounts, clearly labeled for the selected period and currency.
- Small recent-activity list.

If no data exists, show a useful empty state that guides the maintainer to install/configure the GitHub App. Do not show sample values as live metrics.

### 2. Submission inbox

Use a sortable table/list with:

- Repository and PR/report number.
- Contributor handle plus linked identity status.
- Required/current bond.
- Created time and deadline.
- Outcome and money status as distinct concepts.
- Last action.

Filters: All, Awaiting bond, Bonded, Needs decision, Refund pending, Refunded, Forfeiture pending, Forfeited, Ignored.

Use clear empty/loading/error states. Do not rely on color alone.

### 3. Submission detail

Order the page by the questions maintainers ask:

1. What is this submission? Repository, PR/report link, author, summary and timestamps.
2. What are the financial terms? Amount, token, network, deadline, fee if any, triage destination and whether funds are reserved, paid or held by a contract.
3. What has happened? Timeline of webhook receipt, challenge, bond verification, review decision and settlement.
4. What can I do? Mark Valid, mark Slop, or leave undecided. For Slop, require a reason and show the consequence and destination before confirmation.
5. What proves it? MPP receipt reference, contract address and explorer link if available.

For sensitive security reports, do not show private contents to users without authorization and do not put details into public comments.

### 4. Contributor checkout

Show before the action:

- Submission identity and repository/program.
- Requested amount and token.
- Network name, explicitly marked testnet during development.
- Why this contributor owes the displayed amount (new contributor, tier/rule, or $0 trusted tier).
- Valid refund, Slop forfeiture, review timeout and ignored-submission policy.
- Any timelock or delay before funds are released.
- A link to the full policy.

The primary action should accurately represent the next operation, e.g. `Pay $2 bond`, `Authorize bond`, `Connect wallet`, or `Continue with payment`. Do not label a session as a locked bond unless it has a verifiable lock/reservation guarantee.

For `$0` trusted users, clearly say `No bond required` and continue through identity authorization without requesting token approval or submitting a zero-value token transfer.

### 5. Contributors and reputation

Show the linked GitHub identity, verified payer identity in abbreviated form, settled outcomes, current tier, and a simple explanation of how the next bond is calculated. Offer a way to unlink/change identity only after re-verification, and explain that doing so can change reputation eligibility.

### 6. Project settings

Settings include:

- GitHub installation/repository status.
- Bond amount and accepted token.
- Review window and ignored default.
- Triage destination address.
- Forfeiture policy and any timelock.
- Trusted-contributor policy.
- Required status-check / repository rules setup.
- Network and token configuration.

Do not permit unsafe settings if the selected bond adapter cannot support them. Show validation errors next to the field.

## Interaction rules

- Irreversible or financially consequential actions use a confirmation dialog with amount, recipient/destination, reason and transaction type.
- Slop requires a reason. Do not prefill with a vague default.
- While chain settlement is pending, disable duplicate actions and show a transaction-pending state.
- After action, show outcome state separately from settlement state.
- Every transaction link opens the correct network explorer, never a mainnet explorer for testnet transactions.
- Copy buttons for address/hash show a temporary accessible confirmation.
- Forms preserve entered non-sensitive values after recoverable errors.
- Avoid toast-only critical updates. Show persistent inline status on the page.

## Accessibility

- Semantic headings, buttons, table structure and form labels.
- Full keyboard navigation and visible focus indicators.
- Sufficient color contrast in light and dark modes.
- Do not use color as the only status signal.
- Focus management for dialogs and error summaries.
- Respect prefers-reduced-motion.
- Make tabular money values readable by screen readers, and render amounts with an explicit currency/token.

## Responsive checks

At minimum inspect 360px, 390px, 768px, 1024px and 1440px widths. Verify that tables transform or scroll accessibly, dialogs fit short screens, wallet/action controls remain visible, and no page causes unexpected horizontal overflow.
