import type BetterSqlite3 from "better-sqlite3";

export interface EmbeddingInput {
  chunkId: number;
  modelId: number;
  vector: number[];
}

export interface SemanticHit {
  chunkId: number;
  distance: number;
}

/**
 * sqlite-vec embedding store.
 *
 * Distance metric: the vec0 virtual table with `FLOAT[N]` uses L2 (Euclidean)
 * distance by default. For cosine similarity, normalize vectors to unit length
 * before insert and at query time — L2 on unit vectors is monotonically
 * equivalent to cosine distance.
 */
export class EmbeddingsQueries {
  private readonly _insert: BetterSqlite3.Statement;
  private readonly _deleteByChunk: BetterSqlite3.Statement<[bigint]>;
  private readonly _deleteByModel: BetterSqlite3.Statement<[bigint]>;
  private readonly _search: BetterSqlite3.Statement<
    [bigint, string, number],
    { chunk_id: number; distance: number }
  >;

  constructor(private readonly db: BetterSqlite3.Database) {
    this._insert = db.prepare(
      "INSERT INTO embeddings (chunk_id, model_id, vector) VALUES (?, ?, ?)",
    );
    this._deleteByChunk = db.prepare(
      "DELETE FROM embeddings WHERE chunk_id = ?",
    );
    this._deleteByModel = db.prepare(
      "DELETE FROM embeddings WHERE model_id = ?",
    );
    // KNN query — `vector MATCH ? AND k = ?` is sqlite-vec's KNN syntax.
    this._search = db.prepare<
      [bigint, string, number],
      { chunk_id: number; distance: number }
    >(
      `SELECT chunk_id, distance
       FROM embeddings
       WHERE model_id = ? AND vector MATCH ? AND k = ?
       ORDER BY distance`,
    );
  }

  insertBatch(items: EmbeddingInput[]): void {
    const tx = this.db.transaction((xs: EmbeddingInput[]) => {
      for (const x of xs) {
        // sqlite-vec vec0 metadata columns typed INTEGER are strict — JS
        // numbers bind as REAL via better-sqlite3 and get rejected with
        // "Only integers are allowed...". BigInt forces SQLite INTEGER.
        this._insert.run(
          BigInt(x.chunkId),
          BigInt(x.modelId),
          serializeVector(x.vector),
        );
      }
    });
    tx(items);
  }

  deleteByChunk(chunkId: number): void {
    this._deleteByChunk.run(BigInt(chunkId));
  }

  deleteByModel(modelId: number): void {
    this._deleteByModel.run(BigInt(modelId));
  }

  searchSemantic(
    modelId: number,
    queryVector: number[],
    topK: number,
  ): SemanticHit[] {
    const rows = this._search.all(
      // model_id is INTEGER metadata — same BigInt requirement as insert.
      BigInt(modelId),
      serializeVector(queryVector),
      topK,
    );
    return rows.map((r) => ({ chunkId: r.chunk_id, distance: r.distance }));
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
