import type BetterSqlite3 from "better-sqlite3";
import type { ChunkRow } from "../../types.js";
import { computeChunkIdFragment } from "../../chunker/chunk-id.js";

export interface ChunkInput {
  idx: number;
  text: string;
  headingPath: string | null;
  startOffset: number;
  endOffset: number;
  tokenCount: number;
  /**
   * Phase 5 / D-04 / D-05: content-stable chunk identity fragment.
   * First 7 hex chars of `sha256(NFC(LF-normalized, trimEnd(text)))`.
   *
   * Optional at the type level so existing test fixtures and lightweight
   * call sites can omit it; when omitted, `insertBatch` computes it via
   * the canonical helper (`src/chunker/chunk-id.ts`). Production call
   * sites (indexer, single-indexer) pass an explicit value, which is the
   * preferred path — keeping the helper as the single source of truth
   * (RESEARCH §Pitfall 14: scattered createHash calls are forbidden).
   */
  chunkIdFragment?: string;
}

export class ChunksQueries {
  private readonly _insert: BetterSqlite3.Statement;
  private readonly _deleteByNote: BetterSqlite3.Statement<[number]>;
  private readonly _getByNote: BetterSqlite3.Statement<[number], ChunkRow>;
  private readonly _getById: BetterSqlite3.Statement<[number], ChunkRow>;

  constructor(private readonly db: BetterSqlite3.Database) {
    this._insert = db.prepare(`
      INSERT INTO chunks (note_id, idx, text, heading_path, start_offset, end_offset, token_count, chunk_id_fragment)
      VALUES (@note_id, @idx, @text, @heading_path, @start_offset, @end_offset, @token_count, @chunk_id_fragment)
    `);
    this._deleteByNote = db.prepare("DELETE FROM chunks WHERE note_id = ?");
    this._getByNote = db.prepare<[number], ChunkRow>(
      "SELECT * FROM chunks WHERE note_id = ? ORDER BY idx",
    );
    this._getById = db.prepare<[number], ChunkRow>("SELECT * FROM chunks WHERE id = ?");
  }

  insertBatch(noteId: number, chunks: ChunkInput[]): number[] {
    const ids: number[] = [];
    const tx = this.db.transaction((cs: ChunkInput[]) => {
      for (const c of cs) {
        const info = this._insert.run({
          note_id: noteId,
          idx: c.idx,
          text: c.text,
          heading_path: c.headingPath,
          start_offset: c.startOffset,
          end_offset: c.endOffset,
          token_count: c.tokenCount,
          // Phase 5 / D-04 / D-05: prefer the caller-supplied fragment
          // (production path: chunker computed it once). Fall back to
          // the canonical helper for legacy / test-only call sites that
          // pre-date the field. The helper is the single source of
          // truth — there is no other place in the codebase that
          // computes `chunk_id_fragment`.
          chunk_id_fragment: c.chunkIdFragment ?? computeChunkIdFragment(c.text),
        });
        ids.push(Number(info.lastInsertRowid));
      }
    });
    tx(chunks);
    return ids;
  }

  deleteByNote(noteId: number): number {
    return this._deleteByNote.run(noteId).changes;
  }

  getByNote(noteId: number): ChunkRow[] {
    return this._getByNote.all(noteId);
  }

  getById(id: number): ChunkRow | null {
    return this._getById.get(id) ?? null;
  }
}
