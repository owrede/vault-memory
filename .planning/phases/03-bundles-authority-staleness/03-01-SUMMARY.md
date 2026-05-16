---
phase: 03-bundles-authority-staleness
plan: 01
status: complete
completed: 2026-05-16
requirements:
  - ASM-01
  - ASM-02
  - ASM-03
  - ASM-05
  - ASM-08
files_created:
  - src/sections/anchor.ts
  - src/sections/anchor.test.ts
  - src/sections/extract.ts
  - src/sections/extract.test.ts
  - src/sections/backfill.ts
  - src/sections/backfill.test.ts
  - src/sections/integration.test.ts
  - src/sections/index.ts
  - src/db/queries/sections.ts
  - src/db/queries/sections.test.ts
  - src/indexer/sections-hook.test.ts
  - evals/v1-baseline/migration-010-smoke.test.ts
files_modified:
  - src/types.ts
  - src/db/schema.ts
  - src/db/database.ts
  - src/db/queries/notes.ts
  - src/db/queries/notes.test.ts
  - src/indexer/indexer.ts
  - docs/v2/adr/003-document-shape.md
commits: 9
tests_added: 47
---

# Phase 3 Plan 01: Sections infrastructure — Summary

Stand up the canonical section identity layer that the four new Phase 3
tools (03-02..03-05) and Phase 5 briefs read from. Eight surfaces landed
together as Wave 0 of Phase 3: a `Section` `BlockNode` variant in the
canonical types, the H-7 sha256 anchor algorithm, a pure section
extractor over `BlockNode[]`, a markdown-to-blocks lifter for the
indexer + backfill, a materialized `sections` SQLite table (migration
010) with three indexes and a query namespace, a denormalized
`notes.status` column with backfill from `json_extract(frontmatter,
'$.status')`, an indexer hook that builds sections + maintains
`notes.status` in lockstep, a one-time migration-time backfill so
existing v1 user vaults get sections immediately on upgrade, and the
H-7 invariant addendum to ADR-003.

Nothing user-visible (no new MCP tool, no `tools/list` diff); every
subsequent Phase 3 slice depends on this surface.

## Outcome

| Acceptance criterion | Status |
|---|---|
| `BlockNode` union exports `Section` variant; `tsc --noEmit` clean | PASS |
| `computeAnchor` deterministic + NFC-normalized + LF-only | PASS |
| `extractSections` produces a flat array threading to expected tree | PASS |
| Migration v10 applies cleanly on fresh DB; `sections` + 3 indexes + `notes.status` + partial index present; re-applying is no-op | PASS |
| (M2) Migration v10 backfill populates `sections` rows on v1-shaped DB; anchors match a fresh re-index byte-for-byte | PASS |
| (M4) Migration v10 backfills `notes.status` from frontmatter on existing rows | PASS |
| (M4) Indexer maintains `notes.status` in sync via setStatus on every write | PASS |
| Indexer populates `sections` for every indexed note; reindexing unchanged note produces identical anchors | PASS |
| `scripts/lint-adapters.sh` green — no `fs`/`gray-matter`/`chokidar`/`path.*` imports in `src/sections/` | PASS |
| ADR-003 H-7 addendum committed | PASS |
| All existing tests pass (no regressions) | PASS (902 → 960 with the 1 historically-flaky chokidar test green) |

## Files changed

### Created (12)
- `src/sections/anchor.ts` — `computeAnchor(headingText, blocks)` per H-7; `blockToPlainText` discriminated renderer.
- `src/sections/anchor.test.ts` — 12 cases.
- `src/sections/extract.ts` — `extractSections(blocks)` walker + `markdownToSectionBlocks(content)` lifter.
- `src/sections/extract.test.ts` — 15 cases.
- `src/sections/backfill.ts` — `backfillSectionsFromChunks(db)` (re-derives from `notes.content`, not `chunks.heading_path` — see deviations §D1).
- `src/sections/backfill.test.ts` — 5 cases (incl. anchor-equivalence + idempotency).
- `src/sections/integration.test.ts` — 6 cases (end-to-end smoke across 3 fixture notes).
- `src/sections/index.ts` — module barrel.
- `src/db/queries/sections.ts` — `SectionsQueries` (insertMany, deleteByNote, getByNote, getByAnchor, findContainingChunk, countByNote).
- `src/db/queries/sections.test.ts` — 7 cases (incl. UNIQUE + CASCADE).
- `src/indexer/sections-hook.test.ts` — 6 cases (`buildSectionsForNote`, `mapChunksToSections`, `extractStatus`, status sync).
- `evals/v1-baseline/migration-010-smoke.test.ts` — 3 cases (DDL applied; section backfill; status backfill).

