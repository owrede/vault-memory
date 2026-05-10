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

interface DimStatements {
  insert: BetterSqlite3.Statement;
  deleteByChunk: BetterSqlite3.Statement<[bigint]>;
  deleteByModel: BetterSqlite3.Statement<[bigint]>;
  search: BetterSqlite3.Statement<
    [bigint, string, number],
    { chunk_id: number; distance: number }
  >;
}

/**
 * sqlite-vec embedding store with variable-dimension routing.
 *
 * Distance metric: vec0 with `FLOAT[N]` uses L2 (Euclidean) distance by
 * default. For cosine similarity, normalize vectors to unit length before
 * insert and at query time — L2 on unit vectors is monotonically equivalent
 * to cosine distance.
 *
 * Multi-dim routing (Phase 7b): a single vec0 virtual table is fixed to one
 * dimension at creation time. To support multiple embedding models with
 * different output dims (e.g. qwen3 @ 1024 + embeddinggemma @ 768) in the
 * same vault DB, we maintain one table per dim — `embeddings_<dim>` —
 * and route every operation via the model's registered `dim` (from the
 * `models` table). Prepared statements are cached per dim.
 *
 * The caller always passes a `modelId`; the dim is never inferred from the
 * vector length (no silent defaults) — if the model is unknown the call
 * throws.
 */
export class EmbeddingsQueries {
  private readonly stmtsByDim = new Map<number, DimStatements>();

  constructor(
    private readonly db: BetterSqlite3.Database,
    private readonly models: ModelsQueries,
  ) {}

  /**
   * Ensure an `embeddings_<dim>` virtual table exists for `dim`. Idempotent.
   * Called lazily on first use of a dim. Tables for the two commonly-used
   * dims (768, 1024) are also created by migration 004 up front.
   */
  ensureTableForDim(dim: number): void {
    if (!Number.isInteger(dim) || dim <= 0) {
      throw new Error(`Invalid embedding dim: ${dim}`);
    }
    // Schema name is derived from a validated integer — safe to interpolate.
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS embeddings_${dim} USING vec0(
         chunk_id INTEGER PRIMARY KEY,
         model_id INTEGER NOT NULL,
         vector   FLOAT[${dim}]
       )`,
    );
  }

  private dimForModel(modelId: number): number {
    const row = this.models.getById(modelId);
    if (!row) {
      throw new Error(
        `EmbeddingsQueries: model_id ${modelId} not found in models table`,
      );
    }
    return row.dim;
  }

  private getStmts(dim: number): DimStatements {
    const cached = this.stmtsByDim.get(dim);
    if (cached) return cached;

    this.ensureTableForDim(dim);
    const table = `embeddings_${dim}`;
    const stmts: DimStatements = {
      insert: this.db.prepare(
        `INSERT INTO ${table} (chunk_id, model_id, vector) VALUES (?, ?, ?)`,
      ),
      deleteByChunk: this.db.prepare(
        `DELETE FROM ${table} WHERE chunk_id = ?`,
      ),
      deleteByModel: this.db.prepare(
        `DELETE FROM ${table} WHERE model_id = ?`,
      ),
      search: this.db.prepare<
        [bigint, string, number],
        { chunk_id: number; distance: number }
      >(
        `SELECT chunk_id, distance
         FROM ${table}
         WHERE model_id = ? AND vector MATCH ? AND k = ?
         ORDER BY distance`,
      ),
    };
    this.stmtsByDim.set(dim, stmts);
    return stmts;
  }

  insertBatch(items: EmbeddingInput[]): void {
    if (items.length === 0) return;

    // Group by model_id → dim. The vast majority of real calls are
    // single-model, so the common path is a single dim group.
    const byDim = new Map<number, EmbeddingInput[]>();
    for (const x of items) {
      const dim = this.dimForModel(x.modelId);
      let bucket = byDim.get(dim);
      if (!bucket) {
        bucket = [];
        byDim.set(dim, bucket);
      }
      bucket.push(x);
    }

    const tx = this.db.transaction(() => {
      for (const [dim, xs] of byDim) {
        const stmts = this.getStmts(dim);
        for (const x of xs) {
          // sqlite-vec vec0 metadata columns typed INTEGER are strict — JS
          // numbers bind as REAL via better-sqlite3 and get rejected with
          // "Only integers are allowed...". BigInt forces SQLite INTEGER.
          stmts.insert.run(
            BigInt(x.chunkId),
            BigInt(x.modelId),
            serializeVector(x.vector),
          );
        }
      }
    });
    tx();
  }

  /**
   * Delete embeddings for a chunk. Without a known model context, we walk
   * every known dim — chunk_ids are globally unique across dim tables so
   * this is safe and idempotent. Used by note-deletion cascade.
   */
  deleteByChunk(chunkId: number): void {
    for (const dim of this.knownDims()) {
      const stmts = this.getStmts(dim);
      stmts.deleteByChunk.run(BigInt(chunkId));
    }
  }

  deleteByModel(modelId: number): void {
    const dim = this.dimForModel(modelId);
    const stmts = this.getStmts(dim);
    stmts.deleteByModel.run(BigInt(modelId));
  }

  searchSemantic(
    modelId: number,
    queryVector: number[],
    topK: number,
  ): SemanticHit[] {
    const dim = this.dimForModel(modelId);
    if (queryVector.length !== dim) {
      throw new Error(
        `searchSemantic: query vector length ${queryVector.length} ` +
          `does not match model ${modelId} dim ${dim}`,
      );
    }
    const stmts = this.getStmts(dim);
    const rows = stmts.search.all(
      // model_id is INTEGER metadata — same BigInt requirement as insert.
      BigInt(modelId),
      serializeVector(queryVector),
      topK,
    );
    return rows.map((r) => ({ chunkId: r.chunk_id, distance: r.distance }));
  }

  /**
   * Discover every `embeddings_<dim>` table currently in the schema. Used
   * by deleteByChunk where the caller doesn't know which dim the chunk
   * lives under.
   */
  private knownDims(): number[] {
    const rows = this.db
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name LIKE 'embeddings\\_%' ESCAPE '\\'`,
      )
      .all();
    const dims: number[] = [];
    for (const r of rows) {
      const m = /^embeddings_(\d+)$/.exec(r.name);
      if (m && m[1]) dims.push(Number(m[1]));
    }
    return dims;
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
