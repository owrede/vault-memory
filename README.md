# vault-memory

**Local-first, source-agnostic-ready agentic knowledge layer over your Obsidian notes,
exposed to any MCP-aware agent.**

> See [CHANGELOG.md](./CHANGELOG.md) for release history. Latest: **v2.4.1** — additive
> over v1.x; the 23 v1 tool names + input schemas are preserved byte-identical.

## 30-second example

Install the CLI from npm, register a vault, and start the MCP server:

```bash
npm install -g @owrede/vault-memory
vault-memory add-vault "/path/to/your/obsidian/vault" --name notes
vault-memory serve
```

Point an MCP-aware client at the `vault-memory` binary. For Claude Desktop, drop this
into `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vault-memory": {
      "type": "stdio",
      "command": "vault-memory",
      "args": ["serve"]
    }
  }
}
```

Restart the client. Ask the agent something like: *"Pull me a brief for tomorrow's
1:1 with Alice."* The agent discovers the bundled `meeting-prep` task contract via
`describe_contract`, instantiates it with `instantiate_contract`, and the result —
attendees, recent shared notes, last decisions, open action items — is written into
your vault's `_memory/_briefs/` folder with full provenance. The brief is a regular
note; you can read it, edit it, link to it, or delete it.

That is the full agentic-knowledge-layer loop: discover a contract, instantiate it,
get a cited document back. Memory writes are labeled and provenance-tracked; user
notes are never modified silently.

## What this is