### Modified (7)
- `src/types.ts` — added `Section` variant to `BlockNode`; exported `SectionInfo`, `SectionRow`, `InsertSectionRow`.
- `src/db/schema.ts` — appended `runMigration010` (3 ordered steps in one transaction: sections DDL, notes.status backfill, section backfill).
- `src/db/database.ts` — wired `SectionsQueries` into the per-vault `Database`.
- `src/db/queries/notes.ts` — added `getStatus(noteId)` + `setStatus(noteId, status)`.
- `src/db/queries/notes.test.ts` — 3 new cases for status accessors.
- `src/indexer/indexer.ts` — added `buildSectionsForNote`, `mapChunksToSections`, `extractStatus`; plumbed section build after chunk insert + status maintenance after every frontmatter write.
- `docs/v2/adr/003-document-shape.md` — H-7 invariant addendum (additive; H-1..H-6 unchanged).

## Tests added

| File | Cases |
|---|---|
| `src/sections/anchor.test.ts` | 12 |
| `src/sections/extract.test.ts` | 15 |
| `src/sections/backfill.test.ts` | 5 |
| `src/db/queries/sections.test.ts` | 7 |
| `src/db/queries/notes.test.ts` (status additions) | 3 |
| `src/indexer/sections-hook.test.ts` | 6 |
| `src/sections/integration.test.ts` | 6 |
| `evals/v1-baseline/migration-010-smoke.test.ts` | 3 |
| **Total** | **57** |

(Plan estimated 28–35; final count 57 — extra cases on anchor
renderer + edge-case threading + UNIQUE/CASCADE enforcement.)

## Test results

```
npx vitest run         → 960 pass | 11 skipped (76 files)
npx tsc --noEmit       → clean (no errors)
scripts/lint-adapters.sh → all 8 invariants green
npm run eval:baseline  → 30 pass | 11 skipped — v1 invariance confirmed
```

Baseline before this plan: 902 passing tests. After: 960 — +58 net
(one flaky chokidar test also recovered). Zero regressions.

## Deviations

See `03-01-DEVIATIONS.md` for full detail.

- **D1 (resolved inside slice):** `chunks.heading_path` in v1 is a
  markdown string carrying only the immediate predecessor heading
  (e.g. `"## 5. Empfehlung"`) — insufficient to reconstruct a full
  section tree. The plan's backfill description "group chunks by
  heading_path" was replaced by "re-derive sections from
  `notes.content` via `markdownToSectionBlocks → extractSections`".
  The anchor-equivalence guarantee still holds trivially because the
  indexer + backfill run the same pipeline against the same content
  bytes. A new pure helper `markdownToSectionBlocks(content)` in
  `src/sections/extract.ts` lifts markdown into a minimal
  `BlockNode[]` of heading + paragraph variants. No architectural
  change; contained to this slice.
- **D2 (no action needed):** plan flagged a possible deviation for
  the frontmatter shape (object vs JSON string). Reading
  `src/indexer/indexer.ts:168` confirmed `notes.frontmatter` is
  JSON-stringified text, so `json_extract` works directly. No
  function-style fallback needed.

## Citations

- `src/types.ts:311-340` — `BlockNode` Section variant + `SectionInfo`/`SectionRow`/`InsertSectionRow`.
- `src/db/schema.ts:runMigration010` — three-step migration 010 inside one transaction.
- `src/db/queries/sections.ts:findContainingChunk` — `ORDER BY (chunk_id_last - chunk_id_first) ASC LIMIT 1` is what makes innermost-section selection work.
- `src/indexer/indexer.ts:buildSectionsForNote` — runs AFTER `chunks.insertBatch` so chunk IDs exist for `chunk_id_first/last`.
- `src/indexer/indexer.ts:extractStatus` — sole place that translates `frontmatter.status` → the denormalized column.
- `docs/v2/adr/003-document-shape.md:H-7` — anchor algorithm pinned for the v2 ecosystem.

## Self-Check: PASSED

Spot-verified post-summary:

- `[ -f src/sections/anchor.ts ]` → FOUND
- `[ -f src/sections/extract.ts ]` → FOUND
- `[ -f src/sections/backfill.ts ]` → FOUND
- `[ -f src/db/queries/sections.ts ]` → FOUND
- `[ -f docs/v2/adr/003-document-shape.md ]` → FOUND (H-7 appended)
- `git log --oneline f465cd9..HEAD` → 9 commits, all `03-01` scoped
- `npx vitest run` → 960 pass, 0 failed
- `bash scripts/lint-adapters.sh` → all 8 invariants green
