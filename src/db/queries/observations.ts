import type BetterSqlite3 from "better-sqlite3";
import type { ObservationDraft } from "../../observations/parse.js";
export interface ObservationRow extends ObservationDraft {
  id: number;
  note_id: number;
  doc_hash: string;
}
export class ObservationQueries {
  constructor(private readonly db: BetterSqlite3.Database) {}
  replaceForNote(noteId: number, docHash: string, rows: ObservationDraft[]): void {
    if (!docHash.length) throw new TypeError("docHash must be nonempty");
    for (const row of rows) {
      if (!Number.isSafeInteger(row.line_start) || !Number.isSafeInteger(row.line_end))
        throw new RangeError("Source lines must be integers");
    }
    const key = (row: ObservationDraft) =>
      JSON.stringify([row.category, row.text, row.line_start, row.line_end]);
    this.db.transaction(() => {
      const previous = new Map(this.listForNote(noteId).map((row) => [key(row), row.id]));
      this.db.prepare("DELETE FROM observations WHERE note_id = ?").run(noteId);
      const insert = this.db
        .prepare(`INSERT INTO observations(id, note_id, doc_hash, category, text, line_start, line_end)
        VALUES(@id, @note_id, @doc_hash, @category, @text, @line_start, @line_end)`);
      for (const row of rows)
        insert.run({
          ...row,
          id: previous.get(key(row)) ?? null,
          note_id: noteId,
          doc_hash: docHash,
        });
      const updated = this.db
        .prepare("UPDATE notes SET observations_hash = ? WHERE id = ?")
        .run(docHash, noteId);
      if (updated.changes !== 1) throw new Error("Unknown observation source note");
    })();
  }
  listForNote(noteId: number, category?: string): ObservationRow[] {
    return category === undefined
      ? this.db
          .prepare<[number], ObservationRow>(
            "SELECT * FROM observations WHERE note_id = ? ORDER BY line_start, line_end, id",
          )
          .all(noteId)
      : this.db
          .prepare<[number, string], ObservationRow>(
            "SELECT * FROM observations WHERE note_id = ? AND category = ? ORDER BY line_start, line_end, id",
          )
          .all(noteId, category);
  }
  indexedHash(noteId: number): string | null {
    return (
      this.db
        .prepare<[number], { observations_hash: string | null }>(
          "SELECT observations_hash FROM notes WHERE id = ?",
        )
        .get(noteId)?.observations_hash ?? null
    );
  }
}
