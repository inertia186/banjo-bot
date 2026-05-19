# Hive API Notes

These notes capture behavior discovered while porting Banjo commands. They are intentionally practical: when two Hive APIs can answer a similar-looking question, this file records which one matched the command semantics and which traps we found.

## Working Rule

- Use `bridge` for current app-facing content lists.
- Use `condenser_api` or `account_history_api` for exact chronological account operations.
- Use dedicated APIs when they are exposed by the node, but keep compatibility fallbacks for public nodes.
- Use HAFBE for explorer-style indexed facts, block search, account/witness derived views, and historical lookups only when the endpoint semantics match the command exactly.
- Do not infer post creation from permlink lists unless the endpoint explicitly returns creation operations rather than latest or representative permlink operations.

## Public Node Compatibility

Public nodes do not all expose the same plugin APIs.

Observed example:

- Local Hive source documents `reputation_api.get_account_reputations`.
- `https://api.hive.blog` and `https://api.deathwing.me` returned `Could not find API reputation_api`.
- `condenser_api.get_account_reputations` works as the compatibility path.

Banjo should normalize this in adapters so commands do not need to know which plugin answered.

## Command Notes

### `$rep`

Do not use `condenser_api.get_accounts` for reputation. On current public nodes it returned `reputation: 0` for real accounts, which formats as the neutral `25.00`.

Use:

```text
reputation_api.get_account_reputations
```

with fallback to:

```text
condenser_api.get_account_reputations
```

The fallback should exact-match the requested account because the API returns a sorted page beginning at `account_lower_bound`.

### `$latest`

Use:

```text
bridge.get_account_posts
```

with:

```json
{
  "sort": "posts",
  "account": "<account>",
  "limit": "<offset + 1>"
}
```

This returns recent root posts with app-facing URLs. Normalize any returned Steemit URL to `https://hive.blog`.

### `$first`

The real semantic is:

> First unique root post creation by this author, ignoring later edits to the same permlink.

HAFBE's `comment-permlinks` endpoint was tempting but wrong for this command. It returned permlink records newest-first and, for at least one account, represented a permlink by a later edit operation rather than the original creation operation.

Observed for `r0nd0n`:

- HAFBE returned `crowdsource-the-bandwidth` at `2017-06-03T03:24:18`.
- Raw account history showed the creation operation for the same permlink at `2017-06-02T22:42:33`.

Use account history scanning instead:

```text
condenser_api.get_account_history
```

Scan from the beginning, look for `comment` operations where:

- `author` is the requested account.
- `parent_author` is empty.
- `permlink` has not been seen before.

The first unique match is offset `0`, the second unique match is offset `1`, and so on.

This is accurate because edits are also `comment` operations, and duplicate permlinks must not count as new posts.

### `$age`

The command accepts `@author/permlink` or a Hive/Steemit-style URL. Use:

```text
condenser_api.get_content
```

and read the content object's `created` field, not `last_update`.

Observed for `@inertia/profile`: `get_content` returned the post with `created: 2018-05-17T22:54:00`, while sampled account-history scans did not expose the root `comment` creation op. This also avoids a slow full-history miss on high-activity accounts.

If `get_content` does not return an exact `author`/`permlink` match, fail fast. Do not search account history for `$age`: a Steemit URL can point to content that was created after the Hive fork and therefore does not exist on Hive. In that case Hive's missing content response is the correct answer, and history scanning only adds latency.

Public nodes may report missing content as an RPC error instead of an empty content object. Observed for a post-fork Steemit URL:

```text
Assert Exception:Post <author>/<permlink> does not exist
```

Legacy Ruby Banjo defaulted missing or `^` slug inputs to the latest `@author/permlink` observed in the Discord channel via `Cosgrove::latest_steemit_link[event.channel.name]`. The TypeScript ports currently require an explicit post reference until channel link memory is rebuilt.

Treat that as a normal not-found result for `$age`.

### `$mvests`

Use dynamic global properties:

```text
condenser_api.get_dynamic_global_properties
```

Calculate the value of one MVEST with the same formula used by `/Users/anthony/Projects/hive/hive-ticker-widget`:

```text
total_vesting_fund_hive / (total_vesting_shares / 1_000_000)
```

For the full command breakout:

```text
1MV = 1M VESTS = <hive_per_mvest> HIVE = <hbd_per_mvest> HBD = $<usd_per_mvest>
```

