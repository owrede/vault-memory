#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../../node_modules/tsup/assets/esm_shims.js
import path from "path";
import { fileURLToPath } from "url";
var init_esm_shims = __esm({
  "../../node_modules/tsup/assets/esm_shims.js"() {
    "use strict";
  }
});

// src/config/loader.ts
import { homedir } from "os";
import { join } from "path";
import { readFile } from "fs/promises";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
function configPath() {
  return join(homedir(), ".vault-memory", "config.toml");
}
async function loadConfig(path5 = configPath()) {
  let raw;
  try {
    raw = await readFile(path5, "utf-8");
  } catch (err) {
    const code = err.code;
    if (code === "ENOENT") {
      return DEFAULT_CONFIG;
    }
    throw err;
  }
  let parsed;
  try {
    parsed = parseToml(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse TOML at ${path5}: ${err.message}`
    );
  }
  const validated = AppConfigSchema.parse(parsed);
  return {
    server: {
      ...DEFAULT_CONFIG.server,
      ...validated.server
    },
    vaults: validated.vaults
  };
}
var ServerConfigSchema, VaultConfigSchema, AppConfigSchema, DEFAULT_CONFIG;
var init_loader = __esm({
  "src/config/loader.ts"() {
    "use strict";
    init_esm_shims();
    ServerConfigSchema = z.object({
      log_level: z.enum(["debug", "info", "warn", "error"]).optional(),
      ollama_endpoint: z.string().url().optional(),
      default_embedding_model: z.string().optional(),
      reranker_model: z.string().optional()
    });
    VaultConfigSchema = z.object({
      name: z.string().min(1),
      path: z.string().min(1),
      embedding_model: z.string().optional(),
      write_enabled: z.boolean().optional(),
      exclude_globs: z.array(z.string()).optional()
    });
    AppConfigSchema = z.object({
      server: ServerConfigSchema.optional().default({}),
      vaults: z.array(VaultConfigSchema).optional().default([])
    });
    DEFAULT_CONFIG = {
      server: {
        log_level: "info",
        ollama_endpoint: "http://localhost:11434",
        default_embedding_model: "qwen3-embedding"
      },
      vaults: []
    };
  }
});

// src/config/index.ts
var config_exports = {};
__export(config_exports, {
  configPath: () => configPath,
  loadConfig: () => loadConfig
});
var init_config = __esm({
  "src/config/index.ts"() {
    "use strict";
    init_esm_shims();
    init_loader();
  }
});

// src/db/schema.ts
var INITIAL_SCHEMA, MIGRATION_002_ALIASES, MIGRATION_003_FIX_DELETE_FKS, MIGRATION_004_VARIABLE_DIMS, MIGRATIONS;
var init_schema = __esm({
  "src/db/schema.ts"() {
    "use strict";
    init_esm_shims();
    INITIAL_SCHEMA = `
-- \u2500\u2500 3.1 Raw Layer \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

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

-- \u2500\u2500 3.2 Derived Layer \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

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

-- \u2500\u2500 3.3 Audit Layer \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

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
    MIGRATION_002_ALIASES = `
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
    MIGRATION_003_FIX_DELETE_FKS = `
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
--    to NULL during the copy \u2014 preserving audit history without re-introducing
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
    MIGRATION_004_VARIABLE_DIMS = `
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
    MIGRATIONS = [
      {
        version: 1,
        description: "initial schema",
        sql: INITIAL_SCHEMA
      },
      {
        version: 2,
        description: "note aliases for wikilink resolution",
        sql: MIGRATION_002_ALIASES
      },
      {
        version: 3,
        description: "fix delete-cascade gaps in wikilinks + write_audit FKs",
        sql: MIGRATION_003_FIX_DELETE_FKS
      },
      {
        version: 4,
        description: "variable embedding dimensions (split embeddings table per dim)",
        sql: MIGRATION_004_VARIABLE_DIMS
      }
    ];
  }
});

// src/db/queries/notes.ts
var NotesQueries;
var init_notes = __esm({
  "src/db/queries/notes.ts"() {
    "use strict";
    init_esm_shims();
    NotesQueries = class {
      constructor(db) {
        this.db = db;
        this._selectByPath = db.prepare(
          "SELECT * FROM notes WHERE path = ?"
        );
        this._selectById = db.prepare(
          "SELECT * FROM notes WHERE id = ?"
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
        this._listAll = db.prepare(
          "SELECT * FROM notes ORDER BY id LIMIT ? OFFSET ?"
        );
        this._count = db.prepare(
          "SELECT COUNT(*) AS c FROM notes"
        );
      }
      db;
      _selectByPath;
      _selectById;
      _insert;
      _update;
      _delete;
      _listAll;
      _count;
      upsertByPath(input) {
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
            now
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
          now
        });
        return { id: Number(info.lastInsertRowid), isNew: true };
      }
      getById(id) {
        return this._selectById.get(id) ?? null;
      }
      getByPath(path5) {
        return this._selectByPath.get(path5) ?? null;
      }
      deleteByPath(path5) {
        const info = this._delete.run(path5);
        return info.changes > 0;
      }
      listAll(limit = 1e3, offset = 0) {
        return this._listAll.all(limit, offset);
      }
      countAll() {
        const row = this._count.get();
        return row?.c ?? 0;
      }
    };
  }
});

// src/db/queries/chunks.ts
var ChunksQueries;
var init_chunks = __esm({
  "src/db/queries/chunks.ts"() {
    "use strict";
    init_esm_shims();
    ChunksQueries = class {
      constructor(db) {
        this.db = db;
        this._insert = db.prepare(`
      INSERT INTO chunks (note_id, idx, text, heading_path, start_offset, end_offset, token_count)
      VALUES (@note_id, @idx, @text, @heading_path, @start_offset, @end_offset, @token_count)
    `);
        this._deleteByNote = db.prepare("DELETE FROM chunks WHERE note_id = ?");
        this._getByNote = db.prepare(
          "SELECT * FROM chunks WHERE note_id = ? ORDER BY idx"
        );
        this._getById = db.prepare(
          "SELECT * FROM chunks WHERE id = ?"
        );
      }
      db;
      _insert;
      _deleteByNote;
      _getByNote;
      _getById;
      insertBatch(noteId, chunks) {
        const ids = [];
        const tx = this.db.transaction((cs) => {
          for (const c of cs) {
            const info = this._insert.run({
              note_id: noteId,
              idx: c.idx,
              text: c.text,
              heading_path: c.headingPath,
              start_offset: c.startOffset,
              end_offset: c.endOffset,
              token_count: c.tokenCount
            });
            ids.push(Number(info.lastInsertRowid));
          }
        });
        tx(chunks);
        return ids;
      }
      deleteByNote(noteId) {
        return this._deleteByNote.run(noteId).changes;
      }
      getByNote(noteId) {
        return this._getByNote.all(noteId);
      }
      getById(id) {
        return this._getById.get(id) ?? null;
      }
    };
  }
});

// src/db/queries/embeddings.ts
function serializeVector(v) {
  return JSON.stringify(v);
}
var EmbeddingsQueries;
var init_embeddings = __esm({
  "src/db/queries/embeddings.ts"() {
    "use strict";
    init_esm_shims();
    EmbeddingsQueries = class {
      constructor(db, models) {
        this.db = db;
        this.models = models;
      }
      db;
      models;
      stmtsByDim = /* @__PURE__ */ new Map();
      /**
       * Ensure an `embeddings_<dim>` virtual table exists for `dim`. Idempotent.
       * Called lazily on first use of a dim. Tables for the two commonly-used
       * dims (768, 1024) are also created by migration 004 up front.
       */
      ensureTableForDim(dim) {
        if (!Number.isInteger(dim) || dim <= 0) {
          throw new Error(`Invalid embedding dim: ${dim}`);
        }
        this.db.exec(
          `CREATE VIRTUAL TABLE IF NOT EXISTS embeddings_${dim} USING vec0(
         chunk_id INTEGER PRIMARY KEY,
         model_id INTEGER NOT NULL,
         vector   FLOAT[${dim}]
       )`
        );
      }
      dimForModel(modelId) {
        const row = this.models.getById(modelId);
        if (!row) {
          throw new Error(
            `EmbeddingsQueries: model_id ${modelId} not found in models table`
          );
        }
        return row.dim;
      }
      getStmts(dim) {
        const cached = this.stmtsByDim.get(dim);
        if (cached) return cached;
        this.ensureTableForDim(dim);
        const table = `embeddings_${dim}`;
        const stmts = {
          insert: this.db.prepare(
            `INSERT INTO ${table} (chunk_id, model_id, vector) VALUES (?, ?, ?)`
          ),
          deleteByChunk: this.db.prepare(
            `DELETE FROM ${table} WHERE chunk_id = ?`
          ),
          deleteByModel: this.db.prepare(
            `DELETE FROM ${table} WHERE model_id = ?`
          ),
          search: this.db.prepare(
            `SELECT chunk_id, distance
         FROM ${table}
         WHERE model_id = ? AND vector MATCH ? AND k = ?
         ORDER BY distance`
          )
        };
        this.stmtsByDim.set(dim, stmts);
        return stmts;
      }
      insertBatch(items) {
        if (items.length === 0) return;
        const byDim = /* @__PURE__ */ new Map();
        for (const x of items) {
          const dim = this.dimForModel(x.modelId);
          let bucket = byDim.get(dim);
          if (!bucket) {
            bucket = [];
            byDim.set(dim, bucket);
          }
          bucket.push(x);
        }
        const tx = this.db.transaction(() => {
          for (const [dim, xs] of byDim) {
            const stmts = this.getStmts(dim);
            for (const x of xs) {
              stmts.insert.run(
                BigInt(x.chunkId),
                BigInt(x.modelId),
                serializeVector(x.vector)
              );
            }
          }
        });
        tx();
      }
      /**
       * Delete embeddings for a chunk. Without a known model context, we walk
       * every known dim — chunk_ids are globally unique across dim tables so
       * this is safe and idempotent. Used by note-deletion cascade.
       */
      deleteByChunk(chunkId) {
        for (const dim of this.knownDims()) {
          const stmts = this.getStmts(dim);
          stmts.deleteByChunk.run(BigInt(chunkId));
        }
      }
      deleteByModel(modelId) {
        const dim = this.dimForModel(modelId);
        const stmts = this.getStmts(dim);
        stmts.deleteByModel.run(BigInt(modelId));
      }
      searchSemantic(modelId, queryVector, topK) {
        const dim = this.dimForModel(modelId);
        if (queryVector.length !== dim) {
          throw new Error(
            `searchSemantic: query vector length ${queryVector.length} does not match model ${modelId} dim ${dim}`
          );
        }
        const stmts = this.getStmts(dim);
        const rows = stmts.search.all(
          // model_id is INTEGER metadata — same BigInt requirement as insert.
          BigInt(modelId),
          serializeVector(queryVector),
          topK
        );
        return rows.map((r) => ({ chunkId: r.chunk_id, distance: r.distance }));
      }
      /**
       * Discover every `embeddings_<dim>` table currently in the schema. Used
       * by deleteByChunk where the caller doesn't know which dim the chunk
       * lives under.
       */
      knownDims() {
        const rows = this.db.prepare(
          `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name LIKE 'embeddings\\_%' ESCAPE '\\'`
        ).all();
        const dims = [];
        for (const r of rows) {
          const m = /^embeddings_(\d+)$/.exec(r.name);
          if (m && m[1]) dims.push(Number(m[1]));
        }
        return dims;
      }
    };
  }
});

// src/db/queries/wikilinks.ts
var WikilinksQueries;
var init_wikilinks = __esm({
  "src/db/queries/wikilinks.ts"() {
    "use strict";
    init_esm_shims();
    WikilinksQueries = class {
      constructor(db) {
        this.db = db;
        this._insert = db.prepare(`
      INSERT OR IGNORE INTO wikilinks
        (source_note, target_path, target_note, link_text, anchor, line_number)
      VALUES (@source_note, @target_path, @target_note, @link_text, @anchor, @line_number)
    `);
        this._deleteByNote = db.prepare(
          "DELETE FROM wikilinks WHERE source_note = ?"
        );
        this._backlinks = db.prepare(
          `SELECT source_note, line_number, link_text
       FROM wikilinks
       WHERE target_note = ?`
        );
        this._forward = db.prepare(
          `SELECT target_path, target_note, anchor, link_text
       FROM wikilinks
       WHERE source_note = ?`
        );
        this._broken = db.prepare(
          `SELECT source_note, target_path
       FROM wikilinks
       WHERE target_note IS NULL`
        );
      }
      db;
      _insert;
      _deleteByNote;
      _backlinks;
      _forward;
      _broken;
      insertBatch(sourceNoteId, links) {
        const tx = this.db.transaction((xs) => {
          for (const x of xs) {
            this._insert.run({
              source_note: sourceNoteId,
              target_path: x.targetPath,
              target_note: x.targetNoteId,
              link_text: x.linkText,
              anchor: x.anchor,
              line_number: x.lineNumber
            });
          }
        });
        tx(links);
      }
      deleteByNote(noteId) {
        return this._deleteByNote.run(noteId).changes;
      }
      getBacklinks(noteId) {
        return this._backlinks.all(noteId).map((r) => ({
          sourceNoteId: r.source_note,
          lineNumber: r.line_number,
          linkText: r.link_text
        }));
      }
      getForwardLinks(noteId) {
        return this._forward.all(noteId).map((r) => ({
          targetPath: r.target_path,
          targetNoteId: r.target_note,
          anchor: r.anchor,
          linkText: r.link_text
        }));
      }
      resolveBrokenLinks() {
        return this._broken.all().map((r) => ({
          sourceNoteId: r.source_note,
          targetPath: r.target_path
        }));
      }
    };
  }
});

// src/db/queries/audit.ts
var AuditQueries;
var init_audit = __esm({
  "src/db/queries/audit.ts"() {
    "use strict";
    init_esm_shims();
    AuditQueries = class {
      constructor(db) {
        this.db = db;
        this._startRun = db.prepare(`
      INSERT INTO index_runs (run_id, vault_name, model_id, started_at, trigger)
      VALUES (@run_id, @vault_name, @model_id, @started_at, @trigger)
    `);
        this._finishRun = db.prepare(`
      UPDATE index_runs
      SET finished_at = @finished_at,
          notes_indexed = @notes_indexed,
          chunks_created = @chunks_created,
          notes_updated = @notes_updated,
          notes_deleted = @notes_deleted,
          error = @error
      WHERE run_id = @run_id
    `);
        this._listRuns = db.prepare(
          "SELECT * FROM index_runs ORDER BY id DESC LIMIT ?"
        );
        this._recordWrite = db.prepare(`
      INSERT INTO write_audit (note_id, op, previous_hash, new_hash, expected_hash, client_id, diff_summary, at)
      VALUES (@note_id, @op, @previous_hash, @new_hash, @expected_hash, @client_id, @diff_summary, @at)
    `);
      }
      db;
      _startRun;
      _finishRun;
      _listRuns;
      _recordWrite;
      startRun(input) {
        const info = this._startRun.run({
          run_id: input.runId,
          vault_name: input.vaultName,
          model_id: input.modelId,
          started_at: Date.now(),
          trigger: input.trigger
        });
        return Number(info.lastInsertRowid);
      }
      finishRun(runId, stats) {
        this._finishRun.run({
          run_id: runId,
          finished_at: Date.now(),
          notes_indexed: stats.notesIndexed,
          chunks_created: stats.chunksCreated,
          notes_updated: stats.notesUpdated,
          notes_deleted: stats.notesDeleted,
          error: stats.error ?? null
        });
      }
      listRuns(limit = 50) {
        return this._listRuns.all(limit);
      }
      recordWrite(input) {
        this._recordWrite.run({
          note_id: input.noteId,
          op: input.op,
          previous_hash: input.previousHash,
          new_hash: input.newHash,
          expected_hash: input.expectedHash,
          client_id: input.clientId,
          diff_summary: input.diffSummary,
          at: Date.now()
        });
      }
      listWrites(filter = {}) {
        const where = [];
        const params = [];
        if (filter.noteId !== void 0) {
          where.push("note_id = ?");
          params.push(filter.noteId);
        }
        if (filter.op !== void 0) {
          where.push("op = ?");
          params.push(filter.op);
        }
        if (filter.since !== void 0) {
          where.push("at >= ?");
          params.push(filter.since);
        }
        const limit = filter.limit ?? 100;
        const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
        const sql = `SELECT * FROM write_audit ${whereSql} ORDER BY id DESC LIMIT ?`;
        params.push(limit);
        return this.db.prepare(sql).all(...params);
      }
    };
  }
});

// src/db/queries/models.ts
var ModelsQueries;
var init_models = __esm({
  "src/db/queries/models.ts"() {
    "use strict";
    init_esm_shims();
    ModelsQueries = class {
      constructor(db) {
        this.db = db;
        this._selectByName = db.prepare(
          "SELECT * FROM models WHERE name = ?"
        );
        this._selectActive = db.prepare(
          "SELECT * FROM models WHERE active = 1 ORDER BY id DESC LIMIT 1"
        );
        this._selectById = db.prepare(
          "SELECT * FROM models WHERE id = ?"
        );
        this._insert = db.prepare(`
      INSERT INTO models (name, provider, dim, created_at, active)
      VALUES (@name, @provider, @dim, @created_at, 1)
    `);
        this._deactivateAll = db.prepare("UPDATE models SET active = 0");
        this._activate = db.prepare(
          "UPDATE models SET active = 1 WHERE id = ?"
        );
        this._listAll = db.prepare(
          "SELECT * FROM models ORDER BY id"
        );
      }
      db;
      _selectByName;
      _selectActive;
      _selectById;
      _insert;
      _deactivateAll;
      _activate;
      _listAll;
      upsert(input) {
        const existing = this._selectByName.get(input.name);
        if (existing) return existing;
        const info = this._insert.run({
          name: input.name,
          provider: input.provider,
          dim: input.dim,
          created_at: Date.now()
        });
        const row = this._selectById.get(Number(info.lastInsertRowid));
        if (!row) {
          throw new Error("models.upsert: row vanished after insert");
        }
        return row;
      }
      getById(modelId) {
        return this._selectById.get(modelId) ?? null;
      }
      getActive() {
        return this._selectActive.get() ?? null;
      }
      setActive(modelId) {
        const tx = this.db.transaction(() => {
          this._deactivateAll.run();
          this._activate.run(modelId);
        });
        tx();
      }
      listAll() {
        return this._listAll.all();
      }
    };
  }
});

// src/db/queries/fts.ts
var FtsQueries;
var init_fts = __esm({
  "src/db/queries/fts.ts"() {
    "use strict";
    init_esm_shims();
    FtsQueries = class _FtsQueries {
      _search;
      _searchWithSnippet;
      constructor(db) {
        this._search = db.prepare(
          `SELECT rowid AS chunkId, bm25(chunks_fts) AS score
       FROM chunks_fts
       WHERE chunks_fts MATCH ?
       ORDER BY bm25(chunks_fts) ASC
       LIMIT ?`
        );
        this._searchWithSnippet = db.prepare(
          `SELECT
         rowid AS chunkId,
         bm25(chunks_fts) AS score,
         snippet(chunks_fts, 0, '<mark>', '</mark>', '...', 64) AS snippet
       FROM chunks_fts
       WHERE chunks_fts MATCH ?
       ORDER BY bm25(chunks_fts) ASC
       LIMIT ?`
        );
      }
      search(query, topK, withSnippet = false) {
        const sanitized = _FtsQueries.sanitize(query);
        if (sanitized.length === 0) return [];
        if (withSnippet) {
          const rows2 = this._searchWithSnippet.all(sanitized, topK);
          return rows2.map((r) => ({
            chunkId: r.chunkId,
            score: -r.score,
            snippet: r.snippet
          }));
        }
        const rows = this._search.all(sanitized, topK);
        return rows.map((r) => ({ chunkId: r.chunkId, score: -r.score }));
      }
      /**
       * Conservative sanitizer for FTS5 MATCH input.
       *
       * Strategy: strip characters that have special FTS5 meaning when the user
       * likely didn't intend them, while preserving advanced syntax for users
       * who know what they're doing (AND/OR/NOT, NEAR, trailing `*` prefix).
       *
       * - Double quotes are removed unless balanced (unbalanced quote → phrase
       *   parse error). We strip them all unconditionally to keep this simple
       *   and predictable — phrase queries can be re-introduced by callers that
       *   construct queries programmatically.
       * - Parentheses are kept only when balanced; otherwise stripped.
       * - Colons (column filters) are stripped — `chunks_fts` only has one
       *   column, so column filters are never useful and cause errors.
       * - Tokens containing FTS5-reserved punctuation that doesn't have a sane
       *   meaning here (`-`, `/`, `?`, `.`, `!`) are wrapped in double quotes so
       *   FTS5 treats them as literal phrases. This is what makes natural
       *   queries like "LAG-EPIX", "Netzwerk/Personen", or "Wer ist X?" work.
       *   See the v0.6.0 retrieval eval (vault note `_research/vault-memory-eval.md`)
       *   for the discovered crash triggers.
       * - Leading operator tokens at fragment boundaries are dropped (FTS5
       *   errors on a trailing `AND`/`OR`).
       * - Whitespace is normalized.
       *
       * If the cleaned result is empty, returns "".
       */
      static sanitize(userQuery) {
        let s = userQuery.replace(/"/g, " ").replace(/:/g, " ");
        let depth = 0;
        let balanced = true;
        for (const ch of s) {
          if (ch === "(") depth++;
          else if (ch === ")") {
            depth--;
            if (depth < 0) {
              balanced = false;
              break;
            }
          }
        }
        if (!balanced || depth !== 0) {
          s = s.replace(/[()]/g, " ");
        }
        s = s.replace(/\s+/g, " ").trim();
        if (s.length === 0) return "";
        const trailingOpRe = /\s+(AND|OR|NOT|NEAR)$/;
        while (trailingOpRe.test(s)) {
          s = s.replace(trailingOpRe, "");
        }
        s = s.replace(/^(AND|OR|NOT|NEAR)\s+/, "");
        s = s.trim();
        if (s.length === 0) return "";
        const needsPhrase = /[-/.?!\\]/;
        const isOperator = /^(AND|OR|NOT|NEAR)$/;
        const isPrefixStar = /^[^*\s]+\*$/;
        const tokens = s.split(/\s+/).map((t) => {
          if (t.length === 0) return t;
          if (isOperator.test(t)) return t;
          if (isPrefixStar.test(t)) return t;
          if (needsPhrase.test(t)) return `"${t}"`;
          return t;
        });
        return tokens.filter((t) => t.length > 0).join(" ");
      }
    };
  }
});

// src/db/queries/aliases.ts
var AliasesQueries;
var init_aliases = __esm({
  "src/db/queries/aliases.ts"() {
    "use strict";
    init_esm_shims();
    AliasesQueries = class _AliasesQueries {
      setStmt;
      deleteStmt;
      listForNoteStmt;
      resolveStmt;
      constructor(db) {
        this.setStmt = db.prepare(
          `INSERT OR IGNORE INTO note_aliases (note_id, alias, alias_norm)
       VALUES (?, ?, ?)`
        );
        this.deleteStmt = db.prepare(
          `DELETE FROM note_aliases WHERE note_id = ?`
        );
        this.listForNoteStmt = db.prepare(
          `SELECT alias FROM note_aliases WHERE note_id = ? ORDER BY id ASC`
        );
        this.resolveStmt = db.prepare(
          `SELECT na.note_id AS note_id, n.path AS path, na.alias AS alias
       FROM note_aliases na
       JOIN notes n ON n.id = na.note_id
       WHERE na.alias_norm = ?
       ORDER BY length(n.path) ASC
       LIMIT 1`
        );
      }
      /**
       * Replace all aliases for a note with the given list (atomic).
       * Empty list → clears all aliases for the note.
       */
      setForNote(noteId, aliases) {
        this.deleteStmt.run(noteId);
        for (const a of aliases) {
          const trimmed = a.trim();
          if (trimmed.length === 0) continue;
          this.setStmt.run(noteId, trimmed, _AliasesQueries.normalize(trimmed));
        }
      }
      /**
       * Find the note that owns the given alias (case-insensitive).
       * If multiple notes claim the same alias, the one with the shortest
       * path wins (mirrors Obsidian's heuristic).
       */
      resolve(alias) {
        const norm = _AliasesQueries.normalize(alias);
        if (norm.length === 0) return null;
        return this.resolveStmt.get(norm) ?? null;
      }
      listForNote(noteId) {
        const rows = this.listForNoteStmt.all(noteId);
        return rows.map((r) => r.alias);
      }
      static normalize(alias) {
        return alias.trim().toLowerCase();
      }
    };
  }
});

// src/db/database.ts
import BetterSqlite3 from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
function loadSqliteVec(db) {
  try {
    sqliteVec.load(db);
  } catch (err) {
    const arch = process.arch;
    const platform = process.platform;
    const msg = `Failed to load sqlite-vec extension (platform=${platform}, arch=${arch}). Ensure the matching prebuilt binary (sqlite-vec-${platform}-${arch}) is installed. On Apple Silicon, install sqlite-vec-darwin-arm64.`;
    throw new Error(`${msg}
Original: ${err.message}`);
  }
}
var Database;
var init_database = __esm({
  "src/db/database.ts"() {
    "use strict";
    init_esm_shims();
    init_schema();
    init_notes();
    init_chunks();
    init_embeddings();
    init_wikilinks();
    init_audit();
    init_models();
    init_fts();
    init_aliases();
    Database = class _Database {
      handle;
      notes;
      chunks;
      embeddings;
      wikilinks;
      audit;
      models;
      fts;
      aliases;
      constructor(dbPath) {
        this.handle = new BetterSqlite3(dbPath);
        if (dbPath !== ":memory:") {
          this.handle.pragma("journal_mode = WAL");
        }
        this.handle.pragma("foreign_keys = ON");
        this.handle.pragma("synchronous = NORMAL");
        loadSqliteVec(this.handle);
        this.migrateInternal();
        this.notes = new NotesQueries(this.handle);
        this.chunks = new ChunksQueries(this.handle);
        this.models = new ModelsQueries(this.handle);
        this.embeddings = new EmbeddingsQueries(this.handle, this.models);
        this.wikilinks = new WikilinksQueries(this.handle);
        this.audit = new AuditQueries(this.handle);
        this.fts = new FtsQueries(this.handle);
        this.aliases = new AliasesQueries(this.handle);
      }
      static async open(dbPath) {
        return new _Database(dbPath);
      }
      close() {
        this.handle.close();
      }
      getSchemaVersion() {
        const row = this.handle.pragma("user_version");
        return row[0]?.user_version ?? 0;
      }
      /**
       * Idempotent: applies pending migrations and bumps PRAGMA user_version.
       * Called automatically during construction; safe to call again.
       */
      migrate() {
        this.migrateInternal();
      }
      migrateInternal() {
        const current = this.getSchemaVersion();
        const pending = MIGRATIONS.filter((m) => m.version > current).sort(
          (a, b) => a.version - b.version
        );
        if (pending.length === 0) return;
        const fkWasOn = this.handle.pragma("foreign_keys", { simple: true }) === 1;
        if (fkWasOn) this.handle.pragma("foreign_keys = OFF");
        let highest = current;
        try {
          const tx = this.handle.transaction(() => {
            for (const m of pending) {
              this.handle.exec(m.sql);
              highest = m.version;
            }
          });
          tx();
          const violations = this.handle.pragma("foreign_key_check");
          if (violations.length > 0) {
            throw new Error(
              `Migration to v${highest} produced foreign-key violations: ${JSON.stringify(violations)}`
            );
          }
          this.handle.pragma(`user_version = ${highest}`);
        } finally {
          if (fkWasOn) this.handle.pragma("foreign_keys = ON");
        }
      }
      transaction(fn) {
        return this.handle.transaction(fn)();
      }
    };
  }
});

// src/db/index.ts
var init_db = __esm({
  "src/db/index.ts"() {
    "use strict";
    init_esm_shims();
    init_database();
    init_schema();
    init_notes();
    init_chunks();
    init_embeddings();
    init_wikilinks();
    init_audit();
    init_models();
    init_fts();
    init_aliases();
  }
});

// src/vault/manager.ts
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";
import { mkdir } from "fs/promises";
var VaultManager;
var init_manager = __esm({
  "src/vault/manager.ts"() {
    "use strict";
    init_esm_shims();
    init_db();
    VaultManager = class _VaultManager {
      vaults = /* @__PURE__ */ new Map();
      static dbDirectory() {
        return join2(homedir2(), ".vault-memory", "vaults");
      }
      static dbPathFor(vaultName) {
        return join2(_VaultManager.dbDirectory(), `${vaultName}.db`);
      }
      /**
       * Initialize all vaults from config. Creates DB files if missing, runs
       * migrations. Idempotent — safe to call multiple times.
       */
      async loadAll(configs) {
        await mkdir(_VaultManager.dbDirectory(), { recursive: true });
        for (const cfg of configs) {
          if (this.vaults.has(cfg.name)) continue;
          const dbPath = _VaultManager.dbPathFor(cfg.name);
          const db = new Database(dbPath);
          db.migrate();
          this.vaults.set(cfg.name, { config: cfg, db, dbPath });
        }
      }
      get(name) {
        return this.vaults.get(name) ?? null;
      }
      /**
       * Get a vault or throw with a helpful message.
       */
      require(name) {
        const v = this.vaults.get(name);
        if (!v) {
          const known = [...this.vaults.keys()].join(", ") || "(none)";
          throw new Error(
            `Unknown vault: "${name}". Configured vaults: ${known}`
          );
        }
        return v;
      }
      list() {
        return [...this.vaults.values()];
      }
      closeAll() {
        for (const v of this.vaults.values()) {
          v.db.close();
        }
        this.vaults.clear();
      }
    };
  }
});

// src/vault/index.ts
var vault_exports = {};
__export(vault_exports, {
  VaultManager: () => VaultManager
});
var init_vault = __esm({
  "src/vault/index.ts"() {
    "use strict";
    init_esm_shims();
    init_manager();
  }
});

// src/ollama/retry.ts
function sleep(ms) {
  return new Promise((resolve5) => setTimeout(resolve5, ms));
}
function computeDelay(attempt, baseDelayMs, maxDelayMs) {
  const exp = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 100);
  return Math.min(exp + jitter, maxDelayMs);
}
async function withRetry(fn, options) {
  const retries = options.retries;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const shouldRetry = options.shouldRetry ?? (() => true);
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      if (!shouldRetry(err)) break;
      const delay = computeDelay(attempt, baseDelayMs, maxDelayMs);
      await sleep(delay);
    }
  }
  throw lastError;
}
var DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_DELAY_MS;
var init_retry = __esm({
  "src/ollama/retry.ts"() {
    "use strict";
    init_esm_shims();
    DEFAULT_BASE_DELAY_MS = 100;
    DEFAULT_MAX_DELAY_MS = 5e3;
  }
});

// src/ollama/client.ts
import { z as z2 } from "zod";
function isRetryable(err) {
  if (err instanceof OllamaHttpError) {
    return err.status >= 500 && err.status < 600;
  }
  if (err instanceof Error && err.name === "AbortError") return true;
  if (err instanceof TypeError) return true;
  return false;
}
function stripTag(name) {
  const idx = name.indexOf(":");
  return idx === -1 ? name : name.slice(0, idx);
}
var DEFAULT_ENDPOINT, DEFAULT_BATCH_SIZE, DEFAULT_TIMEOUT_MS, DEFAULT_RETRIES, EmbedResponseSchema, TagsResponseSchema, OllamaHttpError, OllamaClient;
var init_client = __esm({
  "src/ollama/client.ts"() {
    "use strict";
    init_esm_shims();
    init_retry();
    DEFAULT_ENDPOINT = "http://localhost:11434";
    DEFAULT_BATCH_SIZE = 10;
    DEFAULT_TIMEOUT_MS = 3e4;
    DEFAULT_RETRIES = 3;
    EmbedResponseSchema = z2.object({
      embeddings: z2.array(z2.array(z2.number())),
      model: z2.string().optional()
    });
    TagsResponseSchema = z2.object({
      models: z2.array(
        z2.object({
          name: z2.string()
        })
      )
    });
    OllamaHttpError = class extends Error {
      status;
      constructor(status, message) {
        super(message);
        this.name = "OllamaHttpError";
        this.status = status;
      }
    };
    OllamaClient = class {
      endpoint;
      batchSize;
      timeoutMs;
      retries;
      constructor(options = {}) {
        this.endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, "");
        this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.retries = options.retries ?? DEFAULT_RETRIES;
      }
      /**
       * Generate embeddings for the request's texts.
       *
       * If `texts.length > batchSize`, splits into multiple parallel HTTP requests
       * and concatenates the resulting vectors in order.
       */
      async embed(request) {
        const { model, texts } = request;
        if (texts.length === 0) {
          return { vectors: [], dim: 0, model };
        }
        const batches = [];
        for (let i = 0; i < texts.length; i += this.batchSize) {
          batches.push(texts.slice(i, i + this.batchSize));
        }
        const results = await Promise.all(
          batches.map((batch) => this.embedBatch(model, batch))
        );
        const vectors = [];
        let confirmedModel = model;
        for (const res of results) {
          vectors.push(...res.embeddings);
          if (res.model !== void 0) confirmedModel = res.model;
        }
        const first = vectors[0];
        if (first === void 0) {
          return { vectors, dim: 0, model: confirmedModel };
        }
        const dim = first.length;
        return { vectors, dim, model: confirmedModel };
      }
      async embedBatch(model, texts) {
        return withRetry(
          async () => {
            const body = JSON.stringify({ model, input: texts });
            const response = await this.fetchWithTimeout(
              `${this.endpoint}/api/embed`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body
              }
            );
            if (!response.ok) {
              const text = await response.text().catch(() => "");
              throw new OllamaHttpError(
                response.status,
                `Ollama /api/embed returned ${response.status}: ${text}`
              );
            }
            const json = await response.json();
            const parsed = EmbedResponseSchema.parse(json);
            return { embeddings: parsed.embeddings, model: parsed.model };
          },
          { retries: this.retries, shouldRetry: isRetryable }
        );
      }
      /**
       * Check Ollama server liveness and return loaded model names.
       */
      async healthCheck() {
        try {
          const response = await this.fetchWithTimeout(
            `${this.endpoint}/api/tags`,
            { method: "GET" }
          );
          if (!response.ok) {
            return {
              ok: false,
              error: `HTTP ${response.status}`
            };
          }
          const json = await response.json();
          const parsed = TagsResponseSchema.parse(json);
          return { ok: true, models: parsed.models.map((m) => m.name) };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { ok: false, error: message };
        }
      }
      /**
       * True iff `modelName` is loaded on the server.
       *
       * Matches both fully-qualified names ("qwen3-embedding:latest") and
       * tag-less names ("qwen3-embedding"): each is matched against the other
       * after stripping the `:tag` suffix.
       */
      async modelExists(modelName) {
        const health = await this.healthCheck();
        if (!health.ok || health.models === void 0) return false;
        const wantBase = stripTag(modelName);
        for (const name of health.models) {
          if (name === modelName) return true;
          if (stripTag(name) === wantBase) return true;
        }
        return false;
      }
      async fetchWithTimeout(url, init) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          return await fetch(url, { ...init, signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
      }
    };
  }
});

// src/ollama/index.ts
var ollama_exports = {};
__export(ollama_exports, {
  OllamaClient: () => OllamaClient,
  OllamaHttpError: () => OllamaHttpError,
  withRetry: () => withRetry
});
var init_ollama = __esm({
  "src/ollama/index.ts"() {
    "use strict";
    init_esm_shims();
    init_client();
    init_retry();
  }
});

// src/search/hybrid.ts
function rrfMerge(rankings, k = DEFAULT_RRF_K) {
  const scores = /* @__PURE__ */ new Map();
  rankings.forEach((list, listIdx) => {
    list.items.forEach((item, i) => {
      const rank = i + 1;
      const contribution = 1 / (k + rank);
      const existing = scores.get(item);
      if (existing) {
        existing.rrf += contribution;
        existing.ranks[listIdx] = rank;
      } else {
        const ranks = new Array(rankings.length).fill(
          void 0
        );
        ranks[listIdx] = rank;
        scores.set(item, { rrf: contribution, ranks });
      }
    });
  });
  const out = [];
  for (const [item, v] of scores) {
    out.push({ item, rrf: v.rrf, ranks: v.ranks });
  }
  out.sort((a, b) => {
    if (b.rrf !== a.rrf) return b.rrf - a.rrf;
    return minDefined(a.ranks) - minDefined(b.ranks);
  });
  return out;
}
function minDefined(xs) {
  let m = Number.POSITIVE_INFINITY;
  for (const x of xs) {
    if (x !== void 0 && x < m) m = x;
  }
  return m;
}
async function hybridSearch(opts) {
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const rrfK = opts.rrfK ?? DEFAULT_RRF_K;
  const includeBreakdown = opts.includeBreakdown ?? true;
  const query = opts.query.trim();
  if (topK <= 0 || query.length === 0 || opts.vaults.length === 0) {
    return [];
  }
  const embedCache = /* @__PURE__ */ new Map();
  const getQueryVector = (model) => {
    const cached = embedCache.get(model);
    if (cached) return cached;
    const p = (async () => {
      try {
        const res = await opts.ollama.embed({ model, texts: [query] });
        const v = res.vectors[0];
        return v ?? null;
      } catch {
        return null;
      }
    })();
    embedCache.set(model, p);
    return p;
  };
  const rerankFanOut = Math.max(1, opts.rerankFanOut ?? 3);
  const perVaultTopN = opts.reranker ? topK * rerankFanOut : topK;
  const perVault = await Promise.all(
    opts.vaults.map(
      (vault) => searchOneVault(
        vault,
        query,
        opts.embeddingModel,
        rrfK,
        perVaultTopN,
        getQueryVector
      )
    )
  );
  const flat = perVault.flat();
  flat.sort((a, b) => b.rrf - a.rrf);
  let winners;
  if (opts.reranker && flat.length > 0) {
    const poolSize = Math.min(flat.length, topK * rerankFanOut);
    const pool = flat.slice(0, poolSize);
    const vaultByNameLocal = /* @__PURE__ */ new Map();
    for (const v of opts.vaults) vaultByNameLocal.set(v.config.name, v);
    const texts = [];
    const indexed = [];
    for (const h of pool) {
      const vault = vaultByNameLocal.get(h.vaultName);
      if (!vault) continue;
      const chunk = vault.db.chunks.getById(h.chunkId);
      if (!chunk) continue;
      indexed.push({ hit: h, text: chunk.text });
      texts.push(chunk.text);
    }
    try {
      const scores = await opts.reranker.score(query, texts);
      if (scores.length !== indexed.length) {
        throw new Error(
          `reranker returned ${scores.length} scores for ${indexed.length} chunks`
        );
      }
      for (let i = 0; i < indexed.length; i++) {
        const entry = indexed[i];
        const s = scores[i];
        entry.hit.rerankScore = s;
      }
      const reranked = indexed.map((e) => e.hit);
      reranked.sort((a, b) => {
        const ra = a.rerankScore ?? Number.NEGATIVE_INFINITY;
        const rb = b.rerankScore ?? Number.NEGATIVE_INFINITY;
        if (rb !== ra) return rb - ra;
        return b.rrf - a.rrf;
      });
      winners = reranked.slice(0, topK);
    } catch {
      for (const h of pool) delete h.rerankScore;
      winners = flat.slice(0, topK);
    }
  } else {
    winners = flat.slice(0, topK);
  }
  const vaultByName = /* @__PURE__ */ new Map();
  for (const v of opts.vaults) vaultByName.set(v.config.name, v);
  const hits = [];
  for (const h of winners) {
    const vault = vaultByName.get(h.vaultName);
    if (!vault) continue;
    const chunk = vault.db.chunks.getById(h.chunkId);
    if (!chunk) continue;
    const note = vault.db.notes.getById(chunk.note_id);
    if (!note) continue;
    const hit = {
      vault: vault.config.name,
      notePath: note.path,
      noteTitle: note.title,
      chunkText: chunk.text,
      chunkIdx: chunk.idx,
      headingPath: chunk.heading_path,
      // Surface the rerank score as the primary score when present —
      // it's the final order the caller sees.
      score: h.rerankScore ?? h.rrf
    };
    if (includeBreakdown) {
      const breakdown = {
        rrf: h.rrf
      };
      if (h.semanticScore !== void 0) breakdown.semantic = h.semanticScore;
      if (h.textScore !== void 0) breakdown.text = h.textScore;
      if (h.rerankScore !== void 0) breakdown.rerank = h.rerankScore;
      hit.scoreBreakdown = breakdown;
    }
    hits.push(hit);
  }
  return hits;
}
async function searchOneVault(vault, query, embeddingModelName, rrfK, topK, getQueryVector) {
  const fanK = Math.max(topK * 3, topK);
  const activeModel = vault.db.models.getActive();
  const canRunSemantic = activeModel !== null && activeModel.name === embeddingModelName;
  const semanticPromise = canRunSemantic ? (async () => {
    const vec = await getQueryVector(embeddingModelName);
    if (!vec) return null;
    const hits = vault.db.embeddings.searchSemantic(
      activeModel.id,
      vec,
      fanK
    );
    const distances = /* @__PURE__ */ new Map();
    const chunkIds = [];
    for (const h of hits) {
      chunkIds.push(h.chunkId);
      distances.set(h.chunkId, h.distance);
    }
    return { chunkIds, distances };
  })() : Promise.resolve(null);
  const bm25Promise = Promise.resolve().then(() => {
    const hits = vault.db.fts.search(query, fanK);
    const scores = /* @__PURE__ */ new Map();
    const chunkIds = [];
    for (const h of hits) {
      chunkIds.push(h.chunkId);
      scores.set(h.chunkId, h.score);
    }
    return { chunkIds, scores };
  });
  const [semantic, bm25] = await Promise.all([semanticPromise, bm25Promise]);
  const rankings = [];
  if (semantic && semantic.chunkIds.length > 0) {
    rankings.push({ items: semantic.chunkIds, scores: semantic.distances });
  }
  if (bm25.chunkIds.length > 0) {
    rankings.push({ items: bm25.chunkIds, scores: bm25.scores });
  }
  if (rankings.length === 0) return [];
  const semanticListIdx = semantic && semantic.chunkIds.length > 0 ? 0 : -1;
  const bm25ListIdx = rankings.length === 2 ? 1 : semanticListIdx === -1 ? 0 : -1;
  const merged = rrfMerge(rankings, rrfK).slice(0, topK);
  return merged.map((m) => {
    const hit = {
      vaultName: vault.config.name,
      chunkId: m.item,
      rrf: m.rrf
    };
    if (semanticListIdx !== -1 && m.ranks[semanticListIdx] !== void 0) {
      const d = semantic.distances.get(m.item);
      if (d !== void 0) hit.semanticScore = d;
    }
    if (bm25ListIdx !== -1 && m.ranks[bm25ListIdx] !== void 0) {
      const s = bm25.scores.get(m.item);
      if (s !== void 0) hit.textScore = s;
    }
    return hit;
  });
}
var DEFAULT_TOP_K, DEFAULT_RRF_K;
var init_hybrid = __esm({
  "src/search/hybrid.ts"() {
    "use strict";
    init_esm_shims();
    DEFAULT_TOP_K = 10;
    DEFAULT_RRF_K = 60;
  }
});

// src/search/glob.ts
function compile(pattern) {
  const cached = cache.get(pattern);
  if (cached) return cached;
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
  }
  const compiled = new RegExp(`^${re}$`);
  cache.set(pattern, compiled);
  return compiled;
}
function matchesAnyGlob(path5, patterns) {
  for (const p of patterns) {
    if (compile(p).test(path5)) return true;
  }
  return false;
}
var cache;
var init_glob = __esm({
  "src/search/glob.ts"() {
    "use strict";
    init_esm_shims();
    cache = /* @__PURE__ */ new Map();
  }
});

// src/search/index.ts
var init_search = __esm({
  "src/search/index.ts"() {
    "use strict";
    init_esm_shims();
    init_hybrid();
    init_glob();
  }
});

// src/rerank/reranker.ts
function formatPair(query, doc) {
  return `Query: ${query}

Document: ${doc}

Relevance:`;
}
function l2Norm(v) {
  let sum = 0;
  for (const x of v) sum += x * x;
  return Math.sqrt(sum);
}
var OllamaReranker;
var init_reranker = __esm({
  "src/rerank/reranker.ts"() {
    "use strict";
    init_esm_shims();
    OllamaReranker = class {
      ollama;
      model;
      constructor(opts) {
        this.ollama = opts.ollama;
        this.model = opts.model;
      }
      async score(query, chunks) {
        if (chunks.length === 0) return [];
        const inputs = chunks.map((c) => formatPair(query, c));
        const res = await this.ollama.embed({ model: this.model, texts: inputs });
        if (res.vectors.length !== chunks.length) {
          throw new Error(
            `Reranker: expected ${chunks.length} vectors, got ${res.vectors.length}`
          );
        }
        return res.vectors.map((v) => -l2Norm(v));
      }
    };
  }
});

// src/rerank/index.ts
var init_rerank = __esm({
  "src/rerank/index.ts"() {
    "use strict";
    init_esm_shims();
    init_reranker();
  }
});

// src/graph/graph.ts
function listBacklinks(vault, notePath) {
  const note = vault.db.notes.getByPath(notePath);
  if (!note) {
    throw new Error(`Note not found: ${notePath}`);
  }
  const rows = vault.db.wikilinks.getBacklinks(note.id);
  const results = [];
  for (const row of rows) {
    const src = vault.db.notes.getById(row.sourceNoteId);
    if (!src) continue;
    results.push({
      sourcePath: src.path,
      sourceTitle: src.title,
      lineNumber: row.lineNumber,
      linkText: row.linkText
    });
  }
  return results;
}
function listForwardLinks(vault, notePath, includeBroken = true) {
  const note = vault.db.notes.getByPath(notePath);
  if (!note) {
    throw new Error(`Note not found: ${notePath}`);
  }
  const rows = vault.db.wikilinks.getForwardLinks(note.id);
  const results = [];
  for (const row of rows) {
    const resolved = row.targetNoteId !== null;
    if (!resolved && !includeBroken) continue;
    let targetTitle = null;
    if (resolved && row.targetNoteId !== null) {
      const target = vault.db.notes.getById(row.targetNoteId);
      targetTitle = target?.title ?? null;
    }
    results.push({
      targetPath: row.targetPath,
      resolved,
      targetTitle,
      anchor: row.anchor,
      linkText: row.linkText
    });
  }
  return results;
}
function findBrokenLinks(vault) {
  const rows = vault.db.wikilinks.resolveBrokenLinks();
  if (rows.length === 0) return [];
  const noteCache = /* @__PURE__ */ new Map();
  const results = [];
  for (const row of rows) {
    let src = noteCache.get(row.sourceNoteId);
    if (!src) {
      const n = vault.db.notes.getById(row.sourceNoteId);
      if (!n) continue;
      src = { path: n.path, title: n.title };
      noteCache.set(row.sourceNoteId, src);
    }
    results.push({
      sourcePath: src.path,
      sourceTitle: src.title,
      targetPath: row.targetPath,
      lineNumber: null
    });
  }
  return results;
}
var init_graph = __esm({
  "src/graph/graph.ts"() {
    "use strict";
    init_esm_shims();
  }
});

// src/graph/index.ts
var init_graph2 = __esm({
  "src/graph/index.ts"() {
    "use strict";
    init_esm_shims();
    init_graph();
  }
});

// src/frontmatter/query.ts
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function buildJsonPath(field) {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(field)) {
    throw new Error(
      `Invalid frontmatter field: "${field}". Use dot.notation with alphanumeric segments.`
    );
  }
  const parts = field.split(".");
  if (parts.length > MAX_FIELD_DEPTH) {
    throw new Error(`Field depth exceeds maximum (${MAX_FIELD_DEPTH}): ${field}`);
  }
  return "$." + parts.map((p) => /^\d+$/.test(p) ? `[${p}]` : p).join(".");
}
function compileClause(field, predicate) {
  const jsonPath = buildJsonPath(field);
  const extract = `json_extract(frontmatter, '${jsonPath}')`;
  if (predicate === null || typeof predicate !== "object") {
    if (predicate === null) {
      return { sql: `${extract} IS NULL`, params: [] };
    }
    return { sql: `${extract} = ?`, params: [predicate] };
  }
  if (isPlainObject(predicate)) {
    if ("$in" in predicate) {
      const values = predicate.$in;
      if (!Array.isArray(values) || values.length === 0) {
        return { sql: "0", params: [] };
      }
      const placeholders = values.map(() => "?").join(", ");
      return { sql: `${extract} IN (${placeholders})`, params: [...values] };
    }
    if ("$exists" in predicate) {
      return {
        sql: predicate.$exists ? `${extract} IS NOT NULL` : `${extract} IS NULL`,
        params: []
      };
    }
    if ("$contains" in predicate) {
      return {
        sql: `EXISTS (SELECT 1 FROM json_each(frontmatter, '${jsonPath}') WHERE value = ?)`,
        params: [predicate.$contains]
      };
    }
  }
  throw new Error(`Unsupported predicate for field "${field}": ${JSON.stringify(predicate)}`);
}
function queryFrontmatter(vault, input) {
  const clauses = [];
  for (const [field, predicate] of Object.entries(input.where)) {
    clauses.push(compileClause(field, predicate));
  }
  if (clauses.length === 0) {
    return vault.db.notes.listAll(input.limit ?? 100);
  }
  const where = clauses.map((c) => `(${c.sql})`).join(" AND ");
  const params = clauses.flatMap((c) => c.params);
  const limit = Math.min(Math.max(1, input.limit ?? 100), 1e3);
  const stmt = vault.db.handle.prepare(
    `SELECT * FROM notes WHERE frontmatter IS NOT NULL AND ${where} ORDER BY mtime DESC LIMIT ${limit}`
  );
  return stmt.all(...params);
}
var MAX_FIELD_DEPTH;
var init_query = __esm({
  "src/frontmatter/query.ts"() {
    "use strict";
    init_esm_shims();
    MAX_FIELD_DEPTH = 5;
  }
});

// src/reader/hash.ts
import { createHash } from "crypto";
function sha256(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
function canonicalJsonStringify(value) {
  if (value === null || value === void 0) return "null";
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalJsonStringify(v)).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value;
    const keys = Object.keys(obj).sort();
    const parts = keys.map(
      (k) => JSON.stringify(k) + ":" + canonicalJsonStringify(obj[k])
    );
    return "{" + parts.join(",") + "}";
  }
  const s = JSON.stringify(value);
  return s === void 0 ? "null" : s;
}
function computeNoteHash(content, frontmatter) {
  return sha256(content + canonicalJsonStringify(frontmatter ?? {}));
}
var init_hash = __esm({
  "src/reader/hash.ts"() {
    "use strict";
    init_esm_shims();
  }
});

// src/reader/scanner.ts
import { promises as fs } from "fs";
import * as path2 from "path";
async function scanVault(rootPath, options) {
  const root = path2.resolve(rootPath);
  const excludes = options?.excludeGlobs ?? DEFAULT_EXCLUDES;
  const matchers = excludes.map(compileGlob);
  const results = [];
  await walk(root, root, matchers, results);
  results.sort();
  return results;
}
async function walk(root, dir, matchers, out) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path2.join(dir, entry.name);
    const rel = toPosix(path2.relative(root, abs));
    if (rel.length === 0) continue;
    if (isExcluded(rel, matchers)) continue;
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      await walk(root, abs, matchers, out);
    } else if (entry.isFile() && abs.toLowerCase().endsWith(".md")) {
      out.push(abs);
    }
  }
}
function isExcluded(relPath, matchers) {
  for (const re of matchers) {
    if (re.test(relPath)) return true;
  }
  return false;
}
function toPosix(p) {
  return p.split(path2.sep).join("/");
}
function compileGlob(glob) {
  const trimmed = glob.replace(/^\.\//, "");
  const altDir = trimmed.endsWith("/**") ? trimmed.slice(0, -3) : null;
  const toRe = (g) => {
    let re = "";
    for (let i = 0; i < g.length; i++) {
      const c = g[i];
      if (c === void 0) continue;
      if (c === "*") {
        if (g[i + 1] === "*") {
          re += ".*";
          i++;
        } else {
          re += "[^/]*";
        }
      } else if (c === "?") {
        re += "[^/]";
      } else if (/[.+^${}()|[\]\\]/.test(c)) {
        re += "\\" + c;
      } else {
        re += c;
      }
    }
    return re;
  };
  const parts = [toRe(trimmed)];
  if (altDir !== null) parts.push(toRe(altDir));
  return new RegExp("^(?:" + parts.join("|") + ")$");
}
var DEFAULT_EXCLUDES;
var init_scanner = __esm({
  "src/reader/scanner.ts"() {
    "use strict";
    init_esm_shims();
    DEFAULT_EXCLUDES = [".obsidian/**", ".trash/**", "node_modules/**"];
  }
});

// src/reader/wikilinks.ts
function extractWikilinks(content) {
  const masked = maskFencedCodeBlocks(content);
  const results = [];
  const lineStarts = [0];
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === "\n") lineStarts.push(i + 1);
  }
  WIKILINK_RE.lastIndex = 0;
  let match;
  while ((match = WIKILINK_RE.exec(masked)) !== null) {
    const prefix = match[1] ?? "";
    const inner = match[2];
    if (inner === void 0) continue;
    const innerStart = match.index + prefix.length + 2;
    const parsed = parseInner(inner);
    if (parsed === null) continue;
    const line = lineOf(lineStarts, innerStart);
    results.push({ ...parsed, line });
  }
  return results;
}
function parseInner(inner) {
  let target = inner;
  let alias = null;
  const pipeIdx = inner.indexOf("|");
  if (pipeIdx >= 0) {
    target = inner.slice(0, pipeIdx);
    alias = inner.slice(pipeIdx + 1).trim();
    if (alias.length === 0) alias = null;
  }
  let rawTarget = target;
  let anchor = null;
  const hashIdx = target.indexOf("#");
  if (hashIdx >= 0) {
    rawTarget = target.slice(0, hashIdx);
    anchor = target.slice(hashIdx + 1).trim();
    if (anchor.length === 0) anchor = null;
  }
  rawTarget = rawTarget.trim();
  if (rawTarget.length === 0) return null;
  const normalizedTarget = normalizeTarget(rawTarget);
  return { rawTarget, normalizedTarget, anchor, alias };
}
function normalizeTarget(raw) {
  let t = raw.replace(/\\/g, "/");
  t = t.replace(/\.md$/i, "");
  return t;
}
function lineOf(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = lo + hi + 1 >>> 1;
    const v = lineStarts[mid];
    if (v !== void 0 && v <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
function maskFencedCodeBlocks(content) {
  const chars = content.split("");
  const fenceRe = /^([ \t]*)(`{3,}|~{3,})([^\n]*)$/gm;
  const lines = content.split("\n");
  let inFence = false;
  let fenceMarker = "";
  let absOffset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trimStart();
    if (!inFence) {
      const m = /^(`{3,}|~{3,})/.exec(trimmed);
      if (m !== null && m[1] !== void 0) {
        inFence = true;
        fenceMarker = m[1][0] ?? "`";
      }
    } else {
      const m = /^(`{3,}|~{3,})\s*$/.exec(trimmed);
      if (m !== null && m[1] !== void 0 && m[1][0] === fenceMarker) {
        inFence = false;
      } else {
        for (let j = 0; j < line.length; j++) {
          chars[absOffset + j] = " ";
        }
      }
    }
    absOffset += line.length + 1;
  }
  void fenceRe;
  return chars.join("");
}
var WIKILINK_RE;
var init_wikilinks2 = __esm({
  "src/reader/wikilinks.ts"() {
    "use strict";
    init_esm_shims();
    WIKILINK_RE = /(^|[^!])\[\[([^\[\]\n]+?)\]\]/g;
  }
});

// src/reader/parser.ts
import { promises as fs2 } from "fs";
import * as path3 from "path";
import matter from "gray-matter";
async function parseNote(absolutePath, vaultRoot) {
  const raw = await fs2.readFile(absolutePath, "utf-8");
  const stat = await fs2.stat(absolutePath);
  const parsed = matter(raw);
  const content = parsed.content;
  const fmData = parsed.data;
  const frontmatter = fmData !== void 0 && Object.keys(fmData).length > 0 ? fmData : null;
  const title = extractTitle(content) ?? path3.basename(absolutePath, ".md");
  const hash = computeNoteHash(content, frontmatter);
  const mtime = Math.floor(stat.mtimeMs);
  const wikilinks = extractWikilinks(content);
  const wordCount = countWords(content);
  const relativePath = toPosix2(
    path3.relative(path3.resolve(vaultRoot), path3.resolve(absolutePath))
  );
  return {
    relativePath,
    content,
    frontmatter,
    title,
    hash,
    mtime,
    wikilinks,
    wordCount
  };
}
function extractTitle(content) {
  const lines = content.split("\n");
  for (const line of lines) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m !== null && m[1] !== void 0) return m[1].trim();
  }
  return null;
}
function countWords(content) {
  if (content.length === 0) return 0;
  return content.split(/\s+/).filter((s) => s.length > 0).length;
}
function toPosix2(p) {
  return p.split(path3.sep).join("/");
}
var init_parser = __esm({
  "src/reader/parser.ts"() {
    "use strict";
    init_esm_shims();
    init_wikilinks2();
    init_hash();
  }
});

// src/reader/index.ts
var init_reader = __esm({
  "src/reader/index.ts"() {
    "use strict";
    init_esm_shims();
    init_scanner();
    init_parser();
    init_wikilinks2();
    init_hash();
  }
});

// src/chunker/tokens.ts
function countTokens(text) {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}
var init_tokens = __esm({
  "src/chunker/tokens.ts"() {
    "use strict";
    init_esm_shims();
  }
});

// src/chunker/headings.ts
function extractHeadings(content) {
  const headings = [];
  if (content.length === 0) return headings;
  const lines = content.split("\n");
  let offset = 0;
  let inFence = false;
  let fenceMarker = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[2] ?? "";
      if (!inFence) {
        inFence = true;
        fenceMarker = marker[0] ?? null;
      } else if (fenceMarker && marker.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = null;
      }
    } else if (!inFence) {
      const m = ATX_HEADING_RE.exec(line);
      if (m) {
        const hashes = m[1] ?? "";
        const text = m[2] ?? "";
        headings.push({
          level: hashes.length,
          text: text.trim(),
          line: i + 1,
          startOffset: offset
        });
      }
    }
    offset += line.length + 1;
  }
  return headings;
}
function headingPathAtOffset(headings, offset) {
  let last = null;
  for (const h of headings) {
    if (h.startOffset <= offset) {
      last = h;
    } else {
      break;
    }
  }
  if (!last) return null;
  return `${"#".repeat(last.level)} ${last.text}`;
}
var ATX_HEADING_RE, FENCE_RE;
var init_headings = __esm({
  "src/chunker/headings.ts"() {
    "use strict";
    init_esm_shims();
    ATX_HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
    FENCE_RE = /^(\s*)(`{3,}|~{3,})/;
  }
});

