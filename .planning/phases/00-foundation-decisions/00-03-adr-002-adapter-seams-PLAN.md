---
phase: 00-foundation-decisions
plan: 03
type: execute
wave: 3
depends_on: [02]
files_modified:
  - docs/dev/002-source-and-delivery-seams.md
  - docs/v2/adr/002-adapter-seams.md
  - docs/v2/adr/README.md
autonomous: true
requirements: [FND-01, FND-04, FND-13]
must_haves:
  truths:
    - "ADR-002 lives at the public path `docs/v2/adr/002-adapter-seams.md` (renamed from `002-source-and-delivery-seams.md` per CONTEXT canonical_refs)"
    - "`git log --follow docs/v2/adr/002-adapter-seams.md` traces back through both the rename-and-filename-change and the pre-rename history"
    - "ADR-002 has `## Invariants` and `## Examples` sections; Examples cover both `obsidian-fs://` AND `notion-api://` adapter cases"
    - "ADR index README has a row for `| 002 | … Adapter Seams … | Accepted | …`"
  artifacts:
    - path: "docs/v2/adr/002-adapter-seams.md"
      provides: "ADR-002 with Invariants + Examples"
      contains: "## Invariants"
    - path: "docs/v2/adr/README.md"
      provides: "Index appended with ADR-002 row"
      contains: "| 002 |"
  key_links:
    - from: "docs/v2/adr/README.md"
      to: "docs/v2/adr/002-adapter-seams.md"
      via: "markdown link"
      pattern: "002-adapter-seams.md"
---

<objective>
Apply the proven ADR-001 pattern (plan 02) to ADR-002. Two extra wrinkles vs ADR-001: (a) the filename changes from `002-source-and-delivery-seams.md` to `002-adapter-seams.md` per CONTEXT.md canonical_refs line 76 (and RESEARCH Open Question 3 — `git mv` with a new filename is fully supported by rename detection, but increases the same-commit risk, so the two-commit pattern is non-negotiable); (b) the Invariants set is content-specific to the three adapter interfaces (`SourceConnector`, `DeliveryAdapter`, `ChangeFeed`).

Purpose: complete the v2 adapter-seams ADR as the contract that Phase 1's extraction will satisfy. The Invariants section also informs Phase 1's CI greps (chokidar/path/fs only inside `src/adapters/`).

Output: ADR-002 public + amended + indexed.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/00-foundation-decisions/00-CONTEXT.md
@.planning/phases/00-foundation-decisions/00-RESEARCH.md
@.planning/phases/00-foundation-decisions/00-VALIDATION.md
@.planning/phases/00-foundation-decisions/00-02-SUMMARY.md
@.planning/codebase/CONCERNS.md
@docs/dev/002-source-and-delivery-seams.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Commit A — `git mv` ADR-002 with simultaneous filename change to `002-adapter-seams.md`</name>
  <read_first>
    - docs/dev/002-source-and-delivery-seams.md (full file — 283 lines; do NOT modify content in this task)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (canonical_refs line 76 — target filename is `002-adapter-seams.md`, not the source name)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Pattern 1 + §Open Question 3 (filename change during rename is safe with two-commit pattern)
    - .planning/phases/00-foundation-decisions/00-02-SUMMARY.md (pattern-proof outcome from plan 02)
  </read_first>
  <action>Confirm plan 02's `git log --follow` check passed before proceeding (read the prior SUMMARY). Run `git mv docs/dev/002-source-and-delivery-seams.md docs/v2/adr/002-adapter-seams.md`. Commit with message `docs(adr-002): relocate to public docs/v2/adr/ and rename to adapter-seams`. This commit MUST contain zero content edits — the rename PLUS filename change is a single `git mv` operation; git's rename detection handles both. No `--amend`.</action>
  <acceptance_criteria>
    - `test -f docs/v2/adr/002-adapter-seams.md` exits 0.
    - `! test -e docs/dev/002-source-and-delivery-seams.md` exits 0.
    - `git log --follow --oneline docs/v2/adr/002-adapter-seams.md | wc -l` ≥ 2.
    - `diff <(git show HEAD:docs/v2/adr/002-adapter-seams.md) <(git show HEAD~1:docs/dev/002-source-and-delivery-seams.md)` is empty (zero content change in the rename commit).
  </acceptance_criteria>
  <verify>
    <automated>test -f docs/v2/adr/002-adapter-seams.md && ! test -e docs/dev/002-source-and-delivery-seams.md && [ $(git log --follow --oneline docs/v2/adr/002-adapter-seams.md | wc -l) -ge 2 ]</automated>
  </verify>
  <done>ADR-002 is at its public path with the new filename; history extends back.</done>
