import type BetterSqlite3 from "better-sqlite3";
import type { NoteRow } from "../../types.js";

export interface UpsertNoteInput {
  path: string;
  content: string;
  frontmatter: string | null;
  title: string;
  hash: string;
  mtime: number;
  wordCount: number;
}

export class NotesQueries {
  private readonly _selectByPath: BetterSqlite3.Statement<[string], NoteRow>;
  private readonly _selectById: BetterSqlite3.Statement<[number], NoteRow>;
  private readonly _insert: BetterSqlite3.Statement;
  private readonly _update: BetterSqlite3.Statement;
  private readonly _delete: BetterSqlite3.Statement<[string]>;
  private readonly _listAll: BetterSqlite3.Statement<[number, number], NoteRow>;
  private readonly _count: BetterSqlite3.Statement<[], { c: number }>;

  constructor(private readonly db: BetterSqlite3.Database) {
    this._selectByPath = db.prepare<[string], NoteRow>(
      "SELECT * FROM notes WHERE path = ?",
    );
    this._selectById = db.prepare<[number], NoteRow>(
      "SELECT * FROM notes WHERE id = ?",
    );
    this._insert = db.prepare(`
      INSERT INTO notes (path, content, frontmatter, title, hash, mtime, word_count, created_at, updated_at)
      VALUES (@path, @content, @frontmatter, @title, @hash, @mtime, @word_count, @now, @now)
    `);
    this._update = db.prepare(`
      UPDATE notes
      SET content = @content,
          frontmatter = @frontmatter,
          title = @title,
          hash = @hash,
          mtime = @mtime,
          word_count = @word_count,
          updated_at = @now
      WHERE id = @id
    `);
    this._delete = db.prepare("DELETE FROM notes WHERE path = ?");
    this._listAll = db.prepare<[number, number], NoteRow>(
      "SELECT * FROM notes ORDER BY id LIMIT ? OFFSET ?",
    );
    this._count = db.prepare<[], { c: number }>(
      "SELECT COUNT(*) AS c FROM notes",
    );
  }

  upsertByPath(input: UpsertNoteInput): { id: number; isNew: boolean } {
    const existing = this._selectByPath.get(input.path);
    const now = Date.now();
    if (existing) {
      if (existing.hash === input.hash) {
        return { id: existing.id, isNew: false };
      }
      this._update.run({
        id: existing.id,
        content: input.content,
        frontmatter: input.frontmatter,
        title: input.title,
        hash: input.hash,
        mtime: input.mtime,
        word_count: input.wordCount,
        now,
      });
      return { id: existing.id, isNew: false };
    }
    const info = this._insert.run({
      path: input.path,
      content: input.content,
      frontmatter: input.frontmatter,
      title: input.title,
      hash: input.hash,
      mtime: input.mtime,
      word_count: input.wordCount,
      now,
    });
    return { id: Number(info.lastInsertRowid), isNew: true };
  }

  getById(id: number): NoteRow | null {
    return this._selectById.get(id) ?? null;
  }

  getByPath(path: string): NoteRow | null {
    return this._selectByPath.get(path) ?? null;
  }

  deleteByPath(path: string): boolean {
    const info = this._delete.run(path);
    return info.changes > 0;
  }

  listAll(limit = 1000, offset = 0): NoteRow[] {
    return this._listAll.all(limit, offset);
  }

  countAll(): number {
    const row = this._count.get();
    return row?.c ?? 0;
  }
}