// src/chunker/chunker.ts
function chunkNote(content, options) {
  if (content.length === 0) return [];
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const overlapTokens = options?.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;
  const maxChars = maxTokens * 4;
  const overlapChars = overlapTokens * 4;
  const headings = extractHeadings(content);
  if (countTokens(content) <= maxTokens) {
    return [
      {
        idx: 0,
        text: content,
        headingPath: headingPathAtOffset(headings, 0),
        startOffset: 0,
        endOffset: content.length,
        tokenCount: countTokens(content)
      }
    ];
  }
  const headingSpans = splitAtHeadings(content, headings, maxChars);
  const finalSpans = [];
  for (const span of headingSpans) {
    if (span.end - span.start <= maxChars) {
      finalSpans.push(span);
    } else {
      finalSpans.push(...splitParagraphs(content, span, maxChars));
    }
  }
  const chunks = [];
  for (let i = 0; i < finalSpans.length; i++) {
    const span = finalSpans[i];
    if (!span) continue;
    const primaryStart = span.start;
    let start = span.start;
    const end = span.end;
    if (i > 0 && overlapChars > 0) {
      const overlapStart = Math.max(0, start - overlapChars);
      const window = content.slice(overlapStart, start);
      const sentenceIdx = findLastSentenceBoundary(window);
      start = sentenceIdx >= 0 ? overlapStart + sentenceIdx : overlapStart;
    }
    const text = content.slice(start, end);
    if (text.length === 0) continue;
    chunks.push({
      idx: chunks.length,
      text,
      headingPath: headingPathAtOffset(headings, primaryStart),
      startOffset: start,
      endOffset: end,
      tokenCount: countTokens(text)
    });
  }
  return chunks;
}
function splitAtHeadings(content, headings, _maxChars) {
  const boundaries = [0];
  for (const h of headings) {
    if (h.level <= 3 && h.startOffset > 0) {
      boundaries.push(h.startOffset);
    }
  }
  boundaries.push(content.length);
  const uniq = [...new Set(boundaries)].sort((a, b) => a - b);
  const spans = [];
  for (let i = 0; i < uniq.length - 1; i++) {
    const start = uniq[i];
    const end = uniq[i + 1];
    if (start === void 0 || end === void 0) continue;
    if (end > start) spans.push({ start, end });
  }
  return spans;
}
function splitParagraphs(content, span, maxChars) {
  const text = content.slice(span.start, span.end);
  const paragraphs = [];
  const re = /\n{2,}/g;
  let cursor = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const paraEnd = m.index;
    if (paraEnd > cursor) {
      paragraphs.push({ start: span.start + cursor, end: span.start + paraEnd });
    }
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) {
    paragraphs.push({ start: span.start + cursor, end: span.end });
  }
  if (paragraphs.length === 0) {
    paragraphs.push({ start: span.start, end: span.end });
  }
  const out = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    if (current.end - current.start <= maxChars) {
      out.push(current);
    } else {
      out.push(...splitSentences(content, current, maxChars));
    }
    current = null;
  };
  for (const p of paragraphs) {
    if (!current) {
      current = { start: p.start, end: p.end };
      continue;
    }
    if (p.end - current.start <= maxChars) {
      current = { start: current.start, end: p.end };
    } else {
      flush();
      current = { start: p.start, end: p.end };
    }
  }
  flush();
  return out;
}
function splitSentences(content, span, maxChars) {
  const text = content.slice(span.start, span.end);
  const boundaries = [];
  const re = /[.!?]\s+(?=[A-ZÄÖÜ])/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    boundaries.push(m.index + m[0].length);
  }
  const sentences = [];
  let cursor = 0;
  for (const b of boundaries) {
    if (b > cursor) {
      sentences.push({ start: span.start + cursor, end: span.start + b });
      cursor = b;
    }
  }
  if (cursor < text.length) {
    sentences.push({ start: span.start + cursor, end: span.end });
  }
  if (sentences.length === 0) {
    sentences.push({ start: span.start, end: span.end });
  }
  const out = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    if (current.end - current.start <= maxChars) {
      out.push(current);
    } else {
      out.push(...hardCut(current, maxChars));
    }
    current = null;
  };
  for (const s of sentences) {
    if (!current) {
      current = { start: s.start, end: s.end };
      continue;
    }
    if (s.end - current.start <= maxChars) {
      current = { start: current.start, end: s.end };
    } else {
      flush();
      current = { start: s.start, end: s.end };
    }
  }
  flush();
  return out;
}
function hardCut(span, maxChars) {
  const out = [];
  for (let s = span.start; s < span.end; s += maxChars) {
    out.push({ start: s, end: Math.min(span.end, s + maxChars) });
  }
  return out;
}
function findLastSentenceBoundary(window) {
  const re = /[.!?]\s+(?=[A-ZÄÖÜ])/g;
  let last = -1;
  let m;
  while ((m = re.exec(window)) !== null) {
    last = m.index + m[0].length;
  }
  return last;
}
var DEFAULT_MAX_TOKENS, DEFAULT_OVERLAP_TOKENS;
var init_chunker = __esm({
  "src/chunker/chunker.ts"() {
    "use strict";
    init_esm_shims();
    init_tokens();
    init_headings();
    DEFAULT_MAX_TOKENS = 400;
    DEFAULT_OVERLAP_TOKENS = 50;
  }
});

