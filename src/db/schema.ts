/**
 * SQL DDL strings and migrations.
 *
 * Migrations are inlined as TS constants — no external .sql files. This is
 * intentional: it keeps the build trivial (tsup doesn't need to copy assets)
 * and makes the migration list a single source of truth.
 *
 * To add a migration: append to `MIGRATIONS` with a monotonically increasing
 * `version`. The runner applies all migrations whose version > user_version
 * in order, then sets PRAGMA user_version to the highest version applied.
 */

/**
 * A migration either ships static SQL or a function that runs imperative
 * steps against the DB. Function-style migrations are used when the steps
 * depend on the current schema state (e.g. discover all `embeddings_<dim>`
 * tables and rebuild each).
 */
export type Migration =
  | {
      version: number;
      description: string;
      sql: string;
    }
  | {
      version: number;
      description: string;
      run: (db: BetterSqlite3Database) => void;
    };

/** Section 3 of the spec — full initial schema. */
export const INITIAL_SCHEMA: string = `
-- ── 3.1 Raw Layer ────────────────────────────────────────────────────────

-- Migration 006 adds body_hash to this table (kept out of v1 schema so
-- the migration chain has historical accuracy and frequent DB-rebuild
-- tests do not trip over duplicate-column errors).
CREATE TABLE IF NOT EXISTS notes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  path          TEXT NOT NULL UNIQUE,
  content       TEXT NOT NULL,
  frontmatter   TEXT,
  title         TEXT,
  hash          TEXT NOT NULL,
  mtime         INTEGER NOT NULL,
  word_count    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_hash ON notes(hash);
CREATE INDEX IF NOT EXISTS idx_notes_mtime ON notes(mtime);

CREATE TABLE IF NOT EXISTS chunks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id       INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  idx           INTEGER NOT NULL,
  text          TEXT NOT NULL,
  heading_path  TEXT,
  start_offset  INTEGER NOT NULL,
  end_offset    INTEGER NOT NULL,
  token_count   INTEGER NOT NULL,
  UNIQUE (note_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_chunks_note ON chunks(note_id);

-- ── 3.2 Derived Layer ────────────────────────────────────────────────────

-- Dimension 1024 matches qwen3-embedding (our default per Memory System spec).
-- For future multi-model support with different dims, see roadmap Phase 7.
CREATE VIRTUAL TABLE IF NOT EXISTS embeddings USING vec0(
  chunk_id      INTEGER PRIMARY KEY,
  model_id      INTEGER NOT NULL,
  vector        FLOAT[1024]
);

CREATE TABLE IF NOT EXISTS models (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  provider      TEXT NOT NULL,
  dim           INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  content='chunks',
  content_rowid='id'
);

-- Triggers to keep chunks_fts in sync with chunks
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TABLE IF NOT EXISTS wikilinks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_note   INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_path   TEXT NOT NULL,
  target_note   INTEGER REFERENCES notes(id) ON DELETE SET NULL,
  link_text     TEXT,
  anchor        TEXT,
  line_number   INTEGER,
  UNIQUE (source_note, target_path, anchor)
);
CREATE INDEX IF NOT EXISTS idx_wikilinks_source ON wikilinks(source_note);
CREATE INDEX IF NOT EXISTS idx_wikilinks_target ON wikilinks(target_note);

-- ── 3.3 Audit Layer ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS index_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id          TEXT NOT NULL UNIQUE,
  vault_name      TEXT NOT NULL,
  model_id        INTEGER REFERENCES models(id),
  started_at      INTEGER NOT NULL,
  finished_at     INTEGER,
  trigger         TEXT NOT NULL,
  notes_indexed   INTEGER NOT NULL DEFAULT 0,
  chunks_created  INTEGER NOT NULL DEFAULT 0,
  notes_updated   INTEGER NOT NULL DEFAULT 0,
  notes_deleted   INTEGER NOT NULL DEFAULT 0,
  error           TEXT
);

CREATE TABLE IF NOT EXISTS write_audit (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id         INTEGER REFERENCES notes(id) ON DELETE SET NULL,
  op              TEXT NOT NULL,
  previous_hash   TEXT,
  new_hash        TEXT,
  expected_hash   TEXT,
  client_id       TEXT,
  diff_summary    TEXT,
  at              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_write_audit_note ON write_audit(note_id);
`;

