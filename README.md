# vault-memory

**Local-first, source-agnostic-ready agentic knowledge layer over your Obsidian notes,
exposed to any MCP-aware agent.**

> See [CHANGELOG.md](./CHANGELOG.md) for release history. Latest: **v2.5.0** — additive
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

## Document locks

Set the Boolean frontmatter field `locked: true` to protect a reviewed note:

```yaml
locked: true
```

The delivery adapters reject overwrites, updates, frontmatter changes,
deletion and `supersede` with `{ "ok": false, "reason": "document_locked" }`.
The lock is checked against the currently stored document, so a matching
`expected_hash`, an omitted frontmatter payload or an incoming `locked: false`
cannot bypass it. Locked notes remain readable and searchable.

You can create a locked note or set the lock on an editable note. To unlock an
existing note, remove the field or set it to `false` directly in Obsidian or a
text editor, then read the note again to obtain its current hash. There is no
agent override. Only the Boolean `true` locks; the string `"true"`, `false`,
`null` and an absent field do not.

The lock is an application-level editing rule. Existing read-only, path,
MemorySink, provenance and concurrency protections still apply. Rejected
operations leave the file, SQLite index, write audit and watcher suppression
unchanged. External editors retain normal access to Markdown files.

## Optional document editing

Enable the separately versioned edit module in `config.toml`:

```toml
[server]
features = ["document_edit"]
```

This adds `edit_document` to MCP discovery. Call it with `doc_id`, the
`expected_hash` obtained by reading the document, and either
`patch: {kind: "replace", old_text: "Old", new_text: "New"}` or
`patch: {kind: "section", heading_path: ["Project", "Decision"], content: "New decision\n"}`.
Replacement text must occur exactly once; duplicate heading paths are refused.
Section edits replace that heading's body, including nested subsections, while
retaining the heading line and surrounding bytes. ATX headings are recognized
outside fenced code blocks; Setext headings are not supported.

Body-only edits preserve existing frontmatter comments and formatting. Same-text
edits still run delivery guards and hash checks but do not write or add an audit
entry. `document_locked`, `hash_mismatch`, `ambiguous_target` and
`target_not_found` are structured refusals. MemorySink provenance remains required.
Without the feature flag, the standard MCP catalog is unchanged.

Successful edits invalidate stale derived data and refresh chunks, sections,
edges and the configured retrieval backend before returning. If refresh fails,
the edit still returns `ok: true` with `index_refresh: "pending"` and a warning;
normal indexing/catchup retries the invalidated index. With no embedding model
registered, refresh builds the lexical index without contacting Ollama.

## Compact v2 context

`get_document_bundle`, `assemble_dossier` and `search_sections` accept optional
`projection`, `heading_paths` and `max_chars`. Existing requests, including
`projection: "full"` without a budget, keep their previous response.

Use `projection: "metadata"` to omit body snippets. For selected source text:

```json
{"doc_id":"obsidian-fs://work/project.md","projection":"sections","heading_paths":[["Project","Decisions"]],"max_chars":2000}
```

Bundles and dossiers select from the anchor document; section search selects
matching paths from its query candidate sections. Each `context.slices` entry
contains the complete citation packet, exact body offsets and 1-based body line
range, `text`, `original_chars` and `truncated`. Sections include their nested
subsections. Offsets and line ranges refer to the complete source range even
when the returned text is shortened. Source hashes describe the full document.

One budget covers all body excerpts in the response. Section projection defaults
to 6000 UTF-16 code units and avoids splitting emoji surrogate pairs. Metadata
has a body budget of zero; citation fields and properties are retained separately.
`budget_used`, `budget_limit`, `truncated` and `excluded` show what was shortened
or omitted. `max_chars: 0` excludes nonempty excerpts explicitly. With full
projection, an explicit budget limits the existing link/chunk snippets.

Missing selectors return `target_not_found`, duplicate source heading paths
return `ambiguous_target`, and invalid/missing selection arguments return
`invalid_projection`. For section search, missing means absent from the query's
candidate sections. No files or provenance are changed. No configuration flag
or database migration is required; the original 23 v1 input schemas are frozen
separately from additive v2 schema snapshots.

## Categorized statements

Explicit Markdown list items such as `- [fact] The rollout starts in June`,
`- [decision] Use a local model` and `- [preference] Write asynchronously` are
indexed as statements within their source document. Indented continuation lines
belong to the same statement; nested list items stay separate. Code examples,
checkboxes and ordinary prose are ignored. Unknown explicit categories remain
available. This parser performs no inference or provenance promotion.

Pass `include_observations: true` to the three v2 assembly tools to retrieve
statements with category, full source citation, document hash and body line
range. The default responses stay unchanged. Selected section projections
include only statements within the selected ranges; metadata projection returns
counts and exclusions without statement text. Excerpts share the global body
budget and disclose truncation or exclusion.

