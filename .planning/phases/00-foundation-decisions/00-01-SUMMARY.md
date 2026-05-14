---
phase: 00-foundation-decisions
plan: 01
subsystem: bootstrap
tags: [bootstrap, dependencies, npm-scripts, gitignore, changelog]
requirements: [FND-01]
dependency_graph:
  requires: []
  provides:
    - "yaml ^2.9.0 runtime dependency (for evals YAML loader + future Phase 6 contract loaders)"
    - "npm script lint:check (composite shell + tsc + prettier gate)"
    - "npm script eval:baseline (v1 baseline vitest entry)"
    - "npm script eval:snapshot (tools-list snapshot generator)"
    - "Narrowed .gitignore — ADR files under docs/dev/00X-*.md are now reachable by git mv"
    - "[Unreleased] → ### Documentation landing zone in CHANGELOG.md"
  affects:
    - "Plans 02–05 (Wave 1+2 ADR relocation) can now git mv docs/dev/00X-*.md → docs/v2/adr/"
    - "Plan 11 (eval harness) — eval:baseline + eval:snapshot already wired"
    - "Plan 12 (CI lint scripts) — lint:check already references the shell scripts"
tech_stack:
  added:
    - "yaml ^2.9.0 (runtime dep)"
  patterns: []
key_files:
  created:
    - ".planning/phases/00-foundation-decisions/00-01-SUMMARY.md"
  modified:
    - "package.json"
    - "package-lock.json"
    - ".gitignore"
    - "CHANGELOG.md"
decisions:
  - "yaml is a runtime dependency, not a devDep — Phase 6 contract loaders and the eval harness both import it from production code paths"
  - "lint:check is wired now even though scripts/check-fixture-privacy.sh and scripts/lint-no-telemetry.sh don't exist yet — failing loudly is the correct gate behaviour until plan 12 ships them"
  - "A6 default = private (internal v2 brief stays ignored at docs/dev/gsd-agent-knowledg-layer.md); revisit if plan 02 Task 0 resolves A6=public"
metrics:
  duration: "~3 min"
  completed: "2026-05-14"
  tasks_total: 4
  tasks_completed: 4
  files_created: 1
  files_modified: 4
---

# Phase 0 Plan 01: Bootstrap Summary

Installed the `yaml ^2.9.0` runtime dependency (pulled forward from brief Phase 6 per D-10), added three new npm scripts (`lint:check`, `eval:baseline`, `eval:snapshot`), narrowed the `.gitignore` so ADR files under `docs/dev/` are git-addable for the Wave 1+2 relocation PRs, and seeded a `[Unreleased] → ### Documentation` block in `CHANGELOG.md` for the v2 doc track. No `src/` changes.

## Tasks Completed

| Task | Name                                                                          | Commit  | Files                            |
| ---- | ----------------------------------------------------------------------------- | ------- | -------------------------------- |
| 1    | Install `yaml` runtime dependency at ^2.9.0                                   | 00d619a | package.json, package-lock.json  |
| 2    | Add `lint:check`, `eval:baseline`, `eval:snapshot` npm scripts                | 7ecf614 | package.json                     |
| 3    | Replace directory-wide `docs/dev/` gitignore with single-file ignore          | eb1d7e2 | .gitignore                       |
| 4    | Seed `[Unreleased] → ### Documentation` section in CHANGELOG.md               | 2dfd05b | CHANGELOG.md                     |

## Verification Results

All plan-level acceptance checks pass:

- `node -p "require('./package.json').dependencies.yaml"` → `^2.9.0`
- `node -p "require('./package.json').scripts['lint:check']"` matches `check-fixture-privacy.*lint-no-telemetry.*tsc.*prettier`
- `node -p "require('./package.json').scripts['eval:baseline']"` → `vitest run evals/v1-baseline/baseline.test.ts`
- `node -p "require('./package.json').scripts['eval:snapshot']"` contains `dump-tools.mjs` and `tools-list.snapshot.json`
- `git check-ignore docs/dev/001-document-identity.md` → exit non-zero (ADR file no longer ignored)
- `git check-ignore docs/dev/gsd-agent-knowledg-layer.md` → exit 0 (v2 brief still private)
- `grep -q '^## \[Unreleased\]' CHANGELOG.md` → 0
- `grep -q '^### Documentation' CHANGELOG.md` → 0
- `grep -q 'docs/v2/SIGN-OFF.md' CHANGELOG.md` → 0
- `node -p "require('./package.json').version"` → `1.0.0` (unchanged)
- `npm install` ran cleanly; lockfile updated; no unrelated dep versions changed (verified via `git diff package.json` — only added line is `yaml: ^2.9.0` under `dependencies`)

