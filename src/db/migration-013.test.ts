import { describe, it, expect, beforeEach } from "vitest";
import { Database } from "./database.js";
import { computeChunkIdFragment } from "../chunker/chunk-id.js";

/**
 * Migration 013 — Phase 5 / BRF-* / D-04..D-06 / D-09.
 *
 * Behavior tests for the multi-table migration that lands
 * `chunks.chunk_id_fragment` (with backfill), `brief_sources`, and
 * `daemon_state`. Per-table query-namespace tests live in
 * `brief_sources.test.ts` and `daemon_state.test.ts`. This file
 * targets the migration itself.
 */
describe("runMigration013 (Phase 5)", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  it("DDL: chunks.chunk_id_fragment column is TEXT NOT NULL DEFAULT ''", () => {
    const cols = db.handle.prepare("PRAGMA table_info(chunks)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const frag = cols.find((c) => c.name === "chunk_id_fragment");
    expect(frag).toBeDefined();
    expect(frag?.type.toUpperCase()).toBe("TEXT");
    expect(frag?.notnull).toBe(1);
    // SQLite stores the literal `''` for the default in PRAGMA output.
    expect(frag?.dflt_value).toBe("''");
  });

  it("backfill: chunks inserted without a fragment receive the canonical value via insertBatch", () => {
    // Seed a note + a chunk via the same call path used by older test
    // fixtures (no `chunkIdFragment` field on ChunkInput). The
    // insertBatch fallback (`computeChunkIdFragment(c.text)`) must
    // populate the column.
    const noteId = db.notes.upsertByPath({
      path: "foo.md",
      title: "Foo",
      content: "hello",
      bodyHash: "bh",
      frontmatter: null,
      hash: "h",
      mtime: 1,
      wordCount: 1,
      docUri: "obsidian-fs://test/foo.md",
    }).id;
    const text = "## Quarterly status\n\nAtlas Robotics on track.";
    db.chunks.insertBatch(noteId, [
      {
        idx: 0,
        text,
        headingPath: "## Quarterly status",
        startOffset: 0,
        endOffset: text.length,
        tokenCount: 8,
      },
    ]);
    const rows = db.handle
      .prepare<[], { text: string; chunk_id_fragment: string }>(
        "SELECT text, chunk_id_fragment FROM chunks",
      )
      .all();
    expect(rows).toHaveLength(1);
    const expected = computeChunkIdFragment(text);
    expect(rows[0]?.chunk_id_fragment).toBe(expected);
    expect(rows[0]?.chunk_id_fragment).toMatch(/^[0-9a-f]{7}$/);
  });

  it("backfill: chunks with byte-identical text get identical fragments (content-only, D-04)", () => {
    const noteId1 = db.notes.upsertByPath({
      path: "a.md",
      title: "A",
      content: "x",
      bodyHash: "bh1",
      frontmatter: null,
      hash: "h1",
      mtime: 1,
      wordCount: 1,
      docUri: "obsidian-fs://test/a.md",
    }).id;
    const noteId2 = db.notes.upsertByPath({
      path: "b.md",
      title: "B",
      content: "x",
      bodyHash: "bh2",
      frontmatter: null,
      hash: "h2",
      mtime: 2,
      wordCount: 1,
      docUri: "obsidian-fs://test/b.md",
    }).id;
    const sharedText = "## Identical heading\n\nIdentical body content.";
    db.chunks.insertBatch(noteId1, [
      {
        idx: 0,
        text: sharedText,
        headingPath: null,
        startOffset: 0,
        endOffset: sharedText.length,
        tokenCount: 5,
      },
    ]);
    db.chunks.insertBatch(noteId2, [
      {
        idx: 0,
        text: sharedText,
        headingPath: null,
        startOffset: 0,
        endOffset: sharedText.length,
        tokenCount: 5,
      },
    ]);
    const fragments = db.handle
      .prepare<[], { chunk_id_fragment: string }>(
        "SELECT chunk_id_fragment FROM chunks ORDER BY id",
      )
      .all();
    expect(fragments).toHaveLength(2);
    // Worked example from CONTEXT.md §"specifics": two byte-identical
    // chunks in different documents share the fragment (disambiguation
    // happens at the <DocId> prefix layer).
    expect(fragments[0]?.chunk_id_fragment).toBe(fragments[1]?.chunk_id_fragment);
  });

  it("DDL: daemon_state + brief_sources tables co-exist (migration 013 lands all three substrates)", () => {
    // Three checks bundled — if any fail, migration 013 didn't apply.
    expect(
      db.handle.prepare("SELECT name FROM sqlite_master WHERE name = 'daemon_state'").get(),
    ).toBeDefined();
    expect(
      db.handle.prepare("SELECT name FROM sqlite_master WHERE name = 'brief_sources'").get(),
    ).toBeDefined();
    const chunksCols = db.handle.prepare("PRAGMA table_info(chunks)").all() as Array<{
      name: string;
    }>;
    expect(chunksCols.some((c) => c.name === "chunk_id_fragment")).toBe(true);
  });

  it("schema version reaches 13 after migrate()", () => {
    expect(db.getSchemaVersion()).toBeGreaterThanOrEqual(13);
  });
});
