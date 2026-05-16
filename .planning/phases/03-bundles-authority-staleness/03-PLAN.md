---
plan: 03-PLAN
phase: 03
mode: mvp
status: pending
---

# Phase 3: Bundles + Authority/Staleness — Phase Plan

**Phase number:** 3
**Phase slug:** `03-bundles-authority-staleness`
**Goal (verbatim from ROADMAP):** Deliver document-tree retrieval (bundles, outlines, sections, dossiers) with citation packets on every result, plus authority/staleness ranking signals — proven source-neutral against a stub adapter.
**Mode:** mvp (vertical feature slices)
**Depends on:** Phase 2 (citation packet `toCitationPacket` from `src/memory/citation-packet.ts`; `audit_log` with `client_id`/`is_memory_sink_write`; supersede forward-only semantics)
**Branch:** whatever the user has checked out — DO NOT switch.

## Required reading for executors

Every slice plan re-references these. Read all of them before touching code:

1. `.planning/phases/03-bundles-authority-staleness/03-CONTEXT.md` — locked decisions D-01..D-08
2. `.planning/phases/03-bundles-authority-staleness/03-RESEARCH.md` — Claude's-Discretion resolutions, file:line citations
3. `.planning/REQUIREMENTS.md` §"Assembly + Authority/Staleness (Phase 3)" — ASM-01..ASM-13
4. `.planning/ROADMAP.md` §"Phase 3" — 5 success criteria
5. `docs/v2/adr/001-document-identity.md`, `002-adapter-seams.md`, `003-document-shape.md`, `004-memory-sink-handles.md`
6. `.planning/phases/02-memory-namespace-provenance-contract/02-CONTEXT.md` — D-01 citation packet shape, D-03 supersede semantics
7. `src/memory/citation-packet.ts:45-62` — `CitationPacket` 8-required-field shape that all Phase 3 tools intersect with (not re-define)
8. `.planning/phases/01-adapter-extraction-tech-debt-up/01-CONTEXT.md` — adapter seam discipline
9. `.planning/codebase/ARCHITECTURE.md`, `STRUCTURE.md`, `CONVENTIONS.md`, `TESTING.md`, `CONCERNS.md`

## Success criteria (verbatim from ROADMAP)

1. `get_document_bundle`, `get_outline`, `search_sections`, and `assemble_dossier` return results with a citation packet `{doc_id, source_handle, title, heading_path, mtime, hash, display_url}` on every item; ≥5 dossier eval queries pass with ≥0.8 precision/recall.
   - **Note (post-revision):** the actual `CitationPacket` shape per Phase 2 D-01 (`src/memory/citation-packet.ts:45-62`) has **8 REQUIRED fields**, the 8th being `properties: Record<string, unknown>` (always populated, empty `{}` when no frontmatter). All Phase 3 tools type their packets as `CitationPacket & { extras }` — they do not redefine the packet. The ROADMAP success-criterion text lists 7 fields colloquially; the binding contract is the 8-field type.
2. v1 default behavior is unchanged when no weights/filters are supplied — re-running the v1-baseline eval set produces identical results.
3. `search_hybrid` accepts optional `recency_weight`, `authority_weight`, and `superseded` filter; eval scenarios with stale-vs-fresh duplicates rank fresh higher when `recency_weight > 0`; `status: superseded` documents are hidden by default.
4. Stubbed second adapter (hard-coded `Document` objects) passes the same eval suite as `obsidian-fs` — proves source-neutrality before Phase 9 gate.
5. All search/bundle results carry `mtime`, `status` (if present), and `superseded_by` (if present); list-style assembly ops promoted to MCP Resources where applicable.

## MVP slice map

