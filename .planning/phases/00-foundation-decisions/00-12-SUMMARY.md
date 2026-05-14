---
phase: 00-foundation-decisions
plan: 12
subsystem: ci
tags: [ci, lint, shell, github-actions, posix, privacy, telemetry]
dependency_graph:
  requires:
    - 00-01-SUMMARY.md  # package.json lint:check script wires both lints
    - 00-09-SUMMARY.md  # evals/fixtures/v2-test-vault/ exists for allowlist
  provides:
    - "scripts/check-fixture-privacy.sh — fixture allowlist guard (FND-11)"
    - "scripts/lint-no-telemetry.sh — banlist guard with escape comment (FND-12)"
    - ".github/workflows/ci.yml — PR + push:main CI gate"
  affects:
    - Every future PR is now gated by lint:check (privacy + telemetry + tsc + prettier) and the vitest suite.
    - Maintainers can suppress legitimate banword references inline via `// vault-memory:no-telemetry-ok`.
tech_stack:
  added: [github-actions]  # actions/checkout@v4, actions/setup-node@v4
  patterns:
    - "POSIX shell discipline: only -r -E -i -l -n -v -q grep flags; find -name patterns; no -P / --include / --exclude-dir."
    - "Git-index-based scanning (git ls-tree -r --name-only HEAD) rather than working-tree walk — robust against uncommitted debris."
    - "Per-branch concurrency.cancel-in-progress: true so superseded pushes free runner time."
key_files:
  created:
    - "scripts/check-fixture-privacy.sh"
    - "scripts/lint-no-telemetry.sh"
    - ".github/workflows/ci.yml"
  modified: []
decisions:
  - "Used `find src -name '*.ts' -not -name '*.test.ts' -type f` rather than `grep -r --include` to stay BSD/BusyBox-compatible."
  - "Privacy lint uses `git ls-tree HEAD` (committed state) — confirmed by red-test that `git add` alone is not enough to trip the lint; an actual commit is required. This matches D-19's intent: the guard fires on what would land on main, not on transient working-tree state."
  - "Did not run `npm run lint:check` end-to-end during execution because the wave's sibling agents may not yet have landed their work; the CI gate itself is the integration test."
metrics:
  duration: "~2m wall (3 auto tasks; checkpoint pending maintainer)"
  completed_date: "2026-05-14"
  tasks_completed: "3/4 (Task 4 is checkpoint:human-verify, deferred to maintainer)"
  files_created: 3
  files_modified: 0
---

# Phase 00 Plan 12: CI Lints + Workflow Summary

Shipped two POSIX-portable shell lints (`check-fixture-privacy.sh`, `lint-no-telemetry.sh`) and the `.github/workflows/ci.yml` workflow that gates them on every PR and push to main. The scripts adopt the verbatim implementations from `00-RESEARCH.md` §Example 1–3; the workflow adopts the verbatim Example 3 with full-history checkout (required by `git ls-tree`) and per-branch cancel-in-progress concurrency.

## What landed

| File | Purpose | Commit |
|------|---------|--------|
| `scripts/check-fixture-privacy.sh` | Fails (exit 1) when `evals/fixtures/<dir>/` other than the allowlisted `v2-test-vault` is committed. Operates on `git ls-tree -r --name-only HEAD`, awk-pivots first-level dir name, removes allowed name via `grep -vxF`. | `3adf9db` |
| `scripts/lint-no-telemetry.sh` | Fails when any line under `src/**/*.ts` (excluding `*.test.ts`) matches the 11-word banlist regex without the same-line escape marker `vault-memory:no-telemetry-ok`. Uses `find src -name '*.ts' -not -name '*.test.ts' -type f | xargs grep -inE`. | `1b54a74` |
| `.github/workflows/ci.yml` | Triggers on `pull_request:` (no filters) and `push:` to `main`. Cancels superseded runs via per-branch concurrency group. Steps: checkout (fetch-depth: 0) → setup-node@v4 (Node 22, npm cache) → `npm ci` → `npm run lint:check` → `npm test`. | `7f8bd38` |

## Acceptance criteria — task-by-task

### Task 1: `scripts/check-fixture-privacy.sh` — PASS

- `test -x scripts/check-fixture-privacy.sh` → true
- `sh scripts/check-fixture-privacy.sh` → exit 0 with `✓ Fixture-privacy lint passed (allowlist: v2-test-vault)`
- `grep -q 'ALLOW="v2-test-vault"' scripts/check-fixture-privacy.sh` → true
- `! grep -qE -- '-P|--include|--exclude-dir' scripts/check-fixture-privacy.sh` → true (no GNU-only flags)
- **Red-test executed inline:** `mkdir -p evals/fixtures/sneaky-vault/ && echo "test" > evals/fixtures/sneaky-vault/dummy.md && git add + git commit`, then re-ran the lint. Got exit 1 + stderr clearly listing `- evals/fixtures/sneaky-vault/`. Reverted via `git reset --soft HEAD~1` + `rm -rf evals/fixtures/sneaky-vault`. `git status` post-revert was clean (only the untracked new script). VALIDATION row 00-11-02 confirmed.
- Note: `git add` alone does not trip the lint — only a `git commit` does. This is intentional and matches D-19 (the guard fires on what would land on main).

