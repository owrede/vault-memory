/**
 * Phase 3 — one-time section backfill (M2 fix in plan 03-01).
 *
 * Wired into migration 010 (`src/db/schema.ts:runMigration010`) so an
 * existing v1 user vault gets `sections` rows populated immediately on
 * upgrade — WITHOUT requiring a content edit / catchup pass.
 *
 * Approach (per 03-01-DEVIATIONS.md §D1): re-derive sections from each
 * note's `content` column via `markdownToSectionBlocks` →
 * `extractSections`, NOT from `chunks.heading_path` (which only carries
 * the immediate-predecessor heading as a markdown string, insufficient
 * to reconstruct a full section tree). This keeps the
 * anchor-equivalence guarantee trivially: backfill and a fresh re-index
 * run the SAME pipeline against the SAME `notes.content` bytes.
 *
 * Pure of fs / gray-matter / chokidar / path imports. Reads + writes
 * only via the supplied `BetterSqlite3.Database` handle.
 */

import type BetterSqlite3 from "better-sqlite3";
import type { BlockNode, ChunkRow, InsertSectionRow, SectionInfo } from "../types.js";
import { extractSections, markdownToSectionBlocks } from "./extract.js";

/**
 * Walk every note in the DB and ensure it has a corresponding set of
 * `sections` rows. Idempotent: if a note already has sections, skip
 * it. Returns the number of notes for which sections were newly
 * populated (for migration log / test assertions).
 *
 * Called from migration 010 inside the migration transaction; safe to
 * call again from tests against an in-memory DB.
 */
export function backfillSectionsFromChunks(db: BetterSqlite3.Database): number {
  // Inline these queries (rather than going through SectionsQueries /
  // NotesQueries / ChunksQueries) so the migration runner doesn't
  // depend on the high-level query namespaces. The schema is
  // guaranteed to exist at this point (migration 010 step A ran first).
  const notesRows = db
    .prepare<[], { id: number; content: string }>("SELECT id, content FROM notes")
    .all();

  const existingCount = db.prepare<[number], { c: number }>(
    "SELECT COUNT(*) AS c FROM sections WHERE note_id = ?",
  );
  const getChunks = db.prepare<[number], ChunkRow>(
    "SELECT * FROM chunks WHERE note_id = ? ORDER BY id ASC",
  );
  // INSERT OR IGNORE: real-world v1 vaults contain notes with sibling sections
  // that GitHub-slugify to the same anchor (e.g. two H2s both titled "Notes").
  // The sections table has UNIQUE(note_id, anchor); a plain INSERT collides on
  // the second sibling, the migration transaction rolls back, every CLI command
  // crashes (see ISSUE-migration-010-duplicate-anchor.md). `OR IGNORE` is the
  // minimal safe response — first sibling wins the unique slot, later siblings
  // collapse into that row for parent-linkage purposes via lookupExistingSection.
  // Proper anchor de-duplication (notes-1, notes-2 …) is the better fix; that's
  // tracked separately and requires changes to extractSections + chunk linkage.
  const insertSection = db.prepare(`
    INSERT OR IGNORE INTO sections
      (note_id, anchor, heading_path, heading_text, level,
       parent_id, ord, chunk_id_first, chunk_id_last, created_at)
    VALUES
      (@note_id, @anchor, @heading_path, @heading_text, @level,
       @parent_id, @ord, @chunk_id_first, @chunk_id_last, @created_at)
  `);

  const lookupExistingSection = db.prepare<[number, string], { id: number }>(
    "SELECT id FROM sections WHERE note_id = ? AND anchor = ?",
  );

  let backfilled = 0;
  const now = Date.now();

  for (const note of notesRows) {
    // Skip notes that already have sections (idempotency / safety).
    const existing = existingCount.get(note.id);
    if (existing && existing.c > 0) continue;

    if (!note.content || note.content.length === 0) {
      // Empty notes get no sections — keep storage tight.
      continue;
    }

    const blocks: BlockNode[] = markdownToSectionBlocks(note.content);
    const sectionInfos: SectionInfo[] = extractSections(blocks);
    if (sectionInfos.length === 0) continue;

    // Walk this note's chunks once and bin them into the section list
    // by `start_offset`. Sections own a [chunk_id_first, chunk_id_last]
    // range; we compute it by mapping each chunk's start offset to its
    // owning heading region.
    const chunks = getChunks.all(note.id);
    const chunkRanges = computeChunkRangesForSections(note.content, sectionInfos, chunks);

    // Insert in two passes so parent_id can reference the newly-minted
    // section IDs. Per-index → ID map populated as we go. Slots for
    // duplicate-anchor siblings reuse the surviving row's id so any
    // subsequent child still resolves its parent_id correctly.
    const insertedIds: Array<number | null> = [];
    for (let i = 0; i < sectionInfos.length; i++) {
      const s = sectionInfos[i]!;
      const parentId = s.parent_index === null ? null : (insertedIds[s.parent_index] ?? null);
      const range = chunkRanges[i] ?? { first: null, last: null };
      const row: InsertSectionRow & { created_at: number } = {
        note_id: note.id,
        anchor: s.anchor,
        heading_path: JSON.stringify(s.heading_path),
        heading_text: s.heading_text,
        level: s.level,
        parent_id: parentId,
        ord: s.ord,
        chunk_id_first: range.first,
        chunk_id_last: range.last,
        created_at: now,
      };
      const info = insertSection.run(row);
      if (info.changes > 0) {
        // Row inserted normally.
        insertedIds.push(Number(info.lastInsertRowid));
      } else {
        // Collision on UNIQUE(note_id, anchor). A sibling with the same
        // GitHub-slugified anchor already won the slot. Look up the
        // surviving row's id so any later child still has a parent_id to
        // resolve against. The chunk range on the surviving row reflects
        // the first sibling's content; chunks belonging to this dropped
        // sibling will read under the surviving anchor until a fresh
        // re-index. That's acceptable for a one-time migration backfill.
        const existing = lookupExistingSection.get(note.id, s.anchor);
        insertedIds.push(existing ? Number(existing.id) : null);
      }
    }
    backfilled++;
  }

  return backfilled;
}