/**
 * Migration 002 — note_aliases table.
 *
 * Obsidian notes can declare `aliases: ["short", "another"]` in frontmatter.
 * A wikilink `[[short]]` should resolve to that note. We index aliases
 * separately so the wikilink resolver can do a fast lookup without
 * re-parsing every note's frontmatter.
 */
const MIGRATION_002_ALIASES = `
CREATE TABLE IF NOT EXISTS note_aliases (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id   INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  alias     TEXT NOT NULL,
  /* Aliases are case-insensitive matched in practice; we store original
     case for display but enforce a normalized key as UNIQUE per note. */
  alias_norm TEXT NOT NULL,
  UNIQUE (note_id, alias_norm)
);
CREATE INDEX IF NOT EXISTS idx_note_aliases_norm ON note_aliases(alias_norm);
`;

/**
 * Migration 003 — fix delete-cascade gaps in the wikilink + audit FKs.
 *
 * Original schema (v1) declared:
 *   wikilinks.target_note   REFERENCES notes(id)               -- no action
 *   write_audit.note_id     REFERENCES notes(id)               -- no action
 *
 * Both meant a `DELETE FROM notes` would FAIL whenever any other note still
 * linked to the deleted one, or when audit rows referenced it. That made
 * external/watcher/catchup deletes throw, and forced `delete_note` to
 * disable FKs entirely (leaving dangling `target_note` refs).
 *
 * The fix: rebuild both FKs.
 *   - wikilinks.target_note  → ON DELETE SET NULL  (the link becomes broken,
 *                              correctly surfaced by find_broken_links)
 *   - write_audit.note_id    → ON DELETE SET NULL  (audit history survives
 *                              the deletion, which is the whole point of audit)
 *
 * SQLite cannot ALTER a column's foreign-key action, so we rebuild each
 * table the standard way (create *_new, copy rows, drop, rename).
 */
const MIGRATION_003_FIX_DELETE_FKS = `
-- 1) wikilinks: rebuild with ON DELETE SET NULL on target_note
CREATE TABLE wikilinks_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_note   INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_path   TEXT NOT NULL,
  target_note   INTEGER REFERENCES notes(id) ON DELETE SET NULL,
  link_text     TEXT,
  anchor        TEXT,
  line_number   INTEGER,
  UNIQUE (source_note, target_path, anchor)
);
INSERT INTO wikilinks_new SELECT * FROM wikilinks;
DROP TABLE wikilinks;
ALTER TABLE wikilinks_new RENAME TO wikilinks;
CREATE INDEX IF NOT EXISTS idx_wikilinks_source ON wikilinks(source_note);
CREATE INDEX IF NOT EXISTS idx_wikilinks_target ON wikilinks(target_note);

-- 2) write_audit: rebuild with ON DELETE SET NULL on note_id
--    note_id must allow NULL for this to work; the column was NOT NULL in v1.
--    Existing audit rows that already reference vanished notes (residue from
--    the pre-migration FK-OFF delete workaround) have their note_id healed
--    to NULL during the copy — preserving audit history without re-introducing
--    dangling refs.
CREATE TABLE write_audit_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id         INTEGER REFERENCES notes(id) ON DELETE SET NULL,
  op              TEXT NOT NULL,
  previous_hash   TEXT,
  new_hash        TEXT,
  expected_hash   TEXT,
  client_id       TEXT,
  diff_summary    TEXT,
  at              INTEGER NOT NULL
);
INSERT INTO write_audit_new (id, note_id, op, previous_hash, new_hash, expected_hash, client_id, diff_summary, at)
SELECT
  wa.id,
  CASE WHEN n.id IS NULL THEN NULL ELSE wa.note_id END,
  wa.op, wa.previous_hash, wa.new_hash, wa.expected_hash, wa.client_id, wa.diff_summary, wa.at
FROM write_audit wa
LEFT JOIN notes n ON n.id = wa.note_id;
DROP TABLE write_audit;
ALTER TABLE write_audit_new RENAME TO write_audit;
CREATE INDEX IF NOT EXISTS idx_write_audit_note ON write_audit(note_id);
`;

