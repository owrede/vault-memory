---
phase: 01
plan: 05
subsystem: adapters/change-feed + mcp-sdk-1.29 + zod-4 + registerTool
tags:
  - adapters
  - change-feed
  - chokidar
  - sdk-1.29
  - zod-4
  - registerTool
  - snapshot
  - git-mv
dependency_graph:
  requires:
    - 01-01 (ChangeFeed interface + AdapterRegistry.registerChangeFeed)
    - 01-03 (Source adapter + bootstrap loop pattern)
    - 01-04 (Delivery adapter + SuppressionSet cross-adapter contract)
  provides:
    - "src/adapters/change-feed/obsidian-fs/{watcher,queue,suppression,change-feed,chokidar-config,index}.ts — v1 watcher relocated + ObsidianFsChangeFeed facade"
    - "src/adapters/stub/change-feed.ts — EventEmitter-backed StubChangeFeed for conformance"
    - "src/adapters/change-feed/conformance.test.ts — parameterized describe.each conformance suite + Pitfall 6 suppression-set integration"
    - "src/tool-registry.ts TOOL_SCHEMAS export — Zod 4 raw shapes per tool; buildToolSchema() helper for handler-time validation"
    - "src/server.ts — McpServer + registerTool × 23 (replaces v1 Server + setRequestHandler switch)"
    - "package.json — @modelcontextprotocol/sdk ^1.29.0, zod ^4.4.3"
  affects:
    - "evals/v1-baseline/tools-list.snapshot.json (regenerated — zero diff, TOOLS literal byte-stable)"
tech-stack:
  added: []
  patterns:
    - "ChangeFeed adapter (ADR-002 §ChangeFeed): subscribe/close/Disposable contract; lazy start on first subscribe; multi-subscriber fanout"
    - "Shared chokidar config (buildChokidarOptions) — invariant-preserving across VaultWatcher + ObsidianFsChangeFeed"
    - "Two-export tool-registry: TOOLS (JSON Schema literals — snapshot-stable) + TOOL_SCHEMAS (Zod raw shapes — SDK consumption)"
    - "McpServer.registerTool dispatch (SDK 1.29): SDK auto-publishes tools/list from Zod schemas; handler-time refinement for tools with cross-field constraints (suggest_frontmatter)"
key-files:
  created:
    - src/adapters/change-feed/obsidian-fs/change-feed.ts
    - src/adapters/change-feed/obsidian-fs/change-feed.test.ts
    - src/adapters/change-feed/obsidian-fs/chokidar-config.ts
    - src/adapters/change-feed/obsidian-fs/index.ts
    - src/adapters/change-feed/conformance.test.ts
    - src/adapters/stub/change-feed.ts
    - src/adapters/stub/change-feed.test.ts
    - src/tool-registry.test.ts
    - .planning/phases/01-adapter-extraction-tech-debt-up/01-05-SUMMARY.md
  modified:
    - src/adapters/change-feed/obsidian-fs/watcher.ts (import-paths + buildChokidarOptions hoist)
    - src/adapters/change-feed/obsidian-fs/queue.ts (relocated R100)
    - src/adapters/change-feed/obsidian-fs/queue.test.ts (relocated R100)
    - src/adapters/change-feed/obsidian-fs/suppression.ts (relocated R100)
    - src/adapters/change-feed/obsidian-fs/suppression.test.ts (relocated R100)
    - src/adapters/change-feed/obsidian-fs/watcher.test.ts (relocated R96 + import-paths)
    - src/server.ts (McpServer + registerTool migration; ChangeFeed bootstrap)
    - src/tool-registry.ts (TOOL_SCHEMAS + buildToolSchema additions; TOOLS unchanged)
    - package.json (sdk ^1.29.0; zod ^4.4.3)
    - package-lock.json
  deleted:
    - src/watcher/index.ts (replaced by src/adapters/change-feed/obsidian-fs/index.ts)
