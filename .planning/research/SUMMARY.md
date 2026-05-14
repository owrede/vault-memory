# Project Research Summary — vault-memory v2

**Project:** vault-memory v2 — Agentic Knowledge Layer
**Domain:** Local-first, MCP-canonical agentic knowledge layer over Obsidian, with source-pluggable seams for Notion/web/RSS in v3
**Researched:** 2026-05-14
**Confidence:** MEDIUM-HIGH overall — HIGH for MCP SDK / adapter pattern / memory primitives / eval discipline; MEDIUM for Phase 8 Canvas round-trip, Phase 6 LLM bake-off, and Phase 10 Notion client specifics (correctly deferred)
**Brownfield context:** Research scoped against the existing v2 brief (`docs/dev/gsd-agent-knowledg-layer.md`) and the four committed foundation ADRs (001 document identity, 002 source/delivery seams, 003 document shape, 004 memory sink handles).

## Executive Summary

The v2 brief is **buildable as written** with eight Phase 0 additions and one phase-ordering adjustment. The dominant risks — adapter seam erosion, memory namespace contamination, v1 backwards-compat regression, brief staleness false-negatives, MCP tool-surface bloat — are all addressable with guardrails installed by end of Phase 1. The recommended technical approach holds: stay on Node 22 + TypeScript 5.7 + better-sqlite3 + sqlite-vec, bump `@modelcontextprotocol/sdk` to `^1.29` and `zod` to `^4` in Phase 1, add one new runtime dependency (`yaml ^2.6`) in Phase 7. Everything else is in-place version bump or use-what-the-codebase-has.

Across stack, features, architecture, and pitfalls dimensions the four researchers converge on three substantive recommendations the brief does not yet capture:

1. **MCP Sampling resolves the Phase 6 LLM ADR before it gets written** — better than caller-passes-text (lossy) or bundling Ollama (couples vault-memory to a chat model). Sampling routes summarization to the connected agent's own configured LLM and degrades to local Ollama as a fallback. vault-memory never has to bundle a remote LLM SDK.
2. **Fold Phase 4 (authority/staleness) into Phase 3 (bundles).** They share the same result-shape extensions (`mtime`, `status`, `superseded_by` on `Document.properties`). Splitting costs more in plumbing than it saves; combining preserves an inert-default discipline (v1 behavior unchanged when weights absent).
3. **Promote list-style ops to MCP Resources, not Tools** (`list_briefs`, `list_contracts`, `list_sinks`, `memory_stats`). Cuts the v2.0.0 tool surface from ~40 to ~32 and addresses the tool-bloat pitfall at source rather than after the fact. ADR-004 already marks this as "partially adopted" — finish the move.

Memory namespace contamination remains the non-negotiable safety pitfall and centralizes at one chokepoint: `DeliveryAdapter.write()` enforces both Guard A (refuse memory-sink writes missing required provenance) and Guard B (refuse `source: agent` writes outside any configured sink). Defense-in-depth at tool handlers is welcome but not load-bearing.

## Key Findings

### Recommended Stack

vault-memory's v1 stack is in good shape for v2. Phase 1 should bundle one mechanical tech-debt-up alongside the adapter extraction: bump MCP SDK to `^1.29.x` (sampling + elicitation + extensions arrive together) and Zod to `^4` (Standard Schema, ~14× faster parse, MCP SDK 1.29 integration). One new runtime dependency lands in Phase 7 (`yaml`); reject `umzug`/`db-migrate`/`drizzle-kit` in favor of plain SQL migrations + SQLite `user_version` PRAGMA. See `STACK.md` for the full library-by-library inventory.

**Core technologies:**
- `@modelcontextprotocol/sdk ^1.29` — MCP server runtime; brings sampling (Phase 6 LLM ADR), elicitation, capability descriptors
- `zod ^4` — runtime validation; pairs with MCP SDK 1.29 via Standard Schema; major bump bundled with Phase 1 refactor
- `better-sqlite3` (unchanged, ^11.x) — Node 22's built-in `node:sqlite` is still experimental and lacks `sqlite-vec` extension loading; not viable for v2
- `sqlite-vec` (unchanged) — semantic search; no replacement candidates in 2026 for in-process embedded vector indexes
- `vitest` (unchanged) — roll-our-own eval harness atop vitest; DeepEval/RAGAS/Inspect-AI are Python; LangSmith/Braintrust are cloud-coupled (local-first violation); Promptfoo reserved for Phase 6 brief-quality LLM evals only
- `yaml ^2.6` (new, Phase 7) — task contract DSL; preserves comments which authoring needs
- `ollama` (unchanged) — embeddings; Phase 6 fallback for chat summarization when MCP Sampling unavailable

