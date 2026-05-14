---
phase: 00-foundation-decisions
plan: 02
type: execute
wave: 2
depends_on: [01]
files_modified:
  - docs/dev/001-document-identity.md
  - docs/v2/adr/001-document-identity.md
  - docs/v2/adr/README.md
autonomous: true
requirements: [FND-01, FND-04, FND-13]
must_haves:
  truths:
    - "ADR-001 lives at the public path `docs/v2/adr/001-document-identity.md`"
    - "`git log --follow docs/v2/adr/001-document-identity.md` traces back through the rename to `docs/dev/001-document-identity.md` (Pitfall 1 / D-01 validated by two-commit pattern)"
    - "ADR-001 has explicit `## Invariants` and `## Examples` sections; Examples include at least one `obsidian-fs://` and one `notion-api://` worked URI"
    - "ADR index `docs/v2/adr/README.md` exists and has a row for `| 001 |` with `Accepted` status"
  artifacts:
    - path: "docs/v2/adr/001-document-identity.md"
      provides: "ADR-001 in public path with Invariants + Examples sections"
      contains: "## Invariants"
    - path: "docs/v2/adr/README.md"
      provides: "MADR-style index table seeded with the ADR-001 row"
      contains: "| 001 |"
  key_links:
    - from: "docs/v2/adr/README.md"
      to: "docs/v2/adr/001-document-identity.md"
      via: "markdown relative link"
      pattern: "001-document-identity.md"
---

<objective>
**MVP walking-skeleton equivalent for Phase 0.** Ship ADR-001 end-to-end (relocate + amend + index row) **before** scaling the pattern to ADRs 002/003/004 in Wave 2. The point of this plan is to prove three things on the cheapest ADR: (a) `git mv` + content amendment in two separate commits preserves `git log --follow` history (D-01 / Pitfall 1 / Assumption A1); (b) the Invariants + Examples format works on a real ADR (D-03 / D-04); (c) the MADR-style index table is a sustainable structure (D-22 / FND-13). Once ADR-001 lands, Wave 2 can fan out in parallel for ADRs 002–004 with the workflow validated.

Purpose: this is the riskiest pattern in Phase 0 (history preservation across rename+amend). Failing fast here is much cheaper than discovering the squash-merge / rename-detection problem after four ADRs are already mid-flight.

Output: ADR-001 public; index seeded; pattern proven.
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
@.planning/phases/00-foundation-decisions/00-01-SUMMARY.md
@docs/dev/001-document-identity.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Commit A — `git mv` ADR-001 from `docs/dev/` to `docs/v2/adr/` (rename only, no content edits)</name>
  <read_first>
    - docs/dev/001-document-identity.md (full file — 199 lines; do NOT modify content in this task)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Pattern 1 — Two-Commit Relocation-Plus-Amendment PR
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Pitfall 1 — git mv rename-detection failure
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-01, D-02)
  </read_first>
  <action>Create the target directory: `mkdir -p docs/v2/adr`. Run `git mv docs/dev/001-document-identity.md docs/v2/adr/001-document-identity.md` (filename keeps the same `001-document-identity.md` shape; only ADR-002 requires a filename change per CONTEXT canonical_refs). Stage and commit with message `docs(adr-001): relocate to public docs/v2/adr/`. This commit MUST contain zero content changes — do not add Invariants, Examples, or frontmatter Tags in this commit. The point is to give git a clean rename signal (≥50% similarity) so `git log --follow` survives. If the working tree has any prior `.gitignore` change from plan 01 that has not yet been committed, ensure that change is on a separate prior commit (plan 01 already commits it via the GSD git-commit step). Do NOT use `git commit --amend`. Verify with `git log --oneline -1 --stat docs/v2/adr/001-document-identity.md` — should show a single commit, file listed as renamed (`R100` or similar) in `git log -M --oneline --stat`.</action>
  <acceptance_criteria>
    - `git log --follow --oneline docs/v2/adr/001-document-identity.md | wc -l` returns ≥ 2 (the rename commit + at least one historical commit on the file before the rename).
    - `git log -1 --name-status HEAD docs/v2/adr/001-document-identity.md` shows the file with status `A` (added in this commit).
    - `diff <(git show HEAD:docs/v2/adr/001-document-identity.md) <(git show HEAD~1:docs/dev/001-document-identity.md)` shows zero diff (byte-identical content across the rename).
    - `! test -e docs/dev/001-document-identity.md` (source path no longer present).
  </acceptance_criteria>
  <verify>
    <automated>test -f docs/v2/adr/001-document-identity.md && ! test -e docs/dev/001-document-identity.md && [ $(git log --follow --oneline docs/v2/adr/001-document-identity.md | wc -l) -ge 2 ]</automated>
  </verify>
  <done>ADR-001 has moved to the public path; git rename detection sees a single-commit pure rename; history extends back.</done>