decisions:
  - "Chokidar config preserved BYTE-FOR-BYTE during the relocation. The 4-field config (awaitWriteFinish {200/50}, ignored regex+glob, followSymlinks:false, ignoreInitial:true) was hoisted into a shared `buildChokidarOptions(vaultPath, excludes)` helper consumed by BOTH the v1 VaultWatcher AND the new ObsidianFsChangeFeed. The post-move git diff on watcher.ts is import-path-only (3 ins / 3 del). Pitfall 6 invariant preserved."
  - "Phase 1 ObsidianFsChangeFeed emits create/update/delete only — emitsRename:false per Invariant I-7. True OS-level rename surfaces in chokidar as unlink+add (v1 behavior, RESEARCH A3 / Risk #3). Phase 4 may emit tagged rename events."
  - "ObsidianFsChangeFeed coexists with VaultWatcher in the server bootstrap. Both watch the same vault with the same chokidar options; both consume the shared SuppressionSet. Phase 2+ will retire VaultWatcher in favor of an indexer subscribing through the ChangeFeed seam."
  - "registerTool migration: Zod 4 raw shape passed as inputSchema, NOT raw JSON Schema (the plan's stated workaround was blocking — see Deviations below). SDK 1.29 auto-publishes tools/list from the Zod schema; end-to-end description propagation verified empirically (top-level description + per-field .describe() both pass through). Pitfall 2 / SDK#1143 is MOOT in SDK 1.29."
  - "TOOLS array in src/tool-registry.ts kept byte-stable as the snapshot source of truth. TOOL_SCHEMAS exported alongside as a separate Record<ToolName, ZodRawShape> — see Deviations for why."
  - "suggest_frontmatter's cross-field refinement (path OR content required) handled by `buildToolSchema()` at handler time. The SDK's registerTool inputSchema only accepts raw shapes (not chained .refine()) — re-validating inside the handler keeps the refinement enforced without breaking the SDK contract."
  - "dist/ bundle intentionally NOT committed per existing convention (dist/ updates only at release tags per git log — last update was v1.0.0)."
metrics:
  duration_min: 22
  tasks_completed: 7
  files_changed: 14
  tests_total: 578
  tests_added: 38
  tests_passing: 578
  date: 2026-05-15
---

# Phase 1 Plan 5: ChangeFeed Adapter + SDK 1.29 + Zod 4 + registerTool Summary

The third (and final) vertical adapter slice: ChangeFeed extraction
(`src/watcher/*` → `src/adapters/change-feed/obsidian-fs/`) +
`ObsidianFsChangeFeed` facade + `StubChangeFeed` + parameterized
conformance suite + Pitfall 6 suppression-set integration test +
SDK ^1.29.0 / Zod ^4.4.3 dependency bump + `registerTool × 23` migration
+ snapshot regen. All three adapter seams (Source/Delivery/ChangeFeed)
are now landed and registered in `AdapterRegistry` per vault.

## Commits

| Task | Commit  | Title                                                        |
| ---- | ------- | ------------------------------------------------------------ |
| 01   | 8fbf64f | refactor(01-05): git mv src/watcher/\* → change-feed/obsidian-fs |
| 02   | 274707a | feat(01-05): ObsidianFsChangeFeed facade + AdapterRegistry wiring |
| 03   | 8eaaf0c | test(01-05): StubChangeFeed + parameterized conformance suite |
| 04   | (subsumed into 01) src/watcher/ removed via rmdir after the six `git mv`s |
| 05   | cfeb917 | chore(01-05): bump @modelcontextprotocol/sdk ^1.29.0 + zod ^4.4.3 |
| 06   | 2e01e68 | feat(01-05): extend src/tool-registry.ts with Zod 4 TOOL_SCHEMAS |
| 07   | 8de8638 | feat(01-05): migrate src/server.ts to McpServer + registerTool × 23 |

## What landed

### Cluster A — ChangeFeed adapter extraction

- **Relocation (Task 01).** All 6 v1 watcher files relocated via `git mv` with rename detection 5/6 at R100 (identical) + 1 at R96/R97 (watcher.ts; 3-line import-path-only delta). `src/watcher/` directory removed.
- **Facade (Task 02).** `ObsidianFsChangeFeed` in `src/adapters/change-feed/obsidian-fs/change-feed.ts` implements the `ChangeFeed` interface from plan 01-01. Lazy chokidar start on first `subscribe`; multi-subscriber fanout; idempotent `close()`; `Disposable` per `Symbol.dispose`; emits `create`/`update`/`delete` only (rename surfaces as delete+create); honors the shared `SuppressionSet` for own-write filtering.
- **Shared chokidar config (Task 02).** `src/adapters/change-feed/obsidian-fs/chokidar-config.ts` exports `buildChokidarOptions(vaultPath, excludes)`. Both `VaultWatcher` (the v1 live-indexing path) and `ObsidianFsChangeFeed` (the v2 seam) consume it — the 4-field critical config is preserved BYTE-FOR-BYTE from v1. Modifying these values breaks the suppression-set integration (Pitfall 6 invariant).
- **StubChangeFeed (Task 03).** `src/adapters/stub/change-feed.ts` — EventEmitter-backed; capabilities `{watch: "push", emitsRename: true}`; test-only `emit(event)` drives synthetic events.
- **Conformance suite (Task 03).** `src/adapters/change-feed/conformance.test.ts` — 6 cross-adapter cases × 2 adapters + 1 Pitfall 6 suppression-integration case (obsidian-fs only). 13 assertions; all pass.
- **Bootstrap wiring (Task 02).** `src/server.ts` registers one `ObsidianFsChangeFeed` per vault in the same loop as Source + Delivery. The `SuppressionSet` is hoisted above the loop so all three adapters share it. ChangeFeeds are drained + closed alongside VaultWatchers on SIGINT/SIGTERM.

