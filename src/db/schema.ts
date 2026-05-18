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

import { backfillSectionsFromChunks } from "../sections/backfill.js";
import { computeChunkIdFragment } from "../chunker/chunk-id.js";

/**
 * Context passed to every function-style migration. New optional fields can be
 * added here without rewriting existing migrations — they accept the whole
 * context as a single arg and ignore the bits they don't need.
 *
 * `vaultName` is plumbed in from the Database constructor (see database.ts).
 * Migration 008 (doc_uri backfill) requires it; earlier function-style
 * migrations (005) accept it and ignore it.
 */
export interface MigrationContext {
  readonly vaultName: string | undefined;
}

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
      run: (db: BetterSqlite3Database, ctx: MigrationContext) => void;
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
function runMigration005(db: BetterSqlite3Database, _ctx: MigrationContext): void {
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
    .prepare<
      [],
      { name: string }
    >("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'embeddings\\_%' ESCAPE '\\'")
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
      .prepare<
        [],
        { chunk_id: number; model_id: number; vector: Buffer }
      >(`SELECT chunk_id, model_id, vector FROM ${name}`)
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
      const insert = db.prepare(`INSERT INTO ${newName} (chunk_id, vector) VALUES (?, ?)`);
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

/**
 * Migration 007: doc_uri Strategy A — additive nullable column.
 *
 * Adds the v2 canonical identifier column to `notes`. Stored UN-ENCODED:
 * a raw forward-slash path with spaces / Unicode passed through (matches
 * the existing `path` column shape). Percent-encoding happens only at
 * formatDisplayUrl time per RESEARCH Pitfall 5.
 *
 * Indexer behavior: new writes populate doc_uri alongside path (plan 01-02
 * Task 04 wires this into NotesQueries.upsertByPath). Backfill of existing
 * rows is migration 008. Reads continue to use path as PK until phase 3 or
 * later flips read preference.
 *
 * Strategy A staging (RESEARCH §doc_uri Dual-Column Migration):
 *   v7 = this migration (ADD COLUMN; nullable)
 *   v8 = backfill (function-style; idempotent)
 *   v9 = NOT NULL assertion + drop path PK — DEFERRED to phase 3+
 */
const MIGRATION_007_DOC_URI_ADD = `
ALTER TABLE notes ADD COLUMN doc_uri TEXT;
CREATE INDEX IF NOT EXISTS idx_notes_doc_uri ON notes(doc_uri);
`;

/**
 * Migration 008: doc_uri Strategy A — backfill existing rows.
 *
 * For every notes row, derives:
 *   doc_uri = 'obsidian-fs://' + ctx.vaultName + '/' + path
 *
 * Path is stored un-encoded (matches the existing `path` column shape).
 * Percent-encoding is a presentation concern handled by formatDisplayUrl
 * (per RESEARCH Pitfall 5).
 *
 * IDEMPOTENT: rows where doc_uri IS already NOT NULL are skipped. Re-running
 * the migration on a fully backfilled DB is a no-op. The runner is wrapped
 * in the existing SQLite transaction (database.ts:99) so failure rolls back.
 *
 * Requires `ctx.vaultName` (plumbed from VaultManager via Database constructor).
 * Throws clearly if vaultName is undefined — see RESEARCH §Pitfall 5 / A8.
 */
function runMigration008(db: BetterSqlite3Database, ctx: MigrationContext): void {
  // Short-circuit: zero notes to backfill means we don't need vaultName at
  // all. This lets `:memory:` fresh DBs migrate cleanly without forcing
  // every test fixture to specify a vault name.
  const pending = db
    .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM notes WHERE doc_uri IS NULL")
    .get();
  if (!pending || pending.c === 0) return;

  if (!ctx.vaultName) {
    throw new Error(
      "runMigration008 requires vaultName context to backfill doc_uri on existing notes (Database constructor must be called with the vault name; check src/vault/manager.ts).",
    );
  }
  const prefix = `obsidian-fs://${ctx.vaultName}/`;
  const update = db.prepare(`
    UPDATE notes
       SET doc_uri = @prefix || path
     WHERE doc_uri IS NULL
  `);
  update.run({ prefix });
}

/**
 * Migration 009 — audit discriminator for memory-sink writes (MEM-08, Plan 02-06).
 *
 * Adds an `is_memory_sink_write` column to `write_audit` so the audit log
 * can distinguish writes routed under a MemorySink (agent observations,
 * supersede records) from regular user writes. Existing v1.x rows migrate
 * with the default value 0 — they pre-date the memory namespace.
 *
 * A partial index on `(is_memory_sink_write, at DESC) WHERE is_memory_sink_write = 1`
 * keeps the common "show me only memory writes" filter fast without
 * widening the index footprint for user writes. Per RESEARCH §Q8: partial
 * indexes are the standard SQLite idiom for boolean discriminators where
 * one branch dominates volume.
 *
 * Function-style (not pure SQL) so the column-add is IDEMPOTENT: a test
 * fixture that rewinds `user_version` to replay earlier migrations against
 * a DB whose write_audit already carries the v9 column (because the
 * Database constructor migrated it to head on open) must not crash on a
 * duplicate-column error. The behavior of a clean v8→v9 upgrade is
 * identical to the pure-SQL form: ALTER ADD COLUMN with DEFAULT 0 +
 * partial index creation.
 */
function runMigration009(db: BetterSqlite3Database, _ctx: MigrationContext): void {
  const cols = db.prepare("PRAGMA table_info(write_audit)").all() as Array<{
    name: string;
  }>;
  const hasColumn = cols.some((c) => c.name === "is_memory_sink_write");
  if (!hasColumn) {
    db.exec(
      "ALTER TABLE write_audit ADD COLUMN is_memory_sink_write INTEGER NOT NULL DEFAULT 0",
    );
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_write_audit_memory
      ON write_audit(is_memory_sink_write, at DESC)
      WHERE is_memory_sink_write = 1
  `);
}

/**
 * Migration 010 — Phase 3 (slice 03-01) sections infrastructure.
 *
 * Three ordered steps inside ONE transaction (per plan 03-01):
 *   A) `sections` table + 3 indexes (DDL).
 *   B) Denormalized `notes.status` column + UPDATE backfill from
 *      `json_extract(frontmatter, '$.status')` + partial index
 *      `notes_status WHERE status IS NOT NULL`.
 *   C) Function-style call to `backfillSectionsFromChunks(db)` —
 *      one-time backfill of `sections` rows for existing notes
 *      (M2 fix from the plan-checker). Re-derives sections from each
 *      note's `content` column, NOT from `chunks.heading_path` (see
 *      03-01-DEVIATIONS.md §D1 for why).
 *
 * Function-style so we can interleave SQL + a TS helper call inside the
 * same transaction. The runner is already inside `db.transaction(...)`
 * at `src/db/database.ts:114` — calling `db.exec` from here participates
 * in that outer transaction by default with better-sqlite3.
 *
 * IDEMPOTENCY: the v1 migration runner only runs migrations whose
 * version > `user_version` so this function executes at most once per
 * DB. As a defence-in-depth measure the steps are still individually
 * idempotent (column-add via PRAGMA introspection; `CREATE TABLE IF
 * NOT EXISTS`; backfill helper short-circuits when rows already exist
 * for a note).
 */
function runMigration010(db: BetterSqlite3Database, _ctx: MigrationContext): void {
  // ── Step A: sections table + 3 indexes ────────────────────────────
  // Use `IF NOT EXISTS` so a fixture replay against a DB whose v10
  // schema already exists does not crash. The composite indexes match
  // the plan's read patterns:
  //   - sections_note_anchor:    O(log) unique lookup by (note_id, anchor)
  //   - sections_note_parent_ord: O(log) tree iteration in get_outline
  //   - sections_chunk_range:    O(log) chunk → section promotion
  db.exec(`
    CREATE TABLE IF NOT EXISTS sections (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id         INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      anchor          TEXT NOT NULL,
      heading_path    TEXT NOT NULL,
      heading_text    TEXT NOT NULL,
      level           INTEGER NOT NULL,
      parent_id       INTEGER REFERENCES sections(id) ON DELETE CASCADE,
      ord             INTEGER NOT NULL,
      chunk_id_first  INTEGER REFERENCES chunks(id),
      chunk_id_last   INTEGER REFERENCES chunks(id),
      created_at      INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sections_note_anchor
      ON sections(note_id, anchor);
    CREATE INDEX IF NOT EXISTS sections_note_parent_ord
      ON sections(note_id, parent_id, ord);
    CREATE INDEX IF NOT EXISTS sections_chunk_range
      ON sections(note_id, chunk_id_first, chunk_id_last);
  `);

  // ── Step B: notes.status denormalized column (M4 fix) ─────────────
  // Idempotent column-add: check PRAGMA table_info first. `notes.status`
  // is read by 03-05's superseded SQL filter and maintained by the
  // indexer via `NotesQueries.setStatus(noteId, parsedProperties.status
  // ?? null)`.
  const cols = db.prepare("PRAGMA table_info(notes)").all() as Array<{ name: string }>;
  const hasStatus = cols.some((c) => c.name === "status");
  if (!hasStatus) {
    db.exec("ALTER TABLE notes ADD COLUMN status TEXT");
  }
  // Backfill `status` from existing JSON-stringified `notes.frontmatter`.
  // `notes.frontmatter` is stored as a JSON string (verified at
  // src/indexer/indexer.ts:168 — `JSON.stringify(parsed.frontmatter)`).
  // `json_extract` handles malformed JSON by returning NULL, so notes
  // with corrupt/missing frontmatter end up with `status: NULL` —
  // exactly the correct behavior.
  db.exec(`
    UPDATE notes
       SET status = json_extract(frontmatter, '$.status')
     WHERE frontmatter IS NOT NULL
       AND status IS NULL
  `);
  // Partial index: tiny footprint, only indexes rows with a non-null
  // status. Most notes have no status — the index stays small even on
  // large vaults.
  db.exec(`
    CREATE INDEX IF NOT EXISTS notes_status
      ON notes(status) WHERE status IS NOT NULL
  `);

  // ── Step C: section backfill (M2 fix) ─────────────────────────────
  // Re-derive sections from each note's `content` column. The helper
  // is co-located in `src/sections/backfill.ts` so the migration
  // module stays adapter-import-clean.
  backfillSectionsFromChunks(db);
}

/**
 * Migration 011 — Phase 4 / 04-01 / GRA-04 (D-01): `edges` table substrate.
 *
 * Lands the typed-edge graph storage that every Phase 4 surface
 * (`expand`, `cluster`, `search_hybrid({expand})`, the widened v1 graph
 * tools, bundle/dossier link entries) reads from. Mirrors the
 * established function-style backfill pattern from `runMigration008`
 * (lines 443–464) and the multi-step DDL+helper pattern from
 * `runMigration010` (lines 531–596).
 *
 * Three steps inside ONE transaction (the runner's outer transaction
 * from `database.ts:118`):
 *
 *   A) DDL — `edges` table + 3 indexes. Idempotent (`IF NOT EXISTS`).
 *      Columns match D-01 and `Edge.type` union from `src/types.ts:470`:
 *      `(id, source_doc, target_doc, target_path, type, rel, anchor,
 *       line_number)` with `UNIQUE(source_doc, target_doc, type,
 *       anchor)` for `INSERT OR IGNORE` idempotency.
 *      FKs: `source_doc REFERENCES notes(id) ON DELETE CASCADE`,
 *           `target_doc REFERENCES notes(id) ON DELETE SET NULL`.
 *      CHECK constraint on `type` mirrors `Edge.type` verbatim.
 *
 *   B) Zero-row short-circuit (mirrors `runMigration008` lines 444–448):
 *      if `wikilinks` is empty, skip backfill scan entirely. Keeps fresh
 *      `:memory:` test fixtures fast and avoids needless work on
 *      vaults that have no v1 wikilinks to migrate.
 *
 *   C) Chunked backfill — copies every row from `wikilinks` into
 *      `edges` with `type='wikilink'`. Chunked at 10,000 rows per
 *      batch (per RESEARCH §Pattern 1 / Pitfall 5). better-sqlite3
 *      is synchronous, so a multi-second backfill of a 100k+ wikilink
 *      vault must not block the event loop in one statement —
 *      chunking keeps each statement bounded. Pagination via
 *      `wikilinks.id > @after_id` + `LIMIT @chunk` (Pattern 1).
 *      `INSERT OR IGNORE` + the UNIQUE constraint make the backfill
 *      idempotent across partial-migration replays.
 *
 * Storage cost: ~doubling on the wikilink subset until v3 cleanup
 * drops the `wikilinks` table. Acceptable per D-01.
 *
 * No `fs`, `path.join`, or `gray-matter` imports anywhere in this
 * function (adapter-seam discipline, ADR-002).
 */
function runMigration011(db: BetterSqlite3Database, _ctx: MigrationContext): void {
  // ── Step A: DDL ──────────────────────────────────────────────────────
  //
  // D-01 names UNIQUE(source_doc, target_doc, type, anchor) but `target_doc`
  // and `anchor` are both nullable, and SQLite's standard UNIQUE constraint
  // treats every NULL as distinct (per the SQL spec the codebase already
  // relies on at `notes(path)` etc.). Without further accommodation,
  // INSERT OR IGNORE would fail to dedupe broken edges (target_doc IS NULL,
  // anchor IS NULL — two rows with the same source+type would both insert).
  //
  // The fix: a UNIQUE INDEX with COALESCE on the nullable columns. This is
  // the standard SQLite idiom for "treat NULL as equal for dedup" and is
  // semantically identical to D-01's intent.
  //
  //   COALESCE(target_doc, -1) — `-1` is safe because `notes.id` is
  //   AUTOINCREMENT starting at 1; no real note id can collide.
  //   COALESCE(anchor, '')    — empty string acts as the "no anchor" key;
  //   real anchors are non-empty strings (Obsidian wikilink syntax
  //   `[[note#section]]` rejects empty `#`).
  //
  // INSERT OR IGNORE consults the unique index for conflict resolution
  // (`ON CONFLICT IGNORE` semantics propagate from any unique constraint
  // or unique index — per SQLite docs §"INSERT ... OR IGNORE").
  db.exec(`
    CREATE TABLE IF NOT EXISTS edges (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      source_doc   INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      target_doc   INTEGER REFERENCES notes(id) ON DELETE SET NULL,
      target_path  TEXT,
      type         TEXT NOT NULL CHECK (type IN ('wikilink','mention','frontmatter-ref','hyperlink')),
      rel          TEXT,
      anchor       TEXT,
      line_number  INTEGER,
      link_text    TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique
      ON edges(source_doc, COALESCE(target_doc, -1), type, COALESCE(anchor, ''));
    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_doc);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_doc);
    CREATE INDEX IF NOT EXISTS idx_edges_type   ON edges(type);
  `);

  // ── Step B: zero-row short-circuit ───────────────────────────────────
  // Mirrors runMigration008 lines 444–448. Fresh DBs have no wikilinks
  // to backfill; skip the scan entirely.
  const pending = db
    .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM wikilinks")
    .get();
  if (!pending || pending.c === 0) return;

  // ── Step C: chunked backfill from wikilinks → edges ──────────────────
  // Chunked at 10k rows (RESEARCH §Pattern 1). Pagination via
  // `wikilinks.id > @after_id ORDER BY id ASC LIMIT @chunk`. INSERT OR
  // IGNORE + UNIQUE(source_doc, target_doc, type, anchor) is idempotent
  // across replays.
  //
  // NOTE: wikilink rows can have `target_path` IS NOT NULL while
  // `target_note` IS NULL (broken wikilinks). Those land in `edges`
  // with `target_doc IS NULL` and `target_path` preserved — `edges`
  // mirrors the unresolved-target convention from `wikilinks`.
  const CHUNK = 10_000;
  const copy = db.prepare(`
    INSERT OR IGNORE INTO edges
      (source_doc, target_doc, target_path, type, rel, anchor, line_number, link_text)
    SELECT source_note, target_note, target_path, 'wikilink', NULL, anchor, line_number, link_text
      FROM wikilinks
     WHERE id > @after_id
     ORDER BY id ASC
     LIMIT @chunk
  `);
  // `nextLastIdAfter(@after_id, @chunk)` returns the wikilinks.id at
  // position @chunk-th row past @after_id, OR undefined if fewer than
  // @chunk rows remain — which signals the final partial chunk.
  const nextLast = db.prepare<
    [number, number],
    { id: number }
  >("SELECT id FROM wikilinks WHERE id > ? ORDER BY id ASC LIMIT 1 OFFSET ?");

  let lastId = 0;
  while (true) {
    copy.run({ after_id: lastId, chunk: CHUNK });
    const nxt = nextLast.get(lastId, CHUNK - 1);
    if (!nxt) break;
    lastId = nxt.id;
  }
}

/**
 * Migration 012 — Phase 4 / CR-01: widen `idx_edges_unique` so that
 * legitimate non-duplicate edges no longer collide on `INSERT OR IGNORE`.
 *
 * The original migration-011 unique index was
 *   `(source_doc, COALESCE(target_doc, -1), type, COALESCE(anchor, ''))`
 * which silently dropped four classes of distinct rows:
 *
 *   1. Multiple broken wikilinks from the same source (different
 *      `target_path` but both have `target_doc IS NULL` + `anchor IS NULL`).
 *   2. Multiple hyperlinks from the same source (`target_doc IS NULL`,
 *      `anchor IS NULL` — only one survives per source note).
 *   3. Multiple `frontmatter-ref` edges from the same source to the same
 *      target with different `rel` (e.g. `{owner: [[a]], assignee: [[a]]}`).
 *   4. Multi-line `mention` edges to the same target (line_number was not
 *      a disambiguator).
 *
 * The widened key includes `target_path`, `rel`, and `line_number` (with
 * `COALESCE` defaults for nulls so SQLite's "every NULL is distinct"
 * default does not re-introduce the dedup-failure on the inverse axis).
 *
 * Three steps inside the runner's outer transaction:
 *   A) DROP idx_edges_unique. SQLite cannot alter a unique-index
 *      definition in place — drop + recreate is the only path.
 *   B) CREATE the widened idx_edges_unique. If a re-run finds the wider
 *      index already exists (e.g. partial-replay against a DB that was
 *      hand-fixed), `IF NOT EXISTS` keeps the migration idempotent.
 *   C) Re-run the wikilink backfill from migration 011 (broken-link rows
 *      were lost during the narrow-key window between 011 and 012). The
 *      backfill uses `INSERT OR IGNORE` against the now-widened key so
 *      the rows that already survived stay untouched and the rows that
 *      were silently dropped are re-inserted.
 *
 * Cross-table FKs on `edges` are untouched. CHECK constraint on
 * `edges.type` is untouched. Read paths (`getBacklinks`, `getForwardLinks`,
 * `getAllForNodes`) are untouched — they SELECT, never INSERT.
 *
 * Adapter-seam discipline: no `fs`, `path`, `gray-matter`, or `chokidar`
 * imports anywhere in this function.
 */
function runMigration012(db: BetterSqlite3Database, _ctx: MigrationContext): void {
  // ── Step A: drop the narrow index ─────────────────────────────────────
  db.exec(`DROP INDEX IF EXISTS idx_edges_unique`);

  // ── Step B: create the widened index ──────────────────────────────────
  //
  // COALESCE defaults:
  //   target_doc   → -1   (notes.id is AUTOINCREMENT from 1; -1 cannot
  //                        collide with a real note id)
  //   target_path  → ''   (real target_path values are non-empty strings)
  //   rel          → ''   (real rel values are non-empty per ADR-003)
  //   anchor       → ''   (Obsidian wikilink `[[note#]]` rejects empty)
  //   line_number  → -1   (real line numbers are 1-based positive ints)
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique
      ON edges(
        source_doc,
        COALESCE(target_doc, -1),
        COALESCE(target_path, ''),
        type,
        COALESCE(rel, ''),
        COALESCE(anchor, ''),
        COALESCE(line_number, -1)
      );
  `);

  // ── Step C: re-run the wikilink → edges backfill ──────────────────────
  //
  // Broken-wikilink rows were lost during the narrow-key window because
  // migration 011 used `INSERT OR IGNORE` against a key that collapsed
  // every `(source_note, target_path=*, anchor=NULL)` row to a single
  // edges row. The widened key now distinguishes broken targets by
  // `target_path`. Re-running the same chunked copy with the same
  // `INSERT OR IGNORE` guard is idempotent on the already-correct rows
  // and refills the gaps.
  //
  // Mirrors runMigration011 Step C verbatim (chunked at 10k rows,
  // pagination via wikilinks.id > @after_id ORDER BY id ASC LIMIT
  // @chunk). The zero-row short-circuit also mirrors 011 — fresh DBs
  // do not need the backfill scan.
  const pending = db
    .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM wikilinks")
    .get();
  if (!pending || pending.c === 0) return;

  const CHUNK = 10_000;
  const copy = db.prepare(`
    INSERT OR IGNORE INTO edges
      (source_doc, target_doc, target_path, type, rel, anchor, line_number, link_text)
    SELECT source_note, target_note, target_path, 'wikilink', NULL, anchor, line_number, link_text
      FROM wikilinks
     WHERE id > @after_id
     ORDER BY id ASC
     LIMIT @chunk
  `);
  const nextLast = db.prepare<
    [number, number],
    { id: number }
  >("SELECT id FROM wikilinks WHERE id > ? ORDER BY id ASC LIMIT 1 OFFSET ?");

  let lastId = 0;
  while (true) {
    copy.run({ after_id: lastId, chunk: CHUNK });
    const nxt = nextLast.get(lastId, CHUNK - 1);
    if (!nxt) break;
    lastId = nxt.id;
  }
}

/**
 * Migration 013 — Phase 5 / BRF-* / D-04..D-06 / D-09.
 *
 * Three additive substrates land at this version:
 *
 *   A) `chunks.chunk_id_fragment TEXT NOT NULL DEFAULT ''` column +
 *      chunked backfill (10k rows per batch, mirrors `runMigration008`).
 *      Per D-04/D-05 the fragment is `sha256(NFC(LF-normalized,
 *      trimEnd(text))).slice(0,7)`. The canonical computation lives in
 *      `src/chunker/chunk-id.ts` so the migration and the chunker share
 *      a single source of truth (anti-pattern: scattered createHash
 *      calls — see RESEARCH §Pitfall 14).
 *
 *   B) `brief_sources(brief_doc_id, chunk_id_fragment, chunk_doc_id,
 *      recorded_hash)` reverse-index table per D-06 with
 *      UNIQUE(brief_doc_id, chunk_id_fragment) and indexes on
 *      `(chunk_doc_id)` and `(chunk_id_fragment)`. Populated on brief
 *      write in slice 2 (Plan 05-02); rows deleted on brief
 *      delete/supersede. Staleness check on a ChangeEvent for `doc_id D`
 *      becomes O(log N) — `SELECT brief_doc_id FROM brief_sources WHERE
 *      chunk_doc_id = D AND recorded_hash != <current chunk hash>`.
 *
 *   C) `daemon_state(vault_name PRIMARY KEY, last_seen_doc_mtime)` per
 *      D-09. Used by the staleness daemon (Plan 05-03) for the hybrid
 *      replay strategy: startup full scan (correctness floor) + cursor
 *      for steady-state diagnostic ("is my daemon current?").
 *
 * Step ordering inside the runner's outer transaction:
 *   A.1 — DDL idempotency for `chunks.chunk_id_fragment` column-add
 *         (PRAGMA introspection per `runMigration009:489-497`).
 *   A.2 — Zero-row short-circuit (mirrors `runMigration008:447-450`)
 *         on `COUNT(*) WHERE chunk_id_fragment = ''` so fresh DBs and
 *         already-backfilled DBs both skip the scan.
 *   A.3 — Chunked backfill at CHUNK = 10_000 (matches
 *         `runMigration011:701`). Pagination via `id > @after_id ORDER
 *         BY id ASC LIMIT 10000`. Each batch wraps a transaction so a
 *         multi-second backfill on a 100k+ chunk vault does not freeze
 *         the event loop (better-sqlite3 is synchronous).
 *   B.   — `CREATE TABLE IF NOT EXISTS brief_sources` + indexes.
 *   C.   — `CREATE TABLE IF NOT EXISTS daemon_state`.
 *
 * Adapter-seam discipline: no `fs`, `path`, `gray-matter`, or
 * `chokidar` imports anywhere in this function. The chunker helper
 * imported here is itself pure (`src/chunker/chunk-id.ts`).
 */
function runMigration013(db: BetterSqlite3Database, _ctx: MigrationContext): void {
  // ── Step A.1: chunks.chunk_id_fragment column-add (idempotent) ─────
  const cols = db.prepare("PRAGMA table_info(chunks)").all() as Array<{
    name: string;
  }>;
  const hasColumn = cols.some((c) => c.name === "chunk_id_fragment");
  if (!hasColumn) {
    db.exec(
      "ALTER TABLE chunks ADD COLUMN chunk_id_fragment TEXT NOT NULL DEFAULT ''",
    );
  }

  // ── Step A.2: zero-row short-circuit ──────────────────────────────
  // Skip the backfill scan entirely on fresh `:memory:` DBs and on
  // re-runs against an already-backfilled DB. Mirrors
  // runMigration008:447-450.
  const pending = db
    .prepare<[], { c: number }>(
      "SELECT COUNT(*) AS c FROM chunks WHERE chunk_id_fragment = ''",
    )
    .get();
  if (pending && pending.c > 0) {
    // ── Step A.3: chunked backfill at 10k rows/batch ────────────────
    const CHUNK = 10_000;
    const update = db.prepare(
      "UPDATE chunks SET chunk_id_fragment = ? WHERE id = ?",
    );
    const select = db.prepare<
      [number],
      { id: number; text: string }
    >(
      "SELECT id, text FROM chunks WHERE id > ? AND chunk_id_fragment = '' ORDER BY id ASC LIMIT 10000",
    );
    let afterId = 0;
    while (true) {
      const rows = select.all(afterId);
      if (rows.length === 0) break;
      const tx = db.transaction((batch: { id: number; text: string }[]) => {
        for (const row of batch) {
          update.run(computeChunkIdFragment(row.text), row.id);
        }
      });
      tx(rows);
      const last = rows[rows.length - 1];
      if (!last) break;
      afterId = last.id;
      if (rows.length < CHUNK) break;
    }
  }

  // ── Step B: brief_sources reverse-index table + indexes ───────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS brief_sources (
      brief_doc_id      TEXT NOT NULL,
      chunk_id_fragment TEXT NOT NULL,
      chunk_doc_id      TEXT NOT NULL,
      recorded_hash     TEXT NOT NULL,
      UNIQUE(brief_doc_id, chunk_id_fragment)
    );
    CREATE INDEX IF NOT EXISTS idx_brief_sources_chunk_doc
      ON brief_sources(chunk_doc_id);
    CREATE INDEX IF NOT EXISTS idx_brief_sources_fragment
      ON brief_sources(chunk_id_fragment);
  `);

  // ── Step C: daemon_state single-row-per-vault state ───────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS daemon_state (
      vault_name           TEXT PRIMARY KEY,
      last_seen_doc_mtime  INTEGER NOT NULL
    );
  `);
}

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
    description: "add partition key on model_id (two models per dim can coexist)",
    run: runMigration005,
  },
  {
    version: 6,
    description: "add body_hash for frontmatter-only-change short-circuit",
    sql: MIGRATION_006_BODY_HASH,
  },
  {
    version: 7,
    description: "add doc_uri column to notes (Strategy A, additive)",
    sql: MIGRATION_007_DOC_URI_ADD,
  },
  {
    version: 8,
    description: "backfill doc_uri from <vault-name>/path",
    run: runMigration008,
  },
  {
    version: 9,
    description:
      "audit discriminator — is_memory_sink_write column + partial index (MEM-08, Plan 02-06)",
    run: runMigration009,
  },
  {
    version: 10,
    description:
      "sections table + notes.status denormalization + one-time section backfill (Phase 3 / 03-01)",
    run: runMigration010,
  },
  {
    version: 11,
    description: "edges table + backfill from wikilinks (Phase 4 / 04-01 / GRA-04)",
    run: runMigration011,
  },
  {
    version: 12,
    description:
      "widen idx_edges_unique to include target_path/rel/line_number; re-run wikilink backfill (CR-01)",
    run: runMigration012,
  },
  {
    version: 13,
    description:
      "chunks.chunk_id_fragment + brief_sources + daemon_state (Phase 5 / BRF-* / D-04..D-06 / D-09)",
    run: runMigration013,
  },
];
