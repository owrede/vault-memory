# Codebase Concerns

**Analysis Date:** 2026-05-14

---

## Raw File-Path Operations Outside the Expected Adapter Boundary

The v2 refactor will extract an `obsidian-fs` adapter. The "allowed" modules for raw
`path.*` / `fs.*` operations are: `src/reader/`, `src/indexer/`, `src/write/`,
`src/watcher/`. The following files that sit **outside** those boundaries contain raw
filesystem operations today:

| File | Count | Operations |
|------|-------|------------|
| `src/config/add-vault.ts` | 4 | `fs.writeFile` (×3), `fs.readFile`, `fs.mkdir`, `fs.appendFile`, `fs.stat`, `join`, `resolve`, `basename` |
| `src/rerank/onnx-reranker.ts` | 3 | `existsSync` (×2), path join for model + tokenizer files |
| `src/frontmatter/update.ts` | 1 | `fs.readFile` (line 237) — reads the note to get current content before merging |

**Notes:**
- `src/config/add-vault.ts` performs direct `fs.writeFile` to `~/.vault-memory/config.toml`
  and `<vault>/.mcp.json`. These are config-layer writes, not vault-content writes, so the
  path-safety guard (`safeJoinInsideVault`) does **not** protect them. The config path is
  user-supplied; no traversal validation is present for the config file itself.
- `src/rerank/onnx-reranker.ts` uses `existsSync` against caller-supplied `modelDir` /
  `tokenizerPath` without any boundary checks. An attacker with control of config could
  probe the filesystem.
- `src/frontmatter/update.ts` uses `fs.readFile` but delegates path-safety to
  `safeJoinInsideVault` (called two lines above). Safe for now, but architecturally should
  be absorbed by the write adapter.

---

## Chokidar Import Boundary

**Finding: clean.** `chokidar` is imported in exactly one file:

- `src/watcher/watcher.ts` (lines 15–16)

No leaks detected. The boundary is correct.

---

## YAML Frontmatter Operations Outside `src/frontmatter/`

`gray-matter` (the YAML parser) is imported directly in:

| File | Imports `matter` from `gray-matter` | Usage |
|------|--------------------------------------|-------|
| `src/reader/parser.ts` | Yes (line 3) | Parses raw markdown on ingest — this is intentional and belongs here |
| `src/write/write.ts` | Yes (line 13) | `matter(raw)` to read existing file hash before write; `matter.stringify` for serialization |
| `src/frontmatter/update.ts` | Yes (line 24) | Core frontmatter edit path — expected |

**Concern:** `src/write/write.ts` bypasses `src/frontmatter/` entirely for YAML
parsing/serialization. If the YAML library is ever swapped or a custom parse option added,
two code paths must be updated. A v2 refactor should unify this into a single `parseNote`
call from the reader adapter rather than re-importing `gray-matter` in the write module.

`src/reader/parser.ts` also has a hardcoded Obsidian-specific default exclude in
`src/reader/scanner.ts` (line 8: `DEFAULT_EXCLUDES = [".obsidian/**", ...]`). This is an
Obsidian assumption baked into the scanner rather than passed as config from a vault
definition.

---

## Obsidian-Specific Concept Leakage

### `obsidian://` URL Generation in `src/server.ts`

The function `obsidianUrl()` at `src/server.ts:1333` generates `obsidian://open?vault=...`
deep-links. This is an Obsidian-specific URL scheme that has leaked into the server layer.
It is called from `handleSearchCompat()` (line 1389) and embedded in tool output returned
to any MCP client. A non-Obsidian MCP client receives Obsidian deep-links it cannot use.

**Fix approach:** Move to a `formatNoteUrl()` abstraction that is vault-adapter-specific,
or make the URL scheme configurable per vault in `config.toml`.

### Hardcoded `.obsidian/**` in Scanner

`src/reader/scanner.ts` line 8 hardcodes `.obsidian/**`, `.trash/**` in `DEFAULT_EXCLUDES`.
These are Obsidian-specific system directories. For a generic markdown adapter, these would
not exist and the defaults are misleading.

