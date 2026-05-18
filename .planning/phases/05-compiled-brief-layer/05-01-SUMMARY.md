---
phase: 05-compiled-brief-layer
plan: 01
subsystem: database
tags: [sqlite, migration, zod, sha256, mcp-resources, memory-contract]

# Dependency graph
requires:
  - phase: 02-memory-namespace-provenance-contract
    provides: MemoryContract registry, supersede tool, MemorySink validator
  - phase: 03-bundles-authority-staleness
    provides: citation packet shape, default-hidden superseded filter
  - phase: 04-graph-as-retrieval
    provides: edges table substrate, unified-parse indexer (wikilink back-edges)
provides:
  - "Migration 013: chunks.chunk_id_fragment column + brief_sources + daemon_state tables"
  - "computeChunkHash / computeChunkIdFragment canonical helpers (single source of truth)"
  - "src/brief/ barrel with ChunkId brand, formatChunkId / parseChunkId / decomposeChunkId, buildSourceHashes, recomputeCurrentHash"
  - "default-brief-v1 MemoryContract registered alongside default-memory-v1"
  - "Sub-folder MemorySink ordering enforced at config-loader (longest-resource first)"
  - "ChunkId / BriefStatus / BriefSourceHash / Brief / BriefConfig types exported from src/types.ts"
  - "RESOURCE_URI_LIST_BRIEFS constant for slice 4"
  - "ADR-005 brief compile strategy (LLM ladder, ChunkId, recompile chain, lockfile carve-out)"
affects: [05-02-compile-get, 05-03-daemon-validator-lock, 05-04-resources-evals]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single source of truth for chunk-hash canonicalization (computeChunkHash in src/chunker/chunk-id.ts)"
    - "IIFE-closed brand minting for ChunkId (mirrors src/adapters/registry.ts)"
    - "Path-specificity sink ordering at config-loader (stable sort by resource length)"
    - "Wave 0 stub files with it.skip() so later slices fill them without scaffolding"

key-files:
  created:
    - docs/v2/adr/005-brief-compile-strategy.md
    - src/chunker/chunk-id.ts
    - src/chunker/chunk-id.test.ts
    - src/db/queries/brief_sources.ts
    - src/db/queries/brief_sources.test.ts
    - src/db/queries/daemon_state.ts
    - src/db/queries/daemon_state.test.ts
    - src/db/migration-013.test.ts
    - src/brief/chunk-id.ts
    - src/brief/chunk-id.test.ts
    - src/brief/source-hashes.ts
    - src/brief/source-hashes.test.ts
    - src/brief/index.ts
    - src/brief/compile.test.ts
    - src/brief/get.test.ts
    - src/brief/body-validator.test.ts
    - src/brief/daemon.test.ts
    - src/brief/lock.test.ts
    - src/brief/resources.test.ts
    - src/memory/contract/default-brief-v1.ts
    - src/memory/contract/default-brief-v1.test.ts
    - evals/fixtures/v2-test-vault/_queries/briefs-curated.yaml
    - evals/fixtures/v2-test-vault/_queries/briefs-from-cluster.yaml
    - evals/fixtures/v2-test-vault/_queries/briefs-staleness-stub.yaml
  modified:
    - src/db/schema.ts
    - src/db/database.ts
    - src/db/queries/chunks.ts
    - src/indexer/indexer.ts
    - src/indexer/single.ts
    - src/types.ts
    - src/memory/contract/index.ts
    - src/memory/resources/index.ts
    - src/config/loader.ts
    - src/config/loader.test.ts