// src/chunker/index.ts
var init_chunker2 = __esm({
  "src/chunker/index.ts"() {
    "use strict";
    init_esm_shims();
    init_chunker();
    init_tokens();
    init_headings();
  }
});

// src/indexer/resolver.ts
var WikilinkResolver;
var init_resolver = __esm({
  "src/indexer/resolver.ts"() {
    "use strict";
    init_esm_shims();
    WikilinkResolver = class {
      vault;
      filenameStmt;
      cache = /* @__PURE__ */ new Map();
      constructor(vault) {
        this.vault = vault;
        this.filenameStmt = vault.db.handle.prepare(
          `SELECT id, path FROM notes
       WHERE path = ?
          OR path LIKE ?
       ORDER BY length(path) ASC
       LIMIT 1`
        );
      }
      /**
       * Resolve a wikilink target the way Obsidian does, in priority order:
       *   1) exact relative path match (with or without .md)
       *   2) filename-only match anywhere in the vault — shortest path wins
       *   3) alias match — looks up note_aliases (case-insensitive)
       *
       * Returns null if no candidate exists.
       */
      resolve(normalizedTarget) {
        const cached = this.cache.get(normalizedTarget);
        if (cached !== void 0) return cached;
        const hit = this.resolveUncached(normalizedTarget);
        this.cache.set(normalizedTarget, hit);
        return hit;
      }
      resolveUncached(normalizedTarget) {
        const exact = this.vault.db.notes.getByPath(`${normalizedTarget}.md`) ?? this.vault.db.notes.getByPath(normalizedTarget);
        if (exact) return { id: exact.id, path: exact.path };
        if (!normalizedTarget.includes("/")) {
          const filename = `${normalizedTarget}.md`;
          const suffix = `%/${filename}`;
          const hit = this.filenameStmt.get(filename, suffix);
          if (hit) return hit;
          const aliasHit = this.vault.db.aliases.resolve(normalizedTarget);
          if (aliasHit) {
            return { id: aliasHit.note_id, path: aliasHit.path };
          }
        }
        return null;
      }
      /** Test/diagnostics: cache size after a run. */
      get cacheSize() {
        return this.cache.size;
      }
    };
  }
});