Use:

```text
condenser_api.get_feed_history
```

for `current_median_history`, then calculate:

```text
(base / quote) * hive_per_mvest
```

for the HBD value. Use CoinGecko's simple price endpoint for the HIVE/USD market leg.

With account arguments, `$mvests <account ...>` sums each exact account's effective vesting stake:

```text
vesting_shares + received_vesting_shares - delegated_vesting_shares
```

Then it converts that MVEST total through the same HIVE, HBD, and USD ladder. The Ruby bot also accepted multiple accounts and had tests around bad account names.

Wildcard account arguments are backed by optional HiveSQL configuration. Exact account names continue to use Hive RPC. Patterns containing `*` or `%` are expanded through HiveSQL's `Accounts` table, capped by `HIVESQL_WILDCARD_LIMIT`, and then resolved through the normal RPC `get_accounts` path for current balances. This keeps the wildcard search indexed while avoiding duplicated stake math against SQL column drift.

The widget uses `database_api.get_dynamic_global_properties` and `database_api.get_feed_history`, where assets are structured objects. Banjo currently uses the public-node-friendly `condenser_api` equivalents, where assets are strings like `123.456 HIVE`, `123.456789 VESTS`, and `0.063 HBD`.

### `$delegate`

The Ruby command used HiveSQL's `Delegations` table for both sides of an account:

```sql
SELECT [delegator], SUM([vests])
FROM [Delegations]
WHERE [delegatee] = @account
GROUP BY [delegator]
```

and the inverse query for outgoing delegations. The TypeScript port keeps the same dependency because public Hive RPC exposes account-level delegated totals but not a compact "who delegated to whom" listing.

`$delegate <account>` shows incoming and outgoing delegation summaries. `$delegator <account>` shows incoming only, and `$delegatee <account>` shows outgoing only. Like the Ruby bot, details are shown only when there are 50 or fewer rows; larger result sets get a summary total to avoid oversized Discord messages.

### `$delegated`

The Ruby command searched historical `delegate_vesting_shares` operations, then resolved delegatee accounts and reported accounts whose received delegation met a minimum MVESTS threshold. The TypeScript port uses HiveSQL's current `Delegations` table instead:

```sql
SELECT [delegatee], SUM([vests]), COUNT(DISTINCT [delegator]), MIN([delegator])
FROM [Delegations]
GROUP BY [delegatee]
HAVING SUM([vests]) >= @minVests
```

This reports current active delegation state, which is more useful for Banjo than replaying historical operations. `$delegated [min_mvests]` keeps the legacy output shape: a summary count always appears, and a detail code block appears only for 1 through 25 delegatee accounts.

### `$claims`

The Ruby command summarized `claim_reward_balance` operations through HiveSQL:

```sql
SELECT COUNT(*), COUNT(DISTINCT [account]),
       SUM([reward_hbd]), SUM([reward_hive]), SUM([reward_vests])
FROM [TxClaimRewardBalances]
```

The TypeScript port uses the same `TxClaimRewardBalances` table. `today` and `yesterday` are calculated with UTC day boundaries because HiveSQL stores blockchain timestamps in UTC. Unknown timeframe arguments intentionally fall back to `all`, matching the Ruby command's behavior.

### `$accounts`

The Ruby command summarized HiveSQL account counts from `Accounts`, with two special account classes:

```sql
SELECT COUNT(*) FROM [Accounts]
```

Community accounts are `hive-...` accounts that have `community` custom JSON activity in `TxCustoms` under their `required_posting_auth`. The older Ruby command filtered specifically for `updateProps`, but the live JSON scan is too slow for an interactive bot command; the indexed `tid` and `required_posting_auth` join returns the same observed count on current HiveSQL. Badge accounts are `badge-...` accounts above the legacy id threshold. The mined account count remains the Ruby command's historical constant, `13,696`, because the old implementation deliberately stopped querying mined status and pinned that value.

### `$inflation`

This is a direct port of the Ruby projection table, not a live protocol-state lookup. It starts with a 2016 supply of 250,000,000 HIVE, an initial inflation rate of 9.5%, reduces the rate by the legacy 250,000-block schedule, and floors it at 0.95%. The command caps output at 100 years.

### `$approval`

The Ruby command rendered a Discord embed with an account's witness votes and DHF proposal votes. The TypeScript port keeps the same information in a text response:

