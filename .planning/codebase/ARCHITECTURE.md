<!-- refreshed: 2026-05-14 -->
# Architecture

**Analysis Date:** 2026-05-14

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                          MCP Tool Surface (23 tools)                     │
│                           src/server.ts  — serve()                       │
│                                                                          │
│  Search          Graph         Frontmatter    Write      Audit/Model     │
│  search_semantic list_back-    query_front-   write_note audit_log       │
│  search_text     links         matter         update_fm  index_runs      │
│  search_hybrid   list_forward  update_front-  delete_    list_models     │
│  search (OB1)    _links        matter         note       start_shadow_   │
│  fetch (OB1)     find_broken   suggest_front-            index           │
│  vault_stats     _links        matter                     switch_active_ │
│  recent_notes                                             model          │
│  list_vaults                                             vacuum_embed-   │
│  read_note                                               dings           │
└────────┬──────────────────────────────────────────────────────┬─────────┘
         │  tool handlers call domain modules directly          │
         ▼                                                       ▼
┌─────────────────────────────────┐   ┌────────────────────────────────────┐
│      Search Pipeline            │   │      Write Pipeline                │
│  src/search/hybrid.ts           │   │  src/write/write.ts                │
│  - hybridSearch()               │   │  - writeNote / deleteNote          │
│    1. embed query (Ollama)      │   │  - hash-based optimistic lock      │
│    2. semantic: sqlite-vec L2   │   │  - atomic FS write + DB upsert     │
│    3. BM25: FTS5                │   │  - onBeforeFsWrite suppression hook│
│    4. rrfMerge()                │   │  src/frontmatter/update.ts         │
│    5. optional: cross-encoder   │   │  - merge DSL ($set/$unset/$push/   │
│       rerank (ONNX or Ollama)   │   │    $pull) preserving body bytes    │
└────────┬────────────────────────┘   └────────────────────────────────────┘
         │                                                       │
         ▼                                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Vault Abstraction Layer                          │
│  src/vault/manager.ts — VaultManager (one Vault per configured vault)   │
│  interface Vault { config: VaultConfig; db: Database; dbPath: string }  │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     SQLite Database (per vault)                          │
│              ~/.vault-memory/vaults/<name>.db                           │
│  src/db/database.ts — Database class                                    │
│  ┌─────────────────┐ ┌───────────────────┐ ┌────────────────────────┐  │
│  │   Raw Layer      │ │   Derived Layer    │ │     Audit Layer        │  │
│  │ notes (TEXT)     │ │ embeddings_m<id>_  │ │ index_runs             │  │
│  │ chunks (TEXT)    │ │ d<dim> (vec0 virt) │ │ write_audit            │  │
│  │ wikilinks        │ │ models             │ │                        │  │
│  │ note_aliases     │ │ chunks_fts (fts5)  │ │                        │  │
│  └─────────────────┘ └───────────────────┘ └────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                  ▲
         ┌────────────────────────┘
         │