key-decisions:
  - "Migration numbered 013 (not 012) — Phase 4 CR-01 already shipped 012"
  - "default-brief-v1 is a NEW contract, NOT a widening of default-memory-v1 (Pitfall 1 resolution per ADR-005)"
  - "Sub-folder sink ordering enforced at config-loader level (longest resource-length first, stable sort) instead of registry-level so users don't have to remember the TOML ordering rule"
  - "ChunkInput.chunkIdFragment marked optional with insertBatch fallback to computeChunkIdFragment — keeps existing test fixtures compatible while production call sites (indexer / single-indexer) pass canonical values explicitly"
  - "buildSourceHashes accepts ChunkSource[] (pure-function shape) instead of taking Vault + DocId[] — decouples the contract from the notes+chunks DB join, which lives in slice 2 alongside compile_brief"
  - "default-brief-v1 naming.strategy = caller-provided (MemoryContract enum does not include slug-timestamp; compile_brief mints the D-12 timestamped slug itself)"

patterns-established:
  - "Canonical chunk-hash helper: src/chunker/chunk-id.ts is the SOLE site that calls createHash for chunk-fragment computation (RESEARCH §Pitfall 14 prohibits scattered calls)"
  - "Brief module barrel src/brief/index.ts grows incrementally across slices 1–4; later slices add to the barrel without scaffolding rework"
  - "Wave 0 test stubs use describe + it.skip rather than empty describe (vitest treats empty describe as a failure)"
  - "[brief.ollama] config block is fully optional and backwards-compatible — existing v1.x configs parse unchanged"

requirements-completed: [BRF-01, BRF-02]

# Metrics
duration: 17min
completed: 2026-05-18
---

# Phase 5 Plan 01: Foundations Summary

**Migration 013 + ADR-005 + brief module substrate — content-stable chunk identity, brief_sources reverse-index, daemon_state cursor, default-brief-v1 contract, and sub-folder sink ordering all primed for slices 2-4 (no MCP surface change yet).**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-05-18T10:01:00Z (approx — after worktree checkout)
- **Completed:** 2026-05-18T10:18:27Z
- **Tasks:** 4 / 4
- **Files created:** 24
- **Files modified:** 10
- **Tests:** 1281 passed | 17 skipped (was 1221 + 11 baseline; +60 new tests, 6 of which are Wave 0 skipped stubs)

## Accomplishments

- **ADR-005** authored BEFORE any `src/brief/*.ts` implementation (matches Phase 0/2/4 discipline). Documents the capability-first LLM ladder (D-10), chunk-level source_hashes contract (D-04/D-05), recompile auto-supersede chain (D-12), brief body shape with wikilinks (D-11), lockfile carve-out, sub-folder sink ordering, and Pitfall 1 resolution.
- **Migration 013** lands three additive substrates in one transaction:
  - `chunks.chunk_id_fragment TEXT NOT NULL DEFAULT ''` + chunked backfill at 10k rows/batch.
  - `brief_sources(brief_doc_id, chunk_id_fragment, chunk_doc_id, recorded_hash)` with UNIQUE + 2 indexes.
  - `daemon_state(vault_name PRIMARY KEY, last_seen_doc_mtime)`.
- **Chunker canonical helper** — `computeChunkHash` / `computeChunkIdFragment` in `src/chunker/chunk-id.ts` is the single source of truth for the NFC + LF + trimEnd + sha256 canonicalization (ADR-003 H-3/H-4 + ADR-005 Pitfall 8). Every chunk-write path (`indexer.ts`, `single.ts`, plus `chunks.insertBatch` fallback for test fixtures) consults this helper.
- **`src/brief/` Wave 0 barrel** — branded ChunkId + `parseChunkId` / `formatChunkId` / `decomposeChunkId` (IIFE-closed brand minting per `src/adapters/registry.ts`), `buildSourceHashes` (pure function over `ChunkSource[]`), `recomputeCurrentHash` for the daemon. 6 test-stub files (compile, get, body-validator, daemon, lock, resources) ready for slices 2-4 to populate.
- **`default-brief-v1` contract** registered alongside `default-memory-v1`. Widens status enum to include `"stale"`, extends required keys with `target, purpose, compiled_from, compiled_at, source_hashes`, adds cross-field invariant requiring `source_hashes` when `status === "stale"`. Pitfall 1 resolution: NOT a widening of default-memory-v1 (which would mis-type non-brief documents).
- **Sub-folder MemorySink ordering** enforced at config-loader level — `[[memory_sinks]]` array is sorted by resource-length (longest first, stable) so `_memory/_briefs/` registers before `_memory/`. Tested with both the canonical case (sub-folder declared AFTER parent in TOML) and the tie-breaking case (equal-specificity preserves declaration order).
- **Types exported** from `src/types.ts`: `ChunkId` (branded), `BriefStatus` union, `BriefSourceHash` alias, `Brief` interface (opt-in type-narrowing helper), `BriefConfig` / `BriefOllamaConfig` (config block).
- **`RESOURCE_URI_LIST_BRIEFS`** constant added to `src/memory/resources/index.ts` so slice 4's `list_briefs` resource registration imports it without scaffolding.
- **3 eval YAML skeletons** at `evals/fixtures/v2-test-vault/_queries/` ready for population in slices 3 and 4.

