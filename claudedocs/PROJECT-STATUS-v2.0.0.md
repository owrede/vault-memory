# Project Status vault-memory v2.0.0 — Overview

As of: 2026-05-26. Sources: ROADMAP.md, PROJECT.md, STATE.md, CHANGELOG, test run
(1693 passed / 11 skipped, tsc clean), tool/resource snapshots, git history.

---

## 1. The goals of v2.0.0

vault-memory v1.0.0 was a **retrieval substrate** (Layer 0): hybrid search, 23 tools,
live indexing. v2.0.0 was meant to turn that into an **agentic knowledge layer** that
beats the core problem: *"Agents rediscover 85% of their context on every run."*

Six goal pillars (ROADMAP 0→9):

| # | Goal | Phase |
|---|---|---|
| 1 | **Adapter seams** — decouple source/delivery/changefeed (v3-Notion-ready) | 1 |
| 2 | **Memory namespace + provenance** — the non-negotiable safety invariant | 2 |
| 3 | **Bundles + authority/staleness** — document-tree retrieval, citation packets | 3 |
| 4 | **Graph-as-retrieval** — typed-edge expansion, community clustering | 4 |
| 5 | **Compiled briefs** — briefs as documents with a staleness daemon (signature feature) | 5 |
| 6 | **Task contracts** — declarative YAML recipes, instantiable via MCP | 6 |
| + | **Obsidian plugin** — visual contract editor + chrome | 7 |

---

## 2. What the current state delivers (achieved & by what)

**Phases 1–7: COMPLETE.** Verified by 1693 green tests + tsc clean.

### Goal 1 — Adapter seams ✓
`src/adapters/{source,delivery,change-feed}/` with an `obsidian-fs` impl + stub adapter.
CI greps (`lint-adapters.sh`) enforce that `chokidar`/`fs`/`gray-matter`/`yaml` only appear
in adapters. Branded `DocId` (nominal). MCP SDK ^1.29 + Zod ^4. **By what:** all 324 v1
tests stayed green (purely architectural rework), stub-parity conformance suite.

### Goal 2 — Memory namespace + provenance ✓ (the core invariant)
Agent writes go **only** to a labeled `MemorySink`, enforced at the ONE chokepoint
`DeliveryAdapter.write()` (MEM-05, un-bypassable). Tools: `record_observation`, `recall`,
`supersede`. Guards on v1 `write_note`/`update_frontmatter` reject sink targets. The
`.memory-sink` sentinel is the only sink resolver. **By what:** a centralized provenance
validator + conformance cases 11–21.

### Goal 3 — Bundles + authority/staleness ✓
`get_document_bundle`, `get_outline`, `search_sections`, `assemble_dossier` — all with an
8-field citation packet. `search_hybrid` optionally takes `recency_weight`/`authority_weight`.
**By what:** v1 default path byte-identical (invariance pin in `hybrid.rescore.test.ts`),
≥8 dossier eval queries.

### Goal 4 — Graph-as-retrieval ✓
`expand` (BFS primitive), `cluster` (graphology + Louvain, deterministic), `edges` table
with 4 typed edges. Cross-adapter conformance. **By what:** Phase-4 tests + stub parity.

### Goal 5 — Compiled briefs ✓ (signature differentiator)
Briefs as `Document`s in `_memory/_briefs/` with `compiled_from`, chunk-level
`source_hashes`, provenance. Staleness daemon via `ChangeFeed.subscribe()`, single-owner
per lock, replays missed events. LLM ladder: **MCP Sampling → Ollama → prepared_text** (never
a bundled remote LLM SDK). **By what:** `daemon.test.ts`, conformance BRF-11 (4 cases × 2
adapters), ADR-005.

### Goal 6 — Task contracts ✓ (with a caveat, see §3)
Declarative YAML contracts, closed assembly-verb enum (11 baseline + `literal` +
`mcp://` peer), `{{template}}` composition, MemorySink-only writes. 3 tools
(`describe_contract`, `instantiate_contract`, `register_contracts_as_tools`). **By what:**
Phase-6 sign-off, CON-10 stub parity, CON-09 non-Claude smoke test.