### Task 2: `scripts/lint-no-telemetry.sh` — PASS (automated portion)

- `test -x scripts/lint-no-telemetry.sh` → true
- `sh scripts/lint-no-telemetry.sh` → exit 0 with `✓ Telemetry banlist clean (65 files scanned)`
- `grep -q 'vault-memory:no-telemetry-ok' scripts/lint-no-telemetry.sh` → true
- All required banwords present in the regex literal: `analytics`, `telemetry`, `posthog`, `segment\.com`, `mixpanel`, `sentry`, `datadog`, `track\(`, `trackEvent`, `report\(`, `reportMetric` (verbatim from RESEARCH §Example 2)
- `! grep -qE -- '-P|--include|--exclude-dir' scripts/lint-no-telemetry.sh` → true
- `grep -q 'not -name' && grep -q '*.test.ts'` → both true (excludes test files)

### Task 3: `.github/workflows/ci.yml` — PASS

- `test -f .github/workflows/ci.yml` → true
- `grep -qE 'pull_request:|push:' .github/workflows/ci.yml` → true
- `grep -q 'lint:check' .github/workflows/ci.yml` → true
- `grep -q 'cancel-in-progress: true' .github/workflows/ci.yml` → true
- `grep -q 'fetch-depth: 0' .github/workflows/ci.yml` → true
- `grep -q 'npm test' .github/workflows/ci.yml` → true
- `npm ci` precedes `npm run lint:check` in step order → confirmed by `awk` check

### Task 4: `checkpoint:human-verify` — DEFERRED to maintainer

Three manual checks per VALIDATION Manual-Only Verifications:

1. **Telemetry red-test (VALIDATION row 00-12-02):** Append `// const x = analytics();` (literal word `analytics`, no escape comment) to any non-test file under `src/`. Expected: `sh scripts/lint-no-telemetry.sh` exits non-zero with stderr naming the offending file + line. Revert with `git checkout -- <file>`.
2. **Escape-comment suppression (VALIDATION row 00-12-03):** Append `const x = "analytics_legacy_naming"; // vault-memory:no-telemetry-ok` to `src/server.ts`. Expected: lint exits 0 (marker on same line suppresses the match). Revert.
3. **Alpine bake-test (VALIDATION Manual-Only — POSIX portability):**
   ```
   docker run --rm -v "$PWD":/repo -w /repo alpine sh -c \
     'apk add --no-cache grep findutils git && \
      sh scripts/check-fixture-privacy.sh && \
      sh scripts/lint-no-telemetry.sh'
   ```
   `git` install required because `check-fixture-privacy.sh` uses `git ls-tree`. Expected exit 0 on clean tree.

Optional: open a draft PR to confirm GitHub Actions runs the workflow end-to-end (`npm ci → lint:check → test`) and finishes green.

## Deviations from Plan

None. All three scripts adopted verbatim from `00-RESEARCH.md` §Example 1–3 as the plan directed.

## Out-of-scope notes

- Did NOT modify `package.json` — `lint:check` was already wired in plan 00-01 (commit history confirms).
- Did NOT run `npm run lint:check` end-to-end. That chain also invokes `tsc --noEmit && prettier --check` which depends on sibling wave 4 plans (00-11, 00-13) landing first. The CI workflow itself will be the integration test once all of wave 4 lands on the phase branch.
- Did NOT add a multi-platform CI matrix (macOS/Windows) — RESEARCH §Deferred Ideas marks this as Phase 8 territory.

## Known Stubs

None. Both scripts are fully functional; both passed clean-tree on the current repo state.

## Threat Flags

None. The change introduces no new network surface, no auth path, no schema. The CI workflow runs only `npm ci`, `npm run lint:check`, `npm test` on `ubuntu-latest` and inherits the default `GITHUB_TOKEN` scope (read-only for PRs from forks).

## Self-Check: PASSED

- `scripts/check-fixture-privacy.sh` — exists (`-rwxr-xr-x`, 34 lines), passes clean-tree.
- `scripts/lint-no-telemetry.sh` — exists (`-rwxr-xr-x`, 37 lines), passes clean-tree (65 files scanned).
- `.github/workflows/ci.yml` — exists, all six grep assertions pass.
- Commits: `3adf9db`, `1b54a74`, `7f8bd38` all present in `git log` on `worktree-agent-a55e294e856064a22`.
