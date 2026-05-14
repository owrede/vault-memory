---
phase: 00-foundation-decisions
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - package-lock.json
  - .gitignore
  - CHANGELOG.md
autonomous: true
requirements: [FND-01]
must_haves:
  truths:
    - "`yaml` package is installed at ^2.9.0 as a runtime dependency"
    - "`npm run lint:check`, `npm run eval:baseline`, and `npm run eval:snapshot` scripts exist in package.json"
    - "`docs/dev/` is no longer ignored as a directory; the v2 brief file is still ignored individually"
    - "CHANGELOG.md has an `[Unreleased]` → `### Documentation` section seeded for v2 docs"
  artifacts:
    - path: "package.json"
      provides: "yaml dep + lint:check/eval:baseline/eval:snapshot scripts"
      contains: "yaml"
    - path: ".gitignore"
      provides: "narrow gitignore — directory-wide `docs/dev/` line removed, single-file `docs/dev/gsd-agent-knowledg-layer.md` ignore added"
    - path: "CHANGELOG.md"
      provides: "[Unreleased] Documentation section header"
  key_links:
    - from: "package.json#scripts.lint:check"
      to: "scripts/check-fixture-privacy.sh + scripts/lint-no-telemetry.sh + tsc + prettier"
      via: "shell && chain"
      pattern: "check-fixture-privacy.*lint-no-telemetry.*tsc.*prettier"
---

<objective>
Bootstrap Phase 0: install the one new runtime dependency (`yaml ^2.9.0`, pulled forward from Phase 6 per D-10), add the three new npm scripts (`lint:check`, `eval:baseline`, `eval:snapshot`), open the gate for ADR relocation by replacing the directory-wide `docs/dev/` gitignore line with a single-file ignore for the internal v2 brief, and seed the CHANGELOG `[Unreleased]` documentation section.

Purpose: every later plan depends on these scripts and the dependency. Doing this once up front means ADR PRs, eval-fixture PRs, and CI-lint PRs all assume the same baseline. The gitignore change is a hard prerequisite for the four ADR relocation PRs that follow in Waves 1–2.

Output: package.json + lockfile updated, .gitignore tightened, CHANGELOG.md seeded. No `src/` changes in this plan.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/00-foundation-decisions/00-CONTEXT.md
@.planning/phases/00-foundation-decisions/00-RESEARCH.md
@.planning/phases/00-foundation-decisions/00-VALIDATION.md
@package.json
@.gitignore
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install `yaml` runtime dependency at ^2.9.0</name>
  <read_first>
    - package.json
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-10 — YAML loader for query fixtures)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Standard Stack (verifies 2.9.0 is current)
  </read_first>
  <action>Run `npm install --save yaml@^2.9.0`. This adds `yaml` to `dependencies` (not devDependencies — it will be imported from `evals/v1-baseline/baseline.test.ts` and from later Phase 6 contract loaders). Verify the resulting `package.json` lists `yaml: ^2.9.x` under `dependencies` and that `package-lock.json` is updated. Do NOT bump any other dep (per D-10 / CONTEXT — vitest stays on 2.1.8, MCP SDK stays on 1.0.4; Phase 1 owns those bumps). Per RESEARCH Assumption A7, do not attempt to upgrade vitest.</action>
  <acceptance_criteria>
    - `node -e "const p=require('./package.json'); if(!p.dependencies.yaml||!/^\\^2\\.[9-9]/.test(p.dependencies.yaml))process.exit(1)"` exits 0.
    - `package-lock.json` exists and contains a `node_modules/yaml` entry.
    - No other dependency version in `package.json` changed (run `git diff package.json` — the only added line under `dependencies` is `yaml`).
  </acceptance_criteria>
  <verify>
    <automated>node -e "const p=require('./package.json'); if(!p.dependencies.yaml||!/^\^2\./.test(p.dependencies.yaml))process.exit(1)"</automated>
  </verify>
  <done>`yaml ^2.9.x` is in package.json#dependencies; package-lock.json updated; no other deps moved.</done>
</task>

<task type="auto">
  <name>Task 2: Add `lint:check`, `eval:baseline`, `eval:snapshot` npm scripts</name>
  <read_first>
    - package.json (existing scripts block at lines 22–30)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Example 4 — verbatim shape for `lint:check`
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-21 — lint:check must run both shell lints + tsc + prettier)
  </read_first>
  <action>Edit `package.json#scripts` to add three new entries. (a) `lint:check` MUST chain (in this order, joined by `&&`): `sh scripts/check-fixture-privacy.sh`, `sh scripts/lint-no-telemetry.sh`, `tsc --noEmit`, `prettier --check "src/**/*.ts"`. The shell scripts do not yet exist — that is fine; they ship in plan 12. Until they exist, `lint:check` will fail loudly, which is correct (the gate is real). (b) `eval:baseline`: `vitest run evals/v1-baseline/baseline.test.ts`. (c) `eval:snapshot`: `node evals/v1-baseline/dump-tools.mjs > evals/v1-baseline/tools-list.snapshot.json`. Do NOT modify the existing `test` script — plan 11 weaves baseline into the default vitest run via vitest's default glob picking up `evals/**/*.test.ts`; no script wiring needed.</action>
  <acceptance_criteria>
    - Match VALIDATION row 00-16-01: `node -e 'const p=require("./package.json");if(!/check-fixture-privacy/.test(p.scripts["lint:check"])||!/lint-no-telemetry/.test(p.scripts["lint:check"])||!/tsc/.test(p.scripts["lint:check"])||!/prettier/.test(p.scripts["lint:check"]))process.exit(1)'` exits 0.
    - `node -p "require('./package.json').scripts['eval:baseline']"` prints a non-empty string containing `vitest run evals/v1-baseline/baseline.test.ts`.
    - `node -p "require('./package.json').scripts['eval:snapshot']"` prints a non-empty string containing both `dump-tools.mjs` and `tools-list.snapshot.json`.
  </acceptance_criteria>
  <verify>
    <automated>node -e 'const p=require("./package.json");if(!/check-fixture-privacy/.test(p.scripts["lint:check"])||!/lint-no-telemetry/.test(p.scripts["lint:check"])||!/tsc/.test(p.scripts["lint:check"])||!/prettier/.test(p.scripts["lint:check"]))process.exit(1)'</automated>
  </verify>
  <done>Three new scripts exist with the documented shape; existing scripts untouched.</done>
