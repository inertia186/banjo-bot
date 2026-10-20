# Banjo cleanup ledger

Audit base: `origin/main` at `4ceb797af13080e756d26b6f8ba255d838f3e861`, fetched on 2026-10-20.
Branch: `ponytail/audit-cleanup`. Anthony authorized should-fix audit items 1–3 and a pull request.

## Baseline

Node 22.22.0: source typecheck passed in 1.16 s; test typecheck passed in 1.11 s;
all 142 tests passed in 0.89 s, with no failures or skips. The compiler emitted
no diagnostics. Green means both typechecks pass and every retained behavior
test passes; deleting HAFBE intentionally removes its four obsolete tests.
The initial baseline reused the existing installed dependencies. Final checks
used a clean `npm ci --no-audit --no-fund` from the committed lockfile in the
isolated checkout; neither package file changed.

The source has 37 TypeScript files / 11,939 lines and 19 test files / 6,283 lines.
There are six runtime and four development dependencies. Generated lockfile
contents, node_modules, external reference text, and binary image contents are
excluded from source-debt measurements. No committed changes occurred in the
60 days before this audit; this branch does not infer age from that quiet period.

## Authorized ledger

### 1. Unused HAFBE adapter — complete

The unreachable client has 82 lines and its dedicated tests have 185 lines.
Its config field also appears in twelve complete test fixtures.

- ceiling: config and test maintenance for a client the bot never constructs.
- upgrade: remove the adapter, dedicated tests, environment setting, and config fields; retain the documented Hive RPC semantics for `$first`.
- owner: Anthony. Approved removal passed the combined source/test typecheck and all 138 retained tests; four HAFBE-only tests were intentionally removed.

### 2. Copied test defaults — complete

Twelve 68-line AppConfig literals repeat 816 lines before removing HAFBE.

- ceiling: every new config field requires unrelated test edits.
- upgrade: one factory returning fresh, safe test defaults and explicit per-test overrides.
- owner: Anthony. All eleven retained fixture values matched their originals exactly. A new test proves mutable defaults are independent; the combined typecheck and all 139 tests passed.

### 3. Mixed Hive command features — complete

`src/commands/hive.ts` has 4,873 lines and 262 functions covering unrelated features.

- ceiling: proposal and search work shares a file with account reports, token math, and NFT controls.
- upgrade: move proposal and search command logic, state, rendering, and handlers into focused modules without changing their behavior.
- owner: Anthony. Search and proposal/approval features now own their command logic, caches, rendering, and handlers. Existing shared functions live in a 196-line support module. All 284 declarations and all 45 Hive command definitions/order matched the originals; the combined typecheck and all 139 tests passed. The registry module fell from 4,873 to 3,148 lines.

## Second look

The reuse-family check found nearest-twin similarity of 0.03 in both source
families; neither is evidence of another shared implementation. No remaining
HAFBE runtime/config references or new unused-import diagnostics were found.
The optional unused-declaration check still reports three pre-existing unused
parameters/properties. There are no shortcut, TODO, or debug-statement markers
in source, tests, or scripts. Binary assets and the existing UI helper copies
remain outside the approved slice. No application HTML/CSS or generated
application bundle exists to simplify; imports and tests check the module list.
No deterministic PR review script exists. Proposed future diff-only checks are
new parked-copy filenames and newly copied complete test-config literals; this
cleanup does not introduce a CI framework solely to enforce them.

## Final validation and totals

After the clean install, `npm run check` passed on Node 22.22.0 in 3.91 s:
both typechecks passed and all 139 tests passed, with no failures or skips.
Four HAFBE-only tests were removed and one test for independent fixture defaults
was added. The changes remove 897 TypeScript lines net, including tests, with
no dependency additions or removals. All three authorized rows are complete;
the checks below remain decisions outside this slice. The HTML audit snapshot
is an untracked review artifact.

## Checked and left alone

- Both SQL adapters: documented differences in supported history and content semantics.
- Disabled legacy command names: required compatibility responses.
- Service interfaces: exercised by injected test clients.
- Unused legacy images and duplicate UI helpers: audit nice-to-haves, outside this approved slice.
- SQL pool lifetime, ignored LLM_MAX_HISTORY, and HTTP request deadlines: separately reported correctness work, outside this cleanup.
- Main-checkout package edits, lockfile edits, and logo: preserved outside this branch.
