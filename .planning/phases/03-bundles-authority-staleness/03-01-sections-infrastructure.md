---
plan: 03-01-sections-infrastructure
phase: 03
wave: 0
depends_on: []
asm: [ASM-01, ASM-02, ASM-03, ASM-05, ASM-08]
status: pending
---

# Slice 03-01: Sections infrastructure

## Objective

Stand up the canonical section identity layer that the four new Phase 3 tools (and Phase 5 briefs) read from: a `BlockNode` `Section` variant in the canonical types, a content-hash `anchor` algorithm, an in-memory section extractor over parsed blocks, a materialized `sections` SQLite table (migration 010) with its query namespace, an indexer hook that populates sections alongside chunks, AND a one-time migration-time backfill so existing v1 user vaults have populated section rows immediately after upgrade. Also denormalizes `notes.status` (a single TEXT column) so the Phase 3 superseded filter (03-05) can run at SQL level rather than via per-candidate hydration. Plus the matching H-7 invariant addendum on ADR-003. Nothing in this slice is user-visible — but every subsequent slice depends on it.

## Requirements covered

- **ASM-01..ASM-03 prerequisite** — sections are the retrieval unit for `get_outline`, `search_sections`, and the section tree in `get_document_bundle`.
- **ASM-05 prerequisite** — section anchors are how `heading_path` and section-level citation packets get computed.
- **ASM-08 prerequisite (M4 fix)** — denormalized `notes.status` column powers the SQL-level superseded filter in 03-05; without this column, the filter would require per-candidate frontmatter hydration on the v1-default code path, regressing search perf.
- **ADR-003 D-05 ground truth** — section anchors ARE the chunk-level `source_hashes` Phase 5 briefs consume (locked by 03-CONTEXT.md D-01 and ADR-003 §"Hash semantics").

## Files to create / modify

### Create

- `src/sections/index.ts` — barrel; re-exports `extractSections`, `computeAnchor`, `SectionsQueries`, `SectionInfo`, `Section`-related types (per `src/search/index.ts` and `src/graph/index.ts` patterns).
- `src/sections/anchor.ts` — `computeAnchor(headingText: string, sectionBodyPlainText: string): string`. Algorithm per RESEARCH §4 H-7 wording: `sha256_hex(NFC(headingText) + "\n" + NFC(plainTextBody))`. Use Node's `node:crypto` `createHash("sha256")` — already in use at `src/reader/parse.ts` (verify via grep). Pure function. **No fs imports.**
- `src/sections/anchor.test.ts` — unit tests: empty heading (preamble case) produces stable hash; identical body+heading produce identical anchor across calls; NFC normalization of pre-composed vs decomposed Unicode produces identical anchor; trailing whitespace changes anchor.
- `src/sections/extract.ts` — `extractSections(blocks: BlockNode[]): SectionInfo[]`. Walks parsed blocks; aggregates each heading + descendant blocks up to the next equal-or-shallower heading per H-7. Returns an array of `SectionInfo { anchor, heading_path, heading_text, level, parent_index, ord, chunk_id_first, chunk_id_last, plain_text_body }` (chunk-id fields filled in later by the indexer). Top-of-document content (no preceding heading) becomes `level: 0, heading_text: "", heading_path: []`. **Pure; no fs/db imports.**
- `src/sections/extract.test.ts` — unit tests: zero-heading doc → one preamble section; single H1 + paragraphs → two sections; H1 → H2 → H3 → parent_index threading works; H1 → H2 → H1 closes the first H2; deeply nested doc (H1 → H2 → H3 → H2) closes H3 at the second H2; preamble + H1 case.
- `src/sections/backfill.ts` — `backfillSectionsFromChunks(db)`: walks each note's chunk rows, groups by `heading_path`, derives anchors via `computeAnchor`, writes `sections` rows. Pure of `fs`/`gray-matter`; only reads/writes via the `Database` handle. Detailed contract in the Backfill strategy section below.
- `src/sections/backfill.test.ts` — unit tests for the backfill helper: (a) v1-shaped DB with notes + chunks present and sections empty → backfill populates sections with expected anchors; (b) anchors produced by backfill equal anchors produced by a fresh `extractSections` re-parse (anchor-equivalence guarantee); (c) idempotent — running backfill twice produces the same rows (or the second run is a no-op when sections already exist).
- `src/db/queries/sections.ts` — `SectionsQueries` class mirroring `src/db/queries/chunks.ts:13` shape. Methods:
  - `insertMany(rows: InsertSectionRow[]): void` — prepared statement batch insert.
  - `deleteByNote(noteId: number): void` — for re-index.
  - `getByNote(noteId: number): SectionRow[]` — ordered by `parent_id` ascending then `ord` ascending (so callers can build the tree in one pass).
  - `getByAnchor(noteId: number, anchor: string): SectionRow | null` — unique lookup.
  - `findContainingChunk(chunkId: number): SectionRow | null` — used by `search_sections` to promote chunk hits.
