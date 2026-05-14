---
phase: 00-foundation-decisions
plan: 07
type: execute
wave: 3
depends_on: [02]
files_modified:
  - docs/v2/MEMORY_CONTRACT.md
autonomous: true
requirements: [FND-06]
must_haves:
  truths:
    - "`docs/v2/MEMORY_CONTRACT.md` exists with the property contract for agent-authored documents"
    - "Properties documented: `source`, `confidence`, `evidence`, `status`, `observed_at`, `superseded_by`, `type` (REQUIREMENTS.md FND-06 verbatim list)"
    - "Properties are defined in terms of `Document.properties` (per ADR-003 PropertyBag), not YAML frontmatter raw"
    - "Document is ≤800 lines (CONTEXT.md Claude's Discretion bound)"
  artifacts:
    - path: "docs/v2/MEMORY_CONTRACT.md"
      provides: "Memory namespace property contract — Guard A keys, allowed values, validator rules"
      contains: "confidence"
  key_links:
    - from: "docs/v2/MEMORY_CONTRACT.md"
      to: "docs/v2/adr/004-memory-sink-handles.md"
      via: "depends-on link in body"
      pattern: "ADR-004"
---

<objective>
Publish `docs/v2/MEMORY_CONTRACT.md` — the canonical property contract every agent-authored document in a memory sink must satisfy. The contract is consumed by Phase 2's `DeliveryAdapter.write()` validator (Guard A: required keys present; Guard B: `source: agent` only inside sinks). Phase 5 (briefs) and Phase 6 (contracts) reference this doc by name.

Purpose: Phase 2 work needs a single authoritative document listing the required properties, their types, their allowed values, and the validator's behavior on missing/invalid input. Defining the contract in Phase 0 means Phase 2's implementation has no spec ambiguity.