### Wikilinks are a First-Class Schema Concept

The `wikilinks` table (`src/db/schema.ts:103`), `WikilinksQueries` (`src/db/queries/wikilinks.ts`),
and wikilink resolver (`src/indexer/resolver.ts`) are all deeply embedded in the core DB
layer — not isolated in a reader/graph module. The v2 adapter extraction will need to treat
wikilinks as an optional graph capability rather than a required schema concern.

### `.canvas` Files

No `.canvas` file handling was found leaking outside `src/reader/`. Scanner ignores `.canvas`
files silently (only `.md` files are indexed — `src/reader/scanner.ts:55`). Canvas files
are absent from the schema. This is acceptable today but worth noting: canvas wikilinks are
invisible to the graph.

---

## Claude-Specific Strings (MCP-Client-Agnosticism Debt)

The codebase has several Claude-specific hardcodings that violate the stated goal of being
MCP-client-agnostic:

| File | Line | Content |
|------|------|---------|
| `src/write/write.ts` | 52, 76 | `/** For audit_log entry. Defaults to "claude-code". */` and `const DEFAULT_CLIENT_ID = "claude-code"` |
| `src/cli.ts` | 107 | Comment: `"2. write/merge .mcp.json in the vault root (so Claude Code can…)"` |
| `src/cli.ts` | 186 | User-facing message: `"Open ${result.resolvedPath} in Claude Code — the vault-memory MCP server will be available."` |
| `src/config/add-vault.ts` | 5, 9 | Doc comments reference Claude Code specifically |
| `src/config/add-vault.ts` | 61 | `DEFAULT_EXCLUDE_GLOBS` includes `".claude/**"` — a Claude Code-specific directory |
| `src/server.ts` | 168 | Tool description: `"OB1-compatible … (ChatGPT Custom Connectors, Claude.ai, Deep-Research)"` — acceptable as feature description, not a hardcoding |

**Most impactful:** `DEFAULT_CLIENT_ID = "claude-code"` in `src/write/write.ts:76` means
every audit log entry from any MCP client defaults to `"claude-code"` unless the caller
explicitly passes `client_id`. Any agent using `write_note` without providing `client_id`
will have its audit trail attributed to Claude Code regardless of what client it actually is.

**Fix approach:** Change `DEFAULT_CLIENT_ID` to `"unknown"` or `"mcp-client"`, and update
the CLI message and exclude glob to be tool-agnostic.

---

## SQLite Migration Story

**Approach:** Migrations are inlined as TypeScript constants in `src/db/schema.ts` (no
external `.sql` files, no `migrations/` directory). The runner in `src/db/database.ts`
applies all migrations with `version > PRAGMA user_version` in order, wraps them in a
single transaction, then sets `user_version` to the highest applied version.

**Current version:** 6 migrations shipped (v1–v6). The v1 `[Unreleased]` section is empty.

### Adding `doc_uri` Columns Safely

To add `doc_uri` to the `notes` table (v2 roadmap), the pattern is:

```typescript
// In src/db/schema.ts, append to MIGRATIONS:
const MIGRATION_007_DOC_URI = `
ALTER TABLE notes ADD COLUMN doc_uri TEXT;
CREATE INDEX IF NOT EXISTS idx_notes_doc_uri ON notes(doc_uri);
`;
// Then push: { version: 7, description: "add doc_uri for adapter source tracking", sql: MIGRATION_007_DOC_URI }
```

**Risk:** The migration runner disables FK enforcement during the transaction
(`src/db/database.ts:99`) and re-enables it after, with a `PRAGMA foreign_key_check` post-
migration. `ALTER TABLE ADD COLUMN` is safe for new nullable columns; no rebuild needed.
Existing rows get `NULL` for `doc_uri`, which is correct for the lazy-fill pattern already
used by `body_hash` (migration 006).

