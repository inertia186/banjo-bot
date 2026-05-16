# Banjo Bot

Banjo is a modern reimplementation of the legacy Ruby Discord bot at:

`inertia186/banjo_bot`

The first milestone is parity scaffolding: preserve the legacy `$` command shape, isolate secrets in environment variables, and make each old feature portable into a small command module.

## Setup

```sh
npm install
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
npm run dev
npm run check
```

## LLM Replies

Banjo can reply with a lightweight LLM when mentioned in a server or messaged in a DM.

```env
LLM_ENABLED=true
LLM_MODEL=gpt-4.1-mini
OPENAI_API_KEY=...
```

LLM replies are intentionally separate from `$` commands. They cannot run moderation, voting, wallet, or admin behavior.

## Migration Notes

See [docs/migration.md](docs/migration.md) for the legacy command inventory and porting order.

## License

CC0-1.0, matching the legacy Banjo bot.