```text
condenser_api.get_accounts
condenser_api.get_config
database_api.list_proposal_votes
```

`database_api.list_proposal_votes` is called with `order: "by_voter_proposal"` and `status: "all"`. The `start` voter is a lower-bound cursor, so the response can include later voters and must be filtered back to the exact requested account. Active proposals are grouped by receiver and inactive proposals are shown as upcoming. Proposal daily pay is summed for active non-treasury/non-burn receivers only, matching the Ruby command's exclusion of `null`, `steem.dao`, and `hive.fund`.

### `$proposal`

The Ruby command used the votable proposal list, not an archived proposal search:

```text
condenser_api.list_proposals
database_api.list_proposal_votes
```

`condenser_api.list_proposals` is called with `status: "votable"` for the blank/top-current view and funding math, and with `status: "all"` when a query is provided so expired proposals can be found by id, creator, receiver, subject, or permlink. Some historical proposal ids are missing from the public RPC `status: "all"` response; numeric lookups can fall back to HiveSQL `Proposals` by id when HiveSQL is configured. Current public nodes return `daily_pay` as a string from `list_proposals`, but nested proposal objects from `list_proposal_votes` use the structured asset form. Voter counts use `database_api.list_proposal_votes` with `order: "by_proposal_voter"` and must filter each page back to the requested proposal id. The proposal embed reports current votes above/below the current sweep/return proposal separately from live funding status, because a proposal can have support without enough support to clear the sweep and because today's sweep threshold is not historical truth for expired proposals. The timeline code block combines scheduled start/end dates with HiveSQL `TxProposalCreates` and `TxProposalUpdates` rows, so lowered `daily_pay`, subject, or permlink changes are visible. `Listed Schedule Pay` is calculated from the proposal's listed `daily_pay` and date span, and is hidden when recorded payment history is available; it is not historical requested total because `update_proposal` can lower `daily_pay`. Actual paid totals come from HiveSQL `VOProposalPays` by `proposal_id`, because hourly `proposal_pay` virtual operations capture on-again-off-again approval and partial-funding periods more accurately than date-span estimates. The first/last `VOProposalPays` timestamps are compared with the Hive launch hardfork (`2020-03-20 14:00 UTC`, HF23) to indicate whether recorded payments were pre-Hive or spanned the hardfork; ordinary post-hardfork payments are not called out.

Future related-transfer work should treat treasury donations separately from protocol proposal payments. Users can transfer HIVE/HBD to the DHF treasury account (`hive.fund`; historically `steem.dao`). These transfers may explain social intent, such as returning an unexpected proposal payment, but they are not linked to a proposal except by timing, participants, and memo text. If surfaced, label them as related treasury transfers and keep them out of actual-paid totals unless a separate net calculation is explicitly designed.

### `$consensus`

Uses `condenser_api.get_dynamic_global_properties` for `participation_count` and `condenser_api.get_witnesses_by_vote` for the top witness version list. The Ruby command accepted a chain argument and a top witness count; this port only supports Hive and clamps the requested count to 1-100.

### `$rewards`

The native Hive branch scans up to four `condenser_api.get_account_history` pages, matching the Ruby command's recent-history scope. It aggregates `producer_reward`, `interest`, `curation_reward`, `author_reward`, and `comment_benefactor_reward` operations. VESTS are converted to HIVE from current dynamic globals, HBD is converted through the current median feed, and USD uses the market client.

The token branch uses SCOT `get_account_history` for the requested account and symbol, filters the returned history to roughly the last 30 days, and groups `staking_reward`, `stake_airdrop`, `liquid_airdrop`, `curation_reward`, `author_reward`, `comment_benefactor_reward`, and `mining_reward`. Token totals are estimated back to HIVE with the latest Hive Engine trade price and then to USD with the market HIVE/USD price. `$rewards <account> HIVE` stays on the native Hive path; wrapped assets such as `SWAP.HIVE` should not be treated as native HIVE without confirming the command semantics.

### `$ticker`

The Ruby command eventually delegated market rendering to a CoinGecko widget screenshot. The TypeScript port returns text instead: CoinGecko HIVE/USD price, optional market cap/volume/change fields, and the Hive feed median from `condenser_api.get_feed_history`.

`$ticker2` was a later Ruby screenshot-only CoinGecko widget command. It is registered as an alias to the text `$ticker` command so the bot stays dependency-light and does not need browser/image capture for market data.

