# Worldmappin Companion V1 Plan

Worldmappin is a strong companion candidate because it adds an app-specific layer that Hive.blog does not provide: location-aware discovery, map pins, curated travel digests, and community/game-like travel activity. Banjo's v1 companion should focus on read-only public map/content workflows and avoid posting or account mutation until Worldmappin's API and auth model are understood.

## Current Signals

- DHF proposal #348 is active from 2025-06-16 through 2027-06-16, paying 195 HBD/day to `worldmappin`.
- Proposal subject: `Worldmapping 2.0 - Travel Guide, Hive Map Service, Quality Curation & Mobile App`.
- Worldmappin publishes frequent `Travel Digest` posts from the `hive-163772` community.
- Public posts link to Worldmappin post and user pages, which suggests stable frontend routes even before a formal API is confirmed.
- Worldmappin V2 messaging highlights map discovery, user profiles/maps, leaderboards, curated content, and future mobile/editor flows.

## Goals

- Help Discord users discover Hive travel content by place, author, and digest.
- Surface Worldmappin curation activity in a compact Discord-friendly form.
- Provide useful links back to Worldmappin map, post, user, and proposal pages.
- Keep v1 read-only and public-data-only.
- Reuse Banjo's existing Hive post, account, and proposal helpers where possible.

## Non-Goals For V1

- No Worldmappin login, posting, pin creation, edits, deletes, voting, or wallet actions.
- No attempt to replicate the full map UI inside Discord.
- No scraping-heavy dependency unless a stable public API cannot be found and the value justifies a narrow fallback.
- No location guessing from post prose unless the post already exposes reliable metadata or Worldmappin data.

## Candidate Commands

### `$worldmappin digest`

Show the latest Travel Digest:

- digest title and date
- winning posts/authors
- mentioned places when parseable
- pending payout and vote/comment counts
- links to Worldmappin, PeakD, and the proposal

Implementation fallback: read recent `@worldmappin` posts in `hive-163772` and match titles beginning with `Travel Digest`.

### `$worldmappin @account`

Show a public user map brief:

- Worldmappin profile link
- recent mapped posts
- countries/places if exposed by API
- leaderboard/rank/badge data if exposed by API
- latest Hive travel posts from `hive-163772` as a fallback

### `$worldmappin place <query>`

Search for mapped Hive posts around a place or region:

- place name
- recent/high-quality mapped posts
- authors and post links
- Worldmappin map/search link

This command depends on a confirmed Worldmappin public API or predictable search endpoint.

### `$worldmappin post <url|@author/permlink>`

Inspect a Hive post for Worldmappin context:

- whether it appears on Worldmappin
- Worldmappin post URL
- location/pin metadata if available
- curation/digest inclusion if known
- post payout, votes, comments, and frontend links

### `$worldmappin proposal`

Show DHF proposal #348 with Banjo's existing proposal formatter or a short companion-specific summary.

## Data Sources To Verify

- Worldmappin public API endpoints for pins, users, search, leaderboard, post lookup, and digest/curation data.
- Whether mapped posts include location metadata in Hive `json_metadata`, custom JSON, or Worldmappin's own backend.
- Frontend route stability for:
  - `https://worldmappin.com/`
  - `https://worldmappin.com/@<account>`
  - `https://worldmappin.com/p/<permlink>`
- Whether Travel Digest posts have consistent structure that can be parsed safely enough for summaries.
- Whether Worldmappin has rate limits or cache expectations.

## UX Shape

- Prefer an embed for a single digest/post/user result.
- Use a select menu for place search or digest results with multiple candidate posts.
- Include map/profile/post links prominently.
- Label data sources precisely: `Worldmappin`, `Hive RPC`, or `Hive RPC + Worldmappin`.
- Fall back gracefully to Hive community posts when Worldmappin-specific data is unavailable.

## Implementation Notes

- Start with the digest command if no API is available; it can be built from public Hive posts.
- Add a small Worldmappin API client only after endpoint shape is confirmed.
- Keep parsing conservative: extract explicit links and obvious winner sections, but avoid brittle natural-language location extraction in v1.
- Cache Worldmappin responses if endpoints are slower or rate limited.

## Parking Lot

- Pin creation helper with a signing link.
- Mobile deep links if Worldmappin publishes them.
- Weekly travel community digest.
- Leaderboard alerts or achievement cards.
- Location-based Discord prompts, such as "show me recent Hive posts near this city."
- Cross-app travel companion that includes Worldmappin, TravelFeed, Pinmapple history, and PeakD community pages.

## Next Decision

Before implementation, confirm whether Worldmappin has a stable public API. If not, v1 should be limited to `$worldmappin digest`, `$worldmappin proposal`, and post/profile links derived from public Hive data.
