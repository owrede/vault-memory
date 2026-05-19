---
phase: 08-polish-eval-suite-v2-0-0-release
plan: 07
subsystem: infra
tags: [release, branch-protection, ci, github-actions, rc-dry-run, npm-publish]
status: complete

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
  - "Task 1: Used Repository Rulesets (new system), not Classic Branch Protection. Stricter equivalents documented in mapping table. Ruleset 16599684 active."
  - "Task 2: npm publish --dry-run package shape clean (5 files, 524.6 kB packed, no src/tests/evals leakage). dist/cli.js.map (1.5 MB) ships in tarball — logged as non-blocking footprint finding."
  - "Task 3: Used option (a) temporary `-rc.*` conditional on throwaway branch. W3 primary gate PASSED (Publish to npm = skipped); npm not polluted (404). PUBLISH.YML BUG SURFACED: `Build plugin tarball` step fails because `cd plugin && npm ci` does not install workspace-hoisted deps. Must be fixed in plan 08-08 before the live v2.0.0 cut."

requirements-completed: [REL-01]

# Metrics
duration: ~50 minutes (Task 1: ruleset config + verification; Task 2: dry-run; Task 3: throwaway-branch dry-run + cleanup; SUMMARY recording inline)
completed: 2026-05-19
---

# Phase 8 Plan 07: Branch Protection + RC Tag Dry-Run Summary