### `$price`

The Ruby command rendered WorldCoinIndex widgets for arbitrary symbols. The TypeScript port starts with the native pair only: `HIVE` and `HBD` from CoinGecko's `hive` and `hive_dollar` ids. If HBD is unavailable from CoinGecko, it falls back to `HIVE/USD` divided by the Hive median feed price.

### `$token`

Uses the Hive Engine contracts JSON-RPC endpoint, defaulting to `https://api.hive-engine.com/rpc/contracts`. The port queries `tokens.tokens`, `market.tradesHistory`, and `market.metrics`. Unlike the Ruby command, it does not fall back to Steem Engine because Steem Engine is no longer a live backend for this bot. Legacy chain symbols such as `STEEM`, `SBD`, `BTC`, and `LTC` point users toward their `SWAP.*` Hive Engine wrappers.

Native `HIVE` and `HBD` are handled separately through Hive RPC: `condenser_api.get_ticker`, `condenser_api.get_feed_history`, and `condenser_api.get_dynamic_global_properties`. `$token` with no arguments returns a small directory of native tokens, common wrappers, and sample Hive Engine tokens. When SCOT config is already available in command context, token embeds can add a community/app hint.

For any command implemented through Hive Engine, explicitly verify whether the Ruby behavior also handled native Hive assets separately. `SWAP.HIVE` on Hive Engine is not native `HIVE`; wrapped-token balances, richlists, prices, and stake are separate from base-chain HIVE/HBD/VESTS state. If both cases exist, keep them as separate branches and label the output/link destinations clearly.

### `$nft`

Queries Hive Engine `nft.nfts` by symbol and displays issuer, name, circulating supply, metadata description, and metadata URL. The Ruby command used the old `next.steem-engine.net` NFT link; this port uses a dTools-style NFT URL.

### `$scottags`

Fetches SCOT tribe metadata from `https://scot-api.hive-engine.com/config` by default. Output follows the Ruby command: `tags` entries include the Hive community and metadata tags, `community` entries are labeled community-only, and `app` entries are labeled app-only.

### `$tt2x`

Uses SCOT `get_discussions_by_trending` for pending token payouts, Hive Engine `market.tradesHistory` for last price, and `market.buyBook` sorted by `priceDec` for exchange-depth yield. The calculation mirrors Ruby: sum top pending payouts, walk buy orders until that amount is consumed, and report final-depth price/change.

### `$community`

Uses `bridge.get_community` directly for `hive-...` account names and `bridge.list_communities` followed by `bridge.get_community` for text queries. The Ruby command used HiveSQL to search community update custom JSON first; the bridge route avoids a HiveSQL dependency but does not reproduce the fuzzy "did you mean" search.

### `$badges` / `$badge`

Use HiveSQL `Accounts` rows where `name LIKE 'badge-%'`, matching the Ruby `FindBadgesJob`. Badge display names and about text come from account `json_metadata.profile`. `$badge` also counts recipients/subscribers from `Followers`, where recipients follow the badge account and subscribers are followed by the badge account in the legacy convention.

Live Hive account metadata is preferred for display because HiveSQL `Accounts.json_metadata` can lag behind current `posting_json_metadata`. `$badges` still uses HiveSQL as the search index, then hydrates the returned badge account names with one batched `condenser_api.get_accounts` call. Prefer `posting_json_metadata`, then `json_metadata`, then the HiveSQL row.

### `$search`

The Ruby command used Banjo's private post/cache tables. The TypeScript port uses HiveSQL `Comments` and `Tags` instead: search terms are ANDed across `title`, `body`, and `json_metadata`; `tag:<name>` requires a matching tag row; `!tag:<name>` excludes one; `after:` and `before:` accept ISO-like dates, with date-only inputs expanded to UTC day boundaries.

If no dates are supplied, the default window is the last 24 hours, matching Ruby's practical "today" behavior rather than UTC calendar days. The response keeps the legacy guardrails: more than 500 unique authors or more than 80 matching comments asks the user to narrow the search.

### `$promoted`

Uses HiveSQL `Comments.promoted`, grouped by UTC calendar day for `yesterday` and `today`. The legacy helper came from outside the Banjo repo, but the command behavior was two reports: yesterday first, then today. Current Hive promotion activity can be zero, so the command must render a stable zero-total line rather than treating no rows as an error.