**MCP Sampling resolves Phase 6:** Route `compile_brief` summarization to the calling agent's already-configured LLM via the MCP sampling primitive (spec 2025-11-25). Fall back to local Ollama for non-sampling clients. Never bundle a remote LLM SDK. This is a third option the brief's Phase 6 decision-flag didn't enumerate and supersedes both (a) caller-passes-text and (b) call Ollama.

**Plain SQL migrations + `user_version` PRAGMA.** vault-memory will ship ~10 migrations over v2's lifetime. External tooling is overhead. Migration strategy for ADR-001's doc_uri column: **Strategy A — dual-column, staged across two migration versions.** SQLite forbids generated columns as PK, ruling out the virtual-generated approach.

### Expected Features

The 2026 agentic knowledge layer landscape has stabilized enough that table stakes are clear. v2 catches up to baseline through Phases 3–5 (without these, vault-memory v2 looks like a v1 point-release), then enters genuine differentiator territory at Phases 6 (compiled briefs with source-hash staleness — no current competitor ships this as an artifact-level feature) and 7 (declarative task contracts). Phase 8 (Canvas editor) is the highest-cut-risk feature. See `FEATURES.md` for the 10-table-stakes / 7-differentiator / 13-anti-feature catalogue and per-phase mapping.

**Must have (table stakes):**
- Memory namespace with provenance properties (`source`, `confidence`, `evidence`, `status`, `observed_at`, `superseded_by`, `type`) — mem0, Letta, Anthropic Memory tool, ICLR 2026 papers all converge here
- Document-tree / section retrieval — returns whole sections, not flat chunks
- Citation packets on every result — `{doc_id, source_handle, title, heading_path, mtime, hash, display_url}`
- Authority + staleness signals — `mtime`, `status: superseded`, `recency_weight`, `authority_weight`
- Graph-as-retrieval — typed-edge expansion beyond chunk search
- Backwards-compat with v1's 23 tools — non-negotiable through v2.x
- MCP client agnosticism — tested against non-Claude clients
- Local-first guarantee — `localhost:11434` only for v2; no telemetry

**Should have (differentiator):**
- Compiled brief layer with source-hash staleness — vault-memory's signature v2 feature; no direct competitor at this artifact level
- Task contract DSL (YAML) — declarative agent workflows; no external standard winning hard enough to align with (CrewAI/LangGraph/Anthropic Skills/OpenAI Assistants all different)
- Visual contract editor via Obsidian Canvas — file-watcher recompile beats full plugin (Stack + Features + Pitfalls converge on this)
- Source-pluggable seams from Phase 1 — sets up the v3 line without v2 cost

**Defer / out of scope:**
- LLM-as-router or agent orchestration in vault-memory core — let the agent orchestrate; vault-memory is a knowledge layer
- Cloud sync / multi-user / sharing / CRDTs — single-user, single-machine product
- REST/GraphQL/websocket surface — MCP is canonical
- Obsidian community plugin store publication this milestone

### Architecture Approach

vault-memory v2 layers four new architectural concerns on top of v1's retrieval substrate without rewriting v1. Adapter seams (Phase 1) are load-bearing for everything that comes after — chokidar, file paths, YAML-specific parsing must be confined to the obsidian-fs adapter modules and enforced by CI greps. The `Document` shape from ADR-003 (with `RawNode` as the escape hatch for source-specific exotic content) is the canonical content type every assembly tool consumes. See `ARCHITECTURE.md` for the full component map and dependency graph.

