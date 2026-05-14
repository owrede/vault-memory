/**
 * AliasesQueries — note_aliases CRUD + lookup by alias.
 *
 * Case-insensitive matching: `alias_norm` is `alias.trim().toLowerCase()`.
 * Stored separately from the raw alias so display retains the original.
 */

import type BetterSqlite3 from "better-sqlite3";

export interface AliasResolveHit {
  note_id: number;
  path: string;
  alias: string; // original-case
}

export class AliasesQueries {
  private readonly setStmt: BetterSqlite3.Statement<[number, string, string]>;
  private readonly deleteStmt: BetterSqlite3.Statement<[number]>;
  private readonly listForNoteStmt: BetterSqlite3.Statement<[number]>;
  private readonly resolveStmt: BetterSqlite3.Statement<[string]>;

  constructor(db: BetterSqlite3.Database) {
    this.setStmt = db.prepare(
      `INSERT OR IGNORE INTO note_aliases (note_id, alias, alias_norm)
       VALUES (?, ?, ?)`,
    );
    this.deleteStmt = db.prepare(`DELETE FROM note_aliases WHERE note_id = ?`);
    this.listForNoteStmt = db.prepare(
      `SELECT alias FROM note_aliases WHERE note_id = ? ORDER BY id ASC`,
    );
    this.resolveStmt = db.prepare(
      `SELECT na.note_id AS note_id, n.path AS path, na.alias AS alias
       FROM note_aliases na
       JOIN notes n ON n.id = na.note_id
       WHERE na.alias_norm = ?
       ORDER BY length(n.path) ASC
       LIMIT 1`,
    );
  }

  /**
   * Replace all aliases for a note with the given list (atomic).
   * Empty list → clears all aliases for the note.
   */
  setForNote(noteId: number, aliases: readonly string[]): void {
    this.deleteStmt.run(noteId);
    for (const a of aliases) {
      const trimmed = a.trim();
      if (trimmed.length === 0) continue;
      this.setStmt.run(noteId, trimmed, AliasesQueries.normalize(trimmed));
    }
  }

  /**
   * Find the note that owns the given alias (case-insensitive).
   * If multiple notes claim the same alias, the one with the shortest
   * path wins (mirrors Obsidian's heuristic).
   */
  resolve(alias: string): AliasResolveHit | null {
    const norm = AliasesQueries.normalize(alias);
    if (norm.length === 0) return null;
    return (this.resolveStmt.get(norm) as AliasResolveHit | undefined) ?? null;
  }

  listForNote(noteId: number): string[] {
    const rows = this.listForNoteStmt.all(noteId) as Array<{ alias: string }>;
    return rows.map((r) => r.alias);
  }

  static normalize(alias: string): string {
    return alias.trim().toLowerCase();
  }
}