### `$richlist`

Hive Engine token richlists page through `tokens.balances` and sort locally by `balance + stake + pendingUnstake`, matching the Ruby job. The public richlist link uses `https://he.dtools.dev/richlist/<SYMBOL>` because the old `hive-engine.rocks` route is stale. The `null` account is omitted from the numbered display and shown as a footer-style line. Native HIVE/HBD/VESTS richlists are still separate legacy behavior and are not ported here.

### `$staked`

Uses the same `tokens.balances` scan as `$richlist`, but sorts by `stake` and shows each account's percentage of total stake. Account links use the dTools account/symbol route: `https://he.dtools.dev/@<account>?symbol=<SYMBOL>`.

### `$rewardpool`

Use:

```text
condenser_api.get_reward_fund
```

with:

```json
["post"]
```

The useful display fields are `reward_balance`, `recent_claims`, and `percent_curation_rewards`.

The Ruby command accepted an optional chain parameter. Banjo currently supports only `hive`; other chain values return an explicit unsupported-chain message rather than being ignored.

### `$calcreward`

Uses `condenser_api.get_content` for the target post, `condenser_api.get_reward_fund("post")`, and `condenser_api.get_feed_history`. The calculation mirrors the Ruby job: pending payout HBD divided by the current reward pool converted from HIVE to HBD via the median feed, then displayed as a percentage of the reward pool. It only makes sense before first payout, so posts with `cashout_time` in the past return the legacy warning.

Like `$age`, legacy Ruby `$calcreward` accepted a missing slug or `^` and resolved it from the latest post link seen in the channel. Rebuild that shared channel link memory before treating this compatibility point as complete.

### `$distribution`

This is a native Hive account distribution command, not a Hive Engine token distribution. Ruby grouped HiveSQL `Accounts` by `vesting_shares` MVESTS buckets and considered accounts active when `last_vote_time` was inside the requested window, defaulting to 90 days. The dollar labels are MVEST thresholds converted through current dynamic globals and the median feed; they are not Hive Engine `SWAP.HIVE` values.

### `$fear` / `$greed`

Uses Alternative.me's `https://api.alternative.me/fng/` endpoint for the latest Crypto Fear & Greed Index values. The historical chart image follows the legacy URL shape `https://alternative.me/images/fng/crypto-fear-and-greed-index-YYYY-M-D.png`, where the optional command argument is absolute days ago.

### `$xkcd`

Uses xkcd's JSON endpoints: latest is `https://xkcd.com/info.0.json`, numbered comics are `https://xkcd.com/<num>/info.0.json`. Ruby downloaded and reuploaded the image file; the TypeScript port returns the image URL and spoilered alt text as a lightweight text response.

### `$mempool`

Legacy Ruby rendered a Discord embed for Blockchain.com's Bitcoin mempool growth chart. The old thumbnail URL, `https://api.blockchain.info/charts/thumbnail/mempool-growth.png`, is broken, so the TypeScript port returns only the chart page and description.

### `$wolframalpha` / `$wa` / `$wat` / `$tr`

Ruby queried Wolfram Alpha through a hardcoded legacy API id and rendered text/embed results. Do not copy that key into this repo. The TypeScript port builds Wolfram Alpha query URLs instead, preserving a useful command without adding a secret dependency:

```text
https://www.wolframalpha.com/input/?i=<query>
```

`$tr` preserves the Ruby query rewrite by linking to `translate "<text>" to english`.

### `$birthday`

Uses the same static event times as Ruby Banjo for `hive`, `steem`, `golos`, `banjo`, `bitcoin`, and `aggrandizement`. Dates are evaluated in UTC. Hive's birthday is the HF23 genesis block time: 2020-03-20 14:00 UTC.

### `$trail`

Ruby returned:

```text
https://streemian.com/profile/curationtrail/trailing/338
```

On 2026-05-17 this redirects to `www.streemian.com` and returns `404`, so the TypeScript command returns an explicit deprecated message instead of linking to a dead curation trail.

### `$gold` / Metal Aliases

Ruby used the Kitco spot-price image at `http://www.kitconet.com/images/sp_en_8.gif`. The URL now redirects to HTTPS; the TypeScript port returns `https://www.kitconet.com/images/sp_en_8.gif`. These aliases are intentionally handled before the generic element-name placeholder.

### `$supply`

Use:

```text
condenser_api.get_dynamic_global_properties
```

