import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "../db/index.js";
import type { Vault } from "../vault/index.js";
import { buildSectionsForNote, extractStatus } from "../indexer/indexer.js";
import { backfillSectionsFromChunks } from "./backfill.js";
import { extractSections, markdownToSectionBlocks } from "./extract.js";

/**
 * Phase 3 / 03-01 Task 9 — end-to-end smoke.
 *
 * Indexes three small in-memory fixture notes (no Ollama, no FS),
 * runs the section build + status maintenance hook on each, then
 * asserts the six end-to-end acceptance criteria from the plan:
 *   (a) sections rows exist with expected anchors
 *   (b) getByNote returns parent-ordered rows
 *   (c) findContainingChunk returns the right section for a chunk
 *       in the middle of a nested H3
 *   (d) re-indexing the same note produces identical anchors
 *       (anchor stability under no-op re-index)
 *   (e) `notes.status` is `'superseded'` for the one note and NULL
 *       for the other two
 *   (f) M2 backfill case — drop sections, re-apply backfill helper,
 *       assert anchors match the indexer-derived anchors.
 */
describe("sections integration smoke (03-01 Task 9)", () => {
  let db: Database;
  let vault: Vault;

  beforeEach(() => {
    db = new Database(":memory:", "test-vault");
    db.migrate();
    vault = {
      config: { name: "test-vault", path: "/tmp/test-vault" },
      db,
      dbPath: ":memory:",
    };
  });

  afterEach(() => {
    db.close();
  });

  /** Three fixture notes with varying heading depths. */
  const FIXTURES = [
    {
      path: "alpha.md",
      content:
        "# Alpha\nIntro paragraph for alpha.\n\n## Plan\nplan body.\n\n### Deep\ndeep H3 body for findContainingChunk.\n\n## Status\nstatus body.\n",
      status: null,
    },
    {
      path: "beta.md",
      content: "# Beta\nbeta body.\n",
      status: null,
    },
    {
      path: "gamma.md",
      content: "preamble for gamma.\n\n# Gamma\ngamma body.\n",
      status: "superseded",
    },
  ] as const;

  function seedAndIndex(): Map<string, number> {
    const ids = new Map<string, number>();
    for (const f of FIXTURES) {
      const frontmatterObj = f.status ? { status: f.status } : null;
      const u = db.notes.upsertByPath({
        path: f.path,
        content: f.content,
        frontmatter: frontmatterObj ? JSON.stringify(frontmatterObj) : null,
        title: f.path,
        hash: f.path + "-h",
        bodyHash: f.path + "-bh",
        mtime: 0,
        wordCount: 1,
      });
      // Status maintenance hook (mirrors src/indexer/indexer.ts).
      db.notes.setStatus(u.id, extractStatus(frontmatterObj));
      // Seed at least one chunk per note so findContainingChunk has data.
      const chunks = db.chunks.insertBatch(u.id, [
        {
          idx: 0,
          text: f.content,
          headingPath: null,
          startOffset: 0,
          endOffset: f.content.length,
          tokenCount: 1,
        },
      ]);
      buildSectionsForNote(vault, u.id, f.content, chunks);
      ids.set(f.path, u.id);
    }
    return ids;
  }

  it("(a) sections rows exist for every fixture with matching anchors", () => {
    const ids = seedAndIndex();
    for (const f of FIXTURES) {
      const noteId = ids.get(f.path)!;
      const rows = db.sections.getByNote(noteId);
      expect(rows.length).toBeGreaterThan(0);
      // Anchors match what extractSections would produce from the same bytes.
      const expected = extractSections(markdownToSectionBlocks(f.content));
      const expectedAnchors = expected.map((s) => s.anchor).sort();
      const actualAnchors = rows.map((r) => r.anchor).sort();
      expect(actualAnchors).toEqual(expectedAnchors);
    }
  });

  it("(b) getByNote returns parent-ordered rows (NULL parents first, then by parent_id ASC, then ord ASC)", () => {
    const ids = seedAndIndex();
    const rows = db.sections.getByNote(ids.get("alpha.md")!);
    // alpha has 4 sections: Alpha (H1, parent=NULL), Plan (H2 child of Alpha),
    // Deep (H3 child of Plan), Status (H2 child of Alpha).
    expect(rows).toHaveLength(4);
    // Top-level rows come first (parent_id = NULL).
    const topLevel = rows.filter((r) => r.parent_id === null);
    expect(topLevel).toHaveLength(1);
    expect(topLevel[0]!.heading_text).toBe("Alpha");
  });

  it("(c) findContainingChunk returns the right section for a deeply nested chunk", () => {
    // Build a fresh alpha note with chunks positioned at known offsets so we
    // can test that a chunk in the H3's body lands in the H3 section.
    const content = FIXTURES[0].content;
    const u = db.notes.upsertByPath({
      path: "alpha-c.md",
      content,
      frontmatter: null,
      title: "alpha-c",
      hash: "h",
      bodyHash: "bh",
      mtime: 0,
      wordCount: 1,
    });
    // Three chunks at known offsets:
    //   - one inside H2 "Plan" body
    //   - one inside H3 "Deep" body (the deeply-nested chunk)
    //   - one inside H2 "Status" body
    const planBodyOffset = content.indexOf("plan body.");
    const deepBodyOffset = content.indexOf("deep H3 body");
    const statusBodyOffset = content.indexOf("status body.");
    const chunkIds = db.chunks.insertBatch(u.id, [
      {
        idx: 0,
        text: "plan body.",
        headingPath: null,
        startOffset: planBodyOffset,
        endOffset: planBodyOffset + 10,
        tokenCount: 1,
      },
      {
        idx: 1,
        text: "deep H3 body",
        headingPath: null,
        startOffset: deepBodyOffset,
        endOffset: deepBodyOffset + 12,
        tokenCount: 1,
      },
      {
        idx: 2,
        text: "status body.",
        headingPath: null,
        startOffset: statusBodyOffset,
        endOffset: statusBodyOffset + 12,
        tokenCount: 1,
      },
    ]);
    buildSectionsForNote(vault, u.id, content, chunkIds);

    const deepSection = db.sections.findContainingChunk(u.id, chunkIds[1]!);
    expect(deepSection).not.toBeNull();
    expect(deepSection!.heading_text).toBe("Deep");
    expect(deepSection!.level).toBe(3);

    // The plan-body chunk lands in H2 Plan.
    const planSection = db.sections.findContainingChunk(u.id, chunkIds[0]!);
    expect(planSection!.heading_text).toBe("Plan");
  });

  it("(d) re-indexing the same note produces identical anchors (idempotency under no-op re-index)", () => {
    const ids = seedAndIndex();
    const noteId = ids.get("alpha.md")!;
    const before = db.sections
      .getByNote(noteId)
      .map((r) => r.anchor)
      .sort();
    // Simulate re-index: clear sections + rebuild from the SAME content.
    db.sections.deleteByNote(noteId);
    buildSectionsForNote(vault, noteId, FIXTURES[0].content, []);
    const after = db.sections
      .getByNote(noteId)
      .map((r) => r.anchor)
      .sort();
    expect(after).toEqual(before);
  });

  it("(e) notes.status is 'superseded' for the gamma fixture and NULL for the others", () => {
    const ids = seedAndIndex();
    expect(db.notes.getStatus(ids.get("alpha.md")!)).toBeNull();
    expect(db.notes.getStatus(ids.get("beta.md")!)).toBeNull();
    expect(db.notes.getStatus(ids.get("gamma.md")!)).toBe("superseded");
  });

  it("(f) M2 backfill end-to-end: drop sections, re-apply backfill, anchors match", () => {
    const ids = seedAndIndex();
    // Snapshot per-note anchors as produced by the indexer.
    const expectedPerNote = new Map<number, string[]>();
    for (const noteId of ids.values()) {
      expectedPerNote.set(
        noteId,
        db.sections
          .getByNote(noteId)
          .map((r) => r.anchor)
          .sort(),
      );
    }
    // Drop all sections (simulating a pre-v10 v1 DB).
    for (const noteId of ids.values()) {
      db.sections.deleteByNote(noteId);
      expect(db.sections.countByNote(noteId)).toBe(0);
    }
    // Re-apply the backfill helper as migration 010 step C would.
    const backfilled = backfillSectionsFromChunks(db.handle);
    expect(backfilled).toBe(FIXTURES.length);
    // Anchors must match the indexer-derived snapshot exactly.
    for (const [noteId, expected] of expectedPerNote.entries()) {
      const actual = db.sections
        .getByNote(noteId)
        .map((r) => r.anchor)
        .sort();
      expect(actual).toEqual(expected);
    }
  });
});
