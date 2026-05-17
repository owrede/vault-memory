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

// node_modules/tsup/assets/esm_shims.js
import path from "path";
import { fileURLToPath } from "url";
var init_esm_shims = __esm({
  "node_modules/tsup/assets/esm_shims.js"() {
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
async function loadConfig(path7 = configPath()) {
  let raw;
  try {
    raw = await readFile(path7, "utf-8");
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
    throw new Error(`Failed to parse TOML at ${path7}: ${err.message}`);
  }
  const validated = AppConfigSchema.parse(parsed);
  return {
    server: {
      ...DEFAULT_CONFIG.server,
      ...validated.server
    },
    vaults: validated.vaults,
    memory: validated.memory,
    memory_sinks: validated.memory_sinks
  };
}
var ServerConfigSchema, VaultConfigSchema, MemorySinkConfigSchema, MemoryConfigSchema, AppConfigSchema, DEFAULT_CONFIG;
var init_loader = __esm({
  "src/config/loader.ts"() {
    "use strict";
    init_esm_shims();
    ServerConfigSchema = z.object({
      log_level: z.enum(["debug", "info", "warn", "error"]).optional(),
      ollama_endpoint: z.string().url().optional(),
      default_embedding_model: z.string().optional(),
      reranker_model: z.string().optional(),
      reranker_backend: z.enum(["onnx", "ollama"]).optional(),
      reranker_model_dir: z.string().optional()
    });
    VaultConfigSchema = z.object({
      name: z.string().min(1),
      path: z.string().min(1),
      embedding_model: z.string().optional(),
      secondary_embedding_model: z.string().optional(),
      write_enabled: z.boolean().optional(),
      exclude_globs: z.array(z.string()).optional()
    });
    MemorySinkConfigSchema = z.object({
      name: z.string().min(1),
      handle: z.string().min(1),
      contract: z.string().min(1).default("default-memory-v1")
    });
    MemoryConfigSchema = z.object({
      default_sink: z.string().min(1).optional()
    });
    AppConfigSchema = z.object({
      server: ServerConfigSchema.optional().default({}),
      vaults: z.array(VaultConfigSchema).optional().default([]),
      memory: MemoryConfigSchema.optional(),
      memory_sinks: z.array(MemorySinkConfigSchema).optional().default([])
    });
    DEFAULT_CONFIG = {
      server: {
        log_level: "info",
        ollama_endpoint: "http://localhost:11434",
        default_embedding_model: "qwen3-embedding"
      },
      vaults: [],
      memory_sinks: []
    };
  }
});

// src/config/add-vault.ts
import { promises as fs } from "fs";
import { join as join2, basename, resolve } from "path";
import { homedir as homedir2 } from "os";
function slugifyVaultName(input) {
  const cleaned = input.toLowerCase().normalize("NFKD").replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (cleaned.length === 0) return "vault";
  if (/^[0-9]/.test(cleaned)) return `v-${cleaned}`;
  return cleaned;
}
async function addVault(opts) {
  const resolvedPath = resolve(opts.path);
  const cfgFile = opts.configFile ?? configPath();
  const binary = opts.binary ?? "vault-memory";
  const steps = [];
  const stat = await fs.stat(resolvedPath).catch((err) => {
    if (err.code === "ENOENT") {
      throw new Error(`Vault path does not exist: ${resolvedPath}`);
    }
    throw err;
  });
  if (!stat.isDirectory()) {
    throw new Error(`Vault path is not a directory: ${resolvedPath}`);
  }
  const proposedName = opts.name ?? slugifyVaultName(basename(resolvedPath));
  if (!/^[a-z0-9][a-z0-9-]*$/.test(proposedName)) {
    throw new Error(
      `Vault name "${proposedName}" must match /^[a-z0-9][a-z0-9-]*$/ (lowercase alphanumeric + dashes, starting with a letter or digit).`
    );
  }
  const existing = await loadConfig(cfgFile);
  const sameName = existing.vaults.find((v) => v.name === proposedName);
  const samePath = existing.vaults.find((v) => resolve(v.path) === resolvedPath);
  if (samePath) {
    steps.push({
      kind: "config-already-registered",
      name: samePath.name,
      existingPath: samePath.path
    });
  } else if (sameName) {
    throw new Error(
      `A different vault is already registered under name "${proposedName}" (path: ${sameName.path}). Pass --name <other> to choose a different one.`
    );
  } else {
    const block = renderVaultBlock({
      name: proposedName,
      path: resolvedPath,
      writeEnabled: opts.writeEnabled ?? false,
      excludeGlobs: opts.excludeGlobs ?? DEFAULT_EXCLUDE_GLOBS
    });
    await ensureFileExists(cfgFile);
    await appendToFile(cfgFile, block);
    steps.push({ kind: "config-added", name: proposedName, path: resolvedPath });
  }
  const finalName = samePath?.name ?? proposedName;
  const mcpPath = join2(resolvedPath, ".mcp.json");
  const step = await writeOrMergeMcpJson(mcpPath, finalName, binary);
  steps.push(step);
  return {
    name: finalName,
    resolvedPath,
    configFile: cfgFile,
    mcpJsonPath: mcpPath,
    steps
  };
}
function renderVaultBlock(input) {
  const lines = [
    "",
    `# Added by vault-memory add-vault on ${(/* @__PURE__ */ new Date()).toISOString()}`,
    "[[vaults]]",
    `name = ${JSON.stringify(input.name)}`,
    `path = ${JSON.stringify(input.path)}`,
    `write_enabled = ${input.writeEnabled}`,
    `exclude_globs = [`,
    ...input.excludeGlobs.map((g) => `  ${JSON.stringify(g)},`),
    `]`,
    ""
  ];
  return lines.join("\n");
}
async function ensureFileExists(path7) {
  try {
    await fs.access(path7);
  } catch {
    await fs.mkdir(join2(homedir2(), ".vault-memory"), { recursive: true });
    await fs.writeFile(path7, "# vault-memory configuration\n", "utf-8");
  }
}
async function appendToFile(path7, content) {
  await fs.appendFile(path7, content, "utf-8");
}
async function writeOrMergeMcpJson(mcpPath, vaultName, binary) {
  const desiredEntry = {
    type: "stdio",
    command: binary,
    args: ["serve"],
    env: { VAULT_MEMORY_ACTIVE_VAULT: vaultName }
  };
  let existing = null;
  try {
    const raw = await fs.readFile(mcpPath, "utf-8");
    existing = JSON.parse(raw);
  } catch (err) {
    const code = err.code;
    if (code !== "ENOENT") {
      throw new Error(`Failed to read existing .mcp.json at ${mcpPath}: ${err.message}`);
    }
  }
  if (existing === null) {
    const fresh = { mcpServers: { "vault-memory": desiredEntry } };
    await fs.writeFile(mcpPath, JSON.stringify(fresh, null, 2) + "\n", "utf-8");
    return { kind: "mcp-json-created", mcpPath };
  }
  const before = existing.mcpServers?.["vault-memory"];
  const beforeJson = before ? JSON.stringify(before) : null;
  const merged = {
    ...existing,
    mcpServers: {
      ...existing.mcpServers ?? {},
      "vault-memory": desiredEntry
    }
  };
  const afterJson = JSON.stringify(merged.mcpServers?.["vault-memory"]);
  if (beforeJson === afterJson) {
    return { kind: "mcp-json-unchanged", mcpPath };
  }
  await fs.writeFile(mcpPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  return { kind: "mcp-json-merged", mcpPath };
}
var DEFAULT_EXCLUDE_GLOBS;
var init_add_vault = __esm({
  "src/config/add-vault.ts"() {
    "use strict";
    init_esm_shims();
    init_loader();
    DEFAULT_EXCLUDE_GLOBS = [
      ".obsidian/**",
      ".trash/**",
      "Trash/**",
      ".claude/**",
      // vault-memory:claude-ok — `.claude/` is the literal Obsidian-side directory name for any MCP host integration; not a Claude-only path.
      ".smart-connections/**",
      ".smart-env/**",
      ".systemsculpt/**",
      ".makemd/**"
    ];
  }
});

// src/config/index.ts
var config_exports = {};
__export(config_exports, {
  addVault: () => addVault,
  configPath: () => configPath,
  loadConfig: () => loadConfig,
  slugifyVaultName: () => slugifyVaultName
});
var init_config = __esm({
  "src/config/index.ts"() {
    "use strict";
    init_esm_shims();
    init_loader();
    init_add_vault();
  }
});

// src/db/schema.ts
function runMigration005(db, _ctx) {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'embeddings\\_%' ESCAPE '\\'").all();
  const legacyTables = [];
  for (const r of rows) {
    const m = /^embeddings_(\d+)$/.exec(r.name);
    if (m && m[1]) legacyTables.push({ name: r.name, dim: Number(m[1]) });
  }
  for (const { name, dim } of legacyTables) {
    const rows2 = db.prepare(`SELECT chunk_id, model_id, vector FROM ${name}`).all();
    db.exec(`DROP TABLE ${name}`);
    const byModel = /* @__PURE__ */ new Map();
    for (const row of rows2) {
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
         )`
      );
      const insert = db.prepare(`INSERT INTO ${newName} (chunk_id, vector) VALUES (?, ?)`);
      for (const row of bucket) {
        insert.run(BigInt(row.chunk_id), row.vector);
      }
    }
  }
}
function runMigration008(db, ctx) {
  const pending = db.prepare("SELECT COUNT(*) AS c FROM notes WHERE doc_uri IS NULL").get();
  if (!pending || pending.c === 0) return;
  if (!ctx.vaultName) {
    throw new Error(
      "runMigration008 requires vaultName context to backfill doc_uri on existing notes (Database constructor must be called with the vault name; check src/vault/manager.ts)."
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
function runMigration009(db, _ctx) {
  const cols = db.prepare("PRAGMA table_info(write_audit)").all();
  const hasColumn = cols.some((c) => c.name === "is_memory_sink_write");
  if (!hasColumn) {
    db.exec(
      "ALTER TABLE write_audit ADD COLUMN is_memory_sink_write INTEGER NOT NULL DEFAULT 0"
    );
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_write_audit_memory
      ON write_audit(is_memory_sink_write, at DESC)
      WHERE is_memory_sink_write = 1
  `);
}
var INITIAL_SCHEMA, MIGRATION_002_ALIASES, MIGRATION_003_FIX_DELETE_FKS, MIGRATION_004_VARIABLE_DIMS, MIGRATION_006_BODY_HASH, MIGRATION_007_DOC_URI_ADD, MIGRATIONS;
var init_schema = __esm({
  "src/db/schema.ts"() {
    "use strict";
    init_esm_shims();
    INITIAL_SCHEMA = `
-- \u2500\u2500 3.1 Raw Layer \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

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
    MIGRATION_006_BODY_HASH = `
ALTER TABLE notes ADD COLUMN body_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_notes_body_hash ON notes(body_hash);
`;
    MIGRATION_007_DOC_URI_ADD = `
ALTER TABLE notes ADD COLUMN doc_uri TEXT;
CREATE INDEX IF NOT EXISTS idx_notes_doc_uri ON notes(doc_uri);
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
      },
      {
        version: 5,
        description: "add partition key on model_id (two models per dim can coexist)",
        run: runMigration005
      },
      {
        version: 6,
        description: "add body_hash for frontmatter-only-change short-circuit",
        sql: MIGRATION_006_BODY_HASH
      },
      {
        version: 7,
        description: "add doc_uri column to notes (Strategy A, additive)",
        sql: MIGRATION_007_DOC_URI_ADD
      },
      {
        version: 8,
        description: "backfill doc_uri from <vault-name>/path",
        run: runMigration008
      },
      {
        version: 9,
        description: "audit discriminator \u2014 is_memory_sink_write column + partial index (MEM-08, Plan 02-06)",
        run: runMigration009
      }
    ];
  }
});

// src/db/queries/notes.ts
function escapeLikePrefix(prefix) {
  return prefix.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
var NotesQueries;
var init_notes = __esm({
  "src/db/queries/notes.ts"() {
    "use strict";
    init_esm_shims();
    NotesQueries = class {
      constructor(db) {
        this.db = db;
        this._selectByPath = db.prepare("SELECT * FROM notes WHERE path = ?");
        this._selectById = db.prepare("SELECT * FROM notes WHERE id = ?");
        this._insert = db.prepare(`
      INSERT INTO notes (path, content, frontmatter, title, hash, body_hash, doc_uri, mtime, word_count, created_at, updated_at)
      VALUES (@path, @content, @frontmatter, @title, @hash, @body_hash, @doc_uri, @mtime, @word_count, @now, @now)
    `);
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
        this._listAll = db.prepare(
          "SELECT * FROM notes ORDER BY id LIMIT ? OFFSET ?"
        );
        this._count = db.prepare("SELECT COUNT(*) AS c FROM notes");
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
        const docUri = input.docUri ?? (input.vaultName !== void 0 ? `obsidian-fs://${input.vaultName}/${input.path}` : null);
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
          body_hash: input.bodyHash,
          doc_uri: docUri,
          mtime: input.mtime,
          word_count: input.wordCount,
          now
        });
        return { id: Number(info.lastInsertRowid), isNew: true };
      }
      getById(id) {
        return this._selectById.get(id) ?? null;
      }
      getByPath(path7) {
        return this._selectByPath.get(path7) ?? null;
      }
      deleteByPath(path7) {
        const info = this._delete.run(path7);
        return info.changes > 0;
      }
      listAll(limit = 1e3, offset = 0) {
        return this._listAll.all(limit, offset);
      }
      countAll() {
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
      countByPathPrefix(prefix) {
        const row = this.db.prepare(
          "SELECT COUNT(*) AS c FROM notes WHERE path LIKE ? ESCAPE '\\'"
        ).get(escapeLikePrefix(prefix) + "%");
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
      listByPathPrefix(prefix, limit = 1e4) {
        return this.db.prepare(
          "SELECT * FROM notes WHERE path LIKE ? ESCAPE '\\' ORDER BY path LIMIT ?"
        ).all(escapeLikePrefix(prefix) + "%", limit);
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
        this._getById = db.prepare("SELECT * FROM chunks WHERE id = ?");
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
      stmtsByModel = /* @__PURE__ */ new Map();
      tableName(modelId, dim) {
        return `embeddings_m${modelId}_d${dim}`;
      }
      /**
       * Ensure the vec0 table for this model exists. Idempotent. Called lazily
       * on first use of a model. Tables for an existing pre-v5 dataset are
       * materialized by migration 005.
       */
      ensureTableForModel(modelId, dim) {
        if (!Number.isInteger(modelId) || modelId <= 0) {
          throw new Error(`Invalid modelId: ${modelId}`);
        }
        if (!Number.isInteger(dim) || dim <= 0) {
          throw new Error(`Invalid embedding dim: ${dim}`);
        }
        const table = this.tableName(modelId, dim);
        this.db.exec(
          `CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING vec0(
         chunk_id INTEGER PRIMARY KEY,
         vector   FLOAT[${dim}]
       )`
        );
      }
      dimForModel(modelId) {
        const row = this.models.getById(modelId);
        if (!row) {
          throw new Error(`EmbeddingsQueries: model_id ${modelId} not found in models table`);
        }
        return row.dim;
      }
      getStmts(modelId) {
        const cached = this.stmtsByModel.get(modelId);
        if (cached) return cached;
        const dim = this.dimForModel(modelId);
        this.ensureTableForModel(modelId, dim);
        const table = this.tableName(modelId, dim);
        const stmts = {
          insert: this.db.prepare(`INSERT INTO ${table} (chunk_id, vector) VALUES (?, ?)`),
          deleteByChunk: this.db.prepare(`DELETE FROM ${table} WHERE chunk_id = ?`),
          deleteAll: this.db.prepare(`DELETE FROM ${table}`),
          search: this.db.prepare(
            `SELECT chunk_id, distance
         FROM ${table}
         WHERE vector MATCH ? AND k = ?
         ORDER BY distance`
          )
        };
        this.stmtsByModel.set(modelId, stmts);
        return stmts;
      }
      insertBatch(items) {
        if (items.length === 0) return;
        const byModel = /* @__PURE__ */ new Map();
        for (const x of items) {
          let bucket = byModel.get(x.modelId);
          if (!bucket) {
            bucket = [];
            byModel.set(x.modelId, bucket);
          }
          bucket.push(x);
        }
        const tx = this.db.transaction(() => {
          for (const [modelId, xs] of byModel) {
            const stmts = this.getStmts(modelId);
            for (const x of xs) {
              stmts.insert.run(BigInt(x.chunkId), serializeVector(x.vector));
            }
          }
        });
        tx();
      }
      /**
       * Delete embeddings for a chunk across every registered model — the
       * caller doesn't track which models embedded the chunk.
       */
      deleteByChunk(chunkId) {
        for (const modelId of this.registeredModelIds()) {
          const stmts = this.getStmts(modelId);
          stmts.deleteByChunk.run(BigInt(chunkId));
        }
      }
      /**
       * Wipe every embedding row for the given model. Cheap because each
       * model owns its own table — equivalent to `DELETE FROM table`.
       */
      deleteByModel(modelId) {
        const stmts = this.getStmts(modelId);
        stmts.deleteAll.run();
      }
      searchSemantic(modelId, queryVector, topK) {
        const dim = this.dimForModel(modelId);
        if (queryVector.length !== dim) {
          throw new Error(
            `searchSemantic: query vector length ${queryVector.length} does not match model ${modelId} dim ${dim}`
          );
        }
        const stmts = this.getStmts(modelId);
        const rows = stmts.search.all(serializeVector(queryVector), topK);
        return rows.map((r) => ({ chunkId: r.chunk_id, distance: r.distance }));
      }
      /**
       * Every model_id with a materialized embeddings table. Read from the
       * model registry — every model that has ever been inserted-into has
       * its table created via `ensureTableForModel`.
       */
      registeredModelIds() {
        return this.models.listAll().map((m) => m.id);
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
        this._deleteByNote = db.prepare("DELETE FROM wikilinks WHERE source_note = ?");
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
function escapeAuditLikePrefix(prefix) {
  return prefix.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
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
        this._isIndexing = db.prepare(
          "SELECT COUNT(*) AS c FROM index_runs WHERE finished_at IS NULL"
        );
        this._recordWrite = db.prepare(`
      INSERT INTO write_audit (note_id, op, previous_hash, new_hash, expected_hash, client_id, diff_summary, at, is_memory_sink_write)
      VALUES (@note_id, @op, @previous_hash, @new_hash, @expected_hash, @client_id, @diff_summary, @at, @is_memory_sink_write)
    `);
      }
      db;
      _startRun;
      _finishRun;
      _listRuns;
      _recordWrite;
      _isIndexing;
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
      /** True iff at least one index_runs row in this vault has finished_at IS NULL. */
      isIndexing() {
        return (this._isIndexing.get()?.c ?? 0) > 0;
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
          at: Date.now(),
          // Phase 1 call sites that have not been threaded with the flag default
          // to 0 (non-memory write) — backwards-compatible with migration 009's
          // ALTER default. Memory-routed writes (record_observation, supersede)
          // pass `isMemorySinkWrite: true`.
          is_memory_sink_write: input.isMemorySinkWrite ? 1 : 0
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
        if (filter.isMemorySinkWrite !== void 0) {
          where.push("is_memory_sink_write = ?");
          params.push(filter.isMemorySinkWrite ? 1 : 0);
        }
        const limit = filter.limit ?? 100;
        const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
        const sql = `SELECT * FROM write_audit ${whereSql} ORDER BY id DESC LIMIT ?`;
        params.push(limit);
        return this.db.prepare(sql).all(...params);
      }
      /**
       * Plan 02-06 (MEM-09): epoch-ms timestamp of the most recent memory-sink
       * write to a note whose path begins with `pathPrefix`, or `null` if no
       * such row exists. Backed by the `idx_write_audit_memory` partial index
       * (migration 009).
       *
       * Looks up via the `notes.path` value joined to `write_audit.note_id`.
       * Returns null when the note row was hard-deleted (FK SET NULL) or
       * when no audit row matches.
       */
      lastMemoryWriteAtForPathPrefix(pathPrefix) {
        const row = this.db.prepare(
          `SELECT wa.at AS at
           FROM write_audit AS wa
           JOIN notes AS n ON n.id = wa.note_id
          WHERE wa.is_memory_sink_write = 1
            AND n.path LIKE ? ESCAPE '\\'
          ORDER BY wa.at DESC
          LIMIT 1`
        ).get(escapeAuditLikePrefix(pathPrefix) + "%");
        return row?.at ?? null;
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
        this._selectByName = db.prepare("SELECT * FROM models WHERE name = ?");
        this._selectActive = db.prepare(
          "SELECT * FROM models WHERE active = 1 ORDER BY id DESC LIMIT 1"
        );
        this._selectById = db.prepare("SELECT * FROM models WHERE id = ?");
        this._insert = db.prepare(`
      INSERT INTO models (name, provider, dim, created_at, active)
      VALUES (@name, @provider, @dim, @created_at, @active)
    `);
        this._deactivateAll = db.prepare("UPDATE models SET active = 0");
        this._activate = db.prepare("UPDATE models SET active = 1 WHERE id = ?");
        this._listAll = db.prepare("SELECT * FROM models ORDER BY id");
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
          created_at: Date.now(),
          active: input.active === false ? 0 : 1
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
      getByName(name) {
        return this._selectByName.get(name) ?? null;
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
        this.deleteStmt = db.prepare(`DELETE FROM note_aliases WHERE note_id = ?`);
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
function deriveVaultNameFromPath(dbPath) {
  if (!dbPath || dbPath === ":memory:") return void 0;
  const segs = dbPath.split(/[\\/]/);
  const base = segs[segs.length - 1];
  if (!base) return void 0;
  if (!base.endsWith(".db")) return void 0;
  const name = base.slice(0, -3);
  if (!name) return void 0;
  return name;
}
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
      /**
       * Name of the vault this DB belongs to, or `undefined` for `:memory:` /
       * unrecognised paths. Threaded into function-style migrations as
       * `MigrationContext.vaultName` so migration 008 can derive
       * `obsidian-fs://<vaultName>/<path>` (RESEARCH §doc_uri Dual-Column Migration,
       * plan 01-02).
       */
      vaultName;
      constructor(dbPath, vaultName) {
        this.vaultName = vaultName ?? deriveVaultNameFromPath(dbPath);
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
      static async open(dbPath, vaultName) {
        return new _Database(dbPath, vaultName);
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
        const ctx = { vaultName: this.vaultName };
        try {
          const tx = this.handle.transaction(() => {
            for (const m of pending) {
              if ("sql" in m) {
                this.handle.exec(m.sql);
              } else {
                m.run(this.handle, ctx);
              }
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
import { homedir as homedir3 } from "os";
import { join as join3 } from "path";
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
        return join3(homedir3(), ".vault-memory", "vaults");
      }
      static dbPathFor(vaultName) {
        return join3(_VaultManager.dbDirectory(), `${vaultName}.db`);
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
          const db = new Database(dbPath, cfg.name);
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
          throw new Error(`Unknown vault: "${name}". Configured vaults: ${known}`);
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
  return new Promise((resolve7) => setTimeout(resolve7, ms));
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
        const results = await Promise.all(batches.map((batch) => this.embedBatch(model, batch)));
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
            const response = await this.fetchWithTimeout(`${this.endpoint}/api/embed`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body
            });
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
          const response = await this.fetchWithTimeout(`${this.endpoint}/api/tags`, { method: "GET" });
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
        const ranks = new Array(rankings.length).fill(void 0);
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
  const rerankFanOut = Math.max(1, opts.rerankFanOut ?? 5);
  const perVaultTopN = opts.reranker ? topK * rerankFanOut : topK;
  const perVault = await Promise.all(
    opts.vaults.map(
      (vault) => searchOneVault(vault, query, opts.embeddingModel, rrfK, perVaultTopN, getQueryVector)
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
      if (chunk.text.trim().length < MIN_RERANK_TRIM_CHARS) continue;
      indexed.push({ hit: h, text: chunk.text });
      texts.push(chunk.text);
    }
    if (indexed.length === 0) {
      winners = flat.slice(0, topK);
    } else
      try {
        const scores = await opts.reranker.score(query, texts);
        if (scores.length !== indexed.length) {
          throw new Error(`reranker returned ${scores.length} scores for ${indexed.length} chunks`);
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
  const queryModelName = activeModel?.name ?? embeddingModelName;
  const canRunSemantic = activeModel !== null;
  const semanticPromise = canRunSemantic ? (async () => {
    const vec = await getQueryVector(queryModelName);
    if (!vec) return null;
    const hits = vault.db.embeddings.searchSemantic(activeModel.id, vec, fanK);
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
var DEFAULT_TOP_K, DEFAULT_RRF_K, MIN_RERANK_TRIM_CHARS;
var init_hybrid = __esm({
  "src/search/hybrid.ts"() {
    "use strict";
    init_esm_shims();
    DEFAULT_TOP_K = 10;
    DEFAULT_RRF_K = 60;
    MIN_RERANK_TRIM_CHARS = 20;
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
function matchesAnyGlob(path7, patterns) {
  for (const p of patterns) {
    if (compile(p).test(path7)) return true;
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
          throw new Error(`Reranker: expected ${chunks.length} vectors, got ${res.vectors.length}`);
        }
        return res.vectors.map((v) => -l2Norm(v));
      }
    };
  }
});

// src/rerank/onnx-reranker.ts
import { readFile as readFile2 } from "fs/promises";
import { existsSync } from "fs";
import { join as join4 } from "path";
function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}
function deriveTokenizerConfig(tokenizerJson) {
  const added = tokenizerJson.added_tokens ?? [];
  const byContent = new Map(added.map((t) => [t.content, t]));
  const pick = (...candidates) => {
    for (const c of candidates) if (byContent.has(c)) return c;
    return candidates[0];
  };
  return {
    bos_token: pick("<s>"),
    eos_token: pick("</s>"),
    pad_token: pick("<pad>"),
    unk_token: pick("<unk>")
  };
}
var OnnxReranker;
var init_onnx_reranker = __esm({
  "src/rerank/onnx-reranker.ts"() {
    "use strict";
    init_esm_shims();
    OnnxReranker = class {
      modelDir;
      maxLength;
      loaded = null;
      loading = null;
      constructor(opts) {
        this.modelDir = opts.modelDir;
        this.maxLength = opts.maxLength ?? 512;
      }
      /**
       * Score each chunk against the query. Returns sigmoid(logit) per pair.
       * Throws if the model files are missing (with a copy-pasteable curl
       * command in the error message).
       */
      async score(query, chunks) {
        if (chunks.length === 0) return [];
        const { session, tokenizer, ort } = await this.load();
        const encoded = chunks.map((chunk) => {
          const enc = tokenizer.encode(query, { text_pair: chunk });
          let ids = enc.ids;
          let mask = enc.attention_mask;
          if (ids.length > this.maxLength) {
            ids = ids.slice(0, this.maxLength);
            mask = mask.slice(0, this.maxLength);
          }
          return { ids, mask };
        });
        const seqLen = Math.max(...encoded.map((e) => e.ids.length));
        const batch = encoded.length;
        const inputIds = new BigInt64Array(batch * seqLen);
        const attentionMask = new BigInt64Array(batch * seqLen);
        for (let i = 0; i < batch; i++) {
          const row = encoded[i];
          for (let j = 0; j < row.ids.length; j++) {
            inputIds[i * seqLen + j] = BigInt(row.ids[j]);
            attentionMask[i * seqLen + j] = BigInt(row.mask[j]);
          }
        }
        const feeds = {
          input_ids: new ort.Tensor("int64", inputIds, [batch, seqLen]),
          attention_mask: new ort.Tensor("int64", attentionMask, [batch, seqLen])
        };
        const out = await session.run(feeds);
        const logitsTensor = out.logits ?? out[Object.keys(out)[0]];
        const data = logitsTensor.data;
        const scores = new Array(batch);
        for (let i = 0; i < batch; i++) {
          scores[i] = sigmoid(data[i]);
        }
        return scores;
      }
      async load() {
        if (this.loaded) return this.loaded;
        if (this.loading) return this.loading;
        this.loading = (async () => {
          const modelPath = join4(this.modelDir, "model_quantized.onnx");
          const tokenizerPath = join4(this.modelDir, "tokenizer.json");
          if (!existsSync(modelPath)) {
            throw new Error(
              `OnnxReranker: model file not found at ${modelPath}. Run: curl -L https://huggingface.co/onnx-community/bge-reranker-v2-m3-ONNX/resolve/main/onnx/model_quantized.onnx -o ${modelPath}`
            );
          }
          if (!existsSync(tokenizerPath)) {
            throw new Error(
              `OnnxReranker: tokenizer file not found at ${tokenizerPath}. Run: curl -L https://huggingface.co/onnx-community/bge-reranker-v2-m3-ONNX/resolve/main/tokenizer.json -o ${tokenizerPath}`
            );
          }
          const [ort, tokMod, tokJson] = await Promise.all([
            import("onnxruntime-node"),
            import("@huggingface/tokenizers"),
            readFile2(tokenizerPath, "utf-8")
          ]);
          const tokenizerJson = JSON.parse(tokJson);
          const config = deriveTokenizerConfig(tokenizerJson);
          const tokenizer = new tokMod.Tokenizer(tokenizerJson, config);
          const session = await ort.InferenceSession.create(modelPath);
          const loaded = { session, tokenizer, ort };
          this.loaded = loaded;
          return loaded;
        })();
        return this.loading;
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
    init_onnx_reranker();
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

// src/adapters/registry.ts
function formatDocId(scheme, authority, resource) {
  return parseDocId(`${scheme}://${authority}/${resource}`);
}
function decomposeDocId(docId) {
  parseDocId(docId);
  const schemeEnd = docId.indexOf("://");
  const scheme = docId.slice(0, schemeEnd);
  const rest = docId.slice(schemeEnd + 3);
  const authoritySlash = rest.indexOf("/");
  const authority = rest.slice(0, authoritySlash);
  const resource = rest.slice(authoritySlash + 1);
  return { scheme, authority, resource };
}
function parseSourceHandle(s) {
  if (!SOURCE_HANDLE_PATTERN.test(s)) {
    throw new Error(
      `Invalid SourceHandle: ${JSON.stringify(s)}. Expected <scheme>://<authority> with no resource path or trailing slash.`
    );
  }
  return s;
}
var DOC_ID_PATTERN, SOURCE_HANDLE_PATTERN, parseDocId, AdapterRegistry;
var init_registry = __esm({
  "src/adapters/registry.ts"() {
    "use strict";
    init_esm_shims();
    DOC_ID_PATTERN = /^[a-z][a-z0-9-]*:\/\/[^/]+\/.+$/;
    SOURCE_HANDLE_PATTERN = /^[a-z][a-z0-9-]*:\/\/[^/]+$/;
    ({ parseDocId } = /* @__PURE__ */ (() => {
      const mint = (s) => s;
      const parse = (s) => {
        if (!DOC_ID_PATTERN.test(s)) {
          throw new Error(
            `Invalid DocId: ${JSON.stringify(s)}. Expected <scheme>://<authority>/<resource> (scheme: lowercase letter + alnum/dashes; authority: non-slash; resource: non-empty).`
          );
        }
        return mint(s);
      };
      return { parseDocId: parse };
    })());
    AdapterRegistry = class {
      sources = /* @__PURE__ */ new Map();
      deliveries = /* @__PURE__ */ new Map();
      changeFeeds = /* @__PURE__ */ new Map();
      // ── source ────────────────────────────────────────────────────────────────
      /** Register a source. Overwrites any prior registration under the same handle. */
      registerSource(handle, adapter) {
        this.sources.set(handle, adapter);
      }
      /** Resolve a source. Throws with a helpful message on miss. */
      resolveSource(handle) {
        const a = this.sources.get(handle);
        if (!a) {
          const known = [...this.sources.keys()].join(", ") || "(none)";
          throw new Error(`Unknown source handle: "${handle}". Registered sources: ${known}`);
        }
        return a;
      }
      /** List registered source handles. */
      listSources() {
        return [...this.sources.keys()];
      }
      // ── delivery ──────────────────────────────────────────────────────────────
      registerDelivery(handle, adapter) {
        this.deliveries.set(handle, adapter);
      }
      resolveDelivery(handle) {
        const a = this.deliveries.get(handle);
        if (!a) {
          const known = [...this.deliveries.keys()].join(", ") || "(none)";
          throw new Error(`Unknown delivery handle: "${handle}". Registered deliveries: ${known}`);
        }
        return a;
      }
      listDeliveries() {
        return [...this.deliveries.keys()];
      }
      // ── change-feed ───────────────────────────────────────────────────────────
      registerChangeFeed(handle, feed) {
        this.changeFeeds.set(handle, feed);
      }
      resolveChangeFeed(handle) {
        const f = this.changeFeeds.get(handle);
        if (!f) {
          const known = [...this.changeFeeds.keys()].join(", ") || "(none)";
          throw new Error(`Unknown change-feed handle: "${handle}". Registered feeds: ${known}`);
        }
        return f;
      }
      listChangeFeeds() {
        return [...this.changeFeeds.keys()];
      }
    };
  }
});

// src/adapters/source/obsidian-fs/scanner.ts
import { promises as fs2 } from "fs";
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
    entries = await fs2.readdir(dir, { withFileTypes: true });
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
  "src/adapters/source/obsidian-fs/scanner.ts"() {
    "use strict";
    init_esm_shims();
    DEFAULT_EXCLUDES = [".obsidian/**", ".trash/**", "node_modules/**"];
  }
});

// src/adapters/source/obsidian-fs/wikilinks.ts
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
function extractFrontmatterWikilinks(frontmatter) {
  if (!frontmatter) return [];
  const results = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (key === "aliases" || key === "alias") continue;
    collectFromValue(value, results);
  }
  return results;
}
function collectFromValue(value, out) {
  if (typeof value === "string") {
    collectFromString(value, out);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFromValue(item, out);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) {
      collectFromValue(v, out);
    }
  }
}
function collectFromString(s, out) {
  FRONTMATTER_WIKILINK_RE.lastIndex = 0;
  let match;
  while ((match = FRONTMATTER_WIKILINK_RE.exec(s)) !== null) {
    const inner = match[1];
    if (inner === void 0) continue;
    const parsed = parseInner(inner);
    if (parsed === null) continue;
    out.push({ ...parsed, line: 0 });
  }
}
var WIKILINK_RE, FRONTMATTER_WIKILINK_RE;
var init_wikilinks2 = __esm({
  "src/adapters/source/obsidian-fs/wikilinks.ts"() {
    "use strict";
    init_esm_shims();
    WIKILINK_RE = /(^|[^!])\[\[([^\[\]\n]+?)\]\]/g;
    FRONTMATTER_WIKILINK_RE = /\[\[([^\[\]\n]+?)\]\]/g;
  }
});

// src/adapters/source/obsidian-fs/hash.ts
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
    const parts = keys.map((k) => JSON.stringify(k) + ":" + canonicalJsonStringify(obj[k]));
    return "{" + parts.join(",") + "}";
  }
  const s = JSON.stringify(value);
  return s === void 0 ? "null" : s;
}
function computeNoteHash(content, frontmatter) {
  return sha256(content + canonicalJsonStringify(frontmatter ?? {}));
}
function computeBodyHash(content) {
  return sha256(content);
}
var init_hash = __esm({
  "src/adapters/source/obsidian-fs/hash.ts"() {
    "use strict";
    init_esm_shims();
  }
});

// src/adapters/source/obsidian-fs/parser.ts
import { promises as fs3 } from "fs";
import * as path3 from "path";
import matter from "gray-matter";
async function parseNote(absolutePath, vaultRoot) {
  const raw = await fs3.readFile(absolutePath, "utf-8");
  const stat = await fs3.stat(absolutePath);
  const parsed = matter(raw);
  const content = parsed.content;
  const fmData = parsed.data;
  const frontmatter = fmData !== void 0 && Object.keys(fmData).length > 0 ? fmData : null;
  const title = extractTitle(content) ?? path3.basename(absolutePath, ".md");
  const hash = computeNoteHash(content, frontmatter);
  const bodyHash = computeBodyHash(content);
  const mtime = Math.floor(stat.mtimeMs);
  const bodyLinks = extractWikilinks(content);
  const frontmatterLinks = extractFrontmatterWikilinks(frontmatter);
  const wikilinks = frontmatterLinks.length === 0 ? bodyLinks : mergeFrontmatterIntoBody(bodyLinks, frontmatterLinks);
  const wordCount = countWords(content);
  const relativePath = toPosix2(path3.relative(path3.resolve(vaultRoot), path3.resolve(absolutePath)));
  return {
    relativePath,
    content,
    frontmatter,
    title,
    hash,
    bodyHash,
    mtime,
    wikilinks,
    wordCount
  };
}
function mergeFrontmatterIntoBody(body, fm) {
  const seen = /* @__PURE__ */ new Set();
  for (const w of body) {
    seen.add(`${w.normalizedTarget}\0${w.anchor ?? ""}`);
  }
  const result = body.slice();
  for (const w of fm) {
    const key = `${w.normalizedTarget}\0${w.anchor ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(w);
  }
  return result;
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
  "src/adapters/source/obsidian-fs/parser.ts"() {
    "use strict";
    init_esm_shims();
    init_wikilinks2();
    init_hash();
  }
});

// src/adapters/source/obsidian-fs/index.ts
var obsidian_fs_exports = {};
__export(obsidian_fs_exports, {
  ObsidianFsSource: () => ObsidianFsSource
});
import { promises as fs4 } from "fs";
import * as path4 from "path";
var SCHEME, ObsidianFsSource;
var init_obsidian_fs = __esm({
  "src/adapters/source/obsidian-fs/index.ts"() {
    "use strict";
    init_esm_shims();
    init_registry();
    init_scanner();
    init_parser();
    init_hash();
    SCHEME = "obsidian-fs";
    ObsidianFsSource = class {
      constructor(vault) {
        this.vault = vault;
        this.handle = parseSourceHandle(`${SCHEME}://${vault.name}`);
      }
      vault;
      handle;
      capabilities = {
        bodyShape: "flat-text",
        properties: "untyped",
        linkTypes: ["wikilink"],
        identityStable: false,
        permissions: false,
        contentHashStable: true,
        refHashKind: "content",
        watch: "push"
      };
      // ── enumeration ────────────────────────────────────────────────────────────
      async *listDocuments(opts) {
        const excludeOverlay = opts?.excludeGlobs;
        const files = await scanVault(this.vault.path, {
          ...excludeOverlay ? { excludeGlobs: excludeOverlay } : {}
        });
        const since = opts?.since;
        const limit = opts?.limit;
        let yielded = 0;
        for (const abs of files) {
          if (limit !== void 0 && yielded >= limit) break;
          const rel = this.toPosix(path4.relative(path4.resolve(this.vault.path), abs));
          const stat = await fs4.stat(abs);
          const mtime = Math.floor(stat.mtimeMs);
          if (since !== void 0 && mtime < since) continue;
          const body = await fs4.readFile(abs, "utf-8");
          const hash = computeBodyHash(body);
          yield { id: this.pathToDocId(rel), mtime, hash };
          yielded++;
        }
      }
      // ── single-doc reads ───────────────────────────────────────────────────────
      async readDocument(id) {
        const rel = this.docIdToPath(id);
        const abs = this.absPath(rel);
        const parsed = await parseNote(abs, this.vault.path);
        const wikilinks = parsed.wikilinks.map((w) => {
          const ref = { target: w.normalizedTarget };
          if (w.alias !== null) ref.alias = w.alias;
          if (w.anchor !== null) ref.section = w.anchor;
          return ref;
        });
        const properties = {
          ...parsed.frontmatter ?? {},
          wikilinks
        };
        return {
          id,
          source: this.handle,
          title: parsed.title,
          blocks: [{ kind: "paragraph", text: parsed.content }],
          properties,
          links: [],
          mtime: parsed.mtime,
          hash: parsed.hash,
          display_url: this.formatDisplayUrl(id)
        };
      }
      async hash(id) {
        const rel = this.docIdToPath(id);
        const abs = this.absPath(rel);
        const body = await fs4.readFile(abs, "utf-8");
        return computeBodyHash(body);
      }
      async exists(id) {
        try {
          const rel = this.docIdToPath(id);
          const abs = this.absPath(rel);
          await fs4.stat(abs);
          return true;
        } catch {
          return false;
        }
      }
      // ── display ────────────────────────────────────────────────────────────────
      formatDisplayUrl(id) {
        const rel = this.docIdToPath(id);
        const vault = encodeURIComponent(this.vault.name);
        const file = encodeURIComponent(rel);
        return `obsidian://open?vault=${vault}&file=${file}`;
      }
      // ── helpers ────────────────────────────────────────────────────────────────
      /**
       * Parse the URI authority + resource off a DocId. Asserts the authority
       * matches `this.vault.name` — prevents one vault's adapter from reading
       * another vault's file via a forged DocId (T-01-03-02 in the plan's
       * threat model).
       */
      docIdToPath(id) {
        const prefix = `${SCHEME}://`;
        if (!id.startsWith(prefix)) {
          throw new Error(`DocId scheme mismatch: expected "${SCHEME}://\u2026", got ${JSON.stringify(id)}`);
        }
        const rest = id.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash < 0) {
          throw new Error(`Invalid DocId shape: missing resource path in ${JSON.stringify(id)}`);
        }
        const authority = rest.slice(0, slash);
        const resource = rest.slice(slash + 1);
        if (authority !== this.vault.name) {
          throw new Error(
            `DocId vault mismatch: id authority "${authority}" does not match this adapter's configured vault "${this.vault.name}"`
          );
        }
        if (resource.length === 0) {
          throw new Error(`Invalid DocId: empty resource path in ${JSON.stringify(id)}`);
        }
        return resource;
      }
      pathToDocId(rel) {
        const posix2 = this.toPosix(rel);
        return formatDocId(SCHEME, this.vault.name, posix2);
      }
      absPath(rel) {
        return path4.resolve(this.vault.path, rel);
      }
      toPosix(p) {
        return p.split(path4.sep).join("/");
      }
    };
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
    if (content.trim().length < MIN_CHUNK_TRIM_CHARS) return [];
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
    if (text.trim().length < MIN_CHUNK_TRIM_CHARS) continue;
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
var DEFAULT_MAX_TOKENS, DEFAULT_OVERLAP_TOKENS, MIN_CHUNK_TRIM_CHARS;
var init_chunker = __esm({
  "src/chunker/chunker.ts"() {
    "use strict";
    init_esm_shims();
    init_tokens();
    init_headings();
    DEFAULT_MAX_TOKENS = 400;
    DEFAULT_OVERLAP_TOKENS = 50;
    MIN_CHUNK_TRIM_CHARS = 3;
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
  let secondaryModelRow = null;
  if (options.secondaryEmbeddingModel) {
    const secName = options.secondaryEmbeddingModel;
    log(`Probing secondary (shadow) model: ${secName}`);
    const secExists = await options.ollama.modelExists(secName);
    if (!secExists) {
      throw new Error(
        `Secondary embedding model "${secName}" not found in Ollama. Run: ollama pull ${secName}`
      );
    }
    const secProbe = await options.ollama.embed({
      model: secName,
      texts: ["probe"]
    });
    const row = vault.db.models.upsert({
      name: secName,
      provider: "ollama",
      dim: secProbe.dim,
      active: false
    });
    secondaryModelRow = { id: row.id, dim: row.dim };
  }
  vault.db.audit.startRun({
    runId,
    vaultName: vault.config.name,
    modelId: modelRow.id,
    trigger: mode === "full" ? "manual-full" : "manual-incremental"
  });
  let notesIndexed = 0;
  let notesUpdated = 0;
  let notesDeleted = 0;
  let notesSkipped = 0;
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
      let parsed;
      try {
        parsed = await parseNote(file, vault.config.path);
      } catch (err) {
        notesSkipped++;
        const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
        const rel = file.startsWith(vault.config.path) ? file.slice(vault.config.path.length + 1) : file;
        log(`  skipped (parse error): ${rel} \u2014 ${msg}`);
        continue;
      }
      const upsert = vault.db.notes.upsertByPath({
        path: parsed.relativePath,
        content: parsed.content,
        frontmatter: parsed.frontmatter ? JSON.stringify(parsed.frontmatter) : null,
        title: parsed.title,
        hash: parsed.hash,
        bodyHash: parsed.bodyHash,
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
        throw new Error(`Embedding dimension mismatch: expected ${dim}, got ${embedResult.dim}`);
      }
      const embeddingInputs = chunkIds.map((chunkId, i) => ({
        chunkId,
        modelId: modelRow.id,
        vector: embedResult.vectors[i]
      }));
      vault.db.embeddings.insertBatch(embeddingInputs);
      if (secondaryModelRow) {
        const secEmbed = await options.ollama.embed({
          model: options.secondaryEmbeddingModel,
          texts: chunks.map((c) => c.text)
        });
        if (secEmbed.dim !== secondaryModelRow.dim) {
          throw new Error(
            `Secondary embedding dimension mismatch: expected ${secondaryModelRow.dim}, got ${secEmbed.dim}`
          );
        }
        vault.db.embeddings.insertBatch(
          chunkIds.map((chunkId, i) => ({
            chunkId,
            modelId: secondaryModelRow.id,
            vector: secEmbed.vectors[i]
          }))
        );
      }
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
    if (notesSkipped > 0) {
      log(`${notesSkipped} note(s) skipped due to parse errors`);
    }
    return {
      runId,
      status: "completed",
      notesIndexed,
      notesUpdated,
      notesDeleted,
      notesSkipped,
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
      notesSkipped,
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
    init_scanner();
    init_parser();
    init_chunker2();
    init_ollama();
    init_resolver();
  }
});

// src/indexer/single.ts
import * as path5 from "path";
async function indexNote(options) {
  const { vault, absolutePath, embeddingModel, ollama } = options;
  const secondaryName = options.secondaryEmbeddingModel;
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
    return emptyResult("parse_error");
  }
  const existing = vault.db.notes.getByPath(parsed.relativePath);
  if (existing && existing.hash === parsed.hash) {
    vault.db.aliases.setForNote(existing.id, extractAliases(parsed.frontmatter));
    return {
      status: "unchanged",
      notePath: parsed.relativePath,
      noteId: existing.id,
      chunksCreated: 0,
      isNew: false
    };
  }
  if (existing && existing.body_hash && existing.body_hash === parsed.bodyHash) {
    const upsert2 = vault.db.notes.upsertByPath({
      path: parsed.relativePath,
      content: parsed.content,
      frontmatter: parsed.frontmatter ? JSON.stringify(parsed.frontmatter) : null,
      title: parsed.title,
      hash: parsed.hash,
      bodyHash: parsed.bodyHash,
      mtime: parsed.mtime,
      wordCount: parsed.wordCount
    });
    vault.db.aliases.setForNote(upsert2.id, extractAliases(parsed.frontmatter));
    vault.db.wikilinks.deleteByNote(upsert2.id);
    insertWikilinks2(vault, upsert2.id, parsed.wikilinks);
    return {
      status: "indexed",
      notePath: parsed.relativePath,
      noteId: upsert2.id,
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
    bodyHash: parsed.bodyHash,
    mtime: parsed.mtime,
    wordCount: parsed.wordCount
  });
  vault.db.aliases.setForNote(upsert.id, extractAliases(parsed.frontmatter));
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
  if (secondaryName) {
    const secondaryModel = vault.db.models.getByName(secondaryName);
    if (secondaryModel && secondaryModel.id !== activeModel.id) {
      const secEmbed = await ollama.embed({
        model: secondaryName,
        texts: chunks.map((c) => c.text)
      });
      if (secEmbed.dim !== secondaryModel.dim) {
        throw new Error(
          `single-indexer: shadow embedding dim ${secEmbed.dim} does not match registered dim ${secondaryModel.dim} for "${secondaryName}".`
        );
      }
      vault.db.embeddings.insertBatch(
        chunkIds.map((chunkId, i) => ({
          chunkId,
          modelId: secondaryModel.id,
          vector: secEmbed.vectors[i]
        }))
      );
    }
  }
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
  const absResolved = path5.resolve(absolutePath);
  const rootResolved = path5.resolve(vaultRoot);
  const absPosix = absResolved.split(path5.sep).join("/");
  const rootPosix = rootResolved.split(path5.sep).join("/");
  const rootWithSep = rootPosix.endsWith("/") ? rootPosix : `${rootPosix}/`;
  return absPosix === rootPosix || absPosix.startsWith(rootWithSep);
}
function toRelativePosix(absolutePath, vaultRoot) {
  return path5.relative(path5.resolve(vaultRoot), path5.resolve(absolutePath)).split(path5.sep).join("/");
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
    init_parser();
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
      log(`catch-up indexed ${parsed.relativePath} (${result.isNew ? "new" : "updated"})`);
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
function joinAbs(root, relative5) {
  if (root.endsWith("/")) return `${root}${relative5}`;
  return `${root}/${relative5}`;
}
var init_catchup = __esm({
  "src/indexer/catchup.ts"() {
    "use strict";
    init_esm_shims();
    init_scanner();
    init_parser();
    init_single();
  }
});

// src/indexer/shadow.ts
import { randomUUID as randomUUID2 } from "crypto";
async function startShadowIndex(options) {
  const { vault, model, ollama } = options;
  const log = options.log ?? (() => {
  });
  const batchSize = options.batchSize ?? 16;
  const runId = randomUUID2();
  const started = Date.now();
  if (!await ollama.modelExists(model)) {
    throw new Error(`Shadow model "${model}" not found in Ollama. Run: ollama pull ${model}`);
  }
  const probe = await ollama.embed({ model, texts: ["probe"] });
  const dim = probe.dim;
  const modelRow = vault.db.models.upsert({
    name: model,
    provider: "ollama",
    dim,
    active: false
  });
  vault.db.embeddings.ensureTableForModel(modelRow.id, dim);
  vault.db.audit.startRun({
    runId,
    vaultName: vault.config.name,
    modelId: modelRow.id,
    trigger: "shadow"
  });
  const embTable = `embeddings_m${modelRow.id}_d${dim}`;
  const pendingSql = `
    SELECT c.id AS id, c.text AS text
    FROM chunks c
    LEFT JOIN ${embTable} e ON e.chunk_id = c.id
    WHERE e.chunk_id IS NULL
    ORDER BY c.id
  `;
  const totalSql = `SELECT COUNT(*) AS c FROM chunks`;
  const pending = vault.db.handle.prepare(pendingSql).all();
  const totalRow = vault.db.handle.prepare(totalSql).get();
  const chunksTotal = totalRow?.c ?? 0;
  const chunksSkipped = chunksTotal - pending.length;
  log(
    `shadow-index "${model}" (dim=${dim}): ${pending.length} pending, ${chunksSkipped} already embedded`
  );
  let chunksEmbedded = 0;
  try {
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize);
      const embedResp = await ollama.embed({
        model,
        texts: batch.map((c) => c.text)
      });
      if (embedResp.dim !== dim) {
        throw new Error(
          `Shadow embedding dim mismatch mid-run: expected ${dim}, got ${embedResp.dim} on batch starting chunk_id ${batch[0]?.id}`
        );
      }
      vault.db.embeddings.insertBatch(
        batch.map((row, j) => ({
          chunkId: row.id,
          modelId: modelRow.id,
          vector: embedResp.vectors[j]
        }))
      );
      chunksEmbedded += batch.length;
      if (i % (batchSize * 8) === 0) {
        log(`  ${chunksEmbedded}/${pending.length}\u2026`);
      }
    }
    vault.db.audit.finishRun(runId, {
      notesIndexed: 0,
      chunksCreated: chunksEmbedded,
      notesUpdated: 0,
      notesDeleted: 0
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vault.db.audit.finishRun(runId, {
      notesIndexed: 0,
      chunksCreated: chunksEmbedded,
      notesUpdated: 0,
      notesDeleted: 0,
      error: message
    });
    throw err;
  }
  return {
    runId,
    modelId: modelRow.id,
    modelName: model,
    dim,
    chunksTotal,
    chunksEmbedded,
    chunksSkipped,
    durationMs: Date.now() - started
  };
}
function listModels(vault) {
  const rows = vault.db.models.listAll();
  return rows.map((m) => {
    let count = 0;
    try {
      vault.db.embeddings.ensureTableForModel(m.id, m.dim);
      const row = vault.db.handle.prepare(`SELECT COUNT(*) AS c FROM embeddings_m${m.id}_d${m.dim}`).get();
      count = row?.c ?? 0;
    } catch {
      count = 0;
    }
    return {
      id: m.id,
      name: m.name,
      provider: m.provider,
      dim: m.dim,
      active: m.active === 1,
      embedded_chunk_count: count
    };
  });
}
function switchActiveModel(vault, targetModelName) {
  const target = vault.db.models.getByName(targetModelName);
  if (!target) {
    return { ok: false, reason: "unknown_model" };
  }
  const current = vault.db.models.getActive();
  if (current && current.id === target.id) {
    return {
      ok: false,
      reason: "already_active",
      switched_from: current.name,
      switched_to: target.name
    };
  }
  vault.db.embeddings.ensureTableForModel(target.id, target.dim);
  const embTable = `embeddings_m${target.id}_d${target.dim}`;
  const missingRow = vault.db.handle.prepare(
    `SELECT COUNT(*) AS c
       FROM chunks c
       LEFT JOIN ${embTable} e ON e.chunk_id = c.id
       WHERE e.chunk_id IS NULL`
  ).get();
  const missing = missingRow?.c ?? 0;
  if (missing > 0) {
    return {
      ok: false,
      reason: "incomplete",
      missing_chunks: missing,
      switched_from: current?.name,
      switched_to: target.name
    };
  }
  vault.db.models.setActive(target.id);
  return {
    ok: true,
    switched_from: current?.name,
    switched_to: target.name
  };
}
var init_shadow = __esm({
  "src/indexer/shadow.ts"() {
    "use strict";
    init_esm_shims();
  }
});

// src/indexer/vacuum.ts
function vacuumEmbeddings(vault) {
  const startedAt = Date.now();
  const models = vault.db.models.listAll();
  const per_model = [];
  let total_removed = 0;
  vault.db.transaction(() => {
    for (const m of models) {
      vault.db.embeddings.ensureTableForModel(m.id, m.dim);
      const table = `embeddings_m${m.id}_d${m.dim}`;
      const beforeRow = vault.db.handle.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
      const before = beforeRow?.c ?? 0;
      const orphans = vault.db.handle.prepare(
        `SELECT chunk_id FROM ${table}
           WHERE chunk_id NOT IN (SELECT id FROM chunks)`
      ).all();
      if (orphans.length > 0) {
        const stmt = vault.db.handle.prepare(`DELETE FROM ${table} WHERE chunk_id = ?`);
        for (const o of orphans) {
          stmt.run(BigInt(o.chunk_id));
        }
      }
      const removed = orphans.length;
      const kept = before - removed;
      total_removed += removed;
      per_model.push({
        model_id: m.id,
        model_name: m.name,
        dim: m.dim,
        table,
        removed,
        kept
      });
    }
  });
  return {
    total_removed,
    per_model,
    duration_ms: Date.now() - startedAt
  };
}
var init_vacuum = __esm({
  "src/indexer/vacuum.ts"() {
    "use strict";
    init_esm_shims();
  }
});

// src/indexer/index.ts
var indexer_exports = {};
__export(indexer_exports, {
  catchupVault: () => catchupVault,
  extractAliases: () => extractAliases,
  indexNote: () => indexNote,
  indexVault: () => indexVault,
  listModels: () => listModels,
  removeNote: () => removeNote,
  resolveWikilinkTarget: () => resolveWikilinkTarget,
  startShadowIndex: () => startShadowIndex,
  switchActiveModel: () => switchActiveModel,
  vacuumEmbeddings: () => vacuumEmbeddings
});
var init_indexer2 = __esm({
  "src/indexer/index.ts"() {
    "use strict";
    init_esm_shims();
    init_indexer();
    init_single();
    init_catchup();
    init_shadow();
    init_vacuum();
  }
});

// src/adapters/delivery/obsidian-fs/fs.ts
import { promises as fs5 } from "fs";
import { dirname, isAbsolute, resolve as resolve6, sep as sep5 } from "path";
import { randomBytes } from "crypto";
async function atomicWriteFile(absPath, content) {
  if (!isAbsolute(absPath)) {
    throw new Error(`atomicWriteFile requires an absolute path: ${absPath}`);
  }
  const parent = dirname(absPath);
  await fs5.mkdir(parent, { recursive: true });
  const suffix = randomBytes(8).toString("hex");
  const tmpPath = `${absPath}.tmp.${suffix}`;
  try {
    await fs5.writeFile(tmpPath, content, "utf-8");
    await fs5.rename(tmpPath, absPath);
  } catch (err) {
    try {
      await fs5.unlink(tmpPath);
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
  const root = resolve6(vaultRoot);
  const target = resolve6(root, relativePath);
  const rootWithSep = root.endsWith(sep5) ? root : root + sep5;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new OutsideVaultError(relativePath, vaultRoot);
  }
  if (target === root) {
    throw new OutsideVaultError(relativePath, vaultRoot);
  }
  let realRoot;
  try {
    realRoot = await fs5.realpath(root);
  } catch {
    throw new OutsideVaultError(relativePath, vaultRoot);
  }
  const realTarget = await resolveExistingAncestor(target);
  const realRootWithSep = realRoot.endsWith(sep5) ? realRoot : realRoot + sep5;
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
      const real = await fs5.realpath(current);
      return trailing.length === 0 ? real : resolve6(real, ...trailing.reverse());
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
  "src/adapters/delivery/obsidian-fs/fs.ts"() {
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

// src/adapters/delivery/obsidian-fs/write.ts
import { promises as fs6 } from "fs";
import { basename as basename3 } from "path";
import matter2 from "gray-matter";
function permissionDenied(vaultName) {
  return {
    ok: false,
    reason: "permission_denied",
    message: `Vault "${vaultName}" is read-only (write_enabled=false in config.toml)`
  };
}
function computeHash(content, frontmatter) {
  return computeNoteHash(content, frontmatter);
}
function extractTitle2(content, relativePath) {
  for (const line of content.split("\n")) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m !== null && m[1] !== void 0) return m[1].trim();
  }
  return basename3(relativePath, ".md");
}
function countWords2(content) {
  if (content.length === 0) return 0;
  return content.split(/\s+/).filter((s) => s.length > 0).length;
}
async function readExistingFile(absPath) {
  let raw;
  try {
    raw = await fs6.readFile(absPath, "utf-8");
  } catch (err) {
    if (typeof err === "object" && err !== null && err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
  const parsed = matter2(raw);
  const fmData = parsed.data;
  const frontmatter = fmData !== void 0 && Object.keys(fmData).length > 0 ? fmData : null;
  const hash = computeHash(parsed.content, frontmatter);
  return { raw, content: parsed.content, frontmatter, hash };
}
async function writeNote(input) {
  const { vault, relativePath, content, registry } = input;
  const frontmatter = input.frontmatter ?? null;
  const clientId = input.clientId ?? UNKNOWN_CLIENT_ID;
  if (registry) {
    const docId = formatDocId("obsidian-fs", vault.config.name, relativePath);
    const sink = registry.findSinkContaining(docId);
    if (sink !== null) {
      return {
        ok: false,
        reason: "sink_write_blocked",
        sinkName: sink.name,
        message: `Target ${relativePath} resolves into MemorySink "${sink.name}". v1 write_note is refused for memory-sink targets.`,
        suggestion: `Use record_observation for sink '${sink.name}'.`
      };
    }
  }
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
  const fileText = frontmatter !== null && Object.keys(frontmatter).length > 0 ? matter2.stringify(content, frontmatter) : content;
  input.onBeforeFsWrite?.();
  await atomicWriteFile(absPath, fileText);
  const written = await readExistingFile(absPath);
  if (written === null) {
    throw new Error(`Internal error: file disappeared after write: ${relativePath}`);
  }
  const stat = await fs6.stat(absPath);
  const previousNote = vault.db.notes.getByPath(relativePath);
  const previousHash = previousNote?.hash ?? null;
  const title = extractTitle2(written.content, relativePath);
  let upsertId;
  try {
    upsertId = vault.db.transaction(() => {
      const up = vault.db.notes.upsertByPath({
        path: relativePath,
        content: written.content,
        frontmatter: written.frontmatter ? JSON.stringify(written.frontmatter) : null,
        title,
        hash: written.hash,
        bodyHash: computeBodyHash(written.content),
        mtime: Math.floor(stat.mtimeMs),
        wordCount: countWords2(written.content)
      });
      vault.db.aliases.setForNote(up.id, extractAliases(written.frontmatter));
      vault.db.audit.recordWrite({
        noteId: up.id,
        op: created ? "create" : "update",
        previousHash,
        newHash: written.hash,
        expectedHash: input.expectedHash ?? null,
        clientId,
        diffSummary: null,
        // Plan 02-06 (MEM-08): stamp the audit row with the sink-routing
        // flag the facade derived from `opts.sink !== undefined`. v1 call
        // sites that haven't been threaded leave the field undefined →
        // recordWrite defaults to 0 (non-memory).
        isMemorySinkWrite: input.isMemorySinkWrite ?? false
      });
      return up.id;
    });
  } catch (dbErr) {
    input.onBeforeFsWrite?.();
    try {
      if (created) {
        await fs6.unlink(absPath);
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
  const { vault, relativePath, expectedHash, registry } = input;
  const clientId = input.clientId ?? UNKNOWN_CLIENT_ID;
  if (registry) {
    const docId = formatDocId("obsidian-fs", vault.config.name, relativePath);
    const sink = registry.findSinkContaining(docId);
    if (sink !== null) {
      return {
        ok: false,
        reason: "sink_write_blocked",
        sinkName: sink.name,
        message: `Target ${relativePath} resolves into MemorySink "${sink.name}". Hard deletion of memory documents is not permitted in v2.0.0.`,
        suggestion: "Use supersede to retire memory documents. Hard deletion is not yet supported in v2.0.0."
      };
    }
  }
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
  await fs6.unlink(absPath);
  if (previousNote !== null) {
    vault.db.transaction(() => {
      vault.db.audit.recordWrite({
        noteId: previousNote.id,
        op: "delete",
        previousHash,
        newHash: null,
        expectedHash,
        clientId,
        diffSummary: null,
        // Plan 02-06 (MEM-08): symmetric stamp on delete. Production
        // deletes targeting a sink are refused by the entry-point Guard
        // and the facade — so this flag is normally `false` on delete
        // rows. Pass-through retained for symmetry / future admin paths.
        isMemorySinkWrite: input.isMemorySinkWrite ?? false
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
var UNKNOWN_CLIENT_ID;
var init_write = __esm({
  "src/adapters/delivery/obsidian-fs/write.ts"() {
    "use strict";
    init_esm_shims();
    init_hash();
    init_indexer2();
    init_fs();
    init_registry();
    UNKNOWN_CLIENT_ID = "unknown";
  }
});

// src/memory/validator.ts
function getAt(props, key) {
  if (!props || typeof props !== "object") return void 0;
  return props[key];
}
function validateAgentWrite(id, doc, sink, contract) {
  const props = doc.properties;
  const source = getAt(props, "source");
  if (source === "agent" && sink === null) {
    return {
      ok: false,
      reason: "agent_write_outside_sink",
      message: `source:"agent" writes are only permitted under a configured MemorySink. Target ${id} does not resolve into any sink.`,
      suggestion: "Use record_observation for memory writes; or change source to 'user' / 'imported'."
    };
  }
  if (source !== void 0 && source !== "agent" && sink !== null) {
    return {
      ok: false,
      reason: "non_agent_write_inside_sink",
      sinkName: sink.name,
      message: `source:"${String(source)}" writes are not permitted into MemorySink "${sink.name}".`,
      suggestion: "Memory sinks accept source:'agent' writes only. User notes belong in the surrounding vault."
    };
  }
  if (sink !== null && contract !== null) {
    const result = contract.propertiesSchema.safeParse(props ?? {});
    if (!result.success) {
      const issue = result.error.issues[0];
      if (!issue) return null;
      const pathHead = issue.path[0];
      const key = typeof pathHead === "string" ? pathHead : void 0;
      if (key === "superseded_reason" || key === "superseded_by") {
        return {
          ok: false,
          reason: "supersede_mismatch",
          sinkName: sink.name,
          ...key !== void 0 ? { key } : {},
          message: `Cross-field rule failed at "${key}": ${issue.message}`,
          suggestion: "When status is 'superseded', set both superseded_by (DocId) and superseded_reason (non-empty string)."
        };
      }
      const observed = key !== void 0 ? getAt(props, key) : void 0;
      if (observed === void 0) {
        return {
          ok: false,
          reason: "missing_provenance",
          sinkName: sink.name,
          ...key !== void 0 ? { key } : {},
          message: `Required property "${key ?? "(unknown)"}" is missing for writes into MemorySink "${sink.name}".`,
          suggestion: `Set properties.${key ?? "<key>"} before retrying. See contract "${contract.name}" required keys: ${contract.requiredKeys.join(", ")}.`
        };
      }
      return {
        ok: false,
        reason: "invalid_provenance",
        sinkName: sink.name,
        ...key !== void 0 ? { key } : {},
        observedValue: observed,
        message: `Property "${key ?? "(unknown)"}" failed validation: ${issue.message}`,
        suggestion: `See contract "${contract.name}" for valid values.`
      };
    }
  }
  return null;
}
var init_validator = __esm({
  "src/memory/validator.ts"() {
    "use strict";
    init_esm_shims();
  }
});

// src/memory/contract/default-v1.ts
import { z as z3 } from "zod";
var requiredKeys, baseShape, DEFAULT_MEMORY_V1;
var init_default_v1 = __esm({
  "src/memory/contract/default-v1.ts"() {
    "use strict";
    init_esm_shims();
    requiredKeys = [
      "source",
      "confidence",
      "evidence",
      "status",
      "observed_at",
      "superseded_by",
      "type"
    ];
    baseShape = z3.object({
      source: z3.enum(["agent", "user", "imported"]),
      confidence: z3.enum(["direct", "inferred", "uncertain"]),
      evidence: z3.array(z3.string()),
      status: z3.enum(["active", "superseded", "archived"]).default("active"),
      observed_at: z3.string().datetime({ offset: true }),
      superseded_by: z3.string().nullable().default(null),
      type: z3.string().min(1),
      superseded_reason: z3.string().optional()
    }).passthrough().superRefine((data, ctx) => {
      if (data.status === "superseded") {
        if (data.superseded_by === null || data.superseded_by === void 0) {
          ctx.addIssue({
            code: "custom",
            path: ["superseded_by"],
            message: "Required (non-null DocId) when status is 'superseded'"
          });
        }
        if (typeof data.superseded_reason !== "string" || data.superseded_reason.length === 0) {
          ctx.addIssue({
            code: "custom",
            path: ["superseded_reason"],
            message: "Required (non-empty string) when status is 'superseded'"
          });
        }
      }
    });
    DEFAULT_MEMORY_V1 = {
      name: "default-memory-v1",
      version: "1.0",
      propertiesSchema: baseShape,
      requiredKeys,
      naming: {
        strategy: "date-slug",
        pattern: "{observed_at:YYYY-MM-DD}-{slug}.md"
      }
    };
  }
});

// src/adapters/delivery/obsidian-fs/path.ts
import path6 from "path";
function pathInSink(vaultAbsolutePath, sink, relativeSubpath = "") {
  return path6.join(vaultAbsolutePath, sink.resolveToRelativePath, relativeSubpath);
}
var init_path = __esm({
  "src/adapters/delivery/obsidian-fs/path.ts"() {
    "use strict";
    init_esm_shims();
  }
});

// src/adapters/delivery/obsidian-fs/contract-yaml-read.ts
import { readFile as readFile3 } from "fs/promises";
var init_contract_yaml_read = __esm({
  "src/adapters/delivery/obsidian-fs/contract-yaml-read.ts"() {
    "use strict";
    init_esm_shims();
    init_path();
  }
});

// src/memory/contract/schema.ts
import { z as z4 } from "zod";
var PropertyRuleSchema, CrossFieldRuleSchema, MemoryContractYamlSchema;
var init_schema2 = __esm({
  "src/memory/contract/schema.ts"() {
    "use strict";
    init_esm_shims();
    PropertyRuleSchema = z4.object({
      type: z4.enum(["string", "datetime", "array", "doc_id", "number", "boolean", "reference", "date"]),
      allowed: z4.array(z4.string()).optional(),
      default: z4.unknown().optional(),
      items: z4.object({ type: z4.string() }).optional(),
      min_length: z4.number().optional(),
      /** When true, the property accepts `null` as a sentinel value (in
       *  addition to whatever `type` says). Used for required-but-null-by-
       *  default properties like `superseded_by` on active observations. */
      nullable: z4.boolean().optional()
    });
    CrossFieldRuleSchema = z4.object({
      when: z4.string(),
      require: z4.string()
    });
    MemoryContractYamlSchema = z4.object({
      name: z4.string().min(1),
      version: z4.string().default("1.0"),
      required_properties: z4.record(z4.string(), PropertyRuleSchema),
      optional_properties: z4.record(z4.string(), PropertyRuleSchema).default({}),
      cross_field_rules: z4.array(CrossFieldRuleSchema).default([]),
      naming: z4.object({
        strategy: z4.enum(["caller-provided", "date-slug", "adapter-assigned"]),
        pattern: z4.string().optional()
      })
    });
  }
});

// src/memory/contract/loader.ts
import { parse as parseYaml } from "yaml";
import { z as z5 } from "zod";
function __cacheContract(name, contract) {
  contractCache.set(name, contract);
}
function __getCachedContract(name) {
  return contractCache.get(name);
}
var contractCache;
var init_loader2 = __esm({
  "src/memory/contract/loader.ts"() {
    "use strict";
    init_esm_shims();
    init_contract_yaml_read();
    init_schema2();
    contractCache = /* @__PURE__ */ new Map();
  }
});

// src/memory/contract/index.ts
function getContract(name) {
  const cached = __getCachedContract(name);
  if (cached) return cached;
  throw new Error(
    `Unknown memory contract: "${name}". Known contracts: default-memory-v1${otherCachedNames(name)}. Call loadContractFromDisk(name, vaultPath) first to register a contract.`
  );
}
function otherCachedNames(excluding) {
  const names = [];
  for (const candidate of ["default-memory-v1"]) {
    if (candidate === excluding) continue;
    if (__getCachedContract(candidate)) names.push(candidate);
  }
  return names.length > 0 ? `, ${names.join(", ")}` : "";
}
var init_contract = __esm({
  "src/memory/contract/index.ts"() {
    "use strict";
    init_esm_shims();
    init_default_v1();
    init_loader2();
    __cacheContract("default-memory-v1", DEFAULT_MEMORY_V1);
  }
});

// src/memory/sink.ts
var MEMORY_SINK_HANDLE_PATTERN, parseMemorySinkHandle, SENTINEL_FILENAME;
var init_sink = __esm({
  "src/memory/sink.ts"() {
    "use strict";
    init_esm_shims();
    MEMORY_SINK_HANDLE_PATTERN = /^obsidian-fs:\/\/[a-z0-9][a-z0-9-]*\/[^\s]+\/$/;
    ({ parseMemorySinkHandle } = /* @__PURE__ */ (() => {
      const mint = (s) => s;
      const parse = (s) => {
        if (!MEMORY_SINK_HANDLE_PATTERN.test(s)) {
          throw new Error(
            `Invalid MemorySinkHandle: ${JSON.stringify(s)}. Expected obsidian-fs://<vault>/<path>/ (trailing slash required).`
          );
        }
        return mint(s);
      };
      return { parseMemorySinkHandle: parse };
    })());
    SENTINEL_FILENAME = ".memory-sink";
  }
});

// src/adapters/delivery/obsidian-fs/sentinel.ts
import { promises as fs7 } from "fs";
function isExpectedSinkContent(entry) {
  if (entry === SENTINEL_FILENAME2) return true;
  if (entry === "observations" || entry === "_briefs" || entry === "status-updates") {
    return true;
  }
  if (entry.endsWith(".md")) return true;
  return false;
}
function formatSentinelContent(args2) {
  const ts = (/* @__PURE__ */ new Date()).toISOString();
  return [
    `created_at: ${ts}`,
    `sink_name: ${args2.sinkName}`,
    `vault_memory_version: ${args2.version}`,
    ""
  ].join("\n");
}
async function provisionSink(sink, vaultAbsolutePath, opts) {
  const folder = pathInSink(vaultAbsolutePath, sink);
  const sentinelPath = pathInSink(vaultAbsolutePath, sink, SENTINEL_FILENAME2);
  try {
    await fs7.access(sentinelPath);
    return;
  } catch {
  }
  let folderExists = true;
  let entries = [];
  try {
    entries = await fs7.readdir(folder);
  } catch (err) {
    const code = err.code;
    if (code === "ENOENT") {
      folderExists = false;
    } else {
      throw err;
    }
  }
  if (!folderExists) {
    await fs7.mkdir(folder, { recursive: true });
    await fs7.writeFile(
      sentinelPath,
      formatSentinelContent({ sinkName: sink.name, version: opts.version }),
      "utf-8"
    );
    return;
  }
  const foreign = entries.filter((e) => !isExpectedSinkContent(e));
  if (foreign.length > 0) {
    throw new SinkProvisioningError(sink.name, folder, foreign);
  }
  await fs7.writeFile(
    sentinelPath,
    formatSentinelContent({ sinkName: sink.name, version: opts.version }),
    "utf-8"
  );
}
async function assertSentinelExists(sink, vaultAbsolutePath) {
  const sentinelPath = pathInSink(vaultAbsolutePath, sink, SENTINEL_FILENAME2);
  try {
    await fs7.access(sentinelPath);
    return true;
  } catch {
    return false;
  }
}
async function sentinelExistsAt(vaultRoot, relPath) {
  const probe = `${vaultRoot.endsWith("/") ? vaultRoot.slice(0, -1) : vaultRoot}/${relPath.replace(/^\//, "")}/${SENTINEL_FILENAME2}`;
  try {
    await fs7.access(probe);
    return true;
  } catch {
    return false;
  }
}
var SENTINEL_FILENAME2, SinkProvisioningError;
var init_sentinel = __esm({
  "src/adapters/delivery/obsidian-fs/sentinel.ts"() {
    "use strict";
    init_esm_shims();
    init_sink();
    init_path();
    SENTINEL_FILENAME2 = SENTINEL_FILENAME;
    SinkProvisioningError = class extends Error {
      constructor(sinkName, absoluteFolderPath, offendingEntries) {
        super(
          `Memory sink "${sinkName}" target folder ${absoluteFolderPath} contains unrelated user content (${offendingEntries.join(", ")}). Refusing to label as a sink. Move user content out, or change the [[memory_sinks]] handle.`
        );
        this.sinkName = sinkName;
        this.absoluteFolderPath = absoluteFolderPath;
        this.offendingEntries = offendingEntries;
      }
      sinkName;
      absoluteFolderPath;
      offendingEntries;
      name = "SinkProvisioningError";
      code = "SINK_PROVISION_UNSAFE";
    };
  }
});

// src/adapters/delivery/obsidian-fs/index.ts
var obsidian_fs_exports2 = {};
__export(obsidian_fs_exports2, {
  ObsidianFsDelivery: () => ObsidianFsDelivery,
  OutsideVaultError: () => OutsideVaultError,
  atomicWriteFile: () => atomicWriteFile,
  deleteNote: () => deleteNote,
  safeJoinInsideVault: () => safeJoinInsideVault,
  writeNote: () => writeNote
});
import { promises as fs8 } from "fs";
import matter3 from "gray-matter";
function v1ToV2WriteResult(id, v1) {
  if (!v1.ok) {
    return v1.currentHash !== void 0 ? { ok: false, reason: v1.reason, currentHash: v1.currentHash, message: v1.message } : { ok: false, reason: v1.reason, message: v1.message };
  }
  return { ok: true, doc_id: id, newHash: v1.newHash, created: v1.created };
}
function v1ToV2UpdateResult(id, v1) {
  if (!v1.ok) {
    return v1.currentHash !== void 0 ? { ok: false, reason: v1.reason, currentHash: v1.currentHash, message: v1.message } : { ok: false, reason: v1.reason, message: v1.message };
  }
  return { ok: true, doc_id: id, newHash: v1.newHash };
}
function stripWikilinks(props) {
  const { wikilinks: _w, ...rest } = props;
  return rest;
}
function extractBodyAndFrontmatter(doc) {
  const body = (doc.blocks ?? []).map((b) => b.kind === "paragraph" ? b.text : "").filter((s) => s.length > 0).join("\n\n");
  const props = doc.properties;
  if (props === void 0 || props === null) {
    return { body, frontmatter: null };
  }
  const stripped = stripWikilinks(props);
  return {
    body,
    frontmatter: Object.keys(stripped).length > 0 ? stripped : null
  };
}
var SCHEME2, ObsidianFsDelivery;
var init_obsidian_fs2 = __esm({
  "src/adapters/delivery/obsidian-fs/index.ts"() {
    "use strict";
    init_esm_shims();
    init_registry();
    init_write();
    init_fs();
    init_hash();
    init_validator();
    init_contract();
    init_sentinel();
    init_write();
    init_fs();
    SCHEME2 = "obsidian-fs";
    ObsidianFsDelivery = class {
      /**
       * @param vault The Vault unit-of-access (config + db handle).
       * @param clientId Default audit-log attribution. Per D-02, captured from
       *  MCP InitializeRequest.params.clientInfo (via the SDK's
       *  `Server.getClientVersion()?.name`) at server bootstrap. May be a static
       *  string OR a lazy getter — the getter form lets the server construct
       *  deliveries BEFORE the initialize handshake completes and have the
       *  handshake value flow through automatically on the first write.
       *  Falls back to "unknown" at the call site if no value is supplied at
       *  any level (per RESEARCH Pitfall 4: clientInfo is OPTIONAL in the MCP
       *  spec, so older or non-conformant clients may not send it).
       * @param memorySinkRegistry Optional Phase 2 sink registry. When supplied,
       *  the adapter runs Guards A/B + sentinel check at the entry of
       *  `write` / `update` / `delete` per ADR-002 §DeliveryAdapter. When
       *  omitted (Phase 1 fixture tests + back-compat), the validator is
       *  silently skipped — production paths in Plan 02-03b's server
       *  bootstrap always pass the registry, so production is always
       *  guarded.
       */
      constructor(vault, clientIdSource, memorySinkRegistry) {
        this.vault = vault;
        this.clientIdSource = clientIdSource;
        this.memorySinkRegistry = memorySinkRegistry;
        this.handle = parseSourceHandle(`${SCHEME2}://${vault.config.name}`);
      }
      vault;
      clientIdSource;
      memorySinkRegistry;
      handle;
      capabilities = {
        atomic: true,
        hashProtected: "strong",
        enforcedSchema: false,
        naming: "caller-provided"
      };
      get clientId() {
        return typeof this.clientIdSource === "function" ? this.clientIdSource() : this.clientIdSource;
      }
      /**
       * Resolve the sink that "owns" a write target.
       *
       * Resolution order (per ADR-004 §Resolution + Plan 02-03 <action>):
       *   1. If `opts.sink` is supplied AND the registry knows it, use it.
       *      The caller explicitly routed the write under that sink.
       *   2. Else, ask the registry `findSinkContaining(id)` — for DocIds
       *      whose vault-relative path lies inside a registered sink, this
       *      returns the enclosing sink. Used for guarding writes that
       *      target memory paths WITHOUT an explicit `opts.sink` (e.g. v1
       *      `writeNote` against `_memory/...`).
       *   3. Else, the target is outside every sink — return `null`.
       *
       * Returns `null` when no registry is configured (Phase 1 fixture
       * tests + back-compat). The validator then silently passes.
       */
      resolveTargetSink(id, opts) {
        const registry = this.memorySinkRegistry;
        if (!registry) return null;
        if (opts?.sink !== void 0) {
          try {
            return registry.resolveMemorySink(opts.sink);
          } catch {
          }
        }
        return registry.findSinkContaining(id);
      }
      /**
       * Run Guards A/B + sentinel for a write or update. Returns the
       * conflict to short-circuit on, or `null` to proceed.
       *
       * Order: Guard B (cheap) → sentinel (fail-closed) → Guard A.
       * The sentinel check is filesystem-specific and intentionally lives
       * here, not in the validator.
       */
      async preflight(id, doc, opts) {
        if (!this.memorySinkRegistry) return null;
        const sink = this.resolveTargetSink(id, opts);
        const contract = sink ? getContract(sink.contractName) : null;
        const sourceCheck = validateAgentWrite(id, doc, sink, null);
        if (sourceCheck) return sourceCheck;
        if (sink !== null) {
          const ok2 = await assertSentinelExists(sink, this.vault.config.path);
          if (!ok2) {
            return {
              ok: false,
              reason: "sentinel_missing",
              sinkName: sink.name,
              message: `MemorySink "${sink.name}" refuses to resolve: '.memory-sink' sentinel file is missing under ${this.vault.config.name}/${sink.resolveToRelativePath}.`,
              suggestion: "Restart the server (it re-provisions automatically) or restore .memory-sink manually."
            };
          }
        }
        if (sink !== null && contract !== null) {
          const guardA = validateAgentWrite(id, doc, sink, contract);
          if (guardA) return guardA;
        }
        return null;
      }
      async write(id, doc, opts) {
        const guard = await this.preflight(id, doc, opts);
        if (guard) return guard;
        const path7 = this.docIdToPath(id);
        const { body, frontmatter } = extractBodyAndFrontmatter(doc);
        const effectiveClientId = opts?.clientId ?? this.clientId;
        const v1 = await writeNote({
          vault: this.vault,
          relativePath: path7,
          content: body,
          frontmatter,
          ...opts?.expectedHash !== void 0 ? { expectedHash: opts.expectedHash } : {},
          clientId: effectiveClientId,
          isMemorySinkWrite: opts?.sink !== void 0
        });
        return v1ToV2WriteResult(id, v1);
      }
      /**
       * Replace-or-merge update. Reads current document via the filesystem,
       * applies `patch.properties` (shallow-merged into existing frontmatter)
       * and/or `patch.blocks` (replaces body), then writes via writeNote with
       * the OCC token.
       *
       * Returns `{ ok: false, reason: "not_found" }` when the file is absent
       * (matches DeliveryAdapter contract — no implicit create on update).
       *
       * The v1 MCP `update_frontmatter` handler continues to route through
       * `src/frontmatter/update.ts` (merge-DSL semantics + diff emission). This
       * `update()` path exists primarily for conformance and for non-merge-DSL
       * callers (Phase 2+).
       */
      async update(id, patch, opts) {
        const guard = await this.preflight(id, patch, opts);
        if (guard) return guard;
        const path7 = this.docIdToPath(id);
        const abs = await safeJoinInsideVault(this.vault.config.path, path7);
        let raw;
        try {
          raw = await fs8.readFile(abs, "utf-8");
        } catch (err) {
          if (typeof err === "object" && err !== null && err.code === "ENOENT") {
            return {
              ok: false,
              reason: "not_found",
              message: `Document not found: ${id}`
            };
          }
          throw err;
        }
        const parsed = matter3(raw);
        const existingFm = parsed.data ?? {};
        const existingBody = parsed.content;
        const patchProps = patch.properties;
        const nextFm = patchProps !== void 0 ? { ...existingFm, ...stripWikilinks(patchProps) } : existingFm;
        const nextBody = patch.blocks !== void 0 ? patch.blocks.map((b) => b.kind === "paragraph" ? b.text : "").filter((s) => s.length > 0).join("\n\n") : existingBody;
        const existingHash = computeNoteHash(
          existingBody,
          Object.keys(existingFm).length > 0 ? existingFm : null
        );
        const effectiveExpectedHash = opts?.expectedHash ?? existingHash;
        const effectiveClientId = opts?.clientId ?? this.clientId;
        const v1 = await writeNote({
          vault: this.vault,
          relativePath: path7,
          content: nextBody,
          frontmatter: Object.keys(nextFm).length > 0 ? nextFm : null,
          expectedHash: effectiveExpectedHash,
          clientId: effectiveClientId,
          isMemorySinkWrite: opts?.sink !== void 0
        });
        return v1ToV2UpdateResult(id, v1);
      }
      async delete(id, opts) {
        if (this.memorySinkRegistry) {
          const enclosing = this.memorySinkRegistry.findSinkContaining(id);
          if (enclosing !== null) {
            return {
              ok: false,
              reason: "sink_write_blocked",
              sinkName: enclosing.name,
              message: `Hard deletion of MemorySink "${enclosing.name}" documents is not permitted in v2.0.0.`,
              suggestion: "Use supersede to retire memory documents. Hard deletion is not yet supported in v2.0.0."
            };
          }
        }
        const path7 = this.docIdToPath(id);
        if (opts?.expectedHash === void 0) {
          try {
            const abs = await safeJoinInsideVault(this.vault.config.path, path7);
            await fs8.stat(abs);
          } catch {
            return {
              ok: false,
              reason: "not_found",
              message: `Document not found: ${id}`
            };
          }
          return {
            ok: false,
            reason: "hash_mismatch",
            message: `delete() requires opts.expectedHash for hashProtected="strong" adapters`
          };
        }
        const effectiveClientId = opts?.clientId ?? this.clientId;
        const v1 = await deleteNote({
          vault: this.vault,
          relativePath: path7,
          expectedHash: opts.expectedHash,
          clientId: effectiveClientId,
          isMemorySinkWrite: opts?.sink !== void 0
        });
        if (!v1.ok) {
          if (v1.reason === "hash_mismatch" && v1.currentHash === void 0) {
            return {
              ok: false,
              reason: "not_found",
              message: v1.message
            };
          }
          return v1.currentHash !== void 0 ? { ok: false, reason: v1.reason, currentHash: v1.currentHash, message: v1.message } : { ok: false, reason: v1.reason, message: v1.message };
        }
        return { ok: true, doc_id: id };
      }
      // ── helpers ───────────────────────────────────────────────────────────────
      /**
       * Parse the URI authority + resource off a DocId. Asserts the authority
       * matches the configured vault name — mirrors ObsidianFsSource.docIdToPath
       * to prevent cross-vault forgery.
       */
      docIdToPath(id) {
        const prefix = `${SCHEME2}://`;
        if (!id.startsWith(prefix)) {
          throw new Error(`DocId scheme mismatch: expected "${SCHEME2}://\u2026", got ${JSON.stringify(id)}`);
        }
        const rest = id.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash < 0) {
          throw new Error(`Invalid DocId shape: missing resource path in ${JSON.stringify(id)}`);
        }
        const authority = rest.slice(0, slash);
        const resource = rest.slice(slash + 1);
        if (authority !== this.vault.config.name) {
          throw new Error(
            `DocId vault mismatch: id authority "${authority}" does not match this adapter's configured vault "${this.vault.config.name}"`
          );
        }
        if (resource.length === 0) {
          throw new Error(`Invalid DocId: empty resource path in ${JSON.stringify(id)}`);
        }
        return resource;
      }
    };
  }
});

// src/frontmatter/update.ts
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
function stripWikilinks2(props) {
  const { wikilinks: _w, ...rest } = props;
  return rest;
}
function blocksToBody(doc) {
  return doc.blocks.map((b) => b.kind === "paragraph" ? b.text : "").filter((s) => s.length > 0).join("\n\n");
}
async function updateFrontmatter(input) {
  const {
    vault,
    relativePath,
    merge,
    expectedHash,
    clientId,
    registry,
    memorySinkRegistry,
    onBeforeFsWrite
  } = input;
  if (memorySinkRegistry) {
    const docId2 = formatDocId("obsidian-fs", vault.config.name, relativePath);
    const sink = memorySinkRegistry.findSinkContaining(docId2);
    if (sink !== null) {
      return {
        ok: false,
        reason: "sink_write_blocked",
        sinkName: sink.name,
        message: `Target ${relativePath} resolves into MemorySink "${sink.name}". v1 update_frontmatter is refused for memory-sink targets.`,
        suggestion: "Use record_observation + supersede for memory updates."
      };
    }
  }
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
  const { source, delivery } = await resolveAdapters(vault, registry);
  const handle = parseSourceHandle(`obsidian-fs://${vault.config.name}`);
  void handle;
  const docId = formatDocId("obsidian-fs", vault.config.name, relativePath);
  let doc;
  try {
    doc = await source.readDocument(docId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: "note_not_found",
      message: `Failed to read document: ${msg}`
    };
  }
  const body = blocksToBody(doc);
  const existingFm = stripWikilinks2(doc.properties);
  const currentHash = doc.hash;
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
  const { next, diff } = applyMerge(existingFm, merge);
  if (diff.length === 0) {
    return {
      ok: true,
      newHash: currentHash,
      noteId: noteRow.id,
      diff: []
    };
  }
  onBeforeFsWrite?.();
  const partial = {
    blocks: [{ kind: "paragraph", text: body }],
    properties: Object.keys(next).length > 0 ? next : {}
  };
  const writeOpts = {
    expectedHash: currentHash
  };
  if (clientId !== void 0) writeOpts.clientId = clientId;
  const writeRes = await delivery.write(docId, partial, writeOpts);
  if (!writeRes.ok) {
    if (writeRes.reason === "permission_denied") {
      return {
        ok: false,
        reason: "permission_denied",
        message: writeRes.message ?? "Write rejected by delivery adapter."
      };
    }
    return {
      ok: false,
      reason: "hash_mismatch",
      ...writeRes.currentHash !== void 0 ? { currentHash: writeRes.currentHash } : {},
      message: writeRes.message ?? "Write conflict."
    };
  }
  return {
    ok: true,
    newHash: writeRes.newHash,
    noteId: noteRow.id,
    diff
  };
}
async function resolveAdapters(vault, registry) {
  const handle = parseSourceHandle(`obsidian-fs://${vault.config.name}`);
  if (registry !== void 0) {
    return {
      source: registry.resolveSource(handle),
      delivery: registry.resolveDelivery(handle)
    };
  }
  const { ObsidianFsSource: ObsidianFsSource2 } = await Promise.resolve().then(() => (init_obsidian_fs(), obsidian_fs_exports));
  const { ObsidianFsDelivery: ObsidianFsDelivery2 } = await Promise.resolve().then(() => (init_obsidian_fs2(), obsidian_fs_exports2));
  return {
    source: new ObsidianFsSource2(vault.config),
    delivery: new ObsidianFsDelivery2(vault, "unknown")
  };
}
var init_update = __esm({
  "src/frontmatter/update.ts"() {
    "use strict";
    init_esm_shims();
    init_registry();
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

// src/schema/folder-conventions.ts
function folderOf(notePath) {
  const idx = notePath.lastIndexOf("/");
  return idx === -1 ? "" : notePath.slice(0, idx + 1);
}
function parentFolder(folder) {
  if (folder === "") return null;
  const trimmed = folder.endsWith("/") ? folder.slice(0, -1) : folder;
  const idx = trimmed.lastIndexOf("/");
  if (idx === -1) return "";
  return trimmed.slice(0, idx + 1);
}
function countSiblings(vault, folder, excludePath) {
  const handle = vault.db.handle;
  if (folder === "") {
    const row2 = handle.prepare("SELECT COUNT(*) AS c FROM notes WHERE instr(path, '/') = 0 AND path != COALESCE(?, '')").get(excludePath);
    return row2?.c ?? 0;
  }
  const row = handle.prepare("SELECT COUNT(*) AS c FROM notes WHERE path LIKE ? || '%' AND path != COALESCE(?, '')").get(folder, excludePath);
  return row?.c ?? 0;
}
function fetchSiblings(vault, folder, excludePath) {
  const handle = vault.db.handle;
  if (folder === "") {
    return handle.prepare("SELECT path, frontmatter FROM notes WHERE instr(path, '/') = 0 AND path != COALESCE(?, '')").all(excludePath);
  }
  return handle.prepare("SELECT path, frontmatter FROM notes WHERE path LIKE ? || '%' AND path != COALESCE(?, '')").all(folder, excludePath);
}
function resolveInferenceFolder(vault, notePath, excludePath = notePath) {
  const start = folderOf(notePath);
  let current = start;
  let levels = 0;
  while (current !== null && levels < MAX_FALLBACK_LEVELS) {
    const count = countSiblings(vault, current, excludePath);
    if (count >= MIN_SIBLINGS || current === "") {
      return {
        folder: current,
        fellBackFrom: current === start ? null : start,
        siblingCount: count
      };
    }
    current = parentFolder(current);
    levels++;
  }
  return { folder: "", fellBackFrom: start, siblingCount: 0 };
}
function aggregateEntries(siblings) {
  const total = siblings.length;
  if (total === 0) return [];
  const keyPresence = /* @__PURE__ */ new Map();
  const keyValues = /* @__PURE__ */ new Map();
  for (const row of siblings) {
    if (!row.frontmatter) continue;
    let fm;
    try {
      fm = JSON.parse(row.frontmatter);
    } catch {
      continue;
    }
    if (!fm || typeof fm !== "object" || Array.isArray(fm)) continue;
    const obj = fm;
    for (const [key, value] of Object.entries(obj)) {
      keyPresence.set(key, (keyPresence.get(key) ?? 0) + 1);
      const valKey = stableStringify(value);
      if (!keyValues.has(key)) keyValues.set(key, /* @__PURE__ */ new Map());
      const bucket = keyValues.get(key);
      bucket.set(valKey, (bucket.get(valKey) ?? 0) + 1);
    }
  }
  const entries = [];
  for (const [key, presenceCount] of keyPresence) {
    const valueBucket = keyValues.get(key);
    const [domValStr, domCount] = pickDominant(valueBucket);
    const dominantValue = domCount / presenceCount > 0.5 ? safeParse(domValStr) : null;
    entries.push({
      key,
      presenceCount,
      siblingCount: total,
      prevalence: presenceCount / total,
      dominantValue,
      dominantValueRatio: domCount / presenceCount
    });
  }
  entries.sort((a, b) => {
    if (b.prevalence !== a.prevalence) return b.prevalence - a.prevalence;
    return a.key.localeCompare(b.key);
  });
  return entries;
}
function pickDominant(bucket) {
  let bestKey = "";
  let bestCount = 0;
  for (const [k, c] of bucket) {
    if (c > bestCount) {
      bestKey = k;
      bestCount = c;
    }
  }
  return [bestKey, bestCount];
}
function stableStringify(v) {
  if (v === void 0) return "null";
  return JSON.stringify(v, Object.keys(v ?? {}).sort());
}
function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
function inferFromFolder(vault, notePath, options = {}) {
  const excludePath = options.excludePath ?? notePath;
  const { folder, fellBackFrom, siblingCount } = resolveInferenceFolder(
    vault,
    notePath,
    excludePath
  );
  const siblings = fetchSiblings(vault, folder, excludePath);
  return {
    resolvedFolder: folder,
    siblingCount,
    fellBackFrom,
    entries: aggregateEntries(siblings)
  };
}
var MIN_SIBLINGS, MAX_FALLBACK_LEVELS;
var init_folder_conventions = __esm({
  "src/schema/folder-conventions.ts"() {
    "use strict";
    init_esm_shims();
    MIN_SIBLINGS = 3;
    MAX_FALLBACK_LEVELS = 4;
  }
});

// src/schema/neighbor-inference.ts
function gatherNeighbors(vault, notePath, additionalForwardTargets = []) {
  const seenIds = /* @__PURE__ */ new Set();
  const out = [];
  const note = vault.db.notes.getByPath(notePath);
  if (note) {
    const back = vault.db.wikilinks.getBacklinks(note.id);
    for (const row of back) {
      if (seenIds.has(row.sourceNoteId)) continue;
      const src = vault.db.notes.getById(row.sourceNoteId);
      if (!src) continue;
      seenIds.add(src.id);
      out.push({ path: src.path, frontmatter: src.frontmatter });
    }
    const forward = vault.db.wikilinks.getForwardLinks(note.id);
    for (const row of forward) {
      if (row.targetNoteId === null) continue;
      if (seenIds.has(row.targetNoteId)) continue;
      const target = vault.db.notes.getById(row.targetNoteId);
      if (!target) continue;
      seenIds.add(target.id);
      out.push({ path: target.path, frontmatter: target.frontmatter });
    }
  }
  for (const target of additionalForwardTargets) {
    const candidate = vault.db.notes.getByPath(`${target}.md`) ?? vault.db.notes.getByPath(target);
    if (!candidate) continue;
    if (seenIds.has(candidate.id)) continue;
    seenIds.add(candidate.id);
    out.push({ path: candidate.path, frontmatter: candidate.frontmatter });
  }
  return out;
}
function aggregateEntries2(neighbors) {
  const total = neighbors.length;
  if (total === 0) return [];
  const keyPresence = /* @__PURE__ */ new Map();
  const keyValues = /* @__PURE__ */ new Map();
  for (const row of neighbors) {
    if (!row.frontmatter) continue;
    let fm;
    try {
      fm = JSON.parse(row.frontmatter);
    } catch {
      continue;
    }
    if (!fm || typeof fm !== "object" || Array.isArray(fm)) continue;
    const obj = fm;
    for (const [key, value] of Object.entries(obj)) {
      keyPresence.set(key, (keyPresence.get(key) ?? 0) + 1);
      const valKey = JSON.stringify(value, Object.keys(value ?? {}).sort());
      if (!keyValues.has(key)) keyValues.set(key, /* @__PURE__ */ new Map());
      const bucket = keyValues.get(key);
      bucket.set(valKey, (bucket.get(valKey) ?? 0) + 1);
    }
  }
  const entries = [];
  for (const [key, presenceCount] of keyPresence) {
    const valueBucket = keyValues.get(key);
    let bestKey = "";
    let bestCount = 0;
    for (const [k, c] of valueBucket) {
      if (c > bestCount) {
        bestKey = k;
        bestCount = c;
      }
    }
    const dominantValue = bestCount / presenceCount > 0.5 ? safeParse2(bestKey) : null;
    entries.push({
      key,
      neighborCount: presenceCount,
      totalNeighbors: total,
      prevalence: presenceCount / total,
      dominantValue,
      dominantValueRatio: bestCount / presenceCount
    });
  }
  entries.sort((a, b) => {
    if (b.prevalence !== a.prevalence) return b.prevalence - a.prevalence;
    return a.key.localeCompare(b.key);
  });
  return entries;
}
function safeParse2(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
function inferFromNeighbors(vault, notePath, additionalForwardTargets = []) {
  const neighbors = gatherNeighbors(vault, notePath, additionalForwardTargets);
  const note = vault.db.notes.getByPath(notePath);
  let forwardCount = 0;
  let backwardCount = 0;
  if (note) {
    forwardCount = vault.db.wikilinks.getForwardLinks(note.id).filter((r) => r.targetNoteId !== null).length;
    backwardCount = vault.db.wikilinks.getBacklinks(note.id).length;
  }
  return {
    forwardCount,
    backwardCount,
    totalNeighbors: neighbors.length,
    entries: aggregateEntries2(neighbors)
  };
}
var init_neighbor_inference = __esm({
  "src/schema/neighbor-inference.ts"() {
    "use strict";
    init_esm_shims();
  }
});

// src/schema/content-heuristics.ts
function inferFromContent(input) {
  const heuristicInput = {
    title: input.title,
    bodyHead: input.body.slice(0, 2e3),
    fullBody: input.body
  };
  const entries = [];
  const matchedRules = [];
  for (const rule of RULES) {
    const matches = rule.match(heuristicInput);
    if (matches.length > 0) {
      matchedRules.push(rule.name);
      for (const m of matches) {
        entries.push({ ...m, rule: rule.name });
      }
    }
  }
  return { entries, matchedRules };
}
var DEFAULT_CONFIDENCE, STRONG_CONFIDENCE, WEAK_CONFIDENCE, emailRule, meetingRule, personRule, clippingRule, factRule, dateInTitleRule, RULES;
var init_content_heuristics = __esm({
  "src/schema/content-heuristics.ts"() {
    "use strict";
    init_esm_shims();
    DEFAULT_CONFIDENCE = 0.7;
    STRONG_CONFIDENCE = 0.85;
    WEAK_CONFIDENCE = 0.5;
    emailRule = {
      name: "email-title-or-header",
      match: ({ title, bodyHead }) => {
        const titleMatch = /^(E-?Mail|Email|Mail)\s+(von|from)\s+\S+/i.test(title) || /^(Re|Fwd|AW|WG):\s/i.test(title);
        const headerMatch = /^(From|Von):\s+\S+/im.test(bodyHead) && /^(To|An):\s+\S+/im.test(bodyHead);
        if (!titleMatch && !headerMatch) return [];
        return [
          { key: "class", value: "Email", confidence: STRONG_CONFIDENCE },
          { key: "type", value: "email", confidence: STRONG_CONFIDENCE }
        ];
      }
    };
    meetingRule = {
      name: "meeting-title-keyword",
      match: ({ title, bodyHead }) => {
        const keywords = /\b(Meeting|Treffen|Call|Sondierung|Termin|Standup|Sync|Kickoff|Kick-off|Jour\s*fixe|Workshop)\b/i;
        const isMeeting = keywords.test(title) || /^\d{4}-\d{2}-\d{2}.*\b(Meeting|Treffen|Call|Sondierung)/i.test(title);
        if (!isMeeting) return [];
        const attendeesPresent = /^(Attendees|Teilnehmer|Participants):/im.test(bodyHead);
        const conf = attendeesPresent ? STRONG_CONFIDENCE : DEFAULT_CONFIDENCE;
        return [
          { key: "class", value: "Meeting", confidence: conf },
          { key: "type", value: "meeting", confidence: conf }
        ];
      }
    };
    personRule = {
      name: "person-name-title-with-corroboration",
      match: ({ title, bodyHead }) => {
        const nameLike = /^[A-ZÄÖÜ][a-zäöüß'\-]+( [A-ZÄÖÜ][a-zäöüß'\-]+){0,3}$/.test(title.trim());
        if (!nameLike) return [];
        const corroborating = /linkedin\.com\/in\//i.test(bodyHead) || /\b[\w._-]+@[\w.-]+\.[a-z]{2,}\b/i.test(bodyHead) || /\+?\d[\d\s\-./()]{6,}/.test(bodyHead);
        if (!corroborating) return [];
        return [
          { key: "class", value: "Person", confidence: STRONG_CONFIDENCE },
          { key: "type", value: "person", confidence: STRONG_CONFIDENCE },
          { key: "participation", value: [], confidence: WEAK_CONFIDENCE }
        ];
      }
    };
    clippingRule = {
      name: "clipping-source-url",
      match: ({ bodyHead }) => {
        const headSnippet = bodyHead.slice(0, 500);
        const hasMdLink = /^\s*\[.+\]\(https?:\/\/[^\s)]+\)/m.test(headSnippet);
        const hasSourceField = /^source:\s*https?:\/\//im.test(headSnippet);
        if (!hasMdLink && !hasSourceField) return [];
        return [
          { key: "class", value: "Clipping", confidence: DEFAULT_CONFIDENCE },
          { key: "tags", value: ["clippings"], confidence: DEFAULT_CONFIDENCE }
        ];
      }
    };
    factRule = {
      name: "short-fact",
      match: ({ fullBody }) => {
        const trimmed = fullBody.trim();
        if (trimmed.length === 0 || trimmed.length > 150) return [];
        if (/\n\s*\n/.test(trimmed)) return [];
        return [{ key: "class", value: "Fact", confidence: WEAK_CONFIDENCE }];
      }
    };
    dateInTitleRule = {
      name: "date-prefix-in-title",
      match: ({ title }) => {
        const m = title.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return [];
        const iso = `${m[1]}-${m[2]}-${m[3]}`;
        return [{ key: "created", value: iso, confidence: STRONG_CONFIDENCE }];
      }
    };
    RULES = [
      emailRule,
      meetingRule,
      personRule,
      clippingRule,
      factRule,
      dateInTitleRule
    ];
  }
});

// src/schema/combiner.ts
function valueKey(v) {
  if (v === null || v === void 0) return "null";
  if (Array.isArray(v)) {
    return "[" + v.map(valueKey).join(",") + "]";
  }
  if (typeof v === "object") {
    const obj = v;
    const keys = Object.keys(obj).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + valueKey(obj[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}
function suggestFrontmatter(input) {
  const title = input.title ?? defaultTitleFromPath(input.path);
  const folder = inferFromFolder(input.vault, input.path, {
    excludePath: input.excludePath ?? input.path
  });
  const neighbor = inferFromNeighbors(input.vault, input.path, input.draftWikilinkTargets ?? []);
  const content = input.content !== void 0 ? inferFromContent({ title, body: input.content }) : { entries: [], matchedRules: [] };
  return combineSuggestions({
    existingFrontmatter: input.existingFrontmatter ?? null,
    folder,
    neighbor,
    content
  });
}
function defaultTitleFromPath(path7) {
  const base = path7.split("/").pop() ?? path7;
  return base.replace(/\.md$/i, "");
}
function combineSuggestions(args2) {
  const { existingFrontmatter, folder, neighbor, content } = args2;
  const candidates = /* @__PURE__ */ new Map();
  const push = (key, c) => {
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push(c);
  };
  for (const e of folder.entries) {
    if (e.prevalence < MIN_PRESENTATION_CONFIDENCE) continue;
    push(e.key, {
      source: "folder",
      value: e.dominantValue,
      confidence: e.prevalence
    });
  }
  for (const e of neighbor.entries) {
    const conf = e.prevalence * NEIGHBOR_DAMPING;
    if (conf < MIN_PRESENTATION_CONFIDENCE) continue;
    push(e.key, {
      source: "neighbor",
      value: e.dominantValue,
      confidence: conf
    });
  }
  for (const e of content.entries) {
    push(e.key, {
      source: "content",
      value: e.value,
      confidence: e.confidence,
      rule: e.rule
    });
  }
  const existing = [];
  const suggestions = [];
  const conflicts = [];
  const fm = existingFrontmatter ?? {};
  const existingKeys = new Set(Object.keys(fm));
  const allKeys = /* @__PURE__ */ new Set([...candidates.keys(), ...existingKeys]);
  for (const key of allKeys) {
    const cands = candidates.get(key) ?? [];
    const existingValue = existingKeys.has(key) ? fm[key] : void 0;
    const hasExisting = existingValue !== void 0;
    const existingValueKey = hasExisting ? valueKey(existingValue) : null;
    const byValue = /* @__PURE__ */ new Map();
    for (const c of cands) {
      if (c.value === null) {
        const k = "__keyonly__";
        if (!byValue.has(k)) byValue.set(k, []);
        byValue.get(k).push(c);
      } else {
        const k = valueKey(c.value);
        if (!byValue.has(k)) byValue.set(k, []);
        byValue.get(k).push(c);
      }
    }
    const distinctValueCount = Array.from(byValue.keys()).filter((k) => k !== "__keyonly__").length;
    if (hasExisting) {
      const agreeingBucket = byValue.get(existingValueKey);
      if (agreeingBucket) {
        byValue.delete(existingValueKey);
      }
      const disagreeingValues = Array.from(byValue.entries()).filter(([k]) => k !== "__keyonly__");
      if (disagreeingValues.length === 0) {
        existing.push({ key, value: existingValue });
      } else {
        const candidatesList = [
          {
            value: existingValue,
            source: "existing",
            confidence: 1
          }
        ];
        for (const [, group] of disagreeingValues) {
          const best = pickBestCandidate(group);
          candidatesList.push({
            value: best.value,
            source: best.source,
            confidence: best.confidence,
            ...best.rule ? { rule: best.rule } : {}
          });
        }
        conflicts.push({ key, candidates: candidatesList });
      }
    } else {
      if (distinctValueCount > 1) {
        const candidatesList = [];
        for (const [k, group] of byValue) {
          if (k === "__keyonly__") continue;
          const best = pickBestCandidate(group);
          candidatesList.push({
            value: best.value,
            source: best.source,
            confidence: best.confidence,
            ...best.rule ? { rule: best.rule } : {}
          });
        }
        candidatesList.sort((a, b) => b.confidence - a.confidence);
        conflicts.push({ key, candidates: candidatesList });
      } else if (distinctValueCount === 1) {
        const [valueKeyStr, group] = Array.from(byValue.entries()).find(
          ([k]) => k !== "__keyonly__"
        );
        const best = pickBestCandidate(group);
        const sources = uniqueSources(group);
        suggestions.push({
          key,
          suggestedValue: best.value,
          confidence: best.confidence,
          sources,
          ...best.rule ? { rule: best.rule } : {}
        });
        void valueKeyStr;
      } else {
        const group = byValue.get("__keyonly__");
        const best = pickBestCandidate(group);
        suggestions.push({
          key,
          suggestedValue: null,
          confidence: best.confidence,
          sources: uniqueSources(group)
        });
      }
    }
  }
  suggestions.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.key.localeCompare(b.key);
  });
  conflicts.sort((a, b) => a.key.localeCompare(b.key));
  existing.sort((a, b) => a.key.localeCompare(b.key));
  return {
    existing,
    suggestions,
    conflicts,
    diagnostics: { folder, neighbor, content }
  };
}
function pickBestCandidate(group) {
  if (group.length === 0) {
    throw new Error("pickBestCandidate called with empty group");
  }
  let best = group[0];
  for (const c of group) {
    if (c.confidence > best.confidence) best = c;
  }
  return best;
}
function uniqueSources(group) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  const sorted = [...group].sort((a, b) => b.confidence - a.confidence);
  for (const c of sorted) {
    if (seen.has(c.source)) continue;
    seen.add(c.source);
    out.push(c.source);
  }
  return out;
}
var NEIGHBOR_DAMPING, MIN_PRESENTATION_CONFIDENCE;
var init_combiner = __esm({
  "src/schema/combiner.ts"() {
    "use strict";
    init_esm_shims();
    init_folder_conventions();
    init_neighbor_inference();
    init_content_heuristics();
    NEIGHBOR_DAMPING = 0.6;
    MIN_PRESENTATION_CONFIDENCE = 0.2;
  }
});

// src/schema/index.ts
var init_schema3 = __esm({
  "src/schema/index.ts"() {
    "use strict";
    init_esm_shims();
    init_folder_conventions();
    init_neighbor_inference();
    init_content_heuristics();
    init_combiner();
  }
});

// src/memory/registry.ts
function decomposeMemorySinkHandle(handle) {
  const schemeEnd = handle.indexOf("://");
  const scheme = handle.slice(0, schemeEnd);
  const rest = handle.slice(schemeEnd + 3);
  const authoritySlash = rest.indexOf("/");
  const authority = rest.slice(0, authoritySlash);
  const resource = rest.slice(authoritySlash + 1);
  return { scheme, authority, resource };
}
var MemorySinkRegistry;
var init_registry2 = __esm({
  "src/memory/registry.ts"() {
    "use strict";
    init_esm_shims();
    init_registry();
    init_contract();
    init_sink();
    MemorySinkRegistry = class {
      sinks = /* @__PURE__ */ new Map();
      /** Insertion order — used for the "first registered" default fallback. */
      order = [];
      defaultHandle = null;
      /**
       * Register a batch of configured sinks. Validates each handle, looks
       * up the named contract, invokes the provisioner, and stores the
       * resolved `MemorySink` record.
       *
       * Throws on the first failure — server bootstrap should treat any
       * registration error as fatal per ADR-004 §Provisioning fail-fast.
       */
      async registerMemorySinks(configs, opts) {
        const getC = opts.contractGetter ?? getContract;
        for (const cfg of configs) {
          const handle = parseMemorySinkHandle(cfg.handle);
          const parts = decomposeMemorySinkHandle(handle);
          if (parts.scheme !== "obsidian-fs") {
            throw new Error(
              `MemorySink "${cfg.name}" has unsupported scheme "${parts.scheme}". Phase 2 supports only obsidian-fs sinks.`
            );
          }
          const vaultName = parts.authority;
          const resolveToRelativePath = parts.resource;
          const contract = getC(cfg.contract);
          const isFirst = this.sinks.size === 0;
          const isExplicitDefault = opts.defaultSinkName === cfg.name;
          const isDefault = isExplicitDefault || opts.defaultSinkName === void 0 && isFirst;
          const sink = {
            name: cfg.name,
            handle,
            vault: vaultName,
            resolveToRelativePath,
            contractName: contract.name,
            isDefault
          };
          await opts.provisioner(sink, opts.resolveVaultAbsolutePath(vaultName));
          this.sinks.set(handle, sink);
          this.order.push(handle);
          if (isDefault) this.defaultHandle = handle;
        }
      }
      /** Return all registered sinks in insertion order. */
      listMemorySinks() {
        const out = [];
        for (const handle of this.order) {
          const s = this.sinks.get(handle);
          if (s) out.push(s);
        }
        return out;
      }
      /**
       * Resolve a sink by EITHER its short `name` OR its full handle
       * string. Throws with a helpful diagnostic on miss — mirrors the
       * `AdapterRegistry.resolveSource` message style.
       */
      resolveMemorySink(nameOrHandle) {
        for (const handle of this.order) {
          const s = this.sinks.get(handle);
          if (s && s.name === nameOrHandle) return s;
        }
        for (const handle of this.order) {
          if (handle === nameOrHandle) {
            const s = this.sinks.get(handle);
            if (s) return s;
          }
        }
        const known = this.order.map((h) => this.sinks.get(h)?.name).filter(Boolean).join(", ") || "(none)";
        throw new Error(
          `Unknown memory sink: "${nameOrHandle}". Registered sinks: ${known}`
        );
      }
      /** Return the default sink. Throws if no sinks are registered. */
      getDefaultMemorySink() {
        if (this.defaultHandle === null) {
          throw new Error(
            "No memory sinks are registered; cannot resolve the default sink. Configure [[memory_sinks]] in config.toml."
          );
        }
        const sink = this.sinks.get(this.defaultHandle);
        if (!sink) {
          throw new Error(
            `Internal error: default memory sink handle "${this.defaultHandle}" not found in registry.`
          );
        }
        return sink;
      }
      /**
       * Find the sink that encloses a given `DocId`, or `null` if the
       * DocId is outside every configured sink. Used by v1 write tools
       * (MEM-07) for entry-point Guard A refusals.
       *
       * Match policy: the DocId's authority must equal the sink's vault,
       * and the DocId's resource must start with the sink's
       * `resolveToRelativePath` (which includes its trailing slash, so
       * `_memory/observations/foo.md` matches sink `_memory/` but
       * `_memory-staging/...` does not).
       */
      findSinkContaining(docId) {
        const { scheme, authority, resource } = decomposeDocId(docId);
        if (scheme !== "obsidian-fs") return null;
        for (const handle of this.order) {
          const sink = this.sinks.get(handle);
          if (!sink) continue;
          if (sink.vault !== authority) continue;
          if (resource.startsWith(sink.resolveToRelativePath)) {
            return sink;
          }
        }
        return null;
      }
    };
  }
});

// src/memory/citation-packet.ts
function toCitationPacket(doc, displayUrl2) {
  return {
    doc_id: doc.id,
    source_handle: doc.source,
    title: doc.title,
    heading_path: doc.heading_path ? [...doc.heading_path] : [],
    mtime: doc.mtime,
    hash: doc.hash,
    display_url: displayUrl2,
    properties: { ...doc.properties }
  };
}
function displayUrlFor(docId, source) {
  return source.formatDisplayUrl?.(docId) ?? docId;
}
var init_citation_packet = __esm({
  "src/memory/citation-packet.ts"() {
    "use strict";
    init_esm_shims();
  }
});

// src/memory/resources/list-sinks.ts
function readListSinks(registry) {
  const sinks = registry.listMemorySinks();
  return {
    total: sinks.length,
    sinks: sinks.map((s) => ({
      name: s.name,
      handle: s.handle,
      vault: s.vault,
      contract: s.contractName,
      default: s.isDefault,
      resolves_to: s.resolveToRelativePath
    }))
  };
}
var init_list_sinks = __esm({
  "src/memory/resources/list-sinks.ts"() {
    "use strict";
    init_esm_shims();
  }
});

// src/memory/resources/memory-stats.ts
function readMemoryStats(registry, manager) {
  const sinks = registry.listMemorySinks();
  let totalDocs = 0;
  const entries = [];
  for (const sink of sinks) {
    let vault;
    try {
      vault = manager.require(sink.vault);
    } catch {
      entries.push({
        name: sink.name,
        vault: sink.vault,
        handle: sink.handle,
        doc_count: 0,
        by_type: {},
        by_status: {},
        last_write_at: null
      });
      continue;
    }
    const prefix = sink.resolveToRelativePath;
    const doc_count = vault.db.notes.countByPathPrefix(prefix);
    totalDocs += doc_count;
    const by_type = {};
    const by_status = {};
    for (const row of vault.db.notes.listByPathPrefix(prefix)) {
      const fm = parseFrontmatter(row.frontmatter);
      const type = stringField(fm, "type");
      const status = stringField(fm, "status");
      if (type !== null) by_type[type] = (by_type[type] ?? 0) + 1;
      if (status !== null) by_status[status] = (by_status[status] ?? 0) + 1;
    }
    const last_write_at = vault.db.audit.lastMemoryWriteAtForPathPrefix(prefix);
    entries.push({
      name: sink.name,
      vault: sink.vault,
      handle: sink.handle,
      doc_count,
      by_type,
      by_status,
      last_write_at
    });
  }
  return {
    total_docs: totalDocs,
    sinks: entries
  };
}
function parseFrontmatter(raw) {
  if (raw === null || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}
function stringField(fm, key) {
  const v = fm[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}
var init_memory_stats = __esm({
  "src/memory/resources/memory-stats.ts"() {
    "use strict";
    init_esm_shims();
  }
});

// src/memory/resources/index.ts
var RESOURCE_URI_LIST_SINKS, RESOURCE_URI_MEMORY_STATS;
var init_resources = __esm({
  "src/memory/resources/index.ts"() {
    "use strict";
    init_esm_shims();
    init_list_sinks();
    init_memory_stats();
    RESOURCE_URI_LIST_SINKS = "vault-memory://memory/sinks";
    RESOURCE_URI_MEMORY_STATS = "vault-memory://memory/stats";
  }
});

// src/memory/index.ts
var init_memory = __esm({
  "src/memory/index.ts"() {
    "use strict";
    init_esm_shims();
    init_sink();
    init_registry2();
    init_contract();
    init_citation_packet();
    init_resources();
  }
});

// src/memory/tools/record-observation.ts
import { createHash as createHash2 } from "crypto";
function slugify(claim) {
  const stripped = claim.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (stripped.length <= 60) return stripped || "observation";
  return stripped.slice(0, 60).replace(/-+$/g, "") || "observation";
}
function hashSuffix(claim, observedAt, salt = "") {
  return createHash2("sha256").update(`${claim}\0${observedAt}\0${salt}`).digest("hex").slice(0, 6);
}
function dateSlug(isoTimestamp) {
  return isoTimestamp.slice(0, 10);
}
async function handleRecordObservation(deps, args2) {
  const registry = deps.memorySinkRegistry;
  const sink = args2.sink !== void 0 ? registry.resolveMemorySink(args2.sink) : registry.getDefaultMemorySink();
  if (sink.vault !== args2.vault) {
    throw new Error(
      `Sink "${sink.name}" belongs to vault "${sink.vault}", not "${args2.vault}"`
    );
  }
  const observedAtDefault = (/* @__PURE__ */ new Date()).toISOString();
  const sugarProps = {
    source: "agent",
    observed_at: observedAtDefault,
    status: "active",
    confidence: args2.confidence,
    evidence: args2.evidence,
    type: args2.type,
    superseded_by: null
  };
  const properties = {
    ...sugarProps,
    ...args2.properties ?? {}
  };
  const observedAtForNaming = typeof properties.observed_at === "string" ? properties.observed_at : observedAtDefault;
  const slug = slugify(args2.claim);
  const delivery = deps.deliveryAdapterFor(args2.vault);
  const source = deps.sourceConnectorFor(args2.vault);
  let attempt = 0;
  while (attempt < MAX_COLLISION_RETRIES) {
    const suffix = hashSuffix(args2.claim, observedAtForNaming, String(attempt));
    const filename = `${dateSlug(observedAtForNaming)}-${slug}-${suffix}.md`;
    const relativeResource = sink.resolveToRelativePath + OBSERVATIONS_SUBFOLDER + filename;
    const docId = formatDocId("obsidian-fs", args2.vault, relativeResource);
    const collides = await source.exists(docId);
    if (collides) {
      attempt += 1;
      continue;
    }
    const partialDoc = {
      id: docId,
      title: args2.claim.slice(0, 80),
      properties,
      blocks: [{ kind: "paragraph", text: args2.claim }]
    };
    return await delivery.write(docId, partialDoc, { sink: sink.handle });
  }
  return {
    ok: false,
    reason: "permission_denied",
    message: `Failed to mint unique DocId after ${MAX_COLLISION_RETRIES} attempts`
  };
}
var OBSERVATIONS_SUBFOLDER, MAX_COLLISION_RETRIES;
var init_record_observation = __esm({
  "src/memory/tools/record-observation.ts"() {
    "use strict";
    init_esm_shims();
    init_registry();
    OBSERVATIONS_SUBFOLDER = "observations/";
    MAX_COLLISION_RETRIES = 3;
  }
});

// src/memory/tools/supersede.ts
async function handleSupersede(deps, args2) {
  const oldId = parseDocId(args2.doc_id);
  parseDocId(args2.replacement_doc_id);
  const { authority: vaultName } = decomposeDocId(oldId);
  const sink = deps.memorySinkRegistry.findSinkContaining(oldId);
  if (sink === null) {
    throw new Error(
      `supersede() target ${oldId} is not inside any configured MemorySink; supersede applies to memory documents only.`
    );
  }
  const source = deps.sourceConnectorFor(vaultName);
  const oldDoc = await source.readDocument(oldId);
  const {
    wikilinks: _w,
    ...existingProps
  } = oldDoc.properties;
  const patch = {
    properties: {
      ...existingProps,
      status: "superseded",
      superseded_by: args2.replacement_doc_id,
      superseded_reason: args2.reason
    }
  };
  return await deps.deliveryAdapterFor(vaultName).update(oldId, patch, {
    expectedHash: oldDoc.hash,
    sink: sink.handle
  });
}
var init_supersede = __esm({
  "src/memory/tools/supersede.ts"() {
    "use strict";
    init_esm_shims();
    init_registry();
  }
});

// src/memory/tools/recall.ts
function confidenceRank(c) {
  switch (c) {
    case "direct":
      return 3;
    case "inferred":
      return 2;
    case "uncertain":
      return 1;
    default:
      return 0;
  }
}
function observedAtIso(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}
async function handleRecall(deps, args2) {
  const sinks = args2.sink ? [deps.memorySinkRegistry.resolveMemorySink(args2.sink)] : deps.memorySinkRegistry.listMemorySinks();
  if (sinks.length === 0) return [];
  const sinkVaultNames = new Set(sinks.map((s) => s.vault));
  const allowedVaultNames = args2.vaults ? new Set(args2.vaults.filter((v) => sinkVaultNames.has(v))) : sinkVaultNames;
  if (allowedVaultNames.size === 0) return [];
  const vaults = [];
  for (const name of allowedVaultNames) {
    vaults.push(deps.manager.require(name));
  }
  const candidates = await deps.searchHybrid({
    query: args2.query,
    vaults,
    topK: RECALL_HYBRID_TOP_K
  });
  const sinkMatchers = sinks.filter((s) => allowedVaultNames.has(s.vault)).map((s) => ({ vault: s.vault, prefix: s.resolveToRelativePath }));
  const inSink = candidates.filter(
    (hit) => sinkMatchers.some(
      (m) => hit.vault === m.vault && hit.notePath.startsWith(m.prefix)
    )
  );
  const uniqueByPath = /* @__PURE__ */ new Map();
  for (const hit of inSink) {
    const key = `${hit.vault}::${hit.notePath}`;
    const existing = uniqueByPath.get(key);
    if (!existing || hit.score > existing.score) {
      uniqueByPath.set(key, hit);
    }
  }
  if (uniqueByPath.size === 0) return [];
  const docs = [];
  for (const hit of uniqueByPath.values()) {
    const docId = formatDocId("obsidian-fs", hit.vault, hit.notePath);
    try {
      const doc = await deps.sourceConnectorFor(hit.vault).readDocument(docId);
      docs.push(doc);
    } catch {
    }
  }
  const now = Date.now();
  const minRank = args2.min_confidence ? confidenceRank(args2.min_confidence) : 0;
  const typeSet = args2.types && args2.types.length > 0 ? new Set(args2.types) : null;
  const maxAgeMs = args2.max_age_days !== void 0 ? args2.max_age_days * 864e5 : null;
  const filtered = docs.filter((doc) => {
    const props = doc.properties ?? {};
    if (props.status === "superseded") return false;
    if (minRank > 0) {
      const docConf = typeof props.confidence === "string" ? props.confidence : void 0;
      if (confidenceRank(docConf) < minRank) return false;
    }
    if (typeSet) {
      const t = typeof props.type === "string" ? props.type : void 0;
      if (t === void 0 || !typeSet.has(t)) return false;
    }
    if (maxAgeMs !== null) {
      const iso = observedAtIso(props.observed_at);
      if (iso === null) return false;
      if (now - Date.parse(iso) > maxAgeMs) return false;
    }
    return true;
  });
  filtered.sort((a, b) => {
    const ao = observedAtIso(a.properties?.observed_at) ?? "";
    const bo = observedAtIso(b.properties?.observed_at) ?? "";
    if (ao !== bo) {
      return ao < bo ? 1 : -1;
    }
    return b.mtime - a.mtime;
  });
  const limit = args2.limit ?? DEFAULT_LIMIT;
  const top = filtered.slice(0, limit);
  return top.map((doc) => {
    const { authority: vaultName } = decomposeDocId(doc.id);
    const source = deps.sourceConnectorFor(vaultName);
    return toCitationPacket(doc, displayUrlFor(doc.id, source));
  });
}
var DEFAULT_LIMIT, RECALL_HYBRID_TOP_K;
var init_recall = __esm({
  "src/memory/tools/recall.ts"() {
    "use strict";
    init_esm_shims();
    init_registry();
    init_citation_packet();
    DEFAULT_LIMIT = 20;
    RECALL_HYBRID_TOP_K = 200;
  }
});

// src/memory/tools/index.ts
var init_tools = __esm({
  "src/memory/tools/index.ts"() {
    "use strict";
    init_esm_shims();
    init_record_observation();
    init_supersede();
    init_recall();
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
  if (input.is_memory_sink_write !== void 0) {
    filter.isMemorySinkWrite = input.is_memory_sink_write;
  }
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
      at: row.at,
      // SQLite returns the column as 0 | 1; convert to JS boolean at the
      // audit-layer boundary so callers (MCP audit_log + tests) see the
      // documented `is_memory_sink_write: boolean` shape.
      is_memory_sink_write: row.is_memory_sink_write === 1
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

// src/adapters/change-feed/obsidian-fs/queue.ts
var DebouncedQueue;
var init_queue = __esm({
  "src/adapters/change-feed/obsidian-fs/queue.ts"() {
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
          console.error(`[DebouncedQueue] onFlush failed for ${event.path} (${event.kind}):`, err);
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
        for (const [path7, entry] of entries) {
          clearTimeout(entry.timer);
          this.pending.delete(path7);
          this.dispatch({ path: path7, kind: entry.kind });
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

// src/adapters/change-feed/obsidian-fs/chokidar-config.ts
import { posix } from "path";
function buildChokidarOptions(vaultPath, excludes) {
  return {
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
      stabilityThreshold: 400,
      pollInterval: 50
    },
    followSymlinks: false
  };
}
var init_chokidar_config = __esm({
  "src/adapters/change-feed/obsidian-fs/chokidar-config.ts"() {
    "use strict";
    init_esm_shims();
  }
});

// src/adapters/change-feed/obsidian-fs/watcher.ts
import chokidar from "chokidar";
import { sep as nativeSep } from "path";
var VaultWatcher;
var init_watcher = __esm({
  "src/adapters/change-feed/obsidian-fs/watcher.ts"() {
    "use strict";
    init_esm_shims();
    init_indexer2();
    init_queue();
    init_chokidar_config();
    VaultWatcher = class {
      fsWatcher = null;
      queue;
      opts;
      started = false;
      constructor(options) {
        this.opts = {
          vault: options.vault,
          embeddingModel: options.embeddingModel,
          secondaryEmbeddingModel: options.secondaryEmbeddingModel,
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
        this.fsWatcher = chokidar.watch(vaultPath, buildChokidarOptions(vaultPath, excludes));
        this.fsWatcher.on("add", (path7) => this.onFsEvent(path7, "change"));
        this.fsWatcher.on("change", (path7) => this.onFsEvent(path7, "change"));
        this.fsWatcher.on("unlink", (path7) => this.onFsEvent(path7, "delete"));
        this.fsWatcher.on("error", (err) => {
          const message = err instanceof Error ? err.message : String(err);
          this.opts.log(`fs watcher error: ${message}`);
        });
        await new Promise((resolve7) => {
          this.fsWatcher.once("ready", () => resolve7());
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
          secondaryEmbeddingModel: this.opts.secondaryEmbeddingModel,
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

// src/adapters/change-feed/obsidian-fs/suppression.ts
var SuppressionSet;
var init_suppression = __esm({
  "src/adapters/change-feed/obsidian-fs/suppression.ts"() {
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
      add(path7, ttlMs) {
        this.prune();
        const ttl = ttlMs ?? this.defaultTtlMs;
        this.entries.set(path7, { expiresAt: this.now() + ttl });
      }
      /**
       * If path is suppressed, remove the entry and return true (skip event).
       * Otherwise return false.
       */
      consume(path7) {
        this.prune();
        const entry = this.entries.get(path7);
        if (!entry) return false;
        if (entry.expiresAt <= this.now()) {
          this.entries.delete(path7);
          return false;
        }
        this.entries.delete(path7);
        return true;
      }
      /** Read-only check; does not consume. */
      has(path7) {
        this.prune();
        const entry = this.entries.get(path7);
        if (!entry) return false;
        if (entry.expiresAt <= this.now()) {
          this.entries.delete(path7);
          return false;
        }
        return true;
      }
      /** Drop expired entries. */
      prune() {
        const t = this.now();
        for (const [path7, entry] of this.entries) {
          if (entry.expiresAt <= t) {
            this.entries.delete(path7);
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

// src/adapters/change-feed/obsidian-fs/change-feed.ts
import chokidar2 from "chokidar";
import { sep as nativeSep2 } from "path";
var SCHEME3, ObsidianFsChangeFeed;
var init_change_feed = __esm({
  "src/adapters/change-feed/obsidian-fs/change-feed.ts"() {
    "use strict";
    init_esm_shims();
    init_registry();
    init_suppression();
    init_chokidar_config();
    SCHEME3 = "obsidian-fs";
    ObsidianFsChangeFeed = class {
      handle;
      capabilities = {
        watch: "push",
        /**
         * Phase 1 emits delete+create rather than a tagged rename event.
         * Honest publication per Invariant I-7 — the conformance test
         * asserts no `{kind: "rename"}` event is observed when this flag
         * is false.
         */
        emitsRename: false
      };
      vault;
      suppression;
      log;
      handlers = /* @__PURE__ */ new Set();
      fsWatcher = null;
      startPromise = null;
      closed = false;
      constructor(options) {
        this.vault = options.vault;
        this.suppression = options.suppression;
        this.log = options.log ?? ((_m) => {
        });
        this.handle = parseSourceHandle(`${SCHEME3}://${this.vault.config.name}`);
      }
      subscribe(handler) {
        if (this.closed) {
          return { [Symbol.dispose]: () => void 0 };
        }
        this.handlers.add(handler);
        if (!this.startPromise) {
          this.startPromise = this.start();
        }
        return {
          [Symbol.dispose]: () => {
            this.handlers.delete(handler);
          }
        };
      }
      /**
       * Wait until the chokidar watcher has reported "ready". Test-only
       * helper — the conformance test awaits this between `subscribe` and
       * its first synthetic event so the watcher has surveyed the dir.
       */
      async ready() {
        if (this.startPromise) {
          await this.startPromise;
        }
      }
      async close() {
        if (this.closed) return;
        this.closed = true;
        this.handlers.clear();
        if (this.fsWatcher) {
          await this.fsWatcher.close();
          this.fsWatcher = null;
        }
      }
      // ─── internal ──────────────────────────────────────────────────────────
      async start() {
        if (this.closed) return;
        const vaultPath = this.vault.config.path;
        const excludes = this.vault.config.exclude_globs ?? [];
        const watcher = chokidar2.watch(vaultPath, buildChokidarOptions(vaultPath, excludes));
        this.fsWatcher = watcher;
        watcher.on("add", (absolutePath) => this.onFsEvent(absolutePath, "create"));
        watcher.on("change", (absolutePath) => this.onFsEvent(absolutePath, "update"));
        watcher.on("unlink", (absolutePath) => this.onFsEvent(absolutePath, "delete"));
        watcher.on("error", (err) => {
          const message = err instanceof Error ? err.message : String(err);
          this.log(`fs watcher error: ${message}`);
        });
        await new Promise((resolve7) => {
          watcher.once("ready", () => resolve7());
        });
      }
      onFsEvent(absolutePath, kind) {
        if (this.closed) return;
        if (!absolutePath.endsWith(".md")) return;
        const relativePath = this.toRelative(absolutePath);
        if (this.suppression.consume(relativePath)) {
          this.log(`suppressed ${kind} ${relativePath} (own write)`);
          return;
        }
        const id = formatDocId(SCHEME3, this.vault.config.name, relativePath);
        const event = { kind, id, at: Date.now() };
        this.fanout(event);
      }
      toRelative(absolutePath) {
        const root = this.vault.config.path;
        let rel = absolutePath;
        if (rel.startsWith(root)) rel = rel.slice(root.length);
        if (rel.startsWith(nativeSep2) || rel.startsWith("/")) rel = rel.slice(1);
        return rel.split(nativeSep2).join("/");
      }
      fanout(event) {
        for (const handler of [...this.handlers]) {
          try {
            const result = handler(event);
            if (result && typeof result.then === "function") {
              result.catch((err) => {
                const message = err instanceof Error ? err.message : String(err);
                this.log(`handler error: ${message}`);
              });
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.log(`handler error: ${message}`);
          }
        }
      }
    };
  }
});

// src/adapters/change-feed/obsidian-fs/index.ts
var init_obsidian_fs3 = __esm({
  "src/adapters/change-feed/obsidian-fs/index.ts"() {
    "use strict";
    init_esm_shims();
    init_watcher();
    init_queue();
    init_suppression();
    init_change_feed();
  }
});

// src/tool-registry.ts
import { z as z6 } from "zod";
function buildToolSchema(name) {
  const builder = SCHEMA_BUILDERS[name];
  if (builder) return builder();
  return z6.object(TOOL_SCHEMAS[name]);
}
var TOOLS, DOC_ID_PATTERN2, PredicateSchema, TOOL_SCHEMAS, SCHEMA_BUILDERS;
var init_tool_registry = __esm({
  "src/tool-registry.ts"() {
    "use strict";
    init_esm_shims();
    TOOLS = [
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
            limit: { type: "integer", minimum: 1, maximum: 1e3, default: 50 },
            is_memory_sink_write: {
              type: "boolean",
              description: "Filter rows to memory-sink writes only (true) or non-memory writes only (false). Omit to include all. See docs/tools/audit_log.md."
            }
          }
        }
      },
      {
        name: "list_models",
        description: "List all embedding models registered for a vault, with dim, active flag, and how many chunks have been embedded under each. Use before start_shadow_index / switch_active_model.",
        inputSchema: {
          type: "object",
          required: ["vault"],
          properties: { vault: { type: "string" } }
        }
      },
      {
        name: "start_shadow_index",
        description: "Backfill embeddings for a secondary (shadow) model over every chunk in the vault. The active model is untouched \u2014 search keeps working during the run. Idempotent (resumable). Run switch_active_model once complete to promote the shadow.",
        inputSchema: {
          type: "object",
          required: ["vault", "model"],
          properties: {
            vault: { type: "string" },
            model: {
              type: "string",
              description: "Ollama model name, e.g. 'bge-m3' or 'embeddinggemma'."
            },
            batch_size: {
              type: "integer",
              minimum: 1,
              maximum: 256,
              description: "Embed batch size \u2014 default 16."
            }
          }
        }
      },
      {
        name: "switch_active_model",
        description: "Atomically promote a registered model to active. Fails with ok:false / reason:'incomplete' if any chunk is missing a shadow embedding for the target model.",
        inputSchema: {
          type: "object",
          required: ["vault", "model_name"],
          properties: {
            vault: { type: "string" },
            model_name: { type: "string" }
          }
        }
      },
      {
        name: "vacuum_embeddings",
        description: "Drop orphaned embedding rows whose chunk_id no longer exists in the chunks table. Safe and idempotent; does not touch live data. Useful after migrations from pre-v0.7.0 schemas where chunk deletion did not always cascade to the derived layer.",
        inputSchema: {
          type: "object",
          required: ["vault"],
          properties: { vault: { type: "string" } }
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
      },
      {
        name: "search",
        // Tool description names "Claude.ai" + "Deep-Research" as the // vault-memory:claude-ok
        // real OB1-connector-ecosystem product names; not a Claude-only coupling.
        description: "OB1-compatible search adapter. Returns a flat list of {id, title, url, snippet} for connector ecosystems (ChatGPT Custom Connectors, Claude.ai, Deep-Research). Backed by hybrid (semantic+BM25+RRF) search. For richer output use search_hybrid.",
        // vault-memory:claude-ok
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 10 }
          }
        }
      },
      {
        name: "fetch",
        description: "OB1-compatible fetch adapter. Resolves an opaque id (from `search`) to {id, title, text, url, metadata}. Backed by read_note.",
        inputSchema: {
          type: "object",
          required: ["id"],
          properties: {
            id: {
              type: "string",
              description: "Opaque id from `search` results, format: <vault>:<vault-relative-path>"
            }
          }
        }
      },
      {
        name: "vault_stats",
        description: "Vault overview for agent self-orientation: note/word counts, top tags, top frontmatter keys, embedding model, last index run. Omit `vault` to get all configured vaults.",
        inputSchema: {
          type: "object",
          properties: {
            vault: { type: "string", description: "Optional. Omit for all vaults." }
          }
        }
      },
      {
        name: "recent_notes",
        description: "List recently modified notes (mtime DESC). Use for agent self-orientation: 'what has the user been working on lately?'. No vector search, just SQL.",
        inputSchema: {
          type: "object",
          properties: {
            vault: { type: "string", description: "Optional. Omit for all vaults." },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 20 },
            since: {
              type: "integer",
              description: "Optional unix-ms threshold. Only notes with mtime > since."
            }
          }
        }
      },
      {
        name: "suggest_frontmatter",
        description: "Suggest frontmatter fields for a note based on folder-conventions, wikilink-neighborhood, and title/body content-heuristics. Returns {existing, suggestions, conflicts}. Two input modes: (1) existing note via {path}; (2) draft via {content, folder_hint, title}. At least one of path/content required. Suggestions sorted by confidence DESC; conflicts list disagreements between sources.",
        inputSchema: {
          type: "object",
          required: ["vault"],
          properties: {
            vault: { type: "string" },
            path: {
              type: "string",
              description: "Vault-relative path. Required for existing-note mode; for drafts, pass content instead (folder_hint controls folder-inference)."
            },
            content: {
              type: "string",
              description: "Draft markdown body. When set, content-heuristics layer runs. If path is set AND content is omitted, the existing note's stored content is used."
            },
            title: {
              type: "string",
              description: "Title for content-heuristics. Falls back to path basename or first heading."
            },
            folder_hint: {
              type: "string",
              description: "For draft mode: the target folder (e.g. 'Personen/'). Ignored when `path` is set."
            }
          }
        }
      },
      // ── Phase 2 memory tools (Plan 02-04 + 02-05) ─────────────────────────────
      {
        name: "record_observation",
        description: "Record a new memory observation under the labeled MemorySink for a vault. Required provenance properties (source, confidence, evidence, status, observed_at, type, superseded_by) are auto-filled from arguments; `properties` is an escape hatch for contract-allowed extras and overrides any sugar default (D-02 \u2014 caller-last merge). Writes route through DeliveryAdapter.write() and pass through the centralized provenance validator.",
        inputSchema: {
          type: "object",
          required: ["vault", "claim", "evidence", "confidence", "type"],
          properties: {
            vault: { type: "string", description: "Vault name (registered in [vaults] config)" },
            claim: {
              type: "string",
              description: "Short natural-language statement of the observation (becomes title + body)."
            },
            evidence: {
              type: "array",
              items: { type: "string" },
              description: "DocIds or quoted source spans supporting the claim; empty array allowed."
            },
            confidence: {
              type: "string",
              enum: ["direct", "inferred", "uncertain"],
              description: "How the agent arrived at this claim."
            },
            type: {
              type: "string",
              description: "Observation type per the sink contract (e.g. 'observation', 'hypothesis', 'decision')."
            },
            sink: {
              type: "string",
              description: "Memory sink name OR full obsidian-fs://\u2026 handle. Defaults to the vault's default sink."
            },
            properties: {
              type: "object",
              additionalProperties: true,
              description: "Escape-hatch: contract-allowed extra properties; merged AFTER sugar args (caller wins)."
            }
          }
        }
      },
      {
        name: "supersede",
        description: 'Mark an existing memory document as superseded by a replacement document. Forward-only \u2014 the replacement doc is NOT touched; back-links are derived by the Phase 4 graph layer at query time. Atomic single OCC update on the OLD doc; sets status="superseded", superseded_by, and superseded_reason.',
        inputSchema: {
          type: "object",
          required: ["doc_id", "replacement_doc_id", "reason"],
          properties: {
            doc_id: {
              type: "string",
              description: "DocId of the document being superseded."
            },
            replacement_doc_id: {
              type: "string",
              description: "DocId of the replacement document."
            },
            reason: {
              type: "string",
              description: "Why the old document is being retired; written to superseded_reason."
            }
          }
        }
      },
      // ── Phase 2 memory tools (Plan 02-05) ────────────────────────────────────
      {
        name: "recall",
        description: "Retrieve memory documents from one or more labeled MemorySinks, filtered by provenance (min_confidence, types, max_age_days) and ranked by recency (observed_at DESC). Returns citation packets (doc_id, source_handle, title, heading_path, mtime, hash, display_url, properties) \u2014 the same 8-field shape Phase 3 assembly tools use. Superseded documents are hidden by default.",
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: {
              type: "string",
              description: "Natural-language query; routes through hybrid (semantic + BM25) search."
            },
            min_confidence: {
              type: "string",
              enum: ["direct", "inferred", "uncertain"],
              description: "Exclude docs whose confidence ordinal is lower than this (direct=3, inferred=2, uncertain=1)."
            },
            types: {
              type: "array",
              items: { type: "string" },
              description: "Restrict to docs whose `type` property is in this set."
            },
            max_age_days: {
              type: "integer",
              minimum: 1,
              description: "Exclude docs whose `observed_at` is older than this many days."
            },
            sink: {
              type: "string",
              description: "Memory sink name OR full obsidian-fs://\u2026 handle. Defaults to all configured sinks."
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 200,
              default: 20,
              description: "Max results AFTER filter+sort."
            },
            vaults: {
              type: "array",
              items: { type: "string" },
              description: "Restrict to these vault names; defaults to all configured."
            }
          }
        }
      }
    ];
    DOC_ID_PATTERN2 = /^[a-z][a-z0-9-]*:\/\/[^/]+\/.+$/;
    PredicateSchema = z6.union([
      z6.string(),
      z6.number(),
      z6.boolean(),
      z6.null(),
      z6.object({ $in: z6.array(z6.union([z6.string(), z6.number(), z6.boolean(), z6.null()])) }),
      z6.object({ $exists: z6.boolean() }),
      z6.object({ $contains: z6.union([z6.string(), z6.number(), z6.boolean(), z6.null()]) })
    ]);
    TOOL_SCHEMAS = {
      list_vaults: {},
      read_note: {
        vault: z6.string(),
        path: z6.string()
      },
      search_semantic: {
        query: z6.string().min(1),
        vaults: z6.array(z6.string()).optional(),
        top_k: z6.number().int().positive().max(100).optional().default(10),
        exclude_paths: z6.array(z6.string()).optional()
      },
      search_text: {
        query: z6.string().min(1),
        vaults: z6.array(z6.string()).optional(),
        top_k: z6.number().int().positive().max(100).optional().default(10),
        exclude_paths: z6.array(z6.string()).optional()
      },
      search_hybrid: {
        query: z6.string().min(1),
        vaults: z6.array(z6.string()).optional(),
        top_k: z6.number().int().positive().max(100).optional().default(10),
        rrf_k: z6.number().int().positive().max(1e3).optional().default(60),
        exclude_paths: z6.array(z6.string()).optional(),
        rerank: z6.boolean().optional().default(false)
      },
      list_backlinks: {
        vault: z6.string(),
        path: z6.string()
      },
      list_forward_links: {
        vault: z6.string(),
        path: z6.string(),
        include_broken: z6.boolean().optional().default(true)
      },
      find_broken_links: {
        vault: z6.string()
      },
      query_frontmatter: {
        vault: z6.string(),
        where: z6.record(z6.string(), PredicateSchema),
        limit: z6.number().int().positive().max(1e3).optional().default(100)
      },
      write_note: {
        vault: z6.string(),
        path: z6.string(),
        content: z6.string(),
        frontmatter: z6.record(z6.string(), z6.unknown()).nullable().optional(),
        expected_hash: z6.string().optional(),
        client_id: z6.string().optional()
      },
      update_frontmatter: {
        vault: z6.string(),
        path: z6.string(),
        merge: z6.record(z6.string(), z6.unknown()),
        expected_hash: z6.string().optional(),
        client_id: z6.string().optional()
      },
      delete_note: {
        vault: z6.string(),
        path: z6.string(),
        expected_hash: z6.string(),
        client_id: z6.string().optional()
      },
      audit_log: {
        vault: z6.string(),
        note_path: z6.string().optional(),
        op: z6.enum(["create", "update", "delete"]).optional(),
        since: z6.number().int().nonnegative().optional(),
        limit: z6.number().int().positive().max(1e3).optional().default(50),
        // Plan 02-06 (MEM-08): additive optional filter. The MCP tool's
        // `description` string is INTENTIONALLY unchanged — Phase 1 byte-identity
        // is preserved. New capability is documented in docs/tools/audit_log.md.
        is_memory_sink_write: z6.boolean().optional()
      },
      list_models: {
        vault: z6.string()
      },
      start_shadow_index: {
        vault: z6.string(),
        model: z6.string().min(1),
        batch_size: z6.number().int().positive().max(256).optional()
      },
      switch_active_model: {
        vault: z6.string(),
        model_name: z6.string().min(1)
      },
      vacuum_embeddings: {
        vault: z6.string()
      },
      index_runs: {
        vault: z6.string(),
        limit: z6.number().int().positive().max(200).optional().default(20)
      },
      search: {
        query: z6.string().min(1),
        limit: z6.number().int().positive().max(50).optional().default(10)
      },
      fetch: {
        id: z6.string().min(1)
      },
      vault_stats: {
        vault: z6.string().optional()
      },
      recent_notes: {
        vault: z6.string().optional(),
        limit: z6.number().int().positive().max(200).optional().default(20),
        since: z6.number().int().nonnegative().optional()
      },
      suggest_frontmatter: {
        vault: z6.string(),
        path: z6.string().optional(),
        content: z6.string().optional(),
        title: z6.string().optional(),
        folder_hint: z6.string().optional()
      },
      // ── Phase 2 memory tools (Plan 02-04) ───────────────────────────────────
      record_observation: {
        vault: z6.string().min(1).describe("Vault name (registered in [vaults] config block)"),
        claim: z6.string().min(1).describe("Short natural-language statement of the observation (becomes title + body)"),
        evidence: z6.array(z6.string()).describe("DocIds or quoted source spans supporting the claim; empty array allowed"),
        confidence: z6.enum(["direct", "inferred", "uncertain"]).describe("How the agent arrived at this claim"),
        type: z6.string().min(1).describe(
          "Observation type per the sink contract (e.g. 'observation', 'hypothesis', 'decision')"
        ),
        sink: z6.string().min(1).optional().describe(
          "Memory sink name OR full obsidian-fs://\u2026 handle. Defaults to the vault's default sink."
        ),
        properties: z6.record(z6.string(), z6.unknown()).optional().describe(
          "Escape-hatch: contract-allowed extra properties; merged AFTER sugar args (caller wins)"
        )
      },
      supersede: {
        doc_id: z6.string().regex(DOC_ID_PATTERN2).describe("DocId of the document being superseded"),
        replacement_doc_id: z6.string().regex(DOC_ID_PATTERN2).describe("DocId of the replacement document"),
        reason: z6.string().min(1).describe("Why the old document is being retired; written to superseded_reason")
      },
      // ── Phase 2 memory tools (Plan 02-05) ───────────────────────────────────
      recall: {
        query: z6.string().min(1).describe("Natural-language query; routes through hybrid (semantic + BM25) search"),
        min_confidence: z6.enum(["direct", "inferred", "uncertain"]).optional().describe(
          "Exclude docs whose confidence ordinal is lower than this (direct=3, inferred=2, uncertain=1)"
        ),
        types: z6.array(z6.string().min(1)).optional().describe("Restrict to docs whose `type` property is in this set"),
        max_age_days: z6.number().int().positive().optional().describe("Exclude docs whose `observed_at` is older than this many days"),
        sink: z6.string().min(1).optional().describe(
          "Memory sink name OR full obsidian-fs://\u2026 handle. Defaults to all configured sinks."
        ),
        limit: z6.number().int().positive().max(200).optional().describe("Maximum results AFTER filter+sort; default 20"),
        vaults: z6.array(z6.string().min(1)).optional().describe("Restrict to these vault names; defaults to all configured")
      }
    };
    SCHEMA_BUILDERS = {
      suggest_frontmatter: () => z6.object(TOOL_SCHEMAS.suggest_frontmatter).refine((v) => v.path !== void 0 || v.content !== void 0, {
        message: "suggest_frontmatter requires either `path` or `content`"
      })
    };
  }
});

// src/server.ts
var server_exports = {};
__export(server_exports, {
  aggregateTopFrontmatterKeys: () => aggregateTopFrontmatterKeys,
  aggregateTopTags: () => aggregateTopTags,
  decodeNoteId: () => decodeNoteId,
  discoverMemorySinks: () => discoverMemorySinks,
  encodeNoteId: () => encodeNoteId,
  serve: () => serve,
  setupMemorySinks: () => setupMemorySinks,
  truncateSnippet: () => truncateSnippet
});
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { homedir as homedir4 } from "os";
import { join as joinPath } from "path";
async function discoverMemorySinks(configured, vaults) {
  if (configured.length > 0) {
    return [...configured];
  }
  const discovered = [];
  for (const v of vaults) {
    if (await sentinelExistsAt(v.path, "_memory")) {
      discovered.push({
        name: "default",
        handle: `obsidian-fs://${v.name}/_memory/`,
        contract: "default-memory-v1"
      });
    }
  }
  return discovered;
}
async function setupMemorySinks(config, manager) {
  const registry = new MemorySinkRegistry();
  const vaults = manager.list().map((v) => ({
    name: v.config.name,
    path: v.config.path
  }));
  const sinksConfig = await discoverMemorySinks(config.memory_sinks, vaults);
  await registry.registerMemorySinks(sinksConfig, {
    resolveVaultAbsolutePath: (name) => manager.require(name).config.path,
    ...config.memory?.default_sink !== void 0 ? { defaultSinkName: config.memory.default_sink } : {},
    provisioner: async (sink, vaultAbs) => provisionSink(sink, vaultAbs, { version: VERSION })
  });
  return registry;
}
async function serve(options = {}) {
  const onPhase = options.onPhase ?? (() => void 0);
  onPhase("load_config");
  const config = await loadConfig();
  onPhase("open_vaults");
  const manager = new VaultManager();
  await manager.loadAll(config.vaults);
  onPhase("register_memory_sinks");
  const memorySinkRegistry = await setupMemorySinks(config, manager);
  const adapterRegistry = new AdapterRegistry();
  let serverRef;
  const getClientId = () => serverRef?.server.getClientVersion()?.name ?? "unknown";
  const suppression = new SuppressionSet({ ttlMs: 2e3 });
  const changeFeeds = /* @__PURE__ */ new Map();
  for (const vault of manager.list()) {
    const source = new ObsidianFsSource(vault.config);
    adapterRegistry.registerSource(source.handle, source);
    const delivery = new ObsidianFsDelivery(vault, getClientId, memorySinkRegistry);
    adapterRegistry.registerDelivery(delivery.handle, delivery);
    const changeFeed = new ObsidianFsChangeFeed({
      vault,
      suppression,
      log: (m) => process.stderr.write(`[change-feed:${vault.config.name}] ${m}
`)
    });
    adapterRegistry.registerChangeFeed(changeFeed.handle, changeFeed);
    changeFeeds.set(vault.config.name, changeFeed);
  }
  const ollama = new OllamaClient({
    endpoint: config.server.ollama_endpoint
  });
  const defaultModel = config.server.default_embedding_model ?? "qwen3-embedding:0.6b";
  const activeVault = process.env.VAULT_MEMORY_ACTIVE_VAULT?.trim() || void 0;
  const rerankerBackend = config.server.reranker_backend ?? (config.server.reranker_model ? "onnx" : void 0);
  const reranker = config.server.reranker_model ? rerankerBackend === "ollama" ? new OllamaReranker({ ollama, model: config.server.reranker_model }) : new OnnxReranker({
    modelDir: config.server.reranker_model_dir ?? joinPath(homedir4(), ".vault-memory", "models", "bge-reranker-v2-m3")
  }) : void 0;
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
        secondaryEmbeddingModel: vault.config.secondary_embedding_model,
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
    for (const cf of changeFeeds.values()) {
      await cf.close();
    }
  };
  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
  const server = new McpServer(
    { name: "vault-memory", version: VERSION },
    // Plan 02-06 (MEM-09): advertise `resources` capability so MCP clients
    // call `resources/list` + `resources/read` on bootstrap. Polled-only —
    // no `subscribe` / `listChanged` flags asserted.
    { capabilities: { tools: {}, resources: {} } }
  );
  serverRef = server;
  const handlers = {
    list_vaults: async () => handleListVaults(manager),
    read_note: async (a) => {
      const p = a;
      return handleReadNote(adapterRegistry, p.vault, p.path);
    },
    search_semantic: async (a) => {
      const p = a;
      return handleSearchSemantic(
        manager,
        ollama,
        defaultModel,
        activeVault,
        p.query,
        p.vaults,
        p.top_k,
        p.exclude_paths
      );
    },
    search_text: async (a) => {
      const p = a;
      return handleSearchText(manager, activeVault, p.query, p.vaults, p.top_k, p.exclude_paths);
    },
    search_hybrid: async (a) => {
      const p = a;
      return handleSearchHybrid(
        manager,
        ollama,
        defaultModel,
        activeVault,
        p.query,
        p.vaults,
        p.top_k,
        p.rrf_k,
        p.exclude_paths,
        p.rerank ? reranker : void 0
      );
    },
    list_backlinks: async (a) => {
      const p = a;
      const vault = manager.require(p.vault);
      return { backlinks: listBacklinks(vault, p.path) };
    },
    list_forward_links: async (a) => {
      const p = a;
      const vault = manager.require(p.vault);
      return { links: listForwardLinks(vault, p.path, p.include_broken) };
    },
    find_broken_links: async (a) => {
      const p = a;
      const vault = manager.require(p.vault);
      return { broken: findBrokenLinks(vault) };
    },
    query_frontmatter: async (a) => {
      const p = a;
      const vault = manager.require(p.vault);
      const hits = queryFrontmatter(vault, {
        where: p.where,
        limit: p.limit
      });
      return {
        notes: hits.map((n) => ({
          path: n.path,
          title: n.title,
          frontmatter: n.frontmatter ? JSON.parse(n.frontmatter) : null,
          mtime: n.mtime
        })),
        count: hits.length
      };
    },
    write_note: async (a) => {
      const p = a;
      const vault = manager.require(p.vault);
      suppression.add(p.path);
      return handleWriteNote(adapterRegistry, vault, p);
    },
    update_frontmatter: async (a) => {
      const p = a;
      const vault = manager.require(p.vault);
      return updateFrontmatter({
        vault,
        registry: adapterRegistry,
        memorySinkRegistry,
        relativePath: p.path,
        merge: p.merge,
        ...p.expected_hash !== void 0 ? { expectedHash: p.expected_hash } : {},
        ...p.client_id !== void 0 ? { clientId: p.client_id } : {},
        onBeforeFsWrite: () => suppression.add(p.path)
      });
    },
    delete_note: async (a) => {
      const p = a;
      const vault = manager.require(p.vault);
      suppression.add(p.path);
      return handleDeleteNote(adapterRegistry, vault, p);
    },
    audit_log: async (a) => {
      const p = a;
      const vault = manager.require(p.vault);
      const entries = getAuditLog({
        vault,
        notePath: p.note_path,
        op: p.op,
        since: p.since,
        limit: p.limit,
        ...p.is_memory_sink_write !== void 0 ? { is_memory_sink_write: p.is_memory_sink_write } : {}
      });
      return { entries, count: entries.length };
    },
    list_models: async (a) => {
      const p = a;
      const vault = manager.require(p.vault);
      const models = listModels(vault);
      return { models, count: models.length };
    },
    start_shadow_index: async (a) => {
      const p = a;
      const vault = manager.require(p.vault);
      return startShadowIndex({
        vault,
        model: p.model,
        ollama,
        batchSize: p.batch_size,
        log: (m) => process.stderr.write(`[shadow:${vault.config.name}] ${m}
`)
      });
    },
    switch_active_model: async (a) => {
      const p = a;
      const vault = manager.require(p.vault);
      return switchActiveModel(vault, p.model_name);
    },
    vacuum_embeddings: async (a) => {
      const p = a;
      const vault = manager.require(p.vault);
      return vacuumEmbeddings(vault);
    },
    index_runs: async (a) => {
      const p = a;
      const vault = manager.require(p.vault);
      const runs = getIndexRuns({ vault, limit: p.limit });
      return { runs, count: runs.length };
    },
    search: async (a) => {
      const p = a;
      return handleSearchCompat(
        manager,
        adapterRegistry,
        ollama,
        defaultModel,
        activeVault,
        p.query,
        p.limit,
        reranker
      );
    },
    fetch: async (a) => {
      const p = a;
      return handleFetchCompat(manager, adapterRegistry, p.id);
    },
    vault_stats: async (a) => {
      const p = a;
      return handleVaultStats(manager, p.vault);
    },
    recent_notes: async (a) => {
      const p = a;
      return handleRecentNotes(manager, p.vault, p.limit, p.since);
    },
    suggest_frontmatter: async (a) => {
      const p = a;
      return handleSuggestFrontmatter(manager, p);
    },
    // ── Phase 2 memory tools (Plan 02-04) ──────────────────────────────────
    record_observation: async (a) => {
      const p = a;
      const result = await handleRecordObservation(
        {
          memorySinkRegistry,
          manager,
          deliveryAdapterFor: (vaultName) => adapterRegistry.resolveDelivery(
            parseSourceHandle(`obsidian-fs://${vaultName}`)
          ),
          sourceConnectorFor: (vaultName) => adapterRegistry.resolveSource(
            parseSourceHandle(`obsidian-fs://${vaultName}`)
          )
        },
        p
      );
      if (result.ok) {
        const resource = result.doc_id.replace(
          `obsidian-fs://${p.vault}/`,
          ""
        );
        suppression.add(resource);
      }
      return result;
    },
    supersede: async (a) => {
      const p = a;
      const result = await handleSupersede(
        {
          memorySinkRegistry,
          manager,
          deliveryAdapterFor: (vaultName) => adapterRegistry.resolveDelivery(
            parseSourceHandle(`obsidian-fs://${vaultName}`)
          ),
          sourceConnectorFor: (vaultName) => adapterRegistry.resolveSource(
            parseSourceHandle(`obsidian-fs://${vaultName}`)
          )
        },
        p
      );
      if (result.ok) {
        const resource = result.doc_id.replace(/^obsidian-fs:\/\/[^/]+\//, "");
        suppression.add(resource);
      }
      return result;
    },
    // ── Phase 2 memory tools (Plan 02-05) ──────────────────────────────────
    recall: async (a) => {
      const p = a;
      const packets = await handleRecall(
        {
          memorySinkRegistry,
          manager,
          sourceConnectorFor: (vaultName) => adapterRegistry.resolveSource(
            parseSourceHandle(`obsidian-fs://${vaultName}`)
          ),
          searchHybrid: async (input) => hybridSearch({
            query: input.query,
            embeddingModel: defaultModel,
            ollama,
            vaults: input.vaults,
            topK: input.topK,
            rrfK: 60,
            includeBreakdown: false
          })
        },
        p
      );
      return { packets, count: packets.length };
    }
  };
  for (const tool of TOOLS) {
    const name = tool.name;
    const handler = handlers[name];
    const schema = TOOL_SCHEMAS[name];
    const needsRefinementCheck = name === "suggest_frontmatter";
    server.registerTool(
      name,
      { description: tool.description, inputSchema: schema },
      async (args2) => {
        try {
          let validated = args2;
          if (needsRefinementCheck) {
            validated = buildToolSchema(name).parse(args2);
          }
          const data = await handler(validated);
          return ok(data);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResponse(message);
        }
      }
    );
  }
  server.registerResource(
    "memory-sinks",
    RESOURCE_URI_LIST_SINKS,
    {
      title: "Memory sinks",
      description: "Configured + auto-discovered MemorySinks (name, handle, vault, contract, default). Read to discover where memory documents (record_observation, supersede) land.",
      mimeType: "application/json"
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(readListSinks(memorySinkRegistry), null, 2)
        }
      ]
    })
  );
  server.registerResource(
    "memory-stats",
    RESOURCE_URI_MEMORY_STATS,
    {
      title: "Memory sink stats",
      description: "Per-sink document counts, by_type / by_status breakdowns, and last memory-write timestamp. Polled \u2014 re-read to refresh.",
      mimeType: "application/json"
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(readMemoryStats(memorySinkRegistry, manager), null, 2)
        }
      ]
    })
  );
  onPhase("connect_transport");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  onPhase("start_catchup");
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
async function handleReadNote(registry, vaultName, path7) {
  const handle = parseSourceHandle(`obsidian-fs://${vaultName}`);
  let source;
  try {
    source = registry.resolveSource(handle);
  } catch {
    throw new Error(`Note not found: ${vaultName}/${path7}`);
  }
  const id = formatDocId("obsidian-fs", vaultName, path7);
  let doc;
  try {
    doc = await source.readDocument(id);
  } catch {
    throw new Error(`Note not found: ${vaultName}/${path7}`);
  }
  const { wikilinks: _wikilinks, ...frontmatterOnly } = doc.properties;
  const hasFrontmatter = Object.keys(frontmatterOnly).length > 0;
  const content = doc.blocks[0]?.kind === "paragraph" ? doc.blocks[0].text : "";
  return {
    path: path7,
    title: doc.title,
    content,
    frontmatter: hasFrontmatter ? frontmatterOnly : null,
    hash: doc.hash,
    mtime: doc.mtime,
    word_count: countWords3(content)
  };
}
async function handleWriteNote(registry, vault, parsed) {
  const handle = parseSourceHandle(`obsidian-fs://${parsed.vault}`);
  const delivery = registry.resolveDelivery(handle);
  const docId = formatDocId("obsidian-fs", parsed.vault, parsed.path);
  const partial = {
    blocks: [{ kind: "paragraph", text: parsed.content }],
    properties: parsed.frontmatter ?? {}
  };
  const opts = {};
  if (parsed.expected_hash !== void 0) opts.expectedHash = parsed.expected_hash;
  if (parsed.client_id !== void 0) opts.clientId = parsed.client_id;
  const res = await delivery.write(docId, partial, opts);
  if (!res.ok) {
    const out = {
      ok: false,
      reason: res.reason === "not_found" ? "hash_mismatch" : res.reason
    };
    if (res.currentHash !== void 0) out.currentHash = res.currentHash;
    if (res.message !== void 0) out.message = res.message;
    if (res.sinkName !== void 0) out.sinkName = res.sinkName;
    if (res.suggestion !== void 0) out.suggestion = res.suggestion;
    if (res.key !== void 0) out.key = res.key;
    if (res.observedValue !== void 0) out.observedValue = res.observedValue;
    return out;
  }
  const noteRow = vault.db.notes.getByPath(parsed.path);
  return {
    ok: true,
    newHash: res.newHash,
    noteId: noteRow?.id ?? 0,
    created: res.created
  };
}
async function handleDeleteNote(registry, vault, parsed) {
  const noteRow = vault.db.notes.getByPath(parsed.path);
  const preDeleteHash = noteRow?.hash ?? parsed.expected_hash;
  const handle = parseSourceHandle(`obsidian-fs://${parsed.vault}`);
  const delivery = registry.resolveDelivery(handle);
  const docId = formatDocId("obsidian-fs", parsed.vault, parsed.path);
  const opts = {
    expectedHash: parsed.expected_hash
  };
  if (parsed.client_id !== void 0) opts.clientId = parsed.client_id;
  const res = await delivery.delete(docId, opts);
  if (!res.ok) {
    const out = {
      ok: false,
      reason: res.reason === "not_found" ? "hash_mismatch" : res.reason
    };
    if (res.currentHash !== void 0) out.currentHash = res.currentHash;
    if (res.message !== void 0) out.message = res.message;
    if (res.sinkName !== void 0) out.sinkName = res.sinkName;
    if (res.suggestion !== void 0) out.suggestion = res.suggestion;
    return out;
  }
  return {
    ok: true,
    newHash: preDeleteHash,
    noteId: noteRow?.id ?? 0,
    created: false
  };
}
function countWords3(content) {
  if (content.length === 0) return 0;
  return content.split(/\s+/).filter((s) => s.length > 0).length;
}
function resolveVaultTargets(manager, vaultFilter, activeVault) {
  if (vaultFilter) {
    return { targets: vaultFilter.map((n) => manager.require(n)), skipped: [] };
  }
  const candidates = activeVault ? [manager.require(activeVault)] : manager.list();
  const targets = [];
  const skipped = [];
  for (const v of candidates) {
    if (v.db.audit.isIndexing()) {
      skipped.push(v.config.name);
    } else {
      targets.push(v);
    }
  }
  return { targets, skipped };
}
async function handleSearchSemantic(manager, ollama, defaultModel, activeVault, query, vaultFilter, topK, excludePaths) {
  const { targets, skipped } = resolveVaultTargets(manager, vaultFilter, activeVault);
  if (targets.length === 0) {
    return {
      hits: [],
      note: skipped.length > 0 ? `All eligible vaults are indexing; skipped: ${skipped.join(", ")}.` : "No vaults configured."
    };
  }
  const hasExclude = excludePaths !== void 0 && excludePaths.length > 0;
  const fanK = hasExclude ? topK * 3 : topK;
  const embedCache = /* @__PURE__ */ new Map();
  const allHits = [];
  for (const vault of targets) {
    const model = vault.db.models.getActive();
    if (!model) continue;
    const modelName = model.name;
    let queryVec = embedCache.get(modelName);
    if (!queryVec) {
      const embedResp = await ollama.embed({ model: modelName, texts: [query] });
      queryVec = embedResp.vectors[0];
      if (!queryVec) continue;
      embedCache.set(modelName, queryVec);
    }
    const semanticHits = vault.db.embeddings.searchSemantic(model.id, queryVec, fanK);
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
  const out = {
    hits: allHits.slice(0, topK),
    count: allHits.length
  };
  if (skipped.length > 0) {
    out.note = `Skipped vault(s) currently indexing: ${skipped.join(", ")}.`;
  }
  return out;
}
function handleSearchText(manager, activeVault, query, vaultFilter, topK, excludePaths) {
  const { targets, skipped } = resolveVaultTargets(manager, vaultFilter, activeVault);
  if (targets.length === 0) {
    return {
      hits: [],
      note: skipped.length > 0 ? `All eligible vaults are indexing; skipped: ${skipped.join(", ")}.` : "No vaults configured."
    };
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
  const out = {
    hits: allHits.slice(0, topK),
    count: allHits.length
  };
  if (skipped.length > 0) {
    out.note = `Skipped vault(s) currently indexing: ${skipped.join(", ")}.`;
  }
  return out;
}
async function handleSearchHybrid(manager, ollama, defaultModel, activeVault, query, vaultFilter, topK, rrfK, excludePaths, reranker) {
  const { targets, skipped } = resolveVaultTargets(manager, vaultFilter, activeVault);
  if (targets.length === 0) {
    return {
      hits: [],
      note: skipped.length > 0 ? `All eligible vaults are indexing; skipped: ${skipped.join(", ")}.` : "No vaults configured."
    };
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
  const out = {
    hits: filtered.slice(0, topK),
    count: filtered.length
  };
  if (skipped.length > 0) {
    out.note = `Skipped vault(s) currently indexing: ${skipped.join(", ")}.`;
  }
  return out;
}
function encodeNoteId(vault, path7) {
  return `${vault}:${path7}`;
}
function decodeNoteId(id) {
  const idx = id.indexOf(":");
  if (idx <= 0 || idx === id.length - 1) {
    throw new Error(`Invalid id: ${id}. Expected format <vault>:<vault-relative-path>.`);
  }
  return { vault: id.slice(0, idx), path: id.slice(idx + 1) };
}
function displayUrl(registry, vaultName, notePath) {
  const source = registry.resolveSource(parseSourceHandle(`obsidian-fs://${vaultName}`));
  const docId = formatDocId("obsidian-fs", vaultName, notePath);
  return source.formatDisplayUrl?.(docId) ?? `obsidian-fs://${vaultName}/${notePath}`;
}
async function handleSearchCompat(manager, registry, ollama, defaultModel, activeVault, query, limit, reranker) {
  const { targets, skipped } = resolveVaultTargets(manager, void 0, activeVault);
  if (targets.length === 0) {
    return {
      results: [],
      note: skipped.length > 0 ? `All eligible vaults are indexing; skipped: ${skipped.join(", ")}.` : "No vaults configured."
    };
  }
  const hits = await hybridSearch({
    query,
    embeddingModel: defaultModel,
    ollama,
    vaults: targets,
    topK: limit,
    rrfK: 60,
    includeBreakdown: false,
    reranker
  });
  const seen = /* @__PURE__ */ new Set();
  const results = [];
  for (const h of hits) {
    const noteKey = `${h.vault}:${h.notePath}`;
    if (seen.has(noteKey)) continue;
    seen.add(noteKey);
    results.push({
      id: encodeNoteId(h.vault, h.notePath),
      title: h.noteTitle ?? h.notePath,
      url: displayUrl(registry, h.vault, h.notePath),
      snippet: truncateSnippet(h.chunkText, 280)
    });
    if (results.length >= limit) break;
  }
  const out = { results };
  if (skipped.length > 0) {
    out.note = `Skipped vault(s) currently indexing: ${skipped.join(", ")}.`;
  }
  return out;
}
function truncateSnippet(text, max) {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1).trimEnd() + "\u2026";
}
function handleFetchCompat(manager, registry, id) {
  const { vault: vaultName, path: path7 } = decodeNoteId(id);
  const vault = manager.require(vaultName);
  const note = vault.db.notes.getByPath(path7);
  if (!note) {
    throw new Error(`Note not found: ${vaultName}/${path7}`);
  }
  const metadata = {
    vault: vaultName,
    path: note.path,
    mtime: note.mtime,
    hash: note.hash,
    word_count: note.word_count
  };
  if (note.frontmatter) {
    try {
      metadata.frontmatter = JSON.parse(note.frontmatter);
    } catch {
    }
  }
  return {
    id,
    title: note.title ?? note.path,
    text: note.content,
    url: displayUrl(registry, vaultName, note.path),
    metadata
  };
}
function handleVaultStats(manager, vaultFilter) {
  const targets = vaultFilter ? [manager.require(vaultFilter)] : manager.list();
  const stats = targets.map((v) => {
    const total_notes = v.db.notes.countAll();
    const wordRow = v.db.handle.prepare("SELECT SUM(word_count) AS total FROM notes").get();
    const lastRun = v.db.audit.listRuns(1)[0];
    const activeModel = v.db.models.getActive();
    return {
      vault: v.config.name,
      vault_path: v.config.path,
      total_notes,
      total_words: wordRow?.total ?? 0,
      embedding_model: activeModel?.name ?? v.config.embedding_model ?? null,
      indexed_at: lastRun?.finished_at ?? null,
      top_tags: aggregateTopTags(v.db.handle, 10),
      top_frontmatter_keys: aggregateTopFrontmatterKeys(v.db.handle, 10)
    };
  });
  if (vaultFilter) {
    return stats[0];
  }
  return { vaults: stats, count: stats.length };
}
function aggregateTopTags(db, limit) {
  const rows = db.prepare(
    `
      SELECT je.value AS tag, COUNT(*) AS count
      FROM notes
      JOIN json_each(json_extract(notes.frontmatter, '$.tags')) AS je
      WHERE notes.frontmatter IS NOT NULL
        AND json_type(notes.frontmatter, '$.tags') = 'array'
        AND typeof(je.value) = 'text'
      GROUP BY je.value
      ORDER BY count DESC, tag ASC
      LIMIT ?
    `
  ).all(limit);
  return rows;
}
function aggregateTopFrontmatterKeys(db, limit) {
  const rows = db.prepare(
    `
      SELECT je.key AS key, COUNT(*) AS count
      FROM notes
      JOIN json_each(notes.frontmatter) AS je
      WHERE notes.frontmatter IS NOT NULL
        AND json_type(notes.frontmatter) = 'object'
      GROUP BY je.key
      ORDER BY count DESC, key ASC
      LIMIT ?
    `
  ).all(limit);
  return rows;
}
function handleRecentNotes(manager, vaultFilter, limit, since) {
  const targets = vaultFilter ? [manager.require(vaultFilter)] : manager.list();
  const all = [];
  for (const v of targets) {
    const rows = since !== void 0 ? v.db.handle.prepare(
      "SELECT path, title, mtime, word_count, frontmatter FROM notes WHERE mtime > ? ORDER BY mtime DESC LIMIT ?"
    ).all(since, limit) : v.db.handle.prepare(
      "SELECT path, title, mtime, word_count, frontmatter FROM notes ORDER BY mtime DESC LIMIT ?"
    ).all(limit);
    for (const r of rows) {
      let tags = null;
      if (r.frontmatter) {
        try {
          const fm = JSON.parse(r.frontmatter);
          if (Array.isArray(fm.tags)) {
            tags = fm.tags.filter((t) => typeof t === "string");
          }
        } catch {
        }
      }
      all.push({
        vault: v.config.name,
        path: r.path,
        title: r.title,
        mtime: r.mtime,
        word_count: r.word_count,
        tags
      });
    }
  }
  all.sort((a, b) => b.mtime - a.mtime);
  return { notes: all.slice(0, limit), count: Math.min(all.length, limit) };
}
function handleSuggestFrontmatter(manager, parsed) {
  const vault = manager.require(parsed.vault);
  if (parsed.path) {
    const note = vault.db.notes.getByPath(parsed.path);
    if (!note) {
      throw new Error(
        `Note not found: ${parsed.vault}/${parsed.path}. Use draft mode ({content, folder_hint}) for unindexed notes.`
      );
    }
    const existingFm = note.frontmatter ? safeParseFrontmatter(note.frontmatter) : null;
    const result2 = suggestFrontmatter({
      vault,
      path: note.path,
      existingFrontmatter: existingFm,
      content: parsed.content ?? note.content,
      title: parsed.title ?? note.title ?? defaultBasename(note.path),
      excludePath: note.path
    });
    return {
      mode: "existing",
      path: note.path,
      ...result2
    };
  }
  const folderHint = normalizeFolderHint(parsed.folder_hint);
  const probePath = `${folderHint}__draft__${Date.now()}.md`;
  const result = suggestFrontmatter({
    vault,
    path: probePath,
    existingFrontmatter: null,
    content: parsed.content,
    title: parsed.title ?? "Draft",
    // Exclude the synthetic path explicitly — though it won't match any
    // existing note, this future-proofs against collisions.
    excludePath: probePath
  });
  return {
    mode: "draft",
    folder_hint: folderHint,
    note: "Draft mode: no backlinks contributed. Provide `path` (and index the note first) for richer neighbor-inference.",
    ...result
  };
}
function safeParseFrontmatter(s) {
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
function defaultBasename(path7) {
  const base = path7.split("/").pop() ?? path7;
  return base.replace(/\.md$/i, "");
}
function normalizeFolderHint(hint) {
  if (!hint) return "";
  let h = hint.trim();
  if (h.startsWith("/")) h = h.slice(1);
  if (h.length > 0 && !h.endsWith("/")) h = `${h}/`;
  return h;
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
var VERSION;
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
    init_schema3();
    init_obsidian_fs2();
    init_sentinel();
    init_memory();
    init_tools();
    init_audit3();
    init_obsidian_fs3();
    init_indexer2();
    init_tool_registry();
    init_registry();
    init_obsidian_fs();
    VERSION = "1.0.0";
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
  case "add-vault":
    await runAddVault(args.slice(1));
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
      const skipSuffix = result.notesSkipped > 0 ? `, ${result.notesSkipped} skipped` : "";
      console.error(
        `\u2713 ${vault.config.name}: ${result.notesIndexed} new, ${result.notesUpdated} updated, ${result.notesDeleted} deleted${skipSuffix}, ${result.chunksCreated} chunks \xB7 ${result.durationMs}ms`
      );
    } else {
      console.error(`\u2717 ${vault.config.name}: ${result.error}`);
      process.exitCode = 1;
    }
  }
  manager.closeAll();
}
async function runAddVault(rest) {
  const { addVault: addVault2 } = await Promise.resolve().then(() => (init_config(), config_exports));
  let path7 = null;
  let name;
  let writeEnabled = false;
  let skipIndex = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--name") {
      name = rest[i + 1];
      i++;
    } else if (arg === "--write" || arg === "--write-enabled") {
      writeEnabled = true;
    } else if (arg === "--no-index") {
      skipIndex = true;
    } else if (arg === "--help" || arg === "-h") {
      console.error(`Usage: vault-memory add-vault <path> [--name <name>] [--write] [--no-index]

Registers a vault in ~/.vault-memory/config.toml, writes a .mcp.json
into the vault root, and runs an initial index. Idempotent.`);
      return;
    } else if (arg && !arg.startsWith("--") && path7 === null) {
      path7 = arg;
    }
  }
  if (path7 === null) {
    console.error("Usage: vault-memory add-vault <path> [--name <name>] [--write] [--no-index]");
    process.exit(2);
  }
  console.error(`\u2192 Registering vault: ${path7}`);
  const result = await addVault2({ path: path7, name, writeEnabled });
  for (const step of result.steps) {
    switch (step.kind) {
      case "config-added":
        console.error(`  \u2713 config.toml: added [[vaults]] "${step.name}"`);
        break;
      case "config-already-registered":
        console.error(
          `  \u2022 config.toml: already registered as "${step.name}" (${step.existingPath})`
        );
        break;
      case "mcp-json-created":
        console.error(`  \u2713 ${step.mcpPath}: created`);
        break;
      case "mcp-json-merged":
        console.error(`  \u2713 ${step.mcpPath}: merged vault-memory entry`);
        break;
      case "mcp-json-unchanged":
        console.error(`  \u2022 ${step.mcpPath}: already up to date`);
        break;
    }
  }
  if (skipIndex) {
    console.error(`
Skipped indexing (--no-index). Run later:`);
    console.error(`  vault-memory index ${result.name}`);
  } else {
    console.error(`
\u2192 Building initial index for "${result.name}"\u2026`);
    await runIndex([result.name]);
  }
  console.error(
    `
Done. Open ${result.resolvedPath} in your MCP-aware client \u2014 the vault-memory MCP server will be available.`
  );
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
  add-vault <path>       Register a new vault end-to-end (config + .mcp.json + index)
    --name NAME            Override the auto-slugified name
    --write                Allow MCP write operations (default: read-only)
    --no-index             Skip the initial index (you can run it later)
  init                   Interactive config wizard (Phase 5 \u2014 not yet)
  help, --help           Show this message

CONFIG:
  ~/.vault-memory/config.toml`);
}
//# sourceMappingURL=cli.js.map