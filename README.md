# vault-memory

Local-first semantic memory MCP server for Obsidian vaults.

Reads one or more Obsidian vaults, indexes them with local embeddings via Ollama, and exposes them to Claude Code through the Model Context Protocol — with semantic + BM25 hybrid search, wikilink graph navigation, frontmatter queries, atomic writes with concurrency protection, and live file-watching.

## Status

**v0.7.3** — feature-complete through Phase 7e (eval-driven model upgrades). See `_research/vault-memory-spec.md` in a consuming vault for the design contract, and `_research/vault-memory-eval-v2-results.md` for retrieval-quality benchmarks.

## Architecture in one paragraph

One SQLite database per vault under `~/.vault-memory/vaults/<name>.db`. Three storage layers: **raw** (notes, chunks — permanent, model-agnostic), **derived** (embeddings via sqlite-vec, FTS5, wikilinks — regenerable from raw), **audit** (index runs, write history). Embeddings via Ollama HTTP. Cross-vault search via Reciprocal Rank Fusion in the query layer. Per-model `embeddings_m<id>_d<dim>` vec0 tables let multiple embedding models coexist for shadow-indexing and seamless model upgrades.

## Embedding model recommendation

Eval-v2 (May 2026) compared two multilingual Ollama-hosted embedding models on a 187-note real-world German+English vault:

| Model | Size | Dim | Verdict |
|---|---|---|---|
| **`bge-m3`** ⭐ | 1.1 GB | 1024 | **Recommended default.** Materially better at concept-paraphrase queries; finds the right note where qwen3 returns generic tool pages. MIT-licensed. |
| `qwen3-embedding:0.6b` | 600 MB | 1024 | Low-RAM fallback. OK for direct keyword matches, weak on conceptual queries. Apache 2.0. |
| `embeddinggemma:300m` | 600 MB | 768 | Not benchmarked yet — promising for laptops with <8 GB free RAM. Gemma 3 license. |

See `vault-memory-eval-v2-results.md` for the full per-query benchmark table.

## Reranker — experimental, off by default

The optional cross-encoder reranker (`reranker_model` in config, `rerank: true` per query) is **disabled by default**: the v0.7.x Ollama-backed implementation uses an L2-norm approximation that does not produce trustworthy relevance scores — in eval-v2 it *degraded* result quality compared to plain hybrid search. A proper ONNX-runtime backend is planned for Phase 8.

## Install (recommended)

```bash
# 1) Homebrew (system-level)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2) Node 22+
brew install node@22

# 3) Ollama + service
brew install ollama && brew services start ollama

# 4) Embedding model (~1.1 GB)
ollama pull bge-m3

# 5) Clone, build, link
cd ~/Documents/GitHub
gh repo clone owrede/vault-memory
cd vault-memory
npm install && npm run build && npm link   # creates the global `vault-memory` binary

# 6) Config (~/.vault-memory/config.toml — see below)
# 7) First index
vault-memory index
```

The MCP-host config (`.mcp.json` in the consuming vault) calls the `vault-memory` binary, so any shell with it on `$PATH` will work.

For a guided install from inside Claude Code, use the `/setup-memory-system` skill in the consuming vault.

## Configuration

`~/.vault-memory/config.toml`:

```toml
[server]
log_level = "info"
ollama_endpoint = "http://localhost:11434"
default_embedding_model = "bge-m3"      # recommended default since v0.7.3

# Optional: cross-encoder reranker. Currently EXPERIMENTAL — see Reranker
# section above. Leave commented out unless you specifically want to test.
# reranker_model = "qllama/bge-reranker-v2-m3"

[[vaults]]
name = "myvault"
path = "/Users/me/Documents/Obsidian Vaults/My Vault"
write_enabled = true
exclude_globs = [".obsidian/**", ".trash/**", "_research/**", ".claude/**"]

# Optional: secondary model for shadow-indexing. The indexer embeds new
# chunks under BOTH models. Use `switch_active_model` once you're ready
# to promote.
# secondary_embedding_model = "qwen3-embedding:0.6b"
```

## MCP tools (18)

**Discovery & Read:** `list_vaults`, `read_note`
**Search:** `search_semantic`, `search_text`, `search_hybrid` (all with optional `exclude_paths` glob filter)
**Graph:** `list_backlinks`, `list_forward_links`, `find_broken_links`
**Frontmatter:** `query_frontmatter`
**Write:** `write_note`, `update_frontmatter`, `delete_note` (all hash-protected, atomic)
**Audit:** `audit_log`, `index_runs`
**Model management (Phase 7c):** `list_models`, `start_shadow_index`, `switch_active_model`
**Maintenance (v0.7.3):** `vacuum_embeddings` — drop orphaned embedding rows whose chunk_id no longer exists

## Development

```bash
npm install
npm run dev          # MCP server on stdio with hot reload
npm test             # 264+ tests across 31+ files
npm run build
```

After a code change: `npm run build && git add dist/` — the bundle is tracked in git so users can `git pull && npm link` without needing devDependencies on every machine.

## License

MIT.
