import { describe, it, expect, beforeEach } from "vitest";
import { Database } from "../database.js";

describe("BriefSourcesQueries (Phase 5 / D-06)", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  it("migration 013: brief_sources table exists with documented columns + indexes", () => {
    // Assert via PRAGMA introspection — no app-level dependency.
    const cols = db.handle.prepare("PRAGMA table_info(brief_sources)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      ["brief_doc_id", "chunk_doc_id", "chunk_id_fragment", "recorded_hash"].sort(),
    );

    // Indexes per migration 013: idx_brief_sources_chunk_doc, idx_brief_sources_fragment,
    // plus the auto-index for the UNIQUE constraint.
    const indexes = db.handle.prepare("PRAGMA index_list(brief_sources)").all() as Array<{
      name: string;
      unique: number;
    }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_brief_sources_chunk_doc");
    expect(indexNames).toContain("idx_brief_sources_fragment");
    // At least one UNIQUE index exists (the inline UNIQUE on brief_doc_id/chunk_id_fragment).
    expect(indexes.some((i) => i.unique === 1)).toBe(true);
  });

  it("insertBatch + sourcesForBrief: round-trips records faithfully", () => {
    db.briefSources.insertBatch("obsidian-fs://v/_memory/_briefs/atlas.md", [
      {
        chunkIdFragment: "a3f5b2c",
        chunkDocId: "obsidian-fs://v/notes/foo.md",
        recordedHash: "sha256:abc",
      },
      {
        chunkIdFragment: "deadbee",
        chunkDocId: "obsidian-fs://v/notes/bar.md",
        recordedHash: "sha256:def",
      },
    ]);
    const sources = db.briefSources.sourcesForBrief("obsidian-fs://v/_memory/_briefs/atlas.md");
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.chunkIdFragment).sort()).toEqual(["a3f5b2c", "deadbee"]);
    expect(sources.every((s) => s.briefDocId === "obsidian-fs://v/_memory/_briefs/atlas.md")).toBe(
      true,
    );
  });

  it("insertBatch is idempotent via INSERT OR IGNORE + UNIQUE constraint", () => {
    const brief = "obsidian-fs://v/_memory/_briefs/atlas.md";
    const batch = [
      {
        chunkIdFragment: "a3f5b2c",
        chunkDocId: "obsidian-fs://v/notes/foo.md",
        recordedHash: "sha256:abc",
      },
    ];
    db.briefSources.insertBatch(brief, batch);
    db.briefSources.insertBatch(brief, batch); // duplicate — must not throw, must not duplicate
    expect(db.briefSources.sourcesForBrief(brief)).toHaveLength(1);
  });

  it("deleteByBrief removes only the named brief's rows", () => {
    const briefA = "obsidian-fs://v/_memory/_briefs/atlas.md";
    const briefB = "obsidian-fs://v/_memory/_briefs/orion.md";
    db.briefSources.insertBatch(briefA, [
      {
        chunkIdFragment: "aaaaaaa",
        chunkDocId: "obsidian-fs://v/notes/foo.md",
        recordedHash: "sha256:1",
      },
    ]);
    db.briefSources.insertBatch(briefB, [
      {
        chunkIdFragment: "bbbbbbb",
        chunkDocId: "obsidian-fs://v/notes/foo.md",
        recordedHash: "sha256:2",
      },
    ]);
    const removed = db.briefSources.deleteByBrief(briefA);
    expect(removed).toBe(1);
    expect(db.briefSources.sourcesForBrief(briefA)).toHaveLength(0);
    expect(db.briefSources.sourcesForBrief(briefB)).toHaveLength(1);
  });

  it("briefsForChunkDoc reverse-indexes correctly", () => {
    const briefA = "obsidian-fs://v/_memory/_briefs/atlas.md";
    const briefB = "obsidian-fs://v/_memory/_briefs/orion.md";
    const sharedSource = "obsidian-fs://v/notes/shared.md";
    db.briefSources.insertBatch(briefA, [
      { chunkIdFragment: "aaaaaaa", chunkDocId: sharedSource, recordedHash: "sha256:1" },
    ]);
    db.briefSources.insertBatch(briefB, [
      { chunkIdFragment: "bbbbbbb", chunkDocId: sharedSource, recordedHash: "sha256:2" },
    ]);
    const briefs = db.briefSources.briefsForChunkDoc(sharedSource);
    expect(briefs).toHaveLength(2);
    expect(briefs.map((b) => b.briefDocId).sort()).toEqual([briefA, briefB].sort());
  });

  it("listBriefDocIds returns distinct brief identifiers", () => {
    db.briefSources.insertBatch("obsidian-fs://v/_memory/_briefs/a.md", [
      { chunkIdFragment: "1111111", chunkDocId: "obsidian-fs://v/x.md", recordedHash: "h1" },
      { chunkIdFragment: "2222222", chunkDocId: "obsidian-fs://v/y.md", recordedHash: "h2" },
    ]);
    db.briefSources.insertBatch("obsidian-fs://v/_memory/_briefs/b.md", [
      { chunkIdFragment: "3333333", chunkDocId: "obsidian-fs://v/z.md", recordedHash: "h3" },
    ]);
    const ids = db.briefSources.listBriefDocIds().sort();
    expect(ids).toEqual([
      "obsidian-fs://v/_memory/_briefs/a.md",
      "obsidian-fs://v/_memory/_briefs/b.md",
    ]);
  });
});
