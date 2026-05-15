---
phase: 02-memory-namespace-provenance-contract
plan: 15
subsystem: memory-namespace
tags:
  - gap-closure
  - info-polish
  - public-surface
  - observability
  - configurability
gap_closure: true
resolves: [IN-01, IN-02, IN-03, IN-05]
requires: [02-08]
provides:
  - hot-path-annotation-decomposeDocId
  - deep-import-only-__clearContractCache
  - truncated-marker-on-memory-stats
  - MEMORY_AUTO_DISCOVERY_FOLDER-constant
affects:
  - src/adapters/registry.ts
  - src/memory/contract/index.ts
  - src/memory/contract/__testing__.ts
  - src/memory/contract/__testing__.test.ts
  - src/memory/contract/loader.test.ts
  - src/memory/resources/memory-stats.ts
  - src/memory/resources/memory-stats.test.ts
  - src/db/queries/notes.ts
  - src/server.ts
tech_stack:
  added: []
  patterns:
    - deep-import-only access control for test-only symbols
    - "exit-marker on bounded scan (truncated:true) for observable cap-hit"
    - "exported named constant in lieu of a bare string literal for convention surface"
key_files:
  created:
    - src/memory/contract/__testing__.ts
    - src/memory/contract/__testing__.test.ts
    - .planning/phases/02-memory-namespace-provenance-contract/02-15-SUMMARY.md
  modified:
    - src/adapters/registry.ts
    - src/memory/contract/index.ts
    - src/memory/contract/loader.test.ts
    - src/memory/resources/memory-stats.ts
    - src/memory/resources/memory-stats.test.ts
    - src/db/queries/notes.ts
    - src/server.ts
decisions:
  - "IN-01: keep the defensive parseDocId() call inside decomposeDocId — annotate as @internal perf note rather than remove. The cost is one regex test per call; the safety net catches `as DocId` smuggling in test code."
  - "IN-02: move __clearContractCache to a deep-import module at src/memory/contract/__testing__.ts. The lack of a re-export from the public barrel is the access control. No bundler-level hiding needed."
  - "IN-03: emit truncated:true on the MemoryStatsEntry when listByPathPrefix returns rows.length >= LIST_BY_PATH_PREFIX_DEFAULT_LIMIT. Lower change-surface than rewriting aggregation as SQL GROUP BY; the cap stays 10_000."
  - "IN-05: surface the auto-discovery folder name as the exported constant MEMORY_AUTO_DISCOVERY_FOLDER; users who want a different folder configure [[memory_sinks]] explicitly."
metrics:
  duration: "~10min"
  tasks_completed: 4
  files_created: 2
  files_modified: 7
  commits: 4
  tests_total: 828
  tests_passing: 828
  tests_todo: 11
completed_at: 2026-05-16
---

# Phase 02 Plan 15: Info-Level Polish (IN-01, IN-02, IN-03, IN-05) Summary

Closed four info-level findings from `02-REVIEW.md`: defensive `decomposeDocId` annotated as a hot-path perf note; `__clearContractCache` moved off the public barrel to a deep-import `__testing__.ts`; `memory-stats` now surfaces a `truncated: true` marker when the bounded `listByPathPrefix` scan hits its 10_000-row cap; auto-discovery folder name `"_memory"` lifted into an exported `MEMORY_AUTO_DISCOVERY_FOLDER` constant.

## What Was Built

### Task 1 — IN-01: annotate `decomposeDocId` hot path
- Added an `@internal` perf-note paragraph to the TSDoc of `decomposeDocId` in `src/adapters/registry.ts` documenting why the defensive `parseDocId(docId)` call stays and naming the call site (`MemorySinkRegistry.findSinkContaining`) where memoization would attach if measurement ever justifies it.
- No behavior change. Existing 37 registry tests pass (including the `"rejects a string cast to DocId that does not match the regex"` test, which relies on the defensive parse).

### Task 2 — IN-02: deep-import-only `__clearContractCache`
- Created `src/memory/contract/__testing__.ts` that re-implements the previous `__clearContractCache` (clear loader cache, re-seed `DEFAULT_MEMORY_V1`).
- Removed `__clearContractCache` from `src/memory/contract/index.ts` (the public barrel) and replaced the function block with a comment recording the closure rationale.
- Verified `src/memory/index.ts` aggregate barrel never re-exported the symbol (was already absent — confirmed by grep).
- Updated the existing consumer `src/memory/contract/loader.test.ts` to import `__clearContractCache` from `./__testing__.js`.
- Added a one-test regression file `src/memory/contract/__testing__.test.ts` that asserts the deep-import path is the supported surface and the clear-and-re-seed behavior is preserved.

