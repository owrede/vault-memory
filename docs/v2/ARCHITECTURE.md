# vault-memory v2 — Architecture

**Status:** Draft — Phase 0 foundation document
**Date:** 2026-05-14
**Scope:** the public-facing v2 layer model that anchors every later phase
**Related ADRs:** [ADR-001](adr/001-document-identity.md), [ADR-002](adr/002-adapter-seams.md), [ADR-003](adr/003-document-shape.md), [ADR-004](adr/004-memory-sink-handles.md)

## Overview

vault-memory v1.0.0 is a strong **retrieval substrate**: hybrid search
(semantic + BM25 + RRF, optional cross-encoder rerank), 23 MCP tools, live
indexing of an Obsidian vault, hash-protected writes. It exposes a single
source type (the filesystem) and treats vault-relative paths as the natural
key. That works while there is exactly one source and one shape of document.

v2 evolves this into a full **agentic knowledge layer**. The same MCP server
keeps L0 retrieval intact and adds four layers on top — graph-as-retrieval,
a memory namespace with provenance, document-tree assembly (bundles, outlines,
dossiers), and compiled briefs plus task contracts — sitting on an **Adapter
tier** that abstracts the source-of-truth. v2.0.0 ships with one adapter
implementation (`obsidian-fs`); the seams are designed so that a Phase-10
`notion-api` adapter is purely additive, with zero modifications to L0–L4
code.

Three constraints frame every layer below:

- **Memory namespace is sacrosanct.** Agents never write silently into user
  notes. Every agent-authored document carries provenance properties and
  lives in a labeled `MemorySink` ([ADR-004](adr/004-memory-sink-handles.md)).
  This is the single non-negotiable safety invariant.
- **Document identity is opaque and URI-style.**
  `<scheme>://<authority>/<resource>` ([ADR-001](adr/001-document-identity.md)).
  Filesystem paths are presentation; they live only inside the obsidian-fs
  adapter modules.
- **Source-neutrality is a property of the seams, not of the implementations.**
  Every L1+ component talks to data exclusively through the Adapter tier
  ([ADR-002](adr/002-adapter-seams.md)). No layer above the Adapter tier ever
  imports `fs`, `chokidar`, `gray-matter`, or any Obsidian-specific helper.

The line-count bound (≤800) is deliberate: this doc names the layers and
their seams. Mechanisms live in the ADRs and in the per-phase plans.

## Layer model

```
┌───────────────────────────────────────────────────────────────────────┐
│  L4 — Compiled briefs + Task contracts          (Phases 6, 7, 8)      │
│       compile_brief · get_brief · instantiate_contract · staleness    │
├───────────────────────────────────────────────────────────────────────┤
│  L3 — Assembly (bundles, outlines, dossiers, authority/staleness)     │
│       get_document_bundle · get_outline · search_sections ·           │
│       assemble_dossier · authority + staleness signals  (Phases 3–5)  │
├───────────────────────────────────────────────────────────────────────┤
│  L2 — Memory namespace & provenance              (Phase 2)            │
│       record_observation · recall · supersede · MemoryContract        │
├───────────────────────────────────────────────────────────────────────┤
│  L1 — Graph as retrieval                         (Phases 4–5)         │
│       typed Edges · expand · cluster · backlink walks                 │
├───────────────────────────────────────────────────────────────────────┤
│  L0 — Retrieval substrate (v1, unchanged)                             │
│       hybrid search (semantic + BM25 + RRF + rerank) · chunker        │
├───────────────────────────────────────────────────────────────────────┤
│  Adapter tier                                    (Phase 1)            │
│       SourceConnector · DeliveryAdapter · ChangeFeed · Registry       │
├───────────────────────────────────────────────────────────────────────┤
│  Implementations                                                      │
│       obsidian-fs   (v2.0.0)      │   notion-api   (v3, Phase 10)     │
└───────────────────────────────────────────────────────────────────────┘
```

The Adapter tier is the only horizontal seam in the stack. Every layer above
it consumes `Document` objects ([ADR-003](adr/003-document-shape.md))
resolved through the registry; no upper layer holds a reference to a concrete
adapter module. L0 keeps direct database access because it is substrate, not
a consumer of `Document`s — the indexer feeds L0's tables by walking
`SourceConnector.readDocument()` results. L0 itself is never reimplemented
per source.

### Adapter tier

**Responsibility.** Translate between the source-of-truth (filesystem, API,
…) and the canonical v2 types. The tier exposes three interfaces and one
registry; every concrete adapter implements some subset of the interfaces and
publishes capability descriptors.