SQLite migration 17 adds a derived statement table and a source-hash marker.
Existing sources initially report `state: "unindexed"`; normal indexing/catchup
fills the marker, including documents without statements. A source change not
yet indexed reports `state: "stale"` and returns no old statements. Direct writes
publish the note and statement snapshot together; delete/rename removes the old
rows. Repeated identical snapshots preserve statement IDs. Markdown remains
authoritative and its `source`, `evidence` and `confidence` are retained as-is.
`record_observation` continues writing whole MemorySink documents under its
existing provenance contract.

## Domain relation roles

Declare directed roles in a `Relations` section, for example:

```markdown
## Relations
- owns [[Atlas#Plan|Roadmap]]
- depends_on [[Budget]]
```

Only complete explicit list declarations are roles. Ordinary wikilinks and
code examples carry no inferred role; unknown underscore-separated role names
are retained. Roles enrich `Edge.rel` on the existing wikilink edge, preserving
anchors, source body lines, parallel roles and unresolved targets. Markdown is
authoritative. Run a full reindex to backfill existing notes; no migration or
configuration flag is needed.

The v2 `expand` tool accepts `rels: ["owns"]` and `direction: "outgoing"` or
`"incoming"`. Existing `forward`/`backward` remain equivalent aliases; omitted
direction stays `both`. Omitted roles retain all edges; an empty role array
selects none. Filters apply on every hop and combine with `edge_types`.
`via` discloses the role, body line, declaring source DocId and canonical hash;
the result packet still cites the reached document and preserves its provenance.
A changed declaring source returns `stale_relation` and excludes its indexed
role until reindexing. Traversal never invents an inverse role or confidence.
The original v1 graph-tool schemas stay unchanged.

## Read-only schema candidates, validation and drift

Enable the separate module explicitly:

```toml
[server]
features = ["document_edit", "schema_inspection"]
```

`inspect_schema` accepts `mode: "infer" | "validate" | "diff"`, `doc_ids`, an
optional named MemoryContract and `strict` (default false). Infer returns
candidate-only field types/prevalence, category/role prevalence, sample size
and complete fresh source citations. It neither marks empirical fields required
nor saves or changes a contract. A supplied contract retains all of its explicit
required keys, including keys absent from the sample. The adapter's derived
`wikilinks` property is excluded from filesystem field profiles/validation;
citation properties retain their original adapter shape.

Validate and diff require an explicit contract. Registered MemoryContracts,
including `default-memory-v1`, use their existing Zod validators and required-key
lists. Missing required provenance, wrong types and cross-field violations are
always errors. Additional undeclared fields are warnings permissively and errors
with `strict: true`; `passed` means no errors. Diagnostics cite the source hash,
field path, and source line for body declarations. Structured headings, lists
and nested sections are inspected through a Markdown projection; `body_projections`
and `line_basis: "rendered_markdown"` mark its lines as rendered coordinates.
The source citation/hash remains the original document. Diff reports required missing
in any sampled document, unexpected fields and new observed types.

An unregistered name loads its existing `_contracts/memory/<name>.yaml` from the
single filesystem vault named by the samples. The existing process-wide named
MemoryContract cache remains in use; multiple vaults cannot select an ambiguous
disk fallback. Author contracts explicitly and version them yourself. Optional
`observation_categories: [fact, decision]` and `relation_roles: [owns, depends_on]`
restrict inspection vocabularies. Omitted vocabularies are unrestricted; declared
empty arrays allow no values. Unknown declarations become warnings or strict
errors and appear in category/role drift. These vocabularies apply to inspection;
they do not change MemorySink write validators or promote observations.

Inspections work on readonly/locked sources, mutate no files or SQLite, and
fail closed for unavailable samples. The existing `suggest_frontmatter` tool and
the default catalog remain compatible. No database migration is required.

## License

MIT.

### Business validity (F07)

Optional `valid_from` / `valid_to` define a half-open business interval, independently of required `observed_at`: start inclusive, end exclusive, missing or null bounds open. Use quoted ISO timestamps with an explicit timezone and at most millisecond precision. Retrieval defaults to the current time. v2 `recall`, `search_sections`, and `get_document_bundle` accept `as_of`; `recall` also requires `include_superseded: true` to retrieve superseded memories historically. Invalid bounds yield `invalid_validity`; imported invalid documents stay indexed with a diagnostic and are excluded from search. Migration 18 backfills UTC milliseconds without rewriting Markdown.

Individual categorized statements inherit document bounds. A trailing explicit annotation can override only those bounds: `- [fact] January rule <!-- validity: {"valid_from":"2026-01-01T00:00:00Z","valid_to":"2026-02-01T00:00:00Z"} -->`. Null resets a bound to open. Malformed annotations are excluded with `invalid_validity`. Source identity, hash, evidence and confidence remain those of the original document. Direct bundle reads retain the anchor with `valid_at` even outside its interval; their statement list is filtered at `as_of`, allowing explicit statement overrides. Search filters indexed bounds before limits; external edits become searchable after indexing.

