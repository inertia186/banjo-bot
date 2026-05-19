# Holozing Companion V1 Plan

Holozing is a strong companion candidate because it has a Splinterlands-like shape: game account, token balances, collection assets, rewards, marketplace links, and project updates. V1 should be read-only and conservative because the game is still staged and Holozing explicitly prohibits botting or gameplay automation.

## Current Signals

- Holozing is a Hive-backed monster-catching, training, and battling game with Web3 ownership and a web2-accessible game path.
- DHF proposal #361 ran from 2025-11-27 through 2026-01-26, paying 450 HBD/day to `zing.fund`.
- Proposal subject: `Holozing Dev & HAF NFTs`.
- The proposal covered game development, dev/artist backpay, HAF NFT tracker work, and overhead into early 2026.
- Holozing posts indicate collection rewards for creatures and items are live, with hourly ZING split between unopened vials, opened creatures/items, achievements, HP delegations, and staking rewards.
- Public updates describe ties between backend, Hive Engine, and game state, including opened vials becoming NFTs and game/backend updates.

## Goals

- Give Discord users a quick Holozing account/token/status summary.
- Surface ZING balances, staking, market, and reward-related public data.
- Link users to Holozing game, whitepaper, community posts, marketplace, and proposal pages.
- Summarize latest official Holozing updates from Hive.
- Keep all v1 behavior read-only and non-gameplay.

## Non-Goals For V1

- No gameplay automation, battle assistance, encounter automation, or bot-like interaction.
- No signing, claiming, staking, unstaking, transfers, marketplace orders, or NFT moves.
- No private account state unless Holozing exposes a safe public endpoint.
- No promises that alpha/beta/gameplay features are live unless verified at runtime.
- No collection valuation beyond simple public token/market data unless a reliable source is available.

## Candidate Commands

### `$holozing @account`

Show a public account brief:

- Hive profile link
- ZING liquid/staked balance via Hive Engine
- HP delegation to Holozing-related accounts if practical
- public Holozing profile link if stable
- recent Holozing community posts by the account
- collection/reward links if public APIs expose them

### `$holozing zing`

Show a ZING token card:

- token metadata
- market price and 24h volume if available
- liquid/staked supply if available
- Hive Engine / market links
- staking or reward notes from official docs/posts

### `$holozing collection <account>`

Show collection status if a public API exposes account assets:

- unopened vials
- opened creatures/items
- rarity/foil/radiant summary
- collection reward weight when available
- Holozing marketplace/profile links

If no public API exists, this command should remain unimplemented rather than scrape brittle frontend state.

### `$holozing update`

Show the latest official Holozing updates:

- latest posts by `@holozing` and/or `@zingtoken`
- title, date, short summary, and links
- highlight proposal/gameplay/token/reward posts

### `$holozing proposal`

Show DHF proposal #361 using Banjo's existing proposal formatter or a short companion-specific summary.

## Data Sources To Verify

- Holozing public API endpoints for account profile, collection, vials, creatures, items, rewards, and marketplace data.
- Hive Engine token and balance endpoints for `ZING` and staked balances.
- HAF NFT tracker availability and whether Holozing assets are queryable through it.
- Holozing frontend route stability for account, asset, marketplace, and game links.
- Official community/account sources:
  - `hive-131131`
  - `@holozing`
  - `@zingtoken`
  - `@zing.fund`

## UX Shape

- Mirror the Splinterlands command pattern where it fits: overview, rewards/token, collection.
- Use select menus only when there are real sections backed by reliable data.
- Include a clear data freshness note for project/update summaries.
- Label sources precisely: `Hive Engine`, `Hive RPC`, `Holozing`, or combined labels.
- Avoid language that implies Banjo can play, optimize, or automate Holozing.

## Implementation Notes

- Start with `$holozing zing`, `$holozing update`, and `$holozing proposal`; these rely mostly on existing Banjo infrastructure.
- Add account/collection sections only after public API discovery.
- Reuse existing Hive Engine token, richlist, and staked balance helpers if possible.
- Consider a shared "game companion" pattern only after Holozing and Splinterlands have enough overlap to justify it.

## Parking Lot

- Collection weight calculator from pasted asset summaries.
- Marketplace watch summaries.
- New creature/item reveal notifications.
- Holozing release-status digest.
- HAF NFT tracker integration.
- Player profile cards once gameplay/account state is public and stable.

## Next Decision

Before implementation, confirm whether Holozing has a stable public account/collection API. If not, v1 should be limited to ZING token status, official update summaries, and proposal context.