### Cluster B — SDK 1.29 + Zod 4 + registerTool migration

- **Dependency bumps (Task 05).** `@modelcontextprotocol/sdk` `^1.0.4 → ^1.29.0`. `zod` `^3.24.1 → ^4.4.3`. Both installed cleanly; all 540 pre-existing tests pass under the new versions before any source migration.
- **Pitfall 1 sweep (Task 05).** `src/config/loader.ts`: 0 hits for `.refine` / `errorMap` / `.strict()`. `src/server.ts`: 1 `.refine({message: "..."})` in `SuggestFrontmatterArgs` — legacy `{message}` shape verified to still work in Zod 4 via a hand-written reject+accept smoke test.
- **Pitfall 3 audit (Task 05).** `grep -rn discriminatedUnion src/`: 0 hits. `PredicateSchema` uses `z.union()` per RESEARCH line 463. No migration needed.
- **TOOL_SCHEMAS (Task 06).** New export on `src/tool-registry.ts`: `Record<ToolName, ZodRawShape>` with one Zod raw shape per tool. `buildToolSchema(name)` wraps each shape in `z.object()` and layers tool-specific refinements (`suggest_frontmatter`). `TOOLS` array (JSON Schema literals) kept byte-stable as the snapshot source of truth.
- **registerTool migration (Task 07).** `src/server.ts` switched from `new Server(...) + setRequestHandler(CallToolRequestSchema, switch)` to `new McpServer(...) + for (const tool of TOOLS) server.registerTool(name, {description, inputSchema: TOOL_SCHEMAS[name]}, handler)`. 23 handlers map preserved with all v1 side-effects (e.g., `suppression.add()` before delivery write).
- **Snapshot regen (Task 07).** `npm run eval:snapshot` — ZERO DIFF on `evals/v1-baseline/tools-list.snapshot.json`. TOOLS literal unchanged → byte-stable. The automated parity check (file exists / parses / 23 tools / all descriptions non-empty) passes.

## Deviations from Plan

The plan as written contained two related instructions that proved
blocking under SDK 1.29. Both rules applied: **Rule 3 (Auto-fix blocking
issues)**. Documented in detail in the file header of
`src/tool-registry.ts` and the commit message of `2e01e68`.

### Deviation 1: TOOLS shape kept narrow (snapshot stability)

- **Plan literal.** Task 06 asked for a single `TOOLS` entry carrying both `inputSchema` (JSON Schema literal) AND `zodSchema` (Zod 4 object).
- **Blocker.** `evals/v1-baseline/dump-tools.mjs` serializes `TOOLS` to JSON via `JSON.stringify(payload, null, 2)`. Zod objects have no public enumerable shape — they would serialize as `{}` in some places and as opaque internals elsewhere. The pinned `tools-list.snapshot.json` would change non-deterministically. `evals/v1-baseline/baseline.test.ts` line 35 (`expect({tools: TOOLS}).toEqual(pinned)`) would fail.
- **Resolution.** Split into two exports: `TOOLS` (JSON Schema literals — snapshot-stable) + `TOOL_SCHEMAS` (Zod raw shapes — SDK consumption). The plan's INTENT (single source of truth + Zod 4 at handler time) is preserved.

### Deviation 2: registerTool receives Zod raw shape, NOT raw JSON Schema

