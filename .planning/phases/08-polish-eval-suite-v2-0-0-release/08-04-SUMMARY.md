---
phase: 08-polish-eval-suite-v2-0-0-release
plan: 04
subsystem: docs
tags: [screencast, plugin-docs, release-engineering, phase-7-carryover]
requires: []
provides:
  - "Resolved canonical screencast reference pattern in INSTALL.md and CONTRACT-EDITOR.md"
affects:
  - docs/v2/plugin/INSTALL.md
  - docs/v2/plugin/CONTRACT-EDITOR.md
tech-stack:
  added: []
  patterns:
    - "Markdown image-link click-through: `[![alt](./thumb.png)](release-asset.mp4)`"
    - "Canonical GitHub Release MP4 URL pattern wired into docs ahead of asset publish"
key-files:
  created: []
  modified:
    - docs/v2/plugin/INSTALL.md
    - docs/v2/plugin/CONTRACT-EDITOR.md
decisions:
  - "Land canonical Release URL + thumbnail path in docs even before assets exist — docs are not lint-gated on link resolution; assets follow at v2.0.0 release time (plan 08-08)"
  - "Re-scope 08-04 to docs-only: Tasks 1 (MP4) + 2 (thumbnail PNG) deferred to plan 08-08, which owns the Release cut"
metrics:
  duration: "~10 min"
  completed: 2026-05-19T14:32:33Z
  tasks_completed: 2
  tasks_deferred: 2
---

# Phase 8 Plan 04: Plugin Walkthrough Screencast Artifacts Summary

Re-scoped plan 08-04 to land only the docs portion this session: the canonical
GitHub Release MP4 URL (`https://github.com/owrede/vault-memory/releases/download/v2.0.0/vault-memory-plugin-walkthrough.mp4`)
and the in-repo thumbnail path (`docs/v2/plugin/screencast-thumbnail.png`) are
now wired into `docs/v2/plugin/INSTALL.md` and `docs/v2/plugin/CONTRACT-EDITOR.md`
as a markdown image-link click-through. The MP4 recording (Task 1) and the
thumbnail PNG production (Task 2) are deferred to plan 08-08, which owns the
v2.0.0 Release cut and uploads the asset.

## Tasks Completed

### Task 3 — Replace deferral notes in INSTALL.md and CONTRACT-EDITOR.md (DONE)

- **Commit:** `ebb33ee`
- **Files modified:**
  - `docs/v2/plugin/INSTALL.md` — replaced the "deferred to Phase 8" line
    (line 17) with the canonical screencast reference block.
  - `docs/v2/plugin/CONTRACT-EDITOR.md` — same replacement (line 10).
- **Acceptance criteria — all PASS:**
  - `grep -i "RELEASE_URL_PLACEHOLDER|TBD.*screencast|deferred to Phase 8"` →
    0 matches in both docs.
  - Both docs contain `screencast-thumbnail.png` (the in-repo thumbnail path).
  - Both docs contain the v2.0.0 Release MP4 URL.
  - `git diff` shows only the two doc files modified; no collateral edits.
- **Canonical pattern landed (verbatim, both docs):**
  ```markdown
  > **Screencast:** [![Plugin walkthrough (5-7 min)](./screencast-thumbnail.png)](https://github.com/owrede/vault-memory/releases/download/v2.0.0/vault-memory-plugin-walkthrough.mp4)
  >
  > Click the thumbnail to watch the 5–7 minute install → first contract authored → first `instantiate_contract` walkthrough (MP4, attached as a GitHub Release asset at v2.0.0).
  ```

### Task 4 — Verify README.md cross-link (PASS with flag, no commit)

- **Commit:** N/A (read-only verification)
- **Result:** README.md line 279 still carries the literal "deferred to Phase 8"
  placeholder note and does NOT reference `docs/v2/plugin/screencast-thumbnail.png`
  or the canonical MP4 URL. The screencast pattern was therefore **not yet present**
  in README at verification time.