// src/indexer/indexer.ts
import { randomUUID } from "crypto";
async function indexVault(vault, options) {
  const startedAt = Date.now();
  const runId = randomUUID();
  const mode = options.mode ?? "incremental";
  const log = options.onProgress ?? (() => {
  });
  log(`Probing Ollama model: ${options.embeddingModel}`);
  const health = await options.ollama.healthCheck();
  if (!health.ok) {
    throw new Error(`Ollama unreachable: ${health.error ?? "unknown error"}`);
  }
  const modelExists = await options.ollama.modelExists(options.embeddingModel);
  if (!modelExists) {
    throw new Error(
      `Embedding model "${options.embeddingModel}" not found in Ollama. Available: ${health.models?.join(", ") ?? "(none)"}. Run: ollama pull ${options.embeddingModel}`
    );
  }
  const probe = await options.ollama.embed({
    model: options.embeddingModel,
    texts: ["probe"]
  });
  const dim = probe.dim;
  const modelRow = vault.db.models.upsert({
    name: options.embeddingModel,
    provider: "ollama",
    dim
  });
  vault.db.audit.startRun({
    runId,
    vaultName: vault.config.name,
    modelId: modelRow.id,
    trigger: mode === "full" ? "manual-full" : "manual-incremental"
  });
  let notesIndexed = 0;
  let notesUpdated = 0;
  let notesDeleted = 0;
  let chunksCreated = 0;
  const firstPassResolver = new WikilinkResolver(vault);
  try {
    if (mode === "full") {
      log("Full mode: clearing existing chunks and embeddings");
      vault.db.transaction(() => {
        const allNotes = vault.db.notes.listAll();
        for (const n of allNotes) {
          vault.db.chunks.deleteByNote(n.id);
          vault.db.wikilinks.deleteByNote(n.id);
        }
      });
    }
    log(`Scanning ${vault.config.path}`);
    const files = await scanVault(vault.config.path, {
      excludeGlobs: vault.config.exclude_globs
    });
    log(`Found ${files.length} markdown files`);
    const parsedNotes = [];
    for (const file of files) {
      const parsed = await parseNote(file, vault.config.path);
      const upsert = vault.db.notes.upsertByPath({
        path: parsed.relativePath,
        content: parsed.content,
        frontmatter: parsed.frontmatter ? JSON.stringify(parsed.frontmatter) : null,
        title: parsed.title,
        hash: parsed.hash,
        mtime: parsed.mtime,
        wordCount: parsed.wordCount
      });
      vault.db.aliases.setForNote(upsert.id, extractAliases(parsed.frontmatter));
      const noteExisted = !upsert.isNew;
      const existing = noteExisted ? vault.db.notes.getById(upsert.id) : null;
      const chunkCount = vault.db.chunks.getByNote(upsert.id).length;
      const needsReindex = mode === "full" || upsert.isNew || chunkCount === 0;
      if (upsert.isNew) notesIndexed++;
      else if (needsReindex) notesUpdated++;
      if (needsReindex) {
        parsedNotes.push({ parsed, noteId: upsert.id, needsReindex: true });
      }
      void existing;
    }
    log(`${parsedNotes.length} notes need (re-)indexing`);
    for (const { parsed, noteId } of parsedNotes) {
      vault.db.chunks.deleteByNote(noteId);
      vault.db.wikilinks.deleteByNote(noteId);
      const chunks = chunkNote(parsed.content);
      if (chunks.length === 0) {
        insertWikilinks(vault, noteId, parsed.wikilinks);
        continue;
      }
      const chunkInputs = chunks.map((c) => ({
        idx: c.idx,
        text: c.text,
        headingPath: c.headingPath,
        startOffset: c.startOffset,
        endOffset: c.endOffset,
        tokenCount: c.tokenCount
      }));
      const chunkIds = vault.db.chunks.insertBatch(noteId, chunkInputs);
      const embedResult = await options.ollama.embed({
        model: options.embeddingModel,
        texts: chunks.map((c) => c.text)
      });
      if (embedResult.dim !== dim) {
        throw new Error(
          `Embedding dimension mismatch: expected ${dim}, got ${embedResult.dim}`
        );
      }
      const embeddingInputs = chunkIds.map((chunkId, i) => ({
        chunkId,
        modelId: modelRow.id,
        vector: embedResult.vectors[i]
      }));
      vault.db.embeddings.insertBatch(embeddingInputs);
      insertWikilinks(vault, noteId, parsed.wikilinks, firstPassResolver);
      chunksCreated += chunks.length;
    }
    const knownPaths = new Set(files.map((f) => relativize(f, vault.config.path)));
    const dbNotes = vault.db.notes.listAll();
    for (const n of dbNotes) {
      if (!knownPaths.has(n.path)) {
        vault.db.notes.deleteByPath(n.path);
        notesDeleted++;
      }
    }
    log("Resolving deferred wikilinks (second pass)");
    const broken = vault.db.wikilinks.resolveBrokenLinks();
    let resolved = 0;
    const updateStmt = vault.db.handle.prepare(
      `UPDATE wikilinks SET target_note = ?
       WHERE source_note = ? AND target_path = ? AND target_note IS NULL`
    );
    const secondPassResolver = new WikilinkResolver(vault);
    for (const link of broken) {
      const hit = secondPassResolver.resolve(link.targetPath);
      if (hit) {
        updateStmt.run(hit.id, link.sourceNoteId, link.targetPath);
        resolved++;
      }
    }
    if (resolved > 0) log(`Second pass resolved ${resolved} wikilinks`);
    vault.db.audit.finishRun(runId, {
      notesIndexed,
      chunksCreated,
      notesUpdated,
      notesDeleted
    });
    return {
      runId,
      status: "completed",
      notesIndexed,
      notesUpdated,
      notesDeleted,
      chunksCreated,
      durationMs: Date.now() - startedAt
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vault.db.audit.finishRun(runId, {
      notesIndexed,
      chunksCreated,
      notesUpdated,
      notesDeleted,
      error: message
    });
    return {
      runId,
      status: "failed",
      notesIndexed,
      notesUpdated,
      notesDeleted,
      chunksCreated,
      durationMs: Date.now() - startedAt,
      error: message
    };
  }
}
function insertWikilinks(vault, sourceNoteId, wikilinks, resolver) {
  if (wikilinks.length === 0) return;
  const r = resolver ?? new WikilinkResolver(vault);
  const inputs = wikilinks.map((wl) => {
    const target = r.resolve(wl.normalizedTarget);
    return {
      targetPath: wl.normalizedTarget,
      targetNoteId: target?.id ?? null,
      linkText: wl.alias,
      anchor: wl.anchor,
      lineNumber: wl.line
    };
  });
  vault.db.wikilinks.insertBatch(sourceNoteId, inputs);
}
function resolveWikilinkTarget(vault, normalizedTarget) {
  return new WikilinkResolver(vault).resolve(normalizedTarget);
}
function extractAliases(frontmatter) {
  if (!frontmatter) return [];
  const raw = frontmatter["aliases"] ?? frontmatter["alias"];
  if (raw == null) return [];
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) {
    return raw.filter((v) => typeof v === "string");
  }
  return [];
}
function relativize(absPath, vaultRoot) {
  let p = absPath;
  if (p.startsWith(vaultRoot)) {
    p = p.slice(vaultRoot.length);
  }
  if (p.startsWith("/") || p.startsWith("\\")) {
    p = p.slice(1);
  }
  return p.split("\\").join("/");
}
var init_indexer = __esm({
  "src/indexer/indexer.ts"() {
    "use strict";
    init_esm_shims();
    init_reader();
    init_chunker2();
    init_ollama();
    init_resolver();
  }
});

