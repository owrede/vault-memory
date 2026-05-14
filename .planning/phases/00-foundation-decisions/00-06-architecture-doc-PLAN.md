---
phase: 00-foundation-decisions
plan: 06
type: execute
wave: 2
depends_on: [01]
files_modified:
  - docs/v2/ARCHITECTURE.md
autonomous: true
requirements: [FND-05]
must_haves:
  truths:
    - "`docs/v2/ARCHITECTURE.md` exists with the v2 layer model (L0 retrieval / L1 graph / L2 memory / L3 assembly / L4 contracts) on top of an Adapter tier"
    - "Document is ≤800 lines (Claude's discretion bound from CONTEXT.md)"
    - "Document references ADR-001..004 by ID and name (cross-links to docs/v2/adr/...) so the adversarial reviewer in plan 14 can navigate"
    - "Tone matches `docs/dev/gsd-agent-knowledg-layer.md` — technical, dense, no marketing copy"
  artifacts:
    - path: "docs/v2/ARCHITECTURE.md"
      provides: "v2 layer model + responsibility map + data-flow narrative"
      contains: "L0"
  key_links:
    - from: "docs/v2/ARCHITECTURE.md"
      to: "docs/v2/adr/001-document-identity.md, 002, 003, 004"
      via: "markdown links to the ADRs"
      pattern: "docs/v2/adr/00[1-4]"
---

<objective>
Publish `docs/v2/ARCHITECTURE.md` — the public-facing layer model that frames the entire v2 line. Source material already exists in `.planning/research/ARCHITECTURE.md` and the v2 brief `docs/dev/gsd-agent-knowledg-layer.md`; this task synthesizes them into a single doc structured around the L0 → L4 layer model + the Adapter tier underneath, with cross-links to ADRs 001–004. This is the doc the Phase 9 adversarial reviewer (plan 14) reads alongside the four ADRs.

Purpose: a single canonical architecture doc means every later phase plan can `@docs/v2/ARCHITECTURE.md` instead of cobbling context from research notes. The ≤800-line bound forces clarity over completeness; details belong in ADRs.

