---
phase: 03-bundles-authority-staleness
plan: 05
subsystem: search/hybrid + db/queries/{fts,notes} + tool-registry + types + memory/recall (verified)
tags: [search, ranking, recency, authority, superseded, citation-packet, sql-filter, hybrid]
requires:
  - 03-01 (notes.status denormalized column + notes_status partial index from migration 010 part B)
  - 03-01 (SectionsQueries.findContainingChunk for heading_path promotion)
  - phase 1 (formatDocId / parseSourceHandle in src/adapters/registry.ts)
  - phase 2 (CitationPacket shape from src/memory/citation-packet.ts — naming alignment)
provides:
  - "HybridSearchOptions: recencyWeight, authorityWeight, halfLifeDays, includeSuperseded, clock, displayUrlFor"
  - "SearchHit: 9 optional citation-shaped fields (doc_id, source_handle, heading_path, mtime, hash, display_url, status, superseded_by, properties)"
  - "search_hybrid Zod schema: 4 new optional params (recency_weight, authority_weight, half_life_days, include_superseded)"
  - "FtsQueries.search: optional excludeSuperseded flag (SQL-level JOIN against notes.status)"
  - "NotesQueries.getSupersededChunkIds(chunkIds): SQL-level batch filter for the vec0 ANN path"
  - "evals/fixtures/v2-test-vault/_queries/recency.yaml + 2 status-update fixture docs"