- `src/db/queries/sections.test.ts` — unit tests against an in-memory `Database` per the v1 query-class test pattern.
- `evals/v1-baseline/migration-010-smoke.test.ts` OR a new case in an existing migration smoke test — assert migration 010 applies cleanly on a fresh DB, is a no-op on an already-migrated DB, AND the backfill step populates `sections` rows for existing notes (see M2 fix below) AND `notes.status` is correctly denormalized (see M4 fix below).

### Modify

- `src/types.ts` — extend `BlockNode` union with the `Section` variant per RESEARCH §4 recommendation A+B:
  ```ts
  | { kind: "section"; anchor: string; heading_path: string[]; level: 0 | 1 | 2 | 3 | 4 | 5 | 6; blocks: BlockNode[] }
  ```
  This is additive — existing `BlockNode` consumers (none today use `kind === "section"`) are unaffected. Also export `SectionInfo` (used by sections/extract.ts) and `SectionRow` (used by sections/queries.ts).
- `src/db/schema.ts` — append migration v10 to the `MIGRATIONS` array (`src/db/schema.ts:503`). Migration 010 includes THREE DDL/data steps, all inside one transaction:
  1. **`sections` table + indexes** per RESEARCH §2 (static SQL):
     ```sql
     CREATE TABLE sections (
       id              INTEGER PRIMARY KEY,
       note_id         INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
       anchor          TEXT NOT NULL,
       heading_path    TEXT NOT NULL,    -- JSON array of strings
       heading_text    TEXT NOT NULL,
       level           INTEGER NOT NULL,
       parent_id       INTEGER REFERENCES sections(id) ON DELETE CASCADE,
       ord             INTEGER NOT NULL,
       chunk_id_first  INTEGER REFERENCES chunks(id),
       chunk_id_last   INTEGER REFERENCES chunks(id),
       created_at      INTEGER NOT NULL
     );
     CREATE UNIQUE INDEX sections_note_anchor ON sections(note_id, anchor);
     CREATE INDEX sections_note_parent_ord ON sections(note_id, parent_id, ord);
     CREATE INDEX sections_chunk_range ON sections(note_id, chunk_id_first, chunk_id_last);
     ```
  2. **Denormalized `notes.status` column (M4 fix)** — static `ALTER` + `UPDATE` + partial index:
     ```sql
     ALTER TABLE notes ADD COLUMN status TEXT;
     UPDATE notes SET status = json_extract(frontmatter, '$.status')
       WHERE frontmatter IS NOT NULL;
     CREATE INDEX notes_status ON notes(status) WHERE status IS NOT NULL;
     ```
     The partial index keeps the index tiny — only rows with a non-null `status` are indexed. Expected fixture cardinality is small (most notes have no `status:` frontmatter). This column is read by 03-05's superseded filter in `searchOneVault` (M4 acceptance below).
     - If `notes.frontmatter` is stored as JSON text (typical v1 shape) `json_extract` works directly.
     - If it's stored as a serialized parsed object (verify via `src/db/queries/notes.ts`), the migration runner uses a function-style step that parses + extracts in JS instead of SQL `json_extract`. Either way the result is the same `notes.status` value.
  3. **Section backfill (M2 fix)** — function-style migration step calling `src/sections/backfill.ts:backfillSectionsFromChunks(db)`. Runs AFTER the DDL above, in the same transaction. See "Backfill strategy" below.

  Use static-SQL for step 1 and the column DDL parts of step 2; function-style for step 3 (and step 2's UPDATE if SQL `json_extract` is unavailable).
- `src/db/database.ts` — wire `SectionsQueries` into the per-vault `Database` class. Locate the place where `chunks: ChunksQueries` is instantiated in the constructor (mirror that pattern). Export `sections` field on `Database`.
- `src/db/queries/notes.ts` — add `getStatus(noteId): string | null` accessor + `setStatus(noteId, status: string | null): void` writer used by the indexer so future writes maintain the denormalized column in sync with `notes.frontmatter`. Add focused tests asserting denormalization stays in sync after `setStatus` and after a frontmatter write.
- `src/indexer/indexer.ts` — two changes:
  1. Gain a `buildSections(note, chunkIdRange)` step that runs alongside `buildChunks`. After chunks are inserted (so chunk IDs exist), call `extractSections(blocks)` then call `SectionsQueries.deleteByNote()` and `insertMany()`. The `chunk_id_first`/`chunk_id_last` for each section is derived by walking the chunk list and matching each chunk's `heading_path` to the section's range. Keep the helper that does this matching pure and local — name it `mapChunksToSections(chunks, sections)`.
  2. Maintain the denormalized `notes.status` column on every note write/update — call `notesQueries.setStatus(noteId, parsedProperties.status ?? null)` immediately after writing frontmatter. The same indexer write path that writes frontmatter writes status.
  Add a focused test `src/indexer/sections-hook.test.ts`.
- `docs/v2/adr/003-document-shape.md` — append H-7 invariant addendum at the end of the Invariants section. Wording per RESEARCH §4:
  > **H-7**: A `Section` block aggregates a `HeadingNode` and all `BlockNode` descendants up to (but not including) the next equal-or-shallower heading. The `anchor` is the sha256 hex of `NFC(heading_text) || "\n" || render_blocks_to_plain_text(blocks)`. The `heading_path` is the array of ancestor heading texts (NFC-normalized, root → leaf, inclusive of this section's heading). Top-of-document content with no preceding heading is wrapped as `{kind: "section", level: 0, heading_path: [], heading_text: "", anchor: sha256(NFC("") || "\n" || body)}`.
  This is strictly additive — do not touch H-1..H-6.

## Approach

**Algorithm — anchor computation (per H-7, NFC normalization is required):**

```
plainTextBody = blocks.map(blockToPlainText).join("\n")
canonical = headingText.normalize("NFC") + "\n" + plainTextBody.normalize("NFC")
anchor = sha256_hex(canonical)
```

The `blockToPlainText(block)` helper: paragraph → `block.text`; heading → `"#".repeat(level) + " " + text`; list → recursive bullet-prefixed lines; code → `"```" + lang + "\n" + text + "\n```"`. Keep this helper inside `src/sections/anchor.ts` since it's only used for the anchor canonical form. Note: this is NOT a full markdown round-trip; it's a deterministic plain-text rendering whose only constraint is that identical-content sections produce identical hashes.

**Algorithm — section extraction (extract.ts):**

Walk `BlockNode[]` left to right. Maintain a stack of "currently open sections" (each with its level). On each heading:
- pop all open sections whose level >= this heading's level
- create a new SectionInfo with `parent_index` = top of stack (or `null` if stack empty)
- push it
On each non-heading block: append to the current top-of-stack section's `blocks` array (or a synthetic level-0 preamble section if the stack is empty and we hit content before any heading).

`heading_path` is `stack.map(s => s.heading_text)` at the time of section creation, inclusive of the section's own heading text.

`ord` is the section's index among its siblings (children of the same parent), assigned post-walk via a second pass over the flat list.

**Indexer integration:** sections must be inserted AFTER chunks (because `chunk_id_first`/`chunk_id_last` reference `chunks(id)`). Walk the inserted chunks (each chunk knows its `heading_path` per the v1 chunker — verify via `src/chunker/headings.ts`) and bucket chunks into sections by exact `heading_path` match. A section with no matching chunks (rare — e.g. a heading with no body content) gets `chunk_id_first = chunk_id_last = null`.

### Backfill strategy (M2 fix — chosen option: migration-time)

**Decision:** option (a) from the plan-checker's M2 finding — a one-shot migration-time backfill at upgrade. The migration walks each existing note's chunk rows, groups by `heading_path`, derives anchors via `computeAnchor`, and writes the resulting `sections` rows. This avoids the v1-catchup limitation (which only re-indexes notes whose hash has changed and would therefore leave most notes with empty `sections` rows after upgrade).

**Why migration-time backfill is correct:**
- The chunker's `heading_path` on existing chunks IS the same heading partition `extractSections` would produce from a re-parse — both are derived from the same source markdown using the same heading-extraction logic (`src/chunker/headings.ts`).
- Anchors require the section's plain-text body. The chunks' `text` field IS that body (the chunker emits chunks whose concatenation reconstructs the source body, sans frontmatter, per v1 contract). Concatenating chunks per `heading_path` gives the section body bytes.
- Therefore: `anchor(backfill) === anchor(reindex)` for every section, proven by an explicit test in `src/sections/backfill.test.ts`.

**`backfillSectionsFromChunks(db)` contract (in `src/sections/backfill.ts`):**

```
For each note_id in (SELECT id FROM notes):
  1. Read chunks: SELECT id, heading_path, text FROM chunks WHERE note_id = ? ORDER BY id ASC.
  2. Group chunks by heading_path JSON value (chunks already carry heading_path per v1 chunker).
  3. For each unique heading_path group, in document order (min(chunk.id) ascending):
       - heading_text = last element of heading_path (or "" for preamble where heading_path is []).
       - level        = heading_path.length (0 = preamble, 1 = H1, 2 = H2, ...).
       - body         = chunks.map(c => c.text).join("\n").
       - anchor       = computeAnchor(heading_text, body).
       - chunk_id_first / chunk_id_last = min/max chunk.id in the group.
  4. Assign parent_id by walking groups in level-ascending order:
       - For each section S, parent_id is the most recently-seen section whose heading_path
         is a strict prefix of S.heading_path (longest matching prefix wins).
       - Preamble (level 0) has parent_id = null.
  5. Assign ord per (note_id, parent_id) sibling group based on chunk_id_first order.
  6. INSERT sections rows in one transaction per note.
```

**Properties of the backfill:**
- **Idempotent**: re-applying the migration is a no-op because the v1 migration runner only runs migrations whose version > `user_version` (per `src/db/database.ts:97`). Independently, the helper itself is idempotent — if `sections` rows already exist for a given `note_id`, it skips (so the helper is safe to invoke twice in tests).
- **Performance**: O(total chunks) one-time pass at upgrade. Atlas Robotics fixture (~75 notes, ~300 chunks) completes in milliseconds; a 10,000-note vault is still well under a second.
- **Correctness**: derives the same anchors that a re-index would produce (proven by the `backfill.test.ts` anchor-equivalence test).
- **Edge case — preamble content**: chunks for content before any heading have `heading_path: []` and group cleanly into a single level-0 section per note.

**Indexer-time (option b) was rejected because** it conflates "first-time install" with "always-run-this-step" and makes catchup more expensive on every server start forever. Migration-time runs once at upgrade and never again.

### Adapter-seam discipline (NON-NEGOTIABLE per `.planning/phases/01-adapter-extraction-tech-debt-up/01-CONTEXT.md`)

No file in `src/sections/` may import `fs`, `gray-matter`, `chokidar`, `path.join`, or `path.resolve`. The Section module reads only from `BlockNode[]` (already-parsed by the source adapter) or from existing DB rows (the backfill helper) and writes only to SQLite via the existing `Database` handle. `scripts/lint-adapters.sh` (Phase 1 plan 01-06) will catch violations. This applies to BOTH `src/sections/` and (looking ahead) `src/assembly/`.

## Tasks

1. **types.ts extension** — add `Section` variant to `BlockNode` union (`src/types.ts`); export `SectionInfo`, `SectionRow`, `InsertSectionRow`. Compile-check passes. (~30 LOC, 1 file)
2. **anchor.ts + tests** — implement `computeAnchor` + `blockToPlainText` helper; co-located unit tests cover empty-heading, NFC-equivalence, whitespace-sensitivity, multi-block bodies. (~120 LOC across two files)
3. **extract.ts + tests** — implement `extractSections`; tests cover preamble, single H1, nested H1>H2>H3, sibling H1 closure, deep close-out. (~200 LOC across two files)
4. **Migration 010 part A: sections DDL + SectionsQueries + tests** — append the `CREATE TABLE sections` + 3 indexes DDL to `src/db/schema.ts:503`; implement `SectionsQueries` in `src/db/queries/sections.ts` mirroring `chunks.ts:13` patterns; wire into `src/db/database.ts` `Database` constructor; co-located query tests against in-memory DB. (~320 LOC across three files + one test file)
5. **Migration 010 part B: denormalized `notes.status` column (M4 fix)** — `ALTER TABLE notes ADD COLUMN status TEXT`; UPDATE backfill via `json_extract(frontmatter, '$.status')` (or function-style equivalent if needed); partial index `notes_status` ON `notes(status) WHERE status IS NOT NULL`. Add `NotesQueries.getStatus(noteId)` + `setStatus(noteId, status)` accessors. Test: existing notes have correct denormalized status after migration; setStatus keeps `notes.status` in sync after frontmatter write. (~150 LOC)
6. **Migration 010 part C: section backfill (M2 fix)** — implement `src/sections/backfill.ts:backfillSectionsFromChunks(db)` per the contract above; wire into migration 010 as a function-style step that runs AFTER the DDL of parts A and B, all in the same transaction. Co-locate `src/sections/backfill.test.ts` with 3 cases (backfill from v1-shaped DB; anchor equivalence proof vs `extractSections`; idempotency). (~250 LOC across two files)
7. **Indexer + section hook + status maintenance + test** — add `buildSections` step to `src/indexer/indexer.ts`; implement `mapChunksToSections(chunks, sections)`; call `notesQueries.setStatus(...)` immediately after every frontmatter write so the denormalized `notes.status` stays in sync; add `src/indexer/sections-hook.test.ts` with a fixture note covering preamble + nested headings + a `status: active` frontmatter (asserts the denormalized column is written). (~220 LOC)
8. **ADR-003 H-7 addendum** — append the H-7 invariant block to `docs/v2/adr/003-document-shape.md` Invariants section. Do not edit H-1..H-6. (~12 LOC of markdown)
9. **End-to-end smoke** — `src/sections/integration.test.ts` (or extension to `src/db/database.test.ts`) indexes a small in-memory fixture (3 notes, varying heading depths, one with `status: superseded`) and asserts: (a) sections rows exist with expected anchors; (b) `getByNote` returns parent-ordered rows; (c) `findContainingChunk` returns the right section for a chunk in the middle of a nested H3; (d) re-indexing the same note produces identical anchors (anchor stability under no-op re-index); (e) `notes.status` is `'superseded'` for the one note and `NULL` for the other two; (f) the M2 backfill case: drop `sections` rows manually, simulate "v1 DB pre-migration state," re-apply backfill helper, assert sections rows match the re-index output. (~180 LOC)

## Tests

- `src/sections/anchor.test.ts` — 5–6 cases
- `src/sections/extract.test.ts` — 5–6 cases
- `src/sections/backfill.test.ts` — 3 cases (backfill from v1-shaped DB; anchor equivalence proof; idempotency)
- `src/db/queries/sections.test.ts` — 4–5 cases
- `src/db/queries/notes.test.ts` (status accessor additions) — 2–3 cases
- `src/indexer/sections-hook.test.ts` — 3–4 cases (including status denormalization)
- `src/sections/integration.test.ts` — 5–6 cases (including the M2 backfill end-to-end)
- migration smoke (in `evals/v1-baseline/migration-010-smoke.test.ts` or `src/db/database.test.ts`) — 3 cases (DDL applies; section backfill populates; denormalized status correct)

**Estimated new test cases:** 28–35 (revised up from 18–22 to cover the backfill + status column).

## Acceptance criteria

- [ ] `BlockNode` union exports include `Section` variant; `tsc --noEmit` passes.
- [ ] `computeAnchor` is a pure deterministic function (same input → same output across processes); test asserts NFC normalization.
- [ ] `extractSections` produces a flat array whose tree (built via `parent_index`) matches the expected nested structure per RESEARCH §4.
- [ ] Migration v10 applies cleanly on a fresh DB; `sqlite_master` shows `sections` table with the three indexes AND `notes.status` column with the partial index; re-applying is idempotent (no-op per the v1 migration runner contract).
- [ ] **(M2)** Migration v10 backfill populates `sections` rows for existing v1 notes WITHOUT requiring a content edit / catchup pass. A test asserts: take a v1-shaped DB (notes + chunks rows present, sections rows absent) → apply migration → `sections` rows match what a fresh re-index would produce (anchor-equivalent). The anchor-equivalence test compares `backfillSectionsFromChunks(db)` output against `extractSections(parseBlocks(noteBody))` output for every note in the fixture.
- [ ] **(M4)** Migration v10 adds `notes.status` denormalized column AND populates it from existing `frontmatter`. A test asserts: a note whose frontmatter contains `status: superseded` has `notes.status = 'superseded'` after migration with no manual intervention.
- [ ] **(M4)** Indexer maintains `notes.status` in sync with frontmatter on every note write — proven by a test that writes a note with `status: active`, asserts `getStatus(noteId) === 'active'`, then updates the frontmatter to remove status, asserts `getStatus(noteId) === null`.
- [ ] Indexer populates `sections` for every indexed note; reindexing an unchanged note produces identical anchors AND idempotent row contents.
- [ ] `scripts/lint-adapters.sh` (Phase 1 plan 01-06) passes — no `fs`/`gray-matter`/`chokidar`/`path.*` imports in `src/sections/`.
- [ ] ADR-003 H-7 addendum is committed; ADR README index updated if it lists invariants per ADR (check `docs/v2/adr/README.md`).
- [ ] All 324 existing tests still pass.

## Estimated effort

- **Tasks:** 9 (revised up from 7 to cover the backfill + status column)
- **Lines changed:** ~1300 added across 11 new files + 5 modified files
- **PR shape:** one PR for all 9 tasks (Wave 0 must land atomically — all four Wave 1 slices depend on the full surface, including the denormalized status column for 03-05's SQL filter)

## Citations

- `src/types.ts:311-315` — current `BlockNode` union (extension point)
- `src/db/schema.ts:503` — `MIGRATIONS` array head
- `src/db/schema.ts:27` — function-style migration form (used for backfill steps)
- `src/db/queries/chunks.ts:13` — exemplar QueryClass shape
- `src/chunker/headings.ts:1-88` — heading extraction reused
- `docs/v2/adr/003-document-shape.md` §"Invariants" — append H-7 here
- 03-CONTEXT.md §D-01 — section identity contract
- 03-RESEARCH.md §1 (placement), §2 (storage), §4 (BlockNode extension + H-7 wording)
- Plan-checker M2 — section backfill at migration time (chosen option a)
- Plan-checker M4 — denormalized `notes.status` column for SQL-level superseded filter
