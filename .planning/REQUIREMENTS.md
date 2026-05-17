# Requirements: vault-memory v2 — Agentic Knowledge Layer

**Defined:** 2026-05-14
**Core Value:** Local-first, source-agnostic-ready, agentic knowledge layer over your Obsidian notes — with the memory namespace as a non-negotiable safety invariant.

## v1 Requirements

Requirements for the v2.0.0 release of vault-memory. Each maps to a roadmap phase. ID prefixes:
**FND** Foundation, **ADP** Adapters, **MEM** Memory namespace, **ASM** Assembly, **GRA** Graph, **BRF** Briefs, **CON** Contracts, **CAN** Canvas editor, **REL** Release, **GAT** Pre-Phase-10 gate.

### Foundation (Phase 0)

- [ ] **FND-01**: ADRs 001–004 relocated from `docs/dev/` (gitignored) to `docs/v2/adr/` (public, tracked)
- [ ] **FND-02**: ADR-003 amended to specify `Document.hash` semantics — covers `(blocks rendered to plain text) + (PropertyBag serialized canonically)`; chunk-level `source_hashes` schema
- [ ] **FND-03**: ADR-004 amended to specify folder-default `MemorySink` with config-only separate-vault option (no code branch)
- [ ] **FND-04**: Each ADR (001–004) gains explicit Invariants + Examples sections; adversarial-review sub-agent confirms a Phase 10 agent could implement Notion from ADRs alone
- [ ] **FND-05**: `docs/v2/ARCHITECTURE.md` published — layer model (Adapter / L0 retrieval / L1 graph / L2 memory / L3 assembly / L4 contracts)
- [ ] **FND-06**: `docs/v2/MEMORY_CONTRACT.md` published — property contract (`source`, `confidence`, `evidence`, `status`, `observed_at`, `superseded_by`, `type`) defined in terms of `Document.properties`
- [ ] **FND-07**: `docs/v2/AGENT_AGNOSTIC.md` published — MCP is canonical client interface; Skills are one delivery mechanism
- [ ] **FND-08**: `evals/fixtures/v2-test-vault/` ships — 50–100 notes with coherent narrative ("Atlas Robotics" or similar); ≥3 hand-labeled queries per upcoming tool category
- [ ] **FND-09**: `evals/v1-baseline/` regression suite frozen — every v1 tool's expected behavior captured for per-PR regression checks
- [ ] **FND-10**: Tool-snapshot tests pin `tools/list` JSON output for all 23 v1 tools — any drift fails CI
- [ ] **FND-11**: `scripts/check-fixture-privacy.sh` — CI lint preventing accidental private-vault commits
- [ ] **FND-12**: `scripts/lint-no-telemetry.sh` — CI lint preventing telemetry/analytics code from landing
- [ ] **FND-13**: Decision Log / ADR index page at `docs/v2/adr/README.md` listing every contested choice with numbered ADRs
- [ ] **FND-14**: Maintainer sign-off on all Phase 0 docs and ADRs

### Adapters & Tech-Debt-Up (Phase 1)

- [ ] **ADP-01**: `src/adapters/source/` module with `SourceConnector` interface and `obsidian-fs.ts` implementation — existing `src/reader/` and `src/indexer/` content refactored to satisfy interface; no external behavior change
- [ ] **ADP-02**: `src/adapters/delivery/` module with `DeliveryAdapter` interface and `obsidian-fs.ts` implementation — existing `write_note`/`update_frontmatter`/`delete_note` routes through; no external behavior change
- [ ] **ADP-03**: `src/adapters/change-feed/` module with `ChangeFeed` interface and `obsidian-fs.ts` (chokidar-backed) — all chokidar imports relocate here; thin async-iterator helper for staleness daemon
- [ ] **ADP-04**: `src/types.ts` gains canonical `Document`, `BlockNode`, `Edge`, `SourceHandle`, `MemorySink`, `ChangeEvent` types
- [ ] **ADP-05**: Branded `DocId` nominal type — not assignable from raw `string`
- [ ] **ADP-06**: Runtime capability descriptors on `SourceCapabilities` and `DeliveryCapabilities` (read-only/read-write, supports-watch/poll-only, supports-blocks/flat, `streaming`, `maxBatchSize`, `idempotent`)
- [ ] **ADP-07**: DB migration introducing `doc_uri` column (Strategy A — dual-column, staged across two migration versions); backfill logic
- [ ] **ADP-08**: `@modelcontextprotocol/sdk` bumped to `^1.29.x`; sampling, elicitation, extensions wired through
- [ ] **ADP-09**: `zod` bumped to `^4.x`; Standard Schema integration with MCP SDK 1.29
- [ ] **ADP-10**: `scripts/smoketest-non-claude.mjs` — MCP Inspector or `mcp` SDK harness verifies end-to-end against at least one non-Claude MCP client
- [ ] **ADP-11**: `docs/v2/AGENT_AGNOSTIC_AUDIT.md` published — every Claude/Obsidian-specific assumption in `src/` outside adapters and skills; each either fixed or filed with a Phase-10 label
- [ ] **ADP-12**: CI greps zero-hit outside adapters — `chokidar`, `gray-matter`, `path.join`/`path.resolve`, `fs.*`, `claude`/`Claude`, `obsidian://`, `.md` literals
- [ ] **ADP-13**: Conformance test suite (pulled forward from Phase 10) — stubbed second adapter passes the same suite as `obsidian-fs`
- [ ] **ADP-14**: README rewritten to lead with "any MCP-aware agent" not "Claude Code"; Obsidian framed as v2 source connector with more planned
- [ ] **ADP-15**: All 324 v1 tests still pass; v1-baseline eval regression suite still green

