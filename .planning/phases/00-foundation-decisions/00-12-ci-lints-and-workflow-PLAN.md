---
phase: 00-foundation-decisions
plan: 12
type: execute
wave: 3
depends_on: [01, 09]
files_modified:
  - scripts/check-fixture-privacy.sh
  - scripts/lint-no-telemetry.sh
  - .github/workflows/ci.yml
autonomous: false
requirements: [FND-11, FND-12]
user_setup:
  - service: alpine-bake-test
    why: "Per VALIDATION Manual-Only Verifications + RESEARCH Pitfall 3, both POSIX shell lints must be verified on Alpine (BusyBox) before merge to catch BSD-vs-GNU grep silent divergence. One-shot manual check using `docker run --rm -v $PWD:/repo -w /repo alpine sh -c ...`."
must_haves:
  truths:
    - "`scripts/check-fixture-privacy.sh` is POSIX-portable (tested on macOS BSD + Alpine BusyBox), executable, and passes on the clean tree containing only `evals/fixtures/v2-test-vault/` (FND-11)"
    - "`scripts/check-fixture-privacy.sh` fails (non-zero exit) when an unauthorized `evals/fixtures/<other>/` directory is committed (red-test demonstrates fail-loud behavior)"
    - "`scripts/lint-no-telemetry.sh` is POSIX-portable, executable, passes on the current tree (which contains no banlist substrings)"
    - "`scripts/lint-no-telemetry.sh` honors the `// vault-memory:no-telemetry-ok` escape comment (one matching line on the same line suppresses the violation)"
    - "`.github/workflows/ci.yml` exists, triggers on PR + push-to-main, runs `npm ci && npm run lint:check && npm test`, and uses `concurrency.cancel-in-progress: true`"
  artifacts:
    - path: "scripts/check-fixture-privacy.sh"
      provides: "Fixture allowlist guard"
      contains: "v2-test-vault"
    - path: "scripts/lint-no-telemetry.sh"
      provides: "Telemetry-substring banlist guard"
      contains: "vault-memory:no-telemetry-ok"
    - path: ".github/workflows/ci.yml"
      provides: "CI gate on PR + push:main"
      contains: "lint:check"
  key_links:
    - from: ".github/workflows/ci.yml"
      to: "scripts/check-fixture-privacy.sh + scripts/lint-no-telemetry.sh"
      via: "npm run lint:check (chains both)"
      pattern: "lint:check"
---

<objective>
Ship FND-11 (fixture-privacy lint), FND-12 (no-telemetry lint), and the `ci.yml` workflow that gates both on every PR and push to main (per D-21). Per D-18, both lints are POSIX shell; per RESEARCH §Example 1 + Example 2, exact portability-tested implementations are already drafted in the research doc — this plan adopts those verbatim, adds the matching red-tests, and wires the workflow.

Per VALIDATION Manual-Only Verifications, two checks are intentionally manual: the red-test for `lint-no-telemetry.sh` (mutating `src/**/*.ts` with a banlist word is hard to script cleanly without git debris) and the Alpine bake-test (BSD-vs-GNU divergence risk per RESEARCH Pitfall 3). Both happen in Task 3.

Output: two executable POSIX shell scripts + a CI workflow + manual bake-test confirmation.
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
@.planning/phases/00-foundation-decisions/00-09-SUMMARY.md
@scripts/download-reranker.sh
@.github/workflows/publish.yml
</context>

<tasks>

