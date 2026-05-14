---
phase: 00-foundation-decisions
plan: 13
type: execute
wave: 4
depends_on: [02, 03, 04, 05]
files_modified:
  - docs/v2/adr/README.md
autonomous: true
requirements: [FND-13]
must_haves:
  truths:
    - "ADR index `docs/v2/adr/README.md` lists all four Accepted v2 ADRs (001..004) in the `## Accepted v2 ADRs` table"
    - "ADR index lists ≥14 open ADRs in `## Open ADRs (v3 / Phase 10)` section with `Status: Open` and `Phase: v3-Phase-10` plus a one-line stub description per open ADR (D-22)"
    - "Brief one-line stubs cover the v3 themes named in CONTEXT.md / RESEARCH.md: identity stability across sources, link resolution, property equivalence, granularity, write semantics, auth, watch, rate limits, embedding strategy, cross-source memory, caching, sync, Notion sinks, capability discovery"
  artifacts:
    - path: "docs/v2/adr/README.md"
      provides: "Final ADR index with all v2 Accepted ADRs + 14 v3 Open stubs"
      contains: "Open ADRs"
  key_links:
    - from: "docs/v2/adr/README.md"
      to: "v3 Phase 10"
      via: "Open ADRs section"
      pattern: "v3-Phase-10"
---

<objective>
Finalize the ADR index that plans 02–05 incrementally seeded. After plan 05 lands, the `## Accepted v2 ADRs` table has rows for 001..004. This plan: (a) audits that table for completeness and correctness; (b) populates the `## Open ADRs (v3 / Phase 10)` section with at least 14 one-line stubs covering the v3 themes (per D-22 + the ROADMAP §v3.0.0 — Deferred line listing 14 open ADRs 005–01x). The 14 stub list is the single visible parking lot for v3 work — no separate doc per D-22.

Per CONTEXT.md Claude's Discretion + D-23, the regenerator script is a stretch — defer to a maintenance pass if time slips; this plan ships the manual table directly.

