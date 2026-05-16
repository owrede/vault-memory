# 03-01 Deviations

## Deviation D1 — backfill reads `notes.content`, not `chunks.heading_path`

**What plan said.** Backfill (task 6) walks each note's `chunks` rows, groups
by `heading_path`, derives anchors via `computeAnchor`, writes sections.

**What we found.** `chunks.heading_path` in the v1 schema is a single
**markdown string** (e.g. `"## 5. Empfehlung"`) computed by
`headingPathAtOffset(headings, primaryStart)` at chunk creation
(`src/chunker/chunker.ts:104`, `src/chunker/headings.ts:77`). It carries
**only the nearest preceding heading**, not the full ancestor chain
(H1 → H2 → H3). It is therefore insufficient to reconstruct a proper section
tree by grouping chunks alone: two H2 sections that share an H1 ancestor
have identical `heading_path` values on their chunks if their immediate H2
headings have the same text, and there is no encoded H1 ancestor.

Additionally, `Document.blocks` in `src/adapters/source/obsidian-fs/index.ts:125`
is currently a stub `[{ kind: "paragraph", text: parsed.content }]` — no
real heading/paragraph split exists yet at the BlockNode layer.

**Impact.** The plan's contract for `extractSections(blocks: BlockNode[])`
still holds (pure walk over a `BlockNode[]` that includes `heading`
variants). But the indexer and backfill cannot rely on `BlockNode[]` being
available — only `notes.content` (markdown) is. They must derive a minimal
`BlockNode[]` (heading + paragraph variants) before calling
`extractSections`.

**Resolution (contained, no architectural change).**

1. `src/sections/extract.ts` keeps the contract from the plan:
   `extractSections(blocks: BlockNode[]): SectionInfo[]`. Pure, no fs.
2. Add a small pure helper `markdownToSectionBlocks(content: string): BlockNode[]`
   inside `src/sections/extract.ts`. It runs `extractHeadings` over the
   markdown (already in `src/chunker/headings.ts`, no fs/gray-matter
   imports) and emits an alternating sequence of `heading` + `paragraph`
   `BlockNode`s — heading variants carry level/text; paragraph variants
   carry the body slice between this heading and the next. Sufficient for
   section identity (anchor + heading path).
3. The indexer + backfill call `markdownToSectionBlocks(note.content)` →
   `extractSections(blocks)` and write the resulting `SectionInfo[]` to
   the `sections` table. The plan's anchor-equivalence guarantee
   ("backfill anchor === reindex anchor") still holds **trivially**:
   both code paths run the same `markdownToSectionBlocks` →
   `extractSections` → `computeAnchor` pipeline against the same
   `notes.content` bytes. The chunker is not in the backfill path at all.
4. `chunks.heading_path` is **not** read by the backfill. The plan
   description "groups chunks by heading_path" is replaced by "groups
   markdown by extracted heading_path arrays". Functionally equivalent;
   simpler to prove correct.
5. `chunk_id_first` / `chunk_id_last`: after sections are extracted from
   markdown, the indexer walks the just-inserted chunks (each has a
   `start_offset` / `end_offset` into the markdown) and bins them into
   sections by the heading region they fall under. The backfill does
   the same by reading existing chunk offsets.

This keeps the plan's acceptance criteria intact:
- Section rows materialize as a side-table of the markdown bytes (not
  the chunker output).
- Anchors are deterministic from `(heading_text, plain_text_body)` per
  H-7.
- Re-indexing the same note produces identical anchors.
- Backfill from a v1-shaped DB (notes + chunks present, sections absent)
  produces the same rows a fresh re-index would.

Reversible / contained / no plan re-design needed.

---

## Deviation D2 — migration 010 frontmatter shape

**What plan said.** `UPDATE notes SET status = json_extract(frontmatter, '$.status')`
will work because `notes.frontmatter` is stored as JSON text.

**What we found.** `src/indexer/indexer.ts:168`
(`frontmatter: parsed.frontmatter ? JSON.stringify(parsed.frontmatter) : null`)
confirms `notes.frontmatter` is stored as a JSON string. SQLite's
`json_extract` works directly on JSON text columns. **No deviation
needed for this part of the plan**, but logged here because the plan
flagged it as a possible deviation point. The static-SQL path is the
correct path.

(Empty placeholder kept for symmetry — no change.)