</task>

<task type="auto">
  <name>Task 2: Commit B — amend ADR-002 with `## Invariants`, `## Examples`, and `Tags:` frontmatter</name>
  <read_first>
    - docs/v2/adr/002-adapter-seams.md (the just-relocated file — read the `SourceConnector`, `DeliveryAdapter`, `ChangeFeed` interface definitions)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-03, D-04, D-23)
    - .planning/codebase/CONCERNS.md (seam-leak hotspots — informs invariant language: raw `fs.*`, chokidar imports outside adapters, `obsidian://` URL construction, hardcoded `.obsidian/**`)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Example 7 (template format) and §Architectural Responsibility Map
  </read_first>
  <action>Edit `docs/v2/adr/002-adapter-seams.md` in place. (1) Add top-of-file YAML frontmatter: `---\ntitle: Source & Delivery Seams\nstatus: Accepted\nphase: 0\ntags: adapters, seams, source-connector, delivery-adapter, change-feed, capability-descriptors\n---\n` and update existing `**Status:** Proposed` to `**Status:** Accepted` in the body. (2) Add `## Invariants` section AFTER the existing `## Decision` (and after the interface code blocks) and BEFORE any `## Consequences`/`## Alternatives` section if present. Author at least six normative invariants, each in `**I-N**:` bullet form. Required invariants (paraphrase the rule, do not copy text verbatim from CONCERNS.md — write each as a MUST/MUST-NOT directive): (a) `chokidar` import is FORBIDDEN outside `src/adapters/change-feed/` after the Phase 1 refactor; (b) raw `fs.*` calls (`fs.readFile`, `fs.writeFile`, `fs.stat`, `fs.readdir`) are FORBIDDEN outside `src/adapters/source/obsidian-fs/` and `src/adapters/delivery/obsidian-fs/`; (c) `path.join`/`path.resolve` calls are FORBIDDEN outside adapter modules — core code accepts `DocId` (per ADR-001) and delegates filesystem joining to the adapter; (d) `gray-matter` import is FORBIDDEN outside `src/adapters/source/obsidian-fs/`; (e) bare `.md` literals (`endsWith('.md')`, `.replace(/\\.md$/, ...)`) are FORBIDDEN outside adapter modules — the canonical document type carries no file extension assumption; (f) all writes MUST route through `DeliveryAdapter.write(...)` — direct filesystem write calls (`fs.writeFile`, `fs.writeFileSync`) outside the obsidian-fs delivery adapter are FORBIDDEN. (3) Add `## Examples` AFTER `## Consequences`. Examples MUST include: (a) a worked `SourceConnector` impl sketch for `obsidian-fs://my-vault` showing `listDocuments`, `readDocument`, `hash`, plus capability descriptors (`identityStable: false`, `supportsWatch: true`); (b) a parallel worked sketch for `notion-api://acme` showing the same four interface methods plus capability descriptors that differ (`identityStable: true`, `supportsWatch: false` if Notion uses polling — `pollOnly: true`); (c) a worked `ChangeFeed` event for an Obsidian rename emitting `{kind: 'rename', old_id, new_id}` per ADR-001 Invariant I-4. Commit with message `docs(adr-002): add Invariants + Examples; status Accepted`.</action>
  <acceptance_criteria>
    - `grep -q '^## Invariants' docs/v2/adr/002-adapter-seams.md && grep -q '^## Examples' docs/v2/adr/002-adapter-seams.md` exits 0.
    - `grep -q 'obsidian-fs://' docs/v2/adr/002-adapter-seams.md && grep -q 'notion-api://' docs/v2/adr/002-adapter-seams.md` exits 0.
    - `grep -cE '^\\*\\*I-[1-9]\\*\\*:' docs/v2/adr/002-adapter-seams.md` ≥ 6 (at least the six required invariants).
    - `grep -qi 'chokidar' docs/v2/adr/002-adapter-seams.md && grep -q 'gray-matter' docs/v2/adr/002-adapter-seams.md` exits 0 (the dependency-confinement invariants are explicit).
    - `head -10 docs/v2/adr/002-adapter-seams.md | grep -q '^tags:'` and `grep -q '^status: Accepted$' docs/v2/adr/002-adapter-seams.md`.
    - `git log --follow --oneline docs/v2/adr/002-adapter-seams.md | wc -l` ≥ 3.
  </acceptance_criteria>
  <verify>
    <automated>grep -q '^## Invariants' docs/v2/adr/002-adapter-seams.md && grep -q '^## Examples' docs/v2/adr/002-adapter-seams.md && grep -q 'obsidian-fs://' docs/v2/adr/002-adapter-seams.md && grep -q 'notion-api://' docs/v2/adr/002-adapter-seams.md && [ $(grep -cE '^\*\*I-[1-9]\*\*:' docs/v2/adr/002-adapter-seams.md) -ge 6 ]</automated>
  </verify>
  <done>ADR-002 amended with Invariants + Examples + Tags; dependency-confinement invariants explicit.</done>