Display `current_supply`, `virtual_supply`, and `current_hbd_supply`. The same call also backs `$mvests`, so keep dynamic-global parsing in one command module style.

The Ruby command accepted an optional chain parameter and `*` for multiple chains. Banjo currently supports only `hive`; other chain values return an explicit unsupported-chain message rather than being ignored.

### `$nodes`

The Ruby bot read `@fullnodeupdate` account metadata and then probed each node for revision info. That account no longer appears to be the best maintained source.

Use the Hive Developer Portal public node list instead:

```text
https://developers.hive.io/quickstart/hive_full_nodes.html
```

Banjo parses the "Public Nodes" section and normalizes hostnames to `https://`. If the source page cannot be fetched, fall back to configured `HIVE_NODES`.

### `$follows`

Use:

```text
condenser_api.get_follow_count
```

with:

```json
["<account>"]
```

This returns `follower_count` and `following_count` on current public nodes. The Ruby bot also reported MVESTS totals for followers and following by using indexed follow relationships plus account vesting sums. Banjo's first port keeps the reliable count behavior through public RPC; MVESTS totals should be added later through HiveSQL aggregation rather than by paginating public follow lists.

### `$feed`

The Ruby command accepted:

```text
feed [price|apr] [chain] [limit]
```

and calculated means over witness feeds. Banjo's first port keeps `price` and `apr` modes for Hive only, using public RPC fields that are cheap and stable.

For `feed` / `feed price`, use:

```text
condenser_api.get_feed_history
```

Display `current_median_history`, plus `market_median_history`, `current_min_history`, and `current_max_history` when present.

For `feed apr`, use:

```text
condenser_api.get_dynamic_global_properties
```

Display `hbd_interest_rate`, `hbd_print_rate`, `hbd_start_percent`, and `hbd_stop_percent`. These protocol percentage fields are basis points: divide by `100` for display percent.

### `$hardfork`

Use the same public RPC calls as the Ruby command:

```text
condenser_api.get_witness_schedule
condenser_api.get_next_scheduled_hardfork
condenser_api.get_hardfork_version
condenser_api.get_witnesses_by_vote
```

Group the top 100 witnesses by `hardfork_version_vote`, sum `votes`, and display the total as MVESTS with:

```text
votes / 1_000_000 / 1_000_000
```

Public node JSON can return witness `votes` as either a string or a number-like value, so normalize before summing.

### `$top`

The Ruby command read `hive_posts_cache` fields. Current HiveSQL exposes enough indexed comment/account data to keep the command useful, but not the old cached `rshares` field:

- `upvoted` / `downvoted` use `Comments.net_votes` as the available indexed vote score.
- `children`, `promoted`, and `reply <keywords>` use `Comments.children`, parsed `Comments.promoted`, and direct reply body matches.
- `rep` / `-rep` join `Accounts` and sort by `reputation_ui`.

All modes currently look at top-level posts from the last 7 days. Negative rankings (`-rep` and `downvoted`) return `peakd.com` links because `hive.blog` can present low-reputation or otherwise filtered content as a 404, while PeakD surfaces a warning and lets the user continue when the content is available.

### `$app` / `$apps`

The Ruby command grouped paid-out posts by the full `json_metadata.app` value, including the version suffix. The TypeScript port keeps that behavior with HiveSQL:

```text
Comments.last_payout > now - 7 days
Comments.created > now - 15 days
Comments.total_payout_value > 0.02
JSON_VALUE(Comments.json_metadata, '$.app')
```

The extra `created` bound keeps the JSON aggregation interactive; paid-out posts in the last 7 days should have been created within the prior payout window. The display says `HBD` instead of the legacy `SBD` header. This is a payout leaderboard for posting clients, not a unique-author or pending-reward chart.

### `$nftsr`

Ruby used Hive Engine Rocks transaction pages for `NFTSR` `issueMultiple` operations, then fetched NFT Showroom metadata by art series. Hive Engine Rocks is deprecated for this bot, so the TypeScript port reads current `nft.NFTSRinstances` through the Hive Engine contracts RPC and then calls:

```text
https://nftshowroom.com/api/arts/info?series=<artSeries>
```

Display links use the current collection route:

```text
https://nftshowroom.com/gallery/<artSeries>?collection=true
```