```text
SourceConnector   read-side  — listDocuments(), readDocument() → Document
DeliveryAdapter   write-side — write(), update(), delete() with hash-OCC
ChangeFeed        watch-side — subscribe(handler) → Disposable
Registry          scheme → factory map; parses handles; mints adapter instances
```

The tier owns four invariants:

- **No path-as-PK.** Adapters convert source-native identifiers to
  `<scheme>://<authority>/<resource>` (per ADR-001 I-1, I-3) and never expose
  raw paths above the tier.
- **Hash determinism.** Every `Document` produced by a `SourceConnector`
  carries a content hash defined in [ADR-003](adr/003-document-shape.md)
  (`sha256(canonical(blocks_as_plain_text) || canonical(PropertyBag))`).
- **DeliveryAdapter is the single write surface.** No code outside this tier
  calls `fs.writeFile` or any Notion write endpoint. Two guards run inside
  the tier on every write (memory-namespace guard + hash-OCC guard per
  [ADR-004](adr/004-memory-sink-handles.md)).
- **At-least-once change delivery.** `ChangeFeed.subscribe` is best-effort;
  resumed sessions reconcile via the indexer's `catchupVault()` reading
  hashes from disk vs. DB. The contract is identical for chokidar (push) and
  Notion polling (pull).

In v2.0.0 there is exactly one implementation per interface — all live under
`src/adapters/source/obsidian-fs/`, `src/adapters/delivery/obsidian-fs/`,
and `src/adapters/change-feed/obsidian-fs/`. A stub `SourceConnector` ships
in Phase 3 under `src/adapters/source/stub/` for source-neutrality evals.
The Notion connector in v3 plugs in additively (see *Source-neutrality
contract* below).

Conformance test suite (`src/adapters/conformance/`) ships in Phase 1. Any
new adapter must pass it before being registered — this is the practical
plugin contract.

### L0 — Retrieval substrate

**Responsibility.** Hybrid search over chunks. Unchanged in behaviour from
v1.0.0; same `search_hybrid`, `search_semantic`, `search_text` tool surface;
same RRF fusion; same optional ONNX cross-encoder rerank. The only v2 change
at L0 is internal: queries select/join on `doc_uri` (the URI from ADR-001),
not on `path`. `path` survives in v2 as a denormalized cache column owned by
the obsidian-fs adapter; it is removed in v3.0.0.

```text
hybridSearch(query, opts) → SearchHit[]
  semantic (cosine on embedding tables, per-model per-dim)
  + text   (BM25 over FTS5 over chunk contents)
  → RRF fusion
  → optional rerank (OnnxReranker | OllamaReranker)
```

Cross-links: [ADR-001](adr/001-document-identity.md) — `doc_uri` migration
strategy; [ADR-003](adr/003-document-shape.md) — chunks remain the unit of
retrieval, `Document` is the unit of assembly.

### L1 — Graph as retrieval

**Responsibility.** Surface the link/backlink graph as a first-class
retrieval signal instead of treating it as a side effect of wikilink storage.
Edges become typed (`wikilink`, `embed`, `backlink`, future
`supersedes`/`derived-from`) per
[ADR-003](adr/003-document-shape.md), and the layer adds `expand` and
`cluster` tools that take a `doc_id` seed and walk the typed graph subject
to depth/type filters.

```text
expand(doc_id, types?, depth?)      → DocId[]   (typed graph walk)
cluster(doc_ids, edge_density)      → DocId[][] (connected-component grouping)
backlinks(doc_id)                   → DocId[]   (already in v1 as get_backlinks)
```

The edges table gains a `kind` column in Phase 1's migration. The current
wikilinks-only behavior is the `kind = "wikilink"` slice. Cross-links:
[ADR-003](adr/003-document-shape.md) on typed `Edge`s;
[ADR-002](adr/002-adapter-seams.md) on how the indexer collects edges via
the `SourceConnector` rather than re-parsing markdown.

### L2 — Memory namespace & provenance

**Responsibility.** Give agents a dedicated, validated write surface so they
never write silently into user notes. Every agent-authored document carries
provenance properties (`source: agent`, `agent_id`, `agent_runtime`,
`created_at`, `superseded_by?`, `memory_contract_version`) and lives inside
a labeled `MemorySink` — by default the `_memory/` folder of the active
vault, optionally a separate vault (`@other-vault`).

```text
record_observation(content, properties)         → DocId         (creates memory doc)
recall(query, filters?)                         → MemoryHit[]   (memory-scoped search)
supersede(old_id, new_id, reason)               → audit_row     (marks old superseded)
list_sinks()                                    → SinkInfo[]    (registered handles)
```

