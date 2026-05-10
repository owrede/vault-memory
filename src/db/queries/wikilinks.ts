import type BetterSqlite3 from "better-sqlite3";

export interface WikilinkInput {
  targetPath: string;
  targetNoteId: number | null;
  linkText: string | null;
  anchor: string | null;
  lineNumber: number | null;
}

export interface BacklinkRow {
  sourceNoteId: number;
  lineNumber: number | null;
  linkText: string | null;
}

export interface ForwardLinkRow {
  targetPath: string;
  targetNoteId: number | null;
  anchor: string | null;
  linkText: string | null;
}

export interface BrokenLinkRow {
  sourceNoteId: number;
  targetPath: string;
}

export class WikilinksQueries {
  private readonly _insert: BetterSqlite3.Statement;
  private readonly _deleteByNote: BetterSqlite3.Statement<[number]>;
  private readonly _backlinks: BetterSqlite3.Statement<
    [number],
    { source_note: number; line_number: number | null; link_text: string | null }
  >;
  private readonly _forward: BetterSqlite3.Statement<
    [number],
    {
      target_path: string;
      target_note: number | null;
      anchor: string | null;
      link_text: string | null;
    }
  >;
  private readonly _broken: BetterSqlite3.Statement<
    [],
    { source_note: number; target_path: string }
  >;

  constructor(private readonly db: BetterSqlite3.Database) {
    this._insert = db.prepare(`
      INSERT OR IGNORE INTO wikilinks
        (source_note, target_path, target_note, link_text, anchor, line_number)
      VALUES (@source_note, @target_path, @target_note, @link_text, @anchor, @line_number)
    `);
    this._deleteByNote = db.prepare(
      "DELETE FROM wikilinks WHERE source_note = ?",
    );
    this._backlinks = db.prepare(
      `SELECT source_note, line_number, link_text
       FROM wikilinks
       WHERE target_note = ?`,
    );
    this._forward = db.prepare(
      `SELECT target_path, target_note, anchor, link_text
       FROM wikilinks
       WHERE source_note = ?`,
    );
    this._broken = db.prepare(
      `SELECT source_note, target_path
       FROM wikilinks
       WHERE target_note IS NULL`,
    );
  }

  insertBatch(sourceNoteId: number, links: WikilinkInput[]): void {
    const tx = this.db.transaction((xs: WikilinkInput[]) => {
      for (const x of xs) {
        this._insert.run({
          source_note: sourceNoteId,
          target_path: x.targetPath,
          target_note: x.targetNoteId,
          link_text: x.linkText,
          anchor: x.anchor,
          line_number: x.lineNumber,
        });
      }
    });
    tx(links);
  }

  deleteByNote(noteId: number): number {
    return this._deleteByNote.run(noteId).changes;
  }

  getBacklinks(noteId: number): BacklinkRow[] {
    return this._backlinks.all(noteId).map((r) => ({
      sourceNoteId: r.source_note,
      lineNumber: r.line_number,
      linkText: r.link_text,
    }));
  }

  getForwardLinks(noteId: number): ForwardLinkRow[] {
    return this._forward.all(noteId).map((r) => ({
      targetPath: r.target_path,
      targetNoteId: r.target_note,
      anchor: r.anchor,
      linkText: r.link_text,
    }));
  }

  resolveBrokenLinks(): BrokenLinkRow[] {
    return this._broken.all().map((r) => ({
      sourceNoteId: r.source_note,
      targetPath: r.target_path,
    }));
  }
}