**Major components:**
1. **Adapter layer** (`src/adapters/{source,delivery,change-feed}/`) — interfaces from ADR-002 with `obsidian-fs` as v2's single implementation; capability descriptors (both compile-time types and runtime, runtime authoritative); `ChangeFeed` keeps ADR-002's `subscribe(handler) → Disposable` callback contract with a thin async-iterator helper for the staleness daemon
2. **Layer 0 — Retrieval** (`src/search/`, `src/indexer/`, `src/db/`) — v1's hybrid pipeline, unchanged behavior; embeddings via Ollama; sqlite-vec + FTS5 + RRF + optional ONNX rerank
3. **Layer 1 — Graph & structure** (`src/graph/` expanded) — typed edges (`wikilink` / `frontmatter-ref` / `mention` / `hyperlink`); `expand` + `cluster` tools; `search_hybrid` accepts `expand: {hops: 1}`
4. **Layer 2 — Memory namespace** (`src/memory/` new) — `MemorySink` handle resolution; provenance validator at `DeliveryAdapter.write()`; `record_observation` / `recall` / `supersede`; isolation enforced by `.memory-sink` sentinel file
5. **Layer 3 — Assembly** (`src/assembly/` new) — bundles, dossiers, sections; citation packets; consumes `Document` objects exclusively; stub-adapter eval gate from Phase 3 onward proves source-neutrality
6. **Layer 4 — Task contracts** (`src/contracts/` new) — YAML+Zod-validated DSL; `list_contracts` / `describe_contract` / `instantiate_contract`; source/sink overrides as first-class
7. **Brief compiler + staleness daemon** (`src/briefs/` new) — Make-style hash dependency tracking (NOT Turbopack value-cells / Salsa queries / Bazel graphs — over-engineered for a leaf-node compilation); single-owner via lock file at `~/.vault-memory/locks/<vault>.lock`; chunk-level `source_hashes`; rename-event handling
8. **Eval harness** (`evals/` new) — consumes `Document` objects via adapter handle so the same specs run against `obsidian-fs`, stub, and (v3) Notion fixtures; assertions over snapshots; LLM-as-judge opt-in

**Architecture deviations from the brief:**
- Fold Phase 4 (authority/staleness) into Phase 3 (bundles) — shared result shape
- Pull the conformance test suite forward from Phase 10 to Phase 1 — needed for Phase 3's stub adapter, doubles as the practical plugin contract
- Stay per-session for v2.0.0 MCP scaling; design the staleness daemon for single-owner lock — daemon mode is v2.1.x/v3.0.0 territory once `streamable-http` ecosystem solidifies

### Critical Pitfalls

Twelve domain-specific pitfalls catalogued in `PITFALLS.md` with per-phase prevention. The four Critical pitfalls below all map to guardrails installable by end of Phase 1. The five High and three Medium pitfalls follow in subsequent phases.

1. **Adapter seam erosion (Critical, Phases 1+ ongoing)** — v1 already has 6 documented leak instances in `.planning/codebase/CONCERNS.md` (`obsidianUrl()` in `server.ts`, `DEFAULT_CLIENT_ID="claude-code"`, `.obsidian/**` hardcoded, `gray-matter` in `src/write/`, `.claude/**` exclude, `path.*`/`fs.*` in non-adapter modules). Phase 1's CI greps (chokidar, gray-matter, `path.*`/`fs.*` outside adapters, `obsidian://`, `.md` literals) are load-bearing for the entire v2→v3 transition. Brand `DocId` as a nominal type so it can't accept a raw `string`.
2. **Memory namespace contamination (Critical, Phase 2 foundational)** — the single non-negotiable safety invariant. Centralize Guard A (memory-sink writes must carry provenance) and Guard B (`source: agent` writes refused outside any sink) at `DeliveryAdapter.write()`, not at tool handlers. Tool-handler guards are defense-in-depth, not the gate. `.memory-sink` sentinel file prevents misconfigured handle pointing at user content.
3. **Backwards-compat regression on 23 v1 tools (Critical, Phase 0+)** — tool-snapshot tests pin `tools/list` JSON for every v1 tool; freeze `evals/v1-baseline/` for every-PR regression check; net-new tools get net-new names; v1 default behavior unchanged when v2 weights/filters absent.
4. **Brief staleness false-negatives (Critical, Phase 6 with Phase 0 prep)** — ADR-003's `Document.hash` semantics are genuinely under-specified. Amend in Phase 0: hash covers `(blocks rendered to plain text) + (PropertyBag serialized canonically)`. Chunk-level `source_hashes` for sub-document precision. Daemon-startup replay handles missed events.

