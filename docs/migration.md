# Banjo Migration

Legacy source reference:

- Public repository: `inertia186/banjo_bot`
- Main bot: `lib/banjo_bot.rb`
- Link commands: `lib/banjo_bot/links.rb`
- Snark commands: `lib/banjo_bot/snarks.rb`
- Feature jobs: `lib/banjo_bot/*_job.rb`
- Tests: `test/banjo_bot`

## Migration Principles

- Keep the `$` prefix for compatibility while commands are being ported.
- Move all tokens and API keys to environment variables.
- Port behavior behind command modules with small service adapters for Discord, Hive, HiveSQL, Hive Engine, pricing, image capture, and Wolfram Alpha.
- Use the old tests as behavior references, but avoid copying hardcoded secrets or obsolete network assumptions.
- Record API semantics and surprises in `docs/api-notes.md` when a command reveals them.
- For every Hive Engine port, confirm whether the legacy command also had a native Hive/HBD/VESTS case. Do not assume wrapped assets such as `SWAP.HIVE` are interchangeable with native `HIVE`.
- Commands that took a post slug could often omit it or pass `^`, causing Ruby Banjo to use the latest `@author/permlink` seen in that Discord channel. Preserve or explicitly track this gap for ports such as `$age`, `$calcreward`, and `$poll`.

## First Porting Groups

1. Core and static commands: `help`, `about`, quick links, snarks.
2. Read-only Hive account commands: `rep`, `power`, `latest`, `first`, `age`, `witness`, `proxy`, `follows`.
3. Market and token commands: `price`, `ticker`, `token`, `richlist`, `scottags`, `rewards`.
4. Content discovery commands: `search`, `community`, `badges`, `proposal`, `predict`, `nftsr`, `tt2x`.
5. Moderation and rich embed commands: `mod`, `woodwork`, `investors`, `bidbots`.
6. Mutating or high-risk commands: registration, comments, voting, voice playback.

## Legacy Command Inventory

### Upstream Cosgrove

Banjo was built on top of `steem-third-party/cosgrove`, so the upstream framework commands should remain registered even when Banjo does not currently implement the mutating behavior.

Verified against `steem-third-party/cosgrove` `master` on 2026-05-17:

| Command | Upstream source | New status |
| --- | --- | --- |
| `help` | `lib/cosgrove/bot.rb` | Covered by Banjo help |
| `version` | `lib/cosgrove/bot.rb` | Stubbed unavailable response |
| `verify` | `lib/cosgrove/bot.rb` | Stubbed unavailable response |
| `register` | `lib/cosgrove/bot.rb` | Stubbed disabled response |
| `upvote` | `lib/cosgrove/bot.rb` | Stubbed disabled response |
| `slap` | `lib/cosgrove/snark_commands.rb` | Stubbed unavailable response |
| `catfact` / `catfacts` | `lib/cosgrove/snark_commands.rb` | Stubbed unavailable response |

Cosgrove also had a message listener for condenser-style post URLs that remembered the latest link per channel and appended link details. The latest-link behavior matters for legacy `^` or omitted-slug command patterns; the automatic link-detail response is not currently ported.

### Core

| Command | Legacy line | New status |
| --- | ---: | --- |
| `help` | `banjo_bot.rb:358` | Ported scaffold |
| `about` | `banjo_bot.rb:422` | Ported scaffold |
| `version` | Cosgrove `bot.rb:48` | Stubbed unavailable response |
| `verify` | Cosgrove `bot.rb:52` | Stubbed unavailable response |
| `register` | `banjo_bot.rb:429` | Ported disabled response |
| `upvote` | `banjo_bot.rb:433` | Ported disabled response |
| `stats` | `banjo_bot.rb:437` | Ported disabled response |
| `slap` | Cosgrove `snark_commands.rb:44` | Stubbed unavailable response |
| `catfact` / `catfacts` | Cosgrove `snark_commands.rb:52` | Stubbed unavailable response |

### Hive And Account Data