### Task 3 — IN-03: `truncated: true` marker on memory-stats cap-hit
- Exported `LIST_BY_PATH_PREFIX_DEFAULT_LIMIT` (10_000) from `src/db/queries/notes.ts`. The `listByPathPrefix` default parameter now references the constant — single source of truth.
- Extended `MemoryStatsEntry` with `truncated?: boolean`.
- `readMemoryStats` now hoists `listByPathPrefix(prefix)` to a local `rows` variable, computes `truncated = rows.length >= LIST_BY_PATH_PREFIX_DEFAULT_LIMIT`, and emits `truncated: true` on the entry conditionally. `doc_count` continues to come from the unbounded `countByPathPrefix`, so a truncated entry shows `doc_count > Σ by_type` — the marker explains the inconsistency.
- Two new tests: a cap-hit case using `vi.spyOn(db.notes, "listByPathPrefix")` plus `vi.spyOn(db.notes, "countByPathPrefix")` to fabricate a cap-hit without seeding 10_000 real rows; a negative control on a five-doc sink confirming the marker is omitted (`undefined`).

### Task 4 — IN-05: `MEMORY_AUTO_DISCOVERY_FOLDER` exported constant
- Added `export const MEMORY_AUTO_DISCOVERY_FOLDER = "_memory"` near `discoverMemorySinks` in `src/server.ts`.
- Replaced both literal occurrences inside `discoverMemorySinks` (`sentinelExistsAt(v.path, "_memory")` and the handle template `` `obsidian-fs://${v.name}/_memory/` ``) with references to the constant.
- Updated the TSDoc of both the constant and `discoverMemorySinks` to reference the constant by name. The only `"_memory"` literal remaining in `src/server.ts` is the constant declaration itself.
- Behavior is byte-equal: auto-discovery still scans for `_memory/.memory-sink` and synthesizes the same default sink handle. The 38-test `src/server.test.ts` suite (including the auto-discovery test) passes unchanged.

## How It Works

### Hot-path annotation (IN-01)
`decomposeDocId` re-runs the `DOC_ID_PATTERN` regex via `parseDocId(docId)` even though the `DocId` brand should guarantee shape. The cost is bounded — one regex test per invocation — but `MemorySinkRegistry.findSinkContaining` invokes it per registered sink per validator call, so a hot loop in a future plan could surface it. The annotation makes the trade-off discoverable and names the memoization hook point (here, not at the call site) without removing the safety net.

### Deep-import access control (IN-02)
The public barrel `src/memory/contract/index.ts` exposes `getContract`, `loadContractFromDisk`, `DEFAULT_MEMORY_V1`, and the two error classes. It no longer re-exports `__clearContractCache`. Tests that need to clear the cache must reach into `src/memory/contract/__testing__.ts` directly — the path itself is the access marker. TypeScript's `verbatimModuleSyntax` + ESM resolution means the deep import is explicit at the call site (`from "./__testing__.js"`). The aggregate `src/memory/index.ts` barrel was already not re-exporting the symbol.

### `truncated` marker (IN-03)
`MemoryStatsEntry.doc_count` is the accurate count from `countByPathPrefix` (SQL `COUNT(*)`, no row materialization). The `by_type` / `by_status` aggregates are computed by iterating the row payloads returned from `listByPathPrefix`, which is capped at `LIST_BY_PATH_PREFIX_DEFAULT_LIMIT = 10_000` to prevent pathological memory usage. When the cap is hit, `Σ by_type` undercounts by `doc_count - 10_000`. The new `truncated: true` field surfaces that condition so clients can decide whether to widen the sink, accept the undercount, or trigger a remediation flow.

### Auto-discovery convention surface (IN-05)
The auto-discovery folder is a convention, not a hard requirement — users can configure `[[memory_sinks]]` with any folder shape they like, and explicit configuration short-circuits auto-discovery entirely. Surfacing the default name as an exported constant makes the convention discoverable from outside the file without changing the rule. Tests / future tools can reference `MEMORY_AUTO_DISCOVERY_FOLDER` instead of duplicating the string.

## Files Changed

