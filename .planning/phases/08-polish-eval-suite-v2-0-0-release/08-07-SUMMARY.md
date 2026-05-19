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
| 1 | Configure branch protection on `main` (D-06) | **PASS** | Ruleset 16599684 `enforcement: active` targets `~DEFAULT_BRANCH`; requires `lint-and-test`; `strict_required_status_checks_policy: true`; `bypass_actors: []`; `current_user_can_bypass: "never"` |
| 2 | `npm publish --dry-run` validation | **PASS** | 5 files in tarball, 524.6 kB packed / 2.1 MB unpacked; only `dist/cli.js`, `dist/cli.js.map`, `LICENSE`, `README.md`, `package.json`; no leakage. Dry-run exits non-zero on the registry version-collision check (1.0.0 already published) — false negative; release.mjs bumps to 2.0.0 in 08-08 |
| 3 | RC tag dry-run of publish.yml (W3 — option a) | **AWAITING HUMAN** | Workflow green; `npm publish` step logged as SKIPPED; `npm view @owrede/vault-memory@2.0.0-rc.1 version` returns not-found; assets `vault-memory-plugin-v2.0.0-rc.1.tar.gz` + `manifest.sha256` attached; cleanup complete; main unchanged |

---

## Task 1 — Configure branch protection on `main` (D-06)

**Status:** PASS (2026-05-19)

### Approach actually used: Repository Ruleset (new system), not Classic Branch Protection

The plan's verification commands assumed the legacy Classic Branch Protection API
(`repos/.../branches/main/protection`). The maintainer used GitHub's newer
**Repository Rulesets** UI instead — a parallel, more flexible system that GitHub
is steering all repos toward. The two systems are not API-compatible: the classic
endpoint returns 404 even when a Ruleset is correctly configured against `main`.

This is a meaningful deviation but not a regression — Rulesets are stricter than
Classic Branch Protection on the D-06 axis (no `enforce_admins` toggle to forget;
the equivalent is `bypass_actors: []` which is the default and far harder to
accidentally undo). The acceptance evidence below uses the Rulesets API.

### Acceptance evidence

Verification command — `gh api repos/owrede/vault-memory/rulesets`:

```json
[
  {
    "id": 16599684,
    "name": "main - Branch Protection Ruleset",
    "target": "branch",
    "enforcement": "active",
    "source_type": "Repository",
    "source": "owrede/vault-memory"
  }
]
```

Full ruleset — `gh api repos/owrede/vault-memory/rulesets/16599684`:

```json
{
  "id": 16599684,
  "name": "main - Branch Protection Ruleset",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] }
  },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [{ "context": "lint-and-test" }]
      }
    }
  ],
  "bypass_actors": [],
  "current_user_can_bypass": "never"
}
```

### Acceptance mapping (Classic → Rulesets equivalents)

| D-06 / plan requirement | Classic Branch Protection field | Rulesets equivalent | Status |
|---|---|---|---|
| Required status check `lint-and-test` | `required_status_checks.contexts` includes `lint-and-test` | `rules[].type == required_status_checks` with parameter `required_status_checks[0].context == "lint-and-test"` | ✅ |
| No maintainer-bypass route | `enforce_admins.enabled == true` | `bypass_actors == []` AND `current_user_can_bypass == "never"` | ✅ (stricter than classic) |
| Require PR before merging | `required_pull_request_reviews` present | `rules[].type == pull_request` with `required_approving_review_count: 1` | ✅ |
| Branches up to date before merging | `required_status_checks.strict == true` | `required_status_checks.strict_required_status_checks_policy: true` | ✅ |
| Force-push disallowed | `allow_force_pushes.enabled == false` | (NOT directly expressed in this ruleset) | ⚠ See note below |

### Note: force-push gap

The current Ruleset does not include a `non_fast_forward` or `creation/update/deletion`
restriction rule, so force-pushes by an actor with write access could theoretically
bypass the PR + status-check rules above (a force-push rewrites history rather than
adding to it). GitHub Rulesets express this via a separate rule type
(`non_fast_forward` or "Restrict deletions / Block force pushes" in the UI).

For Phase 8, the practical impact is bounded:
- Solo maintainer repo; no other actors with write access.
- The Ruleset already blocks the merge path that uses force-push semantics inside a PR.
- A direct `git push --force origin main` would still be blocked by the
  `required_status_checks` + `pull_request` rules since both require a PR review path,
  which a force-push cannot satisfy without an open PR (and the open PR's check still
  must be green before merge).