/**
 * Migration 004 — variable embedding dimensions (Phase 7b).
 *
 * Original schema declared a single virtual table:
 *   embeddings USING vec0(chunk_id, model_id, vector FLOAT[1024])
 * with the dim hard-wired to 1024 (qwen3-embedding default).
 *
 * Phase 7b lets multiple models with different output dimensions coexist
 * in the same vault DB (e.g. qwen3 @ 1024 + embeddinggemma @ 768). Because
 * sqlite-vec's vec0 requires a compile-time-fixed dimension per column,
 * we use one virtual table per dim: `embeddings_<dim>`.
 *
 * This migration:
 *   1) Creates `embeddings_1024` and `embeddings_768` up-front (the two
 *      dims we know about today). Additional dims are materialized
 *      on-demand by Database.ensureEmbeddingsTable(dim).
 *   2) Copies all rows from the legacy `embeddings` table into
 *      `embeddings_1024` (since the legacy schema was 1024-only).
 *   3) Drops the legacy `embeddings` table.
 *
 * vec0 virtual tables do not support INSERT ... SELECT directly across
 * vec0 instances reliably across older sqlite-vec builds — we copy row
 * by row via a SELECT loop, materialised as a CTE-driven INSERT here.
 * For empty tables this is a no-op.
 */
const MIGRATION_004_VARIABLE_DIMS = `
CREATE VIRTUAL TABLE IF NOT EXISTS embeddings_1024 USING vec0(
  chunk_id      INTEGER PRIMARY KEY,
  model_id      INTEGER NOT NULL,
  vector        FLOAT[1024]
);

CREATE VIRTUAL TABLE IF NOT EXISTS embeddings_768 USING vec0(
  chunk_id      INTEGER PRIMARY KEY,
  model_id      INTEGER NOT NULL,
  vector        FLOAT[768]
);

INSERT INTO embeddings_1024 (chunk_id, model_id, vector)
  SELECT chunk_id, model_id, vector FROM embeddings;

DROP TABLE embeddings;
`;

/**
 * Migration 005 — add `partition key` on `model_id` so two embedding models
 * with the same dim (e.g. qwen3 @ 1024 + bge-m3 @ 1024) can coexist for the
 * same chunks. Discovered as a bug during the Phase 7e eval run.
 *
 * sqlite-vec vec0 tables do not support ALTER COLUMN, so the only path is
 * rebuild-and-copy:
 *   1) For every existing `embeddings_<dim>` table:
 *      a) Rename to `embeddings_<dim>__old`.
 *      b) Create new `embeddings_<dim>` with `model_id partition key`.
 *      c) Copy all rows back. The partition column accepts ordinary inserts.
 *      d) Drop the `__old` table.
 *
 * We can't write this as a single static SQL string because the set of
 * dim-tables in any given DB is data-dependent (768 only exists if someone
 * registered a 768-dim model). The runner therefore calls a function-style
 * migration: see `Migration.run()` below.
 */
