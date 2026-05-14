import type BetterSqlite3 from "better-sqlite3";

import type { ModelsQueries } from "./models.js";

export interface EmbeddingInput {
  chunkId: number;
  modelId: number;
  vector: number[];
}

export interface SemanticHit {
  chunkId: number;
  distance: number;
}

interface ModelStatements {
  insert: BetterSqlite3.Statement;
  deleteByChunk: BetterSqlite3.Statement<[bigint]>;
  deleteAll: BetterSqlite3.Statement;
  search: BetterSqlite3.Statement<[string, number], { chunk_id: number; distance: number }>;
}

/**
 * sqlite-vec embedding store with one vec0 table per (modelId, dim).
 *
 * Distance metric: vec0 with `FLOAT[N]` uses L2 (Euclidean) distance by
 * default. For cosine similarity, normalize vectors to unit length before
 * insert and at query time — L2 on unit vectors is monotonically equivalent
 * to cosine distance.
 *
 * Layout history:
 *   - v1..v3: one global `embeddings(FLOAT[1024])` table.
 *   - v4 (Phase 7b): per-dim tables `embeddings_<dim>` so two models with
 *     DIFFERENT dims could coexist.
 *   - v5 (Phase 7e bugfix): per-MODEL tables `embeddings_m<modelId>_d<dim>`
 *     so two models with the SAME dim (e.g. qwen3 + bge-m3, both 1024)
 *     can ALSO coexist. The earlier `partition key` attempt turned out
 *     not to give us a composite primary key.
 *
 * The caller always passes a `modelId`; the dim is looked up from the
 * `models` table — never inferred from the vector length. Unknown model
 * throws (no silent defaults).
 */
export class EmbeddingsQueries {
  private readonly stmtsByModel = new Map<number, ModelStatements>();

  constructor(
    private readonly db: BetterSqlite3.Database,
    private readonly models: ModelsQueries,
  ) {}

  private tableName(modelId: number, dim: number): string {
    return `embeddings_m${modelId}_d${dim}`;
  }

  /**
   * Ensure the vec0 table for this model exists. Idempotent. Called lazily
   * on first use of a model. Tables for an existing pre-v5 dataset are
   * materialized by migration 005.
   */
  ensureTableForModel(modelId: number, dim: number): void {
    if (!Number.isInteger(modelId) || modelId <= 0) {
      throw new Error(`Invalid modelId: ${modelId}`);
    }
    if (!Number.isInteger(dim) || dim <= 0) {
      throw new Error(`Invalid embedding dim: ${dim}`);
    }
    const table = this.tableName(modelId, dim);
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING vec0(
         chunk_id INTEGER PRIMARY KEY,
         vector   FLOAT[${dim}]
       )`,
    );
  }

  private dimForModel(modelId: number): number {
    const row = this.models.getById(modelId);
    if (!row) {
      throw new Error(`EmbeddingsQueries: model_id ${modelId} not found in models table`);
    }
    return row.dim;
  }

  private getStmts(modelId: number): ModelStatements {
    const cached = this.stmtsByModel.get(modelId);
    if (cached) return cached;

    const dim = this.dimForModel(modelId);
    this.ensureTableForModel(modelId, dim);
    const table = this.tableName(modelId, dim);
    const stmts: ModelStatements = {
      insert: this.db.prepare(`INSERT INTO ${table} (chunk_id, vector) VALUES (?, ?)`),
      deleteByChunk: this.db.prepare(`DELETE FROM ${table} WHERE chunk_id = ?`),
      deleteAll: this.db.prepare(`DELETE FROM ${table}`),
      search: this.db.prepare<[string, number], { chunk_id: number; distance: number }>(
        `SELECT chunk_id, distance
         FROM ${table}
         WHERE vector MATCH ? AND k = ?
         ORDER BY distance`,
      ),
    };
    this.stmtsByModel.set(modelId, stmts);
    return stmts;
  }

  insertBatch(items: EmbeddingInput[]): void {
    if (items.length === 0) return;

    // Group by model_id so each batch hits one prepared statement.
    const byModel = new Map<number, EmbeddingInput[]>();
    for (const x of items) {
      let bucket = byModel.get(x.modelId);
      if (!bucket) {
        bucket = [];
        byModel.set(x.modelId, bucket);
      }
      bucket.push(x);
    }

    const tx = this.db.transaction(() => {
      for (const [modelId, xs] of byModel) {
        const stmts = this.getStmts(modelId);
        for (const x of xs) {
          // sqlite-vec vec0 INTEGER PK is strict — BigInt forces SQLite
          // INTEGER instead of REAL.
          stmts.insert.run(BigInt(x.chunkId), serializeVector(x.vector));
        }
      }
    });
    tx();
  }

  /**
   * Delete embeddings for a chunk across every registered model — the
   * caller doesn't track which models embedded the chunk.
   */
  deleteByChunk(chunkId: number): void {
    for (const modelId of this.registeredModelIds()) {
      const stmts = this.getStmts(modelId);
      stmts.deleteByChunk.run(BigInt(chunkId));
    }
  }

  /**
   * Wipe every embedding row for the given model. Cheap because each
   * model owns its own table — equivalent to `DELETE FROM table`.
   */
  deleteByModel(modelId: number): void {
    const stmts = this.getStmts(modelId);
    stmts.deleteAll.run();
  }

  searchSemantic(modelId: number, queryVector: number[], topK: number): SemanticHit[] {
    const dim = this.dimForModel(modelId);
    if (queryVector.length !== dim) {
      throw new Error(
        `searchSemantic: query vector length ${queryVector.length} ` +
          `does not match model ${modelId} dim ${dim}`,
      );
    }
    const stmts = this.getStmts(modelId);
    const rows = stmts.search.all(serializeVector(queryVector), topK);
    return rows.map((r) => ({ chunkId: r.chunk_id, distance: r.distance }));
  }

  /**
   * Every model_id with a materialized embeddings table. Read from the
   * model registry — every model that has ever been inserted-into has
   * its table created via `ensureTableForModel`.
   */
  private registeredModelIds(): number[] {
    return this.models.listAll().map((m) => m.id);
  }
}

/**
 * sqlite-vec accepts vectors as JSON arrays of numbers (text) or as raw
 * little-endian Float32 BLOBs. JSON is simplest and fast enough for our
 * scale; switch to Float32Array.buffer if profiling demands it.
 */
function serializeVector(v: number[]): string {
  return JSON.stringify(v);
}