┌─────────────────────────────────────────────────────────────────────────┐
│                      Live Indexer Pipeline                               │
│  src/indexer/catchup.ts — catchupVault() at server start                │
│  src/watcher/watcher.ts — VaultWatcher (chokidar, DebouncedQueue)       │
│  src/indexer/single.ts — indexNote / removeNote (per-file ops)          │
│  src/indexer/indexer.ts — indexVault() (full/incremental batch runs)    │
│  src/indexer/shadow.ts — startShadowIndex() (parallel model backfill)   │
│                                                                          │
│  File Events → DebouncedQueue → indexNote(Reader→Chunker→Ollama→DB)    │
│  SuppressionSet: own writes suppressed before FS touch (TTL 2000ms)     │
└─────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       External Services                                  │
│  Ollama (HTTP) — src/ollama/client.ts: OllamaClient                     │
│    /api/embed — batch embedding generation + retry                      │
│    /api/tags  — model existence check                                   │
│  Filesystem (Obsidian vault) — watched by chokidar                      │
└─────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | Key Files |
|-----------|----------------|-----------|
| `serve()` | MCP bootstrap, tool registration, shutdown hooks | `src/server.ts` |
| `VaultManager` | Vault lifecycle: open DB, apply migrations, name→Vault map | `src/vault/manager.ts` |
| `Database` | SQLite wrapper: one handle + all query namespaces per vault | `src/db/database.ts` |
| `hybridSearch` | RRF fusion of semantic + BM25, optional rerank | `src/search/hybrid.ts` |
| `indexVault` | Full/incremental batch index: Reader→Chunker→Ollama→DB | `src/indexer/indexer.ts` |
| `catchupVault` | Hash-scan at server start to reconcile FS with DB | `src/indexer/catchup.ts` |
| `VaultWatcher` | chokidar file watcher → DebouncedQueue → indexNote | `src/watcher/watcher.ts` |
| `OllamaClient` | HTTP client for Ollama embed API with retry + batching | `src/ollama/client.ts` |
| `OnnxReranker` | True cross-encoder forward pass via onnxruntime-node | `src/rerank/onnx-reranker.ts` |
| `OllamaReranker` | L2-norm proxy reranker via Ollama /api/embed (legacy) | `src/rerank/reranker.ts` |
| `writeNote / deleteNote` | Atomic FS write + DB upsert with hash-based OCC | `src/write/write.ts` |
| `updateFrontmatter` | Merge-DSL frontmatter mutation preserving body bytes | `src/frontmatter/update.ts` |
| `suggestFrontmatter` | Three-layer schema inference pipeline | `src/schema/combiner.ts` |
| `queryFrontmatter` | SQL predicate filter over stored frontmatter JSON | `src/frontmatter/query.ts` |
| `startShadowIndex` | Background embedding backfill for a second model | `src/indexer/shadow.ts` |
| `SuppressionSet` | TTL set preventing own-write re-indexing loops | `src/watcher/suppression.ts` |

## Pattern Overview

**Overall:** Layered domain modules with a flat MCP dispatcher

**Key Characteristics:**
- Each `src/<domain>/` directory exposes a clean `index.ts` barrel; `server.ts` imports only from those barrels (not internal files)
- No shared global mutable state — each `Vault` struct carries its own `Database` instance; `SuppressionSet` is the only cross-vault shared object
- All persistence is SQLite via `better-sqlite3` (synchronous); async surfaces only at the Ollama HTTP boundary and FS operations
- The `Reranker` interface (`src/rerank/reranker.ts`) is the single adapter boundary where two concrete backends plug in: `OnnxReranker` (default) and `OllamaReranker` (legacy)

## Layers

**MCP Dispatcher Layer:**
- Purpose: Parse + validate tool inputs (Zod schemas), dispatch to handler functions, serialize responses as `{ content: [{type:"text", text: JSON}] }`
- Location: `src/server.ts`
- Contains: All Zod input schemas, `CallToolRequestSchema` switch, `ListToolsRequestSchema` registry, bootstrap/shutdown
- Depends on: all domain modules
- Used by: MCP SDK transport (stdio)

**Domain Logic Layer:**
- Purpose: Business logic per capability area, each module independently testable
- Location: `src/search/`, `src/indexer/`, `src/write/`, `src/frontmatter/`, `src/graph/`, `src/schema/`, `src/audit/`
- Contains: Pure functions and lightweight classes operating on `Vault` structs
- Depends on: `src/vault/`, `src/db/`, `src/ollama/`, `src/reader/`, `src/chunker/`, `src/rerank/`
- Used by: `src/server.ts` tool handlers

**Vault Abstraction Layer:**
- Purpose: Provide a single `Vault` struct (`{config, db, dbPath}`) as the unit of access for all domain code
- Location: `src/vault/manager.ts`
- Contains: `VaultManager` (name → Vault map), DB directory management
- Depends on: `src/db/`
- Used by: `src/server.ts`, `src/indexer/`, `src/watcher/`