### Knowledge CLI and manuals (F08)

`vault-memory search --vault main --query "Budget" --json` searches the existing index. `vault-memory read --doc-id "obsidian-fs://main/A.md" --projection metadata --json` retrieves source identity and hash; `--projection full` includes up to 6000 characters with truncation metadata. Both support `--as-of ISO`. JSON stdout contains one complete object; diagnostics use stderr.

Enable `server.features=["document_edit"]` to use `vault-memory edit --doc-id ID --expected-hash HASH --patch-file patch.json --json`. The patch is the same validated replace/section payload as `edit_document`. No implicit stdin input. Exit codes: 0 success, 2 invalid input, 3 missing document/topic, 4 conflict or guarded refusal, 5 unavailable backend. Successful edits refresh the index; refresh failures retain the successful edit with `index_refresh: pending`.

`vault-memory man edit_document --json` and MCP template `vault-memory://man/{topic}` return the same versioned manual, including schema, activation and operation hints. Tool discovery now advertises operation annotations without changing input schemas. `VM_CONFIG_DIR=/path/to/isolated-config` selects both config.toml and the vaults/ database directory; default remains ~/.vault-memory. No client configuration is written.

### Local ONNX embeddings (F09)

Ollama remains the default. Set `[server] embedding_provider="onnx"` and `model_path="/absolute/local/model-directory"` to enable CPU-only ONNX embeddings. The directory must contain a schema_version=1 manifest plus locally supplied, SHA256-pinned model.onnx, tokenizer.json and tokenizer_config.json. Nothing downloads automatically. The manifest declares model/revision/dimensions, mean pooling, normalization, max_tokens, pad_token_id, query_prefix, passage_prefix, output name and license. See tests/fixtures/tiny-embedding/manifest.json for the format (the tiny model is a deterministic test graph, not a useful language embedding). Only self-contained float32 hidden-state ONNX exports are supported; batch size is one per inference, input_ids/attention_mask and optional token_type_ids. Inputs truncate deterministically to max_tokens.