`$nftsr` without an owner returns the newest visible instance by `_id`. `$nftsr <owner> [index]` returns that owner's newest owned NFTSR instance, with `index` as a zero-based offset. This is intentionally a current-ownership lookup rather than the legacy transaction-history lookup.

### `$predict` / `$prediction`

The legacy command used the Dublup backend HTTP API:

```text
https://api.dublup.io/markets...
```

That endpoint returned `502 Bad Gateway` during the 2026-05-17 migration check, so do not port Banjo by wrapping that API first.

Use the Dublup backend source as the map for the real on-chain behavior instead:

```text
https://github.com/hive-engine/dublup-backend
```

Future `$predict` should read prediction market state directly from Hive Engine / blockchain data where practical, then format the same lightweight Discord summary Ruby produced: question, market URL, outcomes, total shares, and close status. Banjo may also be a good place for small front-end companion operations around Dublup markets, but those should live behind the companion SPA/read-only API plan rather than making Discord commands depend on a dead backend service.

### `$alexa`

The Ruby command captured a PNG from:

```text
https://traffic.alexa.com/graph?...&u=<domain>
```

On 2026-05-17, `traffic.alexa.com` failed DNS resolution during migration testing. The TypeScript command returns an explicit retired-service message instead of trying to capture a graph from the defunct Alexa Internet endpoint.

### `$carousel`

The Ruby command captured part of:

```text
https://bittrex.com/home/markets
```

On 2026-05-17, that URL returned `301` to `/explore` instead of exposing the old markets carousel surface. The TypeScript command returns an explicit deprecated-message response instead of taking a misleading screenshot.

### `$flounce`

The Ruby command used a hardcoded Giphy API key and searched for `flounce <random number>`, then returned a random original GIF URL from the search response.

The TypeScript command preserves the lookup shape but does not copy the legacy key. Configure `GIPHY_API_KEY` to enable live lookup; without it, `$flounce` returns an explicit unavailable message.

### `$dilbert`

The Ruby command captured the current day's comic from a dated GIF mirror:

```text
http://x.anise.cz/dilbert/dilbertYYMMDD.gif
```

On 2026-05-17, that host failed to accept a connection during migration testing. The TypeScript command returns an explicit deprecated-message response rather than depending on the dead mirror.

### `$ego`

The Ruby command called the old Internet Chuck Norris Database API:

```text
http://api.icndb.com/jokes/random?escape=javascript&firstName=<name>&lastName=&limitTo=[nerdy]&exclude=[explicit]
```

On 2026-05-17, the API host redirected to `https://icndb.com/` instead of returning joke JSON. The TypeScript command returns an explicit retired-service response rather than scraping or substituting a different joke source.

### `$say` / `$vo`

The Ruby command posted `{ speaker, text }` JSON to:

```text
https://mumble.stream/speak
```

and uploaded the returned WAV file to Discord. On 2026-05-17, `mumble.stream` failed DNS resolution during migration testing. The TypeScript command returns an explicit retired-service response instead of listing voices that no longer have a reachable synthesis backend.

### `$play` / `$disconnect_voice`

The Ruby `$play` command had its sound playback call commented out, so it accepted an optional sound name but did not perform playback. `$disconnect_voice` called into the same voice subsystem directly. The TypeScript port returns explicit unavailable responses until Discord voice/audio dependencies and deployment behavior are deliberately added.

### `$payout`

The Ruby command body queried `SteemData::Post.first_payout` and assigned `pending_count`, but never sent a Discord response. The TypeScript port returns an explicit unavailable response rather than preserving a silent no-op.

### `$poke`

The Ruby command found an account through SteemData, loaded the account's latest indexed operation, removed Mongo/Rails bookkeeping fields, and returned `{ type: payload }` as JSON.

The TypeScript port uses `condenser_api.get_account_history` with `[-1, 1]` to fetch the latest Hive account-history operation, after confirming the account exists through `get_accounts`. It preserves the compact JSON code block shape while avoiding the old SteemData dependency.

### `$flagwars`

The Ruby command delegated to `DetectFlagwarsJob`, which queried SteemData root posts approaching first payout with downvotes, children, nonzero payouts, active votes, and commenter/downvoter relationships. A faithful port needs an indexed post/vote/comment relationship source such as HiveSQL or HAF-backed views and should be designed as a report, not a direct RPC scan. The TypeScript command currently returns an explicit unavailable response.

### `$regex`