**Database Layer:**
- Purpose: Type-safe query namespaces for each table; schema migrations; sqlite-vec extension loading
- Location: `src/db/`
- Contains: `Database` class, `NotesQueries`, `ChunksQueries`, `EmbeddingsQueries`, `FtsQueries`, `WikilinksQueries`, `ModelsQueries`, `AuditQueries`, `AliasesQueries`, `MIGRATIONS`
- Depends on: `better-sqlite3`, `sqlite-vec`
- Used by: `VaultManager`, all domain modules via `vault.db.*`

**Reader / Chunker Layer:**
- Purpose: Parse markdown files from disk into `ParsedNote`, split into `Chunk[]` for embedding
- Location: `src/reader/`, `src/chunker/`
- Contains: `scanVault`, `parseNote`, `extractWikilinks`, `sha256/computeNoteHash/computeBodyHash`; `chunkNote`, `countTokens`, heading extraction
- Depends on: `gray-matter` (frontmatter parse), Node.js `fs`
- Used by: `src/indexer/`

**Infrastructure Layer:**
- Purpose: Ollama HTTP client, config loader, watcher queue mechanics, FS utilities
- Location: `src/ollama/`, `src/config/`, `src/watcher/` (queue + suppression), `src/write/fs.ts`
- Contains: `OllamaClient` (batching, retry), `loadConfig` (TOML → AppConfig), `DebouncedQueue`, `SuppressionSet`, `atomicWriteFile`, `safeJoinInsideVault`
- Depends on: `smol-toml`, `chokidar`, Node.js `fs`, `zod`
- Used by: server bootstrap and domain modules

## Data Flow

### Primary Search Request (search_hybrid)

1. MCP call arrives → `HybridSearchArgs.parse(args)` validates input (`src/server.ts:794`)
2. `resolveVaultTargets()` determines target vaults: explicit filter → active-vault env → all; skips mid-index vaults (`src/server.ts:1079`)
3. `hybridSearch()` fans out to all targets in parallel (`src/search/hybrid.ts:155`)
4. Per vault: embed query once via `OllamaClient.embed()` (cached by model name); fire `embeddings.searchSemantic()` (sqlite-vec L2) and `fts.search()` (BM25 FTS5) in parallel
5. `rrfMerge()` fuses the two ranked lists by Reciprocal Rank Fusion (`src/search/hybrid.ts:102`)
6. Optional: `Reranker.score()` re-scores top `topK × rerankFanOut` candidates with cross-encoder; on error falls back to RRF order (`src/search/hybrid.ts:213`)
7. Global sort across vaults → hydrate chunk_id → `SearchHit[]` → JSON response

### Live Indexing Path

1. Server start: `catchupVault()` hash-scans FS vs DB; re-embeds changed notes; then `VaultWatcher.start()` (`src/server.ts:269–305`)
2. Chokidar fires `add`/`change`/`unlink` → `DebouncedQueue` coalesces within 500ms window (`src/watcher/queue.ts`)
3. Queue flush → check `SuppressionSet` for own-write suppression (`src/watcher/suppression.ts`)
4. `indexNote()`: `parseNote()` → `chunkNote()` → `OllamaClient.embed()` (primary model + optional shadow model in parallel) → DB transaction: `notes.upsert()`, `chunks.replace()`, `embeddings.insert()`, `wikilinks.replace()` (`src/indexer/single.ts`)
5. `index_runs` audit row records each run (`src/db/queries/audit.ts`)

### Write Path

1. `write_note` tool → `WriteNoteArgs.parse()` → `manager.require(vault)` → `suppression.add(path)` (pre-hook) → `writeNote()` (`src/write/write.ts`)
2. Hash-based OCC: if `expectedHash` present, read current file hash; mismatch → return `WriteConflict` immediately (no FS touch)
3. `atomicWriteFile()`: serialize frontmatter via `gray-matter`, write to temp file, `rename()` for atomicity (`src/write/fs.ts`)
4. DB upsert of note + re-chunk + re-embed (same indexNote pipeline)
5. `write_audit` row inserted with op, previous_hash, new_hash, client_id