## Task Commits

Each task committed atomically:

1. **Task 1: Author ADR-005** — `4eeb80f` (docs)
2. **Task 2: Migration 013 + brief_sources + daemon_state** — `b0aeecd` (feat)
3. **Task 3: Brief barrel + ChunkId + source-hashes + types** — `f05fcf7` (feat)
4. **Task 4: default-brief-v1 + sub-folder ordering + Wave 0 stubs** — `851234a` (feat)

## Files Created/Modified

### Created

- `docs/v2/adr/005-brief-compile-strategy.md` — Phase 5 ADR with all 8 Decision sections + Invariants B-1..B-6 + Rationale + Forward compatibility (~410 lines).
- `src/chunker/chunk-id.ts` + `.test.ts` — canonical NFC + LF + trimEnd + sha256 helper (single source of truth, 8 tests).
- `src/db/queries/brief_sources.ts` + `.test.ts` — D-06 reverse-index query namespace (6 tests).
- `src/db/queries/daemon_state.ts` + `.test.ts` — D-09 cursor query namespace (5 tests).
- `src/db/migration-013.test.ts` — migration-level behavior tests (5 tests).
- `src/brief/chunk-id.ts` + `.test.ts` — branded ChunkId IIFE (6 tests).
- `src/brief/source-hashes.ts` + `.test.ts` — buildSourceHashes + recomputeCurrentHash (6 tests).
- `src/brief/index.ts` — Wave 0 barrel.
- `src/brief/{compile,get,body-validator,daemon,lock,resources}.test.ts` — 6 Wave 0 stubs with `it.skip` placeholders.
- `src/memory/contract/default-brief-v1.ts` + `.test.ts` — new contract with widened status enum (20 tests).
- `evals/fixtures/v2-test-vault/_queries/briefs-{curated,from-cluster,staleness-stub}.yaml` — eval skeletons.

### Modified

- `src/db/schema.ts` — adds `runMigration013` function-style migration + MIGRATIONS entry version 13.
- `src/db/database.ts` — wires `vault.db.briefSources` + `vault.db.daemonState` namespaces.
- `src/db/queries/chunks.ts` — extends `ChunkInput` with optional `chunkIdFragment` + fallback to `computeChunkIdFragment` in `insertBatch`.
- `src/indexer/indexer.ts`, `src/indexer/single.ts` — pass `chunkIdFragment: computeChunkIdFragment(c.text)` explicitly at chunk-write sites.
- `src/types.ts` — additive `ChunkId`, `BriefStatus`, `BriefSourceHash`, `Brief`, `BriefConfig`, `BriefOllamaConfig` types; extends `ChunkRow` with `chunk_id_fragment` field; extends `AppConfig` with optional `brief` block.
- `src/memory/contract/index.ts` — pre-seeds contract cache with `DEFAULT_BRIEF_V1`.
- `src/memory/resources/index.ts` — adds `RESOURCE_URI_LIST_BRIEFS` constant.
- `src/config/loader.ts` — adds `BriefConfigSchema`; sorts `memory_sinks` by resource-length (stable).
- `src/config/loader.test.ts` — adds 4 tests (brief block parsing + sub-folder ordering + stable-sort).