</task>

<task type="auto">
  <name>Task 3: Commit C — append ADR-002 row to `docs/v2/adr/README.md` index</name>
  <read_first>
    - docs/v2/adr/README.md (the table seeded by plan 02)
    - docs/v2/adr/002-adapter-seams.md (read frontmatter `tags:` value)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-22 table format)
  </read_first>
  <action>Append a data row to the existing `## Accepted v2 ADRs` table in `docs/v2/adr/README.md`, after the ADR-001 row: `| 002 | [Source & Delivery Seams](002-adapter-seams.md) | Accepted | 0 | — | adapters, seams, source-connector, delivery-adapter, change-feed, capability-descriptors |`. Do NOT touch other rows; do NOT touch the `## Open ADRs (v3 / Phase 10)` section (plan 13 finalizes that). Commit with message `docs(adr-002): append ADR-002 row to index`.</action>
  <acceptance_criteria>
    - `grep -qE '^\\| 002 \\|' docs/v2/adr/README.md` exits 0.
    - `grep -q '002-adapter-seams.md' docs/v2/adr/README.md` exits 0.
    - `[ $(grep -cE '^\\| 00[1-9] \\|' docs/v2/adr/README.md) -ge 2 ]` (ADR-001 row still present too).
  </acceptance_criteria>
  <verify>
    <automated>grep -qE '^\| 002 \|' docs/v2/adr/README.md && grep -q '002-adapter-seams.md' docs/v2/adr/README.md && [ $(grep -cE '^\| 00[1-9] \|' docs/v2/adr/README.md) -ge 2 ]</automated>
  </verify>
  <done>ADR index lists ADR-002.</done>
</task>

</tasks>

<verification>
- VALIDATION row 00-01-01 partial (ADR-002 file exists at target path).
- VALIDATION rows 00-04-01 / 00-04-02 partial (ADR-002 contributions to the for-loop checks).
- Manual: `git log --follow --oneline docs/v2/adr/002-adapter-seams.md` shows pre-rename history.
</verification>

<success_criteria>
- ADR-002 publicly readable; amended; indexed.
- Dependency-confinement invariants written in form Phase 1's CI greps will satisfy.
- Both `obsidian-fs://` and `notion-api://` examples present.
- No regression in ADR-001 row.
</success_criteria>

<output>
After completion, create `.planning/phases/00-foundation-decisions/00-03-SUMMARY.md` listing: filename change rationale (002-source-and-delivery-seams → 002-adapter-seams), the six required Invariants and any added beyond them, `git log --follow` history-preservation check outcome, and the ADR index state.
</output>
