# External Integrations

**Analysis Date:** 2026-05-14

## APIs & External Services

**Local Ollama HTTP API:**
- Ollama — embedding generation for all vault notes
  - SDK/Client: custom `OllamaClient` class at `src/ollama/client.ts`
  - Default endpoint: `http://localhost:11434` (configurable via `ollama_endpoint` in `~/.vault-memory/config.toml`)
  - Endpoints used:
    - `POST /api/embed` — batch embedding generation (default batch size 10, configurable)
    - `GET /api/tags` — health check and model enumeration
  - Retry policy: 3 attempts, exponential backoff, retries on HTTP 5xx and `AbortError` (timeout) and `TypeError` (network failure)
  - Timeout: 30 seconds per request (AbortController-based)
  - Default embedding model: `qwen3-embedding:0.6b` (overridable per-vault via `embedding_model` config key, or globally via `default_embedding_model`)

**No cloud APIs:** This product has no outbound calls to any cloud service. All intelligence is local.

**No telemetry:** No analytics, error reporting, or usage data is sent anywhere.

## Data Storage

**Databases:**
- SQLite (via `better-sqlite3 ^11.7.0`)
  - One file per configured vault: `~/.vault-memory/vaults/<name>.db`
  - Connection: path constructed from `homedir()` + vault name at `src/vault/manager.ts`
  - Client: `better-sqlite3` synchronous driver, wrapped by `Database` class at `src/db/database.ts`
  - Extensions: `sqlite-vec` loaded at construction time via `sqliteVec.load(db)` — provides `vec0` virtual tables for ANN vector search
  - WAL mode enabled for all non-`:memory:` databases
  - Schema version tracked via `PRAGMA user_version`; 6 migrations defined in `src/db/schema.ts`

**Schema tables:**
- `notes` — raw layer: path, content, frontmatter (JSON), hash, body_hash, mtime, word_count
- `chunks` — note segments for embedding-sized windows (token-based chunking)
- `embeddings_m<modelId>_d<dim>` — sqlite-vec `vec0` virtual tables, one per model+dimension combination (e.g. `embeddings_m1_d1024`)
- `models` — registry of embedding models with active flag
- `chunks_fts` — FTS5 virtual table for BM25 full-text search; kept in sync with `chunks` via SQL triggers
- `wikilinks` — parsed wikilink graph (`[[...]]` links between notes)
- `note_aliases` — frontmatter `aliases:` array for wikilink resolution
- `index_runs` — audit log of indexing operations
- `write_audit` — MCP write operation trail (create/update/delete with hashes)

**File Storage:**
- Obsidian vault markdown files on local filesystem (read and optionally write)
- ONNX reranker model files: `~/.vault-memory/models/bge-reranker-v2-m3/model_quantized.onnx` (INT8-quantized, ~570 MB) and `tokenizer.json` (~17 MB); downloaded by `scripts/download-reranker.sh` from HuggingFace

**Caching:**
- In-memory query embedding cache per search call (keyed by model name, in `handleSearchSemantic` / `handleSearchHybrid`)
- ONNX session and tokenizer lazily loaded and cached in `OnnxReranker.loaded` field after first use

## Authentication & Identity

**Auth Provider:** None — fully local, no user accounts, no tokens
- Configuration is a plain TOML file at `~/.vault-memory/config.toml`
- Write operations require `write_enabled: true` per vault in config plus an `expected_hash` for safe overwrites (optimistic concurrency control)
- No network-based authentication anywhere in the codebase

## MCP Protocol Surface

**Transport:**
- Stdio (`StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`)
- The server reads from stdin and writes to stdout; all diagnostic output goes to stderr
- Protocol: JSON-RPC 2.0 over MCP SDK (`@modelcontextprotocol/sdk ^1.0.4`)

**23 Public MCP Tools:**

| Tool | Category | Description |
|------|----------|-------------|
| `list_vaults` | Metadata | List configured vaults with note counts and last run |
| `read_note` | Read | Full content + frontmatter by vault-relative path |
| `search_semantic` | Search | Embedding cosine similarity via sqlite-vec |
| `search_text` | Search | BM25 full-text via SQLite FTS5 |
| `search_hybrid` | Search | RRF fusion of semantic + BM25, optional cross-encoder rerank |
| `list_backlinks` | Graph | Notes that link TO a given note |
| `list_forward_links` | Graph | Wikilinks FROM a given note |
| `find_broken_links` | Graph | Wikilinks pointing to non-existent notes |
| `query_frontmatter` | Query | Filter notes by YAML frontmatter predicates |
| `write_note` | Write | Atomic create/overwrite (requires `write_enabled`) |
| `update_frontmatter` | Write | Merge-patch frontmatter only, body preserved |
| `delete_note` | Write | Delete with required `expected_hash` guard |
| `audit_log` | Audit | Query write audit trail |
| `list_models` | Indexing | List registered embedding models for a vault |
| `start_shadow_index` | Indexing | Backfill a secondary embedding model without disrupting live search |
| `switch_active_model` | Indexing | Atomically promote shadow model to active |
| `vacuum_embeddings` | Indexing | Drop orphaned embedding rows |
| `index_runs` | Audit | Recent indexing operation history |
| `search` | Compat | OB1/ChatGPT/Claude.ai-compatible flat `{id, title, url, snippet}` results |
| `fetch` | Compat | OB1-compatible fetch by opaque id (`<vault>:<path>`) |
| `vault_stats` | Orientation | Note/word counts, top tags, top frontmatter keys |
| `recent_notes` | Orientation | Recently modified notes by mtime |
| `suggest_frontmatter` | Inference | Three-layer frontmatter suggestions (folder conventions, neighbor inference, content heuristics) |

