/**
 * Unit tests for v0.9.0 agent-compatibility helpers and aggregates.
 *
 * Full integration of the stdio MCP wireup is covered by the
 * scripts/smoketest-v0.9.0.sh end-to-end script — vitest here focuses on
 * the deterministic pure functions and SQL aggregates.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "./db/database.js";
import {
  encodeNoteId,
  decodeNoteId,
  obsidianUrl,
  truncateSnippet,
  aggregateTopTags,
  aggregateTopFrontmatterKeys,
} from "./server.js";

describe("encodeNoteId / decodeNoteId", () => {
  it("round-trips a plain vault+path pair", () => {
    const id = encodeNoteId("my-vault", "Personen/Joerg.md");
    expect(id).toBe("my-vault:Personen/Joerg.md");
    expect(decodeNoteId(id)).toEqual({
      vault: "my-vault",
      path: "Personen/Joerg.md",
    });
  });

  it("preserves nested subpaths with colons after the first separator", () => {
    // First `:` is the vault separator; any further colons belong to the
    // path (Obsidian allows `:` in filenames on Linux/macOS).
    const id = encodeNoteId("inim", "Meetings/2026-05-12 14:00 Sync.md");
    expect(decodeNoteId(id)).toEqual({
      vault: "inim",
      path: "Meetings/2026-05-12 14:00 Sync.md",
    });
  });

  it("rejects malformed ids", () => {
    expect(() => decodeNoteId("no-separator")).toThrow();
    expect(() => decodeNoteId(":leading-empty-vault")).toThrow();
    expect(() => decodeNoteId("vault-only-trailing:")).toThrow();
  });
});

describe("obsidianUrl", () => {
  it("URL-encodes vault name and path", () => {
    expect(obsidianUrl("Intelligence Impact", "_research/foo bar.md")).toBe(
      "obsidian://open?vault=Intelligence%20Impact&file=_research%2Ffoo%20bar.md",
    );
  });

  it("handles plain ascii unchanged except for slashes/spaces", () => {
    expect(obsidianUrl("inim", "notes/x.md")).toBe("obsidian://open?vault=inim&file=notes%2Fx.md");
  });
});

describe("truncateSnippet", () => {
  it("collapses whitespace and trims", () => {
    expect(truncateSnippet("  hello   world  \n\n", 100)).toBe("hello world");
  });

  it("truncates with ellipsis when over limit", () => {
    const out = truncateSnippet("a".repeat(300), 50);
    expect(out).toHaveLength(50);
    expect(out.endsWith("…")).toBe(true);
  });

  it("does not append ellipsis when within limit", () => {
    expect(truncateSnippet("short", 50)).toBe("short");
  });
});

describe("SQL aggregates", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.migrate();
  });

  afterEach(() => {
    db.close();
  });

  function insertNote(path: string, frontmatter: Record<string, unknown> | null): void {
    db.notes.upsertByPath({
      path,
      content: "body",
      frontmatter: frontmatter ? JSON.stringify(frontmatter) : null,
      title: path,
      hash: `h-${path}`,
      mtime: Date.now(),
      wordCount: 1,
    });
  }

  describe("aggregateTopTags", () => {
    it("returns empty array on empty vault", () => {
      expect(aggregateTopTags(db.handle, 10)).toEqual([]);
    });

    it("counts tags from frontmatter.tags arrays", () => {
      insertNote("a.md", { tags: ["x", "y"] });
      insertNote("b.md", { tags: ["x", "z"] });
      insertNote("c.md", { tags: ["x"] });
      insertNote("d.md", { title: "no tags" });
      insertNote("e.md", null);

      const tags = aggregateTopTags(db.handle, 10);
      expect(tags).toEqual([
        { tag: "x", count: 3 },
        { tag: "y", count: 1 },
        { tag: "z", count: 1 },
      ]);
    });

    it("respects the limit", () => {
      insertNote("a.md", { tags: ["a", "b", "c", "d", "e"] });
      const tags = aggregateTopTags(db.handle, 2);
      expect(tags).toHaveLength(2);
    });

    it("tolerates dirty frontmatter (non-array tags, mixed types)", () => {
      // Real vaults accumulate this kind of drift. Discovered via smoketest
      // against Intelligence-Impact vault — aggregate was crashing with
      // "malformed JSON" when a single note had `tags` as a string.
      insertNote("clean.md", { tags: ["foo", "bar"] });
      insertNote("string-tag.md", { tags: "single-tag-as-string" });
      insertNote("nested.md", { tags: { weird: "object" } });
      insertNote("no-fm.md", null);
      insertNote("non-text.md", { tags: ["valid", 42, null, "another"] });

      const tags = aggregateTopTags(db.handle, 10);
      // Only well-formed text entries from arrays count.
      expect(tags.map((t) => t.tag).sort()).toEqual(["another", "bar", "foo", "valid"]);
    });
  });

  describe("aggregateTopFrontmatterKeys", () => {
    it("returns empty array on empty vault", () => {
      expect(aggregateTopFrontmatterKeys(db.handle, 10)).toEqual([]);
    });

    it("counts top-level frontmatter keys across notes", () => {
      insertNote("a.md", { tags: [], status: "active" });
      insertNote("b.md", { tags: [], type: "person" });
      insertNote("c.md", { tags: [] });
      insertNote("d.md", null);

      const keys = aggregateTopFrontmatterKeys(db.handle, 10);
      // tags=3, status=1, type=1 — order: count DESC, then key ASC
      expect(keys[0]).toEqual({ key: "tags", count: 3 });
      expect(
        keys
          .slice(1)
          .map((k) => k.key)
          .sort(),
      ).toEqual(["status", "type"]);
    });

    it("tolerates frontmatter that is not a JSON object", () => {
      // If a note's frontmatter is stored as `null` or a primitive (rare
      // but possible after upstream parser quirks), the aggregate must
      // not throw.
      insertNote("clean.md", { status: "active" });
      // Bypass insertNote: write a primitive directly so we exercise the
      // json_type filter.
      db.notes.upsertByPath({
        path: "weird.md",
        content: "body",
        frontmatter: '"just-a-string"',
        title: "weird",
        hash: "h-weird",
        mtime: Date.now(),
        wordCount: 1,
      });
      const keys = aggregateTopFrontmatterKeys(db.handle, 10);
      expect(keys).toEqual([{ key: "status", count: 1 }]);
    });
  });
});