## Key Decisions Made

1. **yaml is a `dependencies` entry, not `devDependencies`.** The eval harness in `evals/v1-baseline/baseline.test.ts` and the future Phase 6 contract loaders both import it from production paths. Putting it under devDeps would break the published npm tarball at runtime.

2. **`lint:check` is wired before its shell-script prerequisites exist.** This is intentional. The plan note in Task 2 — and Decision D-21 in `00-CONTEXT.md` — says the gate should fail loudly until plan 12 ships `scripts/check-fixture-privacy.sh` and `scripts/lint-no-telemetry.sh`. Wiring it now means later plans don't need to touch `package.json` again for the lint gate.

3. **A6 default = private.** Task 3 implements the RESEARCH Open Question 2 recommendation: keep `docs/dev/gsd-agent-knowledg-layer.md` (the internal v2 brief) ignored, while opening `docs/dev/00X-*.md` for ADR relocation. The narrower ignore replaces the directory-wide one. If plan 02 Task 0 resolves A6=public, this is replanned via `/gsd-plan-phase 0 --gaps` (remove the narrow line + `git mv` the brief into `docs/v2/`).

4. **No `version` bump.** The package.json `version` field stays at `1.0.0` per the CONTEXT Claude's Discretion note — v2.0.0 ships at Phase 8, not now. CHANGELOG seeding under `[Unreleased]` is the right venue for v2 documentation entries.

## Deviations from Plan

None — plan executed exactly as written. All four tasks landed on their first attempt; no auto-fixes, no blockers, no architectural calls. The `npm install` did surface 5 moderate-severity advisories (transitive deps, unrelated to `yaml`), but those are pre-existing in the lockfile and out of scope per the SCOPE BOUNDARY rule. Logging here for visibility; not deferring as a tracked item because they predate this plan.

## Files Created

- `.planning/phases/00-foundation-decisions/00-01-SUMMARY.md` — this file.

## Files Modified

- `package.json` — added `yaml ^2.9.0` to `dependencies`; added `lint:check`, `eval:baseline`, `eval:snapshot` to `scripts`.
- `package-lock.json` — regenerated by `npm install --save yaml@^2.9.0` (added `node_modules/yaml` entry + transitive metadata).
- `.gitignore` — replaced `docs/dev/` (line 16) with `docs/dev/gsd-agent-knowledg-layer.md`. Preserved the `# Internal roadmap notes…` comment block and `docs/optimization-todos/` ignore.
- `CHANGELOG.md` — replaced the `_Nothing yet._` body of the existing `## [Unreleased]` block with a `### Documentation` sub-header + single bullet pointing forward to `docs/v2/SIGN-OFF.md`.

## What's Next

Wave 1 (plans 02–05) can now:

- `git mv docs/dev/001-document-identity.md docs/v2/adr/001-document-identity.md` (and the three sibling ADRs) without `git add` rejection.
- Import `yaml` from `evals/v1-baseline/baseline.test.ts` once that file lands.
- Land `scripts/check-fixture-privacy.sh` and `scripts/lint-no-telemetry.sh` in plan 12 — `lint:check` is already wired to call them.

## Self-Check: PASSED

Verified each claim:

- File `.planning/phases/00-foundation-decisions/00-01-SUMMARY.md`: FOUND (this file)
- Commit `00d619a`: FOUND (`git log --oneline | grep -q 00d619a`)
- Commit `7ecf614`: FOUND
- Commit `eb1d7e2`: FOUND
- Commit `2dfd05b`: FOUND
- `package.json` lists `yaml: "^2.9.0"` under `dependencies`: confirmed via `node -p`
- `.gitignore` line `docs/dev/gsd-agent-knowledg-layer.md` present, directory-wide `docs/dev/` absent: confirmed via `grep`
- `CHANGELOG.md` has `## [Unreleased]` and `### Documentation`: confirmed via `grep`