### Memory Namespace (Phase 2 — FOUNDATIONAL)

- [x] **MEM-01**: Per-vault config: `memory_sink = "obsidian-fs://_memory/"` — handle parser is the only resolver of sink-as-path
- [x] **MEM-02**: `record_observation({claim, evidence, confidence, type, sink?})` MCP tool — writes labeled document via `DeliveryAdapter`
- [x] **MEM-03**: `recall({query, min_confidence, types, max_age_days, sink?})` MCP tool — reads from sink with filters
- [x] **MEM-04**: `supersede({doc_id, replacement_doc_id, reason})` MCP tool — marks `status: superseded`, links forward
- [x] **MEM-05**: Property validator at `DeliveryAdapter.write()` — rejects memory-sink writes missing required provenance keys (Guard A); rejects `source: agent` writes outside any configured sink (Guard B); operates on `Document.properties`, not YAML directly
- [x] **MEM-06**: `.memory-sink` sentinel file written at sink-creation time; refuse to resolve a memory sink against a folder lacking the sentinel
- [x] **MEM-07**: Guards on existing `write_note` / `update_frontmatter` — refuse memory-sink targets; refuse `source: agent` outside sink
- [x] **MEM-08**: `audit_log` flags memory-sink writes distinctly (filterable)
- [x] **MEM-09**: List-style memory ops promoted from MCP tools to MCP Resources — `memory_stats`, `list_sinks`. Cuts v2.0.0 tool surface
- [x] **MEM-10**: Eval fixture includes a 20-document `_memory/` subset with diverse provenance labels
- [x] **MEM-11**: Targeted test confirms naive `write_note` to a memory-sink-resolved path is rejected with a clear error message
- [x] **MEM-12**: Phase 2 ADR amendment decides folder vs separate-vault — recommendation defaults to folder-with-config-option

### Assembly + Authority/Staleness (Phase 3 — folds brief Phase 3 + Phase 4)

- [ ] **ASM-01**: `get_document_bundle({doc_id, depth?: 1})` MCP tool — document + backlinks (with property snippets) + forward links + block/section tree + recent edits
- [ ] **ASM-02**: `get_outline({doc_id})` MCP tool — heading/block tree as navigable structure with chunk IDs per node
- [ ] **ASM-03**: `search_sections({query, limit})` MCP tool — whole sections (heading block + descendants) as retrieval unit; reuses hybrid pipeline
- [ ] **ASM-04**: `assemble_dossier({type, key})` MCP tool — walks edges + properties to assemble a packet (e.g. Person → linking notes + property aggregates)
- [ ] **ASM-05**: All four tools return a **citation packet**: `{doc_id, source_handle, title, heading_path, mtime, hash, display_url}`
- [ ] **ASM-06**: All search/bundle results carry `mtime`, `status` (if present), `superseded_by` (if present)
- [ ] **ASM-07**: `search_hybrid` accepts optional `recency_weight` and `authority_weight`
- [ ] **ASM-08**: `search_hybrid` accepts `superseded` filter; default hides `status: superseded` unless `include_superseded: true`
- [ ] **ASM-09**: v1 default behavior unchanged when no weights/filters supplied — proven by re-running v1-baseline eval set
- [ ] **ASM-10**: Eval fixture includes ≥5 dossier-style queries; each returns expected document set with ≥0.8 precision/recall
- [ ] **ASM-11**: Eval scenarios with deliberately stale-vs-fresh duplicates rank fresh higher when `recency_weight > 0`
- [ ] **ASM-12**: Stubbed second adapter (fake connector returning hard-coded `Document` objects) passes the same eval suite — proves source-neutrality
- [ ] **ASM-13**: List-style assembly ops promoted to MCP Resources where applicable (e.g. `list_dossiers`)

