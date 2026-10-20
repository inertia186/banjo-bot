# Banjo cleanup ledger

Audit base: `origin/main` at `4ceb797af13080e756d26b6f8ba255d838f3e861`, fetched on 2026-10-20.
Branch: `ponytail/audit-cleanup`. Anthony authorized should-fix audit items 1–3 and a pull request.

## Baseline

Node 22.22.0: source typecheck passed in 1.16 s; test typecheck passed in 1.11 s;
all 142 tests passed in 0.89 s, with no failures or skips. The compiler emitted
no diagnostics. Green means both typechecks pass and every retained behavior
test passes; deleting HAFBE intentionally removes its four obsolete tests.
The initial baseline reused the existing installed dependencies; final checks
will also verify the committed lockfile in this isolated checkout.

The source has 37 TypeScript files / 11,939 lines and 19 test files / 6,283 lines.
There are six runtime and four development dependencies. Generated lockfile
contents, node_modules, external reference text, and binary image contents are
excluded from source-debt measurements. No committed changes occurred in the
60 days before this audit; this branch does not infer age from that quiet period.

## Authorized ledger

### 1. Unused HAFBE adapter — planned

The unreachable client has 82 lines and its dedicated tests have 185 lines.
Its config field also appears in twelve complete test fixtures.

- ceiling: config and test maintenance for a client the bot never constructs.
- upgrade: remove the adapter, dedicated tests, environment setting, and config fields; retain the documented Hive RPC semantics for `$first`.
- owner: Anthony. Trigger: approved cleanup; complete after checks pass.

### 2. Copied test defaults — planned

Twelve 68-line AppConfig literals repeat 816 lines before removing HAFBE.

- ceiling: every new config field requires unrelated test edits.
- upgrade: one factory returning fresh, safe test defaults and explicit per-test overrides.
- owner: Anthony. Trigger: approved cleanup; preserve fixture values and prove mutable defaults are independent.

### 3. Mixed Hive command features — planned

`src/commands/hive.ts` has 4,873 lines and 262 functions covering unrelated features.

- ceiling: proposal and search work shares a file with account reports, token math, and NFT controls.
- upgrade: move proposal and search command logic, state, rendering, and handlers into focused modules without changing their behavior.
- owner: Anthony. Trigger: approved cleanup; preserve all retained command and interaction tests.

## Second look

Pending: inspect remaining references and run the audit workflow's reuse-family check.
No deterministic PR review script exists. Proposed future diff-only checks are
new parked-copy filenames and newly copied complete test-config literals; this
cleanup does not introduce a CI framework solely to enforce them.

## Checked and left alone

- Both SQL adapters: documented differences in supported history and content semantics.
- Disabled legacy command names: required compatibility responses.
- Service interfaces: exercised by injected test clients.
- Unused legacy images and duplicate UI helpers: audit nice-to-haves, outside this approved slice.
- SQL pool lifetime, ignored LLM_MAX_HISTORY, and HTTP request deadlines: separately reported correctness work, outside this cleanup.
- Main-checkout package edits, lockfile edits, and logo: preserved outside this branch.
