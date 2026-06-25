/**
 * BriefSourcesQueries — Phase 5 / BRF-* / D-06 reverse-index substrate.
 *
 * Mirrors `src/db/queries/wikilinks.ts` verbatim in structure. Populated
 * when a brief is written via `compile_brief` (one row per chunk in the
 * brief's `source_hashes` map) and removed when the brief is
 * deleted/superseded.
 *
 * UPSERT discipline: `INSERT OR IGNORE` against
 * `UNIQUE(brief_doc_id, chunk_id_fragment)` makes re-population on a
 * partial-state recompile idempotent.
 *
 * Staleness check on a `ChangeEvent` for `doc_id D`:
 *   SELECT brief_doc_id FROM brief_sources
 *    WHERE chunk_doc_id = D
 *      AND recorded_hash != <current chunk hash>
 * → O(log N) lookup instead of O(B·S) scan of every brief's
 * `source_hashes` property.
 *
 * Adapter-seam discipline: no `fs`/`path`/`gray-matter`/`chokidar`
 * imports. `scripts/lint-adapters.sh` enforces.
 */

import type BetterSqlite3 from "better-sqlite3";

export interface BriefSourceInput {
  /** First 7 hex chars of the chunk's content hash (D-04 / D-05). */
  chunkIdFragment: string;
  /** DocId of the document containing the cited chunk. */
  chunkDocId: string;
  /** Full hash recorded at brief-compile time (`"sha256:<hex>"`). */
  recordedHash: string;
}

export interface BriefSourceRow {
  briefDocId: string;
  chunkIdFragment: string;
  chunkDocId: string;
  recordedHash: string;
}

export class BriefSourcesQueries {
  private readonly _insert: BetterSqlite3.Statement;
  private readonly _deleteByBrief: BetterSqlite3.Statement<[string]>;
  private readonly _listBriefDocIds: BetterSqlite3.Statement<[], { brief_doc_id: string }>;
  private readonly _briefsForChunkDoc: BetterSqlite3.Statement<
    [string],
    {
      brief_doc_id: string;
      chunk_id_fragment: string;
      chunk_doc_id: string;
      recorded_hash: string;
    }
  >;
  private readonly _sourcesForBrief: BetterSqlite3.Statement<
    [string],
    {
      brief_doc_id: string;
      chunk_id_fragment: string;
      chunk_doc_id: string;
      recorded_hash: string;
    }
  >;

  constructor(private readonly db: BetterSqlite3.Database) {
    this._insert = db.prepare(`
      INSERT OR IGNORE INTO brief_sources
        (brief_doc_id, chunk_id_fragment, chunk_doc_id, recorded_hash)
      VALUES (@brief_doc_id, @chunk_id_fragment, @chunk_doc_id, @recorded_hash)
    `);
    this._deleteByBrief = db.prepare("DELETE FROM brief_sources WHERE brief_doc_id = ?");
    this._listBriefDocIds = db.prepare("SELECT DISTINCT brief_doc_id FROM brief_sources");
    this._briefsForChunkDoc = db.prepare(
      `SELECT brief_doc_id, chunk_id_fragment, chunk_doc_id, recorded_hash
         FROM brief_sources
        WHERE chunk_doc_id = ?`,
    );
    this._sourcesForBrief = db.prepare(
      `SELECT brief_doc_id, chunk_id_fragment, chunk_doc_id, recorded_hash
         FROM brief_sources
        WHERE brief_doc_id = ?`,
    );
  }

  /**
   * Batch insert. Idempotent: `INSERT OR IGNORE` against the UNIQUE
   * `(brief_doc_id, chunk_id_fragment)` constraint means re-running the
   * same batch is a no-op. Mirrors `WikilinksQueries.insertBatch`
   * (`wikilinks.ts:74-87`).
   */
  insertBatch(briefDocId: string, sources: BriefSourceInput[]): void {
    const tx = this.db.transaction((xs: BriefSourceInput[]) => {
      for (const x of xs) {
        this._insert.run({
          brief_doc_id: briefDocId,
          chunk_id_fragment: x.chunkIdFragment,
          chunk_doc_id: x.chunkDocId,
          recorded_hash: x.recordedHash,
        });
      }
    });
    tx(sources);
  }

  deleteByBrief(briefDocId: string): number {
    return this._deleteByBrief.run(briefDocId).changes;
  }

  listBriefDocIds(): string[] {
    return this._listBriefDocIds.all().map((r) => r.brief_doc_id);
  }

  briefsForChunkDoc(chunkDocId: string): BriefSourceRow[] {
    return this._briefsForChunkDoc.all(chunkDocId).map((r) => ({
      briefDocId: r.brief_doc_id,
      chunkIdFragment: r.chunk_id_fragment,
      chunkDocId: r.chunk_doc_id,
      recordedHash: r.recorded_hash,
    }));
  }

  sourcesForBrief(briefDocId: string): BriefSourceRow[] {
    return this._sourcesForBrief.all(briefDocId).map((r) => ({
      briefDocId: r.brief_doc_id,
      chunkIdFragment: r.chunk_id_fragment,
      chunkDocId: r.chunk_doc_id,
      recordedHash: r.recorded_hash,
    }));
  }
}