## Decisions Made

1. **Migration numbered 013** (not 012 as some CONTEXT references say) — Phase 4 CR-01 already shipped a v012 at `src/db/schema.ts:768-835` that widens `idx_edges_unique`. The PLAN.md frontmatter / context.must_haves correctly call out version 13.

2. **`default-brief-v1` is a NEW contract** — NOT a widening of `default-memory-v1.status` enum (Pitfall 1). Rationale documented in ADR-005: widening would mis-type non-brief documents (observations can't legally be `stale`) and would be an ADR amendment to Phase 2 scope. The new contract is bound to `_memory/_briefs/` via the sub-folder sink.

3. **Sub-folder ordering at loader, not registry** — `MemorySinkRegistry.findSinkContaining` already has correct startsWith-over-insertion-order semantics (`src/memory/registry.ts:190-202`); the fix is to normalize the order BEFORE registration. Loader-level fix means users don't have to remember the TOML ordering rule — declaration order is free.

4. **`ChunkInput.chunkIdFragment` is optional with fallback** — production call sites (indexer + single-indexer) pass the canonical value explicitly. Test fixtures (~26 sites across `src/**/test.ts`) keep working unchanged because `insertBatch` falls back to `computeChunkIdFragment(text)`. The helper remains the single source of truth.

5. **`buildSourceHashes(sources: ChunkSource[])`** — pure-function signature instead of `(vault: Vault, docIds: DocId[])`. Decouples the contract from the notes+chunks DB join (which doesn't have a `getByDocId` method today). Slice 2's `compile_brief` will resolve sources via the existing notes table and pass the result to this helper. Pure shape lets the eval harness exercise the contract with deterministic fixtures.

6. **`default-brief-v1.naming.strategy = "caller-provided"`** — the `MemoryContract.naming.strategy` enum is `caller-provided | date-slug | adapter-assigned`. Phase 5 D-12 mints a timestamped slug (`{target}--YYYYMMDDTHHmm.md`) inside `compile_brief` before calling `DeliveryAdapter.write` — `caller-provided` is the correct existing-enum value for that pattern. Not adding a new enum member keeps the change additive.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Vitest treats empty `describe` blocks as failures**
- **Found during:** Task 4 (Wave 0 stub creation)
- **Issue:** The plan's stub example was `describe("...", () => { /* comment only */ });`. Vitest fails the file with `Error: No test found in suite` instead of reporting 0 tests.
- **Fix:** Added `it.skip("[scaffold] tests land in slice N (Plan 05-0N)", () => {});` to each of the 6 stub files so vitest counts each file as 1 skipped test instead of failing.
- **Files modified:** `src/brief/{compile,get,body-validator,daemon,lock,resources}.test.ts`
- **Verification:** `npx vitest run src/brief/` reports 6 skipped, 0 failed.
- **Committed in:** `851234a` (Task 4)

**2. [Rule 1 — Bug] `z.record(z.string())` is invalid in Zod ^3.24.1**
- **Found during:** Task 4 (default-brief-v1 contract)
- **Issue:** The plan's `source_hashes: z.record(z.string()).optional()` snippet failed type-check: `TS2554: Expected 2-3 arguments, but got 1.` Newer Zod requires both key and value type for `z.record`.
- **Fix:** Changed to `z.record(z.string(), z.string()).optional()`.
- **Files modified:** `src/memory/contract/default-brief-v1.ts`
- **Verification:** `npx tsc --noEmit` clean.
- **Committed in:** `851234a` (Task 4 — fixed before commit, no follow-up commit needed)

---

**Total deviations:** 2 auto-fixed (1 blocking — empty describe; 1 bug — Zod API).
**Impact on plan:** Both fixes are pure plan-snippet adjustments to current library/test-runner versions. No scope creep, no semantic change.

## Issues Encountered

- Initial full-suite run after task 5-01-02 showed 1 transient failure in the watcher tests (filesystem timing); re-running was green. Watcher tests have flaky-on-slow-IO history per the existing test log output. Not a regression introduced by this slice.

## User Setup Required

None — no external service configuration required. The new `[brief.ollama]` config block is opt-in; existing user configs parse unchanged.

## Threat Surface

The migration adds two new tables (`brief_sources`, `daemon_state`) and one new column. Both are internal to the vault DB and not exposed via any MCP tool in slice 1 (no MCP surface change yet). The brief contract is registered but only activates when slice 2's `compile_brief` writes through `DeliveryAdapter`.

**T-05-01-02 mitigation verified:** the loader-level sub-folder ordering test confirms `_memory/_briefs/` registers before `_memory/` regardless of TOML declaration order — the brief sink is bound to `default-brief-v1`, not the parent's `default-memory-v1`.

## Next Phase Readiness

After this slice, the agent-visible surface is unchanged (still 32 MCP tools). The substrate is alive and ready for slices 2-4 to light up:

- **Slice 2 (Plan 05-02):** `compile_brief` + `get_brief` tools — fills `src/brief/compile.test.ts` + `src/brief/get.test.ts`.
- **Slice 3 (Plan 05-03):** `BriefBodyValidator` + staleness daemon + `~/.vault-memory/locks/<vault>.lock` — fills the body-validator, daemon, and lock test stubs; populates `briefs-curated.yaml`.
- **Slice 4 (Plan 05-04):** `list_briefs` MCP Resource + tool-list snapshot regen + BRF-11 cross-adapter eval — fills `resources.test.ts`; populates `briefs-from-cluster.yaml` and `briefs-staleness-stub.yaml`.

The 1211-test floor explicitly called out in the plan is exceeded (1281 passed). `tsc --noEmit` clean. `bash scripts/lint-adapters.sh` zero hits outside adapter dirs.

## Self-Check: PASSED

- `docs/v2/adr/005-brief-compile-strategy.md` — exists, all 8 Decision sections + Invariants B-1..B-6 + Rationale + Forward compatibility present.
- `src/chunker/chunk-id.ts` + `src/chunker/chunk-id.test.ts` — exist, 8 tests pass.
- `src/db/schema.ts` — `runMigration013` function exists, MIGRATIONS array has `version: 13` entry.
- `src/db/queries/brief_sources.ts` + `.test.ts` — exist, 6 tests pass.
- `src/db/queries/daemon_state.ts` + `.test.ts` — exist, 5 tests pass.
- `src/db/database.ts` — `readonly briefSources` + `readonly daemonState` declared and constructed.
- `src/brief/{chunk-id,source-hashes,index}.ts` + `.test.ts` (×2) — exist, 12 tests pass.
- `src/brief/{compile,get,body-validator,daemon,lock,resources}.test.ts` — exist, 6 skipped stubs.
- `src/memory/contract/default-brief-v1.ts` + `.test.ts` — exist, 20 tests pass; registered via `src/memory/contract/index.ts`.
- `src/memory/resources/index.ts` — exports `RESOURCE_URI_LIST_BRIEFS`.
- `src/config/loader.ts` — `BriefConfigSchema` + `sortSinksByPathSpecificity` added; `loader.test.ts` extended with 4 new tests.
- `src/types.ts` — `ChunkId`, `BriefStatus`, `BriefSourceHash`, `Brief`, `BriefConfig`, `BriefOllamaConfig` exported.
- `evals/fixtures/v2-test-vault/_queries/briefs-{curated,from-cluster,staleness-stub}.yaml` — exist, parse as YAML with `queries: []`.

**Commits verified in `git log`:**
- `4eeb80f` (docs ADR-005) — FOUND
- `b0aeecd` (migration 013) — FOUND
- `f05fcf7` (brief barrel + types) — FOUND
- `851234a` (default-brief-v1 + ordering + stubs) — FOUND

---
*Phase: 05-compiled-brief-layer*
*Plan: 01 (foundations)*
*Completed: 2026-05-18*
