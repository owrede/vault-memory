# ContextFit backend — CPU-only retrieval for resource-limited hosts

vault-memory supports two retrieval engines, selectable **per vault** (ADR-008):

- **`ollama`** (default) — Ollama embeddings + sqlite-vec + FTS5 hybrid. Needs an
  embedding model resident in Ollama (practically a GPU, or slow on CPU).
- **`contextfit`** — [ContextFit](https://www.context.fit/), a token-native,
  **CPU-only** engine (BM25 + Semantic-IDs; no embeddings, no GPU, ~41 MB deps).
  Ideal for a non-GPU host such as a **Synology NAS**.

Spike numbers on a 255-note vault (Apple M1): ContextFit ingested in **5.7 s vs
131 s** and queried at **~13 ms vs ~113 ms** with **no GPU/model** — competitive
retrieval quality.

## Requirements

ContextFit is a Python CLI. Install it so `contextfit` is on PATH:

```bash
pipx install contextfit      # recommended (isolated)
# or: pip install contextfit
```

No Ollama, embedding model, or GPU is needed for a ContextFit vault.

## Enable it for a vault

New vault:

```bash
vault-memory add-vault /path/to/vault --name myvault --backend contextfit
```

Or edit `~/.vault-memory/config.toml`:

```toml
[[vaults]]
name = "myvault"
path = "/path/to/vault"
backend = "contextfit"          # CPU-only; no Ollama/embeddings

# optional:
[vaults.contextfit]
command = "contextfit"          # default; or an absolute path
tokenizer = "cl100k_base"       # default
method = "hybrid"               # exact | bm25 | sid | graph | hierarchy | hybrid
```

Then index and use it exactly like any vault:

```bash
vault-memory index myvault       # runs `contextfit ingest` (CPU-only)
```

`search_hybrid` / `search_semantic` over a ContextFit vault dispatch to the
ContextFit engine and return the same `SearchHit` shape as Ollama vaults
(`scoreBreakdown.contextfit` carries the raw lexical score). You can mix
ContextFit and Ollama vaults in one config — each uses its own engine.

## What works on a ContextFit vault

A ContextFit vault builds the **full SQLite content layer** (notes, chunks,
sections, wikilinks, typed edges) — it only skips embeddings. So almost the whole
tool surface works:

- **Search** (`search_hybrid`, `search_semantic`) → routed to the ContextFit engine.
- **Graph** — `expand`, `cluster`, `list_backlinks`, `list_forward_links`, `find_broken_links` (backed by the `edges` table, built without embeddings).
- **Sections / assembly** — `get_outline`, `search_sections`, `get_document_bundle`, `assemble_dossier`.
- **Frontmatter / metadata** — `query_frontmatter`, `suggest_frontmatter`, `recent_notes`, `vault_stats`.
- **Writes** — `write_note` / `update_frontmatter` / memory tools; the ContextFit KB is refreshed after each write.
- **Live re-indexing** — the file watcher re-indexes changed notes and refreshes the KB (debounced). 
- **Reconciliation** — catch-up on server start brings a changed vault back in sync.
- **Incremental** — unchanged notes are hash-skipped on re-index.

### The one exception
- `search_text` (raw SQLite FTS5) is Ollama-path-only and returns a note telling
  you to use `search_hybrid` / `search_semantic` for a ContextFit vault.

Semantic-vector features (sqlite-vec ANN, embedding-model switching, shadow
indexing) don't apply — ContextFit is lexical/SID by design, not vector-based.

The search KB is stored at `~/.vault-memory/contextfit/<vault-name>/`; the SQLite
content layer lives in `~/.vault-memory/vaults/<vault-name>.db` like any vault.

## Troubleshooting

- **"contextfit not found"** — install it (`pipx install contextfit`) or set
  `[vaults.contextfit].command` to its absolute path. Note: when Obsidian/your
  client launches the server from a GUI, PATH may be minimal; an absolute
  `command` is the most reliable.
- **No hits on a host also serving several large Ollama vaults** — a known
  `spawn EBADF` interaction under many concurrent vault watchers (see ADR-008
  "Known operational caveat"). A ContextFit vault on a dedicated/CPU-only host
  is unaffected.