The `MemoryContract` runs inside the `DeliveryAdapter` (per
[ADR-004](adr/004-memory-sink-handles.md)) and is the canonical write guard:
absent required provenance properties → reject; user-note path under
`MemorySink` route → reject (the registry routes the write to the labeled
adapter, which fails validation). One folder-default code path; the
separate-vault option is config-only (`[memory] sink = "@other-vault"`).

Memory is stored as ordinary `Document`s, indexed by L0, searchable by L1's
graph (memory docs cite user notes via wikilinks/embeds, which become typed
edges), and assembled by L3 like any other source. The boundary is
*provenance + write guard*, not *separate database*.

Cross-link: [ADR-004](adr/004-memory-sink-handles.md) for the handle syntax
(`obsidian-fs://my-vault/_memory/` and `@other-vault`) and the sentinel-file
mechanism (`.memory-sink` marks a folder as a valid sink).

### L3 — Assembly (bundles, outlines, dossiers, authority/staleness)

**Responsibility.** Compose `Document` objects into agent-consumable units
larger than a chunk and smaller than a vault. Four assembly tools plus the
authority/staleness signal pair.

```text
get_document_bundle(doc_id)                     → BundleDoc
get_outline(doc_id, max_depth?)                 → OutlineNode
search_sections(query, filters?)                → SectionHit[]
assemble_dossier(seed_doc_ids, max_size?)       → DossierDoc
```

A **bundle** is one document plus its direct dependencies (embeds and
explicitly linked siblings). An **outline** is the heading tree of one
document. A **dossier** is a multi-document compilation built by graph
expansion (L1's `expand`) plus a relevance cut.

Authority and staleness are not separate tools; they are `PropertyBag`
signals propagated onto every `Document` the assembly tools return:

- `authority: "canonical" | "draft" | "memory" | "snapshot"` — derived from
  source + frontmatter conventions.
- `staleness: { last_verified_at, evidence_age_days, source_changed_since }`
  — derived from change-feed events + the brief-source-hash mechanism (L4).

These signals exist so agents can degrade gracefully when sources contradict
each other or have aged out; they are not score modifiers at L0.

Cross-links: [ADR-003](adr/003-document-shape.md) on `Document`,
`BlockNode`, `PropertyBag`; [ADR-002](adr/002-adapter-seams.md) on how
assembly tools take a handle and never touch the filesystem directly.

### L4 — Compiled briefs + Task contracts

**Responsibility.** Cache expensive cross-document syntheses (briefs) and
let users declare reusable agent workflows (task contracts).

```text
compile_brief(target, sources, payload)         → DocId          (writes a brief doc)
get_brief(target, allow_stale?)                 → BriefDoc|null
list_briefs(filters?)                           → BriefRef[]
instantiate_contract(contract_id, params)       → ContractRun    (schema-typed exec)
describe_contract(contract_id)                  → ContractSchema
```

A **brief** is a derived `Document` stored in a `MemorySink` with the
provenance `kind: brief` and an explicit `source_hashes: Record<DocId,
string>` array recording the inputs it was compiled from. A
**staleness daemon** subscribes to the `ChangeFeed`, looks up briefs whose
`source_hashes` contain the changed `doc_id`, re-hashes, and marks the brief
`status: stale` when the hash drifts. Recompilation is caller-driven —
vault-memory does not silently regenerate briefs. This preserves the *no
premature LLM coupling* invariant: brief compilation is the first place v2
could call an LLM and explicitly defers that to Phase 6's ADR (caller
supplies the summarized text in v2.0.0).

**Task contracts** are user-declared YAML/Zod schemas under
`_contracts/` (default sink). `instantiate_contract` drives L3 assembly +
L4 brief compilation + L2 memory writes to deliver a typed result; any
MCP-aware agent can call `describe_contract` to discover what is available.
Contracts compose layers; they do not introduce new ones.

Cross-links: [ADR-003](adr/003-document-shape.md) on the hash semantics that
make staleness detection deterministic; [ADR-004](adr/004-memory-sink-handles.md)
on why briefs and contract outputs are memory-namespace documents.

## Responsibility map

