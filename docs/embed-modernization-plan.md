# Discord Embed Modernization Plan

This plan covers commands whose output is easier to scan as Discord embeds, following the direction already established by `$help` and `$token`.

The goal is not to turn every response into an embed. Short confirmations, plain links, retired-service notices, one-line jokes, and code-block diagnostics should stay lightweight. Embeds should be reserved for structured data, result lists, external resources with metadata, and outputs where Discord fields, thumbnails, footers, or components materially improve readability.

## Current Baseline

`$help` is the interaction baseline:

- Uses `EmbedBuilder` plus buttons and select menus.
- Deduplicates aliases before rendering.
- Groups commands by category.
- Keeps focused command help as a single card.
- Has tests for embed shape, components, custom emoji labels, and alias behavior.

`$token` is the data-card baseline:

- Returns a directory embed when no symbol is given.
- Supports multiple embeds for up to three requested symbols.
- Handles mixed success and warning notes with `{ content, embeds }`.
- Uses title, URL, description, thumbnail, footer, and inline fields.
- Keeps native Hive/HBD and Hive Engine token semantics visibly separate.

Future embed ports should reuse those ideas rather than each command inventing its own response grammar.

## Shared Embed Conventions

Add a small shared helper module before porting many commands, likely `src/commands/embeds.ts`.

Recommended helpers:

- `banjoEmbed(options)`: standard color, optional author/footer, timestamp policy if wanted later.
- `dataField(name, value, inline = true)`: skips empty values and centralizes backtick/formatting expectations.
- `linkField(name, label, url)`: consistent external link fields.
- `accountUrl(account)`, `postUrlField(post)`, `hiveEngineUrl(symbol)`: avoid repeating link formats.
- `truncateEmbedText(value, limit)`: centralize safe Discord limits for descriptions, fields, and select descriptions.
- `asEmbedResponse(embed, content?)`: keeps command return types easy to read.

Visual conventions:

- Use orange/Banjo color for general bot surfaces.
- Use Hive icon/thumb for native Hive/HBD account and chain data.
- Use Hive Engine footer/icon for Hive Engine token/NFT data.
- Treat footers as source/context labels, not decoration. Prefer the actual data source or subsystem when it is meaningful, such as Hivemind for community data.
- When the source is not obvious from Banjo's adapter alone, check the sibling Hive source repos before choosing the footer label. In particular, `/Users/anthony/Projects/hive/hive` is useful for hived API/plugin names, while `/Users/anthony/Projects/hive/hivemind` and `/Users/anthony/Projects/hive/hive_sql` can clarify social/community and HiveSQL-backed data.
- Prefer inline fields for metrics and normal fields for lists.
- Put primary external URLs in `setURL` when the whole card has one obvious destination.
- Put warning notes in `content` above embeds when a multi-result request has partial failures.

Footer source map:

- `Hivemind Communities`: community lookup and community social metadata exposed through `bridge.*` methods, backed by Hivemind.
- `Hive Engine`: Hive Engine token, NFT, market, richlist, and staking data from Hive Engine contract RPC.
- `SCOT + Hive Engine`: SCOT social token data combined with Hive Engine market/order-book data.
- `HiveSQL`: SQL reports and discovery data from the HiveSQL adapter.
- `Hive Market`: native Hive/HBD market data currently queried through condenser-compatible market/feed calls.
- `Hive Chain`: general hived chain state. Use this for chain-derived summaries when the exact API plugin is less useful to users than the subsystem.
- `Hive Governance`: witness/proposal approval views, especially when they combine condenser-compatible calls and `database_api` proposal vote data.
- `Hive Account History`: account-history-derived reports such as first post or reward operation scans.

The sibling Hive repo documents useful hived API plugin names: `condenser_api` is legacy Steem-compatible, `database_api` is the modern structured chain-state API, `account_history_api` is account transaction history, `wallet_bridge_api` is bridge-style wallet/content support, and `market_history_api` is DEX market data. Prefer user-meaningful labels over raw plugin names unless the plugin name explains the result better.

Testing conventions:

- Assert `typeof response === "object"` and inspect `embeds[0].toJSON()`.
- Assert title, description, key fields, footer, thumbnails, and mixed `content` behavior.
- Keep service mocks at the command boundary.
- Keep string tests for non-embed fallbacks.

## Priority 0: Infrastructure

Status: done. `src/commands/embeds.ts` now exists with `banjoEmbed`, `dataField`, `asEmbedResponse`, and `truncateEmbedText`. `test/commands.test.ts` has a local `embedJson(response, index = 0)` helper. `$help` and `$token` were intentionally left out of any wholesale refactor because their current behavior is stable and well-covered.

1. Done: add `src/commands/embeds.ts`.
2. Deferred: move duplicated token/help-safe text truncation into shared helpers only if future edits touch those commands anyway.
3. Done: add a tiny test helper in `test/commands.test.ts` or a new test utility for `embedJson(response, index = 0)`.
4. Done: do not refactor `$help` wholesale; it has interaction-specific behavior.
5. Deferred: optionally migrate `$token` to shared helpers during a future token-specific change.

Acceptance criteria:

- Existing `$help` and `$token` tests still pass.
- New helper tests cover empty-field skipping and truncation.
- No command behavior changes except embed formatting for intentionally ported commands.

## Priority 1: Best Embed Candidates

These commands already return structured data and should be modernized first.

### `$community`

Current shape: title line, URL, long description, subscribers, pending rewards, active authors, created time, avatar URL.

Status: done. `$community` now returns a single embed response with title, URL, description, thumbnail, owner/subscriber/reward/author/created fields, and a Hivemind Communities footer. Missing-community and usage fallbacks remain plain text.

Embed plan:

- Title: community title.
- URL: Hive trending community URL.
- Description: about plus truncated description.
- Thumbnail: community avatar.
- Fields: owner, subscribers, pending rewards, active authors, created.
- Footer: Hivemind Communities, because community lookup data is backed by Hivemind.

Why first: it naturally maps to a card and has an avatar.

### `$badge`

Current shape: title line, PeakD URL, about text, recipients, subscribers, created time, avatar URL.

Status: done. `$badge` now returns a single embed response with title, PeakD URL, about description, Hive avatar thumbnail, creator/recipient/subscriber/created fields, and a PeakD Badge footer. Missing-badge and HiveSQL-disabled fallbacks remain plain text.

Embed plan:

- Title: badge profile name.
- URL: PeakD badge URL.
- Description: profile about.
- Thumbnail: Hive avatar URL.
- Fields: creator, recipients, subscribers, created.
- Footer: PeakD Badge.

### `$badges`

Current shape: heading plus a list of badge links.

Status: done. `$badges` now returns a compact single embed with a search-aware title, badge links in the description, and a result-count footer. HiveSQL-disabled and no-result fallbacks remain plain text.

Embed plan:

- Title: Latest Badges or search-specific title.
- Description: optional query context.
- Fields or description list: up to 10-15 badge links with creators.
- Footer: result count.

Keep as a compact list card rather than one embed per badge.

### `$xkcd`

Current shape: title, image URL, optional safe title, spoilered alt text.

Status: done. `$xkcd` now returns an image embed with the comic title, canonical xkcd URL, comic image, and optional safe-title description. Alt text follows in a second small embed as spoilered text. Usage and unknown-comic fallbacks remain plain text.

Embed plan:

- Title: `xkcd #<num>: <title>`.
- URL: `https://xkcd.com/<num>/`.
- Image: comic image URL.
- Description: safe title only when different.
- Footer: alt text is tricky because spoilers do not work in embed footer; keep alt as spoiler text after the comic.

Implemented response: `{ embeds: [comicEmbed, altEmbed] }` when alt exists.

### `$nft`

Current shape: NFT symbol, dTools URL, name, supply, description, metadata URL.

Status: done. `$nft` now returns one Hive Engine NFT embed per requested symbol, with dTools URL, metadata description, name/supply/metadata fields, and Hive Engine NFT footer. Missing-symbol and unknown-NFT fallbacks remain plain text.

Embed plan:

