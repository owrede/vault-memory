/**
 * EdgesQueries + migration 011 unit tests
 *
 * Phase 4 / 04-01 / GRA-04 (D-01, D-04). Covers:
 *   - Migration 011 DDL (columns, CHECK, UNIQUE, indexes)
 *   - Chunked backfill from `wikilinks` (Pattern 1 from RESEARCH.md)
 *   - Idempotency (re-runs, INSERT OR IGNORE)
 *   - Zero-row short-circuit (mirrors runMigration008)
 *   - EdgesQueries surface (insertBatch / deleteByNote / getBacklinks /
 *     getForwardLinks / resolveBrokenLinks)
 *   - FK ON DELETE CASCADE on source_doc
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { Database } from "../database.js";

interface SeededNoteIds {
  a: number;
  b: number;
  c: number;
}

function seedNotes(db: Database): SeededNoteIds {
  const mk = (path: string, title: string, hash: string): number =>
    db.notes.upsertByPath({
      path,
      content: `# ${title}`,
      frontmatter: null,
      title,
      hash,
      mtime: 1000,
      wordCount: 1,
    }).id;
  return {
    a: mk("a.md", "A", "ha"),
    b: mk("b.md", "B", "hb"),
    c: mk("c.md", "C", "hc"),
  };
}

describe("EdgesQueries / migration 011", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:", "test-vault");
    db.migrate();
  });

  afterEach(() => {
    db.close();
  });

  // ── DDL ────────────────────────────────────────────────────────────

  describe("migration 011 DDL", () => {
    it("creates the edges table with the expected columns", () => {
      const cols = db.handle.prepare("PRAGMA table_info(edges)").all() as Array<{
        name: string;
        notnull: number;
      }>;
      const colNames = cols.map((c) => c.name).sort();
      expect(colNames).toEqual(
        [
          "anchor",
          "id",
          "line_number",
          "link_text",
          "rel",
          "source_doc",
          "target_doc",
          "target_path",
          "type",
        ].sort(),
      );
      // source_doc and type are NOT NULL; target_doc / target_path are nullable.
      const byName = new Map(cols.map((c) => [c.name, c]));
      expect(byName.get("source_doc")?.notnull).toBe(1);
      expect(byName.get("type")?.notnull).toBe(1);
      expect(byName.get("target_doc")?.notnull).toBe(0);
      expect(byName.get("target_path")?.notnull).toBe(0);
    });

    it("creates the three expected indexes", () => {
      const indexes = db.handle.prepare("PRAGMA index_list(edges)").all() as Array<{
        name: string;
        unique: number;
      }>;
      const names = indexes.map((i) => i.name);
      // Indexes the migration declares explicitly.
      expect(names).toContain("idx_edges_source");
      expect(names).toContain("idx_edges_target");
      expect(names).toContain("idx_edges_type");
      // SQLite also auto-creates an index for the UNIQUE constraint; we
      // assert at least one of the indexes is unique (the auto one).
      expect(indexes.some((i) => i.unique === 1)).toBe(true);
    });

    it("enforces the CHECK constraint on type", () => {
      const { a, b } = seedNotes(db);
      // Insert a row with an invalid type — should throw.
      expect(() =>
        db.handle
          .prepare(
            `INSERT INTO edges (source_doc, target_doc, target_path, type)
             VALUES (?, ?, NULL, 'not-an-edge-type')`,
          )
          .run(a, b),
      ).toThrow();
      // Each of the four valid types is accepted.
      for (const t of ["wikilink", "mention", "frontmatter-ref", "hyperlink"]) {
        db.handle
          .prepare(
            `INSERT INTO edges (source_doc, target_doc, target_path, type, anchor)
             VALUES (?, ?, NULL, ?, ?)`,
          )
          .run(a, b, t, `anchor-${t}`);
      }
    });

    it("enforces UNIQUE on the widened key (exact duplicate still rejected)", () => {
      // Widened key (migration 012, CR-01) includes target_path/rel/
      // line_number — but two rows whose ALL disambiguator columns match
      // (all-NULL in this test) MUST still collide.
      const { a, b } = seedNotes(db);
      db.handle
        .prepare(
          `INSERT INTO edges (source_doc, target_doc, target_path, type, anchor)
           VALUES (?, ?, NULL, 'wikilink', NULL)`,
        )
        .run(a, b);
      // Direct INSERT (not OR IGNORE) of an exact duplicate must throw.
      expect(() =>
        db.handle
          .prepare(
            `INSERT INTO edges (source_doc, target_doc, target_path, type, anchor)
             VALUES (?, ?, NULL, 'wikilink', NULL)`,
          )
          .run(a, b),
      ).toThrow();
    });

    it("registers user_version >= 11 after migrate()", () => {
      expect(db.getSchemaVersion()).toBeGreaterThanOrEqual(11);
    });
  });

  // ── Backfill from wikilinks ───────────────────────────────────────

  describe("migration 011 backfill", () => {
    it("short-circuits when wikilinks is empty (fresh DB)", () => {
      // Fresh DB → migrate already ran in beforeEach → edges should be empty.
      const count = db.handle
        .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM edges")
        .get()?.c;
      expect(count).toBe(0);
    });

    it("backfills 25,000 wikilink rows into edges in < 1s with all type='wikilink'", () => {
      // Build a fresh DB that's BEFORE migration 011, seed 25k wikilinks,
      // then re-run migrate() to apply migration 011 and assert the result.
      // We construct an isolated DB via the migrate-rewind trick: open a
      // fresh DB, rewind user_version, seed wikilinks into the wikilinks
      // table directly (bypassing edges), then re-run migrate().
      const fresh = new Database(":memory:", "rewind-vault");
      // notes + wikilinks rows for the backfill source.
      const N = 25_000;
      // Two notes to anchor all the edges.
      const src = fresh.notes.upsertByPath({
        path: "src.md",
        content: "src",
        frontmatter: null,
        title: "Src",
        hash: "h-src",
        mtime: 1,
        wordCount: 1,
      }).id;
      const tgt = fresh.notes.upsertByPath({
        path: "tgt.md",
        content: "tgt",
        frontmatter: null,
        title: "Tgt",
        hash: "h-tgt",
        mtime: 1,
        wordCount: 1,
      }).id;
      // Insert 25k wikilink rows DIRECTLY (bypassing wikilinks.insertBatch
      // which would dedupe via UNIQUE constraint — we vary `anchor` to make
      // each row unique under UNIQUE(source_note, target_path, anchor)).
      const stmt = fresh.handle.prepare(
        `INSERT INTO wikilinks (source_note, target_path, target_note, link_text, anchor, line_number)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const insertAll = fresh.handle.transaction(() => {
        for (let i = 0; i < N; i++) {
          stmt.run(src, "tgt.md", tgt, "Tgt", `a-${i}`, i + 1);
        }
      });
      insertAll();
      // Clear edges (in case migration already populated some on
      // construction — should be 0 since wikilinks were empty pre-seed,
      // but defense in depth) and rewind user_version to 10 so migrate()
      // re-runs migration 011 over the seeded wikilinks.
      fresh.handle.exec("DELETE FROM edges");
      fresh.handle.pragma("user_version = 10");

      const start = Date.now();
      fresh.migrate();
      const elapsed = Date.now() - start;

      const total = fresh.handle
        .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM edges")
        .get()?.c;
      expect(total).toBe(N);
      const wikilinkOnly = fresh.handle
        .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM edges WHERE type = 'wikilink'")
        .get()?.c;
      expect(wikilinkOnly).toBe(N);

      // Performance budget per RESEARCH §Pattern 1: 25k rows must
      // complete well under 1 second on :memory:. Generous CI ceiling.
      expect(elapsed).toBeLessThan(1000);
      fresh.close();
    });

    it("is idempotent — re-running migration 011 does not duplicate rows", () => {
      const { a, b } = seedNotes(db);
      // Seed wikilinks via the normal path.
      db.wikilinks.insertBatch(a, [
        {
          targetPath: "b.md",
          targetNoteId: b,
          linkText: "B",
          anchor: null,
          lineNumber: 1,
        },
      ]);

      // Rewind user_version and re-migrate (which now finds existing
      // backfilled rows + wikilinks pending — must not duplicate).
      db.handle.exec("DELETE FROM edges");
      db.handle.pragma("user_version = 10");
      db.migrate();
      const after1 = db.handle
        .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM edges")
        .get()?.c;
      expect(after1).toBe(1);

      // Re-rewind and re-migrate again — should still be exactly 1 row
      // (INSERT OR IGNORE + UNIQUE makes the second run a no-op).
      db.handle.pragma("user_version = 10");
      db.migrate();
      const after2 = db.handle
        .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM edges")
        .get()?.c;
      expect(after2).toBe(1);
    });

    // ── CR-01 / migration 012: widened idx_edges_unique ───────────────
    //
    // The narrow key originally shipped by migration 011 silently dropped
    // legitimate non-duplicate rows. Migration 012 widens the key to
    // include target_path, rel, and line_number (with COALESCE defaults
    // for nulls). These regression tests pin the four scenarios that
    // motivated the widening:
    //
    //   (a) two broken wikilinks from the same source to different
    //       targets coexist
    //   (b) two frontmatter-ref edges to the same target with different
    //       `rel` values coexist
    //   (c) two `mention` edges to the same target on different lines
    //       coexist
    //   (d) two hyperlinks from the same source with different URLs
    //       coexist
    //
    // Each test asserts the row COUNT after INSERT OR IGNORE; a count of
    // 2 means the widened key correctly distinguishes the rows. Under
    // the old narrow key the count would have been 1 (silent drop).

    it("CR-01: two broken wikilinks from same source to different targets coexist", () => {
      const { a } = seedNotes(db);
      db.edges.insertBatch(a, [
        {
          targetNoteId: null,
          targetPath: "ghost1.md",
          type: "wikilink",
          rel: null,
          anchor: null,
          lineNumber: 1,
          linkText: null,
        },
        {
          targetNoteId: null,
          targetPath: "ghost2.md",
          type: "wikilink",
          rel: null,
          anchor: null,
          lineNumber: 2,
          linkText: null,
        },
      ]);
      const broken = db.edges.resolveBrokenLinks();
      expect(broken).toHaveLength(2);
      const targets = broken.map((b) => b.targetPath).sort();
      expect(targets).toEqual(["ghost1.md", "ghost2.md"]);
    });

    it("CR-01: two frontmatter-ref edges to same target with different `rel` coexist", () => {
      const { a, b } = seedNotes(db);
      db.edges.insertBatch(a, [
        {
          targetNoteId: b,
          targetPath: "b.md",
          type: "frontmatter-ref",
          rel: "owner",
          anchor: null,
          lineNumber: null,
          linkText: null,
        },
        {
          targetNoteId: b,
          targetPath: "b.md",
          type: "frontmatter-ref",
          rel: "assignee",
          anchor: null,
          lineNumber: null,
          linkText: null,
        },
      ]);
      const rows = db.handle
        .prepare<
          [],
          { rel: string | null }
        >(`SELECT rel FROM edges WHERE source_doc = ? AND target_doc = ? AND type = 'frontmatter-ref' ORDER BY rel`)
        .all(a, b);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.rel)).toEqual(["assignee", "owner"]);
    });

    it("CR-01: two mention edges to same target on different lines coexist", () => {
      const { a, b } = seedNotes(db);
      db.edges.insertBatch(a, [
        {
          targetNoteId: b,
          targetPath: null,
          type: "mention",
          rel: null,
          anchor: null,
          lineNumber: 5,
          linkText: null,
        },
        {
          targetNoteId: b,
          targetPath: null,
          type: "mention",
          rel: null,
          anchor: null,
          lineNumber: 12,
          linkText: null,
        },
      ]);
      const rows = db.handle
        .prepare<
          [],
          { line_number: number | null }
        >(`SELECT line_number FROM edges WHERE source_doc = ? AND target_doc = ? AND type = 'mention' ORDER BY line_number`)
        .all(a, b);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.line_number)).toEqual([5, 12]);
    });

    it("CR-01: two hyperlinks from same source with different URLs coexist", () => {
      const { a } = seedNotes(db);
      db.edges.insertBatch(a, [
        {
          targetNoteId: null,
          targetPath: "https://example.com/one",
          type: "hyperlink",
          rel: null,
          anchor: null,
          lineNumber: 3,
          linkText: null,
        },
        {
          targetNoteId: null,
          targetPath: "https://example.com/two",
          type: "hyperlink",
          rel: null,
          anchor: null,
          lineNumber: 4,
          linkText: null,
        },
      ]);
      const rows = db.handle
        .prepare<
          [],
          { target_path: string | null }
        >(`SELECT target_path FROM edges WHERE source_doc = ? AND type = 'hyperlink' ORDER BY target_path`)
        .all(a);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.target_path)).toEqual([
        "https://example.com/one",
        "https://example.com/two",
      ]);
    });

    it("CR-01 / migration 012: backfill from wikilinks recovers multiple broken targets from same source", () => {
      const { a } = seedNotes(db);
      // Seed TWO broken wikilinks from `a` directly into the v1 wikilinks
      // table (the v1 UNIQUE(source_note, target_path, anchor) accepts
      // them because target_path differs).
      db.handle
        .prepare(
          `INSERT INTO wikilinks (source_note, target_path, target_note, link_text, anchor, line_number)
           VALUES (?, ?, NULL, ?, NULL, ?)`,
        )
        .run(a, "ghost1.md", "Ghost1", 1);
      db.handle
        .prepare(
          `INSERT INTO wikilinks (source_note, target_path, target_note, link_text, anchor, line_number)
           VALUES (?, ?, NULL, ?, NULL, ?)`,
        )
        .run(a, "ghost2.md", "Ghost2", 2);
      // Clear edges and rewind past migration 012 so migrate() replays it.
      db.handle.exec("DELETE FROM edges");
      db.handle.pragma("user_version = 11");
      db.migrate();
      // Both broken wikilinks must surface in edges — proves the widened
      // key (target_path included) and the re-backfill step in 012 work.
      const broken = db.edges.resolveBrokenLinks();
      const targets = broken
        .filter((b) => b.sourceNoteId === a)
        .map((b) => b.targetPath)
        .sort();
      expect(targets).toEqual(["ghost1.md", "ghost2.md"]);
    });

    it("preserves broken wikilinks (target_path with target_doc IS NULL)", () => {
      const { a } = seedNotes(db);
      // Wikilink targeting a non-existent note → target_note is null,
      // target_path is preserved.
      db.wikilinks.insertBatch(a, [
        {
          targetPath: "ghost.md",
          targetNoteId: null,
          linkText: "Ghost",
          anchor: null,
          lineNumber: 7,
        },
      ]);
      db.handle.exec("DELETE FROM edges");
      db.handle.pragma("user_version = 10");
      db.migrate();
      const row = db.handle
        .prepare(
          `SELECT source_doc, target_doc, target_path, type
           FROM edges WHERE target_doc IS NULL`,
        )
        .get() as
        | { source_doc: number; target_doc: number | null; target_path: string; type: string }
        | undefined;
      expect(row).toBeDefined();
      expect(row?.source_doc).toBe(a);
      expect(row?.target_doc).toBeNull();
      expect(row?.target_path).toBe("ghost.md");
      expect(row?.type).toBe("wikilink");
    });
  });

  // ── EdgesQueries surface ──────────────────────────────────────────

  describe("EdgesQueries.insertBatch", () => {
    it("inserts edges via insertBatch with INSERT OR IGNORE idempotency", () => {
      const { a, b } = seedNotes(db);
      const batch = [
        {
          targetNoteId: b,
          targetPath: "b.md",
          type: "wikilink" as const,
          rel: null,
          anchor: null,
          lineNumber: 1,
        },
      ];
      db.edges.insertBatch(a, batch);
      const first = db.handle
        .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM edges")
        .get()?.c;
      expect(first).toBe(1);

      // Re-running the same batch must be a no-op (INSERT OR IGNORE +
      // UNIQUE(source_doc, target_doc, type, anchor)).
      db.edges.insertBatch(a, batch);
      const second = db.handle
        .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM edges")
        .get()?.c;
      expect(second).toBe(1);
    });

    it("accepts all four edge types in one batch", () => {
      const { a, b } = seedNotes(db);
      db.edges.insertBatch(a, [
        {
          targetNoteId: b,
          targetPath: null,
          type: "wikilink",
          rel: null,
          anchor: null,
          lineNumber: 1,
        },
        {
          targetNoteId: b,
          targetPath: null,
          type: "mention",
          rel: null,
          anchor: null,
          lineNumber: 2,
        },
        {
          targetNoteId: b,
          targetPath: null,
          type: "frontmatter-ref",
          rel: "assignee",
          anchor: null,
          lineNumber: null,
        },
        {
          targetNoteId: null,
          targetPath: "https://example.com",
          type: "hyperlink",
          rel: null,
          anchor: null,
          lineNumber: 3,
        },
      ]);
      const types = db.handle
        .prepare<[], { type: string }>("SELECT type FROM edges ORDER BY type")
        .all()
        .map((r) => r.type);
      expect(types).toEqual(["frontmatter-ref", "hyperlink", "mention", "wikilink"]);
    });
  });

  describe("EdgesQueries.deleteByNote", () => {
    it("removes only rows where source_doc = id", () => {
      const { a, b, c } = seedNotes(db);
      db.edges.insertBatch(a, [
        {
          targetNoteId: b,
          targetPath: null,
          type: "wikilink",
          rel: null,
          anchor: null,
          lineNumber: 1,
        },
      ]);
      db.edges.insertBatch(b, [
        {
          targetNoteId: c,
          targetPath: null,
          type: "wikilink",
          rel: null,
          anchor: null,
          lineNumber: 1,
        },
      ]);
      expect(db.edges.deleteByNote(a)).toBe(1);
      const remaining = db.handle
        .prepare<[], { source_doc: number }>("SELECT source_doc FROM edges")
        .all();
      expect(remaining).toEqual([{ source_doc: b }]);
    });

    it("FK ON DELETE CASCADE removes outgoing edges when source note is deleted", () => {
      const { a, b } = seedNotes(db);
      db.edges.insertBatch(a, [
        {
          targetNoteId: b,
          targetPath: null,
          type: "wikilink",
          rel: null,
          anchor: null,
          lineNumber: 1,
        },
      ]);
      db.notes.deleteByPath("a.md");
      const count = db.handle
        .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM edges")
        .get()?.c;
      expect(count).toBe(0);
    });
  });

  describe("EdgesQueries.getBacklinks / getForwardLinks", () => {
    it("getBacklinks returns rows where target_doc = id with snake_case → camelCase mapping", () => {
      const { a, b } = seedNotes(db);
      db.edges.insertBatch(a, [
        {
          targetNoteId: b,
          targetPath: null,
          type: "wikilink",
          rel: null,
          anchor: "section",
          lineNumber: 42,
        },
      ]);
      const backs = db.edges.getBacklinks(b);
      expect(backs).toHaveLength(1);
      expect(backs[0]).toMatchObject({
        sourceNoteId: a,
        type: "wikilink",
        anchor: "section",
        lineNumber: 42,
      });
    });

    it("getForwardLinks returns rows where source_doc = id with snake_case → camelCase mapping", () => {
      const { a, b } = seedNotes(db);
      db.edges.insertBatch(a, [
        {
          targetNoteId: b,
          targetPath: "b.md",
          type: "wikilink",
          rel: null,
          anchor: null,
          lineNumber: 9,
        },
      ]);
      const fwd = db.edges.getForwardLinks(a);
      expect(fwd).toHaveLength(1);
      expect(fwd[0]).toMatchObject({
        targetNoteId: b,
        targetPath: "b.md",
        type: "wikilink",
        anchor: null,
        lineNumber: 9,
      });
    });

    // ── Phase 4 / 04-03 (GRA-01 / D-08): edge-type filter ────────────────
    //
    // Tests 20–21 from the plan §<behavior>: the optional `edgeTypes`
    // filter narrows the result to the listed types. The filter is
    // passed through parameterized placeholders in an IN-clause;
    // EdgeType is a closed Zod-validated union (T-04-03-04 mitigation).

    it("getBacklinks(noteId, edgeTypes) filters to listed types only", () => {
      const { a, b, c } = seedNotes(db);
      // Two backlinks INTO b — one wikilink (from a), one mention (from c).
      db.edges.insertBatch(a, [
        {
          targetNoteId: b,
          targetPath: "b.md",
          type: "wikilink",
          rel: null,
          anchor: null,
          lineNumber: 1,
        },
      ]);
      db.edges.insertBatch(c, [
        {
          targetNoteId: b,
          targetPath: null,
          type: "mention",
          rel: null,
          anchor: null,
          lineNumber: 7,
          linkText: null,
        },
      ]);
      // No filter → both rows.
      const all = db.edges.getBacklinks(b);
      expect(all).toHaveLength(2);
      // Wikilink-only filter → 1 row.
      const wikiOnly = db.edges.getBacklinks(b, ["wikilink"]);
      expect(wikiOnly).toHaveLength(1);
      expect(wikiOnly[0]?.type).toBe("wikilink");
      // Two-type filter → both rows.
      const both = db.edges.getBacklinks(b, ["wikilink", "mention"]);
      expect(both).toHaveLength(2);
      // Mention-only filter → 1 row.
      const mentionOnly = db.edges.getBacklinks(b, ["mention"]);
      expect(mentionOnly).toHaveLength(1);
      expect(mentionOnly[0]?.type).toBe("mention");
      // Empty filter behaves like no filter.
      const empty = db.edges.getBacklinks(b, []);
      expect(empty).toHaveLength(2);
    });

    it("getForwardLinks(noteId, edgeTypes) filters; hyperlink rows preserve raw target_path", () => {
      const { a, b } = seedNotes(db);
      // a → b (wikilink, resolved), a → external URL (hyperlink, unresolved).
      db.edges.insertBatch(a, [
        {
          targetNoteId: b,
          targetPath: "b.md",
          type: "wikilink",
          rel: null,
          anchor: null,
          lineNumber: 1,
        },
        {
          targetNoteId: null,
          targetPath: "https://example.com",
          type: "hyperlink",
          rel: null,
          anchor: null,
          lineNumber: 5,
        },
      ]);
      // No filter → both rows.
      const all = db.edges.getForwardLinks(a);
      expect(all).toHaveLength(2);
      // Hyperlink-only filter → 1 row, raw URL in target_path,
      // target_doc null (unresolved per Phase 4 D-09).
      const hyperOnly = db.edges.getForwardLinks(a, ["hyperlink"]);
      expect(hyperOnly).toHaveLength(1);
      expect(hyperOnly[0]?.type).toBe("hyperlink");
      expect(hyperOnly[0]?.targetPath).toBe("https://example.com");
      expect(hyperOnly[0]?.targetNoteId).toBeNull();
      // Wikilink-only filter → 1 row, resolved.
      const wikiOnly = db.edges.getForwardLinks(a, ["wikilink"]);
      expect(wikiOnly).toHaveLength(1);
      expect(wikiOnly[0]?.targetNoteId).toBe(b);
    });

    it("resolveBrokenLinks returns rows with target_doc IS NULL", () => {
      const { a } = seedNotes(db);
      db.edges.insertBatch(a, [
        {
          targetNoteId: null,
          targetPath: "ghost.md",
          type: "wikilink",
          rel: null,
          anchor: null,
          lineNumber: 1,
        },
      ]);
      const broken = db.edges.resolveBrokenLinks();
      expect(broken).toEqual([
        {
          sourceNoteId: a,
          targetPath: "ghost.md",
          type: "wikilink",
          lineNumber: 1,
        },
      ]);
    });
  });

  // ─── Plan 04-05 / GRA-02: getAllForNodes ───────────────────────────────
  describe("EdgesQueries.getAllForNodes (Plan 04-05)", () => {
    it("returns ALL edges where BOTH source_doc and target_doc are in the input set", () => {
      const { a, b, c } = seedNotes(db);
      // Edge inside the input set: a → b (wikilink).
      // Edge inside the input set: b → c (mention).
      // Edge with target outside the set: a → c with anchor — STILL inside (c in set).
      // Edge with unresolved target — should NOT surface (target_doc IS NULL).
      db.edges.insertBatch(a, [
        {
          targetNoteId: b,
          targetPath: "b.md",
          type: "wikilink",
          rel: null,
          anchor: null,
          lineNumber: 1,
          linkText: null,
        },
        {
          targetNoteId: c,
          targetPath: "c.md",
          type: "wikilink",
          rel: null,
          anchor: "section",
          lineNumber: 2,
          linkText: null,
        },
        {
          targetNoteId: null,
          targetPath: "ghost.md",
          type: "wikilink",
          rel: null,
          anchor: null,
          lineNumber: 3,
          linkText: null,
        },
      ]);
      db.edges.insertBatch(b, [
        {
          targetNoteId: c,
          targetPath: "c.md",
          type: "mention",
          rel: null,
          anchor: null,
          lineNumber: 1,
          linkText: null,
        },
      ]);
      const rows = db.edges.getAllForNodes([a, b, c]);
      // Exactly 3 in-set edges; unresolved row excluded.
      expect(rows).toHaveLength(3);
      const triples = rows.map((r) => `${r.sourceDoc}→${r.targetDoc}/${r.type}`).sort();
      expect(triples).toEqual(
        [`${a}→${b}/wikilink`, `${a}→${c}/wikilink`, `${b}→${c}/mention`].sort(),
      );
      // Each row carries the documented fields.
      for (const r of rows) {
        expect(typeof r.sourceDoc).toBe("number");
        expect(typeof r.targetDoc).toBe("number");
        expect(typeof r.type).toBe("string");
        // anchor / lineNumber present (may be null)
        expect(r).toHaveProperty("anchor");
        expect(r).toHaveProperty("lineNumber");
      }
    });

    it("excludes edges whose target_doc is OUTSIDE the input set", () => {
      const { a, b, c } = seedNotes(db);
      // a → b (in-set if input is [a,b]); a → c (out-of-set if input is [a,b]).
      db.edges.insertBatch(a, [
        {
          targetNoteId: b,
          targetPath: "b.md",
          type: "wikilink",
          rel: null,
          anchor: null,
          lineNumber: 1,
          linkText: null,
        },
        {
          targetNoteId: c,
          targetPath: "c.md",
          type: "wikilink",
          rel: null,
          anchor: null,
          lineNumber: 2,
          linkText: null,
        },
      ]);
      const rows = db.edges.getAllForNodes([a, b]);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.sourceDoc).toBe(a);
      expect(rows[0]?.targetDoc).toBe(b);
    });

    it("returns empty array for empty input", () => {
      seedNotes(db);
      expect(db.edges.getAllForNodes([])).toEqual([]);
    });

    it("returns empty array for a single-node input (no self-loops in edges)", () => {
      const { a, b } = seedNotes(db);
      db.edges.insertBatch(a, [
        {
          targetNoteId: b,
          targetPath: "b.md",
          type: "wikilink",
          rel: null,
          anchor: null,
          lineNumber: 1,
          linkText: null,
        },
      ]);
      // Single noteId — its own edges all leave the set; should be empty.
      expect(db.edges.getAllForNodes([a])).toEqual([]);
    });

    it("excludes edges with target_doc IS NULL (unresolved hyperlinks)", () => {
      const { a, b } = seedNotes(db);
      db.edges.insertBatch(a, [
        {
          targetNoteId: null,
          targetPath: "https://example.com",
          type: "hyperlink",
          rel: null,
          anchor: null,
          lineNumber: 1,
          linkText: null,
        },
        {
          targetNoteId: b,
          targetPath: "b.md",
          type: "wikilink",
          rel: null,
          anchor: null,
          lineNumber: 2,
          linkText: null,
        },
      ]);
      const rows = db.edges.getAllForNodes([a, b]);
      // Only the resolved wikilink survives.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.type).toBe("wikilink");
    });
  });
});
