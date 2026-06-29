import type BetterSqlite3 from "better-sqlite3";
import type { InsertSectionRow, SectionRow } from "../../types.js";

/**
 * Phase 3 — `sections` table query namespace (migration 010).
 *
 * Mirrors the `ChunksQueries` (`src/db/queries/chunks.ts`) shape:
 *   - Prepared statements held as private fields.
 *   - `insertMany` batches in a single transaction for amortized cost.
 *   - `deleteByNote` matches the chunker's re-index pattern.
 *
 * `parent_id` is the FK pointer derived at insert time from
 * `SectionInfo.parent_index` (an array index) — the caller maps
 * indices → IDs after each row gets its `lastInsertRowid`.
 *
 * `heading_path` is stored as JSON-stringified text (so callers see
 * the storage shape explicitly at the call site).
 */
export class SectionsQueries {
  private readonly _insert: BetterSqlite3.Statement;
  private readonly _deleteByNote: BetterSqlite3.Statement<[number]>;
  private readonly _getByNote: BetterSqlite3.Statement<[number], SectionRow>;
  private readonly _getByAnchor: BetterSqlite3.Statement<[number, string], SectionRow>;
  private readonly _getByIdentity: BetterSqlite3.Statement<[number, string, string], SectionRow>;
  private readonly _findContainingChunk: BetterSqlite3.Statement<
    [number, number, number],
    SectionRow
  >;
  private readonly _countByNote: BetterSqlite3.Statement<[number], { c: number }>;

  constructor(private readonly db: BetterSqlite3.Database) {
    // INSERT OR IGNORE: section identity is (note_id, heading_path, anchor)
    // per ADR-032 (revised). Two sibling sections only collide when they are
    // byte-identical (same anchor) AND in the same context (same heading_path)
    // — i.e. genuinely duplicated content in one place. Differently-placed
    // byte-identical sections (e.g. `Q1 > Risks` vs `Q2 > Risks` with the same
    // body) have different heading_path → distinct rows. `OR IGNORE` makes the
    // first sibling win on a true same-context collision; callers needing the
    // surviving id for parent linkage use `insertOneResolving`. Mirrors
    // src/sections/backfill.ts.
    this._insert = db.prepare(`
      INSERT OR IGNORE INTO sections
        (note_id, anchor, heading_path, heading_text, level,
         parent_id, ord, chunk_id_first, chunk_id_last, created_at)
      VALUES
        (@note_id, @anchor, @heading_path, @heading_text, @level,
         @parent_id, @ord, @chunk_id_first, @chunk_id_last, @created_at)
    `);
    this._deleteByNote = db.prepare("DELETE FROM sections WHERE note_id = ?");
    this._getByNote = db.prepare<[number], SectionRow>(
      // parent_id ASC NULLS FIRST lets callers build the tree top-down
      // in one pass. SQLite NULLs sort first by default for ASC.
      "SELECT * FROM sections WHERE note_id = ? ORDER BY parent_id IS NULL DESC, parent_id ASC, ord ASC",
    );
    this._getByAnchor = db.prepare<[number, string], SectionRow>(
      "SELECT * FROM sections WHERE note_id = ? AND anchor = ?",
    );
    // Collision resolution keys on the FULL identity (note_id, heading_path,
    // anchor) so insertOneResolving finds the exact surviving row, not just
    // any same-anchor sibling in a different context.
    this._getByIdentity = db.prepare<[number, string, string], SectionRow>(
      "SELECT * FROM sections WHERE note_id = ? AND heading_path = ? AND anchor = ?",
    );
    this._findContainingChunk = db.prepare<[number, number], SectionRow>(
      // `chunk_id` is monotonically increasing per note; chunk_id_first
      // and chunk_id_last carve disjoint ranges (or both NULL for a
      // heading with no body content). We require both range bounds
      // to be NON-NULL — sections with NULL ranges contain zero chunks.
      `SELECT * FROM sections
         WHERE note_id = ?
           AND chunk_id_first IS NOT NULL
           AND chunk_id_last IS NOT NULL
           AND chunk_id_first <= ?
           AND chunk_id_last  >= ?
         ORDER BY (chunk_id_last - chunk_id_first) ASC
         LIMIT 1`,
    );
    this._countByNote = db.prepare<[number], { c: number }>(
      "SELECT COUNT(*) AS c FROM sections WHERE note_id = ?",
    );
  }