| Layer | Primary tier | Key interfaces / tools                                              | Owning ADR  | Phase     |
|-------|--------------|---------------------------------------------------------------------|-------------|-----------|
| L4    | application  | `compile_brief`, `get_brief`, `instantiate_contract`, staleness daemon | ADR-003, 004 | 6, 7, 8  |
| L3    | application  | `get_document_bundle`, `get_outline`, `search_sections`, `assemble_dossier`, authority + staleness signals | ADR-003     | 3, 4, 5   |
| L2    | application  | `record_observation`, `recall`, `supersede`, `MemoryContract`       | ADR-004     | 2         |
| L1    | application  | typed `Edge`, `expand`, `cluster`, backlink walks                   | ADR-003     | 4, 5      |
| L0    | substrate    | `hybridSearch`, chunker, embeddings, FTS5                           | (v1)        | unchanged |
| Adapter tier | seam | `SourceConnector`, `DeliveryAdapter`, `ChangeFeed`, registry, conformance suite | ADR-001, 002 | 1     |
| Implementations | adapter | `obsidian-fs` (v2.0.0), `stub` (Phase 3 evals), `notion-api` (v3, Phase 10) | ADR-002     | 1, 10     |

ADR ownership identifies the doc the layer's normative invariants live in;
layers commonly cross-link to multiple ADRs at the implementation level.

## Data flow — read path

A read request — `search_hybrid`, `get_document_bundle`, `recall`,
`get_brief`, any L1+ tool — follows the same pipeline:

```text
  MCP client (Claude / ChatGPT / generic)
       │ tool call
       ▼
  src/server.ts            (Zod validation, dispatch)
       │
       ▼
  L1/L2/L3/L4 handler      (no fs, no chokidar imports — enforced by CI grep)
       │ resolves DocIds   via registry.resolveHandle()
       ▼
  Adapter tier             (Registry → SourceConnector instance)
       │ Document(s)        ← readDocument() / listDocuments()
       ▼
  L0 query path            (SQLite: notes, chunks, edges, embeddings via doc_uri)
       │
       ▼
  Assembly                 (bundle/outline/dossier/brief tools compose Documents)
       │
       ▼
  Citation packet          (doc_id + display_url + title, per ADR-001 I-5)
       │
       ▼
  MCP response             ({ content: [{ type: "text", text: JSON }] })
```

Two properties of this pipeline matter for v3:

- **Layers above the Adapter tier never branch on `scheme`.** The handler
  asks the registry for a `Document` by `doc_id`; if the registry resolves
  to `notion-api` instead of `obsidian-fs`, no calling code changes.
- **Citations always carry `doc_id` + `display_url`.** `doc_id` is identity
  (URI per [ADR-001](adr/001-document-identity.md)). `display_url` is
  presentation, minted by the adapter (e.g. `obsidian://open?vault=…&file=…`).
  The two are never collapsed.

## Data flow — write path

Writes are restricted to the Adapter tier's `DeliveryAdapter` and pass
through two guards before touching the source-of-truth:

```text
  MCP client
       │ tool call (record_observation / compile_brief / write_note / …)
       ▼
  src/server.ts
       │
       ▼
  L2/L4 handler            (constructs Document with provenance properties)
       │
       ▼
  Adapter tier — registry.resolveDelivery(doc_id)
       │
       ▼
  ┌────────────────────────────────────────────────────────────────────┐
  │  Guard A — Memory-namespace validator (ADR-004)                     │
  │    Does doc_id resolve inside a MemorySink?                         │
  │      yes → require provenance properties; reject if missing         │
  │      no  → require write_enabled on this DeliveryAdapter; reject    │
  │            if the target is under a registered MemorySink           │
  └────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌────────────────────────────────────────────────────────────────────┐
  │  Guard B — Hash-protected OCC (ADR-003, ADR-004)                    │
  │    For update/delete: compare expected_hash with current source     │
  │    hash; reject as { ok:false, reason:"conflict" } if drifted       │
  └────────────────────────────────────────────────────────────────────┘
       │ atomic write (rename(2)) via obsidian-fs.DeliveryAdapter
       ▼
  Filesystem  (Notion API in v3 — same guards, different transport)
       │ ChangeFeed fires
       ▼
  Indexer    (catchupVault on resume; live update on watch)
       │
       ▼
  audit_log  (write_audit row with doc_id, kind, actor, prev_hash, new_hash)
```

Three invariants this enforces:

- **Memory-sink writes are the only way agent-authored content enters the
  vault.** Bypassing Guard A is structurally impossible — the registry has
  exactly one `DeliveryAdapter` per `(scheme, authority)` pair, and the
  adapter constructor binds the active `MemoryContract`.
- **Optimistic concurrency is uniform.** v1's `expectedHash` pattern extends
  to v2 via Guard B; updates from two concurrent agents produce a
  `WriteConflict` discriminated-union result, not a silent overwrite.
- **Audit is unconditional.** Every successful write produces an
  `audit_log` row keyed by `doc_uri`. Memory writes additionally carry the
  contract version so contract migrations can be reconstructed.