vault-memory turns one or more Obsidian vaults into a queryable, agent-native
knowledge layer running entirely on your machine. It indexes your notes with local
embeddings (via Ollama), keeps the index live as you edit, and exposes the result to
**any MCP-aware agent** — Claude Code, Claude Desktop, ChatGPT Custom Connectors,
the MCP Inspector, or any other client speaking the
[Model Context Protocol](https://modelcontextprotocol.io).

v1.0.0 was a strong **retrieval substrate**: hybrid search (semantic + BM25 + RRF,
optional cross-encoder rerank), live indexing, multi-vault, hash-protected writes.
v2.0.0 evolves it into a full **agentic knowledge layer** — memory namespace with
provenance, document-tree assembly (bundles, outlines, dossiers), graph-as-retrieval
(typed edges, expand, cluster), a compiled-brief layer with a staleness daemon, and
a task-contract DSL that any MCP-aware agent can discover and instantiate.

Obsidian is the v2 source connector; the same MCP tool surface backs any future
adapter (Notion, Logseq, ...) via the `SourceConnector` / `DeliveryAdapter` /
`ChangeFeed` seams introduced in Phase 1. The memory namespace is a non-negotiable
safety invariant: agents never write silently into user notes; every agent-authored
document carries provenance properties and lives in a labeled `MemorySink`.

Nothing leaves your machine. No cloud sync, no API keys, no telemetry.

## Architecture

One SQLite database per vault under `~/.vault-memory/vaults/<name>.db`. Layers L0
through L4 sit on top of an Adapter tier that abstracts the source-of-truth. v2.0.0
ships exactly one adapter implementation (`obsidian-fs`); v3.0.0 adds `notion-api`
without touching the layers above the seam.

```text
+-----------------------------------------------------------------------------+
|  L4   Compiled briefs + Task contracts                  (Phases 5, 6)      |
|       compile_brief . get_brief . instantiate_contract . staleness daemon  |
+-----------------------------------------------------------------------------+
|  L3   Assembly (bundles, outlines, dossiers, authority + staleness)        |
|       get_document_bundle . get_outline . search_sections .                |
|       assemble_dossier . authority + staleness signals  (Phases 3, 4)      |
+-----------------------------------------------------------------------------+
|  L2   Memory namespace + provenance                     (Phase 2)          |
|       record_observation . recall . supersede . MemoryContract             |
+-----------------------------------------------------------------------------+
|  L1   Graph as retrieval                                (Phase 4)          |
|       typed edges . expand . cluster . backlink walks                      |
+-----------------------------------------------------------------------------+
|  L0   Retrieval substrate (v1, behavior unchanged)                         |
|       hybrid search (semantic + BM25 + RRF + rerank) . chunker             |
+-----------------------------------------------------------------------------+
|  Adapter tier                                           (Phase 1)          |
|       SourceConnector . DeliveryAdapter . ChangeFeed . Registry            |
+-----------------------------------------------------------------------------+
|  Implementations                                                           |
|       obsidian-fs   (v2.0.0)         |   notion-api   (v3, Phase 10)       |
+-----------------------------------------------------------------------------+
```

The Adapter tier is the only horizontal seam in the stack. Every layer above it
consumes canonical `Document` objects resolved through the registry; no upper layer
holds a reference to a concrete adapter module. L0 keeps direct database access
because it is substrate, not a consumer of `Document`s. See
[docs/v2/ARCHITECTURE.md](docs/v2/ARCHITECTURE.md) for the full layer model, the
adapter conformance suite, and the read/write data-flow diagrams.

## What's new in v2

- **Phase 2 — Memory namespace + provenance.** Three new tools
  (`record_observation`, `recall`, `supersede`); labeled `MemorySink` write guard;
  default folder sink at `_memory/`; superseded-doc handling. See
  [docs/v2/MEMORY_CONTRACT.md](docs/v2/MEMORY_CONTRACT.md).
- **Phase 3 — Assembly + authority/staleness.** Four new tools (`get_outline`,
  `search_sections`, `get_document_bundle`, `assemble_dossier`); citation packets
  on every result; recency/authority rescore params on `search_hybrid`;
  superseded-doc filtering at SQL level. See
  [docs/v2/PHASE-3-SIGN-OFF.md](docs/v2/PHASE-3-SIGN-OFF.md).
- **Phase 4 — Graph-as-retrieval.** Two new tools (`expand`, `cluster`); typed edges
  table (`wikilink`, `mention`, `frontmatter-ref`, `hyperlink`); `search_hybrid`
  gains an additive `expand` param attaching the typed-edge neighborhood to each
  hit. See [docs/v2/PHASE-4-SIGN-OFF.md](docs/v2/PHASE-4-SIGN-OFF.md).
- **Phase 5 — Compiled brief layer + staleness daemon.** `compile_brief`,
  `get_brief`, and `list_briefs`; per-brief `source_hashes` map; daemon marks
  briefs stale when any source's hash drifts. See
  [docs/v2/PHASE-5-SIGN-OFF.md](docs/v2/PHASE-5-SIGN-OFF.md).
- **Phase 6 — Task contract DSL + reference contracts.** Declarative YAML contracts
  under `_contracts/<name>.yaml`; three new tools (`describe_contract`,
  `instantiate_contract`, `register_contracts_as_tools`); three reference contracts
  (`meeting-prep`, `project-status`, `code-review-brief`). See
  [docs/v2/PHASE-6-SIGN-OFF.md](docs/v2/PHASE-6-SIGN-OFF.md).
- **Phase 7 — Obsidian plugin (default OFF).** Variant-C visual contract editor,
  settings tab, secrets via OS keyring, manual reindex + stats panel, peer-MCP
  connectors. Adds 6 gated tools when enabled. See
  [docs/v2/plugin/README.md](docs/v2/plugin/README.md).
- **Tool surface delta.** 23 v1 tools become 32 canonical tools + 5 DEPRECATED
  entries in `tools/list` (the 5 promoted list-style tools remain callable through
  v2.x with a `DEPRECATED` notice in their `description`; removal scheduled for
  v3.0.0). The raw `tools/list` therefore returns 37 entries; canonical
  (non-deprecated) count = 32. Plugin OFF is the baseline; +6 gated tools when
  enabled.
- **Resources delta.** 5 MCP Resources become 10 MCP Resources in v2.0.0
  (`vaults`, `models`, `recent`, `stats`, `backlinks` added alongside the
  pre-existing memory/brief/contract resources).

## Roadmap

**Phase 9 — Pre-Phase-10 premise check (hard gate).** Before any v3 code is
written, a dedicated phase verifies that the architectural premise for the v3
multi-source line still holds: all Phase 1 CI greps (no `chokidar`, no
`gray-matter`, no raw paths, no `Claude` leak, no `obsidian://` literal outside
adapters) return zero hits on `main`; an adversarial-review sub-agent confirms
ADRs 001-004 remain unviolated by code shipped in Phases 2-8; the stub-adapter
conformance suite is green; capability-descriptor test coverage meets the
plugin-architecture threshold; the maintainer signs off explicitly. Without that
sign-off, no v3 code is written.

**v3.0.0 — Notion connector + multi-source proof.** Ship the first non-Obsidian
source/delivery/change-feed adapter (Notion), promoting the adapter seams from
"interfaces with one implementation" to a real plugin architecture. Resolve the
14 open ADRs (005-01x) covering identity stability, link resolution, property
equivalence, granularity, write semantics, auth, watch, rate limits, embedding
strategy, cross-source memory, caching, sync, Notion sinks, and capability
discovery. Tracked requirements: NOT-01 through NOT-07; DMN-01 through DMN-03
(MCP daemon mode, v2.1.x or v3); TPC-01 through TPC-03 (third-party connectors,
post-v3). Status: deferred — gated by Phase 9 sign-off.

**Beyond v3 (ideas, not commitments).** A v3.x `postgres-fs` storage adapter is
sketched in the roadmap for users whose vaults outgrow local SQLite, with explicit
non-goals: still single-user-runtime, not a managed service, not pgvector
evangelism. A v4.0.0 multi-user direction is anticipated in the roadmap so v2's
opaque DocIds, adapter seams, content-stable ChunkIds, and provenance-on-every-
agent-write read as deliberate choices in service of that path. Neither is
committed work. See [.planning/ROADMAP.md](.planning/ROADMAP.md) for the full
phase plan and the v3/v4 deferred sections.

## Install and docs

### Guided install (recommended)

Ask your agent to **"install vault-memory"** (or run `/vmem:install`). The
installer asks two questions — which retrieval engine, and which vault(s) — then
installs every missing dependency for the chosen path, registers the vault(s),
builds the index, and wires the MCP server. See
[`docs/v2/CONTEXTFIT-BACKEND.md`](docs/v2/CONTEXTFIT-BACKEND.md) for the engine
comparison.

### Choose a retrieval engine

vault-memory supports two engines, selectable **per vault**:

- **Ollama (vector / embeddings)** — best semantic search; needs Ollama + an
  embedding model resident (GPU recommended).
- **ContextFit (CPU-only)** — token-native BM25 + Semantic-IDs; **no GPU, no
  model**, ~41 MB deps. Ideal for resource-limited / non-GPU hosts (e.g. a
  Synology NAS). Requires the `contextfit` CLI (`pipx install contextfit`).

### Prerequisites

- **Node.js 22–25** (`>=22 <26`) — runtime for the MCP server (`brew install node@22`).
  Node 26+ is not yet supported: the native `better-sqlite3` dependency has no
  prebuild for the new ABI and building from source currently fails.
- One or more Obsidian vaults; an MCP-aware client.
- **Ollama engine only:** [Ollama](https://ollama.com) on `localhost:11434`
  (`brew install ollama && brew services start ollama`) + the `bge-m3` model
  (~1.1 GB, `ollama pull bge-m3`). Optional ONNX reranker
  (`bge-reranker-v2-m3`, ~570 MB) via `bash scripts/download-reranker.sh`.
- **ContextFit engine only:** Python 3.10+ and `pipx install contextfit`.

Tested on macOS. Linux should work; Windows untested.

### Manual install

```bash
npm install -g @owrede/vault-memory

# Ollama (default) vault:
vault-memory add-vault "/path/to/your/obsidian/vault"

# OR a CPU-only ContextFit vault (no Ollama/GPU):
vault-memory add-vault "/path/to/your/obsidian/vault" --backend contextfit

vault-memory serve
```

The `add-vault` command appends a `[[vaults]]` block to
`~/.vault-memory/config.toml`, writes a `.mcp.json` into the vault root, and runs
the initial index. Idempotent — re-running on a known path fills in whatever is
missing. Flags: `--name <slug>`, `--backend ollama|contextfit`, `--write`
(enable MCP writes; default read-only), `--no-index` (skip the initial index).

### Documentation

- **Plugin install** — [docs/v2/plugin/INSTALL.md](docs/v2/plugin/INSTALL.md)
- **Plugin README** — [docs/v2/plugin/README.md](docs/v2/plugin/README.md)
- **Migration v1 to v2** — [docs/v2/MIGRATION-V1-TO-V2.md](docs/v2/MIGRATION-V1-TO-V2.md)
- **Architecture deep-dive** — [docs/v2/ARCHITECTURE.md](docs/v2/ARCHITECTURE.md)
- **Memory contract** — [docs/v2/MEMORY_CONTRACT.md](docs/v2/MEMORY_CONTRACT.md)
- **Agent-agnostic statement** — [docs/v2/AGENT_AGNOSTIC.md](docs/v2/AGENT_AGNOSTIC.md)
- **ADR index** — [docs/v2/adr/README.md](docs/v2/adr/README.md)
- **Changelog** — [CHANGELOG.md](./CHANGELOG.md)

SemVer-locked tool API per the v1.0.0 declaration. v2.0.0 is additive: the 23 v1
tool names + input schemas are preserved byte-identical, and the 5 list-style
tools promoted to MCP Resources remain callable through v2.x with a `DEPRECATED`
notice in their tool description (removal scheduled for v3.0.0). See
[CHANGELOG.md](./CHANGELOG.md) for full history.

## License

MIT.