</task>

<task type="auto">
  <name>Task 2: Commit B — amend ADR-001 with `## Invariants` and `## Examples` sections (and `Tags:` frontmatter)</name>
  <read_first>
    - docs/v2/adr/001-document-identity.md (the just-relocated file)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Example 7 — ADR Invariants section template (verbatim invariants I-1..I-5 for ADR-001)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-03 invariant format; D-04 dual-scheme examples; D-23 Tags frontmatter — stretch but cheap)
  </read_first>
  <action>Edit `docs/v2/adr/001-document-identity.md` in place. (1) Add a top-of-file YAML frontmatter block (before the existing `# ADR-001:` H1) with at minimum: `---\ntitle: Document identity is opaque, URI-style\nstatus: Accepted\nphase: 0\ntags: identity, source-agnostic, uri, opaque-id\n---\n`. Status is `Accepted` because Phase 0 sign-off accepts it (existing source says "Proposed" — update to `Accepted`). (2) Add a new `## Invariants` section AFTER the existing `## Decision` section and BEFORE `## SQLite schema migration`. Use the verbatim bullets I-1 through I-5 from RESEARCH §Example 7. Each bullet MUST start with `**I-N**:` followed by a normative MUST/MUST-NOT sentence ending with a period. The Phase 9 adversarial review will grep these. (3) Add a new `## Examples` section AFTER `## Consequences` and BEFORE `## Alternatives considered`. Examples MUST include at minimum: (a) one full worked round-trip for `obsidian-fs://my-vault/projects/Atlas.md` showing scheme/authority/resource decomposition, display-URL minting (`obsidian://open?vault=my-vault&file=projects%2FAtlas.md`), and an `identityStable: false` rename event; (b) one parallel worked example for `notion-api://acme/page/c5b9f3a2-1234-…` showing the same three components and `identityStable: true` — no rename, no display-URL minting required (link to the Notion page is the display URL). Source-neutrality is the point of D-04 — both schemes appear so the Phase 9 reviewer can grep `obsidian-fs://` AND `notion-api://` in the same file. Stage and commit with message `docs(adr-001): add Invariants + Examples sections; status Accepted`. Do NOT touch the index README in this task — that is Task 3, a separate commit.</action>
  <acceptance_criteria>
    - Match VALIDATION row 00-04-01 partial: `grep -q '^## Invariants' docs/v2/adr/001-document-identity.md` exits 0.
    - Match VALIDATION row 00-04-02 partial: `grep -q '^## Examples' docs/v2/adr/001-document-identity.md && grep -q 'obsidian-fs://' docs/v2/adr/001-document-identity.md && grep -q 'notion-api://' docs/v2/adr/001-document-identity.md` exits 0.
    - `grep -qE '^\\*\\*I-[1-5]\\*\\*:' docs/v2/adr/001-document-identity.md` (all five invariants present in `**I-N**:` bullet form).
    - `head -10 docs/v2/adr/001-document-identity.md | grep -q '^tags:'` (frontmatter Tags present).
    - `grep -q '^status: Accepted$' docs/v2/adr/001-document-identity.md` (status updated from Proposed → Accepted).
    - `git log --follow --oneline docs/v2/adr/001-document-identity.md | wc -l` ≥ 3 (rename + amend + pre-rename history).
  </acceptance_criteria>
  <verify>
    <automated>grep -q '^## Invariants' docs/v2/adr/001-document-identity.md && grep -q '^## Examples' docs/v2/adr/001-document-identity.md && grep -q 'obsidian-fs://' docs/v2/adr/001-document-identity.md && grep -q 'notion-api://' docs/v2/adr/001-document-identity.md && grep -qE '^\*\*I-[1-5]\*\*:' docs/v2/adr/001-document-identity.md</automated>
  </verify>
  <done>ADR-001 amended with Invariants + Examples + Tags; status Accepted; history preserved across the two-commit pattern.</done>