### Schema Inference (suggest_frontmatter)

1. `SuggestFrontmatterArgs` validated; mode detected: existing-note (path) or draft (content)
2. `inferFromFolder()`: query notes in same folder, compute prevalence of each key + dominant value (`src/schema/folder-conventions.ts`)
3. `inferFromNeighbors()`: traverse wikilinks to/from note, same key+value prevalence on neighbors (`src/schema/neighbor-inference.ts`)
4. `inferFromContent()`: deterministic title/body pattern rules (date detection, type keywords, etc.) (`src/schema/content-heuristics.ts`)
5. `combineSuggestions()`: MAX confidence across agreeing sources; emit `conflicts` when sources disagree on value for same key (`src/schema/combiner.ts`)

**State Management:**
- No in-process state beyond the `VaultManager` map (loaded at startup) and `suppression` TTL set; all other state lives in SQLite

## Key Abstractions

**`Vault` struct:**
- Purpose: Unit of access for all per-vault operations; groups config + DB handle
- Definition: `src/vault/manager.ts:17` — `interface Vault { config: VaultConfig; db: Database; dbPath: string }`
- All domain functions accept `Vault` as parameter; never `Database` directly

**`Reranker` interface:**
- Purpose: Swap point between ONNX cross-encoder and legacy Ollama L2-norm proxy
- Definition: `src/rerank/reranker.ts:39` — `interface Reranker { score(query, chunks): Promise<number[]> }`
- Constructed once at server bootstrap; `undefined` when unconfigured (all rerank calls skip)

**`SearchHit` type:**
- Purpose: Common output shape for all search paths (semantic, text, hybrid)
- Definition: `src/types.ts:176`
- Includes `scoreBreakdown` with per-method scores for transparency

**Per-model embedding tables (`embeddings_m<id>_d<dim>`):**
- Purpose: Isolate embedding vectors by (modelId, dim) so multiple models coexist without interference; enables shadow-indexing and zero-downtime model promotion
- Management: `EmbeddingsQueries.ensureTableForModel()` creates on demand; `vacuumEmbeddings()` drops orphans
- Schema evolution: v1 used single `embeddings(FLOAT[1024])` → v4 per-dim → v5 per-model-per-dim (`src/db/queries/embeddings.ts:36`)

**OB1 adapter (`search` / `fetch` tools):**
- Purpose: Flat `{id, title, url, snippet}` shape for ChatGPT Custom Connectors, Claude.ai Deep-Research, and similar connector ecosystems
- `id` format: `<vault>:<vault-relative-path>` (human-readable, `:` is unambiguous separator)
- Backed by the full hybrid pipeline; de-duplicates to one entry per note
- Helpers: `encodeNoteId()`, `decodeNoteId()`, `obsidianUrl()` at `src/server.ts:1313`

## Entry Points

**MCP server (`serve()`):**
- Location: `src/server.ts:218`, called from `src/cli.ts:12`
- Triggers: `npx vault-memory serve` / Claude Desktop MCP config
- Responsibilities: load config, open all vault DBs, construct Ollama + Reranker, register all 23 tools, connect stdio transport, fire-and-forget catch-up + watchers

**CLI wrapper:**
- Location: `src/cli.ts`
- Commands: `serve` (default), `index [--vault <n>] [--full]`, `add-vault`
- Dynamically imports domain modules to avoid eager-loading on every subcommand