</task>

<task type="auto">
  <name>Task 3: Replace directory-wide `docs/dev/` gitignore with single-file ignore</name>
  <read_first>
    - .gitignore (line 16 — current `docs/dev/` entry)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-01 — relocation enabler; Claude's Discretion §`docs/optimization-todos/` stays ignored)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Runtime State Inventory + §Open Question 2 (the v2 brief stays internal)
  </read_first>
  <action>Edit `.gitignore`: (a) delete line 16 `docs/dev/`. (b) Keep line 15 `docs/optimization-todos/` untouched per CONTEXT Claude's Discretion. (c) Add a new line: `docs/dev/gsd-agent-knowledg-layer.md` — this keeps the internal v2 brief private while opening `docs/dev/00X-*.md` for the upcoming `git mv` operation. Do NOT touch any other line. Preserve the existing comment block `# Internal roadmap notes — kept locally...` above `docs/optimization-todos/`.</action>
  <acceptance_criteria>
    - Match VALIDATION row 00-01-02 (negated form): `! grep -qE '^docs/dev/$' .gitignore` exits 0 (line removed).
    - `grep -q '^docs/dev/gsd-agent-knowledg-layer.md$' .gitignore` exits 0 (narrow line present).
    - `grep -q '^docs/optimization-todos/$' .gitignore` exits 0 (existing line untouched).
    - `git check-ignore docs/dev/001-document-identity.md` exits non-zero (file NO LONGER ignored — relocatable in Wave 1+2).
    - `git check-ignore docs/dev/gsd-agent-knowledg-layer.md` exits 0 (still ignored).
  </acceptance_criteria>
  <verify>
    <automated>! grep -qE '^docs/dev/$' .gitignore && grep -q '^docs/dev/gsd-agent-knowledg-layer.md$' .gitignore && ! git check-ignore docs/dev/001-document-identity.md</automated>
  </verify>
  <done>Directory-wide ignore removed; v2 brief still private; ADR files are now reachable by `git add`/`git mv`.</done>
</task>

<task type="auto">
  <name>Task 4: Seed `[Unreleased] → ### Documentation` section in CHANGELOG.md</name>
  <read_first>
    - CHANGELOG.md (existing structure — read the top section to learn the version-header format used by `publish.yml`)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (Claude's Discretion §"Whether to add a Phase 0 CHANGELOG entry — yes, under [Unreleased] → ### Documentation")
    - .github/workflows/publish.yml lines 73–88 (the awk script that scans for `## [X.Y.Z]` headings — confirm `[Unreleased]` does not conflict)
  </read_first>
  <action>Append (or insert at the top above any existing `## [X.Y.Z]` heading, AFTER the file's title and any `# Changelog` header): a new section starting with `## [Unreleased]`, then a sub-header `### Documentation`, then a single bullet placeholder: `- Begin v2 documentation track under \`docs/v2/\` (Phase 0 of v2 roadmap). See \`docs/v2/SIGN-OFF.md\` once Phase 0 ships.` Do NOT bump the package.json version (per CONTEXT Claude's Discretion — version stays 1.0.0; v2.0.0 ships at Phase 8). If CHANGELOG.md does not exist, create it with header `# Changelog` plus the new section. Verify the awk script in `publish.yml` would not accidentally match `[Unreleased]` as a version (it would not — the awk pattern requires `\\[` + a numeric version).</action>
  <acceptance_criteria>
    - `grep -q '^## \\[Unreleased\\]' CHANGELOG.md` exits 0.
    - `grep -q '^### Documentation' CHANGELOG.md` exits 0.
    - `grep -q 'docs/v2/SIGN-OFF.md' CHANGELOG.md` exits 0.
    - `node -p "require('./package.json').version"` still prints `1.0.0`.
  </acceptance_criteria>
  <verify>
    <automated>grep -q '^## \[Unreleased\]' CHANGELOG.md && grep -q '^### Documentation' CHANGELOG.md && [ "$(node -p "require('./package.json').version")" = "1.0.0" ]</automated>
  </verify>
  <done>CHANGELOG seeded; v2 doc work has a landing zone; version unchanged.</done>
</task>

</tasks>

<verification>
After this plan: `npm install` succeeds, `node -p "require('./package.json').dependencies.yaml"` prints `^2.9.x`, `git check-ignore docs/dev/001-document-identity.md` exits non-zero, CHANGELOG has `[Unreleased] → ### Documentation`.
</verification>

<success_criteria>
- `yaml` dep installed; npm scripts staged; gitignore prepared for ADR relocation; CHANGELOG seeded.
- No `src/` changes. No new files outside repo root + CHANGELOG.
- Plans 02–05 can now `git mv docs/dev/00X-*.md docs/v2/adr/...` without `git add` rejection.
</success_criteria>

<output>
After completion, create `.planning/phases/00-foundation-decisions/00-01-SUMMARY.md` describing the dependency, scripts, gitignore tweak, and CHANGELOG seed.
</output>