## Filesystem — Obsidian Vault

**Vault access:**
- Read: notes parsed from filesystem using `gray-matter` for frontmatter + wikilink extraction (`src/reader/`)
- Write: atomic write via temp file + rename (`src/write/`); suppression set prevents watcher re-index loops
- Watch: `chokidar ^4.0.1` monitors vault directory for `.md` file changes (`src/watcher/watcher.ts`)
  - Debounce: 500 ms default, max latency 5 seconds
  - Ignores: hidden files, `*.tmp.*` atomic write artifacts, user-configured `exclude_globs`
  - `awaitWriteFinish` stability threshold: 200 ms, poll interval 50 ms
  - Follows symlinks: disabled
- Note format: Obsidian markdown with optional YAML frontmatter (`---` delimited), `[[wikilink]]` syntax

**Vault registration:**
- `add-vault` CLI subcommand registers vault in `~/.vault-memory/config.toml` and writes/merges `.mcp.json` into the vault root (`src/config/add-vault.ts`)

## ONNX Reranker — BAAI/bge-reranker-v2-m3

**Model:**
- Source: `onnx-community/bge-reranker-v2-m3-ONNX` on HuggingFace
- Format: INT8-quantized ONNX (`model_quantized.onnx`, ~570 MB)
- Tokenizer: XLM-RoBERTa (`tokenizer.json`, ~17 MB)
- Local path: `~/.vault-memory/models/bge-reranker-v2-m3/` (override via `reranker_model_dir` config)

**Integration:**
- Implemented in `src/rerank/onnx-reranker.ts` (`OnnxReranker` class)
- Runtime: `onnxruntime-node ^1.26.0` + `@huggingface/tokenizers ^0.1.3`, both lazy-loaded on first `score()` call
- Session creation: `ort.InferenceSession.create(modelPath)` — loads model into memory once, reused per server lifetime
- Tokenization: `tokenizer.encode(query, { text_pair: chunk })`, truncated to `maxLength` (default 512 tokens)
- Output: sigmoid of single logit per (query, document) pair → relevance score in [0, 1]
- Config keys: `reranker_backend = "onnx"` (default when `reranker_model` is set), `reranker_model_dir`

**Activation:**
- Only constructed when `reranker_model` is set in `~/.vault-memory/config.toml`
- Only invoked when `search_hybrid` is called with `rerank: true`
- Legacy fallback: `OllamaReranker` (L2-norm proxy via `/api/embed`) available when `reranker_backend = "ollama"`

## Webhooks & Callbacks

**Incoming:** None

**Outgoing:** None

## Environment Configuration

**Config file:** `~/.vault-memory/config.toml` (TOML; auto-created with defaults on first run)

**Required config for operation:**
```toml
[[vaults]]
name = "my-vault"
path = "/path/to/obsidian/vault"

[server]
# ollama_endpoint defaults to http://localhost:11434
# default_embedding_model defaults to "qwen3-embedding"
```

**Optional config keys:**
- `server.ollama_endpoint` — override Ollama base URL
- `server.default_embedding_model` — fallback model when vault has no `embedding_model`
- `server.reranker_model` — enable reranking (e.g. `"bge-reranker-v2-m3"`)
- `server.reranker_backend` — `"onnx"` (default) or `"ollama"`
- `server.reranker_model_dir` — path to ONNX model directory
- `server.log_level` — `"debug"` | `"info"` | `"warn"` | `"error"`
- Per-vault: `embedding_model`, `secondary_embedding_model`, `write_enabled`, `exclude_globs`

**Env vars:**
- `VAULT_MEMORY_ACTIVE_VAULT` — name of vault to scope default search to (optional)
- `VAULT_MEMORY_RERANKER_DIR` — override in `download-reranker.sh` only

**Secrets location:** None — no credentials, API keys, or secrets required for any integration

---

*Integration audit: 2026-05-14*