// src/write/fs.ts
import { promises as fs3 } from "fs";
import { dirname, isAbsolute, resolve as resolve3, sep as sep3 } from "path";
import { randomBytes } from "crypto";
async function atomicWriteFile(absPath, content) {
  if (!isAbsolute(absPath)) {
    throw new Error(`atomicWriteFile requires an absolute path: ${absPath}`);
  }
  const parent = dirname(absPath);
  await fs3.mkdir(parent, { recursive: true });
  const suffix = randomBytes(8).toString("hex");
  const tmpPath = `${absPath}.tmp.${suffix}`;
  try {
    await fs3.writeFile(tmpPath, content, "utf-8");
    await fs3.rename(tmpPath, absPath);
  } catch (err) {
    try {
      await fs3.unlink(tmpPath);
    } catch {
    }
    throw err;
  }
}
async function safeJoinInsideVault(vaultRoot, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new OutsideVaultError(relativePath, vaultRoot);
  }
  if (isAbsolute(relativePath)) {
    throw new OutsideVaultError(relativePath, vaultRoot);
  }
  const root = resolve3(vaultRoot);
  const target = resolve3(root, relativePath);
  const rootWithSep = root.endsWith(sep3) ? root : root + sep3;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new OutsideVaultError(relativePath, vaultRoot);
  }
  if (target === root) {
    throw new OutsideVaultError(relativePath, vaultRoot);
  }
  let realRoot;
  try {
    realRoot = await fs3.realpath(root);
  } catch {
    throw new OutsideVaultError(relativePath, vaultRoot);
  }
  const realTarget = await resolveExistingAncestor(target);
  const realRootWithSep = realRoot.endsWith(sep3) ? realRoot : realRoot + sep3;
  if (realTarget !== realRoot && !realTarget.startsWith(realRootWithSep)) {
    throw new OutsideVaultError(relativePath, vaultRoot);
  }
  return target;
}
async function resolveExistingAncestor(absPath) {
  let current = absPath;
  const trailing = [];
  while (true) {
    try {
      const real = await fs3.realpath(current);
      return trailing.length === 0 ? real : resolve3(real, ...trailing.reverse());
    } catch (err) {
      const code = err?.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw err;
      }
      const parent = dirname(current);
      if (parent === current) {
        return absPath;
      }
      trailing.push(current.slice(parent.length + 1));
      current = parent;
    }
  }
}
var OutsideVaultError;
var init_fs = __esm({
  "src/write/fs.ts"() {
    "use strict";
    init_esm_shims();
    OutsideVaultError = class extends Error {
      constructor(relativePath, vaultRoot) {
        super(
          `Refused to operate on path outside vault: "${relativePath}" (vault root: "${vaultRoot}")`
        );
        this.name = "OutsideVaultError";
      }
    };
  }
});

// src/frontmatter/update.ts
import { promises as fs4 } from "fs";
import matter2 from "gray-matter";
function isPlainObject2(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isUnsetDirective(v) {
  return isPlainObject2(v) && v["$unset"] === true;
}
function isPushDirective(v) {
  return isPlainObject2(v) && "$push" in v;
}
function isPullDirective(v) {
  return isPlainObject2(v) && "$pull" in v;
}
function hasDirective(v) {
  if (!isPlainObject2(v)) return false;
  return Object.keys(v).some((k) => k.startsWith("$"));
}
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject2(a) && isPlainObject2(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}
function applyMerge(data, merge) {
  const next = { ...data };
  const diff = [];
  for (const [key, instr] of Object.entries(merge)) {
    const before = next[key];
    if (isUnsetDirective(instr)) {
      if (key in next) {
        delete next[key];
        diff.push({ key, op: "unset", before });
      }
      continue;
    }
    if (isPushDirective(instr)) {
      const value = instr.$push;
      if (Array.isArray(before)) {
        const arr = [...before, value];
        next[key] = arr;
        diff.push({ key, op: "push", before, after: arr });
      } else if (before === void 0) {
        next[key] = [value];
        diff.push({ key, op: "push", before: void 0, after: [value] });
      } else {
        next[key] = [value];
        diff.push({ key, op: "push", before, after: [value] });
      }
      continue;
    }
    if (isPullDirective(instr)) {
      const value = instr.$pull;
      if (Array.isArray(before)) {
        const filtered = before.filter((v) => !deepEqual(v, value));
        if (filtered.length !== before.length) {
          next[key] = filtered;
          diff.push({ key, op: "pull", before, after: filtered });
        }
      }
      continue;
    }
    if (isPlainObject2(instr) && !hasDirective(instr) && isPlainObject2(before)) {
      const merged = { ...before, ...instr };
      if (!deepEqual(before, merged)) {
        next[key] = merged;
        diff.push({ key, op: "set", before, after: merged });
      }
    } else {
      if (!deepEqual(before, instr)) {
        next[key] = instr;
        diff.push({ key, op: "set", before, after: instr });
      }
    }
  }
  return { next, diff };
}
function computeHash(content, data) {
  const fmForHash = Object.keys(data).length > 0 ? data : {};
  return computeNoteHash(content, fmForHash);
}
function countWords2(content) {
  if (content.length === 0) return 0;
  return content.split(/\s+/).filter((s) => s.length > 0).length;
}
function extractTitle2(content, fallback) {
  for (const line of content.split("\n")) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m !== null && m[1] !== void 0) return m[1].trim();
  }
  return fallback;
}
function basenameNoMd(relativePath) {
  const base = relativePath.split("/").pop() ?? relativePath;
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}
async function updateFrontmatter(input) {
  const { vault, relativePath, merge, expectedHash, clientId } = input;
  if (vault.config.write_enabled !== true) {
    return {
      ok: false,
      reason: "permission_denied",
      message: "Vault is not write-enabled. Set write_enabled=true in config."
    };
  }
  const noteRow = vault.db.notes.getByPath(relativePath);
  if (noteRow === null) {
    return {
      ok: false,
      reason: "note_not_found",
      message: `No indexed note at path: ${relativePath}`
    };
  }
  const absPath = await safeJoinInsideVault(vault.config.path, relativePath);
  let raw;
  try {
    raw = await fs4.readFile(absPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: "note_not_found",
      message: `Failed to read file: ${msg}`
    };
  }
  const parsed = matter2(raw);
  const content = parsed.content;
  const data = parsed.data ?? {};
  const currentHash = computeHash(content, data);
  if (expectedHash !== void 0 && expectedHash !== currentHash) {
    return {
      ok: false,
      reason: "hash_mismatch",
      currentHash,
      message: `Expected hash ${expectedHash} but current is ${currentHash}.`
    };
  }
  if (Object.keys(merge).length === 0) {
    return {
      ok: true,
      newHash: currentHash,
      noteId: noteRow.id,
      diff: []
    };
  }
  const { next, diff } = applyMerge(data, merge);
  if (diff.length === 0) {
    return {
      ok: true,
      newHash: currentHash,
      noteId: noteRow.id,
      diff: []
    };
  }
  const fullText = Object.keys(next).length === 0 ? content : matter2.stringify(content, next);
  input.onBeforeFsWrite?.();
  await atomicWriteFile(absPath, fullText);
  const stat = await fs4.stat(absPath);
  const newHash = computeHash(content, next);
  const title = extractTitle2(content, basenameNoMd(relativePath));
  const wordCount = countWords2(content);
  const fmJson = Object.keys(next).length > 0 ? JSON.stringify(next) : null;
  const aliasKeyTouched = "aliases" in merge || "alias" in merge;
  let upsertId;
  try {
    upsertId = vault.db.transaction(() => {
      const up = vault.db.notes.upsertByPath({
        path: relativePath,
        content,
        frontmatter: fmJson,
        title,
        hash: newHash,
        mtime: Math.floor(stat.mtimeMs),
        wordCount
      });
      if (aliasKeyTouched) {
        vault.db.aliases.setForNote(up.id, extractAliases(next));
      }
      vault.db.audit.recordWrite({
        noteId: up.id,
        op: "update",
        previousHash: currentHash,
        newHash,
        expectedHash: expectedHash ?? null,
        clientId: clientId ?? null,
        diffSummary: JSON.stringify(diff)
      });
      return up.id;
    });
  } catch (dbErr) {
    input.onBeforeFsWrite?.();
    try {
      await atomicWriteFile(absPath, raw);
    } catch {
    }
    throw dbErr;
  }
  return {
    ok: true,
    newHash,
    noteId: upsertId,
    diff
  };
}
var init_update = __esm({
  "src/frontmatter/update.ts"() {
    "use strict";
    init_esm_shims();
    init_hash();
    init_indexer();
    init_fs();
  }
});

// src/frontmatter/index.ts
var init_frontmatter = __esm({
  "src/frontmatter/index.ts"() {
    "use strict";
    init_esm_shims();
    init_query();
    init_update();
  }
});

