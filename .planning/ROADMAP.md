# Roadmap: vault-memory v2 — Agentic Knowledge Layer

## Overview

Evolve vault-memory from v1.0.0 (a strong Layer 0 retrieval substrate over Obsidian) into v2.0.0 — a full agentic knowledge layer with memory namespace + provenance, bundles/dossiers + authority/staleness, graph-as-retrieval, compiled briefs, task contracts, and a Canvas authoring surface. The roadmap follows the v2 brief 0→10 with three research-derived adjustments: Phase 0 expands from 6 to 14 deliverables (relocated ADRs, hash-semantics, eval baselines, CI lints, adversarial review); the brief's Phase 4 (authority/staleness) folds into Phase 3 (bundles); a hard pre-Phase-10 premise-check gate is inserted before the v3 line. Phases are renumbered sequentially (0–9) to avoid confusion; the Notion connector (originally Phase 10) is deferred to v3.0.0 as a separate milestone tracked but out of v2 scope.

## Phases

**Phase Numbering:**
- Integer phases (0, 1, 2, ...): Planned milestone work
- Decimal phases (2.1, 2.2): Reserved for urgent insertions (INSERTED)

- [ ] **Phase 0: Foundation & decisions** - Lock ADRs, architecture docs, eval fixtures, regression baselines, CI lints
- [x] **Phase 1: Adapter extraction & tech-debt-up** - Install adapter seams, bump MCP SDK 1.29 + Zod 4, conformance suite
- [x] **Phase 2: Memory namespace & provenance contract** - Foundational safety invariant; labeled agent write-back via MemorySink
- [x] **Phase 3: Bundles + authority/staleness** - Document-tree retrieval, citation packets, recency/authority weights (folded brief Phase 3+4)
- [x] **Phase 4: Graph-as-retrieval** - Typed-edge expansion and community clustering (Complete 2026-05-17)
- [x] **Phase 5: Compiled brief layer** - Signature differentiator; briefs as documents with source-hash staleness daemon (Complete 2026-05-18)
- [ ] **Phase 6: Task contract DSL** - YAML+Zod contracts; list/describe/instantiate via MCP
- [ ] **Phase 7: Visual contract editor (Canvas)** - Obsidian Canvas ↔ YAML contract round-trip
- [ ] **Phase 8: Polish, eval suite, v2.0.0 release** - Release gate; CI eval suite; npm publish
- [ ] **Phase 9: Pre-Phase-10 premise check (HARD GATE)** - Verify seams, ADR conformance, capability descriptors before any v3 work

