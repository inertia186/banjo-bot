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

## First Porting Groups

1. Core and static commands: `help`, `about`, quick links, snarks.
2. Read-only Hive account commands: `rep`, `power`, `latest`, `first`, `age`, `witness`, `proxy`, `follows`.
3. Market and token commands: `price`, `ticker`, `token`, `richlist`, `scottags`, `rewards`.
4. Content discovery commands: `search`, `community`, `badges`, `proposal`, `predict`, `nftsr`, `tt2x`.
5. Moderation and rich embed commands: `mod`, `woodwork`, `investors`, `bidbots`.
6. Mutating or high-risk commands: registration, comments, voting, voice playback.

## Legacy Command Inventory

### Core

| Command | Legacy line | New status |
| --- | ---: | --- |
| `help` | `banjo_bot.rb:358` | Ported scaffold |
| `about` | `banjo_bot.rb:422` | Ported scaffold |
| `register` | `banjo_bot.rb:429` | Legacy disabled, placeholder |
| `upvote` | `banjo_bot.rb:433` | Legacy disabled, placeholder |
| `stats` | `banjo_bot.rb:437` | Legacy disabled, placeholder |

### Hive And Account Data

| Command | Legacy line | New status |
| --- | ---: | --- |
| `rep` | `banjo_bot.rb:444` | Placeholder |
| `proxy` | `banjo_bot.rb:497` | Placeholder |
| `witness` | `banjo_bot.rb:531` | Placeholder |
| `consensus` | `banjo_bot.rb:623` | Placeholder |
| `power` | `banjo_bot.rb:657` | Placeholder |
| `rewards` | `banjo_bot.rb:818` | Placeholder |
| `latest` | `banjo_bot.rb:1290` | Placeholder |
| `first` | `banjo_bot.rb:1374` | Placeholder |
| `age` | `banjo_bot.rb:1401` | Placeholder |
| `mvests` | `banjo_bot.rb:1440` | Placeholder |
| `rewardpool` | `banjo_bot.rb:1448` | Placeholder |
| `supply` | `banjo_bot.rb:1481` | Placeholder |
| `nodes` | `banjo_bot.rb:1521` | Placeholder |
| `follows` | `banjo_bot.rb:1607` | Placeholder |
| `hardfork` | `banjo_bot.rb:1735` | Placeholder |
| `feed` | `banjo_bot.rb:1818` | Placeholder |
| `delegate` | `banjo_bot.rb:1835` | Placeholder |
| `delegated` | `banjo_bot.rb:1885` | Placeholder |
| `claims` | `banjo_bot.rb:2026` | Placeholder |
| `accounts` | `banjo_bot.rb:2070` | Placeholder |
| `inflation` | `banjo_bot.rb:2101` | Placeholder |
| `approval` | `banjo_bot.rb:3544` | Placeholder |
| `proposal` | `banjo_bot.rb:3628` | Placeholder |

### Market, Tokens, And Discovery

| Command | Legacy line | New status |
| --- | ---: | --- |
| `distribution` / `dist` | `banjo_bot.rb:1137` | Placeholder |
| `gold` / metals aliases | `banjo_bot.rb:1150` | Placeholder |
| `calcreward` | `banjo_bot.rb:1469` | Placeholder |
| `ticker` | `banjo_bot.rb:1578` | Placeholder |
| `price` | `banjo_bot.rb:1588` | Placeholder |
| `promoted` | `banjo_bot.rb:1600` | Placeholder |
| `search` | `banjo_bot.rb:1660` | Placeholder |
| `community` | `banjo_bot.rb:2439` | Placeholder |
| `badges` | `banjo_bot.rb:2523` | Placeholder |
| `badge` | `banjo_bot.rb:2576` | Placeholder |
| `token` | `banjo_bot.rb:2635` | Placeholder |
| `nft` | `banjo_bot.rb:2659` | Placeholder |
| `tt2x` | `banjo_bot.rb:2778` | Placeholder |
| `richlist` | `banjo_bot.rb:2951` | Placeholder |
| `staked` | `banjo_bot.rb:2985` | Placeholder |
| `scottags` | `banjo_bot.rb:3185` | Placeholder |
| `bidbots` | `banjo_bot.rb:3215` | Placeholder |
| `fear` / `greed` | `banjo_bot.rb:3468` | Placeholder |
| `predict` / `prediction` | `banjo_bot.rb:3993` | Placeholder |
| `nftsr` | `banjo_bot.rb:4062` | Placeholder |
| `ticker2` | `banjo_bot.rb:4109` | Placeholder |

### Media, Chat, And Utility

| Command | Legacy line | New status |
| --- | ---: | --- |
| `avatar` | `banjo_bot.rb:1104` | Placeholder |
| `wolframalpha` / `wa` / `wat` / `tr` | `banjo_bot.rb:1110` | Placeholder |
| `mempool` | `banjo_bot.rb:1126` | Placeholder |
| `carousel` | `banjo_bot.rb:1145` | Placeholder |
| `dilbert` | `banjo_bot.rb:1155` | Placeholder |
| `xkcd` | `banjo_bot.rb:1162` | Placeholder |
| `flounce` | `banjo_bot.rb:1184` | Placeholder |
| `snark` | `banjo_bot.rb:1195` | Placeholder |
| `alexa` | `banjo_bot.rb:1275` | Placeholder |
| `poll` | `banjo_bot.rb:1475` | Placeholder |
| `trail` | `banjo_bot.rb:1611` | Placeholder |
| `birthday` | `banjo_bot.rb:1615` | Placeholder |
| `regex` | `banjo_bot.rb:1718` | Placeholder |
| `voting` | `banjo_bot.rb:1751` | Placeholder |
| `payout` | `banjo_bot.rb:1797` | Placeholder |
| `flagwars` | `banjo_bot.rb:1803` | Placeholder |
| `poke` | `banjo_bot.rb:1807` | Placeholder |
| `ego` | `banjo_bot.rb:2157` | Placeholder |
| `play` | `banjo_bot.rb:2167` | Placeholder |
| `disconnect_voice` | `banjo_bot.rb:2171` | Placeholder |
| `top` | `banjo_bot.rb:2189` | Placeholder |
| `app` / `apps` | `banjo_bot.rb:2274` | Placeholder |
| `say` / `vo` | `banjo_bot.rb:3494` | Placeholder |

### Quick Links And Snarks

| Command | Legacy file | New status |
| --- | --- | --- |
| `banjo`, `faq`, `welcome`, `whitepaper`, `tools`, `github`, `releases` | `links.rb` | Ported scaffold |
| `scam`, `password`, `bandwagon`, `headphones`, `fallacy`, `music`, `watch` | `links.rb` | Placeholder/static partial |
| `make`, `sudo`, `donut`, `roll`, `lmgtfy`, `kappa`, `hydrogen` plus element aliases | `snarks.rb` | Ported scaffold partial |

## Assets

The legacy bot has 116 sound files under `support/sounds`. Voice playback should be ported only after the Discord client and deployment environment are stable because it adds native/audio dependencies.