// src/indexer/single.ts
import * as path4 from "path";
async function indexNote(options) {
  const { vault, absolutePath, embeddingModel, ollama } = options;
  if (!isInsideVault(absolutePath, vault.config.path)) {
    return emptyResult("outside_vault");
  }
  let parsed;
  try {
    parsed = await parseNote(absolutePath, vault.config.path);
  } catch (err) {
    if (isENOENT(err)) {
      return emptyResult("missing");
    }
    throw err;
  }
  const existing = vault.db.notes.getByPath(parsed.relativePath);
  if (existing && existing.hash === parsed.hash) {
    vault.db.aliases.setForNote(
      existing.id,
      extractAliases(parsed.frontmatter)
    );
    return {
      status: "unchanged",
      notePath: parsed.relativePath,
      noteId: existing.id,
      chunksCreated: 0,
      isNew: false
    };
  }
  const activeModel = vault.db.models.getActive();
  if (!activeModel) {
    throw new Error(
      `single-indexer: no active embedding model in DB. Run a full index first to register "${embeddingModel}".`
    );
  }
  if (activeModel.name !== embeddingModel) {
    throw new Error(
      `single-indexer: active model "${activeModel.name}" does not match requested "${embeddingModel}". Run a full re-index to switch models.`
    );
  }
  const upsert = vault.db.notes.upsertByPath({
    path: parsed.relativePath,
    content: parsed.content,
    frontmatter: parsed.frontmatter ? JSON.stringify(parsed.frontmatter) : null,
    title: parsed.title,
    hash: parsed.hash,
    mtime: parsed.mtime,
    wordCount: parsed.wordCount
  });
  vault.db.aliases.setForNote(
    upsert.id,
    extractAliases(parsed.frontmatter)
  );
  vault.db.chunks.deleteByNote(upsert.id);
  vault.db.wikilinks.deleteByNote(upsert.id);
  const chunks = chunkNote(parsed.content);
  if (chunks.length === 0) {
    insertWikilinks2(vault, upsert.id, parsed.wikilinks);
    return {
      status: "indexed",
      notePath: parsed.relativePath,
      noteId: upsert.id,
      chunksCreated: 0,
      isNew: upsert.isNew
    };
  }
  const chunkIds = vault.db.chunks.insertBatch(
    upsert.id,
    chunks.map((c) => ({
      idx: c.idx,
      text: c.text,
      headingPath: c.headingPath,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      tokenCount: c.tokenCount
    }))
  );
  const embedResult = await ollama.embed({
    model: embeddingModel,
    texts: chunks.map((c) => c.text)
  });
  if (embedResult.dim !== activeModel.dim) {
    throw new Error(
      `single-indexer: embedding dim ${embedResult.dim} does not match registered dim ${activeModel.dim} for model "${embeddingModel}".`
    );
  }
  vault.db.embeddings.insertBatch(
    chunkIds.map((chunkId, i) => ({
      chunkId,
      modelId: activeModel.id,
      vector: embedResult.vectors[i]
    }))
  );
  insertWikilinks2(vault, upsert.id, parsed.wikilinks);
  return {
    status: "indexed",
    notePath: parsed.relativePath,
    noteId: upsert.id,
    chunksCreated: chunks.length,
    isNew: upsert.isNew
  };
}
function removeNote(vault, absolutePath) {
  if (!isInsideVault(absolutePath, vault.config.path)) {
    return { removed: false, notePath: null };
  }
  const relativePath = toRelativePosix(absolutePath, vault.config.path);
  const existing = vault.db.notes.getByPath(relativePath);
  if (!existing) {
    return { removed: false, notePath: null };
  }
  vault.db.notes.deleteByPath(relativePath);
  return { removed: true, notePath: relativePath };
}
function emptyResult(status) {
  return {
    status,
    notePath: null,
    noteId: null,
    chunksCreated: 0,
    isNew: false
  };
}
function isInsideVault(absolutePath, vaultRoot) {
  const absResolved = path4.resolve(absolutePath);
  const rootResolved = path4.resolve(vaultRoot);
  const absPosix = absResolved.split(path4.sep).join("/");
  const rootPosix = rootResolved.split(path4.sep).join("/");
  const rootWithSep = rootPosix.endsWith("/") ? rootPosix : `${rootPosix}/`;
  return absPosix === rootPosix || absPosix.startsWith(rootWithSep);
}
function toRelativePosix(absolutePath, vaultRoot) {
  return path4.relative(path4.resolve(vaultRoot), path4.resolve(absolutePath)).split(path4.sep).join("/");
}
function isENOENT(err) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}
function insertWikilinks2(vault, sourceNoteId, wikilinks) {
  if (wikilinks.length === 0) return;
  const inputs = wikilinks.map((wl) => {
    const target = resolveWikilinkTarget(vault, wl.normalizedTarget);
    return {
      targetPath: wl.normalizedTarget,
      targetNoteId: target?.id ?? null,
      linkText: wl.alias,
      anchor: wl.anchor,
      lineNumber: wl.line
    };
  });
  vault.db.wikilinks.insertBatch(sourceNoteId, inputs);
}
var init_single = __esm({
  "src/indexer/single.ts"() {
    "use strict";
    init_esm_shims();
    init_reader();
    init_chunker2();
    init_indexer();
  }
});

// src/indexer/catchup.ts
async function catchupVault(options) {
  const started = Date.now();
  const log = options.log ?? (() => {
  });
  const { vault } = options;
  const files = await scanVault(vault.config.path, {
    excludeGlobs: vault.config.exclude_globs
  });
  let reindexed = 0;
  const knownPaths = /* @__PURE__ */ new Set();
  for (const file of files) {
    const parsed = await parseNote(file, vault.config.path).catch(() => null);
    if (!parsed) continue;
    knownPaths.add(parsed.relativePath);
    const dbRow = vault.db.notes.getByPath(parsed.relativePath);
    if (dbRow && dbRow.hash === parsed.hash) {
      continue;
    }
    const result = await indexNote({
      vault,
      absolutePath: file,
      embeddingModel: options.embeddingModel,
      ollama: options.ollama
    });
    if (result.status === "indexed") {
      reindexed++;
      log(
        `catch-up indexed ${parsed.relativePath} (${result.isNew ? "new" : "updated"})`
      );
    }
  }
  let removed = 0;
  for (const row of vault.db.notes.listAll()) {
    if (!knownPaths.has(row.path)) {
      const result = removeNote(vault, joinAbs(vault.config.path, row.path));
      if (result.removed) {
        removed++;
        log(`catch-up removed ${row.path}`);
      }
    }
  }
  return {
    scanned: files.length,
    reindexed,
    removed,
    durationMs: Date.now() - started
  };
}
function joinAbs(root, relative4) {
  if (root.endsWith("/")) return `${root}${relative4}`;
  return `${root}/${relative4}`;
}
var init_catchup = __esm({
  "src/indexer/catchup.ts"() {
    "use strict";
    init_esm_shims();
    init_reader();
    init_single();
  }
});

// src/indexer/index.ts
var indexer_exports = {};
__export(indexer_exports, {
  catchupVault: () => catchupVault,
  extractAliases: () => extractAliases,
  indexNote: () => indexNote,
  indexVault: () => indexVault,
  removeNote: () => removeNote,
  resolveWikilinkTarget: () => resolveWikilinkTarget
});
var init_indexer2 = __esm({
  "src/indexer/index.ts"() {
    "use strict";
    init_esm_shims();
    init_indexer();
    init_single();
    init_catchup();
  }
});