**Built binary:**
- Location: `dist/cli.js` (tsup bundle, single ESM file, shebang `#!/usr/bin/env node`)
- Registered as `bin.vault-memory` in `package.json`

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop. All SQLite calls are synchronous (`better-sqlite3`). Async concurrency only at Ollama HTTP and FS boundaries. Shadow indexing runs on the same event loop — large vaults block during embed batches.
- **Global state:** `SuppressionSet` instance in `server.ts` is shared across all vault watchers. `VaultManager.vaults` Map is module-level but wrapped in the class.
- **Circular imports:** None detected. Domain modules import only from `../vault/`, `../db/`, `../ollama/`, `../reader/`, `../chunker/`, `../rerank/`, `../types.js` — never from peer domain modules or upward from `server.ts`.
- **ESM-only:** `"type": "module"` in `package.json`; all imports use `.js` extensions (ESM resolution); `tsconfig.json` `moduleResolution: "Bundler"`.
- **sqlite-vec extension:** Must be loaded before any `vec0` virtual table DDL. `Database` constructor calls `loadSqliteVec()` before `migrateInternal()` (`src/db/database.ts:43–46`). Platform-specific prebuilt binary required.
- **Mid-index vault skip:** `resolveVaultTargets()` checks `audit.isIndexing()` and excludes vaults from implicit fan-out; explicit `vaults:` filter bypasses this (`src/server.ts:1079`).
- **Write guard:** `write_enabled` flag per vault config; `writeNote`/`deleteNote`/`updateFrontmatter` check it and return `{ok:false, reason:"permission_denied"}` (`src/write/write.ts`).

## Anti-Patterns

### Calling DB query objects from outside the `db.*` namespace

**What happens:** Accessing `vault.db.handle.prepare(...)` directly in handler code (done in `handleVaultStats`, `handleRecentNotes` in `src/server.ts:1460–1596`)
**Why it's wrong:** Bypasses the query-class abstraction; SQL leaks into the handler layer; harder to test and migrate
**Do this instead:** Add a method to the appropriate `*Queries` class (e.g. `NotesQueries.sumWords()`) and call `vault.db.notes.sumWords()`

### Using `OllamaReranker` as default backend

**What happens:** Pre-v0.8.0 code routes reranking through `OllamaReranker` (L2-norm proxy)
**Why it's wrong:** Not a true cross-encoder; scores are noisy proxies
**Do this instead:** Omit `reranker_backend` in config (defaults to `"onnx"` when `reranker_model` is set); the server bootstrap already prefers `OnnxReranker` (`src/server.ts:244`)

## Error Handling

**Strategy:** Structured return types for expected failures; thrown errors for programming mistakes

**Patterns:**
- Write operations return discriminated unions: `WriteResult = WriteSuccess | WriteConflict`, `UpdateResult = UpdateSuccess | UpdateConflict` — callers check `.ok` before destructuring
- Search / read paths throw on unknown vault (`manager.require()` throws with helpful message); caught by the outer `try/catch` in `CallToolRequestSchema` handler → `errorResponse(message)`
- Ollama calls: `OllamaClient` retries 3× on transient errors; throws `OllamaHttpError` on 4xx/5xx after exhausting retries
- Reranker failures are silently swallowed in `hybridSearch` — falls back to RRF order and clears any partial `rerankScore`
- MCP response wrapping: `ok(data)` serializes to `{content:[{type:"text", text: JSON}]}`; `errorResponse(msg)` sets `isError: true`

## Cross-Cutting Concerns

**Logging:** All operational logs go to `process.stderr` via `process.stderr.write(...)`. No logging framework. Prefix convention: `[catchup:<vault>]`, `[watcher]`, `[shadow:<vault>]`.

**Validation:** Zod schemas at the MCP boundary (`server.ts` input schemas). Config validated by Zod at load time (`src/config/loader.ts`). No runtime validation inside domain modules — inputs are trusted after the MCP parse.

**Hash-based concurrency control:** SHA-256 of `content + canonicalJson(frontmatter)` stored as `notes.hash`. Write operations compare `expectedHash` to current on-disk hash before any mutation — provides optimistic concurrency without transactions spanning tool calls.

---

*Architecture analysis: 2026-05-14*