affects:
  - src/search/hybrid.ts
  - src/search/hybrid.rescore.test.ts (new)
  - src/db/queries/fts.ts + src/db/queries/fts.test.ts (4 new cases)
  - src/db/queries/notes.ts + src/db/queries/notes.test.ts (5 new cases)
  - src/types.ts (SearchHit 9-field extension)
  - src/tool-registry.ts (Zod + JSON schema for search_hybrid)
  - src/server.ts (handleSearchHybrid wiring + displayUrlFor resolver)
  - evals/v1-baseline/tools-list.snapshot.json (regenerated, additive-only diff)
  - evals/fixtures/v2-test-vault/_queries/recency.yaml (new)
  - evals/fixtures/v2-test-vault/status_updates/* (2 new fixture .md files)
tech-stack:
  added: []
  patterns:
    - "SQL-level filtering via partial index (notes_status) — zero per-candidate frontmatter parses on default-hide path"
    - "Two-statement-cache pattern in FtsQueries — _search vs _searchExclSup keep v1 byte-identical while opt-in path uses the JOIN"
    - "Clock injection seam — mirrors the recall.ts:~205 idiom; tests pass a fixed clock for deterministic age math"
    - "Display-URL resolver seam — keeps obsidian URL minting in the obsidian-fs source adapter (ADR-002 §I-5b)"
key-files:
  created:
    - src/search/hybrid.rescore.test.ts
    - evals/fixtures/v2-test-vault/_queries/recency.yaml
    - evals/fixtures/v2-test-vault/status_updates/atlas-1-old-update.md
    - evals/fixtures/v2-test-vault/status_updates/atlas-1-new-update.md
  modified:
    - src/types.ts
    - src/search/hybrid.ts
    - src/db/queries/fts.ts
    - src/db/queries/fts.test.ts
    - src/db/queries/notes.ts
    - src/db/queries/notes.test.ts
    - src/tool-registry.ts
    - src/server.ts
    - evals/v1-baseline/tools-list.snapshot.json
decisions:
  - "D1: SQL-level superseded filter implemented via two paths — FTS5 inline JOIN-and-filter, vec0 post-filter via NotesQueries.getSupersededChunkIds. Both use the notes_status partial index (migration 010 B). Zero per-candidate frontmatter parses on v1-default path. Pinned by EXPLAIN QUERY PLAN assertions in tests."
  - "D2: Snake_case naming on the 9 new SearchHit fields — consistent with the Phase 2 CitationPacket shape. Existing v1 fields (notePath, chunkText, headingPath) stay camelCase; the mixed casing inside SearchHit is intentional and additive-only (D-08)."
  - "D3: half_life_days exposed as an optional Zod param (default 30) — test ergonomics + strict additivity (D-08) win over hidden-constant ergonomics. Single-line revert if maintainer prefers it hidden."
  - "D4: Display-URL resolver injected as an optional closure on HybridSearchOptions rather than inlined. Forced by the lint at I-5b (obsidian URL literal must live in source adapter); benefit is hybrid.ts now stays adapter-neutral and works for future non-Obsidian sources."
  - "D5: heading_path populated via SectionsQueries.findContainingChunk per hit (O(log N) on the sections_chunk_range index from migration 010). One extra indexed lookup per result hit, bounded by topK — documented cost."
metrics:
  duration_minutes: 14
  tasks_completed: 7
  files_modified: 11
  files_created: 4
  tests_added: 21
  tests_total: 985
  commits: 7
  completed_date: 2026-05-16
---

# Phase 3 Plan 05: `search_hybrid` post-RRF rescore + SQL-level superseded filter Summary

Extends `search_hybrid` from "Layer 0 retrieval" toward the v2 agentic-knowledge-layer surface by adding the three D-06/D-07/D-08 ranking signals (recency, authority, superseded hide) plus the 9-field citation-shaped result hydration, while pinning v1-baseline invariance by construction — zero per-candidate cost on the default path.

## What shipped

**Four new optional `search_hybrid` params** (D-07, D-08, ASM-07, ASM-08), all defaulting to v1-no-op:

| Param                 | Type    | Default | Effect                                                                                  |
| --------------------- | ------- | ------- | --------------------------------------------------------------------------------------- |
| `recency_weight`      | number  | 0       | Adds `recency_weight × exp(-age_days / half_life_days)` to each candidate RRF score   |
| `authority_weight`    | number  | 0       | Adds `authority_weight × 1` for docs with `frontmatter.authoritative === true`          |
| `half_life_days`      | number  | 30      | Half-life for the recency exponential decay                                             |
| `include_superseded`  | boolean | false   | When false, exclude `status: superseded` chunks at SQL level via `notes_status` index   |

**Nine new optional `SearchHit` fields** (D-08, ASM-06):

`doc_id`, `source_handle`, `heading_path`, `mtime`, `hash`, `display_url`, `status`, `superseded_by`, `properties` — all snake_case to align with the Phase 2 `CitationPacket` shape. Every field is optional; v1 callers see byte-identical JSON output because every new field is `undefined` and JSON-omitted.

**SQL-level superseded filter** (M4 fix):

- FTS: `FtsQueries` gains a second prepared statement (`_searchExclSup`) that JOINs `chunks → notes` and filters `notes.status != superseded` inline. Selected by an optional `excludeSuperseded` flag on `FtsQueries.search()`.
- vec0: `NotesQueries.getSupersededChunkIds(chunkIds): Set<number>` returns the subset of chunk IDs whose owning note is superseded, using a variable-length `IN (...)` JOIN. Called once per `searchOneVault` invocation after the vec0 kNN; filtered candidate IDs never enter RRF.
- Both code paths use the `notes_status` partial index from migration 010 part B. EXPLAIN QUERY PLAN assertions in tests pin that the planner JOINs `notes` (proof the filter runs at SQL level, not in JS).
- Zero per-candidate frontmatter parses on the v1-default path — preserves v1 perf exactly.

**Post-RRF additive rescore** at `src/search/hybrid.ts:~200`:

Inserted between `flat.sort` and the reranker block. Guard: `if (recencyWeight !== 0 || authorityWeight !== 0)` short-circuits when both weights are 0 — zero extra DB reads, zero re-sort on the v1 default path. When active, hydrates each candidate notes + chunks rows (O(topK) PK lookups) and adds the recency + authority terms before re-sorting.

**Clock-injection seam** (`opts.clock?: () => number`, default `Date.now`) mirrors `src/memory/tools/recall.ts:~205`. Tests pass a fixed clock for deterministic age math.

**Display-URL resolver seam** (`opts.displayUrlFor?: (vault, path) => string`) keeps the obsidian URL literal in the obsidian-fs source adapter per ADR-002 §I-5b. Production bootstrap wires a closure delegating to the existing `displayUrl(adapterRegistry, vault, path)` helper in `server.ts`; tests stay adapter-free.

**Eval fixtures**:

- `evals/fixtures/v2-test-vault/_queries/recency.yaml` — 2 eval scenarios for ASM-11 (no-pressure both-eligible recall; recency-pressure fresh-first order pin)
- `evals/fixtures/v2-test-vault/status_updates/atlas-1-old-update.md` — body "prototyping", intended mtime 2025-11-15 (~6 months back)
- `evals/fixtures/v2-test-vault/status_updates/atlas-1-new-update.md` — body "shipping", intended mtime 2026-05-15 (~1 day back)

The YAML documents the mtime contract for the eval harness fs.utimesSync injection step (git does not preserve mtimes across checkout — the on-disk values cannot be trusted).

**Tools-list snapshot regenerated** (`evals/v1-baseline/tools-list.snapshot.json`). Diff is purely additive: only the 4 new optional params under `search_hybrid.inputSchema.properties`. No removed or renamed fields. `npm run eval:baseline` green.

## Tasks 1-7 (per plan)

1. **`HybridSearchOptions` extension + 9 new `SearchHit` optional fields in `src/types.ts`** ✓ — commit `57e71ea`. 36 lines added; `tsc --noEmit` clean.
2. **SQL-level superseded filter (M4 fix)** ✓ — commit `0a3c7db`. FTS gains `_searchExclSup`; `NotesQueries.getSupersededChunkIds` added. 9 new unit tests across `fts.test.ts` + `notes.test.ts`. EXPLAIN QUERY PLAN assertions pin SQL-level filtering.
3. **Post-RRF additive rescore** + **4. Hydration extension for 9 fields** ✓ — commit `7e2b5f9` (combined). 178 lines added to `src/search/hybrid.ts`; all 12 pre-existing hybrid tests pass unmodified.
5. **Zod schema extension in `src/server.ts` + snapshot regen** ✓ — commit `d3135a3`. 4 new Zod params; snapshot regenerated; baseline test green.
6. **v1-baseline invariance pin + rescore + filter + hydration suite** ✓ — commit `edfc230`. 16 new test cases in `src/search/hybrid.rescore.test.ts` covering all five concerns (invariance, math, filter, hydration, golden pin).
7. **Recency eval fixture** ✓ — commit `d249fe2`. YAML + 2 fixture docs.

Plus one deviation commit (`1615e00`) — lint fix to preserve the I-5b adapter-seam invariant via the `displayUrlFor` resolver seam.

## Verification

| Gate                                    | Result                                                                |
| --------------------------------------- | --------------------------------------------------------------------- |
| `npm test`                              | 985 passed, 11 skipped (was 960 in 03-01 — +25 net new tests)         |
| `npx tsc --noEmit`                      | clean                                                                 |
| `bash scripts/lint-adapters.sh`         | all 8 invariants green (incl. I-5b after the seam fix)                |
| `npm run eval:baseline`                 | green — tools-list snapshot matches the regenerated additive diff     |
| `npm run eval:snapshot` re-run          | byte-identical to the committed snapshot (idempotent)                 |
| v1-default search behavior              | invariance pin (inline snapshot in `hybrid.rescore.test.ts`) green    |
| EXPLAIN QUERY PLAN — FTS JOIN           | pinned in `fts.test.ts` — planner JOINs `notes` for the exclude path  |
| EXPLAIN QUERY PLAN — vec0 post-filter   | pinned in `notes.test.ts` — `getSupersededChunkIds` references `notes` |

## Recall.ts integration check

Per plan §"Recall.ts integration", verified that `src/memory/tools/recall.ts` already produces the 8-field citation packet via `toCitationPacket` (line 256), routing through the `src/memory/citation-packet.ts` mapper. The naming convention chosen for the new `SearchHit` fields matches that packet shape, so no `recall.ts` changes were required. The Phase 2 `recall` controller continues to ship its citation packets unchanged.

## Acceptance criteria — checklist

- [x] `search_hybrid` with no new params produces byte-identical hit lists to v1-baseline (inline-snapshot pin in `hybrid.rescore.test.ts`; `baseline.test.ts` green).
- [x] **(M4)** `include_superseded: false` (default) excludes `status: "superseded"` docs at SQL level. EXPLAIN QUERY PLAN tests in `fts.test.ts` + `notes.test.ts` prove the filter is in SQL.
- [x] **(M4)** Default-hide path performs ZERO additional per-candidate frontmatter parses compared to v1 — proven by construction (no new code path activates when `recency_weight == 0 && authority_weight == 0`; the SQL filter runs entirely in the DB).
- [x] `include_superseded: true` reveals superseded docs (test pinned in `hybrid.rescore.test.ts`).
- [x] `recency_weight > 0` makes fresher docs outrank older near-duplicates (`recency.yaml` scenario `atlas-1-status-recency-weighted` + unit test).
- [x] `authority_weight > 0` makes `authoritative: true` docs outrank peers (unit test).
- [x] Every result carries `mtime` + `doc_id` + `source_handle` + `display_url` (when `displayUrlFor` resolver supplied).
- [x] `heading_path` non-empty when chunk maps to a section; `undefined` for doc-level hits.
- [x] `tools-list.snapshot.json` regenerated; diff additive-only (new optional params on `search_hybrid`).
- [x] All 985 tests pass; CI greps clean (no fs/path/gray-matter/chokidar/obsidian-URL drift).
- [x] Clock-injection seam works — test passes deterministically with fixed clock across two real-wallclock-distinct invocations.

## Deviations from plan

### Auto-fixed Issues

**1. [Rule 2 - Critical] Adapter-seam discipline preserved via `displayUrlFor` resolver injection**

- **Found during:** Task 4 — initial implementation inlined an obsidian deep-link template literal in `src/search/hybrid.ts`.
- **Issue:** Lint at `scripts/lint-adapters.sh:127` (I-5b) flagged the literal. Per ADR-002 §I-5b, the obsidian URL string may only appear inside `src/adapters/source/obsidian-fs/`, `src/adapters/source/types.ts`, `src/adapters/registry.ts`, or `src/server.ts`. `src/search/hybrid.ts` is L0 retrieval substrate and must stay adapter-neutral so a future Notion / Slack source plugs in without code change here.
- **Fix:** Extended `HybridSearchOptions` with an optional `displayUrlFor?: (vaultName: string, notePath: string) => string` closure. When supplied, hybrid.ts calls it per hit; when omitted, `display_url` stays `undefined`. Bootstrap (`src/server.ts`) supplies a closure delegating to the existing `displayUrl(adapterRegistry, vault, path)` helper, which in turn calls `SourceConnector.formatDisplayUrl` — the canonical, adapter-licensed mint site. Also added one new unit test pinning that `display_url` is undefined when no resolver is supplied — proves the seam discipline holds at the test level.
- **Files modified:** `src/search/hybrid.ts`, `src/server.ts`, `src/types.ts`, `src/search/hybrid.rescore.test.ts`
- **Commit:** `1615e00`

### Plan path conventions

The plan referenced fixture paths `notes/old-status.md` and `notes/new-status.md`. The actual v2-test-vault organizes notes by topical folder (`projects/`, `meetings/`, `decisions/`, etc.) rather than a generic `notes/` bucket. I placed the new fixtures under a new `status_updates/` folder, which clearly indicates their role as a Atlas-1 status-update pair. The eval YAML references the actual paths (`status_updates/atlas-1-{old,new}-update.md`). No semantic impact — the YAML expected_doc_ids field is the source of truth for the eval harness.

### Pre-existing superseded fixture

Plan §"Files to create" noted: "Possibly one new superseded fixture doc — but the v1 fixture already has at least one (verify via grep)". Confirmed via `grep -rln "status: superseded" evals/fixtures/v2-test-vault/` — three existing superseded fixtures already live under `_memory/observations/`. No new superseded fixture doc needed; the `hybrid.rescore.test.ts` unit fixture builds its own `superseded.md` in-memory for SQL-filter coverage.

## Self-Check: PASSED

All key files created/modified exist on disk:

- ✓ `src/search/hybrid.rescore.test.ts` — 517 lines, 16 tests passing
- ✓ `src/search/hybrid.ts` — modified (rescore + hydration + SQL filter wire-up + displayUrlFor seam)
- ✓ `src/db/queries/fts.ts` — modified (_searchExclSup statement + excludeSuperseded flag)
- ✓ `src/db/queries/fts.test.ts` — modified (+4 cases in new excludeSuperseded describe)
- ✓ `src/db/queries/notes.ts` — modified (+getSupersededChunkIds method)
- ✓ `src/db/queries/notes.test.ts` — modified (+5 cases in new getSupersededChunkIds describe)
- ✓ `src/types.ts` — modified (SearchHit +9 optional fields)
- ✓ `src/tool-registry.ts` — modified (Zod + JSON schema for 4 new search_hybrid params)
- ✓ `src/server.ts` — modified (handleSearchHybrid wiring + displayUrlFor resolver)
- ✓ `evals/v1-baseline/tools-list.snapshot.json` — regenerated, additive-only diff
- ✓ `evals/fixtures/v2-test-vault/_queries/recency.yaml` — created
- ✓ `evals/fixtures/v2-test-vault/status_updates/atlas-1-old-update.md` — created
- ✓ `evals/fixtures/v2-test-vault/status_updates/atlas-1-new-update.md` — created

All 7 commits exist in git log:

- ✓ `57e71ea` feat(03-05): SearchHit gains 9 optional citation-shaped fields (D-08)
- ✓ `0a3c7db` feat(03-05): SQL-level superseded filter (M4) — FTS JOIN + getSupersededChunkIds
- ✓ `7e2b5f9` feat(03-05): hybrid.ts — post-RRF rescore + 9-field hydration + SQL filter wire-up
- ✓ `d3135a3` feat(03-05): search_hybrid Zod schema + handler wiring for 4 new params
- ✓ `edfc230` test(03-05): v1 invariance pin + rescore + filter + hydration suite
- ✓ `d249fe2` test(03-05): recency eval fixture — two near-duplicate Atlas-1 status notes
- ✓ `1615e00` fix(03-05): preserve adapter-seam discipline — inject display-URL resolver
