# Banjo Bot

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

## Hive Commands

Banjo uses public Hive JSON-RPC nodes for read-only account commands like `$rep`, `$power`, `$proxy`, `$witness`, and `$avatar`.

```env
HIVE_NODES=https://api.hive.blog https://api.deathwing.me
HIVE_NODES_SOURCE_URL=https://developers.hive.io/quickstart/hive_full_nodes.html
COINGECKO_BASE_URL=https://api.coingecko.com/api/v3
```

Wildcard account lookups, such as `$mvests inertia*`, optionally use HiveSQL.

```env
HIVESQL_ENABLED=true
HIVESQL_HOST=sql.hivesql.io
HIVESQL_DATABASE=DBHive
HIVESQL_USERNAME=...
HIVESQL_PASSWORD=...
HIVESQL_WILDCARD_LIMIT=50
```

## Migration Notes

See [docs/migration.md](docs/migration.md) for the legacy command inventory and porting order.

See [docs/api-notes.md](docs/api-notes.md) for Hive API behavior learned while porting commands.

See [docs/companion-spa.md](docs/companion-spa.md) for the planned maintainer SPA.

## License

CC0-1.0, matching the legacy Banjo bot.