### Goal 7 — Obsidian plugin ✓
Visual contract editor (canvas + inspector + palette, Svelte Flow), custom `.contract` JSON
format ↔ Phase-6 YAML codec, settings/secrets/reindex/stats/sources panel.

### Beyond the roadmap
- **Sources Registry (ADR-025, Phase 8)** — peer-MCP sources as MCP resources.
- **Real-vault eval harness** — reproducible MRR@10 against a real vault.

### Surface tally
- **37 MCP tools** (v1: 23 → +14 in v2), v1 surface preserved byte-identical.
- **13 MCP resources** (memory-sinks, briefs, contracts, contract-verbs, sources, …).
- **1693 tests** green, tsc clean, all adapter lints green.

---

## 3. Open ends

### A. The v2.0.0 release itself — NOT done
- **Phase 8 is 7/8 complete.** What's missing is **Plan 08-08: the v2.0.0 cut** (cold-read,
  `release.mjs`, npm publish, GitHub Release, sign-off). Human-gated.
- RC history shows friction: rc.3 was tagged, but npm publish failed on a registry-internal
  404; **rc.4 supersedes rc.3**. A ruleset-push question is open.

### B. Contracts do NOT run for real — the critical finding of this session
A live run of the `meeting-prep` contract against the **real** server (instead of mocks)
revealed: **9 of 11 verbs** have diverging output shapes across JSDoc, plugin catalog, and
the real impl. Consequences:
1. The shipped reference contracts do not run for real (`expand` returns `{documents}`, not
   `{doc_ids}`; templates cannot project).
2. The editor offers **wrong** output fields → users wire up dead refs.
3. `compile_brief` writes itself → the fixture `write_back` always fails.

→ Addressed by **ADR-026** (Contract as Context-Spec) + **ADR-027** (Verb Output
Normalization), both *Proposed*. Planned as **Phase 8.5 BEFORE v2.0.0** (an inserted INSERTED
phase, decided this session). Only after Phase-8.5 sign-off do we return to the 08-08 cut.

### C. Known, documented backlog items
- **Alias/acronym recall gap** (e.g. "JHE") — aliases do not feed the FTS index. Documented,
  not release-blocking.
- **Memory-sink onboarding** — `compile_brief`/contracts fail when `_memory/.memory-sink` is
  missing in the vault; auto-discovery needs the sentinel. Easing planned in Phase 8.5.

### D. Not yet started
- **Phase 8.5 (INSERTED, before v2.0.0)**: "Contracts real-running" — verb normalization,
  trustworthy editor, real fixtures. Gates the v2.0.0 cut (Plan 08-08). See ROADMAP §Phase
  8.5 + ADR-026/027.
- **Phase 9 (unchanged)**: "Pre-Phase-10 premise check" (hard gate before v3). Keeps its
  number — anchored across 8 ADRs + ARCHITECTURE/AGENT_AGNOSTIC. Numbering conflict resolved:
  the new contracts work was inserted as decimal Phase 8.5 (ROADMAP convention for INSERTED),
  Phase 9 stays the premise check.
- **v3.0.0 (deferred)**: Notion connector — its own milestone, outside v2 scope.

### E. Uncommitted work of this session
- New: `docs/v2/adr/026-…`, `027-…`, ADR-README index update, `claudedocs/` (plans +
  analyses). dist/cli.js + AGENTS.md are build/tooling noise.

---

## 4. In one sentence

**v2.0.0 technically achieved six of the seven goal pillars and locked them in with 1693
tests — but the flagship "Task Contracts" feature does not run reliably end-to-end against
the real server (mocks hid it), which is why an inserted Phase 8.5 (verb normalization +
trustworthy editor + real fixtures) was added before the release cut.**
