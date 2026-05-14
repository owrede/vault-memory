---
phase: 00-foundation-decisions
plan: 15
type: execute
wave: 6
depends_on: [01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14]
files_modified:
  - docs/v2/SIGN-OFF.md
  - CHANGELOG.md
autonomous: false
requirements: [FND-14]
user_setup:
  - service: pr-approval
    why: "Per D-17, maintainer sign-off (FND-14) is a single PR approval on the final Phase 0 PR carrying SIGN-OFF.md + ADVERSARIAL-REVIEW.md + all amendments. PR approval IS the audit trail — no separate signing ceremony."
must_haves:
  truths:
    - "`docs/v2/SIGN-OFF.md` exists with a checklist for FND-01 through FND-14 (14 items)"
    - "Every FND-* line is checked `[x]` AND carries a resolving commit SHA (7+ hex chars) per VALIDATION row 00-14-02"
    - "CHANGELOG.md `[Unreleased] → ### Documentation` section enumerates the v2 doc set (ADRs, architecture docs, eval fixtures, lint scripts)"
    - "Maintainer reviews and approves the final Phase 0 PR — PR approval is the FND-14 audit trail per D-17"
  artifacts:
    - path: "docs/v2/SIGN-OFF.md"
      provides: "FND-01..14 checklist + commit SHAs"
      contains: "FND-01"
    - path: "CHANGELOG.md"
      provides: "Documentation entry listing Phase 0 deliverables"
      contains: "ADR"
  key_links:
    - from: "docs/v2/SIGN-OFF.md"
      to: "Phase 0 commits"
      via: "resolving SHA per checklist line"
      pattern: "[0-9a-f]{7,}"
---

<objective>
Final Phase 0 plan — ship `docs/v2/SIGN-OFF.md` as the FND-01..FND-14 checklist with resolving commit SHAs, refine the CHANGELOG `[Unreleased] → ### Documentation` section to enumerate the actual v2 docs that landed, and capture maintainer PR approval (D-17). Per D-17, no separate signed-commit ceremony — PR approval on the final Phase 0 PR IS the audit trail; SIGN-OFF.md is the artifact that lives alongside.

Per the MVP_MODE framing, this is the last vertical slice — only by writing SIGN-OFF.md after every other plan completes can the resolving commit SHAs be captured. The plan deliberately runs last (Wave 7, depending on all 14 prior plans).

