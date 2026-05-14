# Feature Landscape — Agentic Knowledge Layer (vault-memory v2)

**Domain:** Local-first, MCP-canonical agentic knowledge layer over Obsidian (with source-pluggable seams for Notion / web / RSS in v3).
**Researched:** 2026-05-14
**Overall confidence:** MEDIUM-HIGH. Most categories triangulated against at least three competitive products with current docs / 2026 articles. Visual-editor and contract-DSL categories are MEDIUM because the ecosystem itself is unsettled.

---

## How to read this document

Three columns matter for every feature:

1. **Category** — *Table stakes* (must ship or v2 looks dated next to mem0/Letta/Claude Memory tool/Cursor/Smart Connections), *Differentiator* (vault-memory's defensible angle), or *Anti-feature* (explicit "no" with reasoning).
2. **Phase** — Which v2 phase (0–9) ships it. Phase 10 features (Notion connector) are out-of-scope-for-v2 but listed where they constrain v2 design.
3. **Competitive reference** — at least one current product that ships the same shape, with a 2026 source.

Dependencies between features are called out inline. The headline dependency: the Memory namespace (Phase 2) is the foundation everything else writes through. Briefs, contracts, dossiers all degrade to "silent agent writes into user notes" without it.

---

## 1. Table stakes

Features users now expect in any 2026 agentic knowledge layer. Missing any of these and v2 reads as a v1 point-release with a new logo. Every entry maps to a phase 0–9 and to at least one competitor that ships it.

### 1.1 Labeled agent write-back to a separate namespace ⚠ critical

**Phase:** 2 (`record_observation`, `recall`, `supersede`, `memory_stats`).
**Why expected:** Every serious memory product in 2026 distinguishes user-stated facts from agent-inferred ones. mem0's group-chat flow attributes by `user_id` vs `agent_id`; Anthropic's Memory tool writes to a separate filesystem directory and never to the conversation; Letta's three-tier memory (core / recall / archival) treats agent writes as a different storage class.
**Competitive refs (3):**
- mem0 — provenance via `user_id`/`agent_id` filtering at retrieval ([State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)).
- Anthropic Memory tool — agents read/write to a memory file directory that persists across sessions, distinct from the user's working set ([Memory tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)).
- Letta / MemGPT — Core/Recall/Archival tiers, agent-managed; archival is a tool call, not an implicit write ([Letta GitHub](https://github.com/letta-ai/letta)).
**vault-memory shape:** `MemorySink` handle (ADR-004); `_memory/` subfolder by default; validator at `DeliveryAdapter` refuses sink writes missing required keys; refuses non-sink writes with `source: agent`.
**Dependency:** Required by Briefs (Phase 6), Contracts (Phase 7), and any agent-authored dossier output.

### 1.2 Provenance properties on every agent-written document

**Phase:** 0 (contract in `MEMORY_CONTRACT.md`), 2 (validator).
**Why expected:** Production memory systems in 2026 carry ≈40 fields per record covering classification, confidence, lifecycle, and relationships. Confidence in particular is no longer optional — Bayesian-style updates (1.5× corroboration, 0.7× same-source) are showing up in commercial agent memory frameworks.
**Required minimal property contract for v2:**
- `source: "agent" | "user" | "import"`
- `confidence: "low" | "medium" | "high" | "user-confirmed"`
- `evidence: doc_id[]`
- `status: "active" | "superseded" | "stale"`
- `observed_at: ISO 8601`
- `superseded_by: doc_id?`
- `type: string` (free-form taxonomy, e.g. `observation`, `brief`, `fact`)
**Competitive refs (3):**
- TierMem (research, applied in 2026 frameworks) — "provenance-linked two-tier" with evidence escalation ([Agent Memory & Knowledge Systems Compared 2026](https://fountaincity.tech/resources/blog/agent-memory-knowledge-systems-compared/)).
- mem0 — confidence updates as evidence arrives, explicit user corrections override ([Top 10 AI Memory Products 2026](https://medium.com/@bumurzaqov2/top-10-ai-memory-products-2026-09d7900b5ab1)).
- LongMemEval-V2 / ICLR 2026 MemAgent — provenance/evidence as evaluation axis ([survey](https://github.com/VoltAgent/awesome-ai-agent-papers)).

### 1.3 Hybrid retrieval (semantic + lexical + rank fusion)

**Phase:** Already shipped in v1.0.0 (`search_hybrid`). Listed for completeness — losing this in v2 would be a regression.
**Why expected:** "Hybrid RAG is the production baseline for most enterprises in 2026" ([Production RAG 2026](https://blog.premai.io/building-production-rag-architecture-chunking-evaluation-monitoring-2026-guide/)). Pure vector lost the argument.
**Competitive refs (3):** Most RAG production guides 2026 list hybrid as baseline; Cursor uses hybrid codebase indexing; Continue.dev's context-provider stack is hybrid.

### 1.4 Section / heading-tree retrieval (not just chunks)

**Phase:** 3 (`get_outline`, `search_sections`, `get_document_bundle`).
**Why expected:** Chunks are too small for agent context windows; chunk soup forces the agent to reassemble. The Notion-to-RAG playbook explicitly recommends "templates → structured databases → chunking that preserves section boundaries" — section is the right retrieval unit for human-authored knowledge ([Notion-to-RAG playbook](https://medium.com/@bhagyarana80/the-notion-to-rag-pipeline-playbook-5c400f22e880)). GraphRAG community summaries at multiple hierarchical levels are the same idea generalized.
**Competitive refs (3):**
- Notion API blocks endpoint — natural hierarchy retrieval ([Notion API](https://developers.notion.com/)).
- LlamaIndex / LangChain `ParentDocumentRetriever` pattern — fetch the section, not the chunk.
- Microsoft GraphRAG — Leiden community summaries at multiple levels ([GraphRAG](https://microsoft.github.io/graphrag/)).

### 1.5 Citation packet on every result

**Phase:** 3 (added to all bundle/dossier/section results).
**Why expected:** Citations are not a nice-to-have in 2026 — every agentic RAG production guide treats them as ground-truth audit trail. Evidence is *the* source material backing a model's claim ([Evidence in AI Evaluation](https://futureagi.com/glossary/evidence/)).
**Shape:** `{doc_id, source_handle, title, heading_path, mtime, hash, display_url}`.
**Competitive refs:** Notion AI, Perplexity, ChatGPT with search — all show inline citations; absence reads as untrustworthy.

### 1.6 Authority & staleness signals on results

**Phase:** 4 (`recency_weight`, `authority_weight`, `superseded` filter).
**Why expected:** Embedding staleness is "probably corrupting your RAG system right now" ([HackerNoon](https://hackernoon.com/embedding-staleness-is-probably-corrupting-your-rag-system-right-now)). Production guides 2026 require staleness as a first-class monitoring dashboard metric, defined as `time_since_update / acceptable_update_frequency` for the document class. "De facto authoritative" page detection is what teams use Confluence and Notion for ([Falconer migration guide 2026](https://falconer.com/guides/migrate-notion-confluence/)).
**v2 minimum:** `mtime`, `status`, `superseded_by` exposed in result objects; ranking weights opt-in.
**Competitive refs (3):**
- Confluence/Notion — "official doc" / canonical page conventions teams maintain by hand.
- Obsidian MOC convention — `Map of Content` notes act as authoritative indexes ([MOC concept](https://forum.obsidian.md/t/what-is-a-moc/58423)).
- Production RAG staleness fraction formula widely cited 2026.

### 1.7 Live change feed → incremental re-index

**Phase:** Already shipped in v1.0.0 (chokidar via `Indexer`). Listed because Phase 1 relocates it behind the `ChangeFeed` interface — losing live updates would regress.
**Why expected:** Incremental indexing — "detect changes, extract modified chunks, re-embed only those, update vectors, invalidate cache" — is the production-RAG baseline for 2026, with reported 70% update-cost reductions vs full re-index ([Knowledge Decay Problem](https://ragaboutit.com/the-knowledge-decay-problem-how-to-build-rag-systems-that-stay-fresh-at-scale/)).
**Competitive refs:** LightRAG, Continue.dev's IDE indexer, Cursor codebase indexing.

### 1.8 Backlinks, forward-links, typed edges as retrieval

**Phase:** 5 (`expand`, `cluster`, `search_hybrid({expand: {hops: 1}})`).
**Why expected:** Graph RAG in 2026 is no longer exotic — practitioner consensus is that knowledge-graph augmentation gives multi-hop reasoning that pure vector search cannot ([Graph RAG vs Vector RAG 2026](https://agentmarketcap.ai/blog/2026/04/07/graph-rag-vs-vector-rag-agent-memory-neo4j-pgvector)). Microsoft GraphRAG hits 86% accuracy where baseline RAG sits at 32%. For Obsidian specifically, wikilink graph is already first-class user data — not exposing it as retrieval would be a missed signal.
**Competitive refs (3):**
- Microsoft GraphRAG — hierarchical communities + community summaries ([repo](https://github.com/microsoft/graphrag)).
- Obsidian Smart Connections — surfaces semantically related notes; widely used 2026 baseline ([Smart Connections](https://smartconnections.app/)).
- HippoRAG / PathRAG / OG-RAG — graph variants ([comparison](https://medium.com/graph-praxis/graphrag-vs-hipporag-vs-pathrag-vs-og-rag-choosing-the-right-architecture-for-your-knowledge-graph-a4745e8b125f)).

### 1.9 MCP as canonical surface (not Claude-only)

**Phase:** 1 (adapter extraction + client-agnostic audit, `AGENT_AGNOSTIC.md`).
**Why expected:** MCP is "universally supported across every agent" in 2026 — Cursor (40-tool cap), Cline (with MCP marketplace), Roo Code, Claude Code, ChatGPT Custom Connectors, generic MCP Inspector ([Best MCP Clients 2026](https://nimbalyst.com/blog/best-mcp-clients-2026/)). In December 2025 Anthropic donated MCP to the Agentic AI Foundation (Linux Foundation), so MCP is now governance-neutral ([Wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol)). A product that ships only as Claude Skills in 2026 is shipping for one client.
**v2 minimum:** Phase 1's smoke-test against MCP Inspector / non-Claude client. README rewritten away from "Claude Code" framing.

### 1.10 Resources + Prompts (not only Tools)

**Phase:** 7 (contracts shipped as MCP Prompts), Phase 3 (bundles/dossiers exposed as Resources where appropriate).
**Why expected:** The MCP spec defines three primitive types — Tools (model-controlled), Resources (app/user-controlled data), Prompts (user-controlled templates). vault-memory v1.0.0 ships only Tools. In 2026, sophisticated MCP servers use all three. Contracts are a near-perfect fit for the Prompt primitive: "user-controlled, surfaced as options the user can select." Skipping Prompts means contracts are tools the model decides to call — not menu items the user picks.
**Competitive refs:** MCP spec 2025-11-25; SDK examples increasingly show three-primitive servers.

---

## 2. Differentiators

vault-memory's defensible angles. Each is something competitors *don't* ship today (May 2026), or where competitors ship a degraded version. Each is a deliberate strategic bet.

### 2.1 Compiled briefs as first-class documents with staleness propagation ⭐

**Phase:** 6 (`compile_brief`, `get_brief`, staleness daemon, `list_briefs`).
**Why differentiating:** No competitor ships this *shape* today. Production-RAG context-caching (Claude, Gemini) caches prompt prefixes server-side for 75–90% cost reduction, but that's request-level, not artifact-level. Cursor caches codebase context but invalidates on file change; the cache is implicit and not a queryable document. mem0/Letta store *facts*, not *compiled summaries with traceable source hashes*. The closest parallel is "knowledge decay" production-RAG advice from 2026 — but it's prescriptive ("monitor staleness fraction") not implemented as a built-in product feature ([Knowledge Decay 2026](https://ragaboutit.com/the-knowledge-decay-problem-how-to-build-rag-systems-that-stay-fresh-at-scale/)).
**What makes vault-memory's shape unique:**
- Briefs are real `Document`s in `_memory/_briefs/` — discoverable, citable, supersede-able.
- `source_hashes` on the brief makes staleness deterministic (not a TTL guess).
- Staleness propagates via `ChangeFeed` — same plumbing as live indexing.
- Briefs across multiple agent sessions can share state because they're durable on disk.
**Risk:** `compile_brief`'s LLM strategy is unresolved (Phase 6 ADR). Option A (caller passes summarized text) keeps vault-memory's "no LLM calls beyond embeddings" purity; Option B (Ollama call) is more useful out-of-the-box. Brief recommends ADR before implementing.
**Dependency:** Memory namespace (Phase 2) + Dossier/bundle tools (Phase 3) + ChangeFeed seam (Phase 1).

### 2.2 Task contracts as declarative, source-agnostic, MCP-discoverable artifacts ⭐

**Phase:** 7 (`list_contracts`, `describe_contract`, `instantiate_contract`, three reference contracts).
**Why differentiating:** Existing "declarative agent workflow" surfaces are either app-specific (n8n flows, Custom GPT JSON config, Anthropic Skills' SKILL.md) or visual-only (Flowise, LangFlow). None are *(a) MCP-discoverable*, *(b) source-portable by handle*, and *(c) authored as YAML in a notes vault*. SKILL.md is the closest comparable — and it has gained traction in 2026 ("the closest thing to a universal standard for AI coding agents") — but SKILL.md describes capabilities, not assembly pipelines with source/sink overrides ([AGENTS.md vs SKILL.md 2026](https://www.agensi.io/learn/ai-coding-tools-comparison-2026)).
**vault-memory's contract is unique in combining:**
- Discoverable via MCP (`list_contracts` returns a menu any MCP client can render).
- Source-portable: `source_overrides`/`sink_overrides` re-point a contract from Obsidian to Notion without rewriting.
- Lives as Markdown+YAML inside the vault → users can edit it like any other note.
- Output shape is declared, so callers know what they get.
**Schema consensus check:** YAML-as-config-as-code is increasingly standard (Kestra, GitHub Actions, n8n recently). The `inputs`/`sources`/`assembly`/`output_shape`/`write_back` shape isn't standardized but maps cleanly to known patterns ([Kestra YAML](https://dev.to/lightningdev123/top-5-n8n-alternatives-in-2026-choosing-the-right-workflow-automation-tool-54oi)).
**Dependency:** Memory namespace + bundles/dossier (Phases 2–3) before contracts can write back or assemble.

### 2.3 Visual contract editor via Obsidian Canvas ⭐ (high-risk)

**Phase:** 8 (Canvas → YAML compiler, YAML → Canvas decompiler, round-trip).
**Why differentiating:** No competitor uses Obsidian Canvas as a programming surface. tldraw's "computer" is the closest research precedent for visual compute on a canvas, but it's a hosted demo, not a notes-vault workflow surface ([tldraw computer](https://computer.tldraw.com/)). LangFlow and Flowise are the visual-agent-builder incumbents — and they're criticized for "visual clutter… you end up with a mess of nodes and edges" once workflows scale ([LangFlow alternatives](https://www.lindy.ai/blog/langflow-alternatives)). LangChain itself published "Not Another Workflow Builder" arguing visual builders aren't actually low-barrier ([blog post](https://blog.langchain.com/not-another-workflow-builder/)).
**What might work for vault-memory:** the YAML *is* the truth; Canvas is just a visualization. Round-trip determinism is the success criterion. Three small reference canvases ship.
**What's likely to be clunky:** anything beyond ~10 nodes. Phase 8's risk note (spike first, plugin-vs-watcher decision) is well-placed.
**Strategic call:** Even if Phase 8 ships only as "edit Canvas in Obsidian, watcher recompiles" (no plugin), that's still differentiating because no competitor lets users edit agent contracts visually inside their notes app.

### 2.4 Source-pluggable seams as a first-class architectural commitment ⭐

**Phase:** 0 (ADRs 001–004), 1 (adapter extraction).
**Why differentiating:** Most "open" RAG products have plugin systems for *consumers* (which LLM, which vector DB) but hardcode the *source* (Notion connector, file watcher, web scraper as separate apps). vault-memory's `SourceConnector` / `DeliveryAdapter` / `ChangeFeed` interfaces — even with one implementation in v2 — explicitly commit to multi-source as a first-class concern. Capability descriptors per ADR-002 mean assembly tools can introspect whether a contract's write-back step is supported on the configured sink ([ADR-002, internal]).
**Competitive landscape:** Mem0 supports multiple LLMs but stores facts in its own DB. Letta is a runtime, not a substrate. GraphRAG has connectors but is heavyweight per-deployment. None offers Obsidian-today, Notion-next on the same query API.
**Strategic note:** This is differentiating only if Phase 10 (v3) actually ships. v2.0.0 readers can read it as architecture-astronaut. Mitigation: stubbed second adapter from Phase 3 proves seam neutrality *inside* v2.

### 2.5 Local-first, no-telemetry, single-machine

**Phase:** Cross-cutting; reinforced at v2.0.0 README rewrite (Phase 9).
**Why differentiating:** mem0 has a cloud platform option, Letta runs as a server you host, ChatGPT Memory is cloud-bound, Claude Memory tool requires API access. Among 2026 agent-memory products, *fully local with no network egress beyond `localhost:11434`* is genuinely rare. The "Top 10 AI Memory Products 2026" list is dominated by cloud-or-cloud-optional services.
**Strategic note:** local-first is brand-defining; v2 must not erode it. Phase 6 (briefs) is the first place this could leak (LLM strategy ADR) — be vigilant.

### 2.6 Dossier assembly by type+key (entity-centric retrieval)

**Phase:** 3 (`assemble_dossier({type, key})`).
**Why differentiating:** Most products retrieve *passages*. `assemble_dossier("Person", "Alice")` is *entity-centric* retrieval that walks edges + properties to return a packet about a thing. Notion's database+relation model can do this manually; nobody packages it as a single MCP tool that returns "everything we know about Alice with citations."
**Competitive refs (similar but distinct):**
- GraphRAG's entity nodes carry summaries — adjacent but graph-global, not entity-on-demand.
- Notion's database relations — manual UI; no agent surface for "give me a Person dossier."

### 2.7 Hash-protected atomic writes for agent edits

**Phase:** Already in v1.0.0 (`write_note` / `update_frontmatter` / `delete_note`). Preserved through `DeliveryAdapter` in Phase 1.
**Why differentiating:** Most memory products either (a) don't let agents write at all (read-only RAG) or (b) let agents write with no concurrency guarantee. vault-memory's `SuppressionSet` + hash check is unusual safety engineering for an OSS product. Worth re-emphasizing in the v2 pitch as "agents can't clobber your edits."

---

## 3. Anti-features (explicit "no" list)

Things vault-memory v2 should *deliberately not* ship, with the reasoning that prevents them being re-added in a moment of weakness.

### 3.1 Cloud sync or hosted service

**Why no:** Local-first is the brand. Adding a cloud option would force decisions about telemetry, pricing, multi-user permissions, and identity — every one of those decisions invalidates the differentiator (2.5). Already explicitly out-of-scope in PROJECT.md.
**Where the cliff edge is:** Any feature that requires shipping a server vault-memory hosts. Phase 10's Notion connector is fine because outbound is per-connector and gated.

### 3.2 LLM-as-router / vault-memory making LLM calls beyond embeddings

**Why no:** vault-memory's purity is "embeddings via Ollama; agent provides reasoning." Adding generation calls means picking a model, handling rate limits, billing, error retry, and prompt engineering — none of which is the product's job. The agent on the other side of MCP is *already* an LLM; vault-memory should hand it material, not generate.
**Where the cliff edge is:** Phase 6's `compile_brief` is the test case. ADR must default to Option A (caller-provides-summary) and treat Option B (Ollama call) as opt-in with a config flag, not default-on.

### 3.3 Multi-user / collaboration / sharing

**Why no:** Single-user, single-machine product. Per-machine memory sink. Adding multi-user introduces auth, access control, CRDTs/sync, conflict resolution — vault-memory is not a collab product. Users who want collab use Notion or Confluence; vault-memory should index *their* canonical store via Phase 10 connectors.

### 3.4 Agent orchestration / multi-agent workflows

**Why no:** vault-memory is a knowledge layer, not an agent runtime. n8n, LangGraph, Letta, AutoGen are agent runtimes — they orchestrate agents. vault-memory provides the substrate any of them can call. Conflating the layers is how "RAG framework" projects bloat into agent platforms and lose their identity. Contracts (Phase 7) are *not* orchestration — they describe *what to assemble*, not *what the agent should do next*.
**Where the cliff edge is:** any contract feature that adds control flow (`if/else/loop`). Stay declarative. If users want loops, they use their agent runtime.

### 3.5 Native UI (web app, desktop GUI)

**Why no:** Obsidian *is* the UI. vault-memory's surface is MCP; any UX work goes into Obsidian (Canvas editor Phase 8) or into the consuming MCP client. Shipping a web UI means a frontend codebase, deployment, auth, browser compat. Out.

### 3.6 REST / GraphQL / WebSocket APIs

**Why no:** MCP is the canonical contract (Phase 0 `AGENT_AGNOSTIC.md`). Adding REST means maintaining two APIs that drift. If a non-MCP integration is genuinely needed (script use case), `vault-memory` CLI commands cover it.

### 3.7 Telemetry / analytics

**Why no:** "Nothing leaves your machine" is in the README. Anonymous usage analytics would technically violate this and erode trust for a privacy-sensitive user base (people who chose local-first Obsidian self-select for this).

### 3.8 First-party Obsidian community-plugin distribution (this milestone)

**Why no for v2:** The Phase 8 Canvas plugin (if built) is bundled with the repo, not pushed to the Obsidian plugin store. Reasoning: plugin-store distribution introduces a review cycle, update lag, and Obsidian-API version lock — none of which is worth the friction for a v2.0.0 ship. v2.x or v3 can revisit.

### 3.9 Notion / Google Drive / web / RSS connectors

**Why no for v2:** Phase 10 territory; v3.0.0. Listed here only to be clear that v2.0.0 ships *one* source connector (obsidian-fs) and *one* delivery adapter (obsidian-fs). The seams are designed for more, but only Obsidian ships.

### 3.10 "Agent management" / dashboards / observability over agent runs

**Why no:** vault-memory provides `audit_log` and `index_runs` (already shipped) — these are MCP tools any client can render. Building a dashboard means committing to a UI (3.5). The audit data is enough.

### 3.11 Embedded LLM-based summarization in retrieval results

**Why no:** "Here's a chunk + an LLM-generated summary inline" is what every cloud RAG product does. vault-memory's job is to hand the agent material; the agent summarizes. Crossing this line means making LLM calls (3.2) and making opinionated truncation calls the caller didn't ask for.

### 3.12 Permission/ACL system within memory sinks

**Why no for v2:** Single-user assumption (3.3) makes ACLs irrelevant. The memory namespace is one sink; if a user wants stricter isolation, they configure a separate vault (the Phase 2 ADR amendment "namespace as separate vault" is the safety valve here).

### 3.13 Cross-encoder reranker enabled by default

**Why no:** Already an opt-in per-query flag in v1.0.0 (`rerank: true`). Enabling by default adds 570 MB download + per-query latency for users who may not want it. Stay opt-in.

---

## 4. Per-phase feature mapping

This is the table the roadmap consumes. Every table-stakes / differentiator feature is mapped to a phase.

| Phase | Goal | Table-stakes features | Differentiator features |
|-------|------|----------------------|------------------------|
| **0 — Foundation** | Lock ADRs 001–004 + 3 architecture docs + fixture vault | 1.2 provenance contract (defined in `MEMORY_CONTRACT.md`); 1.9 MCP-canonical (defined in `AGENT_AGNOSTIC.md`) | 2.4 source-pluggable seams (ADR-002) |
| **1 — Adapter extraction** | Stand up `SourceConnector` / `DeliveryAdapter` / `ChangeFeed` interfaces with obsidian-fs impl | 1.7 ChangeFeed seam preserves live indexing; 1.9 non-Claude smoke-test | 2.4 source-pluggable seams (code) |
| **2 — Memory namespace** ⚠ FOUNDATIONAL | Safe agent write-back with provenance | 1.1 labeled write-back; 1.2 provenance validator | — (this *is* the foundation everything else builds on) |
| **3 — Bundles & document-tree** | Stop returning chunks when the right unit is bigger | 1.4 section retrieval; 1.5 citation packets | 2.6 dossier assembly by type+key |
| **4 — Authority & staleness** | Ranking signals: freshness + supersession | 1.6 authority/staleness on results | — |
| **5 — Graph-as-retrieval** | Typed-edge expansion + community detection | 1.8 graph-as-retrieval | — |
| **6 — Compiled brief layer** | Defeat 85% rediscovery problem | — | 2.1 compiled briefs with source-hash staleness propagation |
| **7 — Task contract DSL** | Declarative assembly pipelines | 1.10 Resources + Prompts primitives | 2.2 source-portable contracts |
| **8 — Visual contract editor** | Obsidian Canvas as authoring surface | — | 2.3 Canvas-as-programming |
| **9 — Polish & v2.0.0 release** | README rewrite around new pitch; CI eval suite | All — proven by eval suite | 2.5 local-first reinforced in pitch |
| **10 — Notion connector** (v3, out of v2 scope) | Prove source-neutrality with real second adapter | — | 2.4 source-pluggable seams (in practice) |

---

## 5. Feature dependencies (graph)

```
Phase 0 ADRs (identity, seams, document shape, memory sink)
  └─→ Phase 1 adapter extraction
        ├─→ Phase 2 memory namespace (depends on DeliveryAdapter seam)
        │     ├─→ Phase 6 compiled briefs (briefs are agent-writes; need labeled sink)
        │     └─→ Phase 7 contracts (write_back: targets memory sinks)
        ├─→ Phase 3 bundles & dossiers (depends on Document type from ADR-003)
        │     ├─→ Phase 4 authority/staleness (operates on Document.properties)
        │     ├─→ Phase 5 graph expansion (consumes Document.links / Edges)
        │     ├─→ Phase 6 compile_brief (consumes bundles)
        │     └─→ Phase 7 assemble step (consumes bundle/dossier tools)
        └─→ Phase 1 ChangeFeed seam
              └─→ Phase 6 staleness daemon (subscribes to ChangeFeed)

Phase 7 contract DSL
  └─→ Phase 8 Canvas editor (compiles to/from Phase 7 YAML)
```

**Critical-path read:** Phase 2 is the gate. Briefs (6) and contracts (7) cannot ship safely without it. Phase 3 is the second-most-load-bearing — every assembly tool consumes its `Document` shape.

---

## 6. MVP recommendation (which phases must ship for v2.0.0 to be coherent)

If pressed to cut: **Phases 0–6 + Phase 9 are the minimum coherent v2.0.0.**

- **Phases 0–6 = Layers 0–3** of Nate Jones' knowledge-layer model: adapter, retrieval, structure/graph, memory typology, assembly, compiled context. Without any of these, the v2 pitch ("agentic knowledge layer over Obsidian") doesn't hold.
- **Phase 7 (contracts) = Layer 4.** It is the most distinctive v2 deliverable. Cutting it weakens the pitch significantly but doesn't break it.
- **Phase 8 (Canvas) = pure differentiator UX.** Highest cut-risk. Acceptable to defer to v2.1.0 if Phase 6/7 take longer.

**Recommended priority within v2:**
1. Phase 0 (must-have — locks v3 readiness too)
2. Phase 1 (must-have — seams or nothing later works)
3. Phase 2 (must-have — safety invariant)
4. Phase 3 (must-have — every later phase consumes its types)
5. Phase 6 (highest user-visible win — defeats the 85% rediscovery problem)
6. Phase 4, Phase 5 (parallelizable; both small)
7. Phase 7 (signature feature)
8. Phase 8 (defer-able)
9. Phase 9 (release)

**Defer beyond v2:** Phase 10 (Notion connector) — explicitly v3 per the brief.

---

## 7. Open questions to surface to ROADMAP

These are unresolved at research-time; the roadmap or a subsequent ADR should answer them.

1. **Phase 2 namespace shape — folder vs separate vault?** Brief flags this. Folder is simpler; separate vault is harder isolation. Surface before implementing Phase 2.
2. **Phase 6 LLM strategy — caller-provides-text vs Ollama call?** Brief flags this. Anti-feature 3.2 argues for caller-provides as default.
3. **Phase 7 contract Resources-vs-Prompts mapping.** The contract surface fits MCP Prompts conceptually (user-selected templates). Should `list_contracts` expose them as Prompts in addition to / instead of Tools? Decide before Phase 7.
4. **Phase 8 plugin-vs-watcher decision.** Brief flags this as a Phase 8 spike. Watcher-recompile is much cheaper and obsidian-fs-adapter-aligned; recommend that path unless plugin proves materially better in spike.
5. **Phase 6 brief format — Markdown body with YAML frontmatter, JSON, or hybrid?** Briefs are `Document`s, so the Document-shape ADR (003) constrains this — but the *content* of a brief (prose summary vs structured fields) is undecided. The right answer is probably "Markdown body with YAML-property compiled_from/source_hashes/etc" — exactly how vault-memory already represents notes.
6. **MOC convention adoption.** Should `authoritative: true` in `Document.properties` be the canonical authority signal (Phase 4), or should the system auto-detect MOC-shaped notes (one note linking to many that don't link back)? Probably both: explicit property wins, heuristic as fallback.

---

## 8. Sources

### Memory primitives (1.1, 1.2)
- [State of AI Agent Memory 2026 — mem0](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- [Letta GitHub](https://github.com/letta-ai/letta)
- [Anthropic Memory tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Mem0 vs Letta vs MemGPT 2026](https://tokenmix.ai/blog/ai-agent-memory-mem0-vs-letta-vs-memgpt-2026)
- [Agent Memory & Knowledge Systems Compared 2026](https://fountaincity.tech/resources/blog/agent-memory-knowledge-systems-compared/)
- [Top 10 AI Memory Products 2026](https://medium.com/@bumurzaqov2/top-10-ai-memory-products-2026-09d7900b5ab1)
- [VoltAgent awesome-ai-agent-papers (ICLR 2026 MemAgent, LongMemEval-V2)](https://github.com/VoltAgent/awesome-ai-agent-papers)
- [Claude Dreaming — VentureBeat](https://venturebeat.com/technology/anthropic-introduces-dreaming-a-system-that-lets-ai-agents-learn-from-their-own-mistakes)

### Compiled context / briefs (1.5, 1.6, 2.1)
- [Knowledge Decay Problem — ragaboutit](https://ragaboutit.com/the-knowledge-decay-problem-how-to-build-rag-systems-that-stay-fresh-at-scale/)
- [Embedding Staleness — HackerNoon](https://hackernoon.com/embedding-staleness-is-probably-corrupting-your-rag-system-right-now)
- [Cache Invalidation for AI — TianPan.co](https://tianpan.co/blog/2026-04-20-cache-invalidation-ai-semantic-rag)
- [Incremental Updates in RAG Systems 2026](https://dasroot.net/posts/2026/01/incremental-updates-rag-dynamic-documents/)
- [Building Production RAG 2026 Guide — Prem AI](https://blog.premai.io/building-production-rag-architecture-chunking-evaluation-monitoring-2026-guide/)
- [Evidence in AI Evaluation — FutureAGI](https://futureagi.com/glossary/evidence/)

### Document-tree / section retrieval (1.4, 2.6)
- [Notion-to-RAG Pipeline Playbook](https://medium.com/@bhagyarana80/the-notion-to-rag-pipeline-playbook-5c400f22e880)
- [Notion API docs](https://developers.notion.com/)
- [Notion 3.0 AI Agents](https://www.techaheadcorp.com/blog/notion-3-ai-agents/)

### Graph-as-retrieval (1.8)
- [Microsoft GraphRAG](https://microsoft.github.io/graphrag/)
- [Microsoft GraphRAG repo](https://github.com/microsoft/graphrag)
- [Graph RAG in 2026 Practitioner's Guide](https://medium.com/graph-praxis/graph-rag-in-2026-a-practitioners-guide-to-what-actually-works-dca4962e7517)
- [GraphRAG vs HippoRAG vs PathRAG vs OG-RAG](https://medium.com/graph-praxis/graphrag-vs-hipporag-vs-pathrag-vs-og-rag-choosing-the-right-architecture-for-your-knowledge-graph-a4745e8b125f)
- [Graph RAG vs Vector RAG 2026](https://agentmarketcap.ai/blog/2026/04/07/graph-rag-vs-vector-rag-agent-memory-neo4j-pgvector)
- [Obsidian Smart Connections](https://smartconnections.app/)
- [Smart Connections — Obsidian + MCP integration](https://3sztof.github.io/posts/obsidian-smart-connections-mcp/)

### Authority / MOC (1.6)
- [Obsidian MOC concept](https://forum.obsidian.md/t/what-is-a-moc/58423)
- [Automated MOCs in Obsidian with Templater/Dataview](https://readwithai.substack.com/p/automated-maps-of-content-in-obsidian)
- [Falconer migration guide 2026 (canonical/authoritative page detection)](https://falconer.com/guides/migrate-notion-confluence/)

### Task contracts / declarative workflows (2.2)
- [Cursor Rules vs Claude Skills vs AGENTS.md 2026 — Agensi](https://www.agensi.io/learn/ai-coding-tools-comparison-2026)
- [Claude Code Skills vs Cursor Rules vs Codex Skills](https://www.agensi.io/learn/claude-code-skills-vs-cursor-rules-vs-codex-skills)
- [SKILL.md vs CLAUDE.md vs AGENTS.md — Termdock](https://www.termdock.com/blog/skill-md-vs-claude-md-vs-agents-md)
- [Anthropic Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/claude-api-skill)
- [Top 10 Claude Agent Skills 2026](https://www.nimbleway.com/blog/anthropic-claude-agent-skills)
- [Top 5 n8n alternatives 2026 (Kestra YAML)](https://dev.to/lightningdev123/top-5-n8n-alternatives-in-2026-choosing-the-right-workflow-automation-tool-54oi)

### Visual workflow editors (2.3)
- [Spatial canvases and your notes — Obsidian Observer](https://medium.com/obsidian-observer/spatial-canvases-and-your-notes-6acae204a98c)
- [tldraw Obsidian plugin](https://github.com/tldraw/obsidian-plugin)
- [tldraw computer](https://computer.tldraw.com/)
- [tldraw Workflow starter kit](https://tldraw.dev/starter-kits/workflow)
- [LangFlow vs Flowise comparison](https://www.leanware.co/insights/compare-langflow-vs-flowise)
- [10 LangFlow alternatives 2026 — Lindy](https://www.lindy.ai/blog/langflow-alternatives)
- [LangChain — Not Another Workflow Builder](https://blog.langchain.com/not-another-workflow-builder/)

### MCP & client landscape (1.9, 1.10)
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP Cheat Sheet 2026 — Webfuse](https://www.webfuse.com/mcp-cheat-sheet)
- [MCP — WorkOS 2026 guide](https://workos.com/blog/everything-your-team-needs-to-know-about-mcp-in-2026)
- [Best MCP Clients 2026 — Nimbalyst](https://nimbalyst.com/blog/best-mcp-clients-2026/)
- [Cursor MCP Servers 2026 guide](https://www.nxcode.io/resources/news/cursor-mcp-servers-complete-guide-2026)
- [Cline vs Roo Code vs Cursor — competitive landscape](https://github.com/cline/cline/issues/9174)
- [Model Context Protocol — Wikipedia (MCP donation to Linux Foundation)](https://en.wikipedia.org/wiki/Model_Context_Protocol)

### Cursor / Continue.dev / Aider context comparison (1.3, 1.7)
- [Continue.dev Context Providers](https://docs.continue.dev/customize/deep-dives/custom-providers)
- [Cursor Rules docs](https://cursor.com/docs/context/rules)
- [Cursor Working with Context](https://docs.cursor.com/guides/working-with-context)
- [Context Management Strategies for Cursor 2026](https://datalakehousehub.com/blog/2026-03-context-management-cursor/)
