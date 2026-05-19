---
phase: 08-polish-eval-suite-v2-0-0-release
plan: 07
subsystem: infra
tags: [release, branch-protection, ci, github-actions, rc-dry-run, npm-publish]
status: AWAITING HUMAN

# Dependency graph
requires:
  - phase: 08-05
    provides: "REL-08 Resource promotions (post-merge HEAD baseline)"
  - phase: 08-06
    provides: ".github/workflows/publish.yml extended with plugin-tarball + manifest.sha256 + Release-asset attach; CONTRIBUTING.md eval-gate doc"
provides:
  - "GitHub branch protection on main: required status check `lint-and-test`; enforce_admins:true; force-push disallowed (D-06 / REL-01)"
  - "Validated publish.yml end-to-end via v2.0.0-rc.1 tag with `npm publish` skipped via `-rc.*` guard on throwaway branch (W3 / RESEARCH Open Q3)"
  - "Findings + workflow URL + SKIPPED-step log excerpt + `npm view ...rc.1` not-found proof, ready as inputs to plan 08-08 (live v2.0.0 cut)"
affects: [08-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Temporary `-rc.*` guard on `npm publish` step lives only on a throwaway branch; main remains unchanged (W3 — option a)"
    - "`gh api repos/.../branches/main/protection` for branch-protection audit"
    - "`npm view <pkg>@<version>` returning not-found as canonical proof of non-publish"

key-files:
  created:
    - .planning/phases/08-polish-eval-suite-v2-0-0-release/08-07-SUMMARY.md
  modified: []

key-decisions:
  - "AWAITING HUMAN — fill in after task 1 (branch-protection settings finalized)"
  - "AWAITING HUMAN — fill in after task 2 (npm publish --dry-run file list)"
  - "AWAITING HUMAN — fill in after task 3 (option a temporary-conditional path used, OR option b fork path used)"

requirements-completed: [REL-01]

# Metrics
duration: AWAITING HUMAN
completed: AWAITING HUMAN
---

# Phase 8 Plan 07: Branch Protection + RC Tag Dry-Run Summary

**AWAITING HUMAN** — branch protection on `main` requires the `lint-and-test` CI status check with `enforce_admins:true`; publish.yml validated end-to-end via a `v2.0.0-rc.1` tag with `npm publish` skipped via a `-rc.*` guard on a throwaway branch; public npm registry not polluted; ready for the live v2.0.0 cut in plan 08-08.

## Status

**This plan is fully non-autonomous — all three tasks are `checkpoint:human-action`.** The executor agent scaffolded this SUMMARY but performed no GitHub Settings change, no `npm publish --dry-run`, no tag push, and no GitHub API calls. The maintainer must complete the three tasks below in order, then update this SUMMARY in place with the actual command output, log excerpts, and screenshots.

## Performance

- **Duration:** AWAITING HUMAN
- **Started:** AWAITING HUMAN
- **Completed:** AWAITING HUMAN
- **Tasks:** 3 (all `checkpoint:human-action`)
- **Files created:** 1 (this SUMMARY)
- **Files modified:** 0 (the throwaway-branch edits in Task 3 live only on the discarded `release-dry-run` branch)

## Verification Table

| Task | Name | Status | Acceptance Gate |
|------|------|--------|-----------------|
| 1 | Configure branch protection on `main` (D-06) | **AWAITING HUMAN** | `gh api .../protection \| jq '.required_status_checks.contexts'` includes `"lint-and-test"`; `.enforce_admins.enabled == true`; force-push disallowed |
| 2 | `npm publish --dry-run` validation | **AWAITING HUMAN** | Exits 0; file list contains only `dist/`, `README.md`, `LICENSE`; package size <5 MB; no `.test.ts` / `tests/` / `evals/` / `.planning/` leakage |
| 3 | RC tag dry-run of publish.yml (W3 — option a) | **AWAITING HUMAN** | Workflow green; `npm publish` step logged as SKIPPED; `npm view @owrede/vault-memory@2.0.0-rc.1 version` returns not-found; assets `vault-memory-plugin-v2.0.0-rc.1.tar.gz` + `manifest.sha256` attached; cleanup complete; main unchanged |

---

## Task 1 — Configure branch protection on `main` (D-06)

**Status:** AWAITING HUMAN

### Paste-ready verification commands

```bash
# Audit the required status check after saving the rule in GitHub Settings:
gh api repos/owrede/vault-memory/branches/main/protection | jq '.required_status_checks.contexts'
# Expected: ["lint-and-test"]  (or an array including that string)

# Audit admin-enforcement:
gh api repos/owrede/vault-memory/branches/main/protection | jq '.enforce_admins.enabled'
# Expected: true

# Audit force-push restriction:
gh api repos/owrede/vault-memory/branches/main/protection | jq '.allow_force_pushes.enabled'
# Expected: false
```

### Configuration steps (GitHub Settings web UI)

Navigate to https://github.com/owrede/vault-memory/settings/branches → Add rule → branch pattern `main`. Enable:

- "Require a pull request before merging" (1 approval is safer than 0)
- "Require status checks to pass before merging" → "Require branches to be up to date before merging" → status check: `lint-and-test`
- "Include administrators" (per D-06 no-override)
- "Allow force pushes" → "No one"
- Do NOT enable "Require signed commits" (out of v2.0.0 scope)

If the `lint-and-test` check is not selectable: open a draft PR with any trivial change, wait for CI once so the check name registers in the org-level catalog, then add the rule and close the draft PR.

### Result (AWAITING HUMAN — paste below after configuring)

- `.required_status_checks.contexts` jq output: **AWAITING HUMAN**
- `.enforce_admins.enabled` jq output: **AWAITING HUMAN**
- `.allow_force_pushes.enabled` jq output: **AWAITING HUMAN**
- Screenshot of the configured rule (filed in plan 08-08 sign-off doc): **AWAITING HUMAN**
- Blockers / deviations (if any): **AWAITING HUMAN**

---

## Task 2 — `npm publish --dry-run` validation (npm side)

**Status:** AWAITING HUMAN

### Paste-ready verification commands

```bash
# From the repo root with a clean working tree on main:
npm run build
npm publish --dry-run --access public
```

### Acceptance checks

- Exit code 0
- File list includes `dist/cli.js`, `README.md`, `LICENSE`
- File list does NOT include `.test.ts`, `tests/`, `evals/`, `.planning/`, `src/`
- Package size <5 MB
- `bin.vault-memory` resolves to `dist/cli.js`
- Package name is `@owrede/vault-memory`; version is currently `1.0.0` (release.mjs from plan 08-06 will bump to `2.0.0` in plan 08-08)

### Result (AWAITING HUMAN — paste below after running)

- Exit code: **AWAITING HUMAN**
- Tarball file count and total size: **AWAITING HUMAN**
- File list (paste the `npm notice 📦 …` block from the dry-run output): **AWAITING HUMAN**
- Anomalies (any unexpected file leakage, missing dist, etc.): **AWAITING HUMAN**

---

## Task 3 — RC tag dry-run of publish.yml via `-rc.*` skip-publish guard (W3 — option a)

**Status:** AWAITING HUMAN

### Paste-ready verification commands

**Pre-flight (verify plans 08-01..08-06 landed; tree clean; on main; pulled):**

```bash
git fetch --all --prune
git checkout main
git pull --ff-only
git status
git log --oneline -10
```

**Step A — stage the dry-run on a throwaway branch (NOT main):**

```bash
git checkout -b release-dry-run
npm version 2.0.0-rc.1 --no-git-tag-version
# Then edit .github/workflows/publish.yml — locate the `npm publish` step and add:
#   if: ${{ !contains(github.ref_name, '-rc.') }}
# above the `run: npm publish --access public --provenance` line.
git diff
git commit -am "release: v2.0.0-rc.1 dry-run (skip npm publish for -rc.* refs)"
```

**Step B — tag and push the tag (triggers publish.yml):**

```bash
git tag -a v2.0.0-rc.1 -m "v2.0.0-rc.1 dry-run (npm publish skipped via -rc.* guard)"
git push origin v2.0.0-rc.1
gh run watch
```

**Step C — verify workflow output:**

```bash
# Workflow run URL (use the most recent run for publish.yml):
gh run list --workflow=publish.yml --limit=3
# Confirm the `npm publish` step is logged as SKIPPED in the run log:
gh run view --log <RUN_ID> | grep -A2 -E "(Publish to npm|publish.*skipped|conditional)"

# Release assets:
gh release view v2.0.0-rc.1 --json assets | jq '.assets[].name'
# Expected: includes "vault-memory-plugin-v2.0.0-rc.1.tar.gz" and "manifest.sha256"

# Release body (should contain the RC-1 CHANGELOG section):
gh release view v2.0.0-rc.1 --json body | jq -r '.body'

# CANONICAL PROOF that public npm was NOT polluted:
npm view @owrede/vault-memory@2.0.0-rc.1 version
# Expected: ERROR / "not found"
```

**Step D — CRITICAL cleanup:**

```bash
gh release delete v2.0.0-rc.1 --yes
git push origin :v2.0.0-rc.1
git tag -d v2.0.0-rc.1
# If you pushed the throwaway branch to origin:
git push origin :release-dry-run || true
git checkout main
git branch -D release-dry-run

# Verify main is unchanged (HEAD on main matches pre-dry-run state):
git log --oneline -5
```

### Acceptance criteria

- Workflow ran to completion (green)
- `npm publish` step logged as **SKIPPED** (the conditional evaluated false) — primary W3 gate
- `npm view @owrede/vault-memory@2.0.0-rc.1 version` returns **not-found** — canonical proof no public-npm pollution
- Release assets included `vault-memory-plugin-v2.0.0-rc.1.tar.gz` and `manifest.sha256`
- Release body contained the RC-1 CHANGELOG section
- All cleanup completed: tag deleted (local + remote), Release deleted, `release-dry-run` branch deleted (local + remote if pushed), main unchanged

### Result (AWAITING HUMAN — paste below after running)

- Approach used: option (a) temporary `-rc.*` conditional on throwaway branch [DEFAULT] / option (b) fork repository: **AWAITING HUMAN**
- Workflow run URL: **AWAITING HUMAN**
- Workflow status: **AWAITING HUMAN**
- SKIPPED-`npm publish`-step log excerpt:
  ```
  AWAITING HUMAN — paste the workflow log line showing the `Publish to npm` step status as Skipped
  ```
- `gh release view ... --json assets` output: **AWAITING HUMAN**
- `gh release view ... --json body` head: **AWAITING HUMAN**
- `npm view @owrede/vault-memory@2.0.0-rc.1 version` output (must be ERROR / not-found): **AWAITING HUMAN**
- Cleanup confirmation (tag deleted local+remote, Release deleted, branch deleted, `git log --oneline -5` on main unchanged): **AWAITING HUMAN**
- Findings for plan 08-08 (any failure modes, surprises, or edits to the live cut procedure): **AWAITING HUMAN**

---

## Deviations from Plan

**AWAITING HUMAN** — record any deviations from the documented procedure here (e.g., used option b fork path, lint-and-test name did not register and required a draft-PR rehearsal, RC dry-run surfaced a publish.yml bug, etc.). If the plan was followed exactly, write "None — plan executed exactly as written."

## Carryover to Plan 08-08

- **Live v2.0.0 cut consumes:** branch protection (already configured), validated publish.yml shape, screencast MP4 + thumbnail PNG (still deferred per `deferred-items.md`).
- The temporary `-rc.*` conditional NEVER touched main; plan 08-08 cuts the live `v2.0.0` tag from main where no guard exists, so `npm publish` runs normally.

## Self-Check

(To be filled in by the executor once the human steps complete and this SUMMARY is updated with real outputs.)