## Source-neutrality contract

v2.0.0 ships exactly one adapter implementation: `obsidian-fs`. The Adapter
tier exists anyway, because the seams are the entire reason v3's Notion
support is additive.

```text
v2.0.0 handles (one scheme):
  obsidian-fs://my-vault/projects/Atlas.md
  obsidian-fs://my-vault/_memory/observations/2026-05-14-alice-prefers-async.md

v3 handles (additive, no change to L0–L4):
  notion-api://acme/page/c5b9f3a2-1234-4abc-9def-0123456789ab
```

When Phase 10 adds the Notion connector, the entire change is contained to
five files:

- `src/adapters/source/notion-api/index.ts` — `SourceConnector` impl.
- `src/adapters/delivery/notion-api/index.ts` — `DeliveryAdapter` impl.
- `src/adapters/change-feed/notion-api/index.ts` — `ChangeFeed` impl (polling
  first, webhooks later).
- `src/adapters/index.ts` — one `registry.registerSource('notion-api', …)`
  line.
- `~/.vault-memory/config.toml` — gains a `[[connectors]] scheme = "notion-api"`
  section.

No change to `src/search/`, `src/graph/`, `src/memory/`, `src/bundles/`,
`src/briefs/`, `src/contracts/`. The registry resolves the handle; the
calling code never knows the underlying scheme. The conformance test suite
(from Phase 1) is the practical bar a new connector must clear; the manifest
+ factory + passing tests is the plugin protocol.

The four ADRs each carry at least one `obsidian-fs://` worked example AND
one `notion-api://` worked example precisely so Phase 9's adversarial review
can grep both schemes in every ADR and confirm the seams are documented for
both. The maxim: **source-neutrality is a property of the seams, not of the
implementations.**

## Out of scope (v2)

Per `.planning/REQUIREMENTS.md` "Out of Scope":

- **No cloud sync / SaaS backend.** vault-memory stays local-first; no
  remote service holds index state or user content.
- **No telemetry of any kind.** No analytics, no metrics-shipping, no error
  reporting. CI lints this (`scripts/lint-no-telemetry.sh`) to prevent drift.
- **No remote LLM bundling.** Embeddings stay on `localhost:11434` (Ollama).
  Phase 6's brief-compilation ADR is the first place vault-memory could call
  an LLM and it explicitly defers that to v2.x (caller supplies summarized
  text in v2.0.0).
- **No path-as-PK after Phase 1.** Core code keys on `doc_uri`. `path`
  survives as a denormalized cache column owned by the obsidian-fs adapter
  and is removed in v3.0.0 ([ADR-001](adr/001-document-identity.md) I-3).
- **No third-party / user-installable plugins in v2 or v3.** All connectors
  are first-party, built into the same `dist/cli.js` bundle. v3.0.0 ships
  with Notion; user-installable connectors are deferred to a future ADR.
- **No multi-machine daemon.** Per-session stdio stays the default for
  v2.0.0; a `--daemon` mode using MCP `streamable-http` is reserved for
  v2.1.x or v3.

## See also

- [docs/v2/MEMORY_CONTRACT.md](MEMORY_CONTRACT.md) — sibling doc on the
  agent-write contract (provenance, sink resolution, contract versioning).
- [docs/v2/AGENT_AGNOSTIC.md](AGENT_AGNOSTIC.md) — sibling doc on why the
  v2 surface is MCP-only and how non-Claude clients (ChatGPT Custom
  Connectors, generic MCP clients) consume it.
- [docs/v2/adr/001-document-identity.md](adr/001-document-identity.md) —
  opaque URI-style identity.
- [docs/v2/adr/002-adapter-seams.md](adr/002-adapter-seams.md) —
  `SourceConnector`, `DeliveryAdapter`, `ChangeFeed`, registry.
- [docs/v2/adr/003-document-shape.md](adr/003-document-shape.md) —
  canonical `Document`, `BlockNode`, `PropertyBag`, hash semantics.
- [docs/v2/adr/004-memory-sink-handles.md](adr/004-memory-sink-handles.md) —
  memory-sink resolution, sentinel file, contract validator.
- [.planning/ROADMAP.md](../../.planning/ROADMAP.md) — v2 phase plan.
- [.planning/REQUIREMENTS.md](../../.planning/REQUIREMENTS.md) — FND-01..14
  Phase 0 deliverables and the v2 out-of-scope register.
- [docs/dev/gsd-agent-knowledg-layer.md](../dev/gsd-agent-knowledg-layer.md)
  — the original v2 brief (maintainer-private; the source-of-truth for the
  layer model this doc synthesizes).