Output: `docs/v2/ARCHITECTURE.md` published.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/00-foundation-decisions/00-CONTEXT.md
@.planning/phases/00-foundation-decisions/00-RESEARCH.md
@.planning/phases/00-foundation-decisions/00-VALIDATION.md
@.planning/research/ARCHITECTURE.md
@.planning/codebase/ARCHITECTURE.md
@.planning/codebase/STRUCTURE.md
@docs/dev/gsd-agent-knowledg-layer.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Author `docs/v2/ARCHITECTURE.md` — layer model + responsibility map (≤800 lines)</name>
  <read_first>
    - .planning/research/ARCHITECTURE.md (primary source — research-derived architecture)
    - docs/dev/gsd-agent-knowledg-layer.md (the v2 brief — source-of-truth for the layer model)
    - .planning/codebase/ARCHITECTURE.md (current codebase architecture — informs the Adapter-tier description)
    - .planning/codebase/STRUCTURE.md (directory layout)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (Claude's Discretion §"Doc tone and length — ≤ 800 lines")
    - .planning/phases/00-foundation-decisions/00-VALIDATION.md row 00-05-01 (exact grep for `L0|L1|L2|L3|L4` and line-count bound)
  </read_first>
  <action>Create `docs/v2/ARCHITECTURE.md`. Required structure (use H1/H2/H3 headings exactly as listed; content density is the planner's call within the ≤800-line bound): (1) `# vault-memory v2 — Architecture` H1. (2) `## Overview` — 2–3 paragraphs: the v1→v2 transition framing (Layer 0 retrieval substrate → full agentic knowledge layer), the source-agnostic-ready stance, the memory namespace as non-negotiable safety invariant. (3) `## Layer model` — describe each layer with one H3 subsection per layer, in order: `### Adapter tier`, `### L0 — Retrieval substrate`, `### L1 — Graph as retrieval`, `### L2 — Memory namespace & provenance`, `### L3 — Assembly (bundles, outlines, dossiers, authority/staleness)`, `### L4 — Compiled briefs + Task contracts`. Each subsection MUST contain: (a) one paragraph describing the layer's responsibility; (b) a fenced code block or bullet list naming the primary tools/interfaces at that layer; (c) cross-link to the relevant ADR(s) using markdown links (`[ADR-001](adr/001-document-identity.md)` form). The literal tokens `L0`, `L1`, `L2`, `L3`, `L4` MUST each appear as their own H3 heading or in surrounding prose so the VALIDATION grep `grep -qE 'L0|L1|L2|L3|L4'` succeeds. (4) `## Responsibility map` — markdown table with columns `Layer | Primary tier | Key interfaces | Owning ADR | Phase`. One row per layer (5 rows minimum: Adapter, L0, L1, L2, L3 — L4 can fold into L3 row or get its own). (5) `## Data flow — read path` — narrative + ASCII diagram (≤30 lines) showing: MCP client → server → SourceConnector → retrieval pipeline → assembly tools → MCP response with citation packet. (6) `## Data flow — write path` — narrative + ASCII diagram showing: MCP client → server → DeliveryAdapter validator (Guard A + Guard B per ADR-004) → memory-sink resolution → atomic write → audit_log. (7) `## Source-neutrality contract` — 1–2 paragraphs explaining how `obsidian-fs://` is the only v2 adapter but the seams (ADR-002) and identity scheme (ADR-001) make a Phase 10 `notion-api://` adapter purely additive. Include both schemes inline as examples. (8) `## Out of scope (v2)` — bulleted list referring to the REQUIREMENTS.md Out of Scope section: no cloud sync, no telemetry, no remote LLM bundling, no path-as-PK after Phase 1. (9) `## See also` — bulleted markdown links to MEMORY_CONTRACT.md (sibling doc, may not yet exist — link anyway), AGENT_AGNOSTIC.md (sibling), the four ADRs, the v2 ROADMAP. Tone constraint: technical, dense, no marketing superlatives. Hard upper bound: 800 lines total. Aim for 400–600. Do not include implementation TypeScript code — interface signatures go in ADRs.</action>
  <acceptance_criteria>
    - Match VALIDATION row 00-05-01: `test -f docs/v2/ARCHITECTURE.md && grep -qE 'L0|L1|L2|L3|L4' docs/v2/ARCHITECTURE.md && [ $(wc -l < docs/v2/ARCHITECTURE.md) -le 800 ]` exits 0.
    - `grep -q '^## Layer model' docs/v2/ARCHITECTURE.md && grep -q '^### Adapter tier' docs/v2/ARCHITECTURE.md` exits 0.
    - `grep -q 'docs/v2/adr/001' docs/v2/ARCHITECTURE.md || grep -q '(adr/001' docs/v2/ARCHITECTURE.md` (cross-link to ADR-001 present, relative or absolute path form).
    - `grep -q 'obsidian-fs://' docs/v2/ARCHITECTURE.md && grep -q 'notion-api://' docs/v2/ARCHITECTURE.md` (source-neutrality demonstrated by including both schemes).
    - `[ $(wc -l < docs/v2/ARCHITECTURE.md) -ge 200 ]` (sanity: doc is not a stub).
    - `! grep -qiE 'blazingly fast|magnificent|game[ -]?changing' docs/v2/ARCHITECTURE.md` (marketing-language smoke test).
  </acceptance_criteria>
  <verify>
    <automated>test -f docs/v2/ARCHITECTURE.md && grep -qE 'L0|L1|L2|L3|L4' docs/v2/ARCHITECTURE.md && [ $(wc -l < docs/v2/ARCHITECTURE.md) -le 800 ] && [ $(wc -l < docs/v2/ARCHITECTURE.md) -ge 200 ] && grep -q 'obsidian-fs://' docs/v2/ARCHITECTURE.md && grep -q 'notion-api://' docs/v2/ARCHITECTURE.md</automated>
  </verify>
  <done>ARCHITECTURE.md published, layer model explicit, cross-linked to ADRs, ≤800 lines, dual-scheme examples present.</done>
</task>

</tasks>

<verification>
VALIDATION row 00-05-01 passes. Cross-links from ADR-002 (Examples section) to this doc are implicit; ADR linking goes one way here (this doc → ADRs). The adversarial reviewer (plan 14) reads this alongside the ADRs.
</verification>

<success_criteria>
- `docs/v2/ARCHITECTURE.md` exists, ≤800 lines, ≥200 lines, layer model + responsibility map + data-flow narratives present, dual-scheme examples present.
- No marketing language.
- Cross-linked to ADRs.
</success_criteria>

<output>
After completion, create `.planning/phases/00-foundation-decisions/00-06-SUMMARY.md` listing the section structure used, final line count, and any deviations from the research-derived architecture doc.
</output>
