import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "../db/database.js";
import type { Vault } from "../vault/index.js";
import type { VaultConfig } from "../types.js";
import { listBacklinks, listForwardLinks, findBrokenLinks } from "./graph.js";

function makeVault(db: Database): Vault {
  const config: VaultConfig = { name: "test", path: "/tmp/test" };
  return { config, db, dbPath: ":memory:" };
}

interface SeededIds {
  a: number;
  b: number;
  c: number;
}

function seed(db: Database): SeededIds {
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

  const a = mk("a.md", "A", "ha");
  const b = mk("b.md", "B", "hb");
  const c = mk("c.md", "C", "hc");

  // ── Phase 4 / 04-01 / GRA-04 (D-01, D-04) ──
  //
  // Seed BOTH `wikilinks` (v1 write path, kept in place per D-01) AND
  // `edges` (Phase 4 read path). Plan 04-02 lands the unified extractor
  // that writes to both in one helper. Until then, tests that exercise
  // the post-migration read path must seed `edges` themselves — the
  // migration-011 backfill only runs once at construction time.

  // A links to B, C, and NonExistent
  db.wikilinks.insertBatch(a, [
    {
      targetPath: "b.md",
      targetNoteId: b,
      linkText: "B",
      anchor: null,
      lineNumber: 1,
    },
    {
      targetPath: "c.md",
      targetNoteId: c,
      linkText: "C",
      anchor: "section",
      lineNumber: 2,
    },
    {
      targetPath: "nonexistent.md",
      targetNoteId: null,
      linkText: "NonExistent",
      anchor: null,
      lineNumber: 3,
    },
  ]);
  db.edges.insertBatch(a, [
    {
      targetNoteId: b,
      targetPath: "b.md",
      type: "wikilink",
      rel: null,
      anchor: null,
      lineNumber: 1,
      linkText: "B",
    },
    {
      targetNoteId: c,
      targetPath: "c.md",
      type: "wikilink",
      rel: null,
      anchor: "section",
      lineNumber: 2,
      linkText: "C",
    },
    {
      targetNoteId: null,
      targetPath: "nonexistent.md",
      type: "wikilink",
      rel: null,
      anchor: null,
      lineNumber: 3,
      linkText: "NonExistent",
    },
  ]);

  // B links to C
  db.wikilinks.insertBatch(b, [
    {
      targetPath: "c.md",
      targetNoteId: c,
      linkText: "C",
      anchor: null,
      lineNumber: 5,
    },
  ]);
  db.edges.insertBatch(b, [
    {
      targetNoteId: c,
      targetPath: "c.md",
      type: "wikilink",
      rel: null,
      anchor: null,
      lineNumber: 5,
      linkText: "C",
    },
  ]);

  return { a, b, c };
}

describe("graph", () => {
  let db: Database;
  let vault: Vault;

  beforeEach(() => {
    db = new Database(":memory:", "test-vault");
    db.migrate();
    vault = makeVault(db);
    seed(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("listBacklinks", () => {
    it("returns A as a backlink of B", () => {
      const result = listBacklinks(vault, "b.md");
      expect(result).toHaveLength(1);
      expect(result[0]?.sourcePath).toBe("a.md");
      expect(result[0]?.sourceTitle).toBe("A");
      expect(result[0]?.lineNumber).toBe(1);
      expect(result[0]?.linkText).toBe("B");
    });

    it("returns A and B as backlinks of C", () => {
      const result = listBacklinks(vault, "c.md");
      const paths = result.map((r) => r.sourcePath).sort();
      expect(paths).toEqual(["a.md", "b.md"]);
    });

    it("throws for unknown path", () => {
      expect(() => listBacklinks(vault, "ghost.md")).toThrow(/Note not found: ghost\.md/);
    });

    // ── Phase 4 / 04-01 / GRA-04 (D-04): additive `type` field ──
    it("each backlink result carries an additive `type` field (post-04-01 backfill: 'wikilink')", () => {
      const result = listBacklinks(vault, "c.md");
      expect(result).toHaveLength(2);
      for (const row of result) {
        expect(row.type).toBe("wikilink");
      }
    });
  });

  describe("listForwardLinks", () => {
    it("returns all forward links from A including broken", () => {
      const result = listForwardLinks(vault, "a.md", true);
      expect(result).toHaveLength(3);
      const byTarget = new Map(result.map((r) => [r.targetPath, r]));
      expect(byTarget.get("b.md")?.resolved).toBe(true);
      expect(byTarget.get("b.md")?.targetTitle).toBe("B");
      expect(byTarget.get("c.md")?.resolved).toBe(true);
      expect(byTarget.get("c.md")?.anchor).toBe("section");
      expect(byTarget.get("nonexistent.md")?.resolved).toBe(false);
      expect(byTarget.get("nonexistent.md")?.targetTitle).toBeNull();
    });

    it("filters out broken links when includeBroken=false", () => {
      const result = listForwardLinks(vault, "a.md", false);
      expect(result).toHaveLength(2);
      const paths = result.map((r) => r.targetPath).sort();
      expect(paths).toEqual(["b.md", "c.md"]);
      expect(result.every((r) => r.resolved)).toBe(true);
    });

    it("throws for unknown path", () => {
      expect(() => listForwardLinks(vault, "ghost.md")).toThrow(/Note not found/);
    });

    // ── Phase 4 / 04-01 / GRA-04 (D-04): additive `type` field ──
    it("each forward link result carries an additive `type` field", () => {
      const result = listForwardLinks(vault, "a.md", true);
      expect(result).toHaveLength(3);
      for (const row of result) {
        expect(row.type).toBe("wikilink");
      }
    });
  });

  describe("findBrokenLinks", () => {
    it("returns NonExistent as broken with source A", () => {
      const result = findBrokenLinks(vault);
      expect(result).toHaveLength(1);
      expect(result[0]?.sourcePath).toBe("a.md");
      expect(result[0]?.sourceTitle).toBe("A");
      expect(result[0]?.targetPath).toBe("nonexistent.md");
      // lineNumber not provided by DB layer for broken links (documented).
      expect(result[0]?.lineNumber).toBeNull();
      // ── Phase 4 / 04-01 / GRA-04 (D-04): additive `type` field ──
      expect(result[0]?.type).toBe("wikilink");
    });

    it("returns empty when no broken links exist", () => {
      const fresh = new Database(":memory:", "test-vault");
      fresh.migrate();
      const v = makeVault(fresh);
      const id = fresh.notes.upsertByPath({
        path: "only.md",
        content: "x",
        frontmatter: null,
        title: "Only",
        hash: "h",
        mtime: 1,
        wordCount: 1,
      }).id;
      fresh.wikilinks.insertBatch(id, []);
      expect(findBrokenLinks(v)).toEqual([]);
      fresh.close();
    });
  });
});
