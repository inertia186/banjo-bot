# Banjo Bot

[![Node.js >=22](https://img.shields.io/badge/node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-5.8-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Discord.js](https://img.shields.io/badge/discord.js-14-5865f2?logo=discord&logoColor=white)](https://discord.js.org/)
[![License: CC0-1.0](https://img.shields.io/badge/license-CC0--1.0-lightgrey)](LICENSE)

Banjo is a modern reimplementation of the legacy Ruby Discord bot at:

`inertia186/banjo_bot`

The first milestone is parity scaffolding: preserve the legacy `$` command shape, isolate secrets in environment variables, and make each old feature portable into a small command module.

## Setup

Banjo requires Node.js 22 or newer. On a server with `nvm`:

```sh
nvm install
nvm use
node --version
```

```sh
npm ci
cp .env.example .env
npm run start
```

Required Discord intents:

- Guild messages
- Direct messages
- Message content
- Message reactions

## Development

```sh
npm ci
npm run dev
npm run check
```

If `npm run check` fails with `tsc: not found`, install dev dependencies before running checks. If npm warns about `EBADENGINE`, upgrade Node first:

```sh
npm ci --include=dev
```

If `nvm use 22` fails with `GLIBC_2.28 not found` or `GLIBCXX_3.4.26 not found`, the server OS is too old for the prebuilt Node.js 22 binary. Prefer upgrading the server OS, for example to Debian 12 / Ubuntu 22.04 or newer. On older ARM systems, a source build may work but can take a long time and needs compiler toolchain packages:

```sh
npm config delete prefix
nvm install -s 22
nvm use --delete-prefix 22
```

For a runtime-only deployment after checks have passed, production dependencies are enough:

```sh
npm ci --omit=dev
npm run start
```

## LLM Replies

Banjo can reply with a lightweight LLM when mentioned in a server or messaged in a DM.

```env
LLM_ENABLED=true
LLM_MODEL=gpt-4.1-mini
OPENAI_API_KEY=...
```

LLM replies are intentionally separate from `$` commands. They cannot run moderation, voting, wallet, or admin behavior.

For current Hive questions, Banjo can use Hyperion's authenticated unread digest as ambient context before falling back to public Hive RPC latest/trending posts.

```env
HYPERION_BASE_URL=https://www.hyperion.zone
HYPERION_BEARER_TOKEN=...
HYPERION_DIGEST_LIMIT=10
BANJO_OWNER_IDS=237384510096801792
```

To create or refresh the token, a configured owner can DM Banjo with `$hyperion-auth`, open the returned HiveSigner link privately, then paste back only the displayed `HYP-*` code as `$hyperion-auth HYP-...`. Never paste Hive keys, HiveSigner passwords, or signing credentials into Discord.

## Hive Commands

Banjo uses public Hive JSON-RPC nodes for read-only account commands like `$rep`, `$power`, `$proxy`, `$witness`, and `$avatar`.

```env
HIVE_NODES=https://api.hive.blog https://api.deathwing.me
HIVE_NODES_SOURCE_URL=https://developers.hive.io/quickstart/hive_full_nodes.html
COINGECKO_BASE_URL=https://api.coingecko.com/api/v3
```

Wildcard account lookups, such as `$mvests inertia*`, optionally use HiveSQL.

```env
HIVE_HISTORY_PROVIDER=hivesql
HIVESQL_ENABLED=true
HIVESQL_HOST=sql.hivesql.io
HIVESQL_DATABASE=DBHive
HIVESQL_USERNAME=...
HIVESQL_PASSWORD=...
HIVESQL_WILDCARD_LIMIT=50
```

Banjo can also use HafSQL for the first slice of historical reports: wildcard account expansion, delegation lookups, reward-claim summaries, account totals, and DHF proposal payment/update history. `$accounts` prefers HafSQL whenever it is configured, even if the default historical provider remains HiveSQL.

```env
HIVE_HISTORY_PROVIDER=hafsql
HAFSQL_ENABLED=true
HAFSQL_HOST=hafsql-sql.mahdiyari.info
HAFSQL_PORT=5432
HAFSQL_DATABASE=haf_block_log
HAFSQL_USERNAME=...
HAFSQL_PASSWORD=...
HAFSQL_SSL=false
HAFSQL_STATEMENT_TIMEOUT_MS=8000
HAFSQL_MAX_POOL_SIZE=3
```

### HiveSQL vs HafSQL

Banjo keeps both historical SQL adapters because they answer slightly different questions.

Use HafSQL when a command is naturally operation- or account-history-shaped: account expansion, vesting delegations, reward claims, account totals, proposal update/payment history, and other reports that benefit from HAF operation ids, block/timestamp slicing, or parsed chain-operation tables. HafSQL is also the preferred source for `$accounts` when configured.

Use HiveSQL when a command expects richer emulated state, especially final or current content-oriented records. HiveSQL is older and has a different design philosophy, but that can be useful for commands that want interpreted comment state after edits, content/tag search semantics, payout/app reports, promoted-post summaries, badge/follow conventions, or existing HiveSQL-specific report behavior.

Commands still backed only by HiveSQL, such as `$search`, `$top`, `$app`, `$promoted`, `$distribution`, and PeakD badge lookups, will report that HafSQL support is not implemented yet when `HIVE_HISTORY_PROVIDER=hafsql`. Some of these may move later after command-by-command parity checks rather than as a blanket adapter swap.

## Migration Notes

See [docs/migration.md](docs/migration.md) for the legacy command inventory and porting order.

See [docs/api-notes.md](docs/api-notes.md) for Hive API behavior learned while porting commands.

See [docs/embed-modernization-plan.md](docs/embed-modernization-plan.md) for the plan to modernize structured command output with Discord embeds.

See [docs/companion-spa.md](docs/companion-spa.md) for the planned maintainer SPA.

## License

CC0-1.0, matching the legacy Banjo bot.