- Title: symbol plus issuer.
- URL: dTools NFT URL.
- Description: metadata description.
- Fields: name, circulating supply, metadata link.
- Footer: Hive Engine NFT.
- Thumbnail: metadata icon if available later; current API type may only expose description URL.

### `$nftsr`

Current shape: art title/artist, gallery URL, collection, note, created time.

Status: done. `$nftsr` now returns an NFT Showroom embed with gallery URL, art description, art image, artist avatar thumbnail, note, artist/collection/created fields, NFT Showroom footer, and Previous/Next buttons for owner/index navigation. Missing and unpublished fallbacks remain plain text.

Embed plan:

- Title: art title.
- URL: NFT Showroom gallery URL.
- Description: art description.
- Fields: artist, collection, created.
- Footer: NFT Showroom.
- Image: art image from NFT Showroom API, with artist avatar thumbnail.

### `$fear`

Current shape: index title, site URL, image URL, recent entries, next update.

Status: done. `$fear` now returns a single embed with title, Alternative.me URL, dated index image, recent entry fields, next-update field when available, and an Alternative.me footer. Usage and API-unavailable fallbacks remain plain text.

Embed plan:

- Title: Crypto Fear & Greed Index.
- URL: Alternative.me index page.
- Image: dated fear/greed image URL.
- Fields: today, yesterday, previous entry, next update.
- Footer: Alternative.me.

### `$ticker`

Current shape: HIVE/USD price, feed, 24h change, volume, market cap.

Status: done. `$ticker` now returns a Hive Market Ticker embed with CoinGecko URL, Hive thumbnail, HIVE/USD, feed, 24h, volume, and market-cap fields, plus a CoinGecko + Hive feed footer. Chain and unavailable-data fallbacks remain plain text.

Embed plan:

- Title: Hive Market Ticker.
- URL: Hive market or CoinGecko Hive page.
- Thumbnail: Hive token icon.
- Fields: HIVE/USD, feed, 24h, volume, market cap.
- Footer: CoinGecko + Hive feed.

### `$feed`

Current shape: price or APR/policy summary.

Status: done. `$feed` now returns embeds for both price and APR/policy branches, with feed/policy fields and a Hive feed footer. Chain and unknown-type fallbacks remain plain text.

Embed plan:

- Price card fields: median, market median, low, high.
- APR card fields: HBD interest rate, print rate, start reducing, stop printing.
- Footer: Hive feed.

### `$supply`

Current shape: current HIVE, virtual HIVE, current HBD.

Status: done. `$supply` now returns a Hive Supply embed with current HIVE, virtual HIVE, and current HBD fields, plus a Hive dynamic global properties footer. Chain fallback remains plain text.

Embed plan:

- Title: Hive Supply.
- Fields: current HIVE, virtual HIVE, current HBD.
- Footer: Hive dynamic global properties.

### `$witness`

Current shape: witness owner, URL, votes, version.

Status: done. `$witness` now returns a Hive Witness embed with HiveHub witness URL, account avatar thumbnail, version/votes/missed-blocks/signing-key fields, and a Hive Witness footer. Non-witness fallback remains plain text.

Embed plan:

- Title: witness account.
- URL: HiveHub witness page.
- Fields: votes, running version, signing key if currently shown, price feed if added later.
- Footer: Hive Witness.

### `$proposal`

Current shape: proposal title/status, URL, creator/receiver, dates, funding/votes.

Status: done. `$proposal` now returns one Hive DHF Proposal embed at a time, with PeakD proposal URL, approval status, discussion-link preview description/image from the proposal post, creator/receiver, dates, pay, vote, voter, and partial-funding fields. Multi-match results page through Previous/Next buttons across up to 10 selected proposal IDs. Missing proposal fallback remains plain text.

Embed plan:

- Title: proposal subject or ID.
- URL: proposal page.
- Description: status summary.
- Fields: creator, receiver, daily pay, total votes, start/end, funding status.
- Footer: Hive DHF Proposal.

This is a high-value port because proposals are dense and benefit from a clean card.

### `$approval`

Current shape: account approval report with witness/proposal groups.

Status: done. `$approval` now returns a Hive governance embed with account URL, avatar thumbnail, proxy status when applicable, witness votes, active proposal groups, approved daily pay, and upcoming proposal groups.

