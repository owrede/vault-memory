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

    // Verify the underlying tables really are separate (per-model, post-7e).
    const count1024 = (
      db.handle
        .prepare<[], { c: number }>(
          `SELECT COUNT(*) AS c FROM embeddings_m${m1024.id}_d1024`,
        )
        .get() as { c: number }
    ).c;
    const count768 = (
      db.handle
        .prepare<[], { c: number }>(
          `SELECT COUNT(*) AS c FROM embeddings_m${m768.id}_d768`,
        )
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
    // Table was created lazily — per-model naming in v5.
    const expectedTable = `embeddings_m${m384.id}_d384`;
    const row = db.handle
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(expectedTable);
    expect(row?.name).toBe(expectedTable);

    const hits = db.embeddings.searchSemantic(m384.id, unitAxis(0, 384), 5);
    expect(hits.map((h) => h.chunkId)).toEqual([c0]);
  });

  // Regression test for the v0.7.0 bug discovered during eval-v2:
  // two models with the SAME dim (e.g. qwen3 @ 1024 + bge-m3 @ 1024) embedding
  // the SAME chunk crashed with "UNIQUE constraint failed on embeddings_1024
  // primary key". Migration 005 + the `model_id PARTITION KEY` in the vec0
  // schema allow this case.
  it("two models with same dim can both embed the same chunk_id (partition key)", () => {
    const m1 = db.models.upsert({ name: "qwen-test", provider: "ollama", dim: 1024 });
    const m2 = db.models.upsert({
      name: "bge-test",
      provider: "ollama",
      dim: 1024,
      active: false,
    });
    const [chunkId] = makeNoteWithChunks("dual.md", 1);
    const v1 = unitAxis(0, 1024);
    const v2 = unitAxis(1, 1024);

    db.embeddings.insertBatch([
      { chunkId: chunkId!, modelId: m1.id, vector: v1 },
      { chunkId: chunkId!, modelId: m2.id, vector: v2 },
    ]);

    // Each model's search should return the chunk for its own vector but
    // never see the other model's embedding.
    const hitsM1 = db.embeddings.searchSemantic(m1.id, v1, 5);
    expect(hitsM1.map((h) => h.chunkId)).toEqual([chunkId]);

    const hitsM2 = db.embeddings.searchSemantic(m2.id, v2, 5);
    expect(hitsM2.map((h) => h.chunkId)).toEqual([chunkId]);

    // Cross: query M1 with M2's vector — distance should be larger than
    // when querying with M1's own vector.
    const hitsCross = db.embeddings.searchSemantic(m1.id, v2, 5);
    expect(hitsCross[0]?.distance).toBeGreaterThan(hitsM1[0]!.distance);
  });
});

describe("migration 004→005 — legacy embeddings → per-model tables", () => {
  it("preserves rows from a pre-v4 DB through migration 005 (per-model layout)", () => {
    // Hand-craft a v3-shaped DB: notes/chunks/models/embeddings with one row,
    // user_version=3 — exactly what an existing v0.6.1 vault looks like.
    const db = new Database(":memory:");
    // Wipe migration-004 pre-tables; rebuild the legacy v3 table; reset
    // user_version to 3 so the migration runner replays 4, 5, 6.
    db.handle.exec("DROP TABLE IF EXISTS embeddings_1024");
    db.handle.exec("DROP TABLE IF EXISTS embeddings_768");
    db.handle.exec(`
      CREATE VIRTUAL TABLE embeddings USING vec0(
        chunk_id INTEGER PRIMARY KEY,
        model_id INTEGER NOT NULL,
        vector   FLOAT[1024]
      )
    `);
    // Migration 006 also adds body_hash to notes — rebuild notes without it
    // so the replay actually exercises migration 006 instead of crashing
    // on the duplicate column.
    db.handle.exec("DROP TABLE IF EXISTS notes");
    db.handle.exec(`
      CREATE TABLE notes (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        path          TEXT NOT NULL UNIQUE,
        content       TEXT NOT NULL,
        frontmatter   TEXT,
        title         TEXT,
        hash          TEXT NOT NULL,
        mtime         INTEGER NOT NULL,
        word_count    INTEGER,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      )
    `);
    // Seed a note via raw SQL so we exercise the legacy schema shape — the
    // NotesQueries prepared statements expect body_hash and would fail here.
    const seedNow = Date.now();
    const insertResult = db.handle
      .prepare(
        `INSERT INTO notes (path, content, frontmatter, title, hash, mtime, word_count, created_at, updated_at)
         VALUES ('legacy.md', 'x', NULL, 'legacy', 'h', 1, 1, ?, ?)`,
      )
      .run(seedNow, seedNow);
    const noteId = Number(insertResult.lastInsertRowid);

    db.handle.pragma("user_version = 3");
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
    expect(db.getSchemaVersion()).toBe(6);

    // Both legacy tables are gone:
    //   - `embeddings`         (v3) — dropped by migration 004
    //   - `embeddings_1024`    (v4) — dropped by migration 005
    // and the row was moved into the per-model table.
    for (const oldName of ["embeddings", "embeddings_1024"]) {
      const legacy = db.handle
        .prepare<[string], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(oldName);
      expect(legacy).toBeUndefined();
    }

    const newTable = `embeddings_m${model.id}_d1024`;
    const moved = db.handle
      .prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM ${newTable}`)
      .get();
    expect(moved?.c).toBe(1);

    const row = db.handle
      .prepare<[bigint], { chunk_id: number }>(
        `SELECT chunk_id FROM ${newTable} WHERE chunk_id = ?`,
      )
      .get(BigInt(chunkId!));
    expect(row?.chunk_id).toBe(chunkId);

    db.close();
  });
});
