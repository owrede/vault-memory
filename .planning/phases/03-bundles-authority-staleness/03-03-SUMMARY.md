---
phase: 03-bundles-authority-staleness
plan: 03
status: complete
completed: 2026-05-16
requirements:
  - ASM-03
  - ASM-05
files_created:
  - src/assembly/search-sections.ts
  - src/assembly/search-sections.test.ts
  - .planning/phases/03-bundles-authority-staleness/03-03-DEVIATIONS.md
files_modified:
  - src/tool-registry.ts
  - src/tool-registry.test.ts
  - src/server.ts
  - src/server.test.ts
  - evals/v1-baseline/baseline.test.ts
  - evals/v1-baseline/tools-list.snapshot.json
commits: 4
tests_added: 14
---

# Phase 3 Plan 03: `search_sections` MCP tool — Summary

Ship `search_sections({query, limit, vaults?, recency_weight?,
authority_weight?, include_superseded?})` — section-level retrieval that
COMPOSES the v1 chunk-level hybrid pipeline (`hybridSearch`) with a
chunk-to-section promotion step. Composition strategy: run `hybridSearch`
with an inflated `topK = limit × 5`, promote each chunk hit to its
enclosing section via `SectionsQueries.findContainingChunk`, dedupe by
`(note_id, anchor)`, score each section as the MAX of its constituent
chunk scores, sort DESC tie-broken by `chunk_id_first` ASC, slice to
`limit`, hydrate into `SectionHit` packets carrying the 8-field D-01
citation floor plus section-specific extras (anchor, score, chunk_ids,
snippet).

The v1 RRF / rerank pipeline is preserved byte-for-byte — this slice
adds a thin promotion controller on top, not a new ranker. Tool count
grows from 26 → 27.

## Outcome

| Acceptance criterion | Status |
|---|---|
| `search_sections` registered, listed, callable | PASS |
| Response = `SectionHit[]` with `heading_path` always non-empty | PASS |
| Score aggregation = max; tie-break = `chunk_id_first` ASC | PASS |
| Orphan chunks silently dropped; section count ≤ `limit` | PASS |
| Underlying `hybridSearch` is called exactly once with `topK = limit × 5` | PASS |
| `recency_weight` / `authority_weight` / `include_superseded` accepted on the args boundary (forwarding wires up once 03-05 lands) | PASS (per plan deferred-forwarding clause) |
| All unit + integration tests pass; v1-baseline still green | PASS |
| No fs/path/gray-matter/chokidar imports in `src/assembly/` | PASS (`scripts/lint-adapters.sh` green) |

## Files changed

### Created (3)

- `src/assembly/search-sections.ts` — `searchSections(deps, args)`
  controller; `SearchSectionsArgs`, `SearchSectionsDeps`,
  `SearchSectionsHybridInput`, `SectionResolution`, `SectionHit` types.
- `src/assembly/search-sections.test.ts` — 13 unit cases + 1 integration
  smoke (real DB seeded by `buildSectionsForNote`, stub `searchHybrid`).
- `.planning/phases/03-bundles-authority-staleness/03-03-DEVIATIONS.md`
  — seven deviation notes covering worktree routing, rescore-param
  forwarding placeholder, SearchHit indirection through `chunkIdx`,
  preamble-drop policy, stale-read silent-drop policy, snapshot
  regeneration, and pre-existing dirty working tree on entry.

### Modified (6)

- `src/tool-registry.ts` — new TOOLS entry + Zod raw shape. Description
  documents the composition strategy + the section-vs-chunk choice.
- `src/tool-registry.test.ts` — bumped tool count assertion 26 → 27; added
  `search_sections` to the "non-empty descriptions" spot check.
- `src/server.ts` — handler dispatch entry. Wires `searchHybrid` to the
  production `hybridSearch` closure, `sectionForHit` to the
  notes/chunks/sections DB lookup, `readDocument` to
  `SourceConnector.readDocument`, and `displayUrlFor` to
  `SourceConnector.formatDisplayUrl`.
- `src/server.test.ts` — three tool-count assertions updated 26 → 27;
  one assertion extended to check `search_sections` is in the list.
- `evals/v1-baseline/baseline.test.ts` — tool-count assertion 26 → 27.
- `evals/v1-baseline/tools-list.snapshot.json` — regenerated via
  `npm run eval:snapshot`. The 23 v1 baseline names are still in slots
  0–22, byte-identical (the `preserves the 23 v1 baseline tool names
  byte-identical` test still passes).

## Tests added

| File | Cases |
|---|---|
| `src/assembly/search-sections.test.ts` — promotion §a–f | 6 |
| `src/assembly/search-sections.test.ts` — contract assertions | 7 |
| `src/assembly/search-sections.test.ts` — integration smoke | 1 |
| **Total** | **14** |

