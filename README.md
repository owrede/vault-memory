# vault-memory

**Local-first, source-agnostic-ready knowledge layer for Obsidian vaults, exposed to
any MCP-aware agent.**

vault-memory turns one or more Obsidian vaults into a queryable, agent-native knowledge
base — running entirely on your machine. It indexes your notes with local embeddings
(via Ollama), keeps the index live as you edit, and exposes the result to
**any MCP-aware agent** — Claude Code, Claude Desktop, ChatGPT Custom Connectors,
the MCP Inspector, or any other client speaking the
[Model Context Protocol](https://modelcontextprotocol.io) — as a set of well-defined
tools for search, graph navigation, frontmatter queries, and atomic writes.

Obsidian is the v2 source connector; the same MCP tool surface backs any future
adapter (Notion, Logseq, …) via the `SourceConnector` / `DeliveryAdapter` / `ChangeFeed`
seams introduced in Phase 1.

Nothing leaves your machine. No cloud sync, no API keys, no telemetry.

> See [CHANGELOG.md](./CHANGELOG.md) for release history. Latest: **v1.0.0** — stable API; SemVer-locked.

## What is vault-memory?

It's an [MCP server](https://modelcontextprotocol.io) that sits between your Obsidian
vaults and an MCP-aware agent. The agent — whether that's Claude Code in your editor,
the Claude desktop app via a Custom Connector, ChatGPT in Deep-Research mode, the MCP
Inspector, or any other client speaking MCP — gets a set of tools to read, search, and
(optionally) write notes. vault-memory handles the hard parts:

- **Hybrid retrieval** — semantic search over local embeddings, BM25 full-text search,
  and Reciprocal Rank Fusion to merge them. Optional cross-encoder reranking for the
  hardest queries.
- **Live indexing** — a file-watcher picks up changes the moment you save a note in
  Obsidian. No manual re-index.
- **Multi-vault** — multiple vaults can be registered; search fans out by default and
  merges results, or you can scope to one.
- **Graph awareness** — wikilinks, backlinks, broken-link detection, Obsidian-style
  aliases.
- **Atomic, hash-protected writes** — the agent can edit notes, but only with explicit
  opt-in and with concurrency control so it can't clobber your edits.

## What it provides

### MCP tools (23)

**Discovery & read**
- `list_vaults`, `read_note`

**Search**
- `search_semantic`, `search_text`, `search_hybrid` — all support optional
  `exclude_paths` (glob) and an explicit `vaults` filter. Responses include a `note`
  field when vaults were skipped (e.g. mid-indexing).

**Graph**
- `list_backlinks`, `list_forward_links`, `find_broken_links`

**Frontmatter**
- `query_frontmatter` — safe JSON-path DSL

**Write (hash-protected, atomic)**
- `write_note`, `update_frontmatter`, `delete_note`

**Audit**
- `audit_log`, `index_runs`

**Model management**
- `list_models`, `start_shadow_index`, `switch_active_model`

**Maintenance**
- `vacuum_embeddings` — drop orphaned embedding rows whose `chunk_id` no longer exists

**Agent compatibility (OB1 / Custom Connectors)**
- `search`, `fetch` — flat-shape adapters for ChatGPT Custom Connectors, Claude.ai,
  and Deep-Research modes. Backed by the same hybrid pipeline, so connector users get
  full search quality through the standardized shape.

**Agent self-orientation**
- `vault_stats` — note count, top tags, top frontmatter keys, last index run
- `recent_notes` — most-recently-modified notes (mtime DESC). Use on first connect to
  brief an agent on what's in the vault and what the user has been working on.

**Schema inference (v0.10.0)**
- `suggest_frontmatter` — for an existing note (by `path`) or a draft (by `content +
  folder_hint`), returns `{existing, suggestions, conflicts}` with calibrated confidence
  per source. Three independent layers contribute:
  - **folder-conventions** — frequency of frontmatter keys in sibling notes (same folder
    prefix). Walks up one level when sibling count <3. Confidence = prevalence.
  - **neighbor-inference** — frontmatter aggregate across wikilink-linked neighbors
    (forward + backlink, deduped). Confidence = prevalence × 0.6 (dampened, since
    indirect).
  - **content-heuristics** — vault-agnostic title/body regex matchers for Email, Meeting,
    Person, Clipping, Fact, and date-prefix patterns. Confidence fixed per rule.
  Conflicts surface when sources disagree on a value. Existing-vs-suggested mismatches
  are also flagged. No LLM, no embeddings.

### Claude Code skills

Five skills bundled in `skills/`, installable into any vault with one curl-pipe:

| Skill | What it does | When to invoke |
|---|---|---|
| **`install-vault-memory/`** | The complete installer — 8 idempotent checkpoints from Homebrew through MCP smoketest. Defaults to autonomous mode with a `why:` line on every install prompt. Re-running on a working setup verifies state in under 5 seconds and exits. | First-time setup of a vault, or repairing a broken state. `/install-vault-memory` |
| **`add-vault/`** | Wraps `vault-memory add-vault` CLI with a confirmation flow — appends to `config.toml`, writes `.mcp.json`, builds the initial index. Atomic and idempotent. | Adding a *second or third* vault after vault-memory is already installed. `/add-vault` |
| **`audit-vault-health/`** | Read-only vault health audit — overview stats, broken wikilinks, tag drift (case/separator variants), frontmatter schema drift, indexing freshness. Pure read, never modifies notes. | Quarterly check, before relying on search after bulk import. `/audit-vault-health` |
| **`find-stale-notes/`** | Discovers notes >6 mo old with 0 backlinks. Presents candidates as a sortable table, walks through each one with per-note actions (Archive / Update / Delete / Skip / Keep). Hash-protected deletes; never bulk-acts. | Vault cleanup, after import-bursts. `/find-stale-notes` |
| **`triage-inbox/`** | Walks through recent inbox-stage notes (sparse frontmatter, few tags, recent mtime). Per note: suggests target folder, tags, frontmatter, related wikilinks — based on semantic search against the rest of the vault. User accepts / edits / skips per note. | After a capture-burst (voice memos, web clippings, meeting transcripts). `/triage-inbox` |

## Requirements

Tested on macOS. Linux should work; Windows untested.

| What | Why | How |
|---|---|---|
| **Node.js ≥ 22** | Runtime for the MCP server. | `brew install node@22` |
| **[Ollama](https://ollama.com)** running on `localhost:11434` | Local embedding model host. No cloud API. | `brew install ollama && brew services start ollama` |
| **An embedding model** — default `bge-m3` (≈1.1 GB) | Generates the vectors that power semantic search. | `ollama pull bge-m3` |
| **Disk space** — ~1.2 GB for the embedding model, ~1× your vault size for the SQLite index | Models and the per-vault DB under `~/.vault-memory/`. | — |
| **(Optional) ONNX reranker** — `bge-reranker-v2-m3` (≈570 MB) | Cross-encoder reranking for `search_hybrid` when `rerank: true`. Lazy-loaded — zero cost if you never use it. | `bash scripts/download-reranker.sh` |
| **An MCP-aware client** — Claude Code, Claude desktop, ChatGPT Custom Connector, etc. | The agent that consumes the MCP tools. | — |
| **One or more Obsidian vaults** | What you're actually indexing. | — |

### Embedding-model recommendation

Eval-v2 (May 2026) compared two multilingual Ollama-hosted embedding models on a
187-note real-world German+English vault:

| Model | Size | Dim | Verdict |
|---|---|---|---|
| **`bge-m3`** ⭐ | 1.1 GB | 1024 | **Recommended default.** Materially better at concept-paraphrase queries; finds the right note where qwen3 returns generic tool pages. MIT-licensed. |
| `qwen3-embedding:0.6b` | 600 MB | 1024 | Low-RAM fallback. OK for direct keyword matches, weak on conceptual queries. Apache 2.0. |
| `embeddinggemma:300m` | 600 MB | 768 | Not benchmarked yet — promising for laptops with <8 GB free RAM. Gemma 3 license. |

See `vault-memory-eval-v2-results.md` for the full per-query benchmark table.

## Install

### Recommended — npm

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

The MCP-host config (`.mcp.json` in the consuming vault) calls the `vault-memory`
binary, so any shell with it on `$PATH` works. Future upgrades:

```bash
npm install -g @owrede/vault-memory@latest
```

### Guided install from inside Claude Code

If you'd rather not run the steps by hand, install the skills first and let
`/install-vault-memory` walk you through it:

```bash
curl -fsSL https://raw.githubusercontent.com/owrede/vault-memory/main/scripts/install-skills.sh \
  | bash -s -- "/path/to/your/obsidian/vault"
```

Open the vault in Claude Code, then run `/install-vault-memory` — it executes the
same 6 steps above as 8 idempotent checkpoints, with a `why:` line on every prompt.

### Install from source (developer mode)

Only needed if you want to modify vault-memory itself.

```bash
cd ~/Documents/GitHub
gh repo clone owrede/vault-memory
cd vault-memory
npm install && npm run build && npm link   # creates the global `vault-memory` binary
```

## Adding a second (or third…) vault

One command:

```bash
vault-memory add-vault "/path/to/another/obsidian/vault"
```

This appends a `[[vaults]]` block to `~/.vault-memory/config.toml`, writes a `.mcp.json`
into the vault root (so any MCP-aware client that reads `.mcp.json` — Claude Code,
ChatGPT Custom Connectors, etc. — auto-spawns the MCP server when you open the vault),
and runs the initial index. Idempotent — re-running on a known path only fills in
whatever is missing. The client identity that wrote a note is captured from the MCP
`InitializeRequest.params.clientInfo.name` (per the MCP spec, optional) and recorded
in the audit log — no longer hardcoded.

Flags: `--name <slug>` to override the auto-slugified basename, `--write` to enable
MCP writes (default read-only), `--no-index` to skip the initial index. Inside Claude
Code, the `/add-vault` skill wraps the same CLI with confirmation prompts.

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

The script is idempotent — re-running it fetches the latest skill versions from
`main` and overwrites the local copies. Use it to update your skills whenever
vault-memory ships a new release.

If you cloned the source repo, you can also copy directly:

```bash
cp -R ~/Documents/GitHub/vault-memory/skills/{install-vault-memory,add-vault,audit-vault-health,find-stale-notes,triage-inbox} .claude/skills/
```

### Autonomous mode

`VAULT_MEMORY_AUTO=1` switches `install-vault-memory/setup.sh` to non-interactive
mode: every non-destructive `confirm()` prompt auto-answers yes, with a `why:` line
explaining what is being installed and why vault-memory needs it. Destructive
operations (overwriting an existing multi-vault `config.toml`, rebuilding a clone with
uncommitted changes) still prompt. This is the default when the skill is invoked via
`/install-vault-memory`; direct invocation of `setup.sh` defaults to fully-interactive
mode.

## Architecture in one paragraph

One SQLite database per vault under `~/.vault-memory/vaults/<name>.db`. Three storage
layers: **raw** (notes, chunks — permanent, model-agnostic), **derived** (embeddings
via sqlite-vec, FTS5, wikilinks — regenerable from raw), **audit** (index runs, write
history). Embeddings via Ollama HTTP. Cross-vault search via Reciprocal Rank Fusion in
the query layer. Per-model `embeddings_m<id>_d<dim>` vec0 tables let multiple embedding
models coexist for shadow-indexing and seamless model upgrades.

## Reranker — real ONNX cross-encoder

A real cross-encoder forward pass over **BAAI/bge-reranker-v2-m3** (ONNX INT8,
≈570 MB) via `onnxruntime-node` + `@huggingface/tokenizers`. Sigmoid-of-logit gives a
true `[0, 1]` relevance score per `(query, chunk)` pair, matching the `Reranker`
contract directly.

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

Reranking remains **opt-in per query** via `rerank: true` in `search_hybrid`. The ONNX
session loads lazily on the first reranked query, so users who never set
`rerank: true` pay zero startup cost.

The legacy `OllamaReranker` (L2-norm proxy) stays available via
`reranker_backend = "ollama"` for back-compat, but is no longer recommended.

## Search scope

By default — with multiple vaults configured — `search_*` tools fan out across all of
them and merge via RRF. Two mechanisms scope this:

**`VAULT_MEMORY_ACTIVE_VAULT` env var** — set per consumer (in `.mcp.json`'s `env`
block) to default search to one vault. Explicit `vaults: [...]` in the request still
overrides; cross-vault stays opt-in.

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

**Mid-index skip** — vaults with an unfinished `index_runs` row (i.e. an index is
still embedding chunks) are excluded from the implicit candidate set so half-indexed
chunks don't pollute results. Skipped vaults are listed in a `note` field on the
response. Explicit `vaults: ["…"]` still passes through if you want to query a
mid-indexing vault on purpose.

## Configuration

`~/.vault-memory/config.toml`:

```toml
[server]
log_level = "info"
ollama_endpoint = "http://localhost:11434"
default_embedding_model = "bge-m3"

# Optional: cross-encoder reranker. Run scripts/download-reranker.sh
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

## Connector compatibility

`search` / `fetch` follow the flat-shape spec used by OB1 and adopted by ChatGPT
Custom Connectors / Claude.ai / Deep-Research:

```
search({query, limit}) → { results: [{ id, title, url, snippet }] }
fetch({id})            → { id, title, text, url, metadata }
```

`id` is the opaque format `<vault>:<vault-relative-path>`. `url` is an
`obsidian://open?…` URL — connectors render it as a clickable link that opens the
note locally. Use the richer `search_hybrid` / `read_note` tools when working with a
vault-memory-aware client (Claude Code's MCP integration); use `search` / `fetch`
when integrating with a connector ecosystem that expects the standard shape.

## Development

```bash
npm install
npm run dev          # MCP server on stdio with hot reload
npm test             # 324 tests across 35 files
npm run build
```

After a code change: `npm run build && git add dist/` — the bundle is tracked in git
so users can `git pull && npm link` without needing devDependencies on every machine.

The indexer is robust against malformed notes: gray-matter parse errors on a single
file (invalid YAML frontmatter, duplicate mapping keys, etc.) are logged and skipped,
not fatal to the whole vault run. The `IndexRunResult.notesSkipped` field surfaces the
count.

When shipping a user-visible change, **update `## [Unreleased]` in
[CHANGELOG.md](./CHANGELOG.md) in the same PR.** Release tags get cut from that
section — see the bottom of the changelog for the recipe.

## Comparison to other memory systems

_Coming soon._

## Filing issues

Bug reports and feature requests are welcome. Open one via the
[Issues tab](https://github.com/owrede/vault-memory/issues/new/choose) —
two structured templates are available:

- **Bug report** — for things that are broken or misbehave. Include repro
  steps, your `vault-memory` version, and a one-line severity assessment.
- **Feature request** — for new tools, behaviours, or skills. Describe the
  use case and a concrete proposed shape.

Both templates auto-label the issue (`bug` / `enhancement`) and route into
the area-labels documented below. Anyone with a GitHub account can open
issues; the maintainer triages and labels.

### Area labels

Issues are organised by which part of vault-memory they touch:

| Label | Scope |
|---|---|
| `area:search` | search_hybrid, search_semantic, search_text, search, fetch |
| `area:indexer` | catchup, watcher, body-hash short-circuit |
| `area:schema-inference` | suggest_frontmatter + folder/neighbor/content layers |
| `area:skills` | Claude Code skills bundled in `skills/` |
| `area:cli` | `vault-memory` CLI (serve, add-vault, index) |
| `area:graph` | wikilinks, backlinks, broken-link detection |
| `area:reranker` | ONNX cross-encoder reranker |
| `area:db-migration` | SQLite schema migrations, sqlite-vec |

Plus the functional labels `eval`, `performance`, `breaking-change`,
`needs-repro`, `good-first-fix`.

## License

MIT.
