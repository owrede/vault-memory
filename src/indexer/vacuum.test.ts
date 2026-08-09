/**
 * vacuum_embeddings tests.
 *
 * Verifies that orphaned embedding rows (chunk_id not in chunks table)
 * are removed without touching live rows.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "../db/index.js";
import type { Vault } from "../vault/index.js";
import { vacuumEmbeddings } from "./vacuum.js";

function makeVault(): Vault {
  const db = new Database(":memory:", "test-vault");
  return {
    config: { name: "test", path: "/tmp/dummy" },
    db,
    dbPath: ":memory:",
  };
}

function unit(axis: number, dim: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[axis] = 1;
  return v;
}

describe("vacuumEmbeddings", () => {
  let vault: Vault;

  beforeEach(() => {
    vault = makeVault();
  });

  afterEach(() => {
    vault.db.close();
  });

  function makeChunks(notePath: string, n: number): number[] {
    const { id: noteId } = vault.db.notes.upsertByPath({
      path: notePath,
      content: "x",
      frontmatter: null,
      title: notePath,
      hash: `h-${notePath}`,
      mtime: 1,
      wordCount: 1,
    });
    return vault.db.chunks.insertBatch(
      noteId,
      Array.from({ length: n }, (_, i) => ({
        idx: i,
        text: `chunk-${i}`,
        headingPath: null,
        startOffset: 0,
        endOffset: 1,
        tokenCount: 1,
      })),
    );
  }

  it("no-op when there are no orphans", () => {
    const model = vault.db.models.upsert({
      name: "m1",
      provider: "ollama",
      dim: 1024,
    });
    const chunkIds = makeChunks("a.md", 3);
    vault.db.embeddings.insertBatch(
      chunkIds.map((id, i) => ({
        chunkId: id,
        modelId: model.id,
        vector: unit(i, 1024),
      })),
    );

    const result = vacuumEmbeddings(vault);
    expect(result.total_removed).toBe(0);
    expect(result.per_model).toHaveLength(1);
    expect(result.per_model[0]?.kept).toBe(3);
    expect(result.per_model[0]?.removed).toBe(0);
  });

  it("removes orphans whose chunk_id no longer exists", () => {
    const model = vault.db.models.upsert({
      name: "m1",
      provider: "ollama",
      dim: 1024,
    });
    const chunkIds = makeChunks("a.md", 3);
    vault.db.embeddings.insertBatch(
      chunkIds.map((id, i) => ({
        chunkId: id,
        modelId: model.id,
        vector: unit(i, 1024),
      })),
    );

    // Delete one chunk directly — embeddings table is not cascaded for the
    // pre-v0.7.0 schema; that's exactly the orphan case vacuum targets.
    const orphanedChunkId = chunkIds[1]!;
    vault.db.handle.prepare("DELETE FROM chunks WHERE id = ?").run(BigInt(orphanedChunkId));

    const result = vacuumEmbeddings(vault);
    expect(result.total_removed).toBe(1);
    expect(result.per_model[0]?.removed).toBe(1);
    expect(result.per_model[0]?.kept).toBe(2);

    const remaining = vault.db.handle
      .prepare<[], { chunk_id: number }>(
        `SELECT chunk_id FROM embeddings_m${model.id}_d1024 ORDER BY chunk_id`,
      )
      .all();
    expect(remaining.map((r) => r.chunk_id)).toEqual(
      chunkIds.filter((id) => id !== orphanedChunkId),
    );
  });

  it("walks every per-model table independently", () => {
    const m1 = vault.db.models.upsert({
      name: "m-a",
      provider: "ollama",
      dim: 1024,
    });
    const m2 = vault.db.models.upsert({
      name: "m-b",
      provider: "ollama",
      dim: 768,
      active: false,
    });
    const chunkIds = makeChunks("a.md", 2);

    vault.db.embeddings.insertBatch([
      { chunkId: chunkIds[0]!, modelId: m1.id, vector: unit(0, 1024) },
      { chunkId: chunkIds[1]!, modelId: m1.id, vector: unit(1, 1024) },
      { chunkId: chunkIds[0]!, modelId: m2.id, vector: unit(0, 768) },
    ]);

    // Drop both chunks → all 3 embeddings are now orphaned.
    vault.db.handle.prepare("DELETE FROM chunks WHERE id = ?").run(BigInt(chunkIds[0]!));
    vault.db.handle.prepare("DELETE FROM chunks WHERE id = ?").run(BigInt(chunkIds[1]!));

    const result = vacuumEmbeddings(vault);
    expect(result.total_removed).toBe(3);
    expect(result.per_model).toHaveLength(2);
    const byModel = new Map(result.per_model.map((p) => [p.model_id, p]));
    expect(byModel.get(m1.id)?.removed).toBe(2);
    expect(byModel.get(m2.id)?.removed).toBe(1);
  });

  it("is idempotent — second call removes nothing", () => {
    const model = vault.db.models.upsert({
      name: "m1",
      provider: "ollama",
      dim: 1024,
    });
    const chunkIds = makeChunks("a.md", 2);
    vault.db.embeddings.insertBatch(
      chunkIds.map((id, i) => ({
        chunkId: id,
        modelId: model.id,
        vector: unit(i, 1024),
      })),
    );
    vault.db.handle.prepare("DELETE FROM chunks WHERE id = ?").run(BigInt(chunkIds[0]!));

    expect(vacuumEmbeddings(vault).total_removed).toBe(1);
    expect(vacuumEmbeddings(vault).total_removed).toBe(0);
  });

  it("handles a model with no embeddings yet (shadow not started)", () => {
    vault.db.models.upsert({
      name: "shadow-only",
      provider: "ollama",
      dim: 1024,
      active: false,
    });
    // No chunks, no embeddings.
    const result = vacuumEmbeddings(vault);
    expect(result.total_removed).toBe(0);
    expect(result.per_model[0]?.kept).toBe(0);
    expect(result.per_model[0]?.removed).toBe(0);
  });
});
