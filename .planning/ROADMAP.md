# Roadmap: vault-memory v2 — Agentic Knowledge Layer

## Overview

Evolve vault-memory from v1.0.0 (a strong Layer 0 retrieval substrate over Obsidian) into v2.0.0 — a full agentic knowledge layer with memory namespace + provenance, bundles/dossiers + authority/staleness, graph-as-retrieval, compiled briefs, task contracts, and a Canvas authoring surface. The roadmap follows the v2 brief 0→10 with three research-derived adjustments: Phase 0 expands from 6 to 14 deliverables (relocated ADRs, hash-semantics, eval baselines, CI lints, adversarial review); the brief's Phase 4 (authority/staleness) folds into Phase 3 (bundles); a hard pre-Phase-10 premise-check gate is inserted before the v3 line. Phases are renumbered sequentially (0–9) to avoid confusion; the Notion connector (originally Phase 10) is deferred to v3.0.0 as a separate milestone tracked but out of v2 scope.

## Phases

**Phase Numbering:**
- Integer phases (0, 1, 2, ...): Planned milestone work
- Decimal phases (2.1, 2.2): Reserved for urgent insertions (INSERTED)

- [ ] **Phase 0: Foundation & decisions** - Lock ADRs, architecture docs, eval fixtures, regression baselines, CI lints
- [x] **Phase 1: Adapter extraction & tech-debt-up** - Install adapter seams, bump MCP SDK 1.29 + Zod 4, conformance suite
- [ ] **Phase 2: Memory namespace & provenance contract** - Foundational safety invariant; labeled agent write-back via MemorySink
- [ ] **Phase 3: Bundles + authority/staleness** - Document-tree retrieval, citation packets, recency/authority weights (folded brief Phase 3+4)
- [ ] **Phase 4: Graph-as-retrieval** - Typed-edge expansion and community clustering
- [ ] **Phase 5: Compiled brief layer** - Signature differentiator; briefs as documents with source-hash staleness daemon
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
- [ ] 02-03b-PLAN.md — v1 entry-point Guards on `write_note`/`update_frontmatter`/`delete_note` + server bootstrap wiring (MemorySinkRegistry instantiation, ordering before catchup) + MEM-11 targeted MCP integration test (MEM-07, MEM-11) — wave 1
- [ ] 02-04-PLAN.md — record_observation + supersede MCP tools (MEM-02, MEM-04) — wave 2
- [ ] 02-05-PLAN.md — recall MCP tool + Phase-3-shaped citation packet (MEM-03) — wave 3
- [ ] 02-06-PLAN.md — audit_log memory-sink discriminator + memory_stats/list_sinks Resources (MEM-08, MEM-09) — wave 4
- [ ] 02-07-PLAN.md — 20-doc fixture extension + malformed-memory tree + smoke test (MEM-10) — wave 5
- [ ] 02-08-PLAN.md — Phase 2 gate: full verification + traceability + CHANGELOG/STATE (final checkpoint) — wave 5

### Phase 3: Bundles + authority/staleness
**Goal**: Deliver document-tree retrieval (bundles, outlines, sections, dossiers) with citation packets on every result, plus authority/staleness ranking signals — proven source-neutral against a stub adapter
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: ASM-01, ASM-02, ASM-03, ASM-04, ASM-05, ASM-06, ASM-07, ASM-08, ASM-09, ASM-10, ASM-11, ASM-12, ASM-13
**Success Criteria** (what must be TRUE):
  1. `get_document_bundle`, `get_outline`, `search_sections`, and `assemble_dossier` return results with a citation packet `{doc_id, source_handle, title, heading_path, mtime, hash, display_url}` on every item; ≥5 dossier eval queries pass with ≥0.8 precision/recall
  2. v1 default behavior is unchanged when no weights/filters are supplied — re-running the v1-baseline eval set produces identical results
  3. `search_hybrid` accepts optional `recency_weight`, `authority_weight`, and `superseded` filter; eval scenarios with stale-vs-fresh duplicates rank fresh higher when `recency_weight > 0`; `status: superseded` documents are hidden by default
  4. Stubbed second adapter (hard-coded `Document` objects) passes the same eval suite as `obsidian-fs` — proves source-neutrality before Phase 9 gate
  5. All search/bundle results carry `mtime`, `status` (if present), and `superseded_by` (if present); list-style assembly ops promoted to MCP Resources where applicable
**Plans**: TBD

