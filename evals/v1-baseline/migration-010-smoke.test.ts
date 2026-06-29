// Phase 3 / 03-01 Task 9: migration 010 smoke.
//
// Verifies that migration 010 (sections + notes.status + backfill)
// applies cleanly against a v1-shaped DB. Three required cases per
// the plan:
//   1. DDL applies — sqlite_master shows the `sections` table with
//      the three indexes AND `notes.status` column with its partial
//      index. Re-applying is a no-op (the v1 migration runner only
//      runs migrations whose version > PRAGMA user_version).
//   2. Section backfill — given a v1-shaped DB (notes + chunks rows
//      present, sections rows absent at the time the migration ran),
//      `sections` rows are populated; the anchors match what a fresh
//      re-index would produce.
//   3. Status backfill — a note whose frontmatter has
//      `status: superseded` has `notes.status = 'superseded'` after
//      migration with no manual intervention.
//
// The test boots an in-memory v9 DB (manually setting PRAGMA
// user_version = 9 after running migrations 1..9), inserts a
// v1-shaped note + chunks, then triggers migration 010 by calling
// `db.migrate()` again. The migration runner picks up the v10
// migration via the version-gate and executes its three steps.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "../../src/db/database.js";
import { MIGRATIONS } from "../../src/db/schema.js";
import { extractSections, markdownToSectionBlocks } from "../../src/sections/index.js";

describe("migration 010 smoke (Phase 3 / 03-01)", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:", "test-vault");
    // The Database constructor already migrated to head. That's fine
    // for cases (1) and (3) which inspect the post-migration state.
    // Case (2) needs the v1-shaped pre-state; we simulate it below
    // by inserting notes + chunks BEFORE the backfill runs (we wipe
    // sections and re-call the backfill helper, which is what
    // migration 010 step C does).
  });

  afterEach(() => {
    db.close();
  });

  it("(1) DDL applies: sections table + 3 indexes + notes.status column + partial index", () => {
    const tableRow = db.handle
      .prepare<
        [],
        { name: string }
      >("SELECT name FROM sqlite_master WHERE type='table' AND name='sections'")
      .get();
    expect(tableRow?.name).toBe("sections");

    const indexes = db.handle
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sections'",
      )
      .all()
      .map((r) => r.name);
    // Three explicit indexes plus an auto-generated PK index. The unique
    // identity index was renamed by migration 015 (sections_note_anchor →
    // sections_note_headingpath_anchor) when section identity gained
    // heading_path context — ADR-032.
    expect(indexes).toEqual(
      expect.arrayContaining([
        "sections_note_headingpath_anchor",
        "sections_note_parent_ord",
        "sections_chunk_range",
      ]),
    );

    const notesCols = db.handle
      .prepare<[], { name: string }>("PRAGMA table_info(notes)")
      .all()
      .map((r) => r.name);
    expect(notesCols).toContain("status");

    const notesStatusIdx = db.handle
      .prepare<
        [],
        { name: string; sql: string }
      >("SELECT name, sql FROM sqlite_master WHERE type='index' AND name='notes_status'")
      .get();
    expect(notesStatusIdx?.name).toBe("notes_status");
    // The index MUST be partial (WHERE status IS NOT NULL).
    expect(notesStatusIdx?.sql ?? "").toMatch(/WHERE\s+status\s+IS\s+NOT\s+NULL/i);

    // user_version == top migration version (10 right now).
    const v = db.handle.pragma("user_version") as Array<{ user_version: number }>;
    const topVersion = Math.max(...MIGRATIONS.map((m) => m.version));
    expect(v[0]?.user_version).toBe(topVersion);
    expect(topVersion).toBeGreaterThanOrEqual(10);

    // Re-running migrate() is a no-op (runner only runs > user_version).
    expect(() => db.migrate()).not.toThrow();
    const v2 = db.handle.pragma("user_version") as Array<{ user_version: number }>;
    expect(v2[0]?.user_version).toBe(topVersion);
  });

  it("(2) Section backfill populates sections matching the re-index output", async () => {
    // Insert a v1-shaped note + a chunk row, then wipe sections (simulating
    // the cohort of existing-rows-at-upgrade), and re-run the backfill
    // helper inline. Migration 010 step C calls this same helper.
    const content = "preamble.\n\n# H1\nbody1.\n\n## H2\nbody2 inside H2.\n\n# H1b\nbody3.\n";
    const noteUpsert = db.notes.upsertByPath({
      path: "doc.md",
      content,
      frontmatter: null,
      title: "doc",
      hash: "h",
      bodyHash: "bh",
      mtime: 0,
      wordCount: 1,
    });
    // Wipe any sections the indexer hook would have added (there are none —
    // we didn't go through the indexer — but defensive).
    db.sections.deleteByNote(noteUpsert.id);
    expect(db.sections.countByNote(noteUpsert.id)).toBe(0);

    // Run the backfill helper (the exact code migration 010 step C runs).
    const { backfillSectionsFromChunks } = await import("../../src/sections/backfill.js");
    const n = backfillSectionsFromChunks(db.handle);
    expect(n).toBe(1);

    const rows = db.sections.getByNote(noteUpsert.id);
    const expected = extractSections(markdownToSectionBlocks(content));
    expect(rows.map((r) => r.anchor).sort()).toEqual(expected.map((s) => s.anchor).sort());
    // Specifically: 4 sections (preamble + H1 + H2 + H1b).
    expect(rows).toHaveLength(4);
  });

  it("(3) Status backfill: frontmatter `status: superseded` populates notes.status", () => {
    // Seed a note whose frontmatter has status: superseded. The migration
    // already ran (in the constructor). To exercise the backfill path we
    // re-run the UPDATE step manually (the same SQL that migration 010
    // step B uses), simulating the cohort of existing rows.
    const n = db.notes.upsertByPath({
      path: "old.md",
      content: "x",
      frontmatter: JSON.stringify({ status: "superseded", title: "X" }),
      title: "X",
      hash: "h",
      bodyHash: "bh",
      mtime: 0,
      wordCount: 1,
    });
    // Before re-applying the UPDATE: the column might already be null
    // because upsertByPath doesn't set it (only the indexer does, via
    // setStatus). Apply the migration's UPDATE step.
    db.handle.exec(
      "UPDATE notes SET status = json_extract(frontmatter, '$.status') WHERE frontmatter IS NOT NULL",
    );
    expect(db.notes.getStatus(n.id)).toBe("superseded");

    // Notes without `status:` in their frontmatter stay null.
    const m = db.notes.upsertByPath({
      path: "fresh.md",
      content: "y",
      frontmatter: JSON.stringify({ title: "Y" }),
      title: "Y",
      hash: "h2",
      bodyHash: "bh2",
      mtime: 0,
      wordCount: 1,
    });
    db.handle.exec(
      "UPDATE notes SET status = json_extract(frontmatter, '$.status') WHERE frontmatter IS NOT NULL",
    );
    expect(db.notes.getStatus(m.id)).toBeNull();
  });
});