Cases:

1. Single chunk hit → one section; section.score == chunk.score
2. Multi-chunk-per-section → one result; score = max(constituent scores); chunk_ids lists all
3. Multi-note → one section hit per (note, section); sorted by score DESC
4. Tie-break: equal scores sort by chunk_id_first ASC
5. Orphan chunk (`sectionForHit → null`) silently dropped
6. Every hit's `heading_path` non-empty (preamble dropped)
7. `searchHybrid` called once with `topK = limit × 5`
8. `vaults` filter forwarded to `searchHybrid`
9. Rescore params accepted on args boundary (no crash; forwarding stubbed)
10. Empty inner search → `[]`
11. `readDocument` throw → hit silently dropped (recall-style)
12. `limit` slice applied AFTER sort
13. Citation packet shape: all 8 D-01 fields present on each hit
14. Integration: real `findContainingChunk` against in-memory DB ranks 3
    distinct sections (Beta, Plan, Status) in expected score order

## Commits (4)

| # | Hash      | Message |
|---|-----------|---------|
| 1 | `d9b83e9` | `feat(03-03): add searchSections controller (chunk RRF → promote-to-section)` |
| 2 | `c10230c` | `test(03-03): unit + integration coverage for searchSections` |
| 3 | `840f49c` | `feat(03-03): register search_sections MCP tool` |
| 4 | `a2cc9e1` | `feat(03-03): wire search_sections handler in MCP server` |

## Architecture notes

### Composition, not reimplementation

`searchSections` calls `hybridSearch` exactly once and never touches the
RRF, rerank, or per-vault fan-out logic. The promotion + dedup + max +
slice happens AFTER `hybridSearch` returns. This is per RESEARCH §3
option 3 (chosen over options 1 — section-level FTS, and 2 — section-
level embeddings, both rejected on grounds of either incompleteness or
index duplication).

Consequence: any improvement to `hybridSearch` (slice 03-05's rescore,
the Phase 5 reranker swap, etc.) is automatically inherited by
`search_sections` with zero code change.

### Adapter-seam discipline

`src/assembly/search-sections.ts` imports NOTHING from `node:fs`,
`node:path`, `gray-matter`, or `chokidar`. All vault-content access
flows through four injected dependencies (`searchHybrid`,
`sectionForHit`, `readDocument`, `displayUrlFor`). Tests inject stubs;
production wires the real DB / SourceConnector closures inside
`src/server.ts`. `scripts/lint-adapters.sh` enforces this on every CI
run.

### Citation packet reuse

Each `SectionHit` extends `CitationPacket` (from
`src/memory/citation-packet.ts`) — the same 8-field shape recall (Phase
2) returns. The hit is built via `toCitationPacket(doc, displayUrl)`
with the section's `heading_path` overriding the doc-level (empty)
default. Section-specific extras (`anchor`, `score`, `snippet`,
`chunk_ids`) are added as fields on top.

This means: assembly tools and memory tools speak the same citation
language; downstream consumers (the Phase 5 brief layer, agent
controllers, MCP clients) parse one shape.

### Forward-compat with slice 03-05

`SearchSectionsArgs` declares `recency_weight`, `authority_weight`, and
`include_superseded` already. The controller plumbs them into its
`SearchSectionsHybridInput` only as the underlying contract supports
them — today that's the v1 subset (`query`, `topK`, `vaults`). When
03-05 lands, the server handler will pass them into the inner
`hybridSearch({ recencyWeight, authorityWeight, includeSuperseded, ... })`
call directly. No controller, tool-registry, or test changes will be
needed.

See `.planning/phases/03-bundles-authority-staleness/03-03-DEVIATIONS.md`
§2 for the merge-order plan.

## Gates

| Gate | Status |
|---|---|
| `npx tsc --noEmit` | green |
| `scripts/lint-adapters.sh` | green (for 03-03 changes; pre-existing 03-05 in-flight `src/types.ts` edit trips I-5b but is not part of this slice — see DEVIATIONS §7) |
| `npm run eval:baseline` | green |
| `npx vitest run --exclude "**/.claude/**"` | green (77 files, 974 passed / 11 skipped) |
| `src/assembly/search-sections.test.ts` | green (14/14) |

## Self-Check: PASSED

Created files:
- `src/assembly/search-sections.ts` — FOUND
- `src/assembly/search-sections.test.ts` — FOUND
- `.planning/phases/03-bundles-authority-staleness/03-03-DEVIATIONS.md` — FOUND
- `.planning/phases/03-bundles-authority-staleness/03-03-SUMMARY.md` — FOUND

Commits:
- `d9b83e9` — FOUND
- `c10230c` — FOUND
- `840f49c` — FOUND
- `a2cc9e1` — FOUND
