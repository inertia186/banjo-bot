# Ecency Companion V1 Plan

Banjo's Ecency companion should start as a public content/search helper, not a private account dashboard. Historically, most Ecency content behavior overlaps with Hive.blog and other Hive frontends; the v1 value is Ecency-adjacent infrastructure, especially Hivesearcher, plus Discord-friendly summaries of public Hive content.

## Goals

- Use Ecency/Hivesearcher as a faster content discovery layer when it is available.
- Help Discord users find, summarize, and share Hive content without opening a full frontend first.
- Keep the first version read-only and public-data-only.
- Link back to Ecency where the result benefits from an Ecency surface, but avoid pretending ordinary Hive data is Ecency-exclusive.

## Non-Goals For V1

- No Ecency login, key handling, voting, posting, commenting, transfers, or account mutation.
- No private Ecency notifications, drafts, schedules, bookmarks, chats, or wallet data.
- No Ecency Points, Boost+, Promote, or referral actions unless a public read-only API is confirmed.
- No replacement for the existing general `$search`, `$latest`, `$top`, `$calcreward`, or account commands unless the Ecency path is clearly better.

## Candidate Commands

### `$ecency search <query>`

Search Hive content through Hivesearcher or an Ecency search endpoint, then return compact Discord results with author, age, community/tag, payout when available, and frontend links.

Useful filters to explore:

- `author:<account>`
- `tag:<tag>`
- `community:<hive-...>`
- `after:<date>` / `before:<date>`
- `type:post|comment`

### `$ecency post <url|@author/permlink>`

Show an Ecency-oriented post card for a public Hive post:

- title, author, age, payout window, pending payout
- comments, votes, reblogs when available
- community and tags
- Ecency, PeakD, and Hive.blog links

This may be mostly shared with existing Hive post helpers; only make it Ecency-specific if the Ecency link/search path adds value.

### `$ecency author <account>`

Show a public author brief:

- latest posts
- recent comments/replies
- pending author rewards
- reputation, RC, voting power, follower/following counts when available
- profile links

Keep this scoped to public chain/indexer data.

### `$ecency community <query|hive-...>`

Find or summarize a Hive community:

- title, account id, subscribers, activity when available
- recent posts
- unanswered or low-engagement posts if search supports it
- links to Ecency community pages

## Data Sources To Verify

- Hivesearcher public API shape, limits, sort modes, and CORS behavior.
- Ecency SDK direct request helpers for Node usage outside React.
- Existing Banjo Hive RPC and HiveSQL search coverage, to avoid duplicating weaker behavior.
- Whether Ecency exposes public read-only Points, Boost+, Promote, or profile metadata endpoints.

## UX Shape

- Prefer an embed with a select menu when search returns multiple good matches.
- Include one-click frontend links, with Ecency first only when the command is explicitly Ecency-branded.
- Use a plain footer such as `Ecency / Hivesearcher` only when the data actually came from that service.
- Fall back to existing Hive search or HiveSQL behavior when the Ecency search service is unavailable.

## Parking Lot

- Authenticated Ecency companion: notifications, drafts, schedules, bookmarks, chats, points, boosts, wallet, and promotions.
- Daily creator digest built from public Hive data plus optional authenticated Ecency data later.
- Cross-frontend comparison links for posts and communities.

## Next Decision

Before implementation, decide whether this should become a new `$ecency` command namespace or an upgrade path for the existing `$search` command with an Ecency/Hivesearcher-backed adapter.