Embed plan:

- Title: approvals by account.
- URL: account page.
- Description: proxy state when applicable.
- Fields: witness votes, proposal approvals, grouped proposal IDs.
- Footer: Hive governance.

## Priority 2: Structured Lists And Tables

These should become embeds after the simple data cards are done. Some currently rely on code blocks because table alignment matters, so modernize carefully.

### `$richlist`

Status: done. `$richlist` now returns a Hive Engine embed with dTools richlist URL, token thumbnail, linked ranked balances, null-balance field, and the existing RPC truncation warning as a note field. Native-token and unknown-token fallbacks remain plain text.

Embed plan:

- Title: top balances by token.
- URL: dTools richlist.
- Description: ranked balances as a concise numbered list.
- Fields: token, count, null balance, truncation note.
- Footer: Hive Engine.

Preserve the truncation warning from the current response.

### `$staked`

Status: done. `$staked` now returns a Hive Engine embed with token thumbnail, linked ranked stakers, total-stake/result fields, and the existing RPC truncation warning as a note field. Unknown-token and no-stake fallbacks remain plain text.

Embed plan:

- Title: top stakers by token.
- Description: ranked account links with stake and percentage.
- Fields: total stake, result count, truncation note.
- Footer: Hive Engine.

### `$tt2x`

Status: done. `$tt2x` now returns a SCOT + Hive Engine embed with history URL, trade link, token thumbnail, last price, pending-payout, actual-yield, final-depth price, and final-yield change fields. Unknown-token, empty-trending, missing-trade, and empty-buy-book fallbacks remain plain text.

Embed plan:

- Title: top trending to exchange for symbol.
- URL: Hive Engine history URL.
- Description: trade link plus summary.
- Fields: last price, average pending payout, sum pending payout, actual yield, price at final yield, change at final yield.
- Footer: SCOT + Hive Engine.

### `$rewards`

Status: done. `$rewards` now returns embeds for native HIVE rewards and SCOT token rewards, with account URLs, account/token thumbnails, timeframe descriptions, grouped reward-category fields, totals, HIVE conversion when available, and source footers. It intentionally avoids CoinGecko lookups; USD-equivalent values are derived from the Hive feed price. Unknown-account and no-reward fallbacks remain plain text.

Embed plan:

- Title: rewards for account and asset.
- Description: timeframe.
- Fields: producer/staking, interest/mining, curation, author, benefactor, total, HIVE, USD, USD/day.
- Footer: native Hive or SCOT token depending on branch.

### `$distribution`

Status: done. `$distribution` now returns a HiveSQL embed with the existing precise markdown distribution table in the description and active-account/inactive-stake fields. HiveSQL-disabled, usage, and no-match fallbacks remain plain text.

Embed plan:

- Keep the aligned markdown table unless field layout proves more readable.
- Add an embed title, description, and footer around the table if Discord renders it more cleanly.
- Fields: active accounts, inactive stake, days.
- Treat mobile readability as an explicit tradeoff: markdown tables are awkward on narrow screens, but they preserve exact bucket comparison better than scattered fields.
- Consider a later mobile-friendly summary card that groups buckets into small, mid-tier, and large stake bands, without replacing the precise table unless the grouped view proves clearly better.

This may stay partly code-block based inside an embed description.

### `$hardfork`

Status: done. `$hardfork` now returns a Hive Chain embed with current version, witness-majority version, last/next hardfork field, and the existing top-100 witness version vote table in a markdown code block. Chain fallback remains plain text.

Embed plan:

- Title: Hive Hardfork Status.
- Fields: current version, witness majority, next/last hardfork.
- Description or field: top witness version vote table.
- Footer: top 100 witnesses.

Keep the table if it remains the clearest representation.

### `$search`

Status: done. `$search` now returns one expanded Hive Search Results embed per result, with post URL/title/link, author/created/query/tag/timeframe fields, result-count footer, and Previous/Next buttons backed by a short-lived in-memory result cache. HiveSQL-disabled, usage, empty-result, and too-many-result fallbacks remain plain text.

Embed plan:

- Title: Hive Search Results.
- Description: query, tags, timeframe.
- Fields/list: author links.
- Footer: result count.

Do this only after deciding how to handle large author/link lists without exceeding embed limits.

### `$promoted`

Status: done. `$promoted` now returns a HiveSQL embed with yesterday/today promoted totals and promoted post links in the description. Chain and HiveSQL-disabled fallbacks remain plain text.

Embed plan:

- Title: Promoted Posts.
- Description: timeframe and token totals.
- Fields/list: top promoted posts.
- Footer: count.

### `$top`

Status: done. `$top` now returns a HiveSQL post embed with post URL, author avatar thumbnail, hydrated post description/image preview, result kind, timeframe, score, and reply keywords when applicable. Validation and HiveSQL-disabled fallbacks remain plain text.

Embed plan:

- Title: top post query.
- URL: post URL if a result exists.
- Description: post title/author.
- Fields: payout, votes, created, app/tag context depending on available data.
- Footer: HiveSQL.

### `$app`

Status: done. `$app` now returns a HiveSQL embed with ranked app payout rows, timeframe, and result-count fields. HiveSQL-disabled and invalid-limit fallbacks remain plain text.

Embed plan:

- Title: app payout summary.
- Description: since date.
- Fields/list: app names and payout totals.
- Footer: HiveSQL.

### `$nodes`

Status: done. `$nodes` now returns a Hive Developer Portal embed with source URL, linked public-node list, owner labels when available, and node-count field.

Embed plan:

- Title: Hive Public Nodes.
- Description: best/known node list.
- Fields: node URL, owner, status/version if available in service data.
- Footer: source URL.

If the current node output is already compact, keep the first pass conservative.

## Priority 3: Account And Chain Summary Cards

These are useful as embeds, but many are short enough that they are less urgent.

- `$rep`: done. Account embed with HiveHub stats URL, avatar thumbnail, and reputation field.
- `$power`: done. Account embed with HiveHub stats URL, avatar thumbnail, Hive Power and voting power fields.
- `$mvests`: MVEST conversion card; for account batches use fields or stay text if too compact.
- `$proxy`: done. Account embed with HiveHub stats URL, avatar thumbnail, and witness proxy field.
- `$follows`: done. Account embed with HiveHub stats URL, avatar thumbnail, followers and following fields.
- `$claims`: done. HiveSQL embed with timeframe, claim count, unique accounts, and reward totals.
- `$accounts`: done. HiveSQL embed with total, mined, community, and badge counts.
- `$inflation`: done. Hive Chain embed with projection table and year-count field.
- `$rewardpool`: done. Hive Chain embed with reward balance, recent claims, and curation reward percentage fields.
- `$calcreward`: done. Direct `@author/permlink` calls use a post embed with hydrated preview, pending payout, and reward-pool ratio fields. Direct URL calls and follow-up URL calls stay as compact text so they do not add a second unfurl.
- `$age`: done. Post embed with title/url, author account link, created UTC, relative age, and author avatar thumbnail.
- `$latest` and `$first`: reviewed and kept as plain links. They already hand Discord a canonical post URL, which preserves native unfurl behavior without duplicating post preview logic.

## Keep As Plain Text Or Attachments

These commands should not be embed modernization targets unless their behavior is later expanded:

- `$ping`, `$make`, `$sudo`, `$donut`, `$roll`, `$snark`.
- `$register`, `$upvote`, `$verify`, `$version`, `$slap`, `$catfact`, `$voting`, `$play`, `$disconnect_voice`, `$stats`, `$payout`, `$flagwars`, `$regex`, `$poll`, `$mod`, `$woodwork`, `$investors`, `$predict`, `$bidbots`, `$trail`, `$carousel`, `$alexa`, `$ego`, `$say`, `$dilbert`.
- Static links: `$banjo`, `$faq`, `$welcome`, `$whitepaper`, `$tools`, `$github`, `$releases`, `$scam`, `$password`, `$watch`, `$pancake`, `$popcorn`, `$music`, `$lmgtfy`, `$wolframalpha`, `$avatar`, `$latest`, `$first` if kept link-only.
- Static local images: `$bandwagon`, `$headphones`, `$ricky!`, `$kappa`, `$hydrogen`.
- `$poke`: keep JSON code block; embeds do not improve raw operation diagnostics.
- `$scottags`: keep code block unless it grows richer metadata.

