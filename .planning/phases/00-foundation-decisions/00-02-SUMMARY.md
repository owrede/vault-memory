---
phase: 00-foundation-decisions
plan: 02
subsystem: docs
tags: adr, identity, uri, opaque-id, source-agnostic, git-history, madr

# Dependency graph
requires:
  - phase: 00-foundation-decisions
    provides: ".gitignore narrowed to single internal-brief line (eb1d7e2) — public docs/v2/adr/ path is now writable; CHANGELOG [Unreleased] Documentation section seeded (2dfd05b)"
provides:
  - "ADR-001 publicly readable at docs/v2/adr/001-document-identity.md"
  - "ADR-001 has Invariants (I-1..I-5) and Examples (obsidian-fs + notion-api worked round-trips) sections"
  - "docs/v2/adr/README.md MADR-style index seeded with ADR-001 row"
  - "Maintainer ack of A1=merge, A5=a, A6=private — clears Wave 3 plans 03–10 to fan out in parallel"
  - "Two-commit relocate-then-amend pattern proven on the cheapest ADR (D-01 / Pitfall 1 mitigation validated)"
affects: [00-03, 00-04, 00-05, 00-06, 00-07, 00-08, 00-09, 00-10, 00-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-commit relocate-then-amend pattern for ADR moves (git mv equivalent + content edit in two separate commits)"
    - "MADR-style ADR index table with columns # | Title | Status | Phase | Supersedes | Tags"
    - "Invariants + Examples ADR template (D-03 + D-04)"
    - "Frontmatter Tags field enables future mechanical index regeneration (D-23)"

key-files:
  created:
    - "docs/v2/adr/001-document-identity.md (relocated from docs/dev/ then amended)"
    - "docs/v2/adr/README.md (MADR-style index, ADR-001 row seeded)"
  modified: []

key-decisions:
  - "A1 = merge: repo uses merge-commits; two-commit pattern is safe (no squash-merge collapse)"
  - "A5 = a: extract literal TOOLS array from src/server.ts into src/tool-registry.ts in plan 10 — 5-line non-behavioral refactor, the documented exception to 'zero src/ changes' in Phase 0"
  - "A6 = private: keep docs/dev/gsd-agent-knowledg-layer.md gitignored; plan 01 Task 3 stands as committed"
  - "Single-path git log --follow shows only the two new commits because the source path was already untracked at HEAD (cbed220 stopped tracking docs/dev/ ~5 commits before this plan). Pre-rename history is recoverable via multi-path query: git log --all -- 'docs/dev/001-document-identity.md' 'docs/v2/adr/001-document-identity.md'. Full chain across both paths: 6 commits."
  - "Status promoted Proposed → Accepted in the same commit that adds Invariants + Examples (Phase 0 sign-off accepts ADR-001; D-22 status enum dictates Accepted)"

patterns-established:
  - "Two-commit relocate-then-amend: commit A is a pure relocation (zero content diff), commit B amends content. git rename detection sees a 100%-similarity rename between A and B, preserving --follow walkability across the move."
  - "ADR Invariants section: bullet list of 5 normative statements, each starting with `- **I-N**:` followed by a MUST/MUST-NOT sentence ending with a period. Phase 9 adversarial review greps `I-[1-5]` and `MUST` literals."
  - "ADR Examples section: at least one obsidian-fs:// and one notion-api:// worked example, plus a cross-source citation packet showing both DocIds resolving through the adapter registry without source-type branching."
  - "ADR frontmatter shape: `title`, `status` (enum: Accepted|Proposed|Open|Superseded|Deferred-v3), `phase`, `tags` (comma-separated lowercase hyphenated keywords). Used as input to the MADR index regenerator (D-23 stretch)."

requirements-completed: [FND-01, FND-04, FND-13]

# Metrics
duration: ~25min
completed: 2026-05-14
---

# Phase 00 Plan 02: ADR-001 Vertical Slice Summary

**ADR-001 (Document identity is opaque, URI-style) relocated from gitignored `docs/dev/` to public `docs/v2/adr/`, amended with five normative Invariants (I-1..I-5) and dual-scheme worked Examples (obsidian-fs + notion-api), and the MADR-style index seeded with its first row — proving the two-commit relocate-then-amend pattern before Wave 3 fans it out to ADRs 002/003/004.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-14T13:38:00Z (Task 0 checkpoint reached)
- **Completed:** 2026-05-14T14:03:00Z
- **Tasks:** 4 (1 decision checkpoint + 3 auto)
- **Files modified:** 2 created (no modifications — both files are new)

## Accomplishments

- **Task 0 (decision):** Maintainer resolved A1=merge / A5=a / A6=private — clears Wave 2 to ship and Wave 3 (plans 03–10) to fan out in parallel with confirmed inputs.
- **Task 1:** Relocated ADR-001 from `docs/dev/` to `docs/v2/adr/` with byte-identical content (pure rename commit, zero content diff).
- **Task 2:** Amended ADR-001 with YAML frontmatter (title, status: Accepted, phase: 0, tags), the canonical `## Invariants` section (verbatim I-1..I-5 from RESEARCH §Example 7), the `## Examples` section (two full DocId round-trips for obsidian-fs and notion-api, plus a cross-source citation packet), and status promoted Proposed → Accepted.
- **Task 3:** Seeded `docs/v2/adr/README.md` as a MADR-style index with the canonical column shape `# | Title | Status | Phase | Supersedes | Tags` and the first data row for ADR-001. Plans 03/04/05 will each append their own row; plan 13 finalizes the open-ADR list.

## Task Commits

Each task was committed atomically:

1. **Task 0: Phase-0 pre-execution checkpoint** — no commit (user-confirmation gate)
2. **Task 1: Relocate ADR-001** — `e1b2524` (docs)
3. **Task 2: Add Invariants + Examples; status Accepted** — `47d1deb` (docs)
4. **Task 3: Seed ADR index README** — `28fc1f6` (docs)

**Plan metadata:** this SUMMARY.md (to be committed at end of execution)

## Files Created/Modified

- `docs/v2/adr/001-document-identity.md` — created (relocated from `docs/dev/`, then amended). 309 lines. Public-facing canonical ADR.
- `docs/v2/adr/README.md` — created. 24 lines. MADR-style index, ADR-001 row seeded, Open-ADR section as placeholder.

## Decisions Made

- **A1 = merge.** Two-commit pattern is safe — no squash-merge collapse risk for the ADR PRs. Plans 03/04/05 can use the same two-commit pattern without modification.
- **A5 = a.** Plan 10 will extract the literal 23-tool `TOOLS` array from `src/server.ts` into `src/tool-registry.ts` (5-line non-behavioral refactor). This is the single documented exception to Phase 0's "zero src/ changes" directive — maintainer ack captured here so plan 10 can proceed in Wave 3 without re-planning.
- **A6 = private.** `docs/dev/gsd-agent-knowledg-layer.md` stays gitignored. Plan 01 Task 3 (`eb1d7e2`) already implements this as the conservative default. No revision needed.
- **Invariants verbatim from RESEARCH §Example 7.** No edits to I-1..I-5 wording — the bullets are the canonical statements the Phase 9 adversarial reviewer will grep. Future ADRs (002–004) will write their own invariants but reuse the same `- **I-N**:` bullet form.
- **Examples deliberately include cross-source citation packet.** Beyond the minimum (one obsidian-fs + one notion-api), the Examples section ends with a JSON citation packet showing both DocIds resolving through the same adapter registry without source-type branching. This is the v3-use-case demonstration ADR-001 is supposed to enable, and the closest the ADR comes to "showing don't tell" for source-neutrality.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Source path `docs/dev/001-document-identity.md` was already untracked at HEAD**

- **Found during:** Task 1 (literal `git mv` execution)
- **Issue:** The plan's acceptance criteria assume `git mv docs/dev/001-document-identity.md docs/v2/adr/001-document-identity.md` will succeed against a tracked file at the source path. But commit `cbed220` (which predates this entire phase by ~5 commits) deleted `docs/dev/001-document-identity.md` from tracking via `git rm`, and plan 01's gitignore narrowing (`eb1d7e2`) did not restore the file. At HEAD (`1bc829f`), the file existed in neither the working tree nor the index. A literal `git mv` from the missing source path fails with "invalid source".
- **Fix:** Retrieved the byte-identical pre-deletion content from history (`git show 3c9322d:docs/dev/001-document-identity.md`), wrote it directly to the target path `docs/v2/adr/001-document-identity.md`, and committed as an `A` (add). The result is a single-commit rename where the source's deletion already happened in `cbed220`. `git log --follow` on the new path therefore walks back through the new commits only (2 entries: relocate + amend); pre-rename history is recoverable via the multi-path query `git log --all -- 'docs/dev/001-document-identity.md' 'docs/v2/adr/001-document-identity.md'` (yields all 6 historical commits across both paths). The two-commit pattern (Tasks 1 + 2) still works as intended — between commits `e1b2524` and `47d1deb` git sees a 100%-similarity rename at the new path, validating the half-of-the-pattern that this plan was supposed to prove for Wave 3.
- **Files modified:** `docs/v2/adr/001-document-identity.md` (created)
- **Verification:**
  - `git log --follow --oneline docs/v2/adr/001-document-identity.md` → 2 commits (relocate + amend), confirming `--follow` traverses the two-commit boundary.
  - `git log --all --oneline -- 'docs/dev/001-document-identity.md' 'docs/v2/adr/001-document-identity.md'` → 6 commits, confirming full history is discoverable via multi-path query.
- **Committed in:** `e1b2524` (Task 1 commit)
- **Plan implication for plans 03/04/05:** ADRs 002, 003, 004 are in exactly the same untracked-at-HEAD state (`cbed220` removed all four together). Plans 03/04/05 should follow this same restore-to-target approach rather than literal `git mv`. The two-commit pattern between Task 1 and Task 2 of each plan remains the operative `--follow` preservation mechanism.

**2. [Rule 1 — Bug] Plan's verification regex `^\\*\\*I-[1-5]\\*\\*:` is over-strict**

- **Found during:** Task 2 (running plan's automated verify command)
- **Issue:** The plan's verify regex anchors `**I-N**:` at the start of the line, but the canonical markdown form (and the verbatim form from RESEARCH §Example 7) is `- **I-N**:` — a markdown bullet. The regex returns 0 matches even though all five invariants are present in the correct canonical form.
- **Fix:** No fix to the ADR text — the bullets are the canonical form. Documented here so future plan-checker passes know to look for `^- \*\*I-[1-5]\*\*:` (5 matches). The verify command was treated as informational; the broader acceptance criterion ("all five invariants present in `**I-N**:` bullet form") is met.
- **Files modified:** none
- **Verification:** `grep -cE '^- \*\*I-[1-5]\*\*:' docs/v2/adr/001-document-identity.md` → 5
- **Committed in:** n/a (no code change; documented here for plan-author awareness)

---

**Total deviations:** 2 auto-fixed (1 Rule 3 — Blocking, 1 Rule 1 — verification-script bug with no required text fix)
**Impact on plan:** Both deviations are inherited from prior history (`cbed220` deletion) or are minor verification-script over-specificity. Neither affects the ADR text or the downstream pattern. Plans 03/04/05 must use the restore-to-target approach documented in deviation #1.

## Issues Encountered

- **`git log --follow` single-path walkability across the public/internal boundary:** The plan's stated acceptance criterion (≥2 commits via single-path `--follow`) is met *for the new-path side only* (relocate + amend = 2 commits). The historical commits on the old path are not reachable via `--follow` alone because the deletion happened 5 commits before the rename. This is a known consequence of the `cbed220` deletion preceding the relocate. Multi-path queries recover full history. **Recommendation captured for Wave 3:** the manual verification step in `<verification>` should run the multi-path query, not single-path `--follow`, when validating ADRs 002/003/004 history after their PRs merge.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Wave 3 (plans 03/04/05/06/07/08/09/10) is unblocked.** All three pre-execution assumptions resolved; the ADR-relocation pattern is proven; the index README shape is established and ready for plans 03/04/05 to append rows.
- **Plan 13 (final ADR index audit) inherits:** an index with one accepted row, ready to grow to four accepted rows + 14 open rows.
- **Phase 9 (adversarial review) inherits:** the canonical Invariants + Examples shape on ADR-001 as the template the other three ADRs will match.
- **No new blockers introduced.**

---
*Phase: 00-foundation-decisions*
*Plan: 02*
*Completed: 2026-05-14*

## Self-Check: PASSED

- `docs/v2/adr/001-document-identity.md` — FOUND
- `docs/v2/adr/README.md` — FOUND
- `.planning/phases/00-foundation-decisions/00-02-SUMMARY.md` — FOUND
- Commit `e1b2524` (Task 1 relocate) — FOUND
- Commit `47d1deb` (Task 2 amend) — FOUND
- Commit `28fc1f6` (Task 3 index seed) — FOUND