### Graph-as-Retrieval (Phase 4 — moved before brief layer)

- [x] **GRA-01**: `expand({seed_doc_ids, hops: 1|2, edge_types?, filter_properties?})` MCP tool — typed-edge neighborhood with metadata
- [x] **GRA-02**: `cluster({query | seed_doc_ids, method: "edge-community"})` MCP tool — community detection on typed edge graph; cluster summaries; deterministic per fixture; opt-in/feature-flagged if slow
- [x] **GRA-03**: `search_hybrid` accepts `expand: {hops: 1}` for auto-expansion of top-K results
- [x] **GRA-04**: Edges carry explicit `type` field per ADR-003 — schema supports `wikilink`, `frontmatter-ref`, `mention`, `hyperlink`
- [x] **GRA-05**: Eval fixture includes ≥5 "find me everything related to X" queries answered with expansion

### Compiled Briefs (Phase 5 — signature differentiator)

- [ ] **BRF-01**: Brief format and storage shape — `Document` in `_memory/_briefs/` with properties `compiled_from: [doc_id, ...]`, `compiled_at: <ts>`, `source_hashes: {chunk_id: hash}` (chunk-level), `confidence: inferred`, `target: <slug>`, `purpose: <free-text>`
- [ ] **BRF-02**: Phase 5 ADR resolves LLM strategy — default ladder MCP Sampling → local Ollama → caller-passed text; never bundle a remote LLM SDK
- [ ] **BRF-03**: `compile_brief({target, source_doc_ids, purpose, max_tokens})` MCP tool — returns brief's `doc_id`; routes through `DeliveryAdapter`
- [ ] **BRF-04**: `get_brief({target, max_age_days?, allow_stale?})` MCP tool — returns fresh brief, or `stale: true` with changed-source list, or null forcing recompile
- [ ] **BRF-05**: Staleness daemon subscribes to `ChangeFeed.subscribe()` — when a source chunk's hash changes, mark every brief referencing it `stale: true`; atomic, hash-protected
- [ ] **BRF-06**: Single-owner daemon enforced via lock file at `~/.vault-memory/locks/<vault>.lock`
- [ ] **BRF-07**: Daemon-startup replay handles missed events while daemon was down
- [ ] **BRF-08**: Rename-event handling preserves brief→source links
- [ ] **BRF-09**: `list_briefs({target?})` promoted to MCP Resource (not Tool)
- [ ] **BRF-10**: Eval scenario — compile a brief for a 20-document project; modify one source; verify brief flips to `stale: true` within one change-feed cycle
- [ ] **BRF-11**: Same staleness scenario passes when the stub connector is used as the change-feed source — proves source-neutrality

### Task Contract DSL (Phase 6)

- [ ] **CON-01**: Contract schema specified in YAML (with comment preservation), validated by Zod 4 — `version`, `name`, `description`, `inputs`, `sources`, `assembly`, `output_shape`, `write_back`
- [ ] **CON-02**: Contracts live as `Document`s in `_contracts/` namespace — discoverable through the same machinery as everything else; addressed by `name`
- [ ] **CON-03**: Sources and sinks referenced by **handle** (`obsidian-fs://my-vault`), not file path — variable handle pattern (`{{default_source}}`) supported
- [ ] **CON-04**: `list_contracts({source?})` MCP Resource — discovery
- [ ] **CON-05**: `describe_contract({name})` MCP tool — returns schema + input requirements + sources/sinks it touches
- [ ] **CON-06**: `instantiate_contract({name, inputs, source_overrides?, sink_overrides?})` MCP tool — runs assembly steps, returns shaped bundle
- [ ] **CON-07**: Three reference contracts ship: `meeting-prep`, `project-status`, `code-review-brief`
- [ ] **CON-08**: Each reference contract has eval scenarios with expected output shape
- [ ] **CON-09**: A non-Claude MCP client successfully lists and instantiates contracts
- [ ] **CON-10**: Override mechanism proven — test pointing a contract at the stub connector yields the same shaped output
- [ ] **CON-11**: Decision (Phase 6 ADR): whether contracts surface as MCP Tools, MCP Prompts, or both
- [ ] **CON-12**: New runtime dep: `yaml ^2.6` added (with rationale doc)