`$fallacy` and `$mempool` are optional. `$fallacy` could become a tiny card, but the current two-line response is already readable. `$mempool` could become a link card if chart image handling is added.

## Implementation Phases

### Phase 1: Foundation And Simple Cards

Commands:

- `$community`
- `$badge`
- `$badges`
- `$xkcd`
- `$fear`

Tasks:

1. Add shared embed helpers.
2. Convert one command at a time.
3. Add focused tests for each embed shape.
4. Run `npm test` and `npm run check`.

Status: done. Phase 1 commands now return embed objects for their success paths, with focused tests and passing `npm test` / `npm run check`.

Exit criteria:

- Five commands return embed objects.
- All previous string fallback behavior remains tested.
- Shared helper shape feels stable enough for market and Hive cards.

### Phase 2: Market, Token-Adjacent, And NFT Cards

Status: done. Phase 2 commands now return embeds for their success paths, while chain, usage, unknown-token, unpublished, and missing-data fallbacks remain plain text.

Commands:

- `$ticker`
- `$feed`
- `$supply`
- `$nft`
- `$nftsr`

Tasks:

1. Reuse `$token` visual conventions for Hive/Hive Engine related cards.
2. Normalize thumbnail/footer handling.
3. Keep native Hive assets distinct from Hive Engine assets in labels and URLs.
4. Add tests for missing data branches.

Exit criteria:

- Market and NFT command outputs have clear card layouts.
- No API semantics change.
- Existing `$token` tests remain unchanged or only gain helper-backed assertions.

### Phase 3: Governance And Account Cards

Status: done. Governance and account summary commands now use consistent account URLs, avatar thumbnails, source footers, and tested field layouts.

Commands:

- `$witness`
- `$proposal`
- `$approval`
- `$power`
- `$rep`
- `$proxy`
- `$follows`

Tasks:

1. Prioritize governance commands with dense information.
2. Add account URL helpers.
3. Keep proxy and unknown-account responses simple.
4. Test canonical account labels and field names.

Exit criteria:

- Governance results are readable without markdown walls.
- Account summary cards are consistent.

### Phase 4: Ranking, Tables, And Long Lists

Status: done. Long-list and table-heavy commands now use embeds where they improve scanning, preserve code-block tables where exact alignment matters, and keep warnings visible.

Commands:

- `$richlist`
- `$staked`
- `$tt2x`
- `$rewards`
- `$distribution`
- `$hardfork`
- `$search`
- `$promoted`
- `$top`
- `$app`
- `$nodes`

Tasks:

1. Decide per command whether a code block inside an embed is clearer than fields.
2. Add safe truncation before any command can approach Discord embed limits.
3. Preserve all current warning notes, especially truncated Hive Engine balance warnings.
4. Test result limits and empty-result branches.

Exit criteria:

- Long result commands do not exceed Discord limits.
- Existing table data is not made less readable.
- Partial data and truncation warnings remain visible.

### Phase 5: Polish And Consistency Pass

Status: backlog. The command-by-command modernization work is complete; remaining items are consistency and maintenance cleanup rather than required embed ports.

Tasks:

1. Review all embed titles for consistent command/account/symbol naming during future command touch-ups.
2. Review all URLs and footers for accurate data source labeling when sources change.
3. Confirm mobile readability opportunistically, especially for table-like embeds.
4. Remove duplicated formatting helpers only after behavior is covered by tests.
5. Update `docs/api-notes.md` only when a modernization exposes an API behavior detail, not for cosmetic changes.
6. Consider a shared component-navigation helper for `$help`, `$search`, `$nftsr`, and `$proposal` once at least one more paginated command needs nontrivial polish.

Navigation lessons from `$proposal`:

- Always acknowledge component interactions quickly with `deferUpdate()` or an immediate ephemeral response.
- For slow page transitions, visibly replace active controls with a disabled loading state before doing API/database work. Discord does not expose a true long-running pulse, so the loading component is the practical feedback.
- Cache the page set and per-page expensive details for short windows. Navigation should not refetch every list, vote set, post preview, or SQL aggregate when the user is only moving between already-selected pages.
- Treat rapid clicks as normal. Old buttons can still produce overlapping interactions before the loading edit is visible to every client.
- Add a small recovery path: if a refresh fails after showing loading controls, restore basic Previous/Next controls and tell the clicker to try again instead of leaving the message stuck.
- Keep stale or expired component behavior humble. A brief ephemeral note is better than editing the public embed into an error state.
- Do not overfit this into a framework yet. `$help` is fast enough today, while `$proposal` needed loading feedback because it can wait on Hive RPC and HiveSQL.

Future `$proposal` idea: related treasury transfers

- People can donate HIVE/HBD to the DHF treasury account. On Hive this is `hive.fund`; historically, during the Steem-to-Hive transition, proposal/treasury activity may reference `steem.dao`.
- Some transfers to `hive.fund`, `steem.dao`, or the configured treasury account may be proposal-related returns or donations, but they are not protocol-level proposal payments.
- If this is added, keep it separate from `Payment Result` and proposal accounting. Use a label such as `Related Treasury Transfers`, not `Returned Pay`, unless the memo explicitly identifies the proposal.
- Conservative scan scope: transfers from the proposal creator or receiver, during the scheduled proposal window plus a short grace period after the end, to `hive.fund`, `steem.dao`, or the configured treasury account.
- Show timestamp, sender, recipient, amount, memo excerpt, and block/transaction link when available.
- Do not subtract these transfers from actual paid totals unless a later design adds an explicitly labeled net-after-related-transfers line.

## Completed Work Order

All planned command reviews are complete.

1. Done: `$community`
2. Done: `$badge`
3. Done: `$badges`
4. Done: `$xkcd`
5. Done: `$fear`
6. Done: `$ticker`
7. Done: `$feed`
8. Done: `$supply`
9. Done: `$nft`
10. Done: `$nftsr`
11. Done: `$proposal`
12. Done: `$approval`
13. Done: `$witness`
14. Done: `$richlist`
15. Done: `$staked`
16. Done: `$tt2x`
17. Done: `$rewards`
18. Done: `$hardfork`
19. Done: `$distribution`
20. Done: `$search`
21. Done: `$promoted`
22. Done: `$top`
23. Done: `$app`
24. Done: `$nodes`
25. Done: `$power`
26. Done: `$rep`
27. Done: `$proxy`
28. Done: `$follows`
29. Done: `$claims`
30. Done: `$accounts`
31. Done: `$inflation`
32. Done: `$rewardpool`
33. Done: `$calcreward`
34. Done: `$age`
35. Done: `$latest` / `$first` review; kept as plain links to preserve Discord native unfurls.

This order started with high-confidence card conversions, then moved into commands where list length, table alignment, or truncation rules needed more care.

## Resolved Decisions

- Embed timestamps: skipped for now. Command data already has explicit relative or UTC dates where needed.
- Components beyond `$help`: added only where a real browse/filter workflow exists, such as `$nftsr`, `$proposal`, and `$search`.
- `$latest` and `$first`: kept as plain links to preserve Discord native unfurls.
- `$xkcd` alt text: kept spoilered after the comic in a follow-up embed.
- Code-block tables inside embeds: used command by command where exact alignment remains clearer, such as `$distribution`, `$hardfork`, and `$inflation`.
- Markdown tables on mobile: accepted as a tradeoff for precise table output; add grouped summaries later only where they improve scanning without hiding important detail.

## Polish Backlog

- Audit embed titles, URLs, and footers after any future source/API changes.
- Consider extracting more account/post/link helpers if a future refactor touches `$help`, `$token`, or the older command formatters.
- Consider extracting a shared paginated-component helper if another embed develops `$proposal`-level latency or race handling needs.
- Consider a carefully labeled `$proposal` related-treasury-transfers section for donations/returns to `hive.fund` or historical `steem.dao`.
- Revisit table-heavy embeds only if Discord mobile readability becomes a practical problem.