| Command | Legacy line | New status |
| --- | ---: | --- |
| `rep` | `banjo_bot.rb:444` | Ported read-only RPC |
| `proxy` | `banjo_bot.rb:497` | Ported read-only RPC |
| `witness` | `banjo_bot.rb:531` | Ported read-only RPC |
| `consensus` | `banjo_bot.rb:623` | Ported witness version consensus |
| `power` | `banjo_bot.rb:657` | Ported read-only RPC |
| `rewards` | `banjo_bot.rb:818` | Ported native Hive rewards and SCOT/Hive Engine token rewards |
| `latest` | `banjo_bot.rb:1290` | Ported bridge RPC |
| `first` | `banjo_bot.rb:1374` | Ported account-history RPC |
| `age` | `banjo_bot.rb:1401` | Ported get_content RPC |
| `mvests` | `banjo_bot.rb:1440` | Ported dynamic globals RPC |
| `rewardpool` | `banjo_bot.rb:1448` | Ported reward fund RPC |
| `supply` | `banjo_bot.rb:1481` | Ported dynamic globals RPC |
| `nodes` | `banjo_bot.rb:1521` | Ported developer portal node list |
| `follows` | `banjo_bot.rb:1607` | Ported count RPC |
| `hardfork` | `banjo_bot.rb:1735` | Ported hardfork/witness RPC |
| `feed` | `banjo_bot.rb:1818` | Ported feed history/dynamic globals RPC |
| `delegate` | `banjo_bot.rb:1835` | Ported HiveSQL delegation lookup |
| `delegated` | `banjo_bot.rb:1885` | Ported HiveSQL delegation lookup |
| `claims` | `banjo_bot.rb:2026` | Ported HiveSQL reward-claim summary |
| `accounts` | `banjo_bot.rb:2070` | Ported HiveSQL account summary |
| `inflation` | `banjo_bot.rb:2101` | Ported legacy inflation projection |
| `approval` | `banjo_bot.rb:3544` | Ported witness/proposal approvals |
| `proposal` | `banjo_bot.rb:3628` | Ported votable DHF proposal lookup |

### Market, Tokens, And Discovery

| Command | Legacy line | New status |
| --- | ---: | --- |
| `distribution` / `dist` | `banjo_bot.rb:1137` | Ported native HiveSQL stake distribution |
| `gold` / metals aliases | `banjo_bot.rb:1150` | Ported Kitco spot-price image link |
| `calcreward` | `banjo_bot.rb:1469` | Ported pending payout/reward-pool ratio |
| `ticker` | `banjo_bot.rb:1578` | Ported text CoinGecko/feed ticker |
| `price` | `banjo_bot.rb:1588` | Ported HIVE/HBD USD prices |
| `promoted` | `banjo_bot.rb:1600` | Ported HiveSQL promoted post summary |
| `search` | `banjo_bot.rb:1660` | Ported HiveSQL content search |
| `community` | `banjo_bot.rb:2439` | Ported bridge community lookup |
| `badges` | `banjo_bot.rb:2523` | Ported HiveSQL PeakD badge search |
| `badge` | `banjo_bot.rb:2576` | Ported HiveSQL PeakD badge lookup |
| `token` | `banjo_bot.rb:2635` | Ported Hive Engine token lookup |
| `nft` | `banjo_bot.rb:2659` | Ported Hive Engine NFT metadata lookup |
| `tt2x` | `banjo_bot.rb:2778` | Ported SCOT trending-to-exchange estimate |
| `richlist` | `banjo_bot.rb:2951` | Ported Hive Engine token richlist |
| `staked` | `banjo_bot.rb:2985` | Ported Hive Engine staked lookup |
| `scottags` | `banjo_bot.rb:3185` | Ported SCOT config tag lookup |
| `bidbots` | `banjo_bot.rb:3215` | Ported unavailable response; direct HiveSQL vote/tag query timed out |
| `fear` / `greed` | `banjo_bot.rb:3468` | Ported Alternative.me Fear & Greed lookup |
| `mod` | `banjo_bot.rb:3767` | Ported unavailable response; faithful port needs SCOT config, HiveSQL tag search, Hive Engine richlists, and SCOT vote data |
| `woodwork` | `banjo_bot.rb:3905` | Ported unavailable response; legacy HiveSQL report finds pre-fork inactive authors posting again |
| `investors` | `banjo_bot.rb:3964` | Ported unavailable response; legacy HiveSQL report finds new accounts powering up |
| `predict` / `prediction` | `banjo_bot.rb:3993` | Ported unavailable response; legacy Dublup API returned 502 and future port should read Hive Engine/blockchain state |
| `nftsr` | `banjo_bot.rb:4062` | Ported Hive Engine NFTSR + NFT Showroom lookup |
| `ticker2` | `banjo_bot.rb:4109` | Ported as text ticker alias |