**No backup before migration:** `src/db/database.ts:19` comments "future async hooks
(e.g. migration backups)" but the current implementation just wraps the constructor.
If a migration fails mid-transaction, SQLite rolls back cleanly, but there is no pre-
migration DB snapshot. For a production v2 release with data-destructive migrations
(schema rebuilds like v5), a backup step before apply would reduce risk.

---

## Embedding Table Per-Model Design and Orphan Cleanup

**Pattern:** Each `(modelId, dim)` pair gets its own `sqlite-vec` virtual table named
`embeddings_m<modelId>_d<dim>` (e.g. `embeddings_m1_d1024`). Tables are created lazily on
first use via `EmbeddingsQueries.ensureTableForModel()` (`src/db/queries/embeddings.ts:64`).

**Orphan table risk:** When a model is deregistered (not currently supported via MCP
tooling) or when `vacuum_embeddings` is called, **the vec0 table itself is never dropped**.
`vacuumEmbeddings` (`src/indexer/vacuum.ts`) deletes orphan *rows* from existing tables but
does not clean up tables whose model has zero rows. The `models` table has no `DELETE`
path — `ModelsQueries` (`src/db/queries/models.ts`) exposes only `upsert` and `setActive`.
Over time (e.g. after repeated `switch_active_model` + `vacuum_embeddings` cycles), old
per-model tables accumulate as schema clutter.

**Impact:** Empty vec0 tables incur no query overhead, but they inflate DB file size and
appear in `sqlite_master` listings, confusing diagnostic tooling.

**Fix approach:** Add a `vacuum_embeddings` cleanup phase that `DROP TABLE`s any
`embeddings_m<id>_d<dim>` where all rows have been removed and the model is not active.

---

## TODOs / FIXMEs / XXXs in `src/`

**Count: 0** — no `TODO`, `FIXME`, `HACK`, or `XXX` annotations were found in any
`.ts` file under `src/`. Code comments that reference "Codex MEDIUM-1" and "Codex MEDIUM-3"
are design notes (not stubs) and have been implemented.

---

## `docs/optimization-todos/` Roadmap Items

### 001 — Datacore-Sidecar-Indexing (`planned`)

**Problem:** Notes with `datacorejsx`/`dataviewjs`/`datacorets` code blocks are
systematically underrepresented in hybrid search. The Eval-v3 result showed `LAG-EPIX.md`
MOC not appearing in Top-10 for "Was ist LAG-EPIX" because most chunks were code-block
boilerplate.

**Required vault-memory changes (`src/reader/parser.ts`, `src/indexer/single.ts` or new
`src/indexer/incremental.ts`, `src/db/schema.ts`):**
- `parseNote()` must check for `<note>.rendered.md` sidecars and merge their content.
- Schema needs `last_indexed_at INTEGER` and `sidecar_mtime_at_index INTEGER` columns
  (migration 007 or 008).
- `path_exclude_glob` in the config must exclude `*.rendered.md` to prevent sidecars from
  being indexed as standalone notes.

**Status:** Spec complete, implementation not started. No blocking issues for v2 refactor,
but the sidecar path lookup in `parseNote()` will need to be adapted if the reader becomes
an adapter interface.

---

## CHANGELOG `[Unreleased]` — WIP Items

The current `[Unreleased]` section is empty (`_Nothing yet._`). No in-flight work is
signaled in CHANGELOG. The v1.0.0 stability declaration was a pure version bump with no
code changes. The codebase is in a clean state relative to the last release.

The doc header in `src/server.ts` (lines 3–12) is stale: it still reads
`"Phase 3 will add: write_note, update_frontmatter, audit_log"` — those tools were shipped
in v0.x. This comment should be updated to reflect the current tool set.

---

## Security Considerations

### Path Traversal on Write Operations

**`write_note` / `delete_note` / `update_frontmatter`:**
All three call `safeJoinInsideVault()` (`src/write/fs.ts:72`) before touching the
filesystem. The guard:
1. Rejects absolute paths.
2. Performs a string-prefix check against the vault root + separator.
3. Follows symlinks via `fs.realpath` to defeat symlink-escape attacks.

