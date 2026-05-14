import type BetterSqlite3 from "better-sqlite3";
import type { ChunkRow } from "../../types.js";

export interface ChunkInput {
  idx: number;
  text: string;
  headingPath: string | null;
  startOffset: number;
  endOffset: number;
  tokenCount: number;
}

export class ChunksQueries {
  private readonly _insert: BetterSqlite3.Statement;
  private readonly _deleteByNote: BetterSqlite3.Statement<[number]>;
  private readonly _getByNote: BetterSqlite3.Statement<[number], ChunkRow>;
  private readonly _getById: BetterSqlite3.Statement<[number], ChunkRow>;

  constructor(private readonly db: BetterSqlite3.Database) {
    this._insert = db.prepare(`
      INSERT INTO chunks (note_id, idx, text, heading_path, start_offset, end_offset, token_count)
      VALUES (@note_id, @idx, @text, @heading_path, @start_offset, @end_offset, @token_count)
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