### Media, Chat, And Utility

| Command | Legacy line | New status |
| --- | ---: | --- |
| `avatar` | `banjo_bot.rb:1104` | Ported static Hive image URL |
| `wolframalpha` / `wa` / `wat` / `tr` | `banjo_bot.rb:1110` | Ported as Wolfram Alpha query links |
| `mempool` | `banjo_bot.rb:1126` | Ported static Blockchain.com chart link |
| `carousel` | `banjo_bot.rb:1145` | Ported deprecated response; legacy Bittrex markets carousel URL redirects away |
| `dilbert` | `banjo_bot.rb:1155` | Ported deprecated response; legacy dated GIF mirror no longer connects |
| `xkcd` | `banjo_bot.rb:1162` | Ported xkcd JSON lookup |
| `flounce` | `banjo_bot.rb:1184` | Ported optional Giphy lookup; requires `GIPHY_API_KEY` |
| `snark` | `banjo_bot.rb:1195` | Ported fallback text; full Discord history + image compositing behavior not ported |
| `alexa` | `banjo_bot.rb:1275` | Ported retired-service response; legacy `traffic.alexa.com` no longer resolves |
| `poll` | `banjo_bot.rb:1475` | Ported unavailable response; faithful port needs replies, active votes, and voter MVEST totals |
| `trail` | `banjo_bot.rb:1611` | Ported deprecated response; legacy Streemian URL 404s |
| `birthday` | `banjo_bot.rb:1615` | Ported static birthday calculator |
| `regex` | `banjo_bot.rb:1718` | Ported unavailable response; use `$search` for indexed HiveSQL keyword search |
| `voting` | `banjo_bot.rb:1751` | Ported disabled response; Ruby returned before unreachable stats code |
| `payout` | `banjo_bot.rb:1797` | Ported unavailable response; Ruby command calculated a count but emitted no response |
| `flagwars` | `banjo_bot.rb:1803` | Ported unavailable response; legacy report depended on SteemData post/vote scopes |
| `poke` | `banjo_bot.rb:1807` | Ported latest account-history operation lookup via Hive RPC |
| `ego` | `banjo_bot.rb:2157` | Ported retired-service response; legacy ICNDB endpoint redirects away from the API |
| `play` | `banjo_bot.rb:2167` | Ported unavailable response; Ruby playback call was commented out |
| `disconnect_voice` | `banjo_bot.rb:2171` | Ported unavailable response; voice subsystem is not enabled |
| `top` | `banjo_bot.rb:2189` | Ported via HiveSQL |
| `app` / `apps` | `banjo_bot.rb:2274` | Ported HiveSQL app payout leaderboard |
| `say` / `vo` | `banjo_bot.rb:3494` | Ported retired-service response; legacy `mumble.stream` host no longer resolves |

### Quick Links And Snarks

| Command | Legacy file | New status |
| --- | --- | --- |
| `banjo`, `faq`, `welcome`, `whitepaper`, `tools`, `github`, `releases` | `links.rb` | Ported scaffold |
| `scam`, `password`, `watch` | `links.rb` | Ported static links |
| `bandwagon`, `headphones` | `links.rb` | Ported vendored images |
| `music` | `links.rb` | Ported static categorized YouTube picker |
| `fallacy` | `links.rb` | Ported compact lookup with original summaries; full Ruby text corpus intentionally not copied |
| `make`, `sudo`, `donut`, `roll`, `lmgtfy`, `kappa`, `hydrogen` plus element aliases | `snarks.rb` | Ported scaffold partial |

## Assets

The legacy bot has 116 sound files under `support/sounds`. Voice playback should be ported only after the Discord client and deployment environment are stable because it adds native/audio dependencies.

## HAFBE Candidates

Use HAF Block Explorer for historical queries that are awkward or expensive through public bridge/condenser APIs.

- `age`: canonical post timestamp lookup by author/permlink.
- Account operation history features that previously depended on HiveSQL.