**Assessment: safe for vault-content writes.**

**`src/config/add-vault.ts`:** The `mcpPath` is constructed as `join(resolvedPath, ".mcp.json")`
where `resolvedPath = resolve(opts.path)`. The vault path comes from the user's config or
CLI arg; there is no equivalent of `safeJoinInsideVault` here. An attacker who can control
`opts.path` could write `.mcp.json` to an arbitrary absolute path. In practice this requires
process-level access (the CLI is run by the vault owner), so this is a low-severity concern,
but it is architecturally different from the vault-write path.

### SQL Injection

All DB operations use `better-sqlite3` prepared statements with `?` placeholders. No user-
supplied strings are interpolated into SQL query bodies **except** in the following
internal-only cases where table names are constructed from controlled integer values:

- `src/db/schema.ts:332` — `db.exec(\`DROP TABLE ${name}\`)` — `name` is read from
  `sqlite_master` WHERE clause filtered by pattern, not from user input. Safe.
- `src/db/schema.ts:347` — `db.exec(\`CREATE VIRTUAL TABLE ${newName}...\`)` — `newName`
  is constructed as `` `embeddings_m${modelId}_d${dim}` `` where both values are integers
  validated by `Number.isInteger()`. Safe.
- `src/db/queries/embeddings.ts:72` — same integer-only table name. Safe.
- `src/indexer/vacuum.ts:52` — table name from `models` registry, integer-validated. Safe.

**FTS5 query injection:** `FtsQueries.sanitize()` (`src/db/queries/fts.ts:99`) strips
quotes, colons, and unbalanced parens before passing the user query to the `MATCH`
operator. This is defense-in-depth; the `MATCH` query itself uses a prepared statement
`WHERE chunks_fts MATCH ?` (line 42), so the sanitized string is still passed as a
parameter, not interpolated. Safe.

**Assessment:** No SQL injection vectors found. The pattern of integer-validated table
names for embedding tables is sound but fragile — adding model registration from an
untrusted source in the future would need to re-validate this assumption.

### Inline Hashtag Tags Not Indexed

`aggregateTopTags()` in `src/server.ts:1504` reads tags only from `frontmatter.tags` (YAML
array). Inline `#hashtag` annotations in note bodies are silently ignored, acknowledged in a
comment at line 1493. This means `vault_stats` and any downstream tag-based filtering under-
counts notes that use only inline hashtags. This is a known gap, not a security issue, but
affects correctness of the `vault_stats` tool output.

---

## Performance Bottlenecks

### `src/server.ts` — 1744 Lines, All Logic in One File

The server file handles: tool dispatch (23 tools), helper functions, SQL aggregation,
Obsidian URL building, OB1 adapter compatibility, `suggestFrontmatter` orchestration, and
startup/shutdown. This is the single largest file (`1744` lines vs. next largest `508` for
a test file). Any change to a tool handler requires loading the full file into context.

**Impact:** Architectural friction for v2 refactor. Tool handlers should be extracted into
per-domain handler modules (e.g. `src/server/handlers/search.ts`).

### `serializeVector` Uses JSON Strings

`src/db/queries/embeddings.ts:198` serializes embedding vectors as JSON strings
(`JSON.stringify(v)`) rather than raw `Float32Array` BLOBs. The comment acknowledges this
and suggests switching to binary for performance. For 1024-dim vectors this means ~5KB of
JSON text per insert instead of 4KB binary. At high-throughput indexing (full vault rebuild)
this is measurable overhead.

### No Pre-Migration DB Backup

As noted above, migrations run against the live DB file without a prior backup. For
large vaults (100K+ chunks), a failed migration that partially executes before a crash
could require manual recovery. The constructor comment (`src/db/database.ts:19`) acknowledges
this as a future hook.

---

## Fragile Areas

### `insertWikilinks` Duplicated in Two Files

The function `insertWikilinks` is defined independently in both:
- `src/indexer/indexer.ts:361`
- `src/indexer/single.ts:332`

