# vault-memory — Agentic Knowledge Layer (v2)

## What This Is

vault-memory is an MIT-licensed, local-first MCP server that exposes Obsidian vaults
to MCP-aware agents (Claude Code, Claude desktop, ChatGPT Custom Connectors, generic
MCP clients) as a set of tools for search, graph navigation, frontmatter queries, and
atomic writes. Today (v1.0.0) it is a strong **retrieval substrate** — hybrid search
(semantic + BM25 + RRF, optional cross-encoder rerank), 23 MCP tools, live indexing,
multi-vault, hash-protected writes. The v2 project evolves it from "Layer 0 retrieval"
into a full **agentic knowledge layer**: memory namespace with provenance, document-tree
retrieval, authority/staleness signals, graph-as-retrieval, a compiled-brief layer that
beats the "agents rediscover 85% of context every run" failure mode, and user-defined
**task contracts** that any MCP-aware agent can discover and instantiate.

## Core Value

**Local-first, source-agnostic-ready, agentic knowledge layer over your Obsidian notes
— with the memory namespace as a non-negotiable safety invariant.** Agents never write
silently into user notes; every agent-authored document carries provenance properties
and lives in a labeled `MemorySink`.

## Requirements

### Validated

<!-- Shipped in v0.x → v1.0.0 (Layer 0 retrieval substrate). -->

- ✓ Local SQLite-per-vault storage with raw/derived/audit layers — v1.0.0
- ✓ Hybrid retrieval (semantic via Ollama + BM25/FTS5 + RRF) — v1.0.0
- ✓ Optional ONNX cross-encoder reranking (BAAI/bge-reranker-v2-m3) — v1.0.0
- ✓ Live indexing via chokidar file-watcher + DebouncedQueue — v1.0.0
- ✓ Multi-vault registration with fan-out search — v1.0.0
- ✓ 23 MCP tools (search, graph, frontmatter, write, audit, model mgmt, schema inference) — v1.0.0
- ✓ Hash-protected atomic writes with SuppressionSet — v1.0.0
- ✓ OB1 / Custom Connector flat-shape adapters (`search`, `fetch`) — v0.9.0
- ✓ Schema inference (`suggest_frontmatter`, three-layer) — v0.10.0
- ✓ Agent self-orientation (`vault_stats`, `recent_notes`) — v0.9.0
- ✓ Per-model embeddings tables + shadow-indexing for model upgrades — v1.0.0
- ✓ Skills pack (install, add-vault, audit-vault-health, find-stale-notes, triage-inbox) — v0.9.2

<!-- Shipped in v2 phase execution. -->

- ✓ Typed-edge retrieval (`expand` BFS primitive, `search_hybrid({expand})` additive auto-expansion) — Phase 4 (graph-as-retrieval), 2026-05-17
- ✓ Community-detection clustering (`cluster` MCP tool, graphology + Louvain, deterministic seed) — Phase 4, 2026-05-17
- ✓ `edges` table substrate with all 4 typed edges (wikilink, frontmatter-ref, mention, hyperlink) per ADR-003 — Phase 4, 2026-05-17
- ✓ Cross-adapter conformance for graph tools (obsidian-fs + stub adapter) — Phase 4, 2026-05-17

### Active

<!-- v2 scope per docs/dev/gsd-agent-knowledg-layer.md. Phase numbering follows the brief. -->

**Phase 0 — Foundation & decisions**
- [~] ADR-001 Document identity (committed at `docs/dev/001-document-identity.md`)
- [~] ADR-002 Source & delivery seams (committed at `docs/dev/002-source-and-delivery-seams.md`)
- [~] ADR-003 Document shape (committed at `docs/dev/003-document-shape.md`)
- [~] ADR-004 Memory sink handles (committed at `docs/dev/004-memory-sink-handles.md`)
- [ ] Relocate ADRs from `docs/dev/` (gitignored) to `docs/v2/adr/` (public)
- [ ] `docs/v2/ARCHITECTURE.md` — layer model (adapter / L0 retrieval / L1 graph / L2 memory typology / L3 assembly / L4 contracts)
- [ ] `docs/v2/MEMORY_CONTRACT.md` — property contract (`source`, `confidence`, `evidence`, `status`, `observed-at`, `superseded-by`)
- [ ] `docs/v2/AGENT_AGNOSTIC.md` — client-axis statement: MCP canonical, Skills are one client
- [ ] `evals/fixtures/v2-test-vault/` — 50–100 note fixture with hand-labeled queries (≥3 per upcoming tool category)
- [ ] ADRs locked-in audit: explicit enough that a Phase 10 agent could implement Notion from ADRs alone