</task>

<task type="auto">
  <name>Task 3: Commit C — seed `docs/v2/adr/README.md` MADR-style index with the ADR-001 row</name>
  <read_first>
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-22 — MADR-style index format: columns `#`, `Title`, `Status`, `Phase`, `Supersedes`, `Tags`; status enum `Accepted`, `Proposed`, `Open`, `Superseded`, `Deferred-v3`)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Recommended Project Structure (location is `docs/v2/adr/README.md`)
    - docs/v2/adr/001-document-identity.md (read the `tags:` frontmatter to populate the index row)
  </read_first>
  <action>Create `docs/v2/adr/README.md` from scratch. Structure: (1) An `# ADR Index` H1. (2) A brief 2–3 sentence intro paragraph stating that this directory holds the v2 architectural decision records, that each ADR has `## Invariants` and `## Examples` sections (Phase 9's adversarial review greps these), and that open ADRs (005+) are reserved for v3 / Phase-10 work. (3) An `## Accepted v2 ADRs` section with a MADR-style markdown table. Columns in order: `| # | Title | Status | Phase | Supersedes | Tags |`. Header row + separator row + one data row for ADR-001 right now: `| 001 | [Document identity is opaque, URI-style](001-document-identity.md) | Accepted | 0 | — | identity, source-agnostic, uri, opaque-id |`. (4) An `## Open ADRs (v3 / Phase 10)` section — a placeholder paragraph noting that 14 open ADRs will be enumerated here once the v2 ADRs land (the full open-ADR list lands in plan 13 once all four v2 ADRs are amended); do NOT pre-enumerate them in this task. Stage and commit with message `docs(adr): seed ADR index with ADR-001 row`. Plans 03/04/05 each append their own ADR's row in their own final task; plan 13 finalizes the open-ADR list and audits the table.</action>
  <acceptance_criteria>
    - `test -f docs/v2/adr/README.md` exits 0.
    - `grep -qE '^\\| 001 \\|' docs/v2/adr/README.md` (ADR-001 row present).
    - `grep -q 'Accepted' docs/v2/adr/README.md` (status appears).
    - `grep -q '001-document-identity.md' docs/v2/adr/README.md` (markdown link to the ADR file).
    - `grep -q '^## Accepted v2 ADRs' docs/v2/adr/README.md && grep -q '^## Open ADRs' docs/v2/adr/README.md` (both sections exist).
  </acceptance_criteria>
  <verify>
    <automated>test -f docs/v2/adr/README.md && grep -qE '^\| 001 \|' docs/v2/adr/README.md && grep -q 'Accepted' docs/v2/adr/README.md && grep -q '001-document-identity.md' docs/v2/adr/README.md</automated>
  </verify>
  <done>ADR index seeded with ADR-001 row; pattern ready for plans 03–05 to append their own rows.</done>
</task>

</tasks>

<verification>
- VALIDATION map row 00-01-01 (filesystem assertion for ADR-001) passes for this ADR.
- VALIDATION map rows 00-04-01 + 00-04-02 partial pass for ADR-001 (the `for f in 00{1,2,3,4}` loop is incomplete until plans 03–05 ship; ADR-001 row of the loop passes).
- VALIDATION map row 00-13-01 partial passes (ADR-001 row present in index).
- Manual check (per VALIDATION Manual-Only Verifications): after the PR merges, run `git log --follow --oneline docs/v2/adr/001-document-identity.md` and confirm at least one commit predates the `git mv`. If broken (Assumption A1 wrong), HALT before starting plans 03–05.
</verification>

<success_criteria>
- ADR-001 publicly readable at `docs/v2/adr/001-document-identity.md`.
- Two-commit pattern produced clean rename + clean amend; `git log --follow` works.
- Invariants I-1..I-5 grepable.
- Both `obsidian-fs://` and `notion-api://` worked examples present.
- ADR index README seeded.
- Pattern proven; safe to fan out plans 03/04/05 in parallel in Wave 2.
</success_criteria>

<output>
After completion, create `.planning/phases/00-foundation-decisions/00-02-SUMMARY.md` recording: (a) the two-commit-pattern verification outcome (`git log --follow` check), (b) the Invariants bullet IDs used (I-1..I-5), (c) any deviations from RESEARCH Example 7, (d) a note clearing plans 03/04/05 to proceed in parallel.
</output>