Both implementations are structurally identical (map wikilinks, call `resolveWikilinkTarget`,
call `vault.db.wikilinks.insertBatch`). Any bug fix or behavioral change must be applied
in both places. This is a silent divergence risk that will surface when the wikilink
resolution logic evolves (e.g. adding support for block references or aliases in v2).

**Fix approach:** Extract into a shared `src/indexer/wikilinks-insert.ts` helper.

### Migration 005 Reads Controlled-But-Dynamic Table Names

`runMigration005` in `src/db/schema.ts:298` queries `sqlite_master` to discover existing
`embeddings_<dim>` tables and then runs `DROP TABLE ${name}` and `CREATE VIRTUAL TABLE ${newName}`.
The table names are validated by regex before use, but the pattern `db.exec()` with
interpolated names is architecturally fragile compared to parameterized queries. If the
regex ever softens (e.g. to include schema names), this becomes an injection vector.

### `SuppressionSet` TTL Race

`src/watcher/watcher.ts` suppresses re-indexing events triggered by the server's own atomic
writes via `SuppressionSet` (TTL = 2000ms, `src/server.ts:262`). If the filesystem event
for a write arrives **after** the suppression TTL expires (e.g. on a heavily loaded system
or a slow antivirus scan), the watcher will re-index the just-written note unnecessarily.
This is harmless for data consistency (the re-index will produce the same result) but wastes
CPU and can cause spurious embedding regeneration.

---

## Missing Critical Features / Gaps

### No Model Deregistration / Table Cleanup

The `models` table is append-only. There is no MCP tool or CLI command to remove a model
registration or drop its embedding table. After `switch_active_model`, the old model's
`embeddings_m<id>_d<dim>` table persists indefinitely with its data. `vacuum_embeddings`
removes orphan rows but not the table itself.

### Inline Hashtag Search

`aggregateTopTags` and the broader tag infrastructure (`query_frontmatter` + `vault_stats`)
only index YAML `tags:` arrays. Inline `#hashtag` tokens in note bodies are invisible.
This is a documented limitation but not gated — callers receive incomplete results without
any warning.

### Sidecar Indexing for Datacore/Dataview Notes

As documented in `docs/optimization-todos/001-datacore-sidecar-indexing.md`, notes with
Datacore/Dataview code blocks are semantically underrepresented. The spec is written; the
code is not. No `last_indexed_at` column exists in `notes` yet (required for the mtime-
based re-index trigger).

---

## Test Coverage Gaps

### No Tests for `src/config/add-vault.ts` Path-Escape Edge Cases

`src/config/add-vault.ts` writes to `<vault_path>/.mcp.json` and `~/.vault-memory/config.toml`.
There is a test file (`src/config/add-vault.test.ts`) but it does not include tests for
path traversal in `opts.path` (e.g. `../../../../etc/cron.d`). The `resolve()` call
canonicalizes the path but there is no boundary check equivalent to `safeJoinInsideVault`.

- Files: `src/config/add-vault.ts`, `src/config/add-vault.test.ts`
- Risk: Low in practice (CLI requires local execution), but could matter for programmatic
  API callers.
- Priority: Low

### No Integration Test for Migration Rollback

The migration runner wraps all migrations in a single transaction and relies on SQLite's
rollback on error. There are no tests that verify the DB is left in a consistent state if
a migration partially fails. The `src/db/database.test.ts` tests happy-path migration
scenarios.

- Files: `src/db/database.ts`, `src/db/database.test.ts`
- Risk: Medium — a botched v2 migration could corrupt production vault DBs silently.
- Priority: Medium, especially before shipping migration 007+.

### No Test for Suppression Set TTL Race

The watcher suppression TTL edge case (event arrives after 2s TTL expires) is untested.
`src/watcher/watcher.test.ts` uses a real chokidar watcher with real timers but does not
simulate delayed filesystem events.

- Files: `src/watcher/watcher.ts`, `src/watcher/watcher.test.ts`
- Priority: Low

---

*Concerns audit: 2026-05-14*