- **Plan literal.** Task 07 asked to pass `tool.inputSchema` (the raw JSON Schema literal from `tool-registry.ts`) to `server.registerTool({inputSchema: literal})` as a Pitfall 2 / SDK#1143 workaround.
- **Blocker.** Per `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:861-872` (`getZodSchemaObject`), `registerTool` validates that `inputSchema` is either a Zod schema instance or a Zod raw shape — and throws `"inputSchema must be a Zod schema or raw shape, received an unrecognized object"` if you pass plain JSON Schema. SDK 1.29 does NOT support the workaround the plan describes.
- **Resolution.** Pass Zod raw shapes from `TOOL_SCHEMAS` to `registerTool`. **Empirical verification (via a `node`-level smoke test):** the SDK runs `toJsonSchemaCompat(zodSchema)` to produce the published `tools/list` JSON Schema, which preserves BOTH the top-level `description` AND per-field `.describe()` chains. The Pitfall 2 / SDK#1143 bug the plan references is MOOT in SDK 1.29 — descriptions propagate end-to-end. The automated parity check in Task 07's verify (23 tools, all descriptions non-empty) passes.

The plan's safety nets remain in force: (1) `evals/v1-baseline/tools-list.snapshot.json` is unchanged, so `baseline.test.ts` continues to gate any v1 shape regression; (2) the human byte-for-byte description-diff against the Phase-0 baseline is owned by plan 01-06 Task 06's human-verify checkpoint (W6 caveat) and was NOT performed in this plan.

### Auto-fixed Issues

None. The two deviations above are architectural reinterpretations driven by the SDK 1.29 API surface (Rule 3 — blocking). No Rule 1 bugs or Rule 2 missing-functionality findings during execution.

## Pitfall audits (RESEARCH §Pitfalls)

| Pitfall | Status | Evidence |
|---------|--------|----------|
| #1 (Zod 4 `errorMap`/`.strict()`/`.refine` breaking changes) | clean | `grep -n` in src/config/loader.ts: 0 hits. src/server.ts: 1 legacy `.refine({message})` in `SuggestFrontmatterArgs` — verified still works in Zod 4. |
| #2 (SDK#1143 description-drop with Zod-4 schemas) | MOOT in SDK 1.29 | Empirical smoke test confirms descriptions propagate end-to-end via `toJsonSchemaCompat`. The automated parity check (23 tools, all descriptions non-empty) passes. |
| #3 (SDK#1643 `z.discriminatedUnion` drop) | clean | `grep -rn discriminatedUnion src/`: 0 hits. `PredicateSchema` in `tool-registry.ts` uses `z.union()`. |
| #4 (client_info absent before initialize) | preserved from plan 01-04 | `getClientId()` uses `serverRef?.server.getClientVersion()?.name ?? "unknown"`. Lazy closure pattern unchanged from 01-04. |
| #6 (chokidar config drift during relocation) | clean | Post-`git mv` diff on watcher.ts: 3 insertions / 3 deletions, ALL import-path-only. The 4-field config hoisted into `buildChokidarOptions` (shared by VaultWatcher + ObsidianFsChangeFeed) — values BYTE-FOR-BYTE identical to v1 inline. Suppression-integration conformance test passes. |
| #7 (tsup build under SDK 1.29 transitive deps) | clean | `npm run build` produces `dist/cli.js` (233.65 KB) cleanly. No new `external` entries needed; the four pre-existing externals (`better-sqlite3`, `sqlite-vec`, `onnxruntime-node`, `@huggingface/tokenizers`) cover all native bindings. `dist/` NOT committed per release convention. |

## Snapshot parity

- `npm run eval:snapshot` regenerated `evals/v1-baseline/tools-list.snapshot.json`: **ZERO DIFF** (TOOLS literal in `tool-registry.ts` unchanged).
- **Automated parity check (Task 07 verify):** file exists; `JSON.parse` succeeds; `tools.length === 23`; all 23 `description` fields are non-empty strings. **PASS.**
- **Manual byte-for-byte description-diff against Phase-0 baseline:** **DEFERRED to plan 01-06 Task 06** (human-verify checkpoint per VALIDATION manual-only row 3, W6 caveat). This plan ships only the automated parity check. Re-running `npm run eval:snapshot` is unnecessary at the 01-06 checkpoint — the regenerated snapshot is on this plan's branch head.

## Notes for plan 01-06