For multilingual-e5-small, the author's model card specifies `query: ` and `passage: ` prefixes, masked mean pooling and normalization; supply the chosen export's exact dimensions, revision and asset hashes. [Model instructions](https://huggingface.co/intfloat/multilingual-e5-small), [ONNX Runtime API](https://onnxruntime.ai/docs/api/js/interfaces/InferenceSession.html). The manifest hash is included in the revision namespace, preventing silent mixing after tokenization changes.

On an existing index, build ONNX using `start_shadow_index` with the manifest model name (or full namespace); it returns the canonical modelName. Existing vectors and active model remain intact. Verify the shadow, then call `switch_active_model` explicitly. A direct reindex to a different ONNX identity is refused until this migration is complete. New vaults can index directly. ContextFit keeps its embedding-free path. Source-only CLI reads work without ONNX assets. No multilingual quality or speed claim is made: the default suite uses the original MIT tiny fixture; an optional local-model paraphrase test runs only with VM_ONNX_QUALITY_MODEL_PATH.

### Explicit session lifecycle (F10)

Enable `session_lifecycle` in `[server].features` to expose the additive `start_session` and `record_checkpoint` tools and local CLI commands. Existing tools and default configuration stay compatible. This feature reads existing briefs and records explicitly supplied summaries; it does not capture conversations or change host configuration.

```sh
vault-memory session start --vault main --topic project --sink _memory/_briefs --max-chars 3000 --json
vault-memory session checkpoint --input checkpoint.json --json
```

`start_session` accepts `vault`, `topic`, optional brief `sink`, `max_chars` and `as_of`. It validates the brief's source chunk hashes against freshly read documents and the derived index. Missing/changed/unindexed sources make the result `stale:true` with an empty context body; citations remain available. A current brief's body is clipped to the character budget while retaining source IDs and hashes. No brief is compiled automatically. CLI vault selection is automatic only with one configured vault.

Checkpoint input:

```json
{"session_id":"session-42","event_id":"checkpoint-1","sink":"memory","summary":"Implemented and verified the selected change.","source_doc_ids":["obsidian-fs://main/Project.md"],"observed_at":"2026-10-03T10:00:00Z"}
```

The existing `record_observation` controller and DeliveryAdapter author the summary inside an existing, provisioned MemorySink. Provenance is `source:agent`, `confidence:inferred`, `type:summary`, with explicit `observed_at`, source evidence and session/event IDs. Sources must be readable. Sentinel and readonly guards remain active. Commands do not provision sentinels or load embedding assets.

The SHA256 session/event key is scoped to the sink. Repeating an identical event returns the canonical checkpoint with `reused:true`; changing its payload returns `checkpoint_mismatch`. Parallel events return `checkpoint_in_progress` for the contending caller: retry with the same IDs. SQLite migration 19 adds atomic derived reservations. On retry, canonical checkpoint properties reconstruct idempotence after index loss or a crash following an atomic Markdown write. Expired reservations are reclaimed only after the owning process has ended. A previously completed but deleted checkpoint returns `checkpoint_missing`; it is not recreated implicitly. CLI exit codes are 0 success, 2 invalid input, 4 checkpoint conflict, 5 configuration/backend error.

The optional portable host adapter is [examples/hooks/neutral-session.mjs](examples/hooks/neutral-session.mjs). Run it explicitly with a JSON event file:

```json
{"schema_version":1,"event":"session_start","input":{"vault":"main","topic":"project","sink":"_memory/_briefs","max_chars":3000}}
```

For a checkpoint, use `event:"session_checkpoint"` and place the checkpoint input above in `input`. Unknown fields, unsupported versions and transcript fields are rejected. `node examples/hooks/neutral-session.mjs event.json` invokes the built CLI with a 25-second deadline (`VM_HOOK_TIMEOUT_MS`:100–25000); `VM_CONFIG_DIR` can isolate configuration. Timeout emits `hook_timeout`: retry the same event because the process may have completed an atomic write just before termination. Only this explicitly versioned neutral payload is supported; configure host-specific event translation yourself. No Claude/Codex config is edited and no background loop is installed.

### Reviewed conversation imports (F11)

Enable `conversation_import` in `[server].features` for the additive `preview_conversation_import`, `commit_conversation_import` and `promote_conversation` tools, and corresponding CLI commands. The initial supported input is **neutral-v1**: an array of `{provider,external_id,messages:[{id,role,text,at?}]}`. Roles are `user`, `assistant`, `system`, `tool`; IDs must be unique, optional times explicit ISO timestamps, attachments unsupported. No timestamps or user authorship are invented. Example:

```json
[{"provider":"neutral","external_id":"chat-42","messages":[{"id":"m1","role":"user","text":"Two pilots"},{"id":"m2","role":"tool","text":"Tool result"}]}]
```

```sh
vault-memory import --format neutral --input conversation.json --target obsidian-fs://main/imports/ --json > manifest.json
# Inspect the saved manifest before applying it:
vault-memory import --commit manifest.json --json
vault-memory promote-conversation --input promotion.json --json
```

Preview is the default and writes no source or memory document. It captures each existing source's canonical expected hash (`null` for a new destination) and uses a deterministic SHA256 identity from provider/external ID for safe filenames. External IDs are never filesystem paths. The versioned manifest includes full rendered text, content hash, conversation identity, destination and explicit import time. Commit validates these fields against each other and refuses edited/inconsistent manifests. Existing exports require the captured hash; source changes or deletions after preview produce a conflict. Locks and readonly checks remain active. Identical canonical imports reuse their source without an additional audit write. An updated export retains the original `imported_at`; message timestamps remain unchanged.

Imported sources carry `source:imported`, `import_source_id`, `import_hash`, `imported_at` and validated conversation metadata. They must be outside MemorySinks. Commit uses the existing DeliveryAdapter; a batch reports completed per-document results if a later write fails, so inspect the result before retrying. Normal indexing builds searchable derived data; no model inference runs during import.

Promotion is a separate explicit write through `record_observation` into an existing provisioned sink:

```json
{"doc_id":"obsidian-fs://main/imports/conversation-HASH.md","expected_hash":"CANONICAL_SOURCE_HASH","message_ids":["m1"],"claim":"Two pilots","mode":"quote","sink":"memory","observed_at":"2026-10-03T12:00:00Z"}
```

The canonical source must still match its import metadata and caller hash; missing messages and fabricated quotes are rejected. `quote` requires exact selected text and records `confidence:direct`; `inference` records `confidence:inferred`. Both write `source:agent` with concrete `DocId#message-id` evidence, source hash and original roles. Tool messages remain tool messages. Repeating an explicit promotion creates another observation; promotion is not advertised as idempotent. Source imports and agent-derived claims remain separately inspectable.

Provider export parsers are enabled only against a documented, verified compatibility profile. OpenAI documents [data export](https://help.openai.com/en/articles/7260999-exporting-your-chatgpt-history-and-data), but does not provide a stable JSON mapping schema or public versioned original fixture. Therefore `--format chatgpt` currently returns `unsupported_format`; branching or attachments are never silently flattened. Convert to neutral-v1 explicitly. The synthetic neutral fixture contains no private exported conversation. No existing v1 schemas, default tool catalog or global host configuration are changed. CLI exit codes:0 success,2 invalid/unsupported input,4 write conflict,5 configuration/backend error.