- **Disposition:** Out of scope for plan 08-04. README.md is plan 08-02's territory
  (per the plan's own Task 4 guidance: "do NOT modify README.md here"). Flagged
  for plan 08-02 revision (or rolled into 08-08 Release-cut work) — see
  `deferred-items.md` §"Task 4 flag".
- **Acceptance criteria:** "Either README.md references the screencast OR a flag
  is raised for plan 08-02 revision (non-blocking warning)" — PASS via the flag
  branch.

## Tasks Deferred

### Task 1 — Record MP4 (DEFERRED to plan 08-08)

The screencast MP4 is a GitHub Release asset (D-14: not committed to repo). It
only needs to exist on the maintainer's machine in time for the v2.0.0 Release
upload, which is plan 08-08's responsibility. Deferring Task 1 to 08-08 keeps
the maintainer's recording session colocated with the Release cut. The canonical
URL is already wired into the docs (this session), so when the asset publishes
the click-through resolves.

- Acceptance criteria carried forward to plan 08-08 (≤8 min runtime, 1080p MP4,
  all five storyboard sections present).
- Recorded in `deferred-items.md`.

### Task 2 — Produce thumbnail PNG (DEFERRED to plan 08-08)

The thumbnail is a still frame extracted from the MP4 (Section B at ~1:30 per the
plan). It cannot exist before the recording. Defer with Task 1 to plan 08-08.

- The in-repo path `docs/v2/plugin/screencast-thumbnail.png` is referenced in
  INSTALL.md / CONTRACT-EDITOR.md from this session; GitHub renders a broken-image
  placeholder for the markdown until 08-08 commits the PNG. Docs are not lint-gated
  on link resolution, so this is acceptable.
- Acceptance criteria carried forward to plan 08-08 (≤600px wide, <200 KB).
- Recorded in `deferred-items.md`.

## Deviations from Plan

### Re-scope: Tasks 1 + 2 deferred to plan 08-08

- **Type:** Maintainer scope decision (not a Rule 1-4 deviation — explicit
  maintainer direction to re-scope before resuming from the Task 1 human-action
  checkpoint).
- **Rationale:** The MP4 is a Release asset that lives in GitHub Releases, not
  in the repo (D-14). The natural ownership boundary is plan 08-08, which cuts
  the v2.0.0 Release and uploads the asset. Blocking 08-04 on a synchronous
  recording session is not the right factoring — the docs-only portion can
  ship today and the asset follows at release time.
- **Impact:** No follow-up effort required in 08-04. Plan 08-08 inherits two
  artifact-production tasks plus the existing Release-upload work. The canonical
  URL/path pattern is already in the docs, so 08-08 only needs to produce the
  artifacts at those known locations.

## Verification

- `grep -i "RELEASE_URL_PLACEHOLDER\|TBD.*screencast\|screencast.*TBD\|deferred to Phase 8" docs/v2/plugin/INSTALL.md docs/v2/plugin/CONTRACT-EDITOR.md`
  → 0 matches (PASS).
- `grep -q "screencast-thumbnail.png" docs/v2/plugin/INSTALL.md` → PASS.
- `grep -q "screencast-thumbnail.png" docs/v2/plugin/CONTRACT-EDITOR.md` → PASS.
- `grep -q "releases/download/v2.0.0/vault-memory-plugin-walkthrough.mp4" docs/v2/plugin/INSTALL.md` → PASS.
- `grep -q "releases/download/v2.0.0/vault-memory-plugin-walkthrough.mp4" docs/v2/plugin/CONTRACT-EDITOR.md` → PASS.
- README cross-link: flagged for 08-02 (see Task 4 above).

## Known Stubs

The markdown image-links in INSTALL.md and CONTRACT-EDITOR.md point at a
thumbnail PNG (`docs/v2/plugin/screencast-thumbnail.png`) and a Release MP4
that do not yet exist in the published artifact set. This is **intentional and
documented** — the in-repo path and the canonical Release URL are the targets
that plan 08-08 will produce. Once 08-08 lands, both links resolve. Until then
GitHub will render a broken-image placeholder for the thumbnail.

This is not a Rule 1-3 stub (no UI rendering pipeline depending on these
files; no hardcoded empty values flowing to user code).

## Self-Check

- File `docs/v2/plugin/INSTALL.md` — FOUND, modified with canonical pattern.
- File `docs/v2/plugin/CONTRACT-EDITOR.md` — FOUND, modified with canonical pattern.
- File `.planning/phases/08-polish-eval-suite-v2-0-0-release/deferred-items.md` — FOUND, created this session.
- Commit `ebb33ee` — FOUND in worktree branch `worktree-agent-a1ad8497648bb3812`.

## Self-Check: PASSED