| Slice ID | Name | ASM IDs | Key files (new) | Depends on | Wave | Est. tasks | Est. new tests |
|---|---|---|---|---|---|---|---|
| 03-01 | Sections infrastructure (incl. M2 backfill + M4 denormalized `notes.status`) | ASM-01..03 prerequisite; ASM-05 prerequisite; ASM-08 prerequisite | `src/sections/anchor.ts`, `src/sections/extract.ts`, `src/sections/backfill.ts`, `src/sections/queries.ts`, `src/sections/index.ts`, `src/db/queries/sections.ts`, migration 010 in `src/db/schema.ts` (sections table + `notes.status` column + section backfill), indexer hook in `src/indexer/indexer.ts`, ADR-003 H-7 addendum in `docs/v2/adr/003-document-shape.md`, `BlockNode` Section variant in `src/types.ts` | — | 0 | 9 | 28–35 |
| 03-02 | `get_outline` | ASM-02, ASM-05 (partial) | `src/assembly/outline.ts`, `src/assembly/types.ts`, `src/assembly/index.ts`, tool registration in `src/tool-registry.ts` + handler in `src/server.ts`, conformance assertions in `src/adapters/source/conformance.test.ts` | 03-01 | 1 | 5 | 8–10 |
| 03-03 | `search_sections` | ASM-03, ASM-05 (partial) | `src/assembly/search-sections.ts`, tool reg + handler, conformance assertions | 03-01 | 1 | 5 | 8–10 |
| 03-04 | `get_document_bundle` | ASM-01, ASM-05 (partial), ASM-06 (anchor doc) | `src/assembly/bundle.ts`, tool reg + handler, conformance assertions | 03-01, 03-02 (reuses outline builder), **03-05 (anchor packet status/superseded_by hydration)** | 2 | 6 | 10–12 |
| 03-05 | `search_hybrid` rescore + additive fields + SQL-level superseded filter | ASM-06, ASM-07, ASM-08, ASM-09, ASM-11 | `src/search/hybrid.ts` (rescore insertion + clock injection), `src/db/queries/fts.ts` + vec0 query path (M4 SQL filter), `src/types.ts` (additive `SearchHit` optional fields + `HybridSearchOptions`), `src/server.ts` (Zod params), `evals/v1-baseline/tools-list.snapshot.json` regen, eval YAML in `evals/fixtures/v2-test-vault/_queries/recency.yaml` | 03-01 (for `heading_path` hydration AND denormalized `notes.status` column from migration 010 part B) | 1 (runs parallel to 03-02/03-03/03-06) | 7 | 13–17 |
| 03-06 | `assemble_dossier` | ASM-04, ASM-05 (partial), ASM-10 | `src/assembly/dossier.ts`, tool reg + handler, conformance assertions, eval extension of `_queries/dossier.yaml` (+2 new queries), fixture additions (aliases on alice-chen, `authoritative: true` on atlas-1) | 03-01 | 1 | 6 | 11–13 |
| 03-07 | Conformance + source-neutrality proof | ASM-12, ASM-13 (disposition), ASM-10 (closes eval), ASM-11 (closes eval) | `src/adapters/source/conformance.test.ts` (assembly-section describe.each), `src/adapters/stub/assembly-fixture.ts` (purpose-built 8-doc Document[]), CHANGELOG entry, phase sign-off note | 03-02, 03-03, 03-04, 03-05, 03-06 | 2 | 5 | 12–15 |

**Total estimated tasks:** ~43 (revised up from ~40 to cover M2 backfill + M4 SQL filter + M5 dependency wiring). **Total estimated new tests:** ~90–112 (revised up — the 03-01 backfill + denormalized status testing alone adds ~10 new cases).

## Wave execution graph

```
Wave 0 (blocks all):
  03-01  Sections infrastructure
        ├─ types.ts (BlockNode Section variant)
        ├─ src/sections/{anchor, extract, backfill, queries, index}.ts
        ├─ src/db/queries/sections.ts
        ├─ migration 010 part A (sections table + indexes)
        ├─ migration 010 part B (denormalized notes.status column + partial index) [M4]
        ├─ migration 010 part C (one-time section backfill from existing chunks)   [M2]
        ├─ indexer hook (build sections alongside chunks; maintain notes.status)
        └─ ADR-003 H-7 invariant addendum

Wave 1 (parallel after 03-01):
  03-02  get_outline           ──┐
  03-03  search_sections       ──┤
  03-05  search_hybrid rescore ──┤   (uses notes.status for SQL filter + sections
                                 │    table for heading_path hydration)
  03-06  assemble_dossier      ──┘

Wave 2 (after Wave 1 lands):
  03-04  get_document_bundle    (uses outline builder from 03-02; also reads
                                 graph.ts backlinks + audit_log recent_edits;
                                 inherits hydration extension from 03-05 [M5])
  03-07  Conformance + source-neutrality + ASM-13 disposition
                                (parameterizes describe.each over all four
                                 new tools against obsidian-fs + StubSource;
                                 closes ASM-10/11 evals; regenerates
                                 tools-list.snapshot.json one final time)
```

