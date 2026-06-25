import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "../db/database.js";
import { backfillSectionsFromChunks } from "./backfill.js";
import { extractSections, markdownToSectionBlocks } from "./extract.js";

/**
 * Co-located tests for `backfillSectionsFromChunks` per plan 03-01
 * Task 6 (M2 fix).
 *
 * Three required cases:
 *   1. v1-shaped DB (notes + chunks rows present, sections empty
 *      because we manually wipe them) → backfill populates sections
 *      with the expected anchors.
 *   2. Anchor-equivalence — anchors produced by the backfill must
 *      equal anchors produced by a fresh `extractSections` re-parse
 *      of the same note content.
 *   3. Idempotent — running backfill twice produces the same row
 *      contents (or the second run is a no-op when sections already
 *      exist).
 */
describe("backfillSectionsFromChunks", () => {
  let db: Database;

  beforeEach(() => {
    // db.migrate() in the constructor already runs migration 010 →
    // which calls backfillSectionsFromChunks(handle) once. For a
    // fresh :memory: DB the notes table is empty, so the call is a
    // no-op. Tests below then seed notes and re-invoke the helper.
    db = new Database(":memory:", "test-vault");
    db.migrate();
  });

  afterEach(() => {
    db.close();
  });

  function seedNote(path: string, content: string): number {
    return db.notes.upsertByPath({
      path,
      content,
      frontmatter: null,
      title: path,
      hash: path + "-hash",
      bodyHash: path + "-body",
      mtime: 0,
      wordCount: content.split(/\s+/).length,
    }).id;
  }

  it("(1) v1-shaped DB → backfill populates sections with expected anchors", () => {
    const content = "# Top\n\nIntro body.\n\n## Sub\n\nsub body.\n";
    const nid = seedNote("a.md", content);

    // Sanity: a freshly-inserted note has no sections yet.
    expect(db.sections.countByNote(nid)).toBe(0);

    const n = backfillSectionsFromChunks(db.handle);
    expect(n).toBe(1);

    const rows = db.sections.getByNote(nid);
    expect(rows).toHaveLength(2);
    // First row is the H1 (parent_id = NULL).
    expect(rows[0]!.heading_text).toBe("Top");
    expect(rows[0]!.parent_id).toBeNull();
    expect(rows[0]!.level).toBe(1);
    // Second row is the H2 child of "Top".
    expect(rows[1]!.heading_text).toBe("Sub");
    expect(rows[1]!.parent_id).toBe(rows[0]!.id);
    expect(rows[1]!.level).toBe(2);
    // Heading-path JSON is materialized correctly.
    expect(JSON.parse(rows[0]!.heading_path)).toEqual(["Top"]);
    expect(JSON.parse(rows[1]!.heading_path)).toEqual(["Top", "Sub"]);
  });

  it("(2) anchor-equivalence — backfill anchors === extractSections anchors", () => {
    const content = "preamble.\n\n# H1\nbody1.\n\n## H2\nbody2.\n\n# H1b\nbody3.\n";
    const nid = seedNote("a.md", content);

    backfillSectionsFromChunks(db.handle);

    const backfillRows = db.sections.getByNote(nid);
    const expectedSections = extractSections(markdownToSectionBlocks(content));

    // Pair backfill rows to extractor outputs by `anchor`. The order
    // differs (DB returns parent_id ordering; extractor returns
    // document order), but anchors are content-hashes — the SET of
    // anchors MUST match exactly.
    const backfillAnchors = backfillRows.map((r) => r.anchor).sort();
    const expectedAnchors = expectedSections.map((s) => s.anchor).sort();
    expect(backfillAnchors).toEqual(expectedAnchors);
    expect(backfillAnchors).toHaveLength(4); // preamble + H1 + H2 + H1b
  });

  it("(3) idempotent — running backfill twice leaves rows unchanged", () => {
    const content = "# Only\n\nbody only.\n";
    const nid = seedNote("a.md", content);

    backfillSectionsFromChunks(db.handle);
    const firstRows = db.sections.getByNote(nid);
    expect(firstRows).toHaveLength(1);
    const firstIds = firstRows.map((r) => r.id);

    // Second run — must be a no-op because sections already exist for
    // this note (the helper's per-note short-circuit).
    const secondCount = backfillSectionsFromChunks(db.handle);
    expect(secondCount).toBe(0);

    const secondRows = db.sections.getByNote(nid);
    expect(secondRows.map((r) => r.id)).toEqual(firstIds);
    expect(secondRows[0]!.anchor).toBe(firstRows[0]!.anchor);
  });

  it("skips notes with empty content (no rows materialized)", () => {
    seedNote("empty.md", "");
    const before = backfillSectionsFromChunks(db.handle);
    expect(before).toBe(0);
  });

  it("(regression: ISSUE-migration-010-duplicate-anchor) duplicate-anchor siblings do NOT crash the migration", () => {
    // Anchors are content-addressed: sha256(heading_text + "\n" + body).
    // The simplest real-world trigger is heading-only sections — two
    // sibling headings with no body between them have identical
    // (heading_text, body="") inputs and therefore identical anchors.
    // Common in v1 vaults: template scaffolds with repeated placeholder
    // headings like "## TODO\n## TODO\n", outline-only notes still
    // waiting for body content, auto-generated note skeletons.
    //
    // Before the INSERT-OR-IGNORE fix, the second sibling's insert
    // raised SqliteError: UNIQUE constraint failed and aborted migration
    // 010 for the whole DB, locking every CLI command out for every
    // configured vault (see ISSUE-migration-010-duplicate-anchor.md).
    const content = "# Project\n\n## TODO\n\n## TODO\n\n## TODO\n";
    const nid = seedNote("dup.md", content);

    // Sanity: heading-only siblings really do produce duplicate anchors.
    // If this assert ever fails (e.g. extractSections grew anchor
    // de-duplication via slug-suffixing), the regression test becomes a
    // moot positive — leave it in place; the underlying bug is fixed
    // upstream.
    const blocks = markdownToSectionBlocks(content);
    const sections = extractSections(blocks);
    const todoAnchors = sections.filter((s) => s.heading_text === "TODO").map((s) => s.anchor);
    expect(todoAnchors).toHaveLength(3);
    expect(new Set(todoAnchors).size).toBe(1); // all three collapse to one anchor

    // The migration must NOT throw.
    expect(() => backfillSectionsFromChunks(db.handle)).not.toThrow();

    const rows = db.sections.getByNote(nid);
    // 4 sections were derived (H1 Project + 3× H2 TODO), but
    // UNIQUE(note_id, anchor) collapses the three TODOs into 1.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.heading_text)).toEqual(["Project", "TODO"]);
    // The surviving TODO row keeps its parent_id pointing at "Project".
    expect(rows[1]!.parent_id).toBe(rows[0]!.id);
  });

  it("(regression) duplicate-anchor in a deeper subtree still resolves later siblings' parent_id", () => {
    // Stress the parent-linkage code path: after a duplicate-anchor
    // collision the insertedIds slot must point at the surviving row's
    // id so any later child node can still resolve its parent_id. If
    // the slot were left as null/undefined, the next child's parent_id
    // would be NULL instead of the surviving row's id, silently
    // breaking the section tree even when the migration itself succeeded.
    //
    // Layout: two heading-only "## Notes" siblings (collision) followed
    // by a child "### Detail" with body. Detail's parent_index in
    // sectionInfos points at the LAST "Notes" entry — which after the
    // collision must resolve to the same surviving row id, not to
    // garbage.
    const content = "# Doc\n\n## Notes\n\n## Notes\n\n### Detail\n\ndeep.\n";
    const nid = seedNote("deep.md", content);

    expect(() => backfillSectionsFromChunks(db.handle)).not.toThrow();

    const rows = db.sections.getByNote(nid);
    // H1 Doc + 1 surviving Notes + H3 Detail = 3 sections
    expect(rows).toHaveLength(3);
    const doc = rows.find((r) => r.heading_text === "Doc")!;
    const notes = rows.find((r) => r.heading_text === "Notes")!;
    const detail = rows.find((r) => r.heading_text === "Detail")!;
    expect(doc.parent_id).toBeNull();
    expect(notes.parent_id).toBe(doc.id);
    // Critical: Detail's parent must resolve to the SURVIVING Notes row,
    // not NULL or a stale rowid. Pre-fix, the collapsed slot would have
    // contained whatever info.lastInsertRowid returned for an aborted
    // insert — poisoning the parent_id linkage.
    expect(detail.parent_id).toBe(notes.id);
  });

  it("preserves chunk_id_first/last when chunks exist for the note", () => {
    const content = "# H\n\nbody.\n";
    const nid = seedNote("a.md", content);
    // Seed chunks that mimic what the v1 chunker would produce.
    // Their start_offset values must fall inside the section's range
    // for the binning to work.
    const chunkIds = db.chunks.insertBatch(nid, [
      {
        idx: 0,
        text: "body.",
        headingPath: "# H",
        startOffset: 6, // inside the H1 section's range
        endOffset: 11,
        tokenCount: 1,
      },
    ]);

    backfillSectionsFromChunks(db.handle);
    const rows = db.sections.getByNote(nid);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.chunk_id_first).toBe(chunkIds[0]!);
    expect(rows[0]!.chunk_id_last).toBe(chunkIds[0]!);
  });
});