<task type="auto">
  <name>Task 1: Author `scripts/check-fixture-privacy.sh` (FND-11) — POSIX-portable allowlist guard</name>
  <read_first>
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Example 1 — `scripts/check-fixture-privacy.sh` complete script (verbatim adoption)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Pitfall 3 (BSD-vs-GNU grep portability rules; use only `-r -E -i -l -n -v -q`; avoid `-P --include --exclude-dir`)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-18 — POSIX shell; D-19 — allowlist of one fixture: `v2-test-vault`)
    - .planning/phases/00-foundation-decisions/00-VALIDATION.md rows 00-11-01 (clean-tree pass) + 00-11-02 (red-test fails on sneaky-vault)
    - scripts/download-reranker.sh (existing POSIX-shell style reference for shebang and `set -eu`)
  </read_first>
  <action>(A) Create `scripts/check-fixture-privacy.sh` with the EXACT shape from RESEARCH §Example 1. Required elements: shebang `#!/bin/sh`; `set -eu`; `ALLOW="v2-test-vault"`; uses `git ls-tree -r --name-only HEAD` to operate on the committed git index (not the working tree — robust against uncommitted debris); filters `^evals/fixtures/[^/]+/`, extracts the first-level dir name via `awk -F/ '{print $3}'`, sorts unique, removes the allowed name via `grep -vxF "$ALLOW"`; non-empty violation set causes a clear stderr message and `exit 1`; clean tree prints `✓ Fixture-privacy lint passed (allowlist: $ALLOW)` and exits 0. Use only POSIX-portable grep flags. Do NOT use `grep -P`, `grep --include`, or `grep --exclude-dir`. (B) `chmod +x scripts/check-fixture-privacy.sh`. (C) Manual red-test (referenced in VALIDATION row 00-11-02): in a scratch session, create `evals/fixtures/sneaky-vault/dummy.md`, `git add` it, run `sh scripts/check-fixture-privacy.sh`, confirm non-zero exit + clear error message naming `sneaky-vault`, then `git reset HEAD ...` and `rm -rf evals/fixtures/sneaky-vault`. The red-test command from VALIDATION row 00-11-02 verbatim is acceptable; capture the outcome in the SUMMARY.</action>
  <acceptance_criteria>
    - Match VALIDATION row 00-11-01: `test -x scripts/check-fixture-privacy.sh && sh scripts/check-fixture-privacy.sh` exits 0 (clean tree, allowlist of one fixture present).
    - Match VALIDATION row 00-11-02 (red-test): the maintainer/executor reproduces the staged-violation sequence and observes non-zero exit + clear stderr identifying `sneaky-vault`. Captured in SUMMARY.
    - The script contains no GNU-only flags. `! grep -qE -- '-P|--include|--exclude-dir' scripts/check-fixture-privacy.sh` exits 0.
    - Contains `ALLOW="v2-test-vault"` literal: `grep -q 'ALLOW="v2-test-vault"' scripts/check-fixture-privacy.sh`.
  </acceptance_criteria>
  <verify>
    <automated>test -x scripts/check-fixture-privacy.sh && sh scripts/check-fixture-privacy.sh && grep -q 'ALLOW="v2-test-vault"' scripts/check-fixture-privacy.sh && ! grep -qE -- '-P|--include|--exclude-dir' scripts/check-fixture-privacy.sh</automated>
  </verify>
  <done>Privacy lint passes clean-tree green; red-test confirmed non-zero on planted violation; only POSIX flags used.</done>
</task>