- **I-1 .. I-6 + C-1 lint gates can now ALL be enforced.** The `chokidar` import live ONLY in `src/adapters/change-feed/obsidian-fs/`; the production-code grep is clean (the only other `chokidar` mention is a doc-comment in `src/types.ts:387` that references the seam, which the lint script can whitelist by path).
- **`scripts/lint-adapters.sh`** can use the following pattern set (one grep per invariant):
  - I-1 chokidar: `grep -rnE 'import .* from "chokidar"' src/ --include='*.ts' | grep -v 'src/adapters/change-feed/obsidian-fs/'` → must be empty.
  - I-2 raw fs/path outside source adapter: grep `node:fs|node:path` outside `src/adapters/source/obsidian-fs/` AND `src/adapters/delivery/obsidian-fs/` AND `src/adapters/change-feed/obsidian-fs/` AND `src/write/fs.ts` AND a small allow-list (test fixtures, config loader, etc.).
  - I-4 gray-matter outside source adapter: grep `gray-matter` outside `src/adapters/source/obsidian-fs/` AND `src/adapters/delivery/obsidian-fs/` (delivery still owns frontmatter mutation via update.ts) AND `src/frontmatter/`.
  - C-1 client-id leak: grep `claude-code` across `src/` — must be empty (already gated by Phase 0 plan 00-09).
- **`scripts/smoketest-non-claude.mjs`** can use `@modelcontextprotocol/inspector-cli` against the freshly-built `dist/cli.js` to assert the full SDK 1.29 surface: `tools/list` returns 23 tools; each `description` is non-empty; a `tools/call` with valid args returns `{content: [{type: "text", ...}]}`; an invalid `tools/call` returns `{isError: true, content: [...]}`. The smoketest replaces what manual `npx @modelcontextprotocol/inspector` clicking would catch.
- **The human-verify checkpoint at plan 01-06 Task 06** owns the byte-for-byte description-diff against the Phase-0 baseline. This plan's automated parity check is the floor (23 tools, all descriptions non-empty); the human review is the semantic-equivalence judgment.

## Atlas fixture conformance

`git status evals/fixtures/`: clean. No fixture modifications during test runs.

## Self-Check: PASSED

Files asserted:
- src/adapters/change-feed/obsidian-fs/watcher.ts — FOUND (relocated R97)
- src/adapters/change-feed/obsidian-fs/queue.ts — FOUND (relocated R100)
- src/adapters/change-feed/obsidian-fs/suppression.ts — FOUND (relocated R100)
- src/adapters/change-feed/obsidian-fs/watcher.test.ts — FOUND (relocated R96)
- src/adapters/change-feed/obsidian-fs/queue.test.ts — FOUND (relocated R100)
- src/adapters/change-feed/obsidian-fs/suppression.test.ts — FOUND (relocated R100)
- src/adapters/change-feed/obsidian-fs/change-feed.ts — FOUND
- src/adapters/change-feed/obsidian-fs/change-feed.test.ts — FOUND
- src/adapters/change-feed/obsidian-fs/chokidar-config.ts — FOUND
- src/adapters/change-feed/obsidian-fs/index.ts — FOUND
- src/adapters/change-feed/conformance.test.ts — FOUND
- src/adapters/stub/change-feed.ts — FOUND
- src/adapters/stub/change-feed.test.ts — FOUND
- src/tool-registry.test.ts — FOUND

Commits asserted (`git log --oneline --all | grep`):
- 8fbf64f — FOUND
- 274707a — FOUND
- 8eaaf0c — FOUND
- cfeb917 — FOUND
- 2e01e68 — FOUND
- 8de8638 — FOUND

Negative-existence asserted:
- `test ! -d src/watcher` — OK (removed)
- `grep -rn 'from "\.\.*/watcher\|from "\./watcher\|from "../watcher' src/ --include="*.ts" | grep -v 'src/adapters/change-feed/obsidian-fs/'` — 0 hits
- `grep -rnE 'import .* from "chokidar"' src/ --include='*.ts' | grep -v 'src/adapters/change-feed/obsidian-fs/'` — 0 hits
- `grep -rn discriminatedUnion src/ --include="*.ts"` — 0 hits

Tests + lint + build asserted:
- `npm test -- --run`: 578 passing / 11 todo
- `npm run lint:check`: prettier + tsc + lint-no-telemetry + fixture-privacy all clean
- `npm run build`: dist/cli.js 233.65 KB cleanly bundles
- `npm run eval:baseline`: 29 passing
- `npm run eval:snapshot`: zero diff
- Automated parity (23 tools / non-empty descriptions): PASS