### Visual Contract Editor — Canvas (Phase 7 — spike-gated)

- [ ] **CAN-01**: Spike resolves canonical direction — default recommendation: file-watcher recompile, NOT full Obsidian plugin; descope to "Canvas as view, YAML as authoring" if spike fails
- [ ] **CAN-02**: Canvas-to-contract compiler — parses Obsidian's `.canvas` JSON, validates the graph, emits YAML contract
- [ ] **CAN-03**: Contract-to-canvas decompiler (round-trip)
- [ ] **CAN-04**: Canvas templates with palette nodes for each available assembly tool
- [ ] **CAN-05**: Optional Obsidian plugin OR CLI scaffolder bootstrapping new contract canvases (decision: spike outcome)
- [ ] **CAN-06**: Three reference canvases in `examples/canvas-contracts/`
- [ ] **CAN-07**: Round-trip acceptance — semantically equivalent after canonicalization (reframed from "byte-equal modulo whitespace")
- [ ] **CAN-08**: Hash-gated watcher reuses v1 `SuppressionSet` to prevent infinite recompile loops
- [ ] **CAN-09**: Documentation + screencast walkthrough

### Release & Polish (Phase 8 — v2.0.0)

- [ ] **REL-01**: Full eval suite passing; eval suite integrated in CI
- [ ] **REL-02**: CHANGELOG curated for v2.0.0 — every user-visible v2 change listed
- [ ] **REL-03**: README rewritten around new pitch — "agentic knowledge layer over Obsidian; more sources coming"
- [ ] **REL-04**: README "Roadmap" section names Phase 9/v3 explicitly so users know multi-source is coming
- [ ] **REL-05**: `MIGRATION-V1-TO-V2.md` — notes SDK and Zod major bumps for downstream library users; tool API delta (no breaking changes, additive only)
- [ ] **REL-06**: v2.0.0 git tag exists; CI auto-creates GitHub Release
- [ ] **REL-07**: npm publish completed
- [ ] **REL-08**: Tool surface inventory ≤32 tools (after MCP Resources promotion) or ≤40 (without)
- [ ] **REL-09**: Maintainer signs off on README rewrite

### Pre-Phase-10 Gate (Phase 9 — HARD GATE)

- [ ] **GAT-01**: All Phase 1 CI greps zero-hit on `main` — verified by gate script
- [ ] **GAT-02**: ADRs 001–004 unviolated — adversarial-review sub-agent run; findings closed
- [ ] **GAT-03**: Stub-adapter conformance suite green on `main`
- [ ] **GAT-04**: Capability-descriptor test coverage adequate for plugin-architecture promotion
- [ ] **GAT-05**: Maintainer sign-off — Phase 10 cleared to begin

## v2 Requirements

Deferred to a future release (vault-memory v3.0.0 line, opening to non-Obsidian sources). Tracked but not in this roadmap.

### Notion Connector (v3 — Phase 10 territory)

- **NOT-01**: ADRs 005–01x resolving the 14 open questions from the v2 brief (identity stability, link resolution, property/frontmatter equivalence, granularity, write semantics, auth/permissions, watch/change detection, rate limits, embedding strategy, cross-source memory, original-content caching, sync strategy, sink semantics in Notion, tool capability discovery)
- **NOT-02**: `src/adapters/source/notion-api.ts` — Notion source connector
- **NOT-03**: `src/adapters/delivery/notion-api.ts` — Notion delivery adapter (may ship in v3.1.0 after read-only v3.0.0)
- **NOT-04**: `src/adapters/change-feed/notion-api.ts` — polling-based change feed; webhook-based follow-up
- **NOT-05**: Connector registry — `config.toml` lists configured connectors by handle
- **NOT-06**: End-to-end mixed-source test — Obsidian vault + Notion workspace; dossier from Notion; brief sourced from Notion written to Obsidian memory sink; staleness on Notion page edit
- **NOT-07**: No Phase 1–8 tool modified — only adapter modules and config grew

### MCP Daemon Mode (v2.1.x or v3.0.0)