### Phase 4: Graph-as-retrieval
**Goal**: Promote backlinks/forward links from navigation tools to retrieval expansion via typed-edge graph traversal and community clustering, enabling Phase 5 brief compilation to use graph-driven source discovery
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: GRA-01, GRA-02, GRA-03, GRA-04, GRA-05
**Success Criteria** (what must be TRUE):
  1. `expand({seed_doc_ids, hops, edge_types?, filter_properties?})` returns typed-edge neighborhoods with metadata; `search_hybrid` accepts `expand: {hops: 1}` for auto-expansion of top-K results
  2. `cluster({query | seed_doc_ids, method: "edge-community"})` produces deterministic cluster summaries per fixture; opt-in/feature-flagged if computation is slow
  3. Edges carry an explicit `type` field per ADR-003 — schema supports `wikilink`, `frontmatter-ref`, `mention`, and `hyperlink` types
  4. Eval fixture includes ≥5 "find me everything related to X" queries that are answered correctly by expansion (precision/recall ≥0.8)
**Plans**: TBD

### Phase 5: Compiled brief layer
**Goal**: Defeat the 85%-rediscovery failure mode by shipping compiled briefs as first-class `Document`s in `_memory/_briefs/` with deterministic source-hash staleness propagation — vault-memory's signature v2 differentiator
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: BRF-01, BRF-02, BRF-03, BRF-04, BRF-05, BRF-06, BRF-07, BRF-08, BRF-09, BRF-10, BRF-11
**Success Criteria** (what must be TRUE):
  1. After compiling a brief for a 20-document project, modifying one source flips the brief to `stale: true` within one change-feed cycle (verified by eval); the same scenario passes when the stub adapter is the change-feed source — proving source-neutrality
  2. `compile_brief` resolves its LLM strategy via the documented ladder MCP Sampling → local Ollama → caller-passed text (per the Phase 5 ADR); vault-memory never bundles a remote LLM SDK
  3. `get_brief({target, max_age_days?, allow_stale?})` returns a fresh brief, or `stale: true` with the changed-source list, or null forcing recompile; `list_briefs` is exposed as an MCP Resource (not Tool)
  4. Staleness daemon subscribes via `ChangeFeed.subscribe()`, runs single-owner enforced by `~/.vault-memory/locks/<vault>.lock`, replays missed events on startup, and preserves brief→source links across rename events
  5. Briefs are `Document`s in `_memory/_briefs/` with properties `compiled_from`, `compiled_at`, chunk-level `source_hashes`, `confidence`, `target`, `purpose`; brief writes route through `DeliveryAdapter`
**Plans**: TBD

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
**Plans**: TBD

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
**Plans**: TBD
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
**Plans**: TBD

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
**Plans**: TBD

## v3.0.0 — Deferred

The following work is **out of v2 scope** and tracked for the v3.0.0 line. It is listed here so the maintainer and users have visibility into what comes after v2.0.0; it does not count against v2 phase progress.

### Phase 10 (v3.0.0): Notion connector & multi-source proof
**Status**: Deferred — gated by Phase 9 sign-off
**Goal (sketch)**: Ship the first non-Obsidian source/delivery/change-feed adapter (Notion), promoting the adapter seams from "interfaces with one implementation" to a real plugin architecture; resolve the 14 open ADRs (005–01x) on identity stability, link resolution, property equivalence, granularity, write semantics, auth, watch, rate limits, embedding strategy, cross-source memory, caching, sync, Notion sinks, and capability discovery
**Tracked requirements (v3, not v2)**: NOT-01 through NOT-07 (Notion connector); DMN-01 through DMN-03 (MCP daemon mode, v2.1.x or v3.0.0); TPC-01 through TPC-03 (third-party connectors, post-v3)
**Premise check**: Phase 9 of this roadmap. No v3 code is written until Phase 9 passes.

## Progress

**Execution Order:**
Phases execute in numeric order: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9
(Decimal phases reserved for INSERTED urgent work; none planned at roadmap creation.)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Foundation & decisions | 0/TBD | Not started | - |
| 1. Adapter extraction & tech-debt-up | 0/TBD | Not started | - |
| 2. Memory namespace & provenance contract | 3/9 | In Progress|  |
| 3. Bundles + authority/staleness | 0/TBD | Not started | - |
| 4. Graph-as-retrieval | 0/TBD | Not started | - |
| 5. Compiled brief layer | 0/TBD | Not started | - |
| 6. Task contract DSL | 0/TBD | Not started | - |
| 7. Visual contract editor (Canvas) | 0/TBD | Not started | - |
| 8. Polish, eval suite, v2.0.0 release | 0/TBD | Not started | - |
| 9. Pre-Phase-10 premise check (HARD GATE) | 0/TBD | Not started | - |

---
*Roadmap created: 2026-05-14*
*Granularity: standard | Mode: mvp/yolo | Parallelization: enabled*
