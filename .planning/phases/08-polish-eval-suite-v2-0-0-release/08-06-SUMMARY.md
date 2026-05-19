---
phase: 08-polish-eval-suite-v2-0-0-release
plan: 06
subsystem: infra
tags: [release, ci, github-actions, npm-publish, changelog, plugin-tarball]

# Dependency graph
requires:
  - phase: 08-01
    provides: "Phase 8 research + patterns (Group E/F/K anchors)"
  - phase: 08-05
    provides: "REL-08 Resource promotions (post-merge HEAD baseline)"
provides:
  - "scripts/release.mjs single-script release ritual (REL-06 / D-17)"
  - "CONTRIBUTING.md with Cut-a-release recipe + merge-gate-no-override policy (REL-01 / D-06)"
  - ".github/workflows/publish.yml extended to build plugin tarball + manifest.sha256 + attach as Release assets (Phase-7 carryover plan 07-11 / D-15)"
affects: [08-07, 08-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ESM Node script with 6-phase fail-fast structure + clear stderr error messages"
    - "Atomic git push --follow-tags (no force-push, no skip-tests)"
    - "softprops/action-gh-release@v2 `files:` multi-line literal for Release-asset attach"

key-files:
  created:
    - scripts/release.mjs
    - CONTRIBUTING.md
    - .planning/phases/08-polish-eval-suite-v2-0-0-release/08-06-SUMMARY.md
  modified:
    - package.json (added `release` script entry)
    - .github/workflows/publish.yml (added plugin-tarball build + manifest.sha256 + files: param)

key-decisions:
  - "release.mjs requires explicit version arg (no auto-derive from package.json) — releases are rare; explicit is safer"
  - "CHANGELOG renamed heading uses em-dash U+2014 to match existing file format and publish.yml awk extractor (Pitfall 2)"
  - "No --skip-tests escape hatch — a red local test predicts red CI; refusing to ship is the correct posture"
  - "Plugin tarball production build uses `node esbuild.config.mjs production` (matches plugin/package.json `build` script — note the `production` flag is important; without it esbuild runs in watch mode)"
  - "MP4 screencast intentionally NOT in workflow files: param — uploaded manually post-workflow via GitHub Release UI (D-14 / RESEARCH Open Q2)"
  - "Set `set -euo pipefail` at top of bash blocks in publish.yml to fail-fast on any tarball/shasum step error"

patterns-established:
  - "Pattern E (release script): JSDoc header → numbered phases → fail() helper → capture()/run() helpers → linear top-to-bottom flow; matches scripts/smoketest-non-claude.mjs style"
  - "Pattern F (publish.yml extension): insert build steps BEFORE softprops/action-gh-release; pass artifacts via GITHUB_ENV + softprops files: param"
  - "Pattern K (CONTRIBUTING.md): terse technical voice; two H2 sections (Cut a release + Eval merge gate); no marketing"

requirements-completed: [REL-01, REL-06]

# Metrics
duration: 6min
completed: 2026-05-19
---

# Phase 8 Plan 06: Release Infrastructure Summary

**`npm run release X.Y.Z` cuts the tag end-to-end (pre-flight gates + npm test + version bump + CHANGELOG rename + atomic push); publish.yml builds and attaches the plugin tarball + checksum as Release assets; CONTRIBUTING.md documents the recipe and the no-override eval gate.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-19T14:52:38Z
- **Completed:** 2026-05-19T14:58:35Z
- **Tasks:** 5 (Task 2 was verification-only with no file diffs; Task 5 was a CI sweep with no file diffs)
- **Files created:** 2 (`scripts/release.mjs`, `CONTRIBUTING.md`)
- **Files modified:** 2 (`package.json`, `.github/workflows/publish.yml`)

## Accomplishments

- **Single-script release ritual (REL-06 / D-17)** — `scripts/release.mjs` (242 lines) implements 6 phases: pre-flight (semver + clean tree + on-main + non-empty Unreleased), `npm test` gate, `npm version --no-git-tag-version`, CHANGELOG rename to `## [X.Y.Z] — YYYY-MM-DD`, commit + annotated tag + atomic `git push --follow-tags`, and a stderr confirmation message naming the next manual step (MP4 upload).
- **Eval-gate documentation (REL-01 / D-06)** — `CONTRIBUTING.md` (50 lines) declares the `lint-and-test` status check as a hard merge gate with no `[skip eval]` override and names the 4 sub-checks. Cross-references plan 08-07 for the actual branch-protection setup.
- **Plugin-tarball Release-asset attach (Phase 7 carryover, plan 07-11 / D-15)** — `.github/workflows/publish.yml` gained two new steps before the `softprops/action-gh-release@v2` step: "Build plugin tarball" (runs `npm ci` + `node esbuild.config.mjs production` in `plugin/`, archives to `vault-memory-plugin-vX.Y.Z.tar.gz`) and "Generate manifest.sha256". The softprops step now carries a `files:` multi-line literal attaching both assets. MP4 deliberately excluded — manual upload per D-14.

## Task Commits

1. **Task 1: Author scripts/release.mjs** — `440104d` (feat) — 242-line ESM Node script + `release` package.json script entry. Pre-flight gates verified mechanically (missing arg / invalid semver / dirty tree all exit 1 with clear stderr).
2. **Task 2: Smoke-test the release script** — no commit (verification-only, no file changes). All 4 pre-flight gates exercised (see "Smoke-test Log" below). Tree clean post-test.
3. **Task 3: Author CONTRIBUTING.md** — `a683d19` (docs) — 50 lines, two H2 sections matching PATTERNS Group K shape.
4. **Task 4: Extend publish.yml** — `1d7ccc6` (ci) — +31 lines: 2 new build steps + `files:` literal on the softprops step. YAML parses clean (python yaml).
5. **Task 5: Full test sweep** — no commit (verification-only). See "CI Sweep Log" below.

## Smoke-test Log (Task 2)

| Gate | Trigger | Result |
| --- | --- | --- |
| 1a — missing arg | `node scripts/release.mjs` (no args) | exit 1; stderr: `error: missing version argument.` + usage block |
| 1a — invalid semver | `node scripts/release.mjs foo.bar.baz` | exit 1; stderr: `error: version "foo.bar.baz" is not a valid semver string.` |
| 1b — dirty tree | clean tree polluted by appending newline to CHANGELOG.md, then re-run | exit 1; stderr: `error: working tree is dirty — commit or stash first.` + list of dirty files. State restored via `git checkout -- CHANGELOG.md`. |
| 1c — non-main branch | clean tree on `worktree-agent-ad854e8863940e6d0` (this worktree) | exit 1; stderr: `error: not on main branch (currently: worktree-agent-ad854e8863940e6d0).` |
| 1d — empty Unreleased | unit-tested via inline Node REPL against a synthetic `## [Unreleased]\n\n_Nothing yet._\n\n## [1.0.0] — ...` fixture | body-length-strip-then-trim returned 0; gate would fire (the live CHANGELOG has 47 KB of Phase 2–7 content so the gate is dormant) |

Tree state post-smoketest: `git status --porcelain` → 0 lines. No test tags created. No pushes attempted.

## CI Sweep Log (Task 5)

| Step | Result |
| --- | --- |
| `npm run lint:check` | **Fail** — pre-existing Phase-7 carryover I-2 violation in `src/plugin-tools/set-mcp-client.ts:33` (`import { readFile, writeFile } from "node:fs/promises"`). Documented in `.planning/phases/08-polish-eval-suite-v2-0-0-release/deferred-items.md`; per the prompt instruction NOT to fix it, out-of-scope for plan 08-06. All other lint sub-checks green. |
| `npm test` | **Pass** — 1661/1672 tests passed (11 skipped, 135 test files). Duration ~32s. |
| `npm run eval:baseline` | **Pass** — 34/45 (11 skipped). 1 file. ~200ms. |
| `npm run build` | **Pass** — `dist/cli.js` 556.69 KB, build success in 50ms. |
| `node scripts/smoketest-non-claude.mjs` | **Pass** — all 37 tools + 10 Resources surfaced; Phase 6 contract tools, REL-08 deprecation annotations, Phase 2 memory Resources all asserted green. |

## Files Created/Modified

- `scripts/release.mjs` (created, 242 lines) — single-script release ritual
- `CONTRIBUTING.md` (created, 50 lines) — Cut-a-release recipe + eval-gate policy
- `package.json` (modified, +1 line) — added `"release": "node scripts/release.mjs"` script entry
- `.github/workflows/publish.yml` (modified, +31 lines) — plugin-tarball build + manifest.sha256 + softprops `files:` param

## Decisions Made

- **Explicit version arg (no auto-derive)** — `release.mjs` errors out if `argv[2]` is missing rather than reading `package.json` and incrementing. Reason: releases are rare and a botched release is expensive; "type the version you intend to ship" is the safer ergonomic.
- **Em-dash (U+2014) in CHANGELOG heading** — explicitly preserved to match the existing file format and the awk extractor at `publish.yml:76`. Hard-coded as a const at the top of the script.
- **No `--skip-tests` flag** — there is none and there never will be (documented in the script header). A red local test predicts a red CI.
- **Production esbuild flag** — `plugin/package.json` has `"build": "node esbuild.config.mjs production"`; the bare `node esbuild.config.mjs` shape from the planner's PATTERNS sketch would run esbuild in watch mode (esbuild `context()` + no `.dispose()` would hang the CI step). Used the `production` flag to match plugin's own build script.
- **`set -euo pipefail` in workflow bash blocks** — added to fail-fast on any individual command in the tarball/shasum steps. Bash defaults would otherwise let a `tar` failure pass silently before the `echo "TARBALL=..."`.
- **MP4 NOT in files:** — explicitly per RESEARCH Open Q2 / D-14. Documented inline as a comment in the workflow + in CONTRIBUTING.md.

## Deviations from Plan

None. The plan was executed exactly as written.

**One scoped non-fix:** the `lint:check` step in Task 5 surfaced a pre-existing Phase-7 I-2 adapter-seam violation in `src/plugin-tools/set-mcp-client.ts:33`. The prompt explicitly directed "do not try to fix it" and the file `.planning/phases/08-polish-eval-suite-v2-0-0-release/deferred-items.md` documents it. Per the scope-boundary rule, this is out-of-scope for plan 08-06.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. The release script runs locally on the maintainer's machine; the workflow runs on GitHub-hosted runners with the existing `NPM_TOKEN` repo secret.

## Self-Check: PASSED

- ✓ `scripts/release.mjs` exists (242 lines), `node --check` succeeds
- ✓ `CONTRIBUTING.md` exists (50 lines), contains `npm run release` + `lint-and-test` + no-skip-eval-override statement
- ✓ `.github/workflows/publish.yml` contains `vault-memory-plugin` + `manifest.sha256` + `files:` + YAML parses clean
- ✓ `package.json` has `"release": "node scripts/release.mjs"` entry
- ✓ Commits exist: `440104d` (Task 1), `a683d19` (Task 3), `1d7ccc6` (Task 4)
- ✓ Working tree clean after all tasks (`git status --porcelain` → 0 lines)
- ✓ All 5 CI-sweep sub-steps green except the documented pre-existing I-2 lint violation

## Next Phase Readiness

- Plan 08-07 consumes this infrastructure: it will land the GitHub branch-protection ruleset that points at the `lint-and-test` status check named in CONTRIBUTING.md.
- Plan 08-08 (live v2.0.0 cut) consumes this infrastructure: the maintainer will run `npm run release 2.0.0` on a clean `main` checkout to invoke the script that landed in this plan.
- No blockers.

---
*Phase: 08-polish-eval-suite-v2-0-0-release*
*Completed: 2026-05-19*