Recommendation: add the "Block force pushes" rule type as a follow-up cleanup
(non-blocking for v2.0.0). Tracked in `deferred-items.md` under "Open
(non-blocking)" → "Ruleset hardening: add Block-force-pushes rule".

### `lint-and-test` registration

The check name was not selectable from the GitHub UI dropdown at the time the
Ruleset was created (no prior CI run on the repo since the Ruleset feature was
enabled). The maintainer entered `lint-and-test` as a free-text string — the
Ruleset accepts arbitrary check names, and GitHub binds them at the next CI run
that produces a check by that exact name. The job in `.github/workflows/ci.yml`
line 16 is named `lint-and-test`, so the binding will occur on the next PR.

### Result

- Ruleset ID: `16599684`
- Ruleset URL: https://github.com/owrede/vault-memory/rules/16599684
- `enforcement`: `active` ✅
- `conditions.ref_name.include`: `["~DEFAULT_BRANCH"]` ✅
- `rules[].type == required_status_checks` with `lint-and-test` ✅
- `rules[].type == pull_request` with 1 approval ✅
- `bypass_actors`: `[]` ✅
- `current_user_can_bypass`: `"never"` ✅ (D-06 satisfied — stricter than classic `enforce_admins:true`)
- `strict_required_status_checks_policy`: `true` ✅
- Force-push restriction: ⚠ not encoded as a separate Ruleset rule (see "Note: force-push gap" above). Non-blocking for v2.0.0; logged for follow-up.
- Screenshot of configured rule for the 08-08 sign-off doc: **TODO — maintainer to capture in plan 08-08**
- Blockers / deviations: none material; the Classic-vs-Rulesets API divergence is documented here as a deviation from the plan's literal verification commands but represents a stricter D-06 posture, not a weaker one.

---

## Task 2 — `npm publish --dry-run` validation (npm side)

**Status:** PASS (with documented dry-run false-negative on registry collision)

### Exit status note

`npm publish --dry-run` returned a non-zero exit because the registry collision
check flagged `1.0.0` as already-published:

```
npm error You cannot publish over the previously published versions: 1.0.0.
```

This is **not a failure of the tarball-shape validation** that this task tests —
the dry-run already produced the package summary and file list (below) before
the registry check ran. Plan 08-08's `release.mjs` bumps to `2.0.0` prior to
publishing, so the collision goes away on the live run. Recorded here as a
known-and-expected false negative; no action required.

### Tarball summary

```
📦  @owrede/vault-memory@1.0.0
name: @owrede/vault-memory
version: 1.0.0
filename: owrede-vault-memory-1.0.0.tgz
package size: 524.6 kB
unpacked size: 2.1 MB
total files: 5
shasum: 8f3d299bf3765db07202f1466edd2bfc3613c064
integrity: sha512-XhE8M3CwNy5Ps[...]TsqVQNfGA27EQ==
```

### Tarball contents

| File | Size |
|---|---|
| LICENSE | 1.1 kB |
| README.md | 12.1 kB |
| dist/cli.js | 574.2 kB |
| dist/cli.js.map | 1.5 MB |
| package.json | 2.0 kB |

### Acceptance checks

| Check | Status |
|---|---|
| Tarball produced without errors before registry check | ✅ |
| Only `dist/`, `README.md`, `LICENSE`, `package.json` in tarball | ✅ |
| `dist/cli.js` present (CLI bundle) | ✅ |
| No `src/`, no `tests/`, no `evals/`, no `.planning/`, no `.test.ts`, no `__tests__/` | ✅ |
| Package size <5 MB | ✅ (524.6 kB packed; 2.1 MB unpacked) |
| `bin.vault-memory` resolves to `dist/cli.js` (verified in `package.json`) | ✅ |
| Package name `@owrede/vault-memory`, version `1.0.0` | ✅ |

### Anomalies / findings

- **`dist/cli.js.map` (1.5 MB) ships in the published tarball.** This is the
  sourcemap for the CLI bundle and accounts for 70% of the unpacked size. The
  `package.json` `files:` field includes `dist/` wholesale, which sweeps the
  sourcemap in. Non-blocking for v2.0.0 (shipping sourcemaps is a legitimate
  choice for debuggability), but a candidate for footprint trimming in a
  post-v2.0.0 maintenance phase if package install size matters.
- **A prior `npm run build` had been run inside an executor worktree** (3
  levels deep at `.claude/worktrees/agent-*/`), producing `dist/cli.js` with
  paths like `../../../node_modules/tsup/assets/esm_shims.js`. The maintainer
  rebuilt from the primary checkout (commit `2c0f391`) to normalize to
  `node_modules/tsup/...` before the dry-run.

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