Branch protection on `main` is active via Repository Ruleset 16599684 (stricter equivalent of the plan's classic-branch-protection target — `bypass_actors:[]` + `current_user_can_bypass:"never"` are stronger than `enforce_admins:true`). The `npm publish --dry-run` validated a clean 5-file tarball. The RC tag dry-run of publish.yml ran in two passes: the first (`v2.0.0-rc.1`) proved the `-rc.*` skip-publish guard works (W3 primary gate) and surfaced a publish.yml `Build plugin tarball` bug (workspace dep hoisting); the bug was fixed in commit `0fce96a` on main, and the second dry-run (`v2.0.0-rc.2`, run `26110748660`) passed all 16 workflow steps including Release creation with both assets attached. Public npm was NOT polluted in either pass (`npm view @owrede/vault-memory@2.0.0-rc.{1,2} version` both return 404). Cleanup complete in both passes; `main` HEAD at `0fce96a`. Plan 08-08 may proceed to the live v2.0.0 cut with high confidence.

## Status

**This plan is fully non-autonomous — all three tasks are `checkpoint:human-action`.** The executor agent scaffolded this SUMMARY but performed no GitHub Settings change, no `npm publish --dry-run`, no tag push, and no GitHub API calls. The maintainer must complete the three tasks below in order, then update this SUMMARY in place with the actual command output, log excerpts, and screenshots.

## Performance

- **Duration:** ~50 minutes (inline conversational pacing — task-by-task)
- **Started:** 2026-05-19 17:55 (local)
- **Completed:** 2026-05-19 18:25 (local)
- **Tasks:** 3 (all `checkpoint:human-action`)
- **Files created:** 1 (this SUMMARY)
- **Files modified:** 0 (the throwaway-branch edits in Task 3 live only on the discarded `release-dry-run` branch)

## Verification Table

| Task | Name | Status | Acceptance Gate |
|------|------|--------|-----------------|
| 1 | Configure branch protection on `main` (D-06) | **PASS** | Ruleset 16599684 `enforcement: active` targets `~DEFAULT_BRANCH`; requires `lint-and-test`; `strict_required_status_checks_policy: true`; `bypass_actors: []`; `current_user_can_bypass: "never"` |
| 2 | `npm publish --dry-run` validation | **PASS** | 5 files in tarball, 524.6 kB packed / 2.1 MB unpacked; only `dist/cli.js`, `dist/cli.js.map`, `LICENSE`, `README.md`, `package.json`; no leakage. Dry-run exits non-zero on the registry version-collision check (1.0.0 already published) — false negative; release.mjs bumps to 2.0.0 in 08-08 |
| 3 | RC tag dry-run of publish.yml (W3 — option a) | **PASS — bug surfaced and fixed, re-verified** | First dry-run (`v2.0.0-rc.1`): W3 gate PASS; plugin-tarball step FAIL → bug fixed in `0fce96a` on main → second dry-run (`v2.0.0-rc.2`, run `26110748660`): all 16 steps PASS, Release created with both assets (5.18 MB plugin tarball + manifest.sha256), npm still 404. publish.yml now confirmed working end-to-end. |

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

**Status:** MIXED — W3 primary gate PASS; publish.yml plugin-tarball step has a pre-existing 08-06 bug that MUST be fixed in 08-08 before the live cut

### Headline result

The dry-run did exactly what it was designed to do: it surfaced a real publish.yml bug
in a place where we could fix it before cutting v2.0.0 live. The W3 conditional guard
worked perfectly — `Publish to npm` was skipped on the `-rc.*` tag, npm was not polluted,
the canonical 404 proof holds. The Release was not created because the plugin-tarball
build step (08-06's primary 08-08-enabling deliverable) failed.

### Workflow run

- Approach used: option (a) temporary `-rc.*` conditional on throwaway `release-dry-run` branch
- Workflow run URL: https://github.com/owrede/vault-memory/actions/runs/26110050088
- Job ID: 76784548741
- Triggered: 2026-05-19T16:16:17Z via `git push origin v2.0.0-rc.1`
- Duration: 52s (failed fast at the plugin-tarball step)
- Trigger commit (on throwaway branch only): `9989f68 release: v2.0.0-rc.1 dry-run (skip npm publish for -rc.* refs)`

### Step-by-step conclusions (full audit)

| # | Step | Conclusion |
|---|------|------------|
| 1 | Set up job | success |
| 2 | Checkout | success |
| 3 | Setup Node 22 | success |
| 4 | Install dependencies | success |
| 5 | Type check | success |
| 6 | Test | success |
| 7 | Build | success |
| 8 | Verify package.json version matches tag | success (`2.0.0-rc.1` matched) |
| 9 | **Publish to npm** | **skipped** ← **W3 primary gate PASS** |
| 10 | Extract CHANGELOG section for this tag | success |
| 11 | **Build plugin tarball** | **failure** ← see "Finding for 08-08" below |
| 12 | Generate manifest.sha256 | skipped (blocked by 11) |
| 13 | Create GitHub Release | skipped (blocked by 11) |
| 14 | Post Setup Node 22 | skipped |
| 15 | Post Checkout | success |
| 16 | Complete job | success |

### W3 primary gate evidence

```bash
$ gh run view 26110050088 --json jobs --jq '.jobs[].steps[] | select(.name == "Publish to npm")'
{
  "name": "Publish to npm",
  "conclusion": "skipped",
  "status": "completed"
}
```

Conditional `if: ${{ !contains(github.ref_name, '-rc.') }}` evaluated to `false` on
the `v2.0.0-rc.1` ref, so the step was correctly skipped. On a clean `v2.0.0` tag in
plan 08-08, the same conditional will evaluate to `true` and npm publish will run.

### Public-npm pollution check

```bash
$ npm view @owrede/vault-memory@2.0.0-rc.1 version
npm error 404  The requested resource '@owrede/vault-memory@2.0.0-rc.1' could not be
found or you do not have permission to access it.
```

404 = canonical proof public npm was not polluted. The `2.0.0-rc.1` version number
remains available for re-use (irrelevant here — we will never publish that version).

### Finding for plan 08-08: publish.yml `Build plugin tarball` step is broken

**Root cause:** The workspace structure declares `"workspaces": ["plugin"]` at the
repository root, so `@modelcontextprotocol/sdk` (a top-level dep) is hoisted to the
root `node_modules/`. The publish.yml step does `cd plugin && npm ci`, which only
installs the plugin's own direct deps — the SDK isn't pulled in. Then
`node esbuild.config.mjs production` tries to resolve
`@modelcontextprotocol/sdk/client/index.js` from `plugin/src/services/mcp-client.ts`
and fails.

**Failure excerpt** (from `gh run view 26110050088 --log-failed`):

```
Error: Build failed with 3 errors:
src/services/mcp-client.ts:47:23: ERROR: Could not resolve "@modelcontextprotocol/sdk/client/index.js"
src/services/mcp-client.ts:48:37: ERROR: Could not resolve "@modelcontextprotocol/sdk/client/stdio.js"
src/services/mcp-client.ts:52:7:  ERROR: Could not resolve "@modelcontextprotocol/sdk/types.js"
```

**Required fix in plan 08-08** (one of two options — planner picks):

Option 1 — install at workspace root first, then build plugin:

```yaml
- name: Build plugin tarball
  run: |
    set -euo pipefail
    npm ci                  # ← workspace-root install, hoists @modelcontextprotocol/sdk to plugin/node_modules
    cd plugin
    node esbuild.config.mjs production
    cd ..
    TARBALL="vault-memory-plugin-v${GITHUB_REF_NAME#v}.tar.gz"
    tar -czf "$TARBALL" -C plugin .
    echo "TARBALL=$TARBALL" >> "$GITHUB_ENV"
```

(Note: the workflow's earlier `Install dependencies` step already ran `npm ci` at the
root, so this `npm ci` is redundant. The actually-minimal fix is to drop the
`cd plugin && npm ci` line entirely and just `cd plugin && node esbuild.config.mjs production`.)

Option 2 — declare `@modelcontextprotocol/sdk` as a direct dep in `plugin/package.json`
and run `cd plugin && npm ci` as before. Heavier change; ties the plugin to a specific
SDK version that may drift from the root version. Not recommended.

**Recommended option: Option 1 (drop the redundant `cd plugin && npm ci` line).**

### npm tarball regression check (also for 08-08 concern)

The 1.5 MB `dist/cli.js.map` shipping in the tarball (noted in Task 2) is unrelated
to this failure. The npm-side dry-run validates only the `@owrede/vault-memory` npm
package; the plugin tarball is a separate GitHub Release asset that has its own
build pipeline.

### Side-effect ledger (for audit)

| Action | Reverted? | Evidence |
|---|---|---|
| `git checkout -b release-dry-run` | yes | `git branch -D release-dry-run` |
| `npm version 2.0.0-rc.1 --no-git-tag-version` | yes | branch deleted; main never touched |
| `.github/workflows/publish.yml` edit (added `if:` guard) | yes | edit only ever on `release-dry-run` branch; branch deleted |
| `git tag v2.0.0-rc.1` (local) | yes | `git tag -d v2.0.0-rc.1` |
| `git push origin v2.0.0-rc.1` (remote tag) | yes | `git push origin :v2.0.0-rc.1` — `[deleted] v2.0.0-rc.1` |
| Workflow run `26110050088` | NO (immutable) | retained as evidence in GitHub Actions history |
| GitHub Release `v2.0.0-rc.1` | n/a — never created | workflow failed before the Release-creation step |
| npm publish of `2.0.0-rc.1` | n/a — never happened | W3 gate worked; `npm view` returns 404 |

`main` HEAD: `49a4b83` (unchanged from pre-dry-run state).

### Acceptance criteria recap

| Criterion | Status |
|---|---|
| Workflow ran to completion | yes (with failure at step 11; expected outcome of a dry-run is to surface bugs) |
| `npm publish` step logged as **skipped** (primary W3 gate) | ✅ PASS |
| `npm view @owrede/vault-memory@2.0.0-rc.1 version` returns **not-found** | ✅ PASS |
| Release assets included plugin tarball + `manifest.sha256` | ❌ FAIL — Release never created because step 11 failed |
| Release body contained the RC-1 CHANGELOG section | n/a — Release never created |
| Cleanup: tag deleted local+remote, branch deleted local, main unchanged | ✅ PASS |

### Verdict

The dry-run **succeeded in its purpose**: it surfaced a real publish.yml bug
(the plugin-tarball step is non-functional in CI) before the live v2.0.0 cut. If
plan 08-08 had run live without this dry-run, the v2.0.0 publish.yml workflow
would have skipped `npm publish` impossibly (since the conditional would not be
present on main) — wait, no: WITHOUT the conditional, it would have publish.yml
WOULD have published v2.0.0 to npm successfully (the npm-publish step has no
dependency on the plugin-tarball step), but then failed at the plugin-tarball
step and never created the GitHub Release. Result: npm has v2.0.0; GitHub has
no Release; `vm-install` skill (Phase 7) breaks because it fetches the plugin
tarball from a non-existent Release.

The W3 gate worked exactly as designed — npm was not touched.
The plugin-tarball bug fix is now plan 08-08's first task.

### Addendum — second dry-run verifies the fix (`v2.0.0-rc.2`, 2026-05-19)

After landing the publish.yml fix on main (`0fce96a fix(08): drop nested 'cd
plugin && npm ci' from publish.yml Build plugin tarball step`), a second dry-run
was performed on a throwaway `release-dry-run-2` branch to confirm the workflow
now goes end-to-end before 08-08's live cut.

Workflow run 26110748660 — all 16 steps PASS:

| Step | Conclusion |
|------|------------|
| Install dependencies / Type check / Test / Build / Verify version | success |
| **Publish to npm** | **skipped** ← W3 gate confirmed again |
| Extract CHANGELOG section | success (fell back to generic notes since `## [2.0.0-rc.2]` doesn't exist; the live cut renames `## [Unreleased]` → `## [2.0.0]` so the section extractor will find it) |
| **Build plugin tarball** | **success** ← fix verified, esbuild resolves @modelcontextprotocol/sdk correctly |
| Generate manifest.sha256 | success |
| Create GitHub Release | success |

Release `v2.0.0-rc.2` was created with the correct assets:

```bash
$ gh release view v2.0.0-rc.2 --json assets
{
  "assets": [
    { "name": "manifest.sha256", "size": 105 },
    { "name": "vault-memory-plugin-v2.0.0-rc.2.tar.gz", "size": 5180018 }
  ]
}
```

Plugin tarball: 5.18 MB. Both assets confirmed present.

Public-npm pollution check (negative as required):

```bash
$ npm view @owrede/vault-memory@2.0.0-rc.2 version
npm error code E404
npm error 404 No match found for version 2.0.0-rc.2
```

Cleanup completed:
- `gh release delete v2.0.0-rc.2 --yes` ✅
- `git push origin :v2.0.0-rc.2` ✅
- `git tag -d v2.0.0-rc.2` ✅
- `git branch -D release-dry-run-2` ✅
- main HEAD: `0fce96a` (the publish.yml fix commit, unchanged)
- `gh release list` shows no `v2*` releases (latest stable: `v1.0.0` from 2026-05-12)

**Verdict: publish.yml is now confirmed working end-to-end. Plan 08-08 may proceed
to the live v2.0.0 cut.**

---

## Deviations from Plan

Two material deviations from the literal plan procedure, both surfaced and resolved during execution:

1. **Task 1 used Repository Rulesets, not Classic Branch Protection.** The plan's
   `gh api .../branches/main/protection` verification command returns 404 against
   a Rulesets-protected branch. Replaced with `gh api .../rulesets/<id>` which
   captures stricter equivalents (`bypass_actors: []`, `current_user_can_bypass:
   "never"` are strictly stronger than classic `enforce_admins: true`). Full
   mapping table in the Task 1 section. Non-blocking deviation.

2. **Task 3 surfaced a publish.yml bug** (`Build plugin tarball` step fails to
   resolve `@modelcontextprotocol/sdk` because `cd plugin && npm ci` does not
   install hoisted workspace deps). This is exactly what the dry-run was designed
   to surface, but is also a new finding for plan 08-08: the bug must be fixed
   on `main` before the live v2.0.0 cut. Recommended fix documented in the
   "Finding for plan 08-08" subsection of Task 3.

3. **Task 1 force-push restriction not encoded** as a separate Ruleset rule
   (the Rulesets equivalent of Classic Branch Protection's
   `allow_force_pushes: false`). The Ruleset's PR + status-check rules block
   the merge path, but a defense-in-depth `non_fast_forward` rule is missing.
   Logged in `deferred-items.md` as a non-blocking ruleset-hardening follow-up.

## Carryover to Plan 08-08

| Item | Disposition |
|------|-------------|
| Branch protection on main | DONE — Ruleset `16599684` active. No further action in 08-08 beyond capturing a screenshot for the sign-off doc. |
| npm tarball shape validated | DONE — 5 files, 524.6 kB packed, clean. release.mjs will bump 1.0.0 → 2.0.0 in 08-08. |
| publish.yml `npm publish` step path | VALIDATED — `if:` guard pattern works. NOT present on main; live v2.0.0 cut will publish normally. |
| **publish.yml `Build plugin tarball` step** | **MUST FIX FIRST in 08-08** — the live cut will not produce a GitHub Release until this step is repaired. Fix recommendation in the Task 3 "Finding for plan 08-08" section above. |
| publish.yml CHANGELOG section extraction | VALIDATED — step ran successfully on `v2.0.0-rc.1` dry-run. |
| Screencast MP4 + thumbnail PNG | STILL DEFERRED to 08-08 per `deferred-items.md`. |
| Force-push restriction on main (Ruleset hardening) | DEFERRED, non-blocking. Logged in `deferred-items.md`. |

## Side-effects audit

The dry-run touched origin in three reversible ways. Reversal commands all executed
in cleanup step:

```bash
# Performed:
git checkout -b release-dry-run                       # local only
npm version 2.0.0-rc.1 --no-git-tag-version           # local only
# (edited publish.yml on the branch)
git commit -am "release: v2.0.0-rc.1 dry-run (skip npm publish for -rc.* refs)"
git tag -a v2.0.0-rc.1 -m "..."
git push origin v2.0.0-rc.1                           # remote tag created → workflow triggered

# Reversed in cleanup:
git checkout main
git push origin :v2.0.0-rc.1                          # remote tag deleted
git tag -d v2.0.0-rc.1                                # local tag deleted
git branch -D release-dry-run                         # local branch deleted

# Verified post-cleanup:
git log --oneline -5                                  # main at 49a4b83 unchanged
git tag --list 'v*'                                   # no v2.0.0-rc.1
git branch --list 'release-dry-run'                   # empty
```

The workflow run `26110050088` and its job step history remain in GitHub Actions
history (immutable). No npm publish happened (`npm view ...@2.0.0-rc.1` returns 404).
No GitHub Release was created (workflow failed before the Release-creation step).

## Self-Check

(To be filled in by the executor once the human steps complete and this SUMMARY is updated with real outputs.)