**Dependency edges (slice → slice it depends on):**
- 03-02 → 03-01
- 03-03 → 03-01
- 03-04 → 03-01, **03-02, 03-05** (M5: 03-04 inherits the anchor-packet hydration extension from 03-05 so the anchor's `status`/`superseded_by` fields are populated per ASM-06)
- 03-05 → 03-01
- 03-06 → 03-01
- 03-07 → 03-02, 03-03, 03-04, 03-05, 03-06

Note on 03-04 wave assignment: research diagram placed `get_document_bundle` in Wave 1c, but the bundle composes `get_outline`'s tree builder. Pushing 03-04 to Wave 2 lets 03-02 stabilize its `OutlineNode` shape first; 03-04 then imports `buildOutlineTree` rather than duplicating the recursion. Post-revision: 03-04 also inherits the hydration extension from 03-05, reinforcing the Wave 2 placement.

## Open questions / known risks (executor must read)

1. **Dossier `relation` field — v2.0.0 single-value, v2.1.0+ multi-value (per RESEARCH §9).** The v1 `wikilinks` table only knows `"wikilink"` type; Phase 4 (GRA-04) widens the schema to all four edge types. Phase 3 dossier ships `relation: "wikilink"` for every linked document. **Action:** flag in CHANGELOG `[Unreleased]` under "## [Unreleased] → Known limitations" and in `src/assembly/dossier.ts` JSDoc. Phase 4 PR widens without breaking change (the field already exists; values widen).

2. **Additive tools-list snapshot diff.** `evals/v1-baseline/tools-list.snapshot.json` regenerates exactly once per phase, in the commit that finalizes 03-05's new Zod params. The PR reviewer manually verifies the diff is additive-only (new `optional()` params on `search_hybrid`; no removals/renames). Slice 03-07 may regenerate again ONLY if a Zod typo got merged; do not regen casually. `npm run eval:snapshot` (per `package.json:33`) is the canonical command.

3. **ADR-003 H-7 invariant addendum** (Slice 03-01) is a documentation-only change to `docs/v2/adr/003-document-shape.md`. Wording is in RESEARCH §4. The addendum must NOT alter H-1..H-6 — it is purely additive. Maintainer reviews in PR; if rejected, Phase 3 still ships (the anchor algorithm is implemented either way) but the ADR stays at H-6 with a TODO.

4. **`relation` widening AND `BlockBase.anchor?` open question both deferred.** The ADR-003 `BlockBase.anchor?` field (carrying anchors on every block, not just sections) is out of Phase 3 scope per RESEARCH §4 "scope creep — defer". Do not add anchors to non-section blocks.

5. **Concurrent-vault edits invalidate anchors by design** (operating environment is "few expert users collaborating concurrently"). Two collaborators editing the same section produce different anchors; in-flight brief citations to the old anchor point at nothing. Phase 5's staleness daemon detects this and flips briefs to `stale`. Phase 3 produces stable anchors; Phase 3 does NOT add a staleness daemon. Document this lifecycle in `src/assembly/index.ts` or `src/sections/index.ts` JSDoc.

6. **v1-baseline invariance is proven by construction in 03-05** — both rescore terms vanish when weights are 0 (default), the SQL-level superseded filter (M4) is a no-op on the v1 fixture (no fixture doc has `status: "superseded"` → `notes_status` partial index is empty → query planner short-circuits → no perf regression). Slice 03-05's test set MUST include an assertion that running `search_hybrid` with no new params produces an identical hit list AND identical hydration count compared to a pinned v1 baseline.

7. **`include_paths` optimization for dossier scoping** (RESEARCH §"Open Risks" #6) is NOT implemented pre-emptively. If `assemble_dossier` perf is unacceptable on the Atlas Robotics fixture (>500ms typical), defer optimization to a Phase 3 follow-up plan.

8. **Adapter-seam discipline applies to every file in `src/assembly/` and `src/sections/`.** No `import "fs"`, no `import "gray-matter"`, no `path.join`/`path.resolve`, no `chokidar`. `scripts/lint-adapters.sh` (Phase 1 plan 01-06) enforces. CI fails any drift.

9. **MCP Resources promotion (ASM-13) is deferred entirely** per RESEARCH §8. None of the four new tools have a clean stable-URI list operation in their MVP shape. `list_dossier_types` and `list_dossiers` are NOT in ASM-01..ASM-04 (out of scope). Slice 03-07 records this as "ASM-13: investigated; no candidates found in MVP scope — re-evaluate in Phase 5 (briefs adds `list_briefs`) or Phase 6 (contracts adds `list_contracts`)" rather than "skipped."

10. **(M3) `recent_edits` in `get_document_bundle` does not surface pre-rename history.** `getAuditLog({notePath})` at `src/audit/audit.ts:93-97` looks up entries by current path; pre-rename audit_log rows are keyed on `note_id` internally but the path-lookup misses them. So a doc renamed `foo.md` → `bar.md` returns only post-rename edits when queried via the bundle tool. Acceptable for v2.0.0 because: Phase 3 is read-side; audit_log retains pre-rename rows for forensic use; the collaborative-vault operating context names renaming as a design pressure but does not require Phase 3 to surface pre-rename history in `recent_edits`. **Action:** 03-04 plan adds a Known-risks section + JSDoc on `getDocumentBundle` and `BundleRecentEdit`; 03-07 sign-off note lists this as a known v2.0.0 limitation. Phase 4 (graph) should pick this up as a follow-up — `doc_id → note_id` resolution centralizes there, enabling note-id-keyed audit lookup that survives renames.

11. **(M1) Citation packet is 8-field REQUIRED, not 7-field with optional `properties`.** Per `src/memory/citation-packet.ts:45-62`, `CitationPacket` has 8 REQUIRED fields including `properties: Record<string, unknown>` (always populated by `toCitationPacket()`, defaulting to `{}` when no frontmatter). All Phase 3 tools type their packets as `CitationPacket & { extras }` — imported from `src/memory/citation-packet.ts`, not re-defined. The conformance test in 03-07 asserts all 8 fields are present (not 7) AND `typeof packet.properties === "object"` (never `undefined`).

12. **(M2) Migration 010 backfills `sections` for existing v1 vaults at upgrade time.** Catchup only re-indexes notes whose hash changed, so without backfill every existing user's vault would have empty `sections` rows for every unchanged note → Phase 3 tools would silently return empty results until each note was edited. The migration's function-style backfill step derives sections from existing `chunks.heading_path` + `chunks.text`, producing the same anchors `extractSections` would. Anchor-equivalence is proven by a dedicated test in `src/sections/backfill.test.ts`.

13. **(M4) `superseded` filter runs at SQL level, not in JS.** A denormalized `notes.status` TEXT column (with a partial index `notes_status` on non-null values) is added in migration 010 part B. The candidate-list SQL inside `searchOneVault` JOINs `chunks → notes` and appends `WHERE notes.status IS NULL OR notes.status != 'superseded'` when `include_superseded === false`. Result: the v1-default path performs zero extra per-candidate frontmatter parses compared to v1 → byte-identical hit list AND byte-identical perf. The indexer maintains `notes.status` in sync with frontmatter on every write.

## Test budget summary

| Slice | Unit tests | Conformance asserts | Eval YAMLs / additions | Total new |
|---|---|---|---|---|
| 03-01 | 28–35 (anchor, extract, backfill, sections queries, notes status, indexer hook, integration, migration smoke) | 0 | 0 | 28–35 |
| 03-02 | 5–6 (outline.test.ts) | 1 (in describe.each, lands in 03-07) | 0 | 5–6 |
| 03-03 | 5–6 (search-sections.test.ts) | 1 | 0 | 5–6 |
| 03-04 | 6–8 (bundle.test.ts) | 1 | 0 | 6–8 |
| 03-05 | 11 (hybrid.rescore.test.ts; M4 SQL-filter cases incl. EXPLAIN-QUERY-PLAN behavioral assertion) | 0 | 1 new (recency.yaml) + snapshot regen | 13–17 |
| 03-06 | 9 (dossier.test.ts; M1 `properties always object` assertion per entry) | 1 | 2 new dossier YAML queries (alias, authoritative) + fixture frontmatter additions | 11–13 |
| 03-07 | 0 (suite extension is the deliverable) | parameterized 5–6 assertions × 2 adapters = 10–12 | dossier eval run + recency eval run | 12–15 |
| **Total** | **~64–75** | **~14–16** | **~3 new YAMLs + 1 snapshot regen** | **~80–100 actual new test cases** |

## Exit criteria — mapping to ROADMAP success criteria

| ROADMAP success | Proven by | Slice(s) |
|---|---|---|
| **#1** Citation packet on every item; ≥5 dossier queries ≥0.8 P/R | Conformance test "citation packet shape is byte-identical to recall" in 03-07 (asserts all 8 REQUIRED fields incl. `properties` per M1 fix) + `evals/fixtures/v2-test-vault/_queries/dossier.yaml` runs in CI eval job | 03-06 + 03-07 |
| **#2** v1 default unchanged when no weights/filters | `evals/v1-baseline/baseline.test.ts` still green + a new explicit test asserting `search_hybrid({q})` with no new params equals pinned baseline + M4 SQL-level filter is a no-op on baseline (no extra hydration) + snapshot regen is additive-only (PR review) | 03-05 |
| **#3** `recency_weight`/`authority_weight`/`superseded` filter; stale-vs-fresh ranks fresh higher; superseded hidden by default | `evals/fixtures/v2-test-vault/_queries/recency.yaml` (new) + unit test in `src/search/hybrid.rescore.test.ts` for SQL-level superseded default-hide + `include_superseded: true` reveals | 03-05 |
| **#4** Stub adapter passes the same eval suite | `src/adapters/source/conformance.test.ts` assembly section parameterized over `[obsidian-fs, stubAssembly]` | 03-07 |
| **#5** Results carry `mtime`/`status`/`superseded_by`; Resources promotion where applicable | Unit test in `hybrid.rescore.test.ts` asserting hydrated fields + 03-04 anchor-packet test asserts ASM-06 fields populate from 03-05's hydration extension + 03-07 records ASM-13 disposition | 03-04 + 03-05 + 03-07 |

## Test discipline (NON-NEGOTIABLE)

- All 324 existing tests must remain green. CI will fail otherwise.
- Every new `src/assembly/*.ts` and `src/sections/*.ts` ships with co-located `*.test.ts` in the same PR.
- Conformance assertions extend `src/adapters/source/conformance.test.ts` — never a parallel suite.
- `npm run eval:baseline` (per `package.json`) must pass on every slice's PR.

## Tool-budget impact (REL-08)

Phase 3 adds **4 new MCP tools**: `get_document_bundle`, `get_outline`, `search_sections`, `assemble_dossier`. After Phase 3 the v2 tool surface is `23 (v1) + 4 (assembly) + 2 (record_observation, supersede from Phase 2) + 1 (recall) − 2 (memory_stats and list_sinks promoted to Resources in Phase 2) = 28 tools`. Well within the REL-08 ≤32 budget.

ASM-13 disposition is "investigated; no candidates found in MVP scope" — no further reduction this phase.

## CHANGELOG hook (Phase 3 PR adds to `[Unreleased]`)

```markdown
## [Unreleased]

### Added (Phase 3)
- `get_document_bundle({doc_id, depth?: 1})` — document tree + backlinks + outline + recent edits
- `get_outline({doc_id})` — nested heading tree with content-hash anchors
- `search_sections({query, limit})` — section-level retrieval composed on top of `search_hybrid`
- `assemble_dossier({type, key})` — type/key assembly with `linked_documents` + `property_rollups`
- `search_hybrid` additive params: `recency_weight`, `authority_weight`, `half_life_days`, `include_superseded`
- `search_hybrid` additive result fields: `doc_id`, `source_handle`, `heading_path`, `mtime`, `hash`, `display_url`, `status?`, `superseded_by?`, `properties?`
- Materialized `sections` table (migration 010); section anchors as canonical chunk-level `source_hashes` (ADR-003 D-05 ground truth)
- Migration 010 backfills `sections` from existing chunks at upgrade time so existing vaults work immediately without re-indexing
- Denormalized `notes.status` column (migration 010); powers SQL-level superseded filter in `search_hybrid` (no per-candidate hydration on v1-default path)
- ADR-003 H-7 invariant: Section block aggregation and anchor algorithm

### Known limitations (Phase 3)
- `assemble_dossier.linked_documents[].relation` is currently always `"wikilink"`. Phase 4 widens to `wikilink | frontmatter-ref | mention | hyperlink` per ADR-003 Edge types. This will be a strictly additive change (new values, same field).
- Section anchors diverge under concurrent edits by design — Phase 5's staleness daemon will detect divergence and mark dependent briefs `stale: true`.
- `get_document_bundle.recent_edits` is keyed by current note path and does not surface pre-rename history. Audit log retains pre-rename rows for forensic use. Phase 4 (graph) widens this to note-id-keyed lookup that survives renames.

### Changed (Phase 3)
- `evals/v1-baseline/tools-list.snapshot.json` regenerated to include new optional params on `search_hybrid` (additive only).
```

## Slice file index

| Slice | File |
|---|---|
| 03-01 | `.planning/phases/03-bundles-authority-staleness/03-01-sections-infrastructure.md` |
| 03-02 | `.planning/phases/03-bundles-authority-staleness/03-02-get-outline.md` |
| 03-03 | `.planning/phases/03-bundles-authority-staleness/03-03-search-sections.md` |
| 03-04 | `.planning/phases/03-bundles-authority-staleness/03-04-get-document-bundle.md` |
| 03-05 | `.planning/phases/03-bundles-authority-staleness/03-05-search-hybrid-rescore.md` |
| 03-06 | `.planning/phases/03-bundles-authority-staleness/03-06-assemble-dossier.md` |
| 03-07 | `.planning/phases/03-bundles-authority-staleness/03-07-conformance-source-neutrality.md` |