  /**
   * Batch insert. Returns the new `id` for each row in the same order
   * as the input. The transaction wraps the whole batch so a mid-batch
   * failure rolls back cleanly.
   */
  insertMany(rows: InsertSectionRow[]): number[] {
    if (rows.length === 0) return [];
    const ids: number[] = [];
    const now = Date.now();
    const tx = this.db.transaction((rs: InsertSectionRow[]) => {
      for (const r of rs) {
        const info = this._insert.run({
          note_id: r.note_id,
          anchor: r.anchor,
          heading_path: r.heading_path,
          heading_text: r.heading_text,
          level: r.level,
          parent_id: r.parent_id,
          ord: r.ord,
          chunk_id_first: r.chunk_id_first,
          chunk_id_last: r.chunk_id_last,
          created_at: now,
        });
        ids.push(Number(info.lastInsertRowid));
      }
    });
    tx(rows);
    return ids;
  }

  /**
   * Insert one section, collision-safe. Returns the id of the row that now
   * owns the identity (note_id, heading_path, anchor): the freshly inserted
   * row, or — when a same-context byte-identical sibling already won the
   * unique slot — that surviving row's id (so callers can resolve parent_id
   * linkage). Per ADR-032 (revised), a collision now requires BOTH same anchor
   * AND same heading_path, so differently-placed identical sections persist as
   * distinct rows. Mirrors src/sections/backfill.ts. The live indexer uses
   * this instead of `insertMany` so duplicate sibling headings can't abort the
   * whole index run (see ISSUE-indexer-duplicate-anchor.md).
   */
  insertOneResolving(r: InsertSectionRow): number | null {
    const info = this._insert.run({
      note_id: r.note_id,
      anchor: r.anchor,
      heading_path: r.heading_path,
      heading_text: r.heading_text,
      level: r.level,
      parent_id: r.parent_id,
      ord: r.ord,
      chunk_id_first: r.chunk_id_first,
      chunk_id_last: r.chunk_id_last,
      created_at: Date.now(),
    });
    if (info.changes > 0) return Number(info.lastInsertRowid);
    // Collision on UNIQUE(note_id, heading_path, anchor): reuse the surviving
    // row's id. Look up by the full identity so we get the exact row, not a
    // same-anchor sibling that lives under a different heading_path.
    const existing = this._getByIdentity.get(r.note_id, r.heading_path, r.anchor);
    return existing ? Number(existing.id) : null;
  }

  deleteByNote(noteId: number): number {
    return this._deleteByNote.run(noteId).changes;
  }

  /**
   * Returns all sections for the note in tree order: top-level rows
   * (parent_id IS NULL) first, then deeper rows; within the same
   * parent, ord ASC.
   */
  getByNote(noteId: number): SectionRow[] {
    return this._getByNote.all(noteId);
  }

  getByAnchor(noteId: number, anchor: string): SectionRow | null {
    return this._getByAnchor.get(noteId, anchor) ?? null;
  }

  /**
   * Return the most-specific section whose chunk range contains
   * `chunkId`. "Most specific" = smallest range (innermost section).
   */
  findContainingChunk(noteId: number, chunkId: number): SectionRow | null {
    return this._findContainingChunk.get(noteId, chunkId, chunkId) ?? null;
  }

  countByNote(noteId: number): number {
    return this._countByNote.get(noteId)?.c ?? 0;
  }
}
