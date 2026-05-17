# Companion SPA Plan

Banjo can grow a small companion SPA without turning the Discord bot into a web app. The bot should remain the runtime worker; the SPA should be a visibility and maintenance surface for people porting, deploying, and checking the bot.

## Goals

- Show the registered command catalog with categories, aliases, usage, and porting status.
- Make migration progress easy to scan without reading the whole legacy inventory.
- Surface safe diagnostics for deployment: bot version, configured prefix, Hive RPC node health, and whether optional features are enabled.
- Inventory vendored legacy assets, including images now in `assets/images` and future sound files if voice playback is restored.
- Keep mutating bot behavior out of the first version.

## Non-Goals For The First Version

- No Discord OAuth or admin panel.
- No live command execution from the browser.
- No secret display, token editing, voting, wallet, moderation, or account registration actions.
- No replacement for Discord logs or production observability tools.

## Shape

Use a Vite SPA in `web/`, preferably React + TypeScript to match the bot toolchain. Keep shared metadata in plain TypeScript modules that can be imported by both the bot and the SPA.

Suggested structure:

```text
src/
  commands/
  hive/
web/
  src/
  index.html
docs/
  companion-spa.md
assets/
  images/
```

The first version can be static. A later version can add a small read-only HTTP API if live state becomes useful.

## First Screens

1. Commands
   - Searchable table grouped by `core`, `links`, `snarks`, `hive`, and `legacy`.
   - Show command name, aliases, usage, description, and status.
   - Flag commands that still return placeholders.

2. Migration
   - Summarize counts by status: ported, scaffolded, placeholder, disabled.
   - Link back to `docs/migration.md` for the full inventory.
   - Show the next suggested porting group.

3. Health
   - Show non-secret config: prefix, enabled optional features, configured Hive RPC nodes.
   - Probe Hive nodes through a read-only server endpoint later, not from static browser code unless CORS is confirmed.
   - Show API compatibility notes, like `reputation_api` fallback to `condenser_api`.

4. Assets
   - List vendored image assets and their command usage.
   - Later, list legacy sound files and whether each one has been ported.

5. Prediction Markets
   - Explore whether Banjo can provide lightweight Dublup market views or helper operations.
   - Prefer direct Hive Engine / blockchain reads, using `hive-engine/dublup-backend` as implementation reference.
   - Keep any write or trading operations out of scope until authentication, authorization, signing, and audit boundaries are designed.

## API Boundary

Start static. Add an API only when the SPA needs runtime information that cannot be bundled at build time.

Potential read-only endpoints:

```text
GET /api/status
GET /api/commands
GET /api/assets
GET /api/hive/nodes
```

Do not add write endpoints until there is authentication, authorization, audit logging, and a clear deployment model.

## Metadata Refactor

The bot currently keeps command metadata in executable command modules. That is fine for Discord, but the SPA will want metadata without importing Discord runtime details.

Incremental path:

1. Keep the current command modules.
2. Add a command manifest helper that extracts safe fields from registered commands.
3. When needed, split pure metadata from executors:

```text
command metadata -> shared manifest
command executors -> bot runtime only
```

This avoids a big refactor before the SPA proves useful.

## Build Path

1. Add `web/` with Vite, React, TypeScript, and a basic shell.
2. Add `npm` scripts:
   - `web:dev`
   - `web:build`
   - `web:check`
3. Add command manifest generation or shared import.
4. Build the Commands screen first.
5. Add Migration and Assets screens from static repo data.
6. Add read-only Health API only after the static screens are useful.

## Design Notes

- This is an operator and maintainer tool, not a marketing site.
- Favor dense, scannable tables and compact panels.
- Use restrained styling, clear status chips, and predictable navigation.
- Avoid hiding important command details behind cards-within-cards or decorative dashboard chrome.

## Open Questions

- Should the SPA be served by the bot process, a separate static host, or only run locally for maintainers?
- Should command status live in `docs/migration.md`, a JSON manifest, or command metadata?
- Should the health API probe public Hive nodes on demand, on an interval, or only at startup?
- Do we want the asset inventory to include hashes so legacy files can be verified against the Ruby checkout?