**Other notable pitfalls** (High severity): task-contract portability (use variable handles `{{default_source}}` from Phase 7's reference contracts to set the template), Canvas round-trip loss (spike first; descope to "Canvas as view, YAML as authoring" if needed), MCP tool surface bloat (40+ tools collapses agent selection accuracy 3× per Atlassian's MCP-compression research — fix by promoting list-ops to MCP Resources and the ≤4-new-tools-per-phase budget), eval drift (assertions not snapshots; CI-required), local-first erosion (Phase 10's optional outbound calls must be gated per-connector, off by default, logged at startup). See `PITFALLS.md` for the full 12-pitfall × severity × phase × prevention matrix.

## Implications for Roadmap

Phase ordering broadly follows the brief's 0→10 with three adjustments and eight new Phase 0 deliverables. All four researchers agree Phase 0→1→2→3 are non-negotiable in order; the brief's Phase 10 is correctly deferred past v2.0.0.

### Phase 0 — Foundation & decisions (EXPANDED)
**Rationale:** Brief's 6 deliverables expand to 14 with research-derived additions. ADRs are currently gitignored at `docs/dev/` — sub-agents that need them in later phases can't read what isn't tracked.
**Delivers:** ADR relocation (`docs/dev/` → `docs/v2/adr/`) as the FIRST Phase 0 PR; ADR-003 hash-semantics amendment; ADR-004 amendment (folder-default with config-only separate-vault option); `docs/v2/ARCHITECTURE.md` + `MEMORY_CONTRACT.md` + `AGENT_AGNOSTIC.md`; `evals/fixtures/v2-test-vault/` with coherent "Atlas Robotics" narrative; `evals/v1-baseline/` regression suite; tool-snapshot tests for all 23 v1 tools; fixture-privacy CI; telemetry/analytics lint; adversarial-ADR-review sub-agent.
**Avoids:** Pitfalls #1 (seam erosion baseline), #3 (backwards-compat regression), #4 (hash semantics), #8 (eval drift), #11 (ADR ambiguity), #12 (fixture privacy).

### Phase 1 — Adapter extraction + tech-debt-up
**Rationale:** Bundle the mechanical MCP SDK 1.29 + Zod 4 major-version bumps with the adapter refactor — both touch every tool registration once, doing them together is one refactor instead of two.
**Delivers:** `src/adapters/source/` + `delivery/` + `change-feed/` with `obsidian-fs` implementations; canonical `Document` / `BlockNode` / `Edge` / `SourceHandle` / `MemorySink` / `ChangeEvent` types; doc_uri migration (Strategy A — dual-column staged); SDK 1.29 + Zod 4 bumps; conformance test suite (pulled from Phase 10); `scripts/smoketest-non-claude.mjs`; CI greps zero-hit; branded `DocId`; outbound-destinations startup banner; `127.0.0.1` (not `localhost`); 324 tests still pass.
**Uses:** MCP SDK 1.29 sampling + capability descriptors; Zod 4 Standard Schema.
**Avoids:** Pitfall #1 (this is where the load-bearing greps get installed).

### Phase 2 — Memory namespace ⚠ FOUNDATIONAL
**Rationale:** Single non-negotiable safety invariant. Every later phase that involves agent writes depends on this.
**Delivers:** `MemorySink` handle parser as single resolution point; `record_observation` / `recall` / `supersede` / `memory_stats` tools; provenance validator at `DeliveryAdapter.write()` (not at tool handlers); existing `write_note` / `update_frontmatter` guards; `.memory-sink` sentinel; promote list-style ops to MCP Resources (cuts tool count from ~40 to ~32); `audit_log` distinguishes memory-sink writes.
**Implements:** Layer 2 — Memory namespace.
**Avoids:** Pitfall #2 (centralized at the chokepoint).

### Phase 3 — Bundles + authority/staleness (FOLDED from brief's Phase 3 + Phase 4)
**Rationale:** Shared result shape — `mtime`/`status`/`superseded_by` on `Document.properties`; inert-default discipline shared (v1 behavior unchanged when weights absent). Splitting costs more than it saves.
**Delivers:** `get_document_bundle`, `get_outline`, `search_sections`, `assemble_dossier`; citation packets on all results; `search_hybrid` accepts `recency_weight` + `authority_weight` + `expand`; `superseded` filter (default hides); stub-adapter eval gate proves source-neutrality.
**Implements:** Layer 3 — Assembly.
**Avoids:** Pitfall #1 (stub-adapter eval catches seam erosion before Phase 10).

### Phase 5 — Graph-as-retrieval
**Rationale:** Independent of Phases 2/3 in terms of data, but Phase 6's brief compilation wants graph-driven source discovery — build them adjacent.
**Delivers:** `expand({seed_doc_ids, hops, edge_types?, filter_properties?})`; `cluster` with `edge-community` method; typed-edge schema supporting `wikilink` / `frontmatter-ref` / `mention` / `hyperlink`.
**Implements:** Layer 1 — Graph promotion from navigation to retrieval.

### Phase 6 — Compiled brief layer
**Rationale:** Highest user-visible win in v2; defeats the 85%-rediscovery problem; vault-memory's signature differentiator. Depends on Phase 2 (labeled sink) + Phase 3 (assembly inputs).
**Delivers:** Brief as `Document` in `_memory/_briefs/`; `compile_brief` defaulting to MCP Sampling → local Ollama → caller-passed-text fallback ladder; `get_brief` with `stale: true` flag; staleness daemon subscribing to `ChangeFeed.subscribe()`; Make-style hash dependency tracking (NOT Turbopack/Salsa); single-owner lock file; chunk-level `source_hashes`; rename-event handling.
**Avoids:** Pitfall #4 (hash semantics resolved in Phase 0; daemon resilience designed in).

### Phase 7 — Task contract DSL
**Rationale:** Signature v2 feature. YAML+Zod 4 schema. Variable handles (`{{default_source}}`) from the first reference contract to set the portability template.
**Delivers:** YAML+Zod schema; `_contracts/` namespace; `list_contracts` / `describe_contract` / `instantiate_contract` with source/sink overrides; three reference contracts (`meeting-prep`, `project-status`, `code-review-brief`); non-Claude MCP client smoke test; new dep `yaml ^2.6`.
**Avoids:** Pitfall #5 (variable-handle template established by reference contracts).

### Phase 8 — Visual contract editor (Canvas)
**Rationale:** Highest cut-risk; spike-first per the brief; default to file-watcher recompile NOT full Obsidian plugin (Stack + Features + Pitfalls all converge here). LangChain's "Not Another Workflow Builder" critique and Flowise/LangFlow visual-clutter literature back this.
**Delivers:** `.canvas` JSON → YAML contract compiler; YAML → `.canvas` decompiler; canvas templates with palette nodes; three reference canvases in `examples/canvas-contracts/`; round-trip acceptance reframed from "byte-equal modulo whitespace" to "semantically equivalent after canonicalization"; hash-gated watcher (reuse v1 SuppressionSet); view-only fallback if spike fails.
**Avoids:** Pitfall #6 (semantic-equivalence acceptance + descope path).

### Phase 9 — Polish, eval suite, v2.0.0 release
**Rationale:** Ship gate. Eval suite in CI, README rewrite around "agentic knowledge layer over Obsidian," migration guide for v1 users.
**Delivers:** v2.0.0 tag + npm publish; CHANGELOG curated; `MIGRATION-V1-TO-V2.md` noting SDK + Zod major bumps for any downstream library users; README "Roadmap" section names Phase 10 explicitly.

### Phase 9.5 — Pre-Phase-10 premise check (NEW HARD GATE)
**Rationale:** Brief's premise-check is currently described in prose; promote it to a real gated phase. Phase 10's premise is "all the hard interface work is already done" — verify it before writing any Notion code.
**Delivers:** All CI greps zero-hit on `main` (chokidar, gray-matter, paths, `Claude`, `obsidian://`); ADRs 001–004 unviolated (adversarial-review sub-agent); stub-adapter evals still green; capability-descriptor test coverage ≥ X%.
**Avoids:** Pitfall #1 (last chance to catch erosion before Notion adds a second adapter that exposes any latent leaks).

### Phase 10 — Connector & delivery abstraction in practice
**Rationale:** Out of v2 scope. Flagged for v3 planning. Listed in roadmap as deferred so it's visible without competing for v2 attention.
**Delivers:** (sketch only, refined in Phase 10 planning sub-phase) ADRs 005–01x on 14 open questions; `src/adapters/{source,delivery,change-feed}/notion-api.ts`; capability descriptors public; connector registry; end-to-end mixed-source test.

### Phase Ordering Rationale

- **Brief's 0→10 ordering holds for hard dependencies.** Phase 0 (ADRs) → Phase 1 (seams) → Phase 2 (memory) → Phase 3 (assembly) → Phase 6 (briefs) → Phase 7 (contracts) → Phase 8 (canvas) is a strict chain.
- **Phase 4 folds into Phase 3** because they share result shape (`mtime`/`status`/`superseded_by` on `Document.properties`).
- **Phase 5 sits between 3 and 6** because Phase 6 wants graph-driven source discovery.
- **Phase 8 is highest-risk** and should be spike-gated; fallback is documented (Canvas as view, YAML as authoring).
- **Phase 9.5 is the new hard gate** before any Phase 10 work.
- **Phase 10 stays last** and is exploratory v3 territory.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 6:** MCP Sampling client coverage (which 2026 MCP clients support sampling — Claude Desktop yes, but Claude Code, ChatGPT Custom Connectors, generic MCP Inspector?); qwen2.5:7b-instruct vs llama3.2 structured-output reliability for fallback Ollama path; chunk-level `source_hashes` schema specifics.
- **Phase 8:** Canvas `.canvas` JSON stability across Obsidian versions; semantic-equivalence formal definition for round-trip acceptance.
- **Phase 10:** `@notionhq/client v2.4+` webhook helper signatures; block-level change granularity in Notion API (v3 territory — defer).

Phases with standard patterns (skip research):
- **Phase 1:** Mechanical refactor; strong precedent in dbt/Airbyte/Backstage/Drizzle.
- **Phase 2:** Validated against Mem0/Letta/Anthropic Memory tool convergence.
- **Phase 3 (folded):** LlamaIndex `ParentDocumentRetriever`, Notion-to-RAG playbook, GraphRAG community summaries.
- **Phase 5:** GraphRAG/HippoRAG/PathRAG/Smart Connections; typed-edge schema straightforward.
- **Phase 7:** No external standard to align with; design own DSL per ADR-003 minimalism.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | MCP SDK 1.29, Zod 4, Ollama, JSON Canvas verified against official sources. LOW on Phase 6 model bake-off (qwen2.5 vs llama3.2) and `@notionhq/client v2.4` webhook signatures (third-party source) — both correctly deferred to their phases. |
| Features | MEDIUM-HIGH | Most categories ≥3 competitive products. MEDIUM on visual-editor and contract-DSL because ecosystem is unsettled in 2026 (no winning standard for declarative agent workflows). |
| Architecture | MEDIUM-HIGH | Adapter + capability descriptors HIGH (dbt/Airbyte/Backstage precedent). doc_uri Strategy A HIGH (SQLite constraints documented). Memory-namespace folder-default MEDIUM. MCP per-session-for-now MEDIUM (daemon migration is well-understood but premature). |
| Pitfalls | HIGH | 12 pitfalls derived from brief Risk sections, v1 CONCERNS.md, ADR open questions, and 2026 MCP ecosystem evidence (Atlassian/Lunar/New Stack on tool-bloat). Every prevention is actionable, not generic. |

**Overall confidence:** MEDIUM-HIGH. Brief is buildable as written with the eight Phase 0 additions and the Phase-4-into-3 fold. Hedged areas (eval harness specifics, Phase 6 model bake-off, Canvas round-trip behavior, Phase 10 Notion specifics) are all appropriate to validate during their respective phases; none block v2.0.0.

### Gaps to Address

- **MCP Sampling client coverage** — Phase 6 ADR validation; confirm which 2026 MCP clients implement sampling so the fallback ladder is right-sized.
- **qwen2.5:7b-instruct structured-output reliability** — Phase 6 bake-off at phase start against fixture vault.
- **Canvas `.canvas` JSON stability across Obsidian versions** — Phase 8 spike; if unstable, descope to "Canvas as view, YAML as authoring."
- **MCP daemon-mode migration timing** — Phase 9 evaluates `streamable-http` ecosystem; v2.0.0 stays per-session; v2.1.x or v3.0.0 may move.
- **Tool-surface count trajectory** — enforce ≤4 new tools/phase in plan-check gate + Resources promotion in Phase 2 (not deferred). Target ≤32 at v2.0.0.
- **`compile_brief` LLM strategy** — Phase 6 ADR; recommendation default is MCP Sampling → Ollama → caller-text fallback ladder.
- **Memory namespace folder vs vault** — Phase 2 ADR-004 amendment; recommend folder-default with config option for separate vault, not code branch.

## Sources

### Primary (HIGH confidence)
- [MCP TypeScript SDK on npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) + [Releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) — version verification
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) + [changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog) — sampling, elicitation, resources
- [Zod v4 release notes](https://zod.dev/v4) + [Standard Schema spec](https://github.com/standard-schema/standard-schema) — major-version migration path
- [JSON Canvas 1.0 spec](https://jsoncanvas.org/spec/1.0/) + [obsidianmd/jsoncanvas](https://github.com/obsidianmd/jsoncanvas) — Phase 8 compiler reference
- [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs) + [official JS library](https://github.com/ollama/ollama-js) — Phase 6 fallback path
- [SQLite Generated Columns](https://sqlite.org/gencol.html) — confirms doc_uri Strategy A
- [better-sqlite3 Node 22 issue](https://github.com/WiseLibs/better-sqlite3/issues/1442) — keep `better-sqlite3`, reject `node:sqlite`
- [Anthropic Memory tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) + [Mem0 State of Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026) + [Letta GitHub](https://github.com/letta-ai/letta) — memory primitive convergence
- [Microsoft GraphRAG](https://microsoft.github.io/graphrag/) + [Graph RAG vs Vector RAG 2026](https://agentmarketcap.ai/blog/2026/04/07/graph-rag-vs-vector-rag-agent-memory-neo4j-pgvector) — Phase 5 reference
- [Anthropic Demystifying Evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) + [EleutherAI lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness) — eval harness pattern

### Secondary (MEDIUM confidence)
- [Best MCP Clients 2026 — Nimbalyst](https://nimbalyst.com/blog/best-mcp-clients-2026/) — client landscape
- [SKILL.md vs CLAUDE.md vs AGENTS.md — Agensi](https://www.agensi.io/learn/ai-coding-tools-comparison-2026) — emerging standards
- [LangChain Not Another Workflow Builder](https://blog.langchain.com/not-another-workflow-builder/) — Phase 8 design pressure
- [tldraw computer](https://computer.tldraw.com/) — visual programming reference
- [Drizzle adapter docs](https://orm.drizzle.team/docs/prisma) + [Airbyte LangChain sources](https://blog.langchain.com/introducing-airbyte-sources-within-langchain/) + [Backstage EntityProvider](https://backstage.io/docs/reference/plugin-catalog-node.entityprovider/) — adapter pattern precedent
- [Knowledge Decay Problem in RAG — ragaboutit](https://ragaboutit.com/the-knowledge-decay-problem-how-to-build-rag-systems-that-stay-fresh-at-scale/) — staleness pattern
- [Promptfoo on GitHub](https://github.com/promptfoo/promptfoo) — Phase 6 brief-quality evals only
- [Notion API request limits](https://developers.notion.com/reference/request-limits) — Phase 10 prep
- [Martian markdown-to-Notion](https://github.com/tryfabric/martian) — Phase 10 prep
- [Repeater.js async iterators rationale](https://repeater.js.org/docs/rationale/) — ChangeFeed contract
- [VS Code Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host) — Phase 10 plugin loading
- [Obsidian Smart Connections](https://smartconnections.app/) + [Obsidian MOC concept](https://forum.obsidian.md/t/what-is-a-moc/58423) — Obsidian ecosystem

### Tertiary (LOW confidence — validate during phase)
- [Notion API Rate Limits 2026 — fazm.ai](https://fazm.ai/blog/notion-api-rate-limits-2026) — Phase 10
- [Drizzle vs Prisma vs Kysely 2026 — PkgPulse](https://www.pkgpulse.com/guides/drizzle-orm-v1-vs-prisma-6-vs-kysely-2026) — comparison source
- [CrewAI vs LangGraph 2026 — DEV](https://dev.to/suifeng023/crewai-vs-langgraph-which-llm-agent-framework-should-you-use-in-2026-3h4n) — contract DSL landscape
- [DeepEval alternatives 2026 — Braintrust](https://www.braintrust.dev/articles/deepeval-alternatives-2026) — eval landscape

---
*Research completed: 2026-05-14*
*Ready for roadmap: yes*
