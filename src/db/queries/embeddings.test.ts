/**
 * Variable-dimension embedding routing tests (Phase 7b).
 *
 * Verifies that two models with different output dimensions can coexist in
 * the same vault DB and that queries against one dim never see vectors
 * from the other.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "../database.js";

describe("EmbeddingsQueries — variable dims", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  function makeNoteWithChunks(path: string, n: number): number[] {
    const { id: noteId } = db.notes.upsertByPath({
      path,
      content: "x",
      frontmatter: null,
      title: path,
      hash: `h-${path}`,
      mtime: 1,
      wordCount: 1,
    });
    return db.chunks.insertBatch(
      noteId,
      Array.from({ length: n }, (_, i) => ({
        idx: i,
        text: `chunk ${path} #${i}`,
        headingPath: null,
        startOffset: i,
        endOffset: i + 1,
        tokenCount: 1,
      })),
    );
  }

  function unitAxis(axis: number, dim: number): number[] {
    const v = new Array<number>(dim).fill(0);
    v[axis] = 1;
    return v;
  }

  it("routes inserts and searches to the model's dim table without cross-contamination", () => {
    const m1024 = db.models.upsert({ name: "qwen3", provider: "ollama", dim: 1024 });
    const m768 = db.models.upsert({ name: "gemma", provider: "ollama", dim: 768 });

    const chunks1024 = makeNoteWithChunks("A.md", 3);
    const chunks768 = makeNoteWithChunks("B.md", 3);

    db.embeddings.insertBatch([
      { chunkId: chunks1024[0]!, modelId: m1024.id, vector: unitAxis(0, 1024) },
      { chunkId: chunks1024[1]!, modelId: m1024.id, vector: unitAxis(1, 1024) },
      { chunkId: chunks1024[2]!, modelId: m1024.id, vector: unitAxis(2, 1024) },
    ]);
    db.embeddings.insertBatch([
      { chunkId: chunks768[0]!, modelId: m768.id, vector: unitAxis(0, 768) },
      { chunkId: chunks768[1]!, modelId: m768.id, vector: unitAxis(1, 768) },
      { chunkId: chunks768[2]!, modelId: m768.id, vector: unitAxis(2, 768) },
    ]);

    // Searches against the 1024 model only return chunks from A.md.
    const hits1024 = db.embeddings.searchSemantic(m1024.id, unitAxis(1, 1024), 10);
    expect(hits1024.map((h) => h.chunkId).sort()).toEqual(
      [...chunks1024].sort(),
    );
    expect(hits1024[0]?.chunkId).toBe(chunks1024[1]); // nearest = axis-1

    // Searches against the 768 model only return chunks from B.md.
    const hits768 = db.embeddings.searchSemantic(m768.id, unitAxis(2, 768), 10);
    expect(hits768.map((h) => h.chunkId).sort()).toEqual(
      [...chunks768].sort(),
    );
    expect(hits768[0]?.chunkId).toBe(chunks768[2]);

    // Verify the underlying tables really are separate.
    const count1024 = (
      db.handle
        .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM embeddings_1024")
        .get() as { c: number }
    ).c;
    const count768 = (
      db.handle
        .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM embeddings_768")
        .get() as { c: number }
    ).c;
    expect(count1024).toBe(3);
    expect(count768).toBe(3);
  });

  it("deleteByChunk works without knowing the dim", () => {
    const m768 = db.models.upsert({ name: "gemma", provider: "ollama", dim: 768 });
    const [c0, c1] = makeNoteWithChunks("X.md", 2);
    db.embeddings.insertBatch([
      { chunkId: c0!, modelId: m768.id, vector: unitAxis(0, 768) },
      { chunkId: c1!, modelId: m768.id, vector: unitAxis(1, 768) },
    ]);

    db.embeddings.deleteByChunk(c0!);
    const hits = db.embeddings.searchSemantic(m768.id, unitAxis(0, 768), 10);
    expect(hits.map((h) => h.chunkId)).toEqual([c1]);
  });

  it("deleteByModel removes only that model's rows", () => {
    const m1024 = db.models.upsert({ name: "qwen3", provider: "ollama", dim: 1024 });
    const m768 = db.models.upsert({ name: "gemma", provider: "ollama", dim: 768 });
    const c1024 = makeNoteWithChunks("A.md", 1)[0]!;
    const c768 = makeNoteWithChunks("B.md", 1)[0]!;
    db.embeddings.insertBatch([
      { chunkId: c1024, modelId: m1024.id, vector: unitAxis(0, 1024) },
      { chunkId: c768, modelId: m768.id, vector: unitAxis(0, 768) },
    ]);

    db.embeddings.deleteByModel(m1024.id);
    expect(db.embeddings.searchSemantic(m1024.id, unitAxis(0, 1024), 10)).toEqual([]);
    expect(
      db.embeddings.searchSemantic(m768.id, unitAxis(0, 768), 10).map((h) => h.chunkId),
    ).toEqual([c768]);
  });

  it("throws on unknown model_id (no silent defaults)", () => {
    expect(() =>
      db.embeddings.searchSemantic(999, [0, 0, 0], 5),
    ).toThrowError(/model_id 999 not found/);
    expect(() =>
      db.embeddings.insertBatch([{ chunkId: 1, modelId: 999, vector: [0] }]),
    ).toThrowError(/model_id 999 not found/);
  });

  it("materializes new dim tables on demand for unusual dims", () => {
    const m384 = db.models.upsert({ name: "minilm", provider: "ollama", dim: 384 });
    const [c0] = makeNoteWithChunks("M.md", 1);
    db.embeddings.insertBatch([
      { chunkId: c0!, modelId: m384.id, vector: unitAxis(0, 384) },
    ]);
    // Table was created lazily.
    const row = db.handle
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get("embeddings_384");
    expect(row?.name).toBe("embeddings_384");

    const hits = db.embeddings.searchSemantic(m384.id, unitAxis(0, 384), 5);
    expect(hits.map((h) => h.chunkId)).toEqual([c0]);
  });
});

describe("migration 004 — legacy embeddings → embeddings_1024", () => {
  it("preserves rows from a pre-v4 DB and ends at version 4", () => {
    // Hand-craft a v3-shaped DB: notes/chunks/models/embeddings with one row,
    // user_version=3 — exactly what an existing v0.6.1 vault looks like.
    const db = new Database(":memory:");
    // Roll the user_version back to 3 and recreate the legacy table to
    // simulate a pre-migration DB. (Migrations have already brought it to 4.)
    db.handle.exec("DROP TABLE IF EXISTS embeddings_1024");
    db.handle.exec("DROP TABLE IF EXISTS embeddings_768");
    db.handle.exec(`
      CREATE VIRTUAL TABLE embeddings USING vec0(
        chunk_id INTEGER PRIMARY KEY,
        model_id INTEGER NOT NULL,
        vector   FLOAT[1024]
      )
    `);
    db.handle.pragma("user_version = 3");

    // Seed a chunk + model + legacy embedding row.
    const { id: noteId } = db.notes.upsertByPath({
      path: "legacy.md", content: "x", frontmatter: null, title: "legacy",
      hash: "h", mtime: 1, wordCount: 1,
    });
    const [chunkId] = db.chunks.insertBatch(noteId, [
      { idx: 0, text: "old", headingPath: null, startOffset: 0, endOffset: 1, tokenCount: 1 },
    ]);
    const model = db.models.upsert({ name: "qwen3", provider: "ollama", dim: 1024 });
    const v = new Array<number>(1024).fill(0);
    v[42] = 1;
    db.handle
      .prepare("INSERT INTO embeddings (chunk_id, model_id, vector) VALUES (?, ?, ?)")
      .run(BigInt(chunkId!), BigInt(model.id), JSON.stringify(v));

    // Apply migrations forward.
    db.migrate();
    expect(db.getSchemaVersion()).toBe(4);

    // Legacy table is gone; embeddings_1024 has the row.
    const legacy = db.handle
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get("embeddings");
    expect(legacy).toBeUndefined();

    const moved = db.handle
      .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM embeddings_1024")
      .get();
    expect(moved?.c).toBe(1);

    // And it's queryable through the EmbeddingsQueries.
    // (Need to invalidate the cached statements which were prepared against
    // the test-side schema; easiest is a fresh Database opening the same
    // SQLite handle is not trivial — so just verify via raw SQL.)
    const row = db.handle
      .prepare<[bigint], { chunk_id: number; model_id: number }>(
        "SELECT chunk_id, model_id FROM embeddings_1024 WHERE chunk_id = ?",
      )
      .get(BigInt(chunkId!));
    expect(row?.chunk_id).toBe(chunkId);
    expect(row?.model_id).toBe(model.id);

    db.close();
  });
});