Output: `docs/v2/adr/README.md` finalized with all v2 + v3 entries.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/00-foundation-decisions/00-CONTEXT.md
@.planning/phases/00-foundation-decisions/00-RESEARCH.md
@.planning/phases/00-foundation-decisions/00-VALIDATION.md
@.planning/phases/00-foundation-decisions/00-02-SUMMARY.md
@.planning/phases/00-foundation-decisions/00-03-SUMMARY.md
@.planning/phases/00-foundation-decisions/00-04-SUMMARY.md
@.planning/phases/00-foundation-decisions/00-05-SUMMARY.md
@docs/v2/adr/README.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Audit `## Accepted v2 ADRs` table and finalize `## Open ADRs (v3 / Phase 10)` section</name>
  <read_first>
    - docs/v2/adr/README.md (current state with rows for 001..004 appended by plans 02–05)
    - docs/v2/adr/001-document-identity.md, 002-adapter-seams.md, 003-document-shape.md, 004-memory-sink-handles.md (read each `tags:` frontmatter and `**Status:**` lines to verify index rows match)
    - .planning/ROADMAP.md §v3.0.0 — Deferred + the brief's open-ADR theme list (Notion connector themes listed in ROADMAP line 162)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-22 — column shape, status enum)
    - .planning/phases/00-foundation-decisions/00-VALIDATION.md rows 00-13-01 + 00-13-02 (`| 001 |` rows + `Status: Open` ≥14 + `v3-Phase-10` token)
  </read_first>
  <action>(A) Audit the `## Accepted v2 ADRs` table. Confirm: exactly four data rows for 001..004; each row's `Status` column reads `Accepted`; each row's `Phase` is `0`; each `Title` matches the file's H1 (e.g., ADR-001 = "Document identity is opaque, URI-style", ADR-002 = "Source & Delivery Seams", ADR-003 = "Normalized Document Shape", ADR-004 = "Memory Sink Handles"); each `Tags` column matches the frontmatter `tags:` field in the ADR file. Fix any drift. (B) Replace the placeholder paragraph in `## Open ADRs (v3 / Phase 10)` (seeded by plan 02 Task 3) with a markdown table mirroring the v2 table shape: `| # | Title | Status | Phase | Supersedes | Tags |`. Then add ≥14 data rows for ADRs 005–018 (or 005–01x as needed to reach 14). Each open-ADR row MUST: have `Status: Open` (literal), have `Phase: v3-Phase-10` (literal — for VALIDATION row 00-13-02 grep), have a short one-line title summarizing the v3 theme, have `Supersedes` as `—`, and have realistic Tags. Required theme coverage (one ADR per theme — title text is the planner's choice but MUST cover all 14 themes from RESEARCH §Open Questions / ROADMAP §v3.0.0 / CONTEXT.md): (005) Identity stability across sources (Notion stable IDs vs Obsidian rename), (006) Link resolution across heterogeneous sources, (007) Property equivalence between Notion typed properties and Obsidian YAML, (008) Document granularity — pages vs sub-pages vs blocks, (009) Write semantics — Notion atomic writes vs Obsidian filesystem, (010) Authentication & OAuth flow for Notion adapter, (011) Watch / change-feed for Notion (poll-only, webhook later), (012) Rate-limiting & backoff for source APIs, (013) Embedding strategy for non-text Notion blocks (databases, properties), (014) Cross-source memory — `_memory/` sink shape when source ≠ Obsidian, (015) Caching layer between SourceConnector and core, (016) Sync state — handling missed change events on adapter restart, (017) Notion-native memory sinks (page-as-document vs database-as-sink), (018) Capability discovery — runtime feature flags vs static descriptors. Save these into the table verbatim. The `## Open ADRs` H2 section MUST follow the `## Accepted v2 ADRs` section. (C) After the table, add a brief paragraph explaining that these ADRs are addressed in v3 Phase 10 only after the Phase 9 premise check passes (ROADMAP §Phase 9). (D) Do NOT touch the existing Accepted-table rows beyond fixing drift; do NOT relocate or rename the README file.</action>
  <acceptance_criteria>
    - Match VALIDATION row 00-13-01: `for n in 001 002 003 004; do grep -qE "^\\| ${n} \\|" docs/v2/adr/README.md || exit 1; done && grep -q 'Accepted' docs/v2/adr/README.md` exits 0.
    - Match VALIDATION row 00-13-02: `[ $(grep -c 'Status: Open' docs/v2/adr/README.md) -ge 14 ] && grep -q 'v3-Phase-10' docs/v2/adr/README.md` exits 0. (Note: the literal `Status: Open` MUST appear ≥14 times — this happens when the column-cell shape is `| Open |` rather than `Status: Open` as a bullet. Adjust the table-cell format so the literal substring appears: either reformat the table so each row's status cell contains `Status: Open` as a parenthetical OR add a bullet list parallel to the table with each open ADR named once `Status: Open` — the simplest fix is to add an extra bullet list above or below the table where each ADR appears as `- ADR-NNN — <title> — Status: Open, Phase: v3-Phase-10` for VALIDATION grep compatibility.)
    - Both required H2 sections present: `grep -q '^## Accepted v2 ADRs' docs/v2/adr/README.md && grep -q '^## Open ADRs' docs/v2/adr/README.md`.
    - All 14 themes from the action list are textually present (spot-check by grep on distinguishing keywords from each theme): `grep -qi 'identity stability' docs/v2/adr/README.md && grep -qi 'link resolution' docs/v2/adr/README.md && grep -qi 'property equivalence' docs/v2/adr/README.md && grep -qi 'granularity' docs/v2/adr/README.md && grep -qi 'write semantics' docs/v2/adr/README.md && grep -qi 'auth' docs/v2/adr/README.md && grep -qi 'rate' docs/v2/adr/README.md && grep -qi 'embedding strategy' docs/v2/adr/README.md && grep -qi 'cross-source memory' docs/v2/adr/README.md && grep -qi 'caching' docs/v2/adr/README.md && grep -qi 'capability discovery' docs/v2/adr/README.md`.
  </acceptance_criteria>
  <verify>
    <automated>for n in 001 002 003 004; do grep -qE "^\| ${n} \|" docs/v2/adr/README.md || exit 1; done && [ $(grep -c 'Status: Open' docs/v2/adr/README.md) -ge 14 ] && grep -q 'v3-Phase-10' docs/v2/adr/README.md && grep -q '^## Accepted v2 ADRs' docs/v2/adr/README.md && grep -q '^## Open ADRs' docs/v2/adr/README.md</automated>
  </verify>
  <done>Index audited and finalized; four Accepted rows + ≥14 Open rows / bullets covering the v3 themes; literal grep tokens satisfy VALIDATION rows 00-13-01 + 00-13-02.</done>
</task>

</tasks>

<verification>
- VALIDATION rows 00-13-01 + 00-13-02 pass.
- Adversarial review (plan 14) can now grep the index to verify findings about open vs accepted ADRs.
</verification>

<success_criteria>
- ADR index final: 4 Accepted + ≥14 Open entries.
- Open ADR titles cover the 14 v3 themes named in ROADMAP §v3.0.0 / RESEARCH §Open Questions.
- Cross-links work — every Accepted row links to its file.
</success_criteria>

<output>
After completion, create `.planning/phases/00-foundation-decisions/00-13-SUMMARY.md` listing: the four Accepted-row titles verbatim, the 14 Open-ADR titles verbatim, and any audit fixes (drift in Tags column, etc.) applied to the Accepted table.
</output>