The Ruby command used Mongo-style regex queries against SteemData account-operation comments from "today", matching body, title, and JSON metadata, then returned distinct authors. HiveSQL supports the indexed `$search` command, but it is keyword/LIKE based rather than regex-equivalent. The TypeScript `$regex` command returns an explicit unavailable response and points users to `$search`.

### `$poll`

The Ruby command resolved a post slug, verified a root post through SteemData, loaded direct replies as poll options, then fetched each reply by original author/permlink to count active upvotes/downvotes and sum voter MVESTS. It sorted choices by MVESTS and displayed the first line of each reply body.

A faithful TypeScript port needs:

- `condenser_api.get_content_replies` for poll choices.
- Full `active_votes` for each choice reply.
- Batched account hydration for voters to compute MVEST totals.
- A decision on whether to preserve the old latest-chat-slug fallback for `$poll` without a slug.

The Ruby implementation also appears to typo `v[:display ]` in the final map, so behavior should be verified against a known historical poll before porting fully. The TypeScript command currently returns an explicit unavailable response.

### `$snark`

The Ruby command scanned Discord channel history for short messages from specific member IDs, rendered selected text onto `dinner-cat.jpg` with ImageMagick, and uploaded the generated meme. When no qualifying message was found it used the fallback text `It will self-correct.`

The TypeScript port currently returns that fallback text only. A full port needs an explicit Discord history-scanning policy, image compositing dependencies, and tests around generated image output.

### `$mod`

The Ruby command built a moderation embed for SCOT/Hive Engine tribes. It combined:

- `scot-api.hive-engine.com/config` for token/tag configuration.
- HiveSQL root post and tag filtering because native Hive tags are limited.
- Hive Engine richlist influence data to identify top moderators.
- SCOT discussion lookups for active votes and pending token payout.
- Incremental Discord embed rendering while the report was still collecting URLs.

This is a multi-source moderation workflow, not a simple lookup. The TypeScript command currently returns an explicit unavailable response until the query shape, rate limits, and embed behavior are designed deliberately.

### `$bidbots`

The Ruby command looked for posts and replies from seven days ago that used known bidbot voters while also matching a main SCOT tag and any other SCOT tag. It depended on a cached post/vote representation and returned top paid posts/replies.

During migration, a direct HiveSQL vote/tag query timed out, so the active TypeScript command returns an explicit unavailable response. A future port should use a precomputed/index-friendly query or cached report rather than scanning votes and tags interactively.

### `$woodwork`

The Ruby command queried HiveSQL for root posts created in the last seven days whose author's previous root post was before the Hive fork timestamp, optionally filtered by tag. It rendered the newest matching posts as a PeakD embed and otherwise reported that nobody came out of the woodwork.

A faithful TypeScript port needs a HiveSQL method for the correlated "previous root post before 2020-03-20 14:00 UTC" query plus optional tag filtering. The TypeScript command currently returns an explicit unavailable response.

### `$investors`

The Ruby command queried HiveSQL for accounts created within the requested day window, then grouped `transfer_to_vesting` transfers to those accounts over the same period. It displayed the total HP powered up, HP per day, and the top 12 recipient accounts.

A faithful TypeScript port should first confirm current HiveSQL transfer table names and amount columns, then add a narrow indexed query rather than guessing from the old ActiveRecord model names. The TypeScript command currently returns an explicit unavailable response.

## HAFBE Notes

HAFBE remains useful, but it should be treated as an explorer/indexed-facts API rather than a drop-in replacement for every content semantic.

Good candidates:

- Block and operation search.
- Witness and account derived views.
- Proxy and vote histories.
- Historical lookups where the endpoint returns the exact operation semantics needed.

Sharp edges found:

- Public deployment exposes friendly REST routes like:

```text
/hafbe-api/accounts/{account}/comment-permlinks
```

while the internal PostgREST RPC route:

```text
/hafbe-api/rpc/get_comment_permlinks
```

returned `404 {}` on `api.hive.blog`.

- `comment-permlinks` returns newest-first.
- Tiny page sizes can change reported totals/ranges on public HAFBE because the endpoint narrows block ranges during search. Use larger page sizes when exploring, and do not rely on it for `$first` creation semantics.

## Persistence Rule

When a command teaches us an API distinction, persist it in at least one of:

- An adapter normalization.
- A regression test.
- A note in this file.

Ideally, do all three for bugs that were surprising in production.