- **DMN-01**: Long-running daemon process (à la `ollama serve`) with thin per-session MCP shells
- **DMN-02**: `streamable-http` transport adoption once ecosystem solidifies
- **DMN-03**: Migration guide for users moving from per-session to daemon

### Third-Party Connectors (post-v3)

- **TPC-01**: Public plugin loading from `node_modules` with `ConnectorManifest` export
- **TPC-02**: Capability-handshake at load time
- **TPC-03**: Subprocess isolation option for untrusted connectors

## Out of Scope

Explicitly excluded for v2.0.0. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Cloud sync / hosted service | Local-first is the brand. No telemetry, no API keys for v2. |
| LLM calls from vault-memory core (beyond opt-in via Sampling/Ollama in Phase 5) | Embeddings via Ollama only. Cross-encoder is opt-in. Phase 5 ADR decides brief-compile path; never bundles a remote LLM SDK. |
| Network calls beyond `localhost:11434` | Phase 10 (Notion, deferred to v3) introduces optional outbound, gated per-connector, off by default. v2 stays local-only. |
| Breaking v1.x tool shapes or behavior | Backwards compat non-negotiable until a major version. Net-new tools get net-new names. |
| Obsidian community plugin store publication | Phase 7's plugin (if built) is bundled with the repo, not published this milestone. |
| Non-MCP delivery surfaces (REST/GraphQL/websocket/native UI) | MCP is canonical per AGENT_AGNOSTIC.md. Out of scope for v2. |
| Multi-user / collaboration / sharing / CRDTs | Single-user, single-machine product. |
| LLM-as-router / agent orchestration layer in vault-memory | vault-memory is a knowledge layer; the calling agent orchestrates. |
| Real-time chat / live multiplayer | Not in scope for a knowledge layer. |
| Bundled remote LLM SDK | Local-first violation. MCP Sampling routes to the caller's LLM. |
| Tool surface beyond ≤40 (or ≤32 with Resources promotion) at v2.0.0 | Tool-bloat pitfall — Atlassian/Lunar research shows 3× selection-accuracy collapse past ~20 tools. |
| YAML-frontmatter-specific logic outside the obsidian-fs adapter | Seam preservation invariant. Enforced by CI grep. |
| File-path manipulation outside `src/adapters/source/`, `delivery/`, `config/`, `cli.ts` | Seam preservation invariant. |
| Path-as-primary-key in DB after Phase 1 | Replaced by opaque `doc_uri` per ADR-001. |
| Phase 7 plugin distribution outside this repo | Bundled-only this milestone; community-store publication deferred to v3. |

## Traceability

Phase mapping (sequential numbering 0–9; brief's Phase 4 folded into Phase 3; brief's Phase 9.5 renumbered to Phase 9; brief's Phase 10 deferred to v3 as Notion connector milestone).

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 to FND-14 | Phase 0 | Pending |
| ADP-01 to ADP-15 | Phase 1 | Pending |
| MEM-01 to MEM-12 | Phase 2 | Complete |
| ASM-01 to ASM-13 | Phase 3 | Pending |
| GRA-01 to GRA-05 | Phase 4 | Complete (2026-05-17 — docs/v2/PHASE-4-SIGN-OFF.md) |
| BRF-01 to BRF-11 | Phase 5 | Pending |
| CON-01 to CON-12 | Phase 6 | Pending |
| CAN-01 to CAN-09 | Phase 7 | Pending |
| REL-01 to REL-09 | Phase 8 | Pending |
| GAT-01 to GAT-05 | Phase 9 | Pending |
| NOT-01 to NOT-07 | v3.0.0 (deferred) | Deferred |
| DMN-01 to DMN-03 | v2.1.x / v3.0.0 (deferred) | Deferred |
| TPC-01 to TPC-03 | post-v3 (deferred) | Deferred |

**Coverage:**
- v1 requirements: 114 total
- Mapped to phases 0–9: 114 ✓
- Unmapped: 0 ✓
- v2/v3 deferred: 13 (NOT-* + DMN-* + TPC-*)

(Brief's Phase 4 folded into Phase 3 — shared result shape: `mtime`/`status`/`superseded_by` on `Document.properties`. Brief's Phase 9.5 promoted to a real hard gate, renumbered to Phase 9 for sequential clarity. Brief's Phase 10 deferred to v3.0.0.)

---
*Requirements defined: 2026-05-14*
*Last updated: 2026-05-14 — phase mapping populated by roadmapper*
