import type BetterSqlite3 from "better-sqlite3";
import type { NoteRow } from "../../types.js";

export interface UpsertNoteInput {
  path: string;
  content: string;
  frontmatter: string | null;
  title: string;
  hash: string;
  /** Body-only SHA-256. Used by indexer's frontmatter-only-change
   *  short-circuit (migration 006). */
  bodyHash: string;
  mtime: number;
  wordCount: number;
  /**
   * v2 canonical identifier (plan 01-02 Task 04). When provided, written
   * verbatim into the `doc_uri` column. When omitted but `vaultName` IS
   * provided, the writer synthesizes `obsidian-fs://<vaultName>/<path>`
   * un-encoded. When both are omitted, the column is left NULL — the
   * v8 backfill catches it on the next migration replay.
   *
   * UPDATE semantics: an undefined `docUri` on an existing row PRESERVES
   * the existing value via SQL COALESCE — callers can safely omit the
   * field on edit-style upserts without clobbering data.
   */
  docUri?: string;
  /**
   * Vault name used only to synthesize a default `docUri` when the caller
   * hasn't precomputed one. Indexer / write-path callers that already know
   * the vault SHOULD pass this so new rows ship with doc_uri populated.
   */
  vaultName?: string;
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
    this._selectByPath = db.prepare<[string], NoteRow>("SELECT * FROM notes WHERE path = ?");
    this._selectById = db.prepare<[number], NoteRow>("SELECT * FROM notes WHERE id = ?");
    this._insert = db.prepare(`
      INSERT INTO notes (path, content, frontmatter, title, hash, body_hash, doc_uri, mtime, word_count, created_at, updated_at)
      VALUES (@path, @content, @frontmatter, @title, @hash, @body_hash, @doc_uri, @mtime, @word_count, @now, @now)
    `);
    // doc_uri uses COALESCE(@doc_uri, doc_uri) so that a caller passing
    // undefined / null PRESERVES the existing value instead of clobbering it.
    // See UpsertNoteInput.docUri TSDoc and plan 01-02 W3 caveat.
    this._update = db.prepare(`
      UPDATE notes
      SET content = @content,
          frontmatter = @frontmatter,
          title = @title,
          hash = @hash,
          body_hash = @body_hash,
          doc_uri = COALESCE(@doc_uri, doc_uri),
          mtime = @mtime,
          word_count = @word_count,
          updated_at = @now
      WHERE id = @id
    `);
    this._delete = db.prepare("DELETE FROM notes WHERE path = ?");
    this._listAll = db.prepare<[number, number], NoteRow>(
      "SELECT * FROM notes ORDER BY id LIMIT ? OFFSET ?",
    );
    this._count = db.prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM notes");
  }

  upsertByPath(input: UpsertNoteInput): { id: number; isNew: boolean } {
    const existing = this._selectByPath.get(input.path);
    const now = Date.now();
    // doc_uri resolution: explicit > synthesized-from-vaultName > NULL.
    // NULL is acceptable during the Phase 1 dual-column window — migration
    // 008 backfills it on the next replay, and Phase 3+ flips reads.
    const docUri: string | null =
      input.docUri ??
      (input.vaultName !== undefined ? `obsidian-fs://${input.vaultName}/${input.path}` : null);
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
        body_hash: input.bodyHash,
        // Pass null when the caller didn't compute one — COALESCE in the
        // UPDATE statement keeps the existing doc_uri intact.
        doc_uri: docUri,
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
      body_hash: input.bodyHash,
      doc_uri: docUri,
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

  /**
   * Plan 02-06 (MEM-09): count rows whose `path` begins with the given
   * prefix. Used by the `memory-stats` MCP Resource to count documents
   * inside a `MemorySink` (the sink's `resolveToRelativePath` is the
   * prefix, with trailing slash). The path is bound as a parameter; the
   * `prefix` value MUST end with `/` to keep the match well-defined.
   */
  countByPathPrefix(prefix: string): number {
    const row = this.db
      .prepare<[string], { c: number }>(
        "SELECT COUNT(*) AS c FROM notes WHERE path LIKE ? ESCAPE '\\'",
      )
      .get(escapeLikePrefix(prefix) + "%");
    return row?.c ?? 0;
  }

  /**
   * Plan 02-06 (MEM-09): list rows whose `path` begins with the given
   * prefix. Used by the `memory-stats` MCP Resource to aggregate
   * `by_type` / `by_status` counts from the stored frontmatter JSON.
   * Default limit is intentionally generous (10_000) — sinks are user-
   * scoped and typically hold tens of documents in v2.0.0; the cap
   * exists only as a hedge against pathological sinks.
   */
  listByPathPrefix(prefix: string, limit = 10_000): NoteRow[] {
    return this.db
      .prepare<[string, number], NoteRow>(
        "SELECT * FROM notes WHERE path LIKE ? ESCAPE '\\' ORDER BY path LIMIT ?",
      )
      .all(escapeLikePrefix(prefix) + "%", limit);
  }
}

/**
 * Backslash-escape SQLite LIKE wildcards in a vault-relative path prefix
 * so a sink `resolveToRelativePath` containing `%` / `_` / `\` matches
 * literally. Sinks normally use plain folder names ("_memory/"), but
 * defending against pathological inputs costs nothing.
 */
function escapeLikePrefix(prefix: string): string {
  return prefix.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