| File | Change |
|------|--------|
| `src/adapters/registry.ts` | Added `@internal` perf-note paragraph on `decomposeDocId` TSDoc. |
| `src/memory/contract/__testing__.ts` (new) | Deep-import-only `__clearContractCache`. |
| `src/memory/contract/__testing__.test.ts` (new) | One regression test asserting the deep-import path. |
| `src/memory/contract/index.ts` | Removed `__clearContractCache` re-export; replaced with comment recording IN-02 closure. |
| `src/memory/contract/loader.test.ts` | Re-pointed `__clearContractCache` import to `./__testing__.js`. |
| `src/db/queries/notes.ts` | Exported `LIST_BY_PATH_PREFIX_DEFAULT_LIMIT`; `listByPathPrefix` default references the constant. |
| `src/memory/resources/memory-stats.ts` | `MemoryStatsEntry.truncated?: boolean`; `readMemoryStats` emits the marker on cap-hit. |
| `src/memory/resources/memory-stats.test.ts` | Two new tests (cap-hit + negative control). |
| `src/server.ts` | `MEMORY_AUTO_DISCOVERY_FOLDER` constant; both literals replaced with references. |

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| `cb62387` | docs | docs(02-15): annotate decomposeDocId hot path (IN-01) |
| `583da11` | refactor | refactor(02-15): move __clearContractCache to deep-import module (IN-02) |
| `f16a200` | feat | feat(02-15): emit truncated marker on memory-stats cap-hit (IN-03) |
| `b2d8272` | refactor | refactor(02-15): surface MEMORY_AUTO_DISCOVERY_FOLDER constant (IN-05) |

## Verification

- `npx tsc --noEmit` → clean.
- `npx vitest run --no-coverage src/adapters/registry.test.ts` → 37/37 passing.
- `npx vitest run --no-coverage src/memory/contract/` → 31/31 passing (incl. new `__testing__.test.ts`).
- `npx vitest run --no-coverage src/memory/resources/memory-stats.test.ts` → 7/7 passing (5 prior + 2 new IN-03 tests).
- `npx vitest run --no-coverage src/server.test.ts` → 38/38 passing.
- `npm test` → **828 passing / 11 todo across 69 test files** (above the 825+ floor).
- `bash scripts/lint-adapters.sh` → all adapter-seam invariants green (I-1..I-6, I-5b, C-1).

## Deviations from Plan

None — plan executed exactly as written. The plan-level "Picked: emit truncated on the entry" path was followed for IN-03 (the lower-change-surface route); the alternative (SQL `GROUP BY` aggregation) was explicitly out of scope.

## Acceptance Criteria

- [x] IN-01: `decomposeDocId` TSDoc carries the `@internal Perf note (IN-01)` paragraph; regex call remains in place; behavior byte-equal.
- [x] IN-02: `grep -nE "__clearContractCache" src/memory/contract/index.ts` returns zero export matches (only a comment mentioning the symbol's new home). The deep-import module exists; aggregate `src/memory/index.ts` does not re-export. All test consumers updated.
- [x] IN-03: `LIST_BY_PATH_PREFIX_DEFAULT_LIMIT` exported with two references in `notes.ts`; `truncated` field on `MemoryStatsEntry`; new cap-hit + negative-control tests pass.
- [x] IN-05: `MEMORY_AUTO_DISCOVERY_FOLDER` exported with three usages in `server.ts` (declaration + two references); the only `"_memory"` literal that remains is the constant declaration itself.
- [x] `npm test` reports 828 passing — no regression from the 825+ floor.
- [x] `STATE.md` / `ROADMAP.md` untouched (per parallel-executor contract).

## Self-Check: PASSED

- `src/adapters/registry.ts`: contains `@internal Perf note (IN-01)` — FOUND.
- `src/memory/contract/__testing__.ts`: exists — FOUND.
- `src/memory/contract/__testing__.test.ts`: exists — FOUND.
- `src/memory/contract/index.ts`: no `__clearContractCache` export — VERIFIED (only a comment string matches).
- `src/memory/index.ts`: no `__clearContractCache` reference — VERIFIED.
- `src/memory/resources/memory-stats.ts`: contains `truncated` field + setter — FOUND.
- `src/db/queries/notes.ts`: exports `LIST_BY_PATH_PREFIX_DEFAULT_LIMIT` — FOUND.
- `src/server.ts`: exports `MEMORY_AUTO_DISCOVERY_FOLDER`, used twice in `discoverMemorySinks` — FOUND.
- Commits `cb62387`, `583da11`, `f16a200`, `b2d8272` in `git log` — FOUND.
