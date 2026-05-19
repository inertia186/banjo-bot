# Actifit Companion V1 Plan

Actifit is a strong companion candidate because it has a daily user workflow that maps well to Discord: track activity, publish a report, receive rewards, compare leaderboard position, and monitor AFIT/token/delegation status. Banjo's v1 companion should focus on public reports, eligibility context, and lightweight daily summaries rather than any fitness tracking or posting behavior.

## Current Signals

- Actifit has had multiple DHF proposal rounds: #250, #292, and #337.
- Proposal #337 ran from 2025-03-27 through 2026-04-15, paying 230 HBD/day to `actifit.funds`.
- Proposal subject: `Actifit Proposal #3 - Collabs, Development, Infra & Growth`.
- Actifit remains active across app, web, token, market, leaderboard, and yield/delegation surfaces.
- Public docs describe a minimum 5,000 activity count/steps threshold for reward eligibility.
- Public docs describe a minimum 5,000 AFIT balance requirement for AFIT rewards.
- Recent Actifit web updates mention reward endpoint hardening, signed auth tokens, rate limits, on-chain verification, and estimated reward endpoints.

## Goals

- Help Discord users understand their latest Actifit report status.
- Surface public activity reports, reward context, and useful Actifit links.
- Provide quick AFIT token, market, and delegation/yield context.
- Support community operators with leaderboard and recent-report summaries.
- Keep v1 read-only and public-data-only.

## Non-Goals For V1

- No activity tracking, mobile sensor integration, or health data ingestion.
- No posting Actifit reports, editing reports, voting, commenting, transfers, claiming, delegation, or market actions.
- No private Actifit account data unless a safe public endpoint exists and the user context is appropriate.
- No medical, fitness, or financial advice.
- No reward guarantees; Banjo should summarize documented/public eligibility signals only.

## Candidate Commands

### `$actifit @account`

Show a public account brief:

- Actifit profile link
- latest Actifit report
- activity count if parseable
- pending payout and post engagement
- AFIT balance via Hive Engine when available
- eligibility hints such as 5,000 activity count and 5,000 AFIT threshold

### `$actifit report <url|@author/permlink>`

Inspect an Actifit report post:

- activity count
- report date
- payout/reward window
- votes, comments, and beneficiaries
- Actifit profile and frontend links
- whether the report appears to meet the minimum activity threshold

### `$actifit leaderboard`

Show a daily or recent leaderboard if a stable public endpoint exists:

- top activity counts
- usernames and report links
- date/window
- Actifit leaderboard link

If no endpoint is available, do not scrape heavily; prefer a link-only fallback.

### `$actifit afit`

Show an AFIT token card:

- Hive Engine market link
- price/volume when available
- holder/staked context if available
- brief utility/reward note
- Actifit market and yield-farming links

### `$actifit yield <account>`

Show public delegation/yield context:

- HP delegated to `@actifit` if available
- Actifit yield-farming link
- top supporter/delegator context if exposed publicly

This should remain informational only.

### `$actifit proposal`

Show DHF proposal #337, plus prior proposals #292 and #250 when useful.

## Data Sources To Verify

- Actifit public API endpoints for profiles, reports, leaderboard, estimated rewards, delegators, and token/gadget state.
- Whether Actifit report activity count is consistently present in Hive post body or metadata.
- Hive Engine token endpoints for `AFIT` and related balances.
- Public profile route stability:
  - `https://actifit.io/<account>`
  - `https://actifit.io/activity/<...>` if available
- Current reward thresholds and whether they are endpoint-backed or documentation-only.

## UX Shape

- Use a compact embed for account, report, token, and proposal summaries.
- Use a select menu only for multiple reports or leaderboard rows that benefit from browsing.
- Label eligibility notes as hints, not guarantees.
- Include direct Actifit links before generic Hive frontend links for Actifit-branded commands.
- Use source footers such as `Actifit`, `Hive RPC`, `Hive Engine`, or combined labels.

## Implementation Notes

- Start with `$actifit report`, `$actifit @account`, and `$actifit afit`.
- Reuse existing Hive post parsing, Hive Engine token, and proposal helpers wherever possible.
- Keep report parsing conservative; if the activity count is not reliably parseable, show the report without making eligibility claims.
- Add leaderboard/yield only after public endpoint discovery.

## Parking Lot

- Daily reminder or digest for users who opt in.
- Weekly activity recap for a Discord community.
- Streak detection from historical report posts.
- AFIT reward estimation if public endpoint access is appropriate.
- Gadget/market summary.
- Splinterlands-card bonus context, if public and still current.

## Next Decision

Before implementation, confirm Actifit's public endpoint surface. If endpoint access is limited, v1 can still work from public Hive report posts, Hive Engine AFIT data, and Actifit profile links.