function runMigration005(db: BetterSqlite3Database): void {
  // Phase 7e bugfix: split per-dim tables into per-model tables so two models
  // with the same dim (e.g. qwen3 + bge-m3, both 1024) can coexist for the
  // same chunk_ids. New naming: `embeddings_m<modelId>_d<dim>`.
  //
  // The earlier partition-key approach was a dead end — sqlite-vec's
  // `partition key` is an internal index hint, NOT a composite PK; chunk_id
  // remains globally unique inside a vec0 table.
  //
  // Migration steps per legacy `embeddings_<dim>` table:
  //   1) Read all rows (grouped by model_id).
  //   2) DROP the legacy table.
  //   3) For each model_id with rows, CREATE `embeddings_m<modelId>_d<dim>`
  //      and copy that model's rows back.
  const rows = db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'embeddings\\_%' ESCAPE '\\'",
    )
    .all();
  const legacyTables: { name: string; dim: number }[] = [];
  for (const r of rows) {
    // Match only the OLD per-dim shape (`embeddings_<dim>`), not anything
    // already in the new shape.
    const m = /^embeddings_(\d+)$/.exec(r.name);
    if (m && m[1]) legacyTables.push({ name: r.name, dim: Number(m[1]) });
  }

  for (const { name, dim } of legacyTables) {
    const rows = db
      .prepare<[], { chunk_id: number; model_id: number; vector: Buffer }>(
        `SELECT chunk_id, model_id, vector FROM ${name}`,
      )
      .all();

    db.exec(`DROP TABLE ${name}`);

    // Group rows by model_id so we materialise one new table per model.
    const byModel = new Map<number, typeof rows>();
    for (const row of rows) {
      let bucket = byModel.get(row.model_id);
      if (!bucket) {
        bucket = [];
        byModel.set(row.model_id, bucket);
      }
      bucket.push(row);
    }

    for (const [modelId, bucket] of byModel) {
      const newName = `embeddings_m${modelId}_d${dim}`;
      db.exec(
        `CREATE VIRTUAL TABLE ${newName} USING vec0(
           chunk_id INTEGER PRIMARY KEY,
           vector   FLOAT[${dim}]
         )`,
      );
      const insert = db.prepare(
        `INSERT INTO ${newName} (chunk_id, vector) VALUES (?, ?)`,
      );
      for (const row of bucket) {
        insert.run(BigInt(row.chunk_id), row.vector);
      }
    }
  }
}

type BetterSqlite3Database = import("better-sqlite3").Database;

/**
 * Migration 006 — add `body_hash` to notes.
 *
 * Why: the existing `hash` column mixes content + frontmatter. Any
 * frontmatter-only change (e.g. `update_frontmatter` adding a tag) flips
 * the hash and forces the indexer to re-chunk + re-embed the entire
 * note. The body is unchanged — embeddings should stay untouched.
 *
 * `body_hash` = sha256(content) only — independent of frontmatter.
 * The indexer compares body_hash before deciding whether to re-embed:
 *   - body_hash unchanged AND hash changed → frontmatter-only diff →
 *     update note row + aliases, keep chunks/embeddings
 *   - body_hash changed → full re-chunk + re-embed
 *
 * Existing rows have body_hash=NULL after this migration. The indexer
 * treats NULL as "unknown — must recompute on next touch" and fills it
 * in lazily during the next upsert. No backfill needed.
 */
const MIGRATION_006_BODY_HASH = `
ALTER TABLE notes ADD COLUMN body_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_notes_body_hash ON notes(body_hash);
`;

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: "initial schema",
    sql: INITIAL_SCHEMA,
  },
  {
    version: 2,
    description: "note aliases for wikilink resolution",
    sql: MIGRATION_002_ALIASES,
  },
  {
    version: 3,
    description: "fix delete-cascade gaps in wikilinks + write_audit FKs",
    sql: MIGRATION_003_FIX_DELETE_FKS,
  },
  {
    version: 4,
    description: "variable embedding dimensions (split embeddings table per dim)",
    sql: MIGRATION_004_VARIABLE_DIMS,
  },
  {
    version: 5,
    description:
      "add partition key on model_id (two models per dim can coexist)",
    run: runMigration005,
  },
  {
    version: 6,
    description: "add body_hash for frontmatter-only-change short-circuit",
    sql: MIGRATION_006_BODY_HASH,
  },
];