**Phase 1 — Adapter extraction & client-agnostic audit**
- [ ] `src/adapters/source/` with `SourceConnector` + `obsidian-fs.ts` (existing reader/indexer moves here)
- [ ] `src/adapters/delivery/` with `DeliveryAdapter` + `obsidian-fs.ts` (existing write/update/delete routes through)
- [ ] `src/adapters/change-feed/` with `ChangeFeed` + `obsidian-fs.ts` (chokidar relocates here, becomes the only place it's imported)
- [ ] `src/types.ts` gains canonical `Document`, `BlockNode`, `Edge`, `SourceHandle`, `MemorySink`, `ChangeEvent`
- [ ] DB migration: `doc_uri` column alongside or replacing `path` (per ADR-001)
- [ ] `scripts/smoketest-non-claude.mjs` — MCP Inspector or `mcp` SDK harness end-to-end
- [ ] `docs/v2/AGENT_AGNOSTIC_AUDIT.md` — every Claude/Obsidian-specific assumption in `src/` outside adapters
- [ ] README rewrite: "any MCP-aware agent" framing; Obsidian is the v2 source connector with more planned
- [ ] All 324 existing tests still pass; CI greps for `chokidar`/`path.join`/`Claude` outside adapter modules return zero

**Phase 2 — Memory namespace & provenance contract ⚠ FOUNDATIONAL**
- [ ] Config: per-vault `memory_sink = "obsidian-fs://_memory/"`; handle parser is the only path resolver
- [ ] `record_observation({claim, evidence, confidence, type, sink?})` — labeled write via DeliveryAdapter
- [ ] `recall({query, min_confidence, types, max_age_days, sink?})` — read with filters
- [ ] `supersede({doc_id, replacement_doc_id, reason})` — mark `status: superseded`, link forward
- [ ] `memory_stats({sink?})` — count by confidence/status/type
- [ ] Property validator rejecting memory-sink writes that miss required keys (operates on `Document.properties`)
- [ ] Guards on existing `write_note`/`update_frontmatter`: refuse memory-sink targets; refuse `source: agent` outside sink
- [ ] `audit_log` distinguishes memory-sink writes
- [ ] Open decision: namespace as separate vault vs folder (surface ADR amendment before implementing)

**Phase 3 — Bundles & document-tree retrieval**
- [ ] `get_document_bundle({doc_id, depth?})` — document + backlinks + forward links + block/section tree + recent edits
- [ ] `get_outline({doc_id})` — heading/block tree as navigable structure with chunk IDs
- [ ] `search_sections({query, limit})` — whole sections as retrieval unit (hybrid pipeline)
- [ ] `assemble_dossier({type, key})` — walks edges + properties to assemble a packet
- [ ] Citation packet on every result: `{doc_id, source_handle, title, heading_path, mtime, hash, display_url}`
- [ ] Stubbed second adapter (fake connector returning hard-coded `Document`s) passes same evals — proves source-neutrality

**Phase 4 — Authority & staleness signals**
- [ ] All search/bundle results carry `mtime`, `status`, `superseded_by`
- [ ] `search_hybrid` accepts `recency_weight`, `authority_weight`
- [ ] `superseded` filter; default hides `status: superseded` unless `include_superseded: true`
- [ ] v1 default behavior unchanged when weights are absent (verified by re-running v1 eval set)

**Phase 5 — Graph-as-retrieval** ✓ Validated (ROADMAP Phase 4, 2026-05-17)
- [x] `expand({seed_doc_ids, hops, edge_types?, filter_properties?})` — typed-edge neighborhood
- [x] `cluster({query | seed_doc_ids, method: "edge-community"})` — community detection on typed edge graph
- [x] `search_hybrid` accepts `expand: {hops: 1}` for auto-expansion of top-K
- [x] Edges carry explicit `type` field per ADR-003 — schema supports `wikilink`, `frontmatter-ref`, `mention`, `hyperlink`

**Phase 6 — Compiled brief layer**
- [ ] Briefs are `Document`s in `_memory/_briefs/` with `compiled_from`, `compiled_at`, `source_hashes`, `confidence`, `target`, `purpose`
- [ ] `compile_brief({target, source_doc_ids, purpose, max_tokens})` — returns brief's `doc_id`
- [ ] `get_brief({target, max_age_days?, allow_stale?})` — fresh / stale-tagged / null-for-recompile
- [ ] Staleness daemon subscribing to `ChangeFeed.subscribe()` — marks briefs stale when source hash changes
- [ ] `list_briefs({target?})` discovery
- [ ] ADR: `compile_brief` LLM strategy — caller passes summarized text vs vault-memory calls Ollama
- [ ] Brief writes go through `DeliveryAdapter`; staleness via `ChangeFeed`, never chokidar directly

**Phase 7 — Task contract DSL**
- [ ] Contract schema (YAML/JSON, Zod-validated) — `inputs`, `sources`, `assembly`, `output_shape`, `write_back`
- [ ] Contracts live as `Document`s in `_contracts/` namespace
- [ ] `list_contracts({source?})`, `describe_contract({name})`, `instantiate_contract({name, inputs, source_overrides?, sink_overrides?})`
- [ ] Three reference contracts: `meeting-prep`, `project-status`, `code-review-brief`
- [ ] Override mechanism proven: contract pointed at stub connector yields same shaped output
- [ ] Non-Claude MCP client can list and instantiate contracts

**Phase 8 — Visual contract editor (Obsidian Canvas)**
- [ ] Canvas-to-contract compiler (parses `.canvas` JSON → YAML contract)
- [ ] Contract-to-canvas decompiler (round-trip)
- [ ] Obsidian plugin or CLI scaffolder bootstrapping new contract canvases with palette nodes
- [ ] Three reference canvases in `examples/canvas-contracts/`
- [ ] Round-trip: YAML → canvas → save unchanged → recompile byte-equal (modulo whitespace)
- [ ] Spike decision: full plugin vs "edit Canvas in Obsidian, watcher recompiles"

**Phase 9 — Polish, eval suite, v2.0.0 release**
- [ ] Full eval suite passing; eval suite in CI
- [ ] CHANGELOG curated; README rewritten around new pitch
- [ ] Migration guide for v1 users ("nothing breaks, here's what's new")
- [ ] v2.0.0 tag + npm publish
- [ ] README "Roadmap" section names Phase 10 explicitly so users know multi-source is coming

**Phase 10 — Connector & delivery abstraction in practice (exploratory, v3.0.0 territory)**
- [ ] Premise-check passes: Phase 1 seams held; ADRs 001–004 unviolated; stub-adapter evals still green on main
- [ ] ADRs 005–01x resolving 14 open questions (identity stability, link resolution, property equivalence, granularity, write semantics, auth, watch, rate limits, embedding strategy, cross-source memory, caching, sync, Notion sinks, capability discovery)
- [ ] `src/adapters/source/notion-api.ts`, `src/adapters/delivery/notion-api.ts`, `src/adapters/change-feed/notion-api.ts`
- [ ] Capability descriptors on all interfaces; connector registry in config
- [ ] End-to-end test: Obsidian vault + Notion workspace, dossier from Notion, brief sourced from Notion written to Obsidian memory sink, staleness when Notion page edited
- [ ] No Phase 1–8 tool modified — only adapter modules and config grew

### Anticipated (IDEAS — not decisions)

**v3.x: `postgres-fs` storage adapter** — A `SourceConnector` / `DeliveryAdapter` / `ChangeFeed` implementation backed by Postgres (`pgvector` for embeddings, `pg_trgm` or ParadeDB for BM25). Preserves the single-user-runtime model — each user connects their own `vault-memory serve` to their own Postgres DB (self-hosted or Supabase / Neon / RDS). Listed because the adapter seams make it technically additive; not committed. See ROADMAP.md "Phase 11" and REQUIREMENTS.md "PGS-*". **Evaluated 2026-05-18:** Ghost.build was considered as an alternative path and rejected (cloud-only, no retrieval primitives, violates local-first). `postgres-fs` is a *storage adapter*, not a managed service.

**v4.0.0: Multi-user agent knowledge layer ("hive-mind")** — Lifts the single-user-runtime constraint. Strategic thesis: humans express via content (their natural mode); agents read with full provenance / authority / freshness signals; agents contribute back via labeled MemorySinks; the substrate compounds — every contribution becomes a citable source for future work across the team. Postgres+pgvector is the likely (not certain) storage substrate because Postgres has mature row-level security and multi-tenant patterns. Entire line is exploratory. Listed because several v2 design decisions (opaque DocIds, content-stable ChunkIds, provenance-on-every-agent-write, MCP-as-canonical) are load-bearing for v4 even though they were made for v2's own reasons — documenting v4-as-anticipated tells future-you why these choices are worth defending. **No v4 code until v2.0.0 ships, v3.0.0 ships, a credible signal exists, and a v4 brief is authored.** See ROADMAP.md "v4.0.0 — Anticipated" and REQUIREMENTS.md "MUL-*".

### Out of Scope

- **Cloud sync or hosted service** — local-first is the brand. No telemetry, no API keys for v2.
- **LLM calls from vault-memory core** — embeddings via Ollama only. Cross-encoder is opt-in. Phase 6 ADR will decide whether `compile_brief` may call Ollama (otherwise caller passes summarized text).
- **Network calls beyond `localhost:11434`** in v2 — Phase 10 (Notion) introduces optional outbound, gated per-connector, never by default.
- **Breaking v1.x tool shapes or behavior** — backwards compatibility is non-negotiable until a major version. Net-new tools get net-new names.
- **Obsidian plugin distribution** — Phase 8's plugin (if built) is bundled with the repo, not published to the Obsidian community plugin store this milestone.
- **Non-MCP delivery surfaces** (REST, GraphQL, websocket, native UI) — MCP is the canonical contract per AGENT_AGNOSTIC. Out of scope for v2.
- **Multi-user / collaboration / sharing** in v2 — single-user-runtime over shared-vault substrate (see Constraints → Deployment model). No CRDTs, no shared runtime, no auth in v2. The multi-user-shared-runtime case is anticipated as v4.0.0 (see "Anticipated" above) but explicitly **not** part of v2.

## Context

**Codebase state:** Mature, well-tested TypeScript MCP server. Node ≥22, ESM-only,
SQLite via `better-sqlite3` with `sqlite-vec` extension, embeddings via local Ollama.
324 tests across 35 files (vitest). Build via `tsup`. `src/` is organized into
domain modules: `schema/`, `chunker/`, `frontmatter/`, `graph/`, `config/`, `indexer/`,
`ollama/`, `audit/`, `search/`, `reader/`, plus `server.ts`, `cli.ts`, `types.ts`.
`.planning/codebase/` already contains a fresh map (ARCHITECTURE, STACK, STRUCTURE,
CONVENTIONS, INTEGRATIONS, TESTING, CONCERNS) as of 2026-05-14.

**Strategic thesis (Nate Jones, May 2026):** Agent production failure isn't bad
retrieval — it's missing **assembly**. Vector search is "one component inside a
knowledge layer," not the architecture. A production knowledge layer answers seven
questions: (1) work object, (2) retrieval unit, (3) authority, (4) permissions,
(5) provenance, (6) compiled context, (7) labeled write-back. vault-memory is
Layer 0 today; v2 builds Layers 1–4 on top, preserving Layer 0 unchanged.

**v3 line:** After v2.0.0 (Obsidian-only), Phase 10 promotes the adapter seams from
"interfaces with one implementation" to a real plugin architecture and ships a Notion
connector + delivery adapter as the first non-Obsidian end-to-end proof. v3 is opt-in
and additive.

**Authoring affordance for v2:** Task contracts can be authored visually via Obsidian
Canvas (canvas nodes = sources/filters/outputs, edges = data flow). Fallback is plain
YAML files in `_contracts/`. The compiler output is source-neutral so non-Canvas
authoring UIs (web, CLI) can produce the same YAML in the future.

**Current Phase 0 status:** ADRs 001–004 exist on disk but are gitignored at
`docs/dev/` (per commit `cbed220`, "internal dev notes, not part of public repo").
They were committed at `3c9322d` before the gitignore. Phase 0 still needs:
relocation to a public `docs/v2/adr/` path, three architecture/contract documents
(`ARCHITECTURE.md`, `MEMORY_CONTRACT.md`, `AGENT_AGNOSTIC.md`), and the eval
fixture vault.

**User & dev model:** Solo maintainer (Oliver Wrede). MIT license. Public repo
at `github.com/owrede/vault-memory`. End-users are developers using Claude Code
or other MCP clients. Maintainer authors the brief and stewards architecture; GSD
+ coding sub-agents do the implementation work.

## Constraints

- **Tech stack — TypeScript 5.7+, Node ≥22, ESM-only, MCP SDK ≥1.0.4.** Locked by
  existing v1.0.0 surface. No language/runtime changes during v2.
- **Local-only network — `localhost:11434` (Ollama) only in v2.** Phase 10 may add
  per-connector outbound calls, gated.
- **Backwards-compatible v1.x API.** Existing 23 tools must keep their shape and
  behavior through v2. New tools get new names. v2.0.0 may add behavior; it must
  not break.
- **Seam preservation — every read/write/watch goes through an interface from Phase
  1 onward.** chokidar, file paths, YAML-frontmatter-specific logic confined to the
  obsidian-fs adapter modules. Enforced by CI greps. Non-negotiable: Phase 10
  depends on this.
- **Memory namespace is sacrosanct.** Agent writes only to a labeled `MemorySink`;
  never silently into user notes. Single non-negotiable safety invariant. Validator
  at the `DeliveryAdapter` layer.
- **Document identity is opaque (URI-style).** `obsidian://<vault-name>/<vault-relative-path>`.
  File paths are presentation; they live only in the obsidian-fs adapter and the
  existing flat-shape `search`/`fetch` adapter contract.
- **`Document` is the canonical content type.** Every assembly tool consumes it.
  `properties: Record<string, unknown>` subsumes both YAML frontmatter and (future)
  Notion typed properties.
- **Test discipline — 324 tests, do not regress.** Every new tool ships unit tests
  in the same PR. Eval-style behavior tests for any retrieval/assembly change.
- **Branch hygiene — `phase-N-<slug>` off main; deliverable PRs onto the phase
  branch; merge to main only at phase sign-off.** Configured per the brief's
  Operating Rule 8.
- **Eval discipline — fixture vault in `evals/fixtures/` from Phase 0; every
  assembly PR runs the eval suite; regressions block merge.** Eval harness consumes
  `Document` objects (not raw markdown) from Phase 3 onward, so it can later run
  against a fixture Notion workspace.
- **No premature LLM coupling.** vault-memory has not historically called any LLM
  beyond embeddings. Phase 6 (briefs) is the first place this could change and
  requires an ADR.
- **Deployment model — single-user-runtime over shared-vault substrate.** This is
  load-bearing for all of v2 and v3. The Obsidian vault may be synced across users
  via Syncthing / iCloud / git / Dropbox (the sync substrate is outside vault-memory's
  concern), but each user runs their own `vault-memory serve` locally with their own
  `~/.vault-memory/` (config, SQLite DBs, locks, Ollama, models). Briefs, observations,
  and contracts sync via the filesystem; each user's local runtime independently
  indexes the synced content and computes its own staleness view. Content-stable
  ChunkIds (Phase 5 D-04) are what make this work cross-user without coordination —
  both users compute identical chunk fragments over the same source text. The v4.0.0
  hive-mind line is what would lift this constraint; v2 and v3 hold it.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Adopt the v2 brief (`docs/dev/gsd-agent-knowledg-layer.md`) as the authoritative project definition | Brief is detailed, internally consistent, already references ADRs 001–004 that are in git | ✓ Confirmed at GSD init |
| Scope GSD project = all of v2 (Phase 0 → v2.0.0), with Phase 10 visible but explicitly later (v3) | Maintainer wants one continuous roadmap to execute against; Phase 10 deferred until v2.0.0 ships | — Pending (executes through v2.0.0) |
| Document identity is opaque URI-style (`obsidian://...`), not file paths | ADR-001: paths are unstable across rename + don't generalize to Notion / web / RSS sources | — Pending implementation (Phase 1) |
| Adapter interfaces (`SourceConnector`, `DeliveryAdapter`, `ChangeFeed`) introduced in Phase 1 even with single impl | ADR-002: makes Phase 10 additive rather than rewrite; CI greps enforce the seam | — Pending implementation (Phase 1) |
| Normalized `Document` / `BlockNode` / `Edge` / property-bag types are the canonical content shape | ADR-003: subsumes Obsidian markdown+YAML and Notion blocks+typed properties | — Pending implementation (Phase 1) |
| `MemorySink` is a URI-style handle; defaults to `obsidian-fs://_memory/` folder; resolution layer is single point of change | ADR-004: enables sink-handle parity across sources; v3 swaps to Notion DB by changing one handle | — Pending implementation (Phase 2) |
| YOLO mode, Standard granularity, Parallel execution, Balanced models | Brief is locked enough to auto-approve; sub-agent parallelism matches brief's dispatch strategy | ✓ Configured at init |
| Research / plan check / verifier all enabled | Brief mandates per-phase acceptance criteria + sign-off gates — workflow agents enforce that | ✓ Configured at init |
| ADRs 001–004 currently live at `docs/dev/` (gitignored) and need relocation to public `docs/v2/adr/` | Brief specifies public-doc location; current location reflects an interim "internal notes" decision | ⚠️ Revisit in Phase 0 |
| `compile_brief` LLM strategy (caller-passed text vs Ollama call) | Brief explicitly defers this to a Phase 6 ADR | — Pending (Phase 6) |
| Memory namespace as folder vs separate vault | Brief flags this as a risk to surface as an ADR amendment before Phase 2 implementation | — Pending (Phase 2) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-17 after Phase 4 (graph-as-retrieval) completion*