Output: `docs/v2/MEMORY_CONTRACT.md` published.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/phases/00-foundation-decisions/00-CONTEXT.md
@.planning/phases/00-foundation-decisions/00-RESEARCH.md
@.planning/phases/00-foundation-decisions/00-VALIDATION.md
@docs/dev/004-memory-sink-handles.md
@docs/dev/003-document-shape.md
@docs/dev/gsd-agent-knowledg-layer.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Author `docs/v2/MEMORY_CONTRACT.md` — required properties, allowed values, validator behavior (≤800 lines)</name>
  <read_first>
    - .planning/REQUIREMENTS.md lines 13–25 (FND-06 verbatim — required property list: `source`, `confidence`, `evidence`, `status`, `observed_at`, `superseded_by`, `type`)
    - docs/dev/004-memory-sink-handles.md (read the existing MemoryContract YAML schema block — RESEARCH says it's around line 119–137 of source ADR-004)
    - docs/dev/003-document-shape.md (read the `PropertyBag` / `properties` block to anchor the contract on `Document.properties` not YAML)
    - docs/dev/gsd-agent-knowledg-layer.md (memory-namespace section — search for `_memory` and `provenance`)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (Claude's Discretion §"≤ 800 lines" bound; FND-06 phrasing)
    - .planning/phases/00-foundation-decisions/00-VALIDATION.md row 00-06-01 (exact grep tokens — `confidence|evidence|status|provenance`)
  </read_first>
  <action>Create `docs/v2/MEMORY_CONTRACT.md`. Required structure: (1) `# Memory Contract — v2` H1. (2) `## Purpose` paragraph: the contract is what `DeliveryAdapter.write()` validates before writing to any configured MemorySink (per ADR-004). It is expressed against `Document.properties` (the PropertyBag from ADR-003), NOT against raw YAML frontmatter — adapters translate frontmatter ↔ PropertyBag at the boundary. (3) `## Required properties` H2 with one H3 subsection per property in REQUIREMENTS.md FND-06 list, in this exact order: `### source` (allowed values: `agent`, `user`, `imported`; default for memory-sink writes: `agent`); `### confidence` (allowed values: `direct`, `inferred`, `uncertain`; type: string enum); `### evidence` (type: array of strings; each element a `DocId` or a free-text citation; MAY be empty for `confidence: direct`); `### status` (allowed values: `active`, `superseded`, `archived`; default: `active`); `### observed_at` (type: ISO 8601 timestamp string; MUST be set at write time by the agent; the validator MUST reject writes missing this); `### superseded_by` (type: `DocId | null`; non-null iff status is `superseded`; cross-references another doc in the same or a different sink); `### type` (free-form short string tag — examples: `observation`, `brief`, `note`, `status-update`; used by `recall()` filtering). Each H3 subsection MUST list: type, allowed values (or "free-form"), validator behavior on missing, validator behavior on invalid, one worked example value. (4) `## Validator behavior` H2 with two H3 subsections: `### Guard A — required keys present` (the writer's properties MUST contain every key from §Required properties; missing keys cause `{ok: false, reason: "missing_provenance"}` structured error); `### Guard B — source=agent confinement` (writes with `properties.source === "agent"` are FORBIDDEN unless the target DocId resolves into a configured MemorySink; the validator MUST reject with `{ok: false, reason: "agent_write_outside_sink"}` otherwise). Both guards run at `DeliveryAdapter.write()` (per ADR-002 invariant — single chokepoint), NOT in tool handlers. (5) `## PropertyBag mapping for Obsidian` H2 — show how the Obsidian frontmatter→PropertyBag adapter encodes the seven keys. Include a worked YAML frontmatter block and the corresponding PropertyBag JSON (matching ADR-003's PropertyBag shape with `{type, value}` cells if relevant). (6) `## Examples` H2: (a) a valid agent observation in `_memory/observations/...` with all seven properties; (b) a valid brief in `_memory/_briefs/...` with type=brief and an evidence array of source DocIds; (c) a rejected example — write missing `observed_at`, showing the structured error returned. Cross-link to ADR-003 (PropertyBag), ADR-004 (MemorySink + sentinel). (7) `## See also` H2 — markdown links to ARCHITECTURE.md (sibling), ADR-003, ADR-004, AGENT_AGNOSTIC.md. ≤800 lines total; aim 300–500. The literal token `provenance` MUST appear at least once for the VALIDATION grep (`confidence|evidence|status|provenance`).</action>
  <acceptance_criteria>
    - Match VALIDATION row 00-06-01: `test -f docs/v2/MEMORY_CONTRACT.md && grep -qE 'confidence|evidence|status|provenance' docs/v2/MEMORY_CONTRACT.md` exits 0.
    - All seven required properties named as H3 headings or in body: `grep -q '^### source' docs/v2/MEMORY_CONTRACT.md && grep -q '^### confidence' docs/v2/MEMORY_CONTRACT.md && grep -q '^### evidence' docs/v2/MEMORY_CONTRACT.md && grep -q '^### status' docs/v2/MEMORY_CONTRACT.md && grep -q '^### observed_at' docs/v2/MEMORY_CONTRACT.md && grep -q '^### superseded_by' docs/v2/MEMORY_CONTRACT.md && grep -q '^### type' docs/v2/MEMORY_CONTRACT.md` exits 0.
    - Both guards present: `grep -q 'Guard A' docs/v2/MEMORY_CONTRACT.md && grep -q 'Guard B' docs/v2/MEMORY_CONTRACT.md`.
    - Document references the PropertyBag concept: `grep -q 'PropertyBag\\|properties' docs/v2/MEMORY_CONTRACT.md`.
    - `[ $(wc -l < docs/v2/MEMORY_CONTRACT.md) -le 800 ] && [ $(wc -l < docs/v2/MEMORY_CONTRACT.md) -ge 150 ]`.
    - `! grep -qiE 'blazingly fast|magnificent|game[ -]?changing' docs/v2/MEMORY_CONTRACT.md` (marketing-language check).
  </acceptance_criteria>
  <verify>
    <automated>test -f docs/v2/MEMORY_CONTRACT.md && grep -qE 'confidence|evidence|status|provenance' docs/v2/MEMORY_CONTRACT.md && grep -q '^### source' docs/v2/MEMORY_CONTRACT.md && grep -q '^### confidence' docs/v2/MEMORY_CONTRACT.md && grep -q '^### observed_at' docs/v2/MEMORY_CONTRACT.md && grep -q '^### superseded_by' docs/v2/MEMORY_CONTRACT.md && grep -q 'Guard A' docs/v2/MEMORY_CONTRACT.md && grep -q 'Guard B' docs/v2/MEMORY_CONTRACT.md && [ $(wc -l < docs/v2/MEMORY_CONTRACT.md) -le 800 ]</automated>
  </verify>
  <done>MEMORY_CONTRACT.md published with all seven properties + both guards + dual-format mapping + worked examples; ≤800 lines.</done>
</task>

</tasks>

<verification>
VALIDATION row 00-06-01 passes. Phase 2's `DeliveryAdapter.write()` validator implementation will reference this doc directly; the seven-property list and the two guards are the implementation contract.
</verification>

<success_criteria>
- `docs/v2/MEMORY_CONTRACT.md` exists, ≤800 lines, ≥150 lines.
- All seven required properties present as H3 subsections.
- Guard A + Guard B described as `DeliveryAdapter.write()` behavior, not tool-handler behavior.
- Properties anchored on `Document.properties` (ADR-003 PropertyBag), not raw YAML.
- Worked examples for valid and rejected writes.
</success_criteria>

<output>
After completion, create `.planning/phases/00-foundation-decisions/00-07-SUMMARY.md` listing the seven properties' allowed values, the two guards' exact structured-error responses, and any deviations from REQUIREMENTS FND-06.
</output>