Output: SIGN-OFF.md + finalized CHANGELOG entry + maintainer PR approval recorded.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/phases/00-foundation-decisions/00-CONTEXT.md
@.planning/phases/00-foundation-decisions/00-VALIDATION.md
@.planning/phases/00-foundation-decisions/00-01-SUMMARY.md
@.planning/phases/00-foundation-decisions/00-02-SUMMARY.md
@.planning/phases/00-foundation-decisions/00-03-SUMMARY.md
@.planning/phases/00-foundation-decisions/00-04-SUMMARY.md
@.planning/phases/00-foundation-decisions/00-05-SUMMARY.md
@.planning/phases/00-foundation-decisions/00-06-SUMMARY.md
@.planning/phases/00-foundation-decisions/00-07-SUMMARY.md
@.planning/phases/00-foundation-decisions/00-08-SUMMARY.md
@.planning/phases/00-foundation-decisions/00-09-SUMMARY.md
@.planning/phases/00-foundation-decisions/00-10-SUMMARY.md
@.planning/phases/00-foundation-decisions/00-11-SUMMARY.md
@.planning/phases/00-foundation-decisions/00-12-SUMMARY.md
@.planning/phases/00-foundation-decisions/00-13-SUMMARY.md
@.planning/phases/00-foundation-decisions/00-14-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Author `docs/v2/SIGN-OFF.md` — FND-01..14 checklist with resolving commit SHAs</name>
  <read_first>
    - .planning/REQUIREMENTS.md lines 13–25 (verbatim FND-01..14 list and one-line descriptions — the SIGN-OFF checklist reproduces these)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-17 — SIGN-OFF.md is the artifact; PR approval is the audit trail)
    - .planning/phases/00-foundation-decisions/00-VALIDATION.md rows 00-14-01 + 00-14-02 (exact grep patterns: `- [x] FND-` count == 14; each line has a 7+ hex commit SHA)
    - All 14 prior SUMMARY files (each summary lists the commit SHA(s) that resolved the relevant FND-* requirement)
  </read_first>
  <action>(A) Create `docs/v2/SIGN-OFF.md` with this structure: (1) `# Phase 0 — Sign-Off` H1; (2) `**Phase:** 0 — Foundation & decisions\\n**Sign-off date:** <YYYY-MM-DD>\\n**Maintainer:** <fill at PR approval time>\\n`; (3) `## FND checklist` H2 with 14 checked bullets in FND-01..FND-14 order. Each bullet MUST follow this exact shape so VALIDATION rows 00-14-01 + 00-14-02 grep cleanly: `- [x] FND-NN: <one-line description from REQUIREMENTS.md> — resolved by <7-hex SHA>` where `<7-hex SHA>` is a real git commit SHA in this repo (use `git rev-parse --short <commit-or-branch>` to obtain it; values come from each prior SUMMARY's "resolving commit" entry). If a single requirement is satisfied by multiple commits (e.g., FND-01 spans the four ADR-relocation commits from plans 02–05), list one representative SHA + note `(see ADR-001..004 relocate commits)`. For FND-21 (which is technically D-21 / CI workflow but covered by plan 12 — not in the FND-01..14 list per REQUIREMENTS.md), do NOT include — only the 14 requirement IDs from REQUIREMENTS.md make the checklist. (4) `## ADRs accepted` H2 — bullet list linking to the four ADR files. (5) `## Architecture docs published` H2 — bullet list linking to `docs/v2/{ARCHITECTURE,MEMORY_CONTRACT,AGENT_AGNOSTIC}.md`. (6) `## Eval substrate` H2 — paragraph naming `evals/fixtures/v2-test-vault/`, `evals/v1-baseline/`, the tools-list snapshot, the per-tool semantic-floor YAMLs, and the `.todo` precision/recall hooks for Phase 1. (7) `## CI gates` H2 — names `scripts/check-fixture-privacy.sh`, `scripts/lint-no-telemetry.sh`, `.github/workflows/ci.yml`. (8) `## Adversarial review outcome` H2 — links to `docs/v2/adr/ADVERSARIAL-REVIEW.md`, lists finding count and amend/defer split (from `00-14-SUMMARY.md`). (9) `## Audit trail` H2 — explicit paragraph: "Per ADR D-17, this file plus maintainer approval on the final Phase 0 PR constitutes the audit trail for FND-14. There is no separate signed-commit ceremony." (B) Verify the file passes both VALIDATION grep patterns before commit. (C) Commit with message `docs(phase-0): sign-off checklist with resolving commit SHAs (FND-14)`.</action>
  <acceptance_criteria>
    - Match VALIDATION row 00-14-01: `test -f docs/v2/SIGN-OFF.md && [ $(grep -cE '^- \\[x\\] FND-' docs/v2/SIGN-OFF.md) -eq 14 ]` exits 0.
    - Match VALIDATION row 00-14-02: `[ $(grep -cE '^- \\[x\\] FND-[0-9]+:.*[0-9a-f]{7,}' docs/v2/SIGN-OFF.md) -eq 14 ]` exits 0 (every line has a 7+ hex SHA).
    - All 14 FND-IDs present in order: `for n in 01 02 03 04 05 06 07 08 09 10 11 12 13 14; do grep -qE "^- \\[x\\] FND-${n}:" docs/v2/SIGN-OFF.md || { echo "Missing FND-${n}" >&2; exit 1; }; done`.
    - Required H2 sections present: `for h in '## FND checklist' '## ADRs accepted' '## Architecture docs published' '## Eval substrate' '## CI gates' '## Adversarial review outcome' '## Audit trail'; do grep -qF "$h" docs/v2/SIGN-OFF.md || exit 1; done`.
    - Every SHA referenced is a real commit: `for sha in $(grep -oE '[0-9a-f]{7,40}' docs/v2/SIGN-OFF.md | sort -u); do git cat-file -e "$sha" 2>/dev/null || { echo "Unknown SHA: $sha" >&2; exit 1; }; done`.
  </acceptance_criteria>
  <verify>
    <automated>test -f docs/v2/SIGN-OFF.md && [ $(grep -cE '^- \[x\] FND-' docs/v2/SIGN-OFF.md) -eq 14 ] && [ $(grep -cE '^- \[x\] FND-[0-9]+:.*[0-9a-f]{7,}' docs/v2/SIGN-OFF.md) -eq 14 ]</automated>
  </verify>
  <done>SIGN-OFF.md exists with 14 checked items, each carrying a verified 7-hex commit SHA.</done>
</task>

<task type="auto">
  <name>Task 2: Finalize CHANGELOG `[Unreleased] → ### Documentation` section</name>
  <read_first>
    - CHANGELOG.md (current state — seeded in plan 01 with a single placeholder bullet)
    - .planning/phases/00-foundation-decisions/00-01-SUMMARY.md (the original placeholder bullet)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (Claude's Discretion §"Whether to bump version — no")
  </read_first>
  <action>Edit `CHANGELOG.md`. Under the existing `## [Unreleased]` → `### Documentation` heading, replace the placeholder bullet with a concise enumerated list of Phase 0 deliverables. Required bullets (one per category): `- Relocate ADRs 001–004 from `docs/dev/` to public `docs/v2/adr/`; amend with Invariants + Examples sections (FND-01, FND-04).`; `- ADR-003 amended with explicit hash-semantics pseudocode (RFC 8785, NFC, LF, IEEE-754 number canonicalization) + chunk-level source_hashes schema (FND-02).`; `- ADR-004 amended: folder-default MemorySink is the only code path; separate-vault is config-only (FND-03).`; `- Publish docs/v2/ARCHITECTURE.md (L0–L4 layer model), MEMORY_CONTRACT.md (provenance property contract), AGENT_AGNOSTIC.md (MCP-canonical stance) (FND-05/06/07).`; `- Eval fixture vault evals/fixtures/v2-test-vault/ ("Atlas Robotics", ~75 notes, 7 query categories) (FND-08).`; `- v1-baseline regression suite evals/v1-baseline/ — tool-snapshot pin on tools/list (23 tools) + semantic-floor YAMLs for v1 behavioral tools (FND-09/10).`; `- CI gates scripts/check-fixture-privacy.sh + scripts/lint-no-telemetry.sh + .github/workflows/ci.yml (FND-11/12 + D-21).`; `- ADR index docs/v2/adr/README.md with 4 Accepted + 14 Open ADR stubs (FND-13).`; `- Adversarial review docs/v2/adr/ADVERSARIAL-REVIEW.md + ADR amendments addressing findings (FND-04 + FND-14 sign-off).`. Do NOT bump version (per CONTEXT). Do NOT add a `## [1.0.x]` heading. Confirm the `## [Unreleased]` and `### Documentation` H2/H3 headings remain intact for the `publish.yml` awk script's compatibility.</action>
  <acceptance_criteria>
    - `grep -q '^## \\[Unreleased\\]' CHANGELOG.md && grep -q '^### Documentation' CHANGELOG.md` exits 0.
    - At least 7 documentation bullets present in the section: `awk '/^### Documentation/{flag=1; next} /^### /{flag=0} flag' CHANGELOG.md | grep -c '^-' | awk '{exit ($1<7?1:0)}'` exits 0.
    - References to all major deliverables: `grep -q 'ADR' CHANGELOG.md && grep -q 'ARCHITECTURE.md' CHANGELOG.md && grep -q 'evals/' CHANGELOG.md && grep -q 'check-fixture-privacy' CHANGELOG.md && grep -q 'lint-no-telemetry' CHANGELOG.md`.
    - Version unchanged: `[ "$(node -p "require('./package.json').version")" = "1.0.0" ]`.
  </acceptance_criteria>
  <verify>
    <automated>grep -q '^## \[Unreleased\]' CHANGELOG.md && grep -q '^### Documentation' CHANGELOG.md && grep -q 'ARCHITECTURE.md' CHANGELOG.md && grep -q 'check-fixture-privacy' CHANGELOG.md && [ "$(node -p "require('./package.json').version")" = "1.0.0" ]</automated>
  </verify>
  <done>CHANGELOG `[Unreleased] → ### Documentation` enumerates the Phase 0 deliverables; version unchanged.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Maintainer reviews and approves the final Phase 0 PR (FND-14 audit trail per D-17)</name>
  <what-built>
    Phase 0 is feature-complete. The final PR carries (or rolls up): the four ADR relocate+amend commits, the three architecture docs, the eval fixture vault, the v1-baseline suite, the lint scripts + CI workflow, the ADR index, the adversarial review + resulting amendments, the SIGN-OFF.md checklist, and the CHANGELOG documentation entry. No `src/` change beyond the documented `src/tool-registry.ts` extraction (Assumption A5).
  </what-built>
  <how-to-verify>
    (1) **Review SIGN-OFF.md**: `cat docs/v2/SIGN-OFF.md` — confirm all 14 lines are `[x]` checked, every line carries a real commit SHA, and the named deliverable matches what shipped.
    (2) **Sanity grep** for every requirement automated check in one pass: run the per-task `<verify>` automated commands from VALIDATION rows 00-01-01 through 00-17-02 (or just run `sh -c '$(grep -h "<automated>" .planning/phases/00-foundation-decisions/00-*-PLAN.md ... ); true'` if you want a manual sweep). The CI workflow (`ci.yml`) should also be green on the final PR.
    (3) **Spot-check** at least one of each artifact category: open `docs/v2/adr/001-document-identity.md` and verify `## Invariants` + `## Examples` sections; open `docs/v2/ARCHITECTURE.md` and verify it's coherent and ≤800 lines; open `evals/fixtures/v2-test-vault/_queries/search.yaml` and verify it parses; run `sh scripts/check-fixture-privacy.sh && sh scripts/lint-no-telemetry.sh && npm test` locally — all green.
    (4) **Adversarial review health**: open `docs/v2/adr/ADVERSARIAL-REVIEW.md` and confirm: ≥4 findings, every finding has terminal status (Amended or Deferred-v3), no `Status: Open` remains.
    (5) **Two-commit pattern validation** (per VALIDATION Manual-Only): for each ADR, run `git log --follow --oneline docs/v2/adr/00X-*.md` — confirm history extends through the `docs/dev/00X-*.md` predecessor. If any ADR's history is severed, RECORD AS A KNOWN ISSUE for Phase 1 (Assumption A1 failed); Phase 0 can still ship with that note.
    (6) **PR approval**: approve the final Phase 0 PR via GitHub UI. This action is the FND-14 audit trail per D-17. Add a comment summarizing: total commits, any deviations from Phase 0 plans (e.g., note count came in at lower-bound of 50 rather than target 75), and any deferred follow-ups (e.g., ADR-index regenerator script D-23 still pending).
  </how-to-verify>
  <acceptance_criteria>
    - SIGN-OFF.md is the maintainer's canonical record — all 14 items checked, SHAs verified by `git cat-file -e`.
    - CI workflow on the final PR is green (or the maintainer has explicitly approved despite a documented failure — recorded in PR comments).
    - PR approval recorded on GitHub.
    - Adversarial review has zero `Status: Open` findings.
  </acceptance_criteria>
  <resume-signal>Reply `approved` to mark Phase 0 closed and Phase 1 (Adapter extraction & tech-debt-up) ready to plan. Include the PR URL and any deferred-follow-up notes. If any manual check fails (history severed, CI red, finding still Open), reply `blocked: <reason>` and address before re-resuming.</resume-signal>
</task>

</tasks>

<verification>
- VALIDATION rows 00-14-01 + 00-14-02 pass (SIGN-OFF.md checklist + SHAs).
- All prior automated VALIDATION rows still pass (verified by CI workflow run + npm test).
- Manual-Only VALIDATION rows (two-commit history check, adversarial review health) confirmed by maintainer in Task 3.
</verification>

<success_criteria>
- `docs/v2/SIGN-OFF.md` exists with 14 checked items + verified SHAs.
- CHANGELOG.md enumerates Phase 0 deliverables; version unchanged at 1.0.0.
- Final Phase 0 PR is approved by maintainer (D-17 audit trail).
- Phase 1 is unblocked.
</success_criteria>

<output>
After completion, create `.planning/phases/00-foundation-decisions/00-15-SUMMARY.md` recording: SIGN-OFF.md final state, PR URL, maintainer-noted deviations, deferred follow-ups (ADR-index regenerator, multi-platform CI matrix, etc.), and an explicit handoff statement: "Phase 0 complete — Phase 1 (Adapter extraction & tech-debt-up) ready to plan."
</output>
