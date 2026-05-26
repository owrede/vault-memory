# vault-memory — Roadmap & Genesis

*How this project came to be, in plain language. The "Goal" column describes the purpose;
the "Implementation" column names the technical realization including the jargon — if you
don't need it, just read the left side.*

> Note: This is the **narrative** roadmap for humans. The operational phase planning lives
> in [`.planning/ROADMAP.md`](.planning/ROADMAP.md).

---

## 1. What vault-memory 1.0.0 was

A bridge between your Obsidian notes and an AI: the AI could **search, read, and write to
your notes in a controlled way** — fast and locally on your machine, no cloud.

| Goal | Implementation |
|---|---|
| Find notes by *meaning*, not just by keyword | Hybrid search (semantic + keyword + RRF fusion) |
| Optional sharpening of the best matches | Cross-encoder reranking (ONNX) |
| Notice file changes immediately | Live indexing (file watcher) |
| Multiple notebooks at once | Multi-vault |
| Safe, collision-free writes | Hash-protected atomic writes |
| ~23 tools for an AI to use | MCP tools |

**In short:** v1.0.0 was a **strong search-and-read layer** — a fast librarian that finds
and delivers.

---

## 2. What vault-memory 2.0.0 does differently

v1 found things. v2 turns that into a **reasoning knowledge assistant** that *assembles and
retains* context instead of rediscovering it on every request. This addresses a known
problem: AI agents rediscover roughly 85% of their context on every run.

| Goal | Implementation |
|---|---|
| The AI **never silently writes** into your notes — only into a separate AI memory, with a provenance stamp | Memory namespace + provenance; un-bypassable at the DeliveryAdapter chokepoint |
| Results with source citations, not loose hits | Citation packets; bundles / dossiers |
| Follow the web of links between notes, detect topic clusters | Graph-as-retrieval; typed edges; community clustering (Louvain) |
| Combine several notes into one ready-made briefing | Compiled briefs (`compile_brief`) |
| A briefing knows on its own when its sources go stale | Source-hash staleness daemon |
| Saved research recipes for recurring tasks | Task contracts (YAML DSL) |
| Assemble those recipes visually | Obsidian plugin (canvas editor) |
| Prepared for other sources/databases, not just Obsidian | Adapter seams (source / delivery / change-feed) |

**In short:** v2.0.0 is the **agentic knowledge layer** — a safe, source-cited, reusable
knowledge layer.

> **Honest status:** Six of the seven pillars are built and covered by ~1693 tests. The
> flagship "Task Contracts" feature, however, did **not run reliably** in the first real
> end-to-end test — the building blocks did not speak the same language. This is fixed in
> an inserted **Phase 8.5** before release.

---

## 3. Themes that emerged during development

Over the course of the work (and through real testing) five larger themes emerged. They
are recorded as architecture decisions and are mostly **concepts for the future** (v2.x /
v3), not part of v2.0.0.

| Goal | What it is about | Status | Implementation |
|:--|---|---|---|
| **Contracts must actually run** | Get the research building blocks to speak one language so recipes work for real users | pre-v2.0.0 | Verb output normalization; ADR-027 |
| **Recipes are context specifications** | A recipe gives the agent an optimally composed "viewport" (scope, order, budget) | concept | Context-window spec; ADR-026 |
| **Research ≠ acting** | A contract only *researches* (safely). What should ultimately *be produced or happen* (a document, an email) is a separate layer | concept | Workflow vs. research pipeline; ADR-028 |
| **The system should learn** | Pick up user feedback ("remember to also do X") automatically and improve recipes — requires quality signals first | concept | Learning loops / quality signals; ADR-029 |
| **Precomputed results** | Answer frequent structured questions ahead of time and cache them — faster, fewer tokens | concept (strategic bet) | Precompiled artifacts; ADR-030 |

### Two cross-cutting insights

| Goal | Implementation |
|---|---|
| "Old" does not mean "unimportant" but "review-worthy" — age is a curation signal, not a demotion | Staleness as a curation signal; ADR-021 (amended) |
| Not every choice is "the AI decides" — some need a mathematical optimizer that filters thousands of variants down to the best 3–12 for a human | Deterministic optimizer (e.g. Hungarian method) as a quality gate; ADR-028 |

---

## 4. Where it's headed (rough line)

| Milestone | Goal | Implementation |
|---|---|---|
| **v2.0.0** (imminent) | Safe, source-cited knowledge layer + runnable recipes | agentic knowledge layer |
| **v2.x** | Recipes get smarter: context budgets, learning from feedback, precomputed results | Context-spec, learning loops, artifacts |
| **v3.0.0** | Connect further sources (e.g. Notion) — no longer only Obsidian | Notion connector; further adapters |
| **possibly a separate system / "4.0"** | The *action* layer (workflows, actions, optimizers) — separated from the safe memory core | Workflow layer; deterministic optimizers |

---

## 5. The guiding principle that never wavers

> The AI must **never silently write into your notes.** Every piece of information the AI
> authors lands, with a provenance stamp, in a **separate, labeled AI memory** — never in
> your own notes. This single rule is the non-negotiable safety foundation of the whole
> system.

*(Technically: the memory-namespace invariant, centrally enforced at the
`DeliveryAdapter.write()` chokepoint.)*

---

*A detailed, everyday-language explanation of how it works is in
[`docs/v2/HOW-IT-WORKS.md`](docs/v2/HOW-IT-WORKS.md). All architecture decisions:
[`docs/v2/adr/`](docs/v2/adr/README.md).*
