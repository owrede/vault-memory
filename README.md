# vault-memory

Local-first semantic memory MCP server for Obsidian vaults.

Reads one or more Obsidian vaults, indexes them with local embeddings via Ollama, and exposes them to Claude Code through the Model Context Protocol — with semantic + BM25 hybrid search, wikilink graph navigation, frontmatter queries, atomic writes with concurrency protection, and live file-watching.

## Status

**v0.8.1** — Phase 8 (real ONNX cross-encoder reranker) + search-quality fixes. See `_research/vault-memory-spec.md` in a consuming vault for the design contract, `_research/vault-memory-eval-v2-results.md` for retrieval-quality benchmarks, and `_research/vault-memory-eval-v3-spec.md` for the planned reranker eval.

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

## Reranker — real ONNX cross-encoder (Phase 8)

Replaces the v0.7.x L2-norm hack with a real cross-encoder forward pass over **BAAI/bge-reranker-v2-m3** (ONNX INT8, ≈570 MB) via `onnxruntime-node` + `@huggingface/tokenizers`. Sigmoid-of-logit gives a true [0, 1] relevance score per (query, chunk) pair, matching the `Reranker` contract directly. v0.8.1 fixed the tokenizer-constructor API (Hugging Face needs `Tokenizer(tokenizerJson, config)`) and added a near-empty-chunk pre-filter so the rerank pool isn't diluted by degenerate inputs.

Setup (one-time):

```bash
bash scripts/download-reranker.sh       # ≈590 MB into ~/.vault-memory/models/bge-reranker-v2-m3/
```

Then in `~/.vault-memory/config.toml`:

```toml
[server]
reranker_model    = "bge-reranker-v2-m3"
reranker_backend  = "onnx"              # default when reranker_model is set
# reranker_model_dir = "..."            # optional override; defaults to ~/.vault-memory/models/bge-reranker-v2-m3
```

Reranking remains **opt-in per query** via `rerank: true` in `search_hybrid`. The ONNX session loads lazily on the first reranked query, so users who never set `rerank: true` pay zero startup cost.

The legacy `OllamaReranker` (L2-norm proxy) stays available via `reranker_backend = "ollama"` for back-compat, but is no longer recommended.

## Search scope (v0.8.1)

By default — with multiple vaults configured — `search_*` tools fan out across all of them and merge via RRF. Two new mechanisms scope this:

**`VAULT_MEMORY_ACTIVE_VAULT` env var** — set per consumer (in `.mcp.json`'s `env` block) to default search to one vault. Explicit `vaults: [...]` in the request still overrides; cross-vault stays opt-in.

```json
{
  "mcpServers": {
    "vault-memory": {
      "type": "stdio",
      "command": "vault-memory",
      "args": ["serve"],
      "env": { "VAULT_MEMORY_ACTIVE_VAULT": "myvault" }
    }
  }
}
```

**Mid-index skip** — vaults with an unfinished `index_runs` row (i.e. an index is still embedding chunks) are excluded from the implicit candidate set so half-indexed chunks don't pollute results. Skipped vaults are listed in a `note` field on the response. Explicit `vaults: ["…"]` still passes through if you want to query a mid-indexing vault on purpose.

## Adding a vault

For the first vault, follow [Install (recommended)](#install-recommended) below.
For every additional vault — one command:

```bash
vault-memory add-vault "/path/to/another/obsidian/vault"
```

This appends a `[[vaults]]` block to `~/.vault-memory/config.toml`, writes a `.mcp.json` into the vault root (so Claude Code auto-spawns the MCP server when you open it), and runs the initial index. Idempotent — re-running on a known path only fills in whatever is missing.

Flags: `--name <slug>` to override the auto-slugified basename, `--write` to enable MCP writes (default read-only), `--no-index` to skip the initial index. Inside Claude Code you can also use the `/add-vault` skill which wraps the same CLI with confirmation prompts.

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

# 5) Install vault-memory from npm (public registry, no auth)
npm install -g @owrede/vault-memory

# 6) Register your first vault (creates config + .mcp.json + initial index)
vault-memory add-vault "/Users/you/Documents/Obsidian Vaults/My Vault"
```

The MCP-host config (`.mcp.json` in the consuming vault) calls the `vault-memory` binary, so any shell with it on `$PATH` will work. Future upgrades: `npm install -g @owrede/vault-memory@latest`.

For a guided install from inside Claude Code, see the `skills/` directory in this repo — they bundle the install, vault registration, and end-to-end smoketest behind a single command.

### Install from source (developer mode)

Only needed if you want to modify vault-memory itself. Otherwise use the npm install above.

```bash
cd ~/Documents/GitHub
gh repo clone owrede/vault-memory
cd vault-memory
npm install && npm run build && npm link   # creates the global `vault-memory` binary
```

## Skills (Claude Code integration)

The `skills/` directory contains two Claude Code skills you can drop into any vault's `.claude/skills/` folder. They are the user-facing way to install and operate vault-memory without remembering CLI flags.

| Skill | What it does | When to invoke |
|---|---|---|
| **`install-vault-memory/`** | The complete installer — 8 idempotent checkpoints from Homebrew through MCP smoketest. Defaults to autonomous mode with a `why:` line on every install prompt. Re-running on a working setup verifies state in under 5 seconds and exits. | First-time setup of a vault, or repairing a broken state. `/install-vault-memory` |
| **`add-vault/`** | Wraps `vault-memory add-vault` CLI with a confirmation flow — appends to `config.toml`, writes `.mcp.json`, builds the initial index. Atomic and idempotent. | Adding a *second or third* vault after vault-memory is already installed. `/add-vault` |

### Installing the skills in a vault

One-liner — works from anywhere, installs into the specified vault:

```bash
curl -fsSL https://raw.githubusercontent.com/owrede/vault-memory/main/scripts/install-skills.sh \
  | bash -s -- "/path/to/your/obsidian/vault"
```

Or, from inside the vault's root directory:

```bash
curl -fsSL https://raw.githubusercontent.com/owrede/vault-memory/main/scripts/install-skills.sh | bash
```

The script is idempotent — re-running it fetches the latest skill versions from `main` and overwrites the local copies. Use it to update your skills whenever vault-memory ships a new release.

If you cloned the source repo, you can also copy directly:

```bash
cp -R ~/Documents/GitHub/vault-memory/skills/{install-vault-memory,add-vault} .claude/skills/
```

After Claude Code restarts, `/install-vault-memory` and `/add-vault` are available as slash commands in that vault.

### Autonomous mode

`VAULT_MEMORY_AUTO=1` switches `install-vault-memory/setup.sh` to non-interactive mode: every non-destructive `confirm()` prompt auto-answers yes, with a `why:` line explaining what is being installed and why vault-memory needs it. Destructive operations (overwriting an existing multi-vault `config.toml`, rebuilding a clone with uncommitted changes) still prompt. This is the default when the skill is invoked via `/install-vault-memory`; direct invocation of `setup.sh` defaults to fully-interactive mode.

## Configuration

`~/.vault-memory/config.toml`:

```toml
[server]
log_level = "info"
ollama_endpoint = "http://localhost:11434"
default_embedding_model = "bge-m3"      # recommended default since v0.7.3

# Optional: cross-encoder reranker (Phase 8). Run scripts/download-reranker.sh
# first to fetch the ONNX model. See the "Reranker" section above for details.
# reranker_model    = "bge-reranker-v2-m3"
# reranker_backend  = "onnx"   # default when reranker_model is set

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
**Search:** `search_semantic`, `search_text`, `search_hybrid` — all support optional `exclude_paths` (glob) and an explicit `vaults` filter; responses include a `note` field when vaults were skipped (e.g. mid-indexing)
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
npm test             # 278 tests across 33 files (v0.8.1)
npm run build
```

After a code change: `npm run build && git add dist/` — the bundle is tracked in git so users can `git pull && npm link` without needing devDependencies on every machine.

The indexer is robust against malformed notes: gray-matter parse errors on a single file (invalid YAML frontmatter, duplicate mapping keys, etc.) are logged and skipped, not fatal to the whole vault run. The `IndexRunResult.notesSkipped` field surfaces the count.

## License

MIT.