// src/write/write.ts
import { promises as fs5 } from "fs";
import { basename as basename2 } from "path";
import matter3 from "gray-matter";
function permissionDenied(vaultName) {
  return {
    ok: false,
    reason: "permission_denied",
    message: `Vault "${vaultName}" is read-only (write_enabled=false in config.toml)`
  };
}
function computeHash2(content, frontmatter) {
  return computeNoteHash(content, frontmatter);
}
function extractTitle3(content, relativePath) {
  for (const line of content.split("\n")) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m !== null && m[1] !== void 0) return m[1].trim();
  }
  return basename2(relativePath, ".md");
}
function countWords3(content) {
  if (content.length === 0) return 0;
  return content.split(/\s+/).filter((s) => s.length > 0).length;
}
async function readExistingFile(absPath) {
  let raw;
  try {
    raw = await fs5.readFile(absPath, "utf-8");
  } catch (err) {
    if (typeof err === "object" && err !== null && err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
  const parsed = matter3(raw);
  const fmData = parsed.data;
  const frontmatter = fmData !== void 0 && Object.keys(fmData).length > 0 ? fmData : null;
  const hash = computeHash2(parsed.content, frontmatter);
  return { raw, content: parsed.content, frontmatter, hash };
}
async function writeNote(input) {
  const { vault, relativePath, content } = input;
  const frontmatter = input.frontmatter ?? null;
  const clientId = input.clientId ?? DEFAULT_CLIENT_ID;
  if (vault.config.write_enabled !== true) {
    return permissionDenied(vault.config.name);
  }
  const absPath = await safeJoinInsideVault(vault.config.path, relativePath);
  const existing = await readExistingFile(absPath);
  const created = existing === null;
  if (existing !== null) {
    if (input.expectedHash === void 0) {
      return {
        ok: false,
        reason: "hash_mismatch",
        currentHash: existing.hash,
        currentContent: existing.raw,
        message: `File "${relativePath}" already exists. Pass expectedHash="${existing.hash}" to overwrite intentionally.`
      };
    }
    if (input.expectedHash !== existing.hash) {
      return {
        ok: false,
        reason: "hash_mismatch",
        currentHash: existing.hash,
        currentContent: existing.raw,
        message: `Hash mismatch for "${relativePath}": expected ${input.expectedHash}, got ${existing.hash}. The file was modified externally \u2014 re-read and retry.`
      };
    }
  }
  const fileText = frontmatter !== null && Object.keys(frontmatter).length > 0 ? matter3.stringify(content, frontmatter) : content;
  input.onBeforeFsWrite?.();
  await atomicWriteFile(absPath, fileText);
  const written = await readExistingFile(absPath);
  if (written === null) {
    throw new Error(
      `Internal error: file disappeared after write: ${relativePath}`
    );
  }
  const stat = await fs5.stat(absPath);
  const previousNote = vault.db.notes.getByPath(relativePath);
  const previousHash = previousNote?.hash ?? null;
  const title = extractTitle3(written.content, relativePath);
  let upsertId;
  try {
    upsertId = vault.db.transaction(() => {
      const up = vault.db.notes.upsertByPath({
        path: relativePath,
        content: written.content,
        frontmatter: written.frontmatter ? JSON.stringify(written.frontmatter) : null,
        title,
        hash: written.hash,
        mtime: Math.floor(stat.mtimeMs),
        wordCount: countWords3(written.content)
      });
      vault.db.aliases.setForNote(up.id, extractAliases(written.frontmatter));
      vault.db.audit.recordWrite({
        noteId: up.id,
        op: created ? "create" : "update",
        previousHash,
        newHash: written.hash,
        expectedHash: input.expectedHash ?? null,
        clientId,
        diffSummary: null
      });
      return up.id;
    });
  } catch (dbErr) {
    input.onBeforeFsWrite?.();
    try {
      if (created) {
        await fs5.unlink(absPath);
      } else if (existing !== null) {
        await atomicWriteFile(absPath, existing.raw);
      }
    } catch {
    }
    throw dbErr;
  }
  return {
    ok: true,
    newHash: written.hash,
    noteId: upsertId,
    created
  };
}
async function deleteNote(input) {
  const { vault, relativePath, expectedHash } = input;
  const clientId = input.clientId ?? DEFAULT_CLIENT_ID;
  if (vault.config.write_enabled !== true) {
    return permissionDenied(vault.config.name);
  }
  const absPath = await safeJoinInsideVault(vault.config.path, relativePath);
  const existing = await readExistingFile(absPath);
  if (existing === null) {
    return {
      ok: false,
      reason: "hash_mismatch",
      message: `File "${relativePath}" does not exist \u2014 nothing to delete.`
    };
  }
  if (existing.hash !== expectedHash) {
    return {
      ok: false,
      reason: "hash_mismatch",
      currentHash: existing.hash,
      currentContent: existing.raw,
      message: `Hash mismatch for "${relativePath}": expected ${expectedHash}, got ${existing.hash}. The file was modified externally \u2014 re-read and retry.`
    };
  }
  const previousNote = vault.db.notes.getByPath(relativePath);
  const previousHash = previousNote?.hash ?? existing.hash;
  input.onBeforeFsWrite?.();
  await fs5.unlink(absPath);
  if (previousNote !== null) {
    vault.db.transaction(() => {
      vault.db.audit.recordWrite({
        noteId: previousNote.id,
        op: "delete",
        previousHash,
        newHash: null,
        expectedHash,
        clientId,
        diffSummary: null
      });
      vault.db.notes.deleteByPath(relativePath);
    });
    return {
      ok: true,
      newHash: existing.hash,
      noteId: previousNote.id,
      created: false
    };
  }
  return {
    ok: true,
    newHash: existing.hash,
    noteId: 0,
    created: false
  };
}
var DEFAULT_CLIENT_ID;
var init_write = __esm({
  "src/write/write.ts"() {
    "use strict";
    init_esm_shims();
    init_reader();
    init_indexer2();
    init_fs();
    DEFAULT_CLIENT_ID = "claude-code";
  }
});

// src/write/index.ts
var init_write2 = __esm({
  "src/write/index.ts"() {
    "use strict";
    init_esm_shims();
    init_write();
    init_fs();
  }
});

// src/audit/audit.ts
function clampLimit(value, fallback, max) {
  if (value === void 0) return fallback;
  if (!Number.isFinite(value) || value <= 0) return fallback;
  const n = Math.floor(value);
  return n > max ? max : n;
}
function getAuditLog(input) {
  const { vault } = input;
  const limit = clampLimit(input.limit, DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT);
  const filter = { limit };
  if (input.notePath !== void 0) {
    const note = vault.db.notes.getByPath(input.notePath);
    if (!note) return [];
    filter.noteId = note.id;
  }
  if (input.op !== void 0) filter.op = input.op;
  if (input.since !== void 0) filter.since = input.since;
  const rows = vault.db.audit.listWrites(filter);
  return rows.map((row) => {
    const note = vault.db.notes.getById(row.note_id);
    return {
      id: row.id,
      notePath: note?.path ?? null,
      noteTitle: note?.title ?? null,
      op: row.op,
      previousHash: row.previous_hash,
      newHash: row.new_hash,
      expectedHash: row.expected_hash,
      clientId: row.client_id,
      diffSummary: row.diff_summary,
      at: row.at
    };
  });
}
function getIndexRuns(input) {
  const { vault } = input;
  const limit = clampLimit(input.limit, DEFAULT_RUNS_LIMIT, MAX_RUNS_LIMIT);
  const rows = vault.db.audit.listRuns(limit);
  return rows.map((row) => {
    let modelName = null;
    if (row.model_id !== null) {
      const all = vault.db.models.listAll();
      const found = all.find((m) => m.id === row.model_id);
      modelName = found?.name ?? null;
    }
    const durationMs = row.finished_at !== null ? row.finished_at - row.started_at : null;
    return {
      runId: row.run_id,
      vaultName: row.vault_name,
      modelName,
      trigger: row.trigger,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs,
      notesIndexed: row.notes_indexed,
      notesUpdated: row.notes_updated,
      notesDeleted: row.notes_deleted,
      chunksCreated: row.chunks_created,
      error: row.error
    };
  });
}
var DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT, DEFAULT_RUNS_LIMIT, MAX_RUNS_LIMIT;
var init_audit2 = __esm({
  "src/audit/audit.ts"() {
    "use strict";
    init_esm_shims();
    DEFAULT_AUDIT_LIMIT = 50;
    MAX_AUDIT_LIMIT = 1e3;
    DEFAULT_RUNS_LIMIT = 20;
    MAX_RUNS_LIMIT = 200;
  }
});

// src/audit/index.ts
var init_audit3 = __esm({
  "src/audit/index.ts"() {
    "use strict";
    init_esm_shims();
    init_audit2();
  }
});

// src/watcher/queue.ts
var DebouncedQueue;
var init_queue = __esm({
  "src/watcher/queue.ts"() {
    "use strict";
    init_esm_shims();
    DebouncedQueue = class {
      debounceMs;
      maxLatencyMs;
      onFlush;
      onError;
      pending = /* @__PURE__ */ new Map();
      /** Tracks in-flight flush promises so flushAll can await them. */
      inFlight = /* @__PURE__ */ new Set();
      stopped = false;
      constructor(options) {
        this.debounceMs = options.debounceMs ?? 500;
        this.maxLatencyMs = options.maxLatencyMs ?? 5e3;
        this.onFlush = options.onFlush;
        this.onError = options.onError ?? ((event, err) => {
          console.error(
            `[DebouncedQueue] onFlush failed for ${event.path} (${event.kind}):`,
            err
          );
        });
      }
      /**
       * Enqueue an event. After shutdown() this is a no-op.
       */
      enqueue(event) {
        if (this.stopped) return;
        const now = Date.now();
        const existing = this.pending.get(event.path);
        if (existing && now - existing.firstSeen >= this.maxLatencyMs) {
          clearTimeout(existing.timer);
          this.pending.delete(event.path);
          this.dispatch({ path: event.path, kind: existing.kind });
        }
        const prior = this.pending.get(event.path);
        const firstSeen = prior?.firstSeen ?? now;
        if (prior) clearTimeout(prior.timer);
        const kind = event.kind;
        const age = now - firstSeen;
        const remaining = this.maxLatencyMs - age;
        const delay = Math.max(0, Math.min(this.debounceMs, remaining));
        const timer = setTimeout(() => {
          const entry = this.pending.get(event.path);
          if (!entry) return;
          this.pending.delete(event.path);
          this.dispatch({ path: event.path, kind: entry.kind });
        }, delay);
        this.pending.set(event.path, { kind, firstSeen, timer });
      }
      /** Force-flush all pending events. Resolves once all onFlush calls settle. */
      async flushAll() {
        const entries = [...this.pending.entries()];
        for (const [path5, entry] of entries) {
          clearTimeout(entry.timer);
          this.pending.delete(path5);
          this.dispatch({ path: path5, kind: entry.kind });
        }
        while (this.inFlight.size > 0) {
          await Promise.all([...this.inFlight]);
        }
      }
      /** Cancel timers, drop pending events. Idempotent. After this enqueue is a no-op. */
      shutdown() {
        if (this.stopped) return;
        this.stopped = true;
        for (const entry of this.pending.values()) {
          clearTimeout(entry.timer);
        }
        this.pending.clear();
      }
      /** Pending event count (excludes in-flight). */
      size() {
        return this.pending.size;
      }
      dispatch(event) {
        let result;
        try {
          result = this.onFlush(event);
        } catch (err) {
          this.safeOnError(event, err);
          return;
        }
        if (result && typeof result.then === "function") {
          const p = result.catch((err) => this.safeOnError(event, err)).finally(() => {
            this.inFlight.delete(p);
          });
          this.inFlight.add(p);
        }
      }
      safeOnError(event, err) {
        try {
          this.onError(event, err);
        } catch {
        }
      }
    };
  }
});

// src/watcher/watcher.ts
import chokidar from "chokidar";
import { posix } from "path";
import { sep as nativeSep } from "path";
var VaultWatcher;
var init_watcher = __esm({
  "src/watcher/watcher.ts"() {
    "use strict";
    init_esm_shims();
    init_indexer2();
    init_queue();
    VaultWatcher = class {
      fsWatcher = null;
      queue;
      opts;
      started = false;
      constructor(options) {
        this.opts = {
          vault: options.vault,
          embeddingModel: options.embeddingModel,
          ollama: options.ollama,
          suppression: options.suppression,
          debounceMs: options.debounceMs ?? 500,
          log: options.log ?? ((m) => process.stderr.write(`[watcher] ${m}
`))
        };
        this.queue = new DebouncedQueue({
          debounceMs: this.opts.debounceMs,
          maxLatencyMs: 5e3,
          onFlush: (event) => this.handleFlush(event),
          onError: (event, err) => {
            const message = err instanceof Error ? err.message : String(err);
            this.opts.log(`error processing ${event.path}: ${message}`);
          }
        });
      }
      async start() {
        if (this.started) return;
        const vaultPath = this.opts.vault.config.path;
        const excludes = this.opts.vault.config.exclude_globs ?? [];
        this.fsWatcher = chokidar.watch(vaultPath, {
          persistent: true,
          ignoreInitial: true,
          // we expect initial state via indexVault
          ignored: [
            // chokidar handles glob-like patterns. Provide both raw and absolute.
            ...excludes.map((g) => posix.join(vaultPath, g)),
            /(^|[\\/])\../,
            // hidden files at any level
            "**/*.tmp.*"
            // our atomic-write artifacts
          ],
          // Only watch markdown files — saves event volume.
          // chokidar's `ignored` runs against absolute paths, so we filter via
          // an after-the-fact event check (cheaper than a glob).
          awaitWriteFinish: {
            stabilityThreshold: 200,
            pollInterval: 50
          },
          followSymlinks: false
        });
        this.fsWatcher.on("add", (path5) => this.onFsEvent(path5, "change"));
        this.fsWatcher.on("change", (path5) => this.onFsEvent(path5, "change"));
        this.fsWatcher.on("unlink", (path5) => this.onFsEvent(path5, "delete"));
        this.fsWatcher.on("error", (err) => {
          const message = err instanceof Error ? err.message : String(err);
          this.opts.log(`fs watcher error: ${message}`);
        });
        await new Promise((resolve5) => {
          this.fsWatcher.once("ready", () => resolve5());
        });
        this.started = true;
        this.opts.log(`watching ${vaultPath}`);
      }
      /** Force-process any pending events. Used during shutdown. */
      async drain() {
        await this.queue.flushAll();
      }
      async stop() {
        if (!this.started) return;
        this.started = false;
        this.queue.shutdown();
        if (this.fsWatcher) {
          await this.fsWatcher.close();
          this.fsWatcher = null;
        }
      }
      // ─── internal ──────────────────────────────────────────────────────────
      onFsEvent(absolutePath, kind) {
        if (!absolutePath.endsWith(".md")) return;
        const relativePath = this.toRelative(absolutePath);
        if (this.opts.suppression.consume(relativePath)) {
          this.opts.log(`suppressed ${kind} ${relativePath} (own write)`);
          return;
        }
        this.queue.enqueue({ path: absolutePath, kind });
      }
      toRelative(absolutePath) {
        const root = this.opts.vault.config.path;
        let rel = absolutePath;
        if (rel.startsWith(root)) rel = rel.slice(root.length);
        if (rel.startsWith(nativeSep) || rel.startsWith("/")) rel = rel.slice(1);
        return rel.split(nativeSep).join("/");
      }
      async handleFlush(event) {
        const relativePath = this.toRelative(event.path);
        if (event.kind === "delete") {
          const result2 = removeNote(this.opts.vault, event.path);
          if (result2.removed) {
            this.opts.log(`removed ${relativePath}`);
          } else {
            this.opts.log(`delete event for unknown ${relativePath} (skip)`);
          }
          return;
        }
        const result = await indexNote({
          vault: this.opts.vault,
          absolutePath: event.path,
          embeddingModel: this.opts.embeddingModel,
          ollama: this.opts.ollama
        });
        switch (result.status) {
          case "indexed":
            this.opts.log(
              `indexed ${relativePath} (${result.isNew ? "new" : "updated"}, ${result.chunksCreated} chunks)`
            );
            break;
          case "unchanged":
            break;
          case "outside_vault":
            this.opts.log(`event for path outside vault ignored: ${event.path}`);
            break;
          case "missing":
            this.opts.log(`file missing on parse \u2014 removing ${relativePath}`);
            removeNote(this.opts.vault, event.path);
            break;
        }
      }
    };
  }
});

// src/watcher/suppression.ts
var SuppressionSet;
var init_suppression = __esm({
  "src/watcher/suppression.ts"() {
    "use strict";
    init_esm_shims();
    SuppressionSet = class {
      defaultTtlMs;
      now;
      entries = /* @__PURE__ */ new Map();
      constructor(options = {}) {
        this.defaultTtlMs = options.ttlMs ?? 2e3;
        this.now = options.now ?? Date.now;
      }
      /** Mark a path as "expect a filesystem event for this — please ignore it". */
      add(path5, ttlMs) {
        this.prune();
        const ttl = ttlMs ?? this.defaultTtlMs;
        this.entries.set(path5, { expiresAt: this.now() + ttl });
      }
      /**
       * If path is suppressed, remove the entry and return true (skip event).
       * Otherwise return false.
       */
      consume(path5) {
        this.prune();
        const entry = this.entries.get(path5);
        if (!entry) return false;
        if (entry.expiresAt <= this.now()) {
          this.entries.delete(path5);
          return false;
        }
        this.entries.delete(path5);
        return true;
      }
      /** Read-only check; does not consume. */
      has(path5) {
        this.prune();
        const entry = this.entries.get(path5);
        if (!entry) return false;
        if (entry.expiresAt <= this.now()) {
          this.entries.delete(path5);
          return false;
        }
        return true;
      }
      /** Drop expired entries. */
      prune() {
        const t = this.now();
        for (const [path5, entry] of this.entries) {
          if (entry.expiresAt <= t) {
            this.entries.delete(path5);
          }
        }
      }
      size() {
        this.prune();
        return this.entries.size;
      }
    };
  }
});

// src/watcher/index.ts
var init_watcher2 = __esm({
  "src/watcher/index.ts"() {
    "use strict";
    init_esm_shims();
    init_watcher();
    init_queue();
    init_suppression();
  }
});

// src/server.ts
var server_exports = {};
__export(server_exports, {
  serve: () => serve
});
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { z as z3 } from "zod";
async function serve() {
  const config = await loadConfig();
  const manager = new VaultManager();
  await manager.loadAll(config.vaults);
  const ollama = new OllamaClient({
    endpoint: config.server.ollama_endpoint
  });
  const defaultModel = config.server.default_embedding_model ?? "qwen3-embedding:0.6b";
  const reranker = config.server.reranker_model ? new OllamaReranker({ ollama, model: config.server.reranker_model }) : void 0;
  const suppression = new SuppressionSet({ ttlMs: 2e3 });
  const watchers = /* @__PURE__ */ new Map();
  const startCatchupAndWatchers = async () => {
    for (const vault of manager.list()) {
      if (!vault.config.embedding_model && !vault.db.models.getActive()) continue;
      const modelName = vault.config.embedding_model ?? defaultModel;
      try {
        const result = await catchupVault({
          vault,
          embeddingModel: modelName,
          ollama,
          log: (m) => process.stderr.write(`[catchup:${vault.config.name}] ${m}
`)
        });
        if (result.reindexed > 0 || result.removed > 0) {
          process.stderr.write(
            `[catchup:${vault.config.name}] scanned ${result.scanned}, reindexed ${result.reindexed}, removed ${result.removed} (${result.durationMs}ms)
`
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[catchup:${vault.config.name}] failed: ${message} (watcher will still start)
`
        );
      }
      const watcher = new VaultWatcher({
        vault,
        embeddingModel: modelName,
        ollama,
        suppression
      });
      await watcher.start();
      watchers.set(vault.config.name, watcher);
    }
  };
  const shutdown = async () => {
    for (const w of watchers.values()) {
      await w.drain();
      await w.stop();
    }
  };
  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
  const server = new Server(
    { name: "vault-memory", version: VERSION },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_vaults",
        description: "List configured vaults with their status (note count, last indexed run).",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "read_note",
        description: "Read the full content + frontmatter of a note by its vault-relative path.",
        inputSchema: {
          type: "object",
          required: ["vault", "path"],
          properties: {
            vault: { type: "string", description: "Configured vault name" },
            path: {
              type: "string",
              description: "Vault-relative path with forward slashes, ending in .md"
            }
          }
        }
      },
      {
        name: "search_semantic",
        description: "Semantic search via embedding cosine similarity. Searches all vaults by default.",
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            vaults: { type: "array", items: { type: "string" } },
            top_k: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 10
            },
            exclude_paths: {
              type: "array",
              items: { type: "string" },
              description: "Glob patterns (e.g. '_research/eval.md', '**/index.md') of paths to exclude."
            }
          }
        }
      },
      {
        name: "search_text",
        description: "Full-text BM25 search via SQLite FTS5. Best for exact-word and phrase matches.",
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: {
              type: "string",
              description: "FTS5 query \u2014 whitespace-separated tokens are AND'd; use OR explicitly."
            },
            vaults: { type: "array", items: { type: "string" } },
            top_k: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 10
            },
            exclude_paths: {
              type: "array",
              items: { type: "string" },
              description: "Glob patterns of paths to exclude."
            }
          }
        }
      },
      {
        name: "search_hybrid",
        description: "Hybrid search: combines semantic (embedding) and BM25 (full-text) results via Reciprocal Rank Fusion. Best general-purpose query.",
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            vaults: { type: "array", items: { type: "string" } },
            top_k: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 10
            },
            rrf_k: {
              type: "integer",
              minimum: 1,
              maximum: 1e3,
              default: 60,
              description: "RRF constant \u2014 higher dampens emphasis on top ranks."
            },
            exclude_paths: {
              type: "array",
              items: { type: "string" },
              description: "Glob patterns of paths to exclude."
            },
            rerank: {
              type: "boolean",
              default: false,
              description: "Apply a cross-encoder rerank over the top candidates. Requires `reranker_model` in server config; silently ignored otherwise."
            }
          }
        }
      },
      {
        name: "list_backlinks",
        description: "Find all notes that link TO a given note.",
        inputSchema: {
          type: "object",
          required: ["vault", "path"],
          properties: {
            vault: { type: "string" },
            path: { type: "string" }
          }
        }
      },
      {
        name: "list_forward_links",
        description: "List all wikilinks FROM a given note. Optionally include broken links.",
        inputSchema: {
          type: "object",
          required: ["vault", "path"],
          properties: {
            vault: { type: "string" },
            path: { type: "string" },
            include_broken: { type: "boolean", default: true }
          }
        }
      },
      {
        name: "find_broken_links",
        description: "List all wikilinks in a vault that point to non-existent notes.",
        inputSchema: {
          type: "object",
          required: ["vault"],
          properties: { vault: { type: "string" } }
        }
      },
      {
        name: "query_frontmatter",
        description: "Filter notes by their YAML frontmatter. Supports equality, $in, $exists, $contains predicates. Multiple keys are AND-combined.",
        inputSchema: {
          type: "object",
          required: ["vault", "where"],
          properties: {
            vault: { type: "string" },
            where: {
              type: "object",
              description: "Field-name \u2192 predicate map. Predicate is a scalar (equality) or { $in: [...] } | { $exists: bool } | { $contains: scalar }."
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 1e3,
              default: 100
            }
          }
        }
      },
      {
        name: "write_note",
        description: "Atomically create or overwrite a note. Requires write_enabled=true. Use expected_hash for safe overwrites (read the note first, pass its hash). Omit expected_hash only when creating a new note.",
        inputSchema: {
          type: "object",
          required: ["vault", "path", "content"],
          properties: {
            vault: { type: "string" },
            path: {
              type: "string",
              description: "Vault-relative .md path, forward slashes."
            },
            content: {
              type: "string",
              description: "Markdown body WITHOUT --- frontmatter delimiters."
            },
            frontmatter: {
              type: ["object", "null"],
              description: "Optional frontmatter object. Set null to write no frontmatter block."
            },
            expected_hash: {
              type: "string",
              description: "Required for overwrites \u2014 get it from read_note."
            },
            client_id: { type: "string" }
          }
        }
      },
      {
        name: "update_frontmatter",
        description: "Modify a note's frontmatter only. The body is preserved bytegenau. Merge DSL: scalar=set, {$unset:true}=delete, {$push:x}=array append, {$pull:x}=array remove.",
        inputSchema: {
          type: "object",
          required: ["vault", "path", "merge"],
          properties: {
            vault: { type: "string" },
            path: { type: "string" },
            merge: {
              type: "object",
              description: "Field \u2192 value | {$unset:bool} | {$push:scalar} | {$pull:scalar}"
            },
            expected_hash: { type: "string" },
            client_id: { type: "string" }
          }
        }
      },
      {
        name: "delete_note",
        description: "Delete a note. Requires write_enabled=true AND expected_hash (no blind deletes).",
        inputSchema: {
          type: "object",
          required: ["vault", "path", "expected_hash"],
          properties: {
            vault: { type: "string" },
            path: { type: "string" },
            expected_hash: { type: "string" },
            client_id: { type: "string" }
          }
        }
      },
      {
        name: "audit_log",
        description: "Query the write audit trail for a vault. Filterable by note path, operation type, or time. Default limit 50.",
        inputSchema: {
          type: "object",
          required: ["vault"],
          properties: {
            vault: { type: "string" },
            note_path: { type: "string" },
            op: { type: "string", enum: ["create", "update", "delete"] },
            since: {
              type: "integer",
              description: "Epoch ms \u2014 entries at or after this timestamp."
            },
            limit: { type: "integer", minimum: 1, maximum: 1e3, default: 50 }
          }
        }
      },
      {
        name: "index_runs",
        description: "List recent index runs for a vault \u2014 what was scanned, when, how long, errors.",
        inputSchema: {
          type: "object",
          required: ["vault"],
          properties: {
            vault: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 20 }
          }
        }
      }
    ]
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args2 } = request.params;
    try {
      switch (name) {
        case "list_vaults":
          return ok(handleListVaults(manager));
        case "read_note": {
          const parsed = ReadNoteArgs.parse(args2 ?? {});
          return ok(handleReadNote(manager, parsed.vault, parsed.path));
        }
        case "search_semantic": {
          const parsed = SearchArgs.parse(args2 ?? {});
          return ok(
            await handleSearchSemantic(
              manager,
              ollama,
              defaultModel,
              parsed.query,
              parsed.vaults,
              parsed.top_k,
              parsed.exclude_paths
            )
          );
        }
        case "search_text": {
          const parsed = SearchArgs.parse(args2 ?? {});
          return ok(
            handleSearchText(
              manager,
              parsed.query,
              parsed.vaults,
              parsed.top_k,
              parsed.exclude_paths
            )
          );
        }
        case "search_hybrid": {
          const parsed = HybridSearchArgs.parse(args2 ?? {});
          return ok(
            await handleSearchHybrid(
              manager,
              ollama,
              defaultModel,
              parsed.query,
              parsed.vaults,
              parsed.top_k,
              parsed.rrf_k,
              parsed.exclude_paths,
              parsed.rerank ? reranker : void 0
            )
          );
        }
        case "list_backlinks": {
          const parsed = VaultPathArgs.parse(args2 ?? {});
          const vault = manager.require(parsed.vault);
          return ok({ backlinks: listBacklinks(vault, parsed.path) });
        }
        case "list_forward_links": {
          const parsed = ForwardLinksArgs.parse(args2 ?? {});
          const vault = manager.require(parsed.vault);
          return ok({
            links: listForwardLinks(vault, parsed.path, parsed.include_broken)
          });
        }
        case "find_broken_links": {
          const parsed = FindBrokenLinksArgs.parse(args2 ?? {});
          const vault = manager.require(parsed.vault);
          return ok({ broken: findBrokenLinks(vault) });
        }
        case "query_frontmatter": {
          const parsed = QueryFrontmatterArgs.parse(args2 ?? {});
          const vault = manager.require(parsed.vault);
          const hits = queryFrontmatter(vault, {
            where: parsed.where,
            limit: parsed.limit
          });
          return ok({
            notes: hits.map((n) => ({
              path: n.path,
              title: n.title,
              frontmatter: n.frontmatter ? JSON.parse(n.frontmatter) : null,
              mtime: n.mtime
            })),
            count: hits.length
          });
        }
        case "write_note": {
          const parsed = WriteNoteArgs.parse(args2 ?? {});
          const vault = manager.require(parsed.vault);
          const result = await writeNote({
            vault,
            relativePath: parsed.path,
            content: parsed.content,
            frontmatter: parsed.frontmatter ?? null,
            expectedHash: parsed.expected_hash,
            clientId: parsed.client_id,
            onBeforeFsWrite: () => suppression.add(parsed.path)
          });
          return ok(result);
        }
        case "update_frontmatter": {
          const parsed = UpdateFrontmatterArgs.parse(args2 ?? {});
          const vault = manager.require(parsed.vault);
          const result = await updateFrontmatter({
            vault,
            relativePath: parsed.path,
            merge: parsed.merge,
            expectedHash: parsed.expected_hash,
            clientId: parsed.client_id,
            onBeforeFsWrite: () => suppression.add(parsed.path)
          });
          return ok(result);
        }
        case "delete_note": {
          const parsed = DeleteNoteArgs.parse(args2 ?? {});
          const vault = manager.require(parsed.vault);
          const result = await deleteNote({
            vault,
            relativePath: parsed.path,
            expectedHash: parsed.expected_hash,
            clientId: parsed.client_id,
            onBeforeFsWrite: () => suppression.add(parsed.path)
          });
          return ok(result);
        }
        case "audit_log": {
          const parsed = AuditLogArgs.parse(args2 ?? {});
          const vault = manager.require(parsed.vault);
          const entries = getAuditLog({
            vault,
            notePath: parsed.note_path,
            op: parsed.op,
            since: parsed.since,
            limit: parsed.limit
          });
          return ok({ entries, count: entries.length });
        }
        case "index_runs": {
          const parsed = IndexRunsArgs.parse(args2 ?? {});
          const vault = manager.require(parsed.vault);
          const runs = getIndexRuns({ vault, limit: parsed.limit });
          return ok({ runs, count: runs.length });
        }
        default:
          return errorResponse(`Unknown tool: ${name}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(message);
    }
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  startCatchupAndWatchers().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[catchup] unexpected failure: ${message}
`);
  });
}
function handleListVaults(manager) {
  const vaults = manager.list().map((v) => {
    const noteCount = v.db.notes.countAll();
    const runs = v.db.audit.listRuns(1);
    const lastRun = runs[0];
    return {
      name: v.config.name,
      path: v.config.path,
      embedding_model: v.config.embedding_model ?? null,
      note_count: noteCount,
      write_enabled: v.config.write_enabled ?? false,
      last_run: lastRun ? {
        run_id: lastRun.run_id,
        started_at: lastRun.started_at,
        finished_at: lastRun.finished_at,
        error: lastRun.error
      } : null
    };
  });
  return { vaults, count: vaults.length };
}
function handleReadNote(manager, vaultName, path5) {
  const vault = manager.require(vaultName);
  const note = vault.db.notes.getByPath(path5);
  if (!note) {
    throw new Error(`Note not found: ${vaultName}/${path5}`);
  }
  return {
    path: note.path,
    title: note.title,
    content: note.content,
    frontmatter: note.frontmatter ? JSON.parse(note.frontmatter) : null,
    hash: note.hash,
    mtime: note.mtime,
    word_count: note.word_count
  };
}
async function handleSearchSemantic(manager, ollama, defaultModel, query, vaultFilter, topK, excludePaths) {
  const targets = vaultFilter ? vaultFilter.map((n) => manager.require(n)) : manager.list();
  if (targets.length === 0) {
    return { hits: [], note: "No vaults configured." };
  }
  const hasExclude = excludePaths !== void 0 && excludePaths.length > 0;
  const fanK = hasExclude ? topK * 3 : topK;
  const embedCache = /* @__PURE__ */ new Map();
  const allHits = [];
  for (const vault of targets) {
    const modelName = vault.config.embedding_model ?? defaultModel;
    const model = vault.db.models.getActive();
    if (!model || model.name !== modelName) continue;
    let queryVec = embedCache.get(modelName);
    if (!queryVec) {
      const embedResp = await ollama.embed({ model: modelName, texts: [query] });
      queryVec = embedResp.vectors[0];
      if (!queryVec) continue;
      embedCache.set(modelName, queryVec);
    }
    const semanticHits = vault.db.embeddings.searchSemantic(
      model.id,
      queryVec,
      fanK
    );
    for (const hit of semanticHits) {
      const chunk = vault.db.chunks.getById(hit.chunkId);
      if (!chunk) continue;
      const note = vault.db.notes.getById(chunk.note_id);
      if (!note) continue;
      if (hasExclude && matchesAnyGlob(note.path, excludePaths)) continue;
      const score = 1 / (1 + hit.distance);
      allHits.push({
        vault: vault.config.name,
        notePath: note.path,
        noteTitle: note.title,
        chunkText: chunk.text,
        chunkIdx: chunk.idx,
        headingPath: chunk.heading_path,
        score,
        scoreBreakdown: { semantic: score }
      });
    }
  }
  allHits.sort((a, b) => b.score - a.score);
  return { hits: allHits.slice(0, topK), count: allHits.length };
}
function handleSearchText(manager, query, vaultFilter, topK, excludePaths) {
  const targets = vaultFilter ? vaultFilter.map((n) => manager.require(n)) : manager.list();
  if (targets.length === 0) {
    return { hits: [], note: "No vaults configured." };
  }
  const hasExclude = excludePaths !== void 0 && excludePaths.length > 0;
  const fanK = hasExclude ? topK * 3 : topK;
  const sanitized = FtsQueries.sanitize(query);
  const allHits = [];
  for (const vault of targets) {
    const ftsHits = vault.db.fts.search(sanitized, fanK, true);
    for (const hit of ftsHits) {
      const chunk = vault.db.chunks.getById(hit.chunkId);
      if (!chunk) continue;
      const note = vault.db.notes.getById(chunk.note_id);
      if (!note) continue;
      if (hasExclude && matchesAnyGlob(note.path, excludePaths)) continue;
      allHits.push({
        vault: vault.config.name,
        notePath: note.path,
        noteTitle: note.title,
        chunkText: hit.snippet ?? chunk.text,
        chunkIdx: chunk.idx,
        headingPath: chunk.heading_path,
        score: hit.score,
        scoreBreakdown: { text: hit.score }
      });
    }
  }
  allHits.sort((a, b) => b.score - a.score);
  return { hits: allHits.slice(0, topK), count: allHits.length };
}
async function handleSearchHybrid(manager, ollama, defaultModel, query, vaultFilter, topK, rrfK, excludePaths, reranker) {
  const targets = vaultFilter ? vaultFilter.map((n) => manager.require(n)) : manager.list();
  if (targets.length === 0) {
    return { hits: [], note: "No vaults configured." };
  }
  const hasExclude = excludePaths !== void 0 && excludePaths.length > 0;
  const innerTopK = hasExclude ? topK * 3 : topK;
  const hits = await hybridSearch({
    query,
    embeddingModel: defaultModel,
    ollama,
    vaults: targets,
    topK: innerTopK,
    rrfK,
    includeBreakdown: true,
    reranker
  });
  const filtered = hasExclude ? hits.filter((h) => !matchesAnyGlob(h.notePath, excludePaths)) : hits;
  return { hits: filtered.slice(0, topK), count: filtered.length };
}
function ok(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
  };
}
function errorResponse(message) {
  return {
    isError: true,
    content: [{ type: "text", text: message }]
  };
}
var VERSION, ReadNoteArgs, SearchArgs, HybridSearchArgs, VaultPathArgs, ForwardLinksArgs, FindBrokenLinksArgs, PredicateSchema, QueryFrontmatterArgs, WriteNoteArgs, UpdateFrontmatterArgs, DeleteNoteArgs, AuditLogArgs, IndexRunsArgs;
var init_server = __esm({
  "src/server.ts"() {
    "use strict";
    init_esm_shims();
    init_config();
    init_vault();
    init_ollama();
    init_db();
    init_search();
    init_rerank();
    init_graph2();
    init_frontmatter();
    init_write2();
    init_audit3();
    init_watcher2();
    init_indexer2();
    VERSION = "0.6.1";
    ReadNoteArgs = z3.object({
      vault: z3.string(),
      path: z3.string()
    });
    SearchArgs = z3.object({
      query: z3.string().min(1),
      vaults: z3.array(z3.string()).optional(),
      top_k: z3.number().int().positive().max(100).optional().default(10),
      /** Glob patterns of vault-relative paths to exclude from results. Useful
       *  for filtering self-referential notes (e.g. an eval note that lists
       *  the same keywords it's testing) or auxiliary indices. */
      exclude_paths: z3.array(z3.string()).optional()
    });
    HybridSearchArgs = SearchArgs.extend({
      rrf_k: z3.number().int().positive().max(1e3).optional().default(60),
      /** When true AND a `reranker_model` is configured, runs a cross-encoder
       *  rerank pass over the top candidates. Silently ignored otherwise. */
      rerank: z3.boolean().optional().default(false)
    });
    VaultPathArgs = z3.object({
      vault: z3.string(),
      path: z3.string()
    });
    ForwardLinksArgs = VaultPathArgs.extend({
      include_broken: z3.boolean().optional().default(true)
    });
    FindBrokenLinksArgs = z3.object({
      vault: z3.string()
    });
    PredicateSchema = z3.union([
      z3.string(),
      z3.number(),
      z3.boolean(),
      z3.null(),
      z3.object({ $in: z3.array(z3.union([z3.string(), z3.number(), z3.boolean(), z3.null()])) }),
      z3.object({ $exists: z3.boolean() }),
      z3.object({ $contains: z3.union([z3.string(), z3.number(), z3.boolean(), z3.null()]) })
    ]);
    QueryFrontmatterArgs = z3.object({
      vault: z3.string(),
      where: z3.record(z3.string(), PredicateSchema),
      limit: z3.number().int().positive().max(1e3).optional().default(100)
    });
    WriteNoteArgs = z3.object({
      vault: z3.string(),
      path: z3.string(),
      content: z3.string(),
      frontmatter: z3.record(z3.string(), z3.unknown()).nullable().optional(),
      expected_hash: z3.string().optional(),
      client_id: z3.string().optional()
    });
    UpdateFrontmatterArgs = z3.object({
      vault: z3.string(),
      path: z3.string(),
      merge: z3.record(z3.string(), z3.unknown()),
      expected_hash: z3.string().optional(),
      client_id: z3.string().optional()
    });
    DeleteNoteArgs = z3.object({
      vault: z3.string(),
      path: z3.string(),
      expected_hash: z3.string(),
      client_id: z3.string().optional()
    });
    AuditLogArgs = z3.object({
      vault: z3.string(),
      note_path: z3.string().optional(),
      op: z3.enum(["create", "update", "delete"]).optional(),
      since: z3.number().int().nonnegative().optional(),
      limit: z3.number().int().positive().max(1e3).optional().default(50)
    });
    IndexRunsArgs = z3.object({
      vault: z3.string(),
      limit: z3.number().int().positive().max(200).optional().default(20)
    });
  }
});

// src/cli.ts
init_esm_shims();
var args = process.argv.slice(2);
var command = args[0] ?? "serve";
switch (command) {
  case "serve":
    await Promise.resolve().then(() => (init_server(), server_exports)).then((m) => m.serve());
    break;
  case "index":
    await runIndex(args.slice(1));
    break;
  case "--help":
  case "-h":
  case "help":
    printHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(2);
}
async function runIndex(rest) {
  const { loadConfig: loadConfig2 } = await Promise.resolve().then(() => (init_config(), config_exports));
  const { VaultManager: VaultManager2 } = await Promise.resolve().then(() => (init_vault(), vault_exports));
  const { OllamaClient: OllamaClient3 } = await Promise.resolve().then(() => (init_ollama(), ollama_exports));
  const { indexVault: indexVault2 } = await Promise.resolve().then(() => (init_indexer2(), indexer_exports));
  let vaultName = null;
  let mode = "incremental";
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--full") mode = "full";
    else if (arg === "--vault") {
      vaultName = rest[i + 1] ?? null;
      i++;
    } else if (arg && !arg.startsWith("--") && vaultName === null) {
      vaultName = arg;
    }
  }
  const config = await loadConfig2();
  if (config.vaults.length === 0) {
    console.error("No vaults configured. Edit ~/.vault-memory/config.toml.");
    process.exit(2);
  }
  const manager = new VaultManager2();
  await manager.loadAll(config.vaults);
  const ollama = new OllamaClient3({
    endpoint: config.server.ollama_endpoint
  });
  const targets = vaultName ? [manager.require(vaultName)] : manager.list();
  for (const vault of targets) {
    const model = vault.config.embedding_model ?? config.server.default_embedding_model ?? "qwen3-embedding";
    console.error(`
\u2192 Indexing "${vault.config.name}" (${mode}) with ${model}`);
    const result = await indexVault2(vault, {
      mode,
      embeddingModel: model,
      ollama,
      onProgress: (msg) => console.error(`  ${msg}`)
    });
    if (result.status === "completed") {
      console.error(
        `\u2713 ${vault.config.name}: ${result.notesIndexed} new, ${result.notesUpdated} updated, ${result.notesDeleted} deleted, ${result.chunksCreated} chunks \xB7 ${result.durationMs}ms`
      );
    } else {
      console.error(`\u2717 ${vault.config.name}: ${result.error}`);
      process.exitCode = 1;
    }
  }
  manager.closeAll();
}
function printHelp() {
  console.error(`vault-memory \u2014 local-first semantic memory MCP server

USAGE:
  vault-memory [COMMAND] [OPTIONS]

COMMANDS:
  serve                  Start MCP server on stdio (default)
  index [VAULT]          Build/refresh index for a vault (or all if omitted)
    --full                 Wipe derived layer and re-embed everything
    --vault NAME           Alternative flag form
  init                   Interactive config wizard (Phase 5 \u2014 not yet)
  help, --help           Show this message

CONFIG:
  ~/.vault-memory/config.toml`);
}
//# sourceMappingURL=cli.js.map