/**
 * Map each section to its [chunk_id_first, chunk_id_last] range.
 *
 * Algorithm: re-derive each section's character offset window in the
 * source `content` by re-running `extractHeadingsLite` on the same
 * bytes, then place each chunk into the section whose offset window
 * contains the chunk's `start_offset`.
 *
 * Sections with no chunks (e.g. a heading followed by another heading
 * with no body) get `{ first: null, last: null }`. The chunker drops
 * heading-only spans, so this is the common case for documents with
 * empty subsections.
 */
function computeChunkRangesForSections(
  content: string,
  sections: SectionInfo[],
  chunks: ChunkRow[],
): Array<{ first: number | null; last: number | null }> {
  // We need each section's character range in the source bytes. The
  // simplest correct construction: re-walk the same heading list the
  // lifter uses, and produce a (sectionIndex → [start, end]) map.
  //
  // We import the SAME heading extractor used by markdownToSectionBlocks
  // to guarantee identical offset semantics. (No fs/gray-matter — pure.)
  // To avoid a circular import we lazy-require here via the named
  // export.
  const ranges = computeSectionOffsetRanges(content, sections);
  const out: Array<{ first: number | null; last: number | null }> = sections.map(() => ({
    first: null,
    last: null,
  }));

  for (const chunk of chunks) {
    const offset = chunk.start_offset;
    // Find the section whose [start, end) range contains this offset.
    // Walk in reverse so the innermost (latest, deepest) section wins.
    let chosenIdx: number | null = null;
    for (let i = ranges.length - 1; i >= 0; i--) {
      const r = ranges[i];
      if (!r) continue;
      if (offset >= r.start && offset < r.end) {
        chosenIdx = i;
        break;
      }
    }
    if (chosenIdx === null) continue;
    const slot = out[chosenIdx]!;
    if (slot.first === null || chunk.id < slot.first) slot.first = chunk.id;
    if (slot.last === null || chunk.id > slot.last) slot.last = chunk.id;
  }

  return out;
}

/**
 * Compute the [start, end) byte range for each section in `content`,
 * matching the slicing semantics of `markdownToSectionBlocks`.
 *
 * - Preamble (level 0) range is [0, firstHeading.startOffset).
 * - Each heading section range is [heading.startOffset, nextSibling.startOffset)
 *   where nextSibling is the next heading at an equal-or-shallower level
 *   (or content.length if none).
 *
 * `sections` is provided so the function can assign ranges in a way that
 * matches the section walker's output order (preamble first if present,
 * then headings in source order).
 *
 * The implementation re-extracts headings from `content` directly so it
 * doesn't depend on the section walker's internal state. This means
 * `extractHeadings` from src/chunker/headings.ts is the canonical
 * heading source — both for the lifter AND for this offset map.
 */
function computeSectionOffsetRanges(
  content: string,
  sections: SectionInfo[],
): Array<{ start: number; end: number }> {
  // Local import — avoids a circular path through schema.ts.
  // (sections/backfill.ts → chunker/headings.ts is a clean dependency.)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  // Inline import to keep this helper self-contained; not type-imported
  // because we need the runtime call. ESM `import` at module scope is
  // the correct form below.
  const headings = headingExtractor(content);

  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0; // walks the sections array

  // Preamble (if present) is sections[0] with level 0.
  const hasPreamble =
    sections.length > 0 && sections[0]!.level === 0 && sections[0]!.heading_text === "";
  const firstHeadingOffset = headings.length === 0 ? content.length : headings[0]!.startOffset;
  if (hasPreamble) {
    ranges.push({ start: 0, end: firstHeadingOffset });
    cursor = 1;
  }

  // For every heading section, find the next equal-or-shallower
  // heading in the source — that's the section's end offset.
  for (let h = 0; h < headings.length; h++) {
    const h0 = headings[h]!;
    let endOffset = content.length;
    for (let j = h + 1; j < headings.length; j++) {
      if (headings[j]!.level <= h0.level) {
        endOffset = headings[j]!.startOffset;
        break;
      }
    }
    ranges.push({ start: h0.startOffset, end: endOffset });
    cursor++;
  }

  // Defensive: if there's a length mismatch (shouldn't happen for valid
  // input), fall back to whole-document ranges for any tail entries.
  while (ranges.length < sections.length) {
    ranges.push({ start: 0, end: content.length });
  }
  return ranges;
}

// Lazy heading-extractor binding to keep `backfill.ts` free of static
// type-side imports of the chunker module beyond what's needed for the
// section walker. Kept as a function-import indirection so the type is
// inferred from the call site and module-scope import-cycles stay
// simple.
import { extractHeadings as headingExtractor } from "../chunker/headings.js";
