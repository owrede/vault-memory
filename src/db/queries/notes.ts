import type BetterSqlite3 from "better-sqlite3";
import type { NoteRow } from "../../types.js";

/**
 * Default cap on `listByPathPrefix` row count. Sized to cover any
 * realistic v2.0.0 sink (sinks hold tens of documents at most). The
 * cap is exposed as a constant so consumers (e.g. `memory-stats`
 * Resource at `src/memory/resources/memory-stats.ts`) can detect
 * when the cap was hit and emit `truncated: true` (IN-03 closure).
 */
export const LIST_BY_PATH_PREFIX_DEFAULT_LIMIT = 10_000;

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
  /** Phase 3 / 03-01 (M4): denormalized `notes.status` accessors. */
  private readonly _getStatus: BetterSqlite3.Statement<[number], { status: string | null }>;
  private readonly _setStatus: BetterSqlite3.Statement;

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
    // Phase 3 / 03-01 (M4): denormalized `notes.status` column accessors.
    // Prepared statements MUST be created AFTER migration v10 added the
    // column. The Database constructor runs migrate() before instantiating
    // any query class (`src/db/database.ts:57`), so this ordering holds.
    this._getStatus = db.prepare<[number], { status: string | null }>(
      "SELECT status FROM notes WHERE id = ?",
    );
    this._setStatus = db.prepare("UPDATE notes SET status = @status WHERE id = @id");
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
      .prepare<
        [string],
        { c: number }
      >("SELECT COUNT(*) AS c FROM notes WHERE path LIKE ? ESCAPE '\\'")
      .get(escapeLikePrefix(prefix) + "%");
    return row?.c ?? 0;
  }

  /**
   * Plan 02-06 (MEM-09): list rows whose `path` begins with the given
   * prefix. Used by the `memory-stats` MCP Resource to aggregate
   * `by_type` / `by_status` counts from the stored frontmatter JSON.
   * Default limit is `LIST_BY_PATH_PREFIX_DEFAULT_LIMIT` (10_000) —
   * sinks are user-scoped and typically hold tens of documents in
   * v2.0.0; the cap exists only as a hedge against pathological sinks.
   * Callers that need to detect cap-hit (e.g. memory-stats `truncated`
   * marker, IN-03) compare `rows.length === LIST_BY_PATH_PREFIX_DEFAULT_LIMIT`.
   */
  listByPathPrefix(prefix: string, limit = LIST_BY_PATH_PREFIX_DEFAULT_LIMIT): NoteRow[] {
    return this.db
      .prepare<
        [string, number],
        NoteRow
      >("SELECT * FROM notes WHERE path LIKE ? ESCAPE '\\' ORDER BY path LIMIT ?")
      .all(escapeLikePrefix(prefix) + "%", limit);
  }

  /**
   * Phase 3 / 03-01 (M4): read the denormalized `notes.status` column.
   * Returns `null` for unknown note IDs or notes with no status. Reads
   * the column directly (avoids re-parsing the JSON frontmatter blob).
   *
   * Maintained in sync with `notes.frontmatter` by the indexer — every
   * write that touches `notes.frontmatter` MUST call `setStatus(...)`
   * immediately after so the column doesn't drift.
   */
  getStatus(noteId: number): string | null {
    const row = this._getStatus.get(noteId);
    return row?.status ?? null;
  }

  /**
   * Phase 3 / 03-01 (M4): write the denormalized `notes.status` column.
   * `null` clears the column (frontmatter removed the status key).
   * Returns the number of rows affected (0 for unknown note IDs).
   */
  setStatus(noteId: number, status: string | null): number {
    const info = this._setStatus.run({ id: noteId, status });
    return info.changes;
  }

  /**
   * Phase 3 / 03-05 (M4): return the subset of `chunkIds` whose owning
   * note has `notes.status = 'superseded'`. Used by `searchOneVault` to
   * filter the vec0 ANN candidate list at the SQL level after the kNN
   * search (vec0 virtual tables do not support inline JOINs the way
   * FTS5 does).
   *
   * Uses the `notes_status` partial index (migration 010) — superseded
   * notes are rare, so the index is tiny and lookups are cheap.
   *
   * The query parameterizes a variable-length IN clause; we generate
   * the placeholders inline rather than re-preparing the statement
   * because the chunk-id list varies per call. better-sqlite3's
   * `pluck()` returns a flat array of scalar column values when the
   * SELECT projects a single column — we lean on that to avoid an
   * extra map step.
   */
  getSupersededChunkIds(chunkIds: readonly number[]): Set<number> {
    if (chunkIds.length === 0) return new Set<number>();
    // Inline placeholders — chunkIds are int primary keys from our own
    // DB, never user input, so injection risk is zero. Cap the list
    // size defensively at 999 (SQLite's default SQLITE_MAX_VARIABLE_NUMBER
    // floor) — callers asking for more should batch.
    const ids = chunkIds.slice(0, 999);
    const placeholders = ids.map(() => "?").join(",");
    const sql = `SELECT chunks.id AS chunkId
         FROM chunks
         JOIN notes ON notes.id = chunks.note_id
        WHERE chunks.id IN (${placeholders})
          AND notes.status = 'superseded'`;
    const stmt = this.db.prepare<number[], { chunkId: number }>(sql);
    // better-sqlite3 spread-args want a tuple type; widen via `as` so the
    // variable-length IN list survives strict-mode argument typing.
    const rows = (stmt.all as (...args: number[]) => { chunkId: number }[])(...ids);
    return new Set(rows.map((r) => r.chunkId));
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