<task type="auto">
  <name>Task 2: Author `scripts/lint-no-telemetry.sh` (FND-12) — POSIX-portable banlist guard with escape comment</name>
  <read_first>
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Example 2 — `scripts/lint-no-telemetry.sh` complete script (verbatim adoption)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Pitfall 3 (grep portability)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-20 — banlist substrings + escape comment `// vault-memory:no-telemetry-ok`)
    - .planning/phases/00-foundation-decisions/00-VALIDATION.md rows 00-12-01 (clean-tree pass) + 00-12-02 (red-test, manual) + 00-12-03 (escape-comment suppresses match, manual)
  </read_first>
  <action>(A) Create `scripts/lint-no-telemetry.sh` per RESEARCH §Example 2 verbatim. Required elements: shebang `#!/bin/sh`; `set -eu`; banned-substring regex literal `BANNED='analytics|telemetry|posthog|segment\\.com|mixpanel|sentry|datadog|track\\(|trackEvent|report\\(|reportMetric'`; escape marker `ESCAPE='vault-memory:no-telemetry-ok'`; traversal via `find src -name '*.ts' -not -name '*.test.ts' -type f`, piped to `xargs grep -inE "$BANNED" 2>/dev/null | grep -v "$ESCAPE" || true`; non-empty result → clear stderr + `exit 1`; clean → success message naming the scanned file count. Use only POSIX-portable grep flags (`-i`, `-n`, `-E`, `-v`). Exclude `*.test.ts` from traversal (banned word references in tests/comments are OK so long as escaped). (B) `chmod +x scripts/lint-no-telemetry.sh`. (C) The script must NOT add `*.ts` files from outside `src/` (so it does not trip on the `evals/` directory or `scripts/`). (D) DO NOT run a red-test in this autonomous task — VALIDATION row 00-12-02 and 00-12-03 are explicitly Manual-Only (mutating src/** in an automated task pollutes the tree). Task 3 hands the red-test to the maintainer.</action>
  <acceptance_criteria>
    - Match VALIDATION row 00-12-01: `test -x scripts/lint-no-telemetry.sh && sh scripts/lint-no-telemetry.sh` exits 0 (clean tree — current `src/**/*.ts` contains no banlist substrings).
    - Script contains escape-comment string: `grep -q 'vault-memory:no-telemetry-ok' scripts/lint-no-telemetry.sh`.
    - Script contains banlist regex with all 11 banned substrings: `for w in analytics telemetry posthog 'segment\\.com' mixpanel sentry datadog 'track(' trackEvent 'report(' reportMetric; do grep -q "$w" scripts/lint-no-telemetry.sh || { echo "Missing banword: $w" >&2; exit 1; }; done`.
    - No GNU-only flags: `! grep -qE -- '-P|--include|--exclude-dir' scripts/lint-no-telemetry.sh`.
    - Excludes `*.test.ts`: `grep -q 'not -name' scripts/lint-no-telemetry.sh && grep -q '\\*.test.ts' scripts/lint-no-telemetry.sh`.
  </acceptance_criteria>
  <verify>
    <automated>test -x scripts/lint-no-telemetry.sh && sh scripts/lint-no-telemetry.sh && grep -q 'vault-memory:no-telemetry-ok' scripts/lint-no-telemetry.sh && grep -q 'analytics' scripts/lint-no-telemetry.sh && grep -q 'telemetry' scripts/lint-no-telemetry.sh && grep -q 'posthog' scripts/lint-no-telemetry.sh && grep -q 'sentry' scripts/lint-no-telemetry.sh && grep -q 'trackEvent' scripts/lint-no-telemetry.sh && grep -q 'reportMetric' scripts/lint-no-telemetry.sh && ! grep -qE -- '-P|--include|--exclude-dir' scripts/lint-no-telemetry.sh</automated>
  </verify>
  <done>Telemetry lint passes clean-tree green; all 11 banned substrings + escape marker present; no GNU-only flags.</done>
</task>

<task type="auto">
  <name>Task 3: Author `.github/workflows/ci.yml` — PR + push:main trigger, lint:check + test pipeline</name>
  <read_first>
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Example 3 — `ci.yml` complete workflow (verbatim adoption)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-21 — workflow runs `npm ci`, `npm run lint:check`, `npm test` on PR + push-to-main; separate from `publish.yml`)
    - .planning/phases/00-foundation-decisions/00-VALIDATION.md row 00-15-01 (verifies triggers + `lint:check` invocation)
    - .github/workflows/publish.yml (existing workflow — mirror its `setup-node@v4` cache style)
  </read_first>
  <action>Create `.github/workflows/ci.yml` per RESEARCH §Example 3 verbatim. Required elements: (a) `name: CI`; (b) `on:` block with `pull_request:` (no filters — runs on every PR) AND `push:` with `branches: [main]`; (c) a top-level `concurrency:` block with `group: ci-${{ github.workflow }}-${{ github.head_ref || github.ref }}` and `cancel-in-progress: true` (cancel previous runs on the same branch when a new push lands — matches GitHub's recommended pattern per RESEARCH); (d) `jobs.lint-and-test:` with `runs-on: ubuntu-latest`; (e) steps in order: `actions/checkout@v4` with `fetch-depth: 0` (full history needed for `git ls-tree` in `check-fixture-privacy.sh`), `actions/setup-node@v4` with `node-version: '22'` and `cache: 'npm'`, `npm ci`, `npm run lint:check`, `npm test`. Do NOT add npm publish steps (publish.yml handles tag-triggered publish). Do NOT add macOS or Windows runners — RESEARCH §Deferred Ideas notes multi-platform CI matrix is Phase 8 territory.</action>
  <acceptance_criteria>
    - Match VALIDATION row 00-15-01: `test -f .github/workflows/ci.yml && grep -qE 'pull_request:|push:' .github/workflows/ci.yml && grep -q 'lint:check' .github/workflows/ci.yml` exits 0.
    - Cancel-in-progress concurrency present: `grep -q 'cancel-in-progress: true' .github/workflows/ci.yml`.
    - `fetch-depth: 0` present (required by `check-fixture-privacy.sh`'s `git ls-tree`): `grep -q 'fetch-depth: 0' .github/workflows/ci.yml`.
    - `npm test` step present: `grep -q 'npm test' .github/workflows/ci.yml`.
    - `npm ci` precedes `npm run lint:check` in the steps order: `awk '/npm ci/{seen_ci=NR} /npm run lint:check/{if(!seen_ci||NR<=seen_ci)exit 1} END{exit 0}' .github/workflows/ci.yml`.
  </acceptance_criteria>
  <verify>
    <automated>test -f .github/workflows/ci.yml && grep -qE 'pull_request:|push:' .github/workflows/ci.yml && grep -q 'lint:check' .github/workflows/ci.yml && grep -q 'cancel-in-progress: true' .github/workflows/ci.yml && grep -q 'fetch-depth: 0' .github/workflows/ci.yml && grep -q 'npm test' .github/workflows/ci.yml</automated>
  </verify>
  <done>`ci.yml` exists with PR + push:main triggers, full-history checkout, lint:check + test steps, and cancel-in-progress concurrency.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: Maintainer manual verifications — telemetry red-test, escape-comment suppression, Alpine bake-test</name>
  <what-built>Tasks 1–3 have authored both POSIX shell lints, made them executable, and authored the CI workflow. Clean-tree green is automated; the three remaining checks require maintainer eyes-on per VALIDATION Manual-Only Verifications.</what-built>
  <how-to-verify>
    (1) **Telemetry red-test (VALIDATION row 00-12-02):** In the working tree, append `// const x = analytics();` (verbatim, with the literal word `analytics`) to the end of any file matching `src/*.ts` (e.g. `src/server.ts`). Run `sh scripts/lint-no-telemetry.sh`. Confirm: non-zero exit; stderr clearly names the offending file + line. Then `git checkout -- <file>` to revert.
    (2) **Escape-comment suppression (VALIDATION row 00-12-03):** Append `const x = "analytics_legacy_naming"; // vault-memory:no-telemetry-ok` to the end of `src/server.ts`. Run `sh scripts/lint-no-telemetry.sh`. Confirm: exit 0 — the escape marker on the same line suppressed the match. Then `git checkout -- src/server.ts` to revert.
    (3) **Alpine bake-test (POSIX portability — VALIDATION row 00-11/12 manual):** Run `docker run --rm -v "$PWD":/repo -w /repo alpine sh -c 'apk add --no-cache grep findutils git && sh scripts/check-fixture-privacy.sh && sh scripts/lint-no-telemetry.sh'`. Confirm exit 0 on clean tree (`git` install is required because `check-fixture-privacy.sh` uses `git ls-tree`).
    (4) **CI dry-run** (optional but recommended): push the PR branch and open a draft PR; confirm GitHub Actions starts `CI` workflow, runs through `npm ci → lint:check → test`, and finishes green.
  </how-to-verify>
  <acceptance_criteria>
    - Red-test (step 1) produced non-zero exit + clear error.
    - Escape-comment (step 2) produced exit 0 (suppression worked).
    - Alpine bake-test (step 3) exit 0.
    - All temp src/ mutations reverted; `git status` shows only the intended Phase 0 changes.
  </acceptance_criteria>
  <resume-signal>Reply `approved` after running all three manual verifications and confirming the CI dry-run (if performed) was green. Reply with detailed output if any step failed — that surfaces a portability bug to fix in Task 1 or Task 2.</resume-signal>
</task>

</tasks>

<verification>
- VALIDATION rows 00-11-01, 00-12-01, 00-15-01 pass automatically.
- VALIDATION rows 00-11-02, 00-12-02, 00-12-03 verified manually by Task 4 (Manual-Only per VALIDATION table).
- Alpine bake-test (Manual-Only per VALIDATION) confirms POSIX portability.
</verification>

<success_criteria>
- Both shell lints exist, are executable, are POSIX-portable, pass on clean tree.
- Escape-comment honored.
- `ci.yml` triggers on PR + push:main with `npm ci → lint:check → test` and full-history checkout.
- Alpine bake-test confirms cross-platform portability.
</success_criteria>

<output>
After completion, create `.planning/phases/00-foundation-decisions/00-12-SUMMARY.md` recording: red-test outcomes for both lints (step 1, 2), Alpine bake-test outcome (step 3), CI dry-run URL if performed (step 4), and confirmation that `git status` is clean post-verification.
</output>