> **Note:** The brief's Phase 4 (authority/staleness) is folded into Phase 3. The brief's Phase 10 (Notion connector) is deferred to v3.0.0 — see [v3.0.0 — Deferred](#v300--deferred) section below.

## Phase Details

### Phase 0: Foundation & decisions
**Goal**: Lock ADRs, architecture docs, eval fixtures, regression baselines, and CI lints so every later phase builds on a stable, public substrate
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08, FND-09, FND-10, FND-11, FND-12, FND-13, FND-14
**Success Criteria** (what must be TRUE):
  1. All ADRs (001–004) live at `docs/v2/adr/` and are committed to the public repo (not gitignored), with explicit Invariants + Examples sections on each
  2. ADR-003 hash-semantics amendment specifies `hash = digest(blocks-as-plain-text + canonical PropertyBag)` and chunk-level `source_hashes` schema; ADR-004 specifies folder-default sink with config-only separate-vault option
  3. Architecture, memory-contract, and agent-agnostic docs published under `docs/v2/`; ADR index page at `docs/v2/adr/README.md` lists every contested choice
  4. Eval fixture vault (`evals/fixtures/v2-test-vault/` — 50–100 notes, coherent narrative) and v1-baseline regression suite (`evals/v1-baseline/`) frozen; tool-snapshot tests pin `tools/list` JSON for all 23 v1 tools
  5. Adversarial-review sub-agent confirms a Phase 10 agent could implement Notion from ADRs 001–004 alone; fixture-privacy and no-telemetry CI lints gate CI; maintainer signs off on all Phase 0 docs
**Plans**: 15 plans
- [x] 00-01-bootstrap-PLAN.md — install `yaml@^2.9.0`, add `lint:check`/`eval:baseline`/`eval:snapshot` scripts, narrow `docs/dev/` gitignore, seed CHANGELOG `[Unreleased] → ### Documentation`
- [x] 00-02-adr-001-vertical-slice-PLAN.md — MVP walking-skeleton: relocate ADR-001 via two-commit `git mv`+amend, add Invariants+Examples, seed `docs/v2/adr/README.md` index (proves the pattern for plans 03–05)
- [x] 00-03-adr-002-adapter-seams-PLAN.md — relocate ADR-002 to `002-adapter-seams.md` (filename rewrite), amend with Invariants+Examples covering all three seam interfaces, append index row
- [x] 00-04-adr-003-document-shape-PLAN.md — relocate ADR-003, amend with hash-semantics pseudocode (`sha256(canonical(blocks) || canonical(PropertyBag))`, NFC, LF, RFC 8785) + chunk-level `source_hashes` schema (D-05)
- [x] 00-05-adr-004-memory-sink-PLAN.md — relocate ADR-004, amend specifying folder-default sink as only code path with config-only separate-vault option, document `.memory-sink` sentinel (D-06)
- [x] 00-06-architecture-doc-PLAN.md — publish `docs/v2/ARCHITECTURE.md` layer model (L0 retrieval → L4 contracts) ≤800 lines
- [x] 00-07-memory-contract-doc-PLAN.md — publish `docs/v2/MEMORY_CONTRACT.md` defining the PropertyBag contract (`source`, `confidence`, `evidence`, `status`, `observed_at`, `superseded_by`, `type`)
- [x] 00-08-agent-agnostic-doc-PLAN.md — publish `docs/v2/AGENT_AGNOSTIC.md` ("MCP is canonical; Skills are one delivery mechanism")
- [x] 00-09-atlas-robotics-fixture-PLAN.md — ship hand-authored Atlas Robotics fixture vault (~75 notes across projects/meetings/people/decisions/references/_memory + per-category `_queries/*.yaml`)
- [x] 00-10-tool-registry-and-snapshot-PLAN.md — extract `src/tool-registry.ts` from `src/server.ts` (the one pre-approved src/ change), ship `dump-tools.mjs`, pin `evals/v1-baseline/tools-list.snapshot.json` for all 23 v1 tools
- [x] 00-11-v1-baseline-suite-PLAN.md — author `evals/v1-baseline/baseline.test.ts` (snapshot equality + parse-only behavioral floors with `.todo` execution stubs) and per-tool semantic-floor YAMLs
- [x] 00-12-ci-lints-and-workflow-PLAN.md — ship POSIX `scripts/check-fixture-privacy.sh` (FND-11), `scripts/lint-no-telemetry.sh` (FND-12), and `.github/workflows/ci.yml` gating both on PR + push-to-main
- [x] 00-13-adr-index-finalize-PLAN.md — audit and finalize `docs/v2/adr/README.md` (MADR-style table with 4 Accepted ADRs + ≥14 Open ADRs for v3-Phase-10)
- [x] 00-14-adversarial-review-PLAN.md — run `gsd-advisor-researcher` in a fresh Claude session against the four ADRs + three architecture docs, write `docs/v2/adr/ADVERSARIAL-REVIEW.md`, resolve every finding as Amended or Deferred-v3
- [x] 00-15-sign-off-PLAN.md — author `docs/v2/SIGN-OFF.md` (FND-01..14 checklist with resolving commit SHAs), refine CHANGELOG, capture maintainer PR approval (D-17)

### Phase 1: Adapter extraction & tech-debt-up
**Goal**: Stand up `SourceConnector` / `DeliveryAdapter` / `ChangeFeed` adapter seams with `obsidian-fs` as the v2 implementation, bundle MCP SDK 1.29 + Zod 4 upgrades, and prove client-agnosticism — all without user-visible behavior change
**Mode:** mvp
**Depends on**: Phase 0
**Requirements**: ADP-01, ADP-02, ADP-03, ADP-04, ADP-05, ADP-06, ADP-07, ADP-08, ADP-09, ADP-10, ADP-11, ADP-12, ADP-13, ADP-14, ADP-15
**Success Criteria** (what must be TRUE):
  1. All 324 v1 tests still pass and the v1-baseline eval regression suite is still green — Phase 1 is purely architectural with no user-visible change
  2. CI greps return zero hits outside adapter modules for `chokidar`, `gray-matter`, `path.join`/`path.resolve`, `fs.*`, `claude`/`Claude`, `obsidian://`, and bare `.md` literals; branded `DocId` nominal type rejects raw `string` at compile time
  3. `scripts/smoketest-non-claude.mjs` passes end-to-end against MCP Inspector or another non-Claude MCP client; README leads with "any MCP-aware agent" framing
  4. `@modelcontextprotocol/sdk` is on `^1.29.x` and `zod` is on `^4.x`; tool registrations migrated to `registerTool(...)`; Standard Schema wiring works
  5. Stub-adapter conformance test suite (pulled forward from brief Phase 10) is green; doc_uri dual-column migration (Strategy A) applied and backfilled
**Plans**: 6 plans
- [x] 01-01-PLAN.md — Type surface + branded DocId + adapter directory bootstrap (ADP-04, ADP-05, partial ADP-06)
- [x] 01-02-PLAN.md — doc_uri dual-column migration, Strategy A (v7 additive + v8 backfill) (ADP-07)
- [x] 01-03-PLAN.md — Source adapter extraction + `obsidian-fs` source impl + StubSource + conformance (ADP-01, partial ADP-06, partial ADP-13)
- [x] 01-04-PLAN.md — Delivery adapter + D-01 `formatDisplayUrl` + D-02 `client_info` + StubDelivery + conformance (ADP-02, partial ADP-06, partial ADP-13)
- [x] 01-05-PLAN.md — ChangeFeed adapter + StubChangeFeed + conformance + MCP SDK ^1.29 + Zod ^4 + `registerTool` × 23 + snapshot regen (ADP-03, ADP-08, ADP-09, partial ADP-06, partial ADP-13)
- [x] 01-06-PLAN.md — `scripts/lint-adapters.sh` + Inspector smoketest + AGENT_AGNOSTIC_AUDIT.md + README "any MCP-aware agent" rewrite + CI wiring + final phase-gate verification (ADP-10, ADP-11, ADP-12, ADP-14, ADP-15)

### Phase 2: Memory namespace & provenance contract
**Goal**: Establish the single non-negotiable safety invariant — agent writes go only to a labeled `MemorySink` with mandatory provenance properties, centralized at the `DeliveryAdapter.write()` chokepoint
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: MEM-01, MEM-02, MEM-03, MEM-04, MEM-05, MEM-06, MEM-07, MEM-08, MEM-09, MEM-10, MEM-11, MEM-12
**Success Criteria** (what must be TRUE):
  1. A naive `write_note` call targeting a memory-sink-resolved path is rejected with a clear, structured error message (verified by targeted test); `write_note`/`update_frontmatter` guards refuse memory-sink targets and refuse `source: agent` outside any configured sink
  2. `record_observation`, `recall`, and `supersede` MCP tools write/read labeled documents via the `DeliveryAdapter`; provenance validator (Guard A + Guard B) centralizes at `DeliveryAdapter.write()`, not at tool handlers
  3. `MemorySink` handle parser (`obsidian-fs://_memory/`) is the only resolver of sink-as-path; `.memory-sink` sentinel file prevents resolving against folders that lack it
  4. List-style memory operations (`memory_stats`, `list_sinks`) promoted to MCP Resources, cutting the v2.0.0 tool surface count; `audit_log` distinctly flags memory-sink writes
  5. ADR-004 amendment (folder-default vs separate-vault) committed before implementation; eval fixture includes a 20-document `_memory/` subset with diverse provenance labels
**Plans**: 9 plans (after revision: 02-03 was split into 02-03 + 02-03b to keep validator chokepoint focused and isolate v1-entry-point guards / bootstrap wiring)
- [x] 02-01-PLAN.md — ADR-004 amendment + MEMORY_CONTRACT alignment (MEM-12, doc-only) — wave 0
- [x] 02-02-PLAN.md — MemorySink runtime substrate (handle parser, registry, contract loader, sentinel, `decomposeDocId`, `pathInSink`/`joinVaultPath` helpers) (MEM-01, MEM-05, MEM-06) — wave 0
- [x] 02-03-PLAN.md — Centralized provenance validator at the delivery seam + conformance cases 11–18 / sentinel cases 19–21 (MEM-05, MEM-06) — wave 1
- [x] 02-03b-PLAN.md — v1 entry-point Guards on `write_note`/`update_frontmatter`/`delete_note` + server bootstrap wiring (MemorySinkRegistry instantiation, ordering before catchup) + MEM-11 targeted MCP integration test (MEM-07, MEM-11) — wave 1
- [x] 02-04-PLAN.md — record_observation + supersede MCP tools (MEM-02, MEM-04) — wave 2
- [x] 02-05-PLAN.md — recall MCP tool + Phase-3-shaped citation packet (MEM-03) — wave 3
- [x] 02-06-PLAN.md — audit_log memory-sink discriminator + memory_stats/list_sinks Resources (MEM-08, MEM-09) — wave 4
- [x] 02-07-PLAN.md — 20-doc fixture extension + malformed-memory tree + smoke test (MEM-10) — wave 5
- [x] 02-08-PLAN.md — Phase 2 gate: full verification + traceability + CHANGELOG/STATE (final checkpoint) — wave 5

### Phase 3: Bundles + authority/staleness — COMPLETE (2026-05-17)
**Goal**: Deliver document-tree retrieval (bundles, outlines, sections, dossiers) with citation packets on every result, plus authority/staleness ranking signals — proven source-neutral against a stub adapter
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: ASM-01, ASM-02, ASM-03, ASM-04, ASM-05, ASM-06, ASM-07, ASM-08, ASM-09, ASM-10, ASM-11, ASM-12, ASM-13
**Success Criteria** (what must be TRUE):
  1. `get_document_bundle`, `get_outline`, `search_sections`, and `assemble_dossier` return results with a citation packet `{doc_id, source_handle, title, heading_path, mtime, hash, display_url}` on every item; ≥5 dossier eval queries pass with ≥0.8 precision/recall — **MET** (8 dossier queries shipped in `_queries/dossier.yaml`; all four tools return 8-field citation packets incl. REQUIRED `properties`)
  2. v1 default behavior is unchanged when no weights/filters are supplied — re-running the v1-baseline eval set produces identical results — **MET** (invariance pin in `hybrid.rescore.test.ts`; `baseline.test.ts` green; 23 v1 tool entries byte-identical)
  3. `search_hybrid` accepts optional `recency_weight`, `authority_weight`, and `superseded` filter; eval scenarios with stale-vs-fresh duplicates rank fresh higher when `recency_weight > 0`; `status: superseded` documents are hidden by default — **MET** (`recency.yaml` ASM-11 fixture; SQL-level filter via `notes_status` partial index)
  4. Stubbed second adapter (hard-coded `Document` objects) passes the same eval suite as `obsidian-fs` — proves source-neutrality before Phase 9 gate — **MET** (`src/adapters/stub/assembly-fixture.ts` 8-doc fixture + 10 source-neutrality conformance tests in `conformance.test.ts`; per RESEARCH §7 P/R evals run on obsidian-fs only, contract conformance runs on both)
  5. All search/bundle results carry `mtime`, `status` (if present), and `superseded_by` (if present); list-style assembly ops promoted to MCP Resources where applicable — **MET** (`mtime` is REQUIRED on every citation packet; `status` + `superseded_by` surfaced via `withBundleAnchorExtras` / `withDossierExtras`; ASM-13 disposition: no MVP candidates found, re-evaluate at Phase 5 `list_briefs` + Phase 6 `list_contracts` — see `docs/v2/PHASE-3-SIGN-OFF.md`)
**Plans**: 7 plans
- [x] 03-01-PLAN.md — Section identity substrate (migration 010, sections table, anchor algorithm, indexer hook)
- [x] 03-02-PLAN.md — `get_outline` MCP tool + assembly module skeleton
- [x] 03-03-PLAN.md — `search_sections` MCP tool (chunk-to-section promotion over the v1 hybrid pipeline)
- [x] 03-04-PLAN.md — `get_document_bundle` MCP tool (anchor + outline + backlinks + forward_links + recent_edits)
- [x] 03-05-PLAN.md — `search_hybrid` rescore (recency, authority, superseded filter) + 9-field SearchHit hydration
- [x] 03-06-PLAN.md — `assemble_dossier` MCP tool (type+key resolution, alias path, property rollups)
- [x] 03-07-PLAN.md — Conformance + source-neutrality proof + phase sign-off

### Phase 4: Graph-as-retrieval — COMPLETE (2026-05-17)
**Goal**: Promote backlinks/forward links from navigation tools to retrieval expansion via typed-edge graph traversal and community clustering, enabling Phase 5 brief compilation to use graph-driven source discovery
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: GRA-01, GRA-02, GRA-03, GRA-04, GRA-05
**Success Criteria** (what must be TRUE):
  1. `expand({seed_doc_ids, hops, edge_types?, filter_properties?})` returns typed-edge neighborhoods with metadata; `search_hybrid` accepts `expand: {hops: 1}` for auto-expansion of top-K results — **MET** (`expand` MCP tool shipped per plan 04-03 with shortest-path `via` dedup + `_memory/` opacity; `search_hybrid({expand: {hops, direction?, edge_types?}})` shipped per plan 04-04 as a strictly additive nested param; per-vault BFS isolation enforced at the `expand()` boundary; pinned by `src/graph/expand.integration.test.ts` + `src/search/hybrid-expand.integration.test.ts`)
  2. `cluster({query | seed_doc_ids, method: "edge-community"})` produces deterministic cluster summaries per fixture; opt-in/feature-flagged if computation is slow — **MET** (`cluster` MCP tool shipped per plan 04-05 via `graphology` + `graphology-communities-louvain` + `seedrandom`; D-12 determinism enforced at three control points (lexicographic DocId sort + seeded `rng` + smallest-member `cluster_id`); 5000-node hard cap with `force: true` override; pinned by `_queries/cluster.yaml` byte-snapshot)
  3. Edges carry an explicit `type` field per ADR-003 — schema supports `wikilink`, `frontmatter-ref`, `mention`, and `hyperlink` types — **MET** (migration 011 ships the `edges` table with `CHECK(type IN (...))` per plan 04-01; unified `extractAllEdges` extracts all four types in a single parse pass per plan 04-02; the v2.0.0-pinned `relation: "wikilink"` on assembly tools is now `relation: EdgeType`; `PHASE-4-WIDEN` markers retired)
  4. Eval fixture includes ≥5 "find me everything related to X" queries that are answered correctly by expansion (precision/recall ≥0.8) — **MET** (`_queries/expand.yaml` ships 8 hand-curated queries covering all four edge types, mixed-type traversal at hops 1 and 2, `_memory/` opacity, and the unknown-seed warning path; all eight queries clear `min_precision >= 0.8 / min_recall >= 0.8`; plus 3 `_queries/search-hybrid-with-expand.yaml` composition queries; plus `_queries/cluster.yaml` determinism snapshot; plus 6 cross-adapter conformance cases — see `docs/v2/PHASE-4-SIGN-OFF.md`)
**Plans**: 7 plans
- [x] 04-01-edges-substrate-PLAN.md — migration 011 + EdgesQueries + Database wiring + v1 graph tools additive `type` (GRA-04 substrate)
- [x] 04-02-edge-extractors-PLAN.md — indexer extracts mention/frontmatter-ref/hyperlink in a single per-note parse pass (GRA-04 indexer)
- [x] 04-03-expand-tool-PLAN.md — `expand()` BFS over typed edges with shortest-path `via` dedup + `_memory` opacity + MCP tool (GRA-01)
- [x] 04-04-search-hybrid-expand-PLAN.md — additive `search_hybrid({expand})` post-rescore attachment (GRA-03)
- [x] 04-05-cluster-tool-PLAN.md — Louvain wrapper via graphology + seeded RNG + 5000-node hard cap + MCP tool (GRA-02)
- [x] 04-06-evals-conformance-PLAN.md — `_queries/expand.yaml` + `cluster.yaml` + `search-hybrid-with-expand.yaml` + cross-adapter conformance (GRA-05)
- [x] 04-07-phase-gate-PLAN.md — tool-list snapshot regen + full eval + CHANGELOG + STATE + ROADMAP + sign-off doc

### Phase 5: Compiled brief layer
**Status:** ✅ shipped 2026-05-18 — 34 tools + 3 Resources; all 11 BRF requirements green; signature differentiator operational. See `docs/v2/PHASE-5-SIGN-OFF.md`.
**Goal**: Defeat the 85%-rediscovery failure mode by shipping compiled briefs as first-class `Document`s in `_memory/_briefs/` with deterministic source-hash staleness propagation — vault-memory's signature v2 differentiator
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: BRF-01, BRF-02, BRF-03, BRF-04, BRF-05, BRF-06, BRF-07, BRF-08, BRF-09, BRF-10, BRF-11
**Success Criteria** (what must be TRUE):
  1. After compiling a brief for a 20-document project, modifying one source flips the brief to `stale: true` within one change-feed cycle (verified by eval); the same scenario passes when the stub adapter is the change-feed source — proving source-neutrality — **MET** (`_queries/briefs-curated.yaml` + `_queries/briefs-staleness-stub.yaml`; `conformance.test.ts` BRF-11 block runs 4 cases × 2 adapters)
  2. `compile_brief` resolves its LLM strategy via the documented ladder MCP Sampling → local Ollama → caller-passed text (per the Phase 5 ADR); vault-memory never bundles a remote LLM SDK — **MET** (ADR-005 + `src/brief/llm-ladder.ts`; `bash scripts/lint-adapters.sh` green)
  3. `get_brief({target, max_age_days?, allow_stale?})` returns a fresh brief, or `stale: true` with the changed-source list, or null forcing recompile; `list_briefs` is exposed as an MCP Resource (not Tool) — **MET** (`src/brief/get.ts` D-13 + `src/brief/resources.ts` at `vault-memory://briefs`)
  4. Staleness daemon subscribes via `ChangeFeed.subscribe()`, runs single-owner enforced by `~/.vault-memory/locks/<vault>.lock`, replays missed events on startup, and preserves brief→source links across rename events — **MET** (`src/brief/daemon.ts` + `src/brief/lock.ts`; `daemon.test.ts` + conformance BRF-11 block)
  5. Briefs are `Document`s in `_memory/_briefs/` with properties `compiled_from`, `compiled_at`, chunk-level `source_hashes`, `confidence`, `target`, `purpose`; brief writes route through `DeliveryAdapter` — **MET** (`src/brief/compile.ts` + `default-brief-v1` MemoryContract; `compile.test.ts` Test 13 YAML round-trip)
**Plans**:
- [x] 05-01-foundations-PLAN.md — ADR-005 + migration 013 + ChunkId brand + source-hashes helpers + `default-brief-v1` contract (BRF-01, BRF-02)
- [x] 05-02-compile-and-get-PLAN.md — OllamaClient.chat() + LLM ladder (D-10) + body validator (D-11) + `compile_brief` (D-12 supersede) + `get_brief` (D-13) + `briefs-curated.yaml` (BRF-03, BRF-04, BRF-10)
- [x] 05-03-staleness-daemon-PLAN.md — Lockfile + `BriefStalenessDaemon` (startup scan + ChangeFeed subscribe + rename grace) + server daemon bootstrap + cluster-driven brief eval (BRF-05, BRF-06, BRF-07, BRF-08)
- [x] 05-04-phase-gate-PLAN.md — `list_briefs` MCP Resource + cross-adapter conformance + `briefs-staleness-stub.yaml` + tools-list snapshot regen + PHASE-5-SIGN-OFF + ROADMAP flip (BRF-09, BRF-11)

### Phase 6: Task contract DSL
**Goal**: Ship declarative task contracts as YAML documents (Zod-validated) in `_contracts/`, addressable by name, instantiable via MCP, with handle-based source/sink portability that sets the v3 multi-source template
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: CON-01, CON-02, CON-03, CON-04, CON-05, CON-06, CON-07, CON-08, CON-09, CON-10, CON-11, CON-12
**Success Criteria** (what must be TRUE):
  1. A non-Claude MCP client can list contracts via `list_contracts` (MCP Resource), describe one via `describe_contract`, and successfully run `instantiate_contract` against the fixture vault
  2. Three reference contracts ship and pass eval scenarios with expected output shape: `meeting-prep`, `project-status`, `code-review-brief`
  3. Override mechanism is proven — pointing a contract at the stub connector via `source_overrides` yields the same shaped output as `obsidian-fs`, demonstrating handle-based portability
  4. Contract schema (`version`, `name`, `inputs`, `sources`, `assembly`, `output_shape`, `write_back`) is Zod-4 validated; variable handle pattern (`{{default_source}}`) works in all reference contracts; comments are preserved on round-trip
  5. Phase 6 ADR documents the Tools vs Prompts decision; `yaml ^2.6` is the only net-new runtime dependency
**Plans:** 3/4 plans executed
Plans:
- [x] 06-01-foundations-PLAN.md — ADR-006 + migration 014 contract_audit + [contracts] config block + type catalog + $ref resolver + buildInputSchema + ContractRegistry + slug + Zod ContractFileSchema + Wave-0 stubs
- [x] 06-02-loader-registry-hot-reload-PLAN.md — startContractRegistry (boot scan + ChangeFeed hot reload per D-LOAD) + syncAutoRegistered dynamic tool registration (D-A1) + register_contracts_as_tools tool + snapshot regen (34 -> 35)
- [x] 06-03-instantiate-describe-verbs-PLAN.md — resolveTemplate (D-A2c) + PeerMcpRegistry (D-A2a peer-MCP, Pitfall F4) + verbDispatcher (11 baseline + literal + mcp:// with Q-TIMEOUT) + instantiateContract orchestrator (CON-06, all 11 InstantiateError reasons) + describeContract (CON-05, Q-DESCRIBE) + snapshot regen (35 -> 37)
- [ ] 06-04-reference-contracts-evals-gate-PLAN.md — 3 reference contracts (CON-07) + 4 eval scenarios (CON-08, CON-10) + stub-parity conformance + non-Claude smoketest extension (CON-09) + list_contracts & list_contract_verbs MCP Resources (CON-04, D-A2b) + PHASE-6-SIGN-OFF + CHANGELOG + ROADMAP checkbox

### Phase 7: Visual contract editor (Canvas)
**Goal**: Deliver an Obsidian Canvas authoring surface that round-trips to/from the YAML contract DSL, with file-watcher recompilation as the default path (full plugin reserved for spike-outcome decision)
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: CAN-01, CAN-02, CAN-03, CAN-04, CAN-05, CAN-06, CAN-07, CAN-08, CAN-09
**Success Criteria** (what must be TRUE):
  1. Canvas-to-contract compiler parses Obsidian's `.canvas` JSON, validates the graph, and emits a valid YAML contract; contract-to-canvas decompiler completes the round-trip
  2. Round-trip acceptance: YAML → canvas → recompile is semantically equivalent after canonicalization (reframed from "byte-equal modulo whitespace"); three reference canvases ship in `examples/canvas-contracts/`
  3. Spike resolves the canonical direction — default recommendation is file-watcher recompile (hash-gated via v1 SuppressionSet to prevent infinite loops), with descope path to "Canvas as view, YAML as authoring" if spike fails
  4. Canvas templates include palette nodes for every available assembly tool from Phases 3–5; documentation and screencast walkthrough are published
**Plans:** 4 plans
Plans:
- [x] 06-01-foundations-PLAN.md — ADR-006 + migration 014 contract_audit + [contracts] config block + type catalog + $ref resolver + buildInputSchema + ContractRegistry + slug + Zod ContractFileSchema + Wave-0 stubs
- [x] 06-02-loader-registry-hot-reload-PLAN.md — startContractRegistry (boot scan + ChangeFeed hot reload per D-LOAD) + syncAutoRegistered dynamic tool registration (D-A1) + register_contracts_as_tools tool + snapshot regen (34 -> 35)
- [ ] 06-03-instantiate-describe-verbs-PLAN.md — resolveTemplate (D-A2c) + PeerMcpRegistry (D-A2a peer-MCP, Pitfall F4) + verbDispatcher (11 baseline + literal + mcp:// with Q-TIMEOUT) + instantiateContract orchestrator (CON-06, all 11 InstantiateError reasons) + describeContract (CON-05, Q-DESCRIBE) + snapshot regen (35 -> 37)
- [ ] 06-04-reference-contracts-evals-gate-PLAN.md — 3 reference contracts (CON-07) + 4 eval scenarios (CON-08, CON-10) + stub-parity conformance + non-Claude smoketest extension (CON-09) + list_contracts & list_contract_verbs MCP Resources (CON-04, D-A2b) + PHASE-6-SIGN-OFF + CHANGELOG + ROADMAP checkbox
**UI hint**: yes

### Phase 8: Polish, eval suite, v2.0.0 release
**Goal**: Cut v2.0.0 — full eval suite in CI, README rewritten around the new pitch, migration guide for v1 users, npm publish; tool surface inventory within the agreed budget
**Mode:** mvp
**Depends on**: Phase 7
**Requirements**: REL-01, REL-02, REL-03, REL-04, REL-05, REL-06, REL-07, REL-08, REL-09
**Success Criteria** (what must be TRUE):
  1. v2.0.0 git tag exists, CI auto-creates the GitHub Release, and `npm publish` has completed successfully
  2. Full eval suite (v1-baseline + v2 fixtures + stub-adapter conformance) runs in CI and is required for merge; CHANGELOG curated lists every user-visible v2 change
  3. README rewritten around the new pitch ("agentic knowledge layer over Obsidian; more sources coming"); Roadmap section names Phase 9/v3 explicitly; maintainer signs off on README
  4. `MIGRATION-V1-TO-V2.md` documents SDK 1.29 and Zod 4 major bumps for downstream library consumers; tool API delta is additive only (no breaking changes)
  5. Tool surface inventory is ≤32 tools (with MCP Resources promotion) or ≤40 tools (without) at v2.0.0 ship
**Plans:** 4 plans
Plans:
- [x] 06-01-foundations-PLAN.md — ADR-006 + migration 014 contract_audit + [contracts] config block + type catalog + $ref resolver + buildInputSchema + ContractRegistry + slug + Zod ContractFileSchema + Wave-0 stubs
- [ ] 06-02-loader-registry-hot-reload-PLAN.md — startContractRegistry (boot scan + ChangeFeed hot reload per D-LOAD) + syncAutoRegistered dynamic tool registration (D-A1) + register_contracts_as_tools tool + snapshot regen (34 -> 35)
- [ ] 06-03-instantiate-describe-verbs-PLAN.md — resolveTemplate (D-A2c) + PeerMcpRegistry (D-A2a peer-MCP, Pitfall F4) + verbDispatcher (11 baseline + literal + mcp:// with Q-TIMEOUT) + instantiateContract orchestrator (CON-06, all 11 InstantiateError reasons) + describeContract (CON-05, Q-DESCRIBE) + snapshot regen (35 -> 37)
- [ ] 06-04-reference-contracts-evals-gate-PLAN.md — 3 reference contracts (CON-07) + 4 eval scenarios (CON-08, CON-10) + stub-parity conformance + non-Claude smoketest extension (CON-09) + list_contracts & list_contract_verbs MCP Resources (CON-04, D-A2b) + PHASE-6-SIGN-OFF + CHANGELOG + ROADMAP checkbox

### Phase 9: Pre-Phase-10 premise check (HARD GATE)
**Goal**: Verify that the architectural premise for the v3 multi-source line still holds — adapter seams unbroken, ADRs unviolated, conformance suite green, capability descriptors well-tested — before any Notion code is written
**Mode:** mvp
**Depends on**: Phase 8
**Requirements**: GAT-01, GAT-02, GAT-03, GAT-04, GAT-05
**Success Criteria** (what must be TRUE):
  1. All Phase 1 CI greps return zero hits on `main` (chokidar, gray-matter, paths, `Claude`, `obsidian://`, `.md` literals outside adapters) — verified by gate script
  2. Adversarial-review sub-agent confirms ADRs 001–004 remain unviolated by code shipped in Phases 2–8; any findings are closed before sign-off
  3. Stub-adapter conformance suite is green on `main`; capability-descriptor test coverage meets the agreed threshold for plugin-architecture promotion
  4. Maintainer signs off explicitly: Phase 10 (v3 Notion connector work) is cleared to begin; without this sign-off, no v3 code is written
**Plans:** 4 plans
Plans:
- [ ] 06-01-foundations-PLAN.md — ADR-006 + migration 014 contract_audit + [contracts] config block + type catalog + $ref resolver + buildInputSchema + ContractRegistry + slug + Zod ContractFileSchema + Wave-0 stubs
- [ ] 06-02-loader-registry-hot-reload-PLAN.md — startContractRegistry (boot scan + ChangeFeed hot reload per D-LOAD) + syncAutoRegistered dynamic tool registration (D-A1) + register_contracts_as_tools tool + snapshot regen (34 -> 35)
- [ ] 06-03-instantiate-describe-verbs-PLAN.md — resolveTemplate (D-A2c) + PeerMcpRegistry (D-A2a peer-MCP, Pitfall F4) + verbDispatcher (11 baseline + literal + mcp:// with Q-TIMEOUT) + instantiateContract orchestrator (CON-06, all 11 InstantiateError reasons) + describeContract (CON-05, Q-DESCRIBE) + snapshot regen (35 -> 37)
- [ ] 06-04-reference-contracts-evals-gate-PLAN.md — 3 reference contracts (CON-07) + 4 eval scenarios (CON-08, CON-10) + stub-parity conformance + non-Claude smoketest extension (CON-09) + list_contracts & list_contract_verbs MCP Resources (CON-04, D-A2b) + PHASE-6-SIGN-OFF + CHANGELOG + ROADMAP checkbox

## Deployment model — load-bearing assumption for all phases

**vault-memory v2 is single-user-runtime over a shared-vault substrate.** This is not a deployment detail; it is the assumption several v2 design choices rest on, and the framing that everything beyond v2 either extends or replaces.

- **Storage substrate (shared):** The Obsidian vault — a directory of `.md` files plus `_memory/`, `_briefs/`, `_contracts/`, `.memory-sink` sentinels — is synced across users via Syncthing / iCloud / git / Dropbox. The sync substrate is **outside vault-memory's concern**; vault-memory sees a filesystem.
- **Runtime (per-user):** Each user runs their own `vault-memory serve` process locally. Each has their own `~/.vault-memory/` (config.toml, SQLite DBs, locks, models). Each indexes the synced vault independently into their local SQLite. Each user's agent talks to that user's local MCP server.
- **What's shared via the sync substrate, not the runtime:** Source notes (user-authored); briefs in `_memory/_briefs/`; memory observations in `_memory/`; task contracts in `_contracts/`. When user A's `compile_brief` writes a brief, Syncthing/git syncs it to user B's machine; B's `chokidar` watcher indexes it; B's daemon evaluates staleness for **B's** view of the source docs.
- **What's runtime-local, never shared:** SQLite DBs (chunks, embeddings, edges, FTS5, brief_sources, daemon_state); embedding vectors (each user re-embeds locally via their own Ollama); lock files; audit log; cross-encoder ONNX models.
- **Why content-stable ChunkIds matter cross-user:** Phase 5 D-04 (`<n>` = `first-7-of-sha256(NFC(chunk_text))`) is not just a single-user nicety. Both users compute the same fragments over the same source text, so user B's daemon can interpret user A's brief's `source_hashes` map without re-coordination. Ordinal `<n>` would have made every brief look perpetually stale to everyone except its author.
- **Conflict resolution lives in the sync substrate, not vault-memory.** When two users compile briefs with the same `target` concurrently, git/Syncthing handles the file-level conflict (merge markers or last-write-wins). vault-memory itself sees only whichever file ended up on disk.

The v3 and v4 lines below are framed against this baseline.

## v3.0.0 — Deferred

The following work is **out of v2 scope** and tracked for the v3.0.0 line. It is listed here so the maintainer and users have visibility into what comes after v2.0.0; it does not count against v2 phase progress.

**v3.0.0 preserves the single-user-runtime model.** Everything in v3 is about widening the *storage substrate* (more source types, more delivery targets) — never about sharing the runtime between users. Multi-user is a v4 question (see below).

### Phase 10 (v3.0.0): Notion connector & multi-source proof
**Status**: Deferred — gated by Phase 9 sign-off
**Goal (sketch)**: Ship the first non-Obsidian source/delivery/change-feed adapter (Notion), promoting the adapter seams from "interfaces with one implementation" to a real plugin architecture; resolve the 14 open ADRs (005–01x) on identity stability, link resolution, property equivalence, granularity, write semantics, auth, watch, rate limits, embedding strategy, cross-source memory, caching, sync, Notion sinks, and capability discovery
**Tracked requirements (v3, not v2)**: NOT-01 through NOT-07 (Notion connector); DMN-01 through DMN-03 (MCP daemon mode, v2.1.x or v3.0.0); TPC-01 through TPC-03 (third-party connectors, post-v3)
**Premise check**: Phase 9 of this roadmap. No v3 code is written until Phase 9 passes.

### Phase 11 (v3.x, IDEA — not a decision): `postgres-fs` storage adapter
**Status**: Idea — not committed; surfaces a path, does not lock it in
**Why it's listed here:** The adapter seams Phase 1 introduced (`SourceConnector` / `DeliveryAdapter` / `ChangeFeed`) make this technically additive. If a power user's vault grows past what local SQLite comfortably indexes (rough mental model: 100k+ notes, multi-GB embeddings), or if a user wants their vault-memory state backed by hosted Postgres (Supabase, Neon, RDS) for backup / cross-device availability, a `postgres-fs` adapter would let them swap storage without rewriting the retrieval layer.

**What it would (probably) ship:**
- `src/adapters/source/postgres-fs.ts` reading Obsidian vault files but indexing into Postgres (`pgvector` for embeddings, `pg_trgm` or `pg_search`/ParadeDB for BM25, native B-tree indexes for the edges/brief_sources reverse-index tables)
- `src/adapters/delivery/postgres-fs.ts` and `src/adapters/change-feed/postgres-fs.ts` — same seam contracts, Postgres-backed
- A migration tool moving an existing SQLite vault DB to Postgres (one-shot, additive — SQLite remains the default)

**Explicit non-goals for v3.x:**
- **Still single-user-runtime.** A `postgres-fs` adapter does not share runtime between users. Each user connects their `vault-memory serve` to their own Postgres database (or their own schema in a shared one). No auth, no ACL, no row-level security in v3.
- **Not "Ghost.build" or any other agent-DB SaaS.** Evaluated 2026-05-18 and rejected: cloud-only, no retrieval primitives, no local-first path, violates the v2 brand constraint. `postgres-fs` is a *storage adapter*, not a managed service.
- **Not pgvector evangelism.** SQLite + sqlite-vec stays the default. Postgres is an option for users who need it.

**Open ADRs (v3 territory, do not author until premise check passes):**
- ADR-PGS-01 — connection model (per-user-per-vault DB? shared schema-per-user? cloud-hosted vs self-hosted?)
- ADR-PGS-02 — vector extension choice (`pgvector` baseline vs `pgvectorscale` for scale)
- ADR-PGS-03 — BM25 path (`pg_trgm` good-enough vs ParadeDB `pg_search` for parity with SQLite FTS5)
- ADR-PGS-04 — migration semantics (one-shot SQLite → Postgres dump? shadow-write during transition? rollback story?)
- ADR-PGS-05 — synchronous-vs-async (today `better-sqlite3` is sync; Postgres clients are async — does this ripple through `src/db/queries/*.ts`?)

**Premise check (gates Phase 11 from starting):** Phase 9 (v2 hard gate) still passes after the postgres-fs work; adapter seams unviolated; CI greps zero outside adapters; capability descriptors still well-tested.

**Tracked requirements:** PGS-01 through PGS-NN (placeholder — to be defined when/if this is promoted from idea to commitment).

## v4.0.0 — Anticipated (IDEAS, not decisions)

**v4.0.0 is a different product line, not v3 with more storage options.** Everything in this section is a sketch of where vault-memory *could* go, not a roadmap. The purpose of listing v4 here is so future-you (and contributors) understand the lineage of design decisions: certain v2 choices (opaque DocIds, adapter seams, content-stable ChunkIds, provenance-on-every-agent-write, MCP-as-canonical-interface) were made anticipating that v4 might happen, even if v4 never ships.

### The framing: from per-user-runtime to hive-mind

vault-memory v1–v3 sits between *a user* and *their agent*. The user thinks, writes, and organizes; the agent reads that content and acts on the user's behalf. The agent's effectiveness is bounded by what *one human's* expression has captured.

v4 asks: **what if vault-memory sat between *a group* and *their shared swarm of agents*?** A team of humans contributes content the way a hive of bees contributes to comb — each member's work accumulates into a larger body of knowledge that any member (human or agent) can draw on to achieve more than they could alone. The "magic ingredient" is not better LLMs or better vector search; it's a substrate where:

- **Humans express via content** — their natural mode (writing, organizing, linking notes), unchanged from v2
- **Agents read that content with full provenance, authority, and freshness signals** — knowing whose work is whose, what's authoritative, what's stale, what's been superseded
- **Agents contribute back into the same substrate via labeled MemorySinks** — observations, briefs, dossiers — each carrying provenance attributing them to the agent and (new in v4) the user-on-whose-behalf the agent acted
- **The substrate compounds** — every human contribution and every agent contribution becomes a citable source for future work, with the staleness daemon ensuring no one acts on rotted context

The product question v4 answers: *how do humans and agents collaborate in a shared knowledge environment, with the same safety and provenance guarantees that v2 established for single-user use?*

### Why v4 is "different product line," not "v3 with auth"

The v2 → v3 path is **additive at the adapter seam**: more sources, more delivery targets, same runtime model. A `postgres-fs` adapter doesn't touch Phase 2's MemorySink invariants or Phase 5's brief layer. It's a storage swap.

The v3 → v4 path is **architectural rework** because nearly every design decision made under "single-user-runtime" assumes a single agent identity. v4 has to redesign:

- **Identity & authentication** — currently zero. v4 needs principals (humans and agents), auth (OAuth? OIDC? mTLS?), agent-on-behalf-of-user delegation
- **Access control on MemorySinks** — currently a single sentinel marks a folder agent-writable. v4 needs per-principal ACLs: "agent X acting for user Y may write to memory sink Z"
- **Per-user provenance** — currently `source: agent` is enough. v4 needs `source: agent`, `agent_id`, `acted_for_user`, `acted_at_principal` — and validators that enforce it
- **Concurrent-write conflict resolution** — currently delegated to the sync substrate (git/Syncthing). v4 with a shared runtime needs application-level resolution (CRDTs? operational transforms? last-writer-wins with notification?)
- **Multi-tenant briefs** — when user A compiles a brief in a shared environment, does user B see it? Always? Opt-in? Only briefs B has permission to read?
- **Authority signals across users** — Phase 3's `authority_weight` currently has no meaning. In v4, "alice's notes about Atlas are authoritative; bob's are speculative" becomes a query-time signal
- **The staleness daemon becomes a coordinator** — currently a single in-process daemon per user. In v4, one daemon per shared environment, or a distributed daemon protocol, or per-user daemons that gossip
- **Audit log becomes per-principal** — who-did-what-when across the entire hive, not just one user's view

**Postgres+pgvector is the *likely* (not certain) storage substrate for v4** — not because of vector search (sqlite-vec already does that), but because Postgres has row-level security, mature multi-tenant patterns, async clients suited to a shared server, and an enterprise migration story. The `postgres-fs` work in v3.x is what makes v4 *implementable* — but it does not by itself make v4 *real*. v4 is everything *above* the storage layer that v2/v3 didn't have to think about.

### Why we're capturing this now, not when v4 starts

Two reasons:

1. **Several v2 design decisions are load-bearing for v4 even though they were made for v2's own reasons.** Opaque `DocId`s, the `Document.properties` PropertyBag, content-stable ChunkIds, MemorySink-as-handle-not-path, provenance-on-every-agent-write, MCP-as-canonical-interface — all of these are necessary-but-not-sufficient for v4. If we'd made the *other* choice at any of those forks, v4 would require a v2 rewrite first. Documenting v4-as-anticipated tells future-you why these choices were worth defending against pressure to simplify them.
2. **The v2 → v4 path likely runs *through* v3, not around it.** v3's `postgres-fs` adapter is the substrate v4 needs; v3's Notion connector proves the seam discipline that v4's multi-principal ACL layer relies on. Knowing v4 is on the horizon shapes how aggressively we hold the line on Phase 9's premise check.

### What v4 is NOT

- **Not a cloud SaaS pivot.** Self-host MUST remain a first-class deployment. v4 adds *multi-user* as a capability; it does not remove *local-first* as a deployment option. A team running v4 on their own infrastructure must be possible.
- **Not a CRDT product.** vault-memory is not Notion / Roam / Logseq. The hive-mind framing is about *shared knowledge*, not *real-time co-editing*. Conflict resolution may use CRDTs internally, but co-editing is not a feature.
- **Not a chat / messaging substrate.** Agents communicate via reading and writing content, not via direct message-passing. The "hive" coordinates through accumulated content, not real-time signals.
- **Not a hosted LLM service.** MCP Sampling still routes LLM calls back to the caller's environment. vault-memory in v4 is a knowledge layer with multi-user semantics; it is not an LLM provider.
- **Not committed.** This entire v4 section is exploratory. No v4 code is written until (a) v2.0.0 ships, (b) v3.0.0 ships, (c) a credible signal exists that the hive-mind use case is real and underserved, and (d) a v4 brief equivalent to the v2 brief has been authored and locked.

### Tracked requirements (placeholder)

**MUL-01 through MUL-NN — to be defined when/if v4 is promoted from idea to commitment.** Topics the v4 brief would need to resolve: principal/identity model, ACL semantics, agent-on-behalf-of-user delegation, multi-tenant MemorySink namespacing, concurrent-write resolution, cross-user authority signals, distributed/centralized staleness coordination, audit log scoping, opt-in/opt-out brief sharing, cross-principal supersede semantics, hive-wide eval discipline.

## Progress

**Execution Order:**
Phases execute in numeric order: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9
(Decimal phases reserved for INSERTED urgent work; none planned at roadmap creation.)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Foundation & decisions | 0/TBD | Not started | - |
| 1. Adapter extraction & tech-debt-up | 0/TBD | Not started | - |
| 2. Memory namespace & provenance contract | 16/16 | Complete   | 2026-05-15 |
| 3. Bundles + authority/staleness | 0/TBD | Not started | - |
| 4. Graph-as-retrieval | 7/7 | Complete   | 2026-05-17 |
| 5. Compiled brief layer | 4/4 | Complete   | 2026-05-18 |
| 6. Task contract DSL | 3/4 | In Progress|  |
| 7. Visual contract editor (Canvas) | 0/TBD | Not started | - |
| 8. Polish, eval suite, v2.0.0 release | 0/TBD | Not started | - |
| 9. Pre-Phase-10 premise check (HARD GATE) | 0/TBD | Not started | - |

---
*Roadmap created: 2026-05-14*
*Granularity: standard | Mode: mvp/yolo | Parallelization: enabled*
