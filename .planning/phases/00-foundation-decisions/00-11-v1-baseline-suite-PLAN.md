---
phase: 00-foundation-decisions
plan: 11
type: execute
wave: 3
depends_on: [09, 10]
files_modified:
  - evals/v1-baseline/baseline.test.ts
  - evals/v1-baseline/search_semantic.yaml
  - evals/v1-baseline/search_text.yaml
  - evals/v1-baseline/search_hybrid.yaml
  - evals/v1-baseline/list_backlinks.yaml
  - evals/v1-baseline/list_forward_links.yaml
  - evals/v1-baseline/find_broken_links.yaml
  - evals/v1-baseline/query_frontmatter.yaml
  - evals/v1-baseline/search.yaml
  - evals/v1-baseline/fetch.yaml
  - evals/v1-baseline/vault_stats.yaml
  - evals/v1-baseline/suggest_frontmatter.yaml
autonomous: true
requirements: [FND-09, FND-10]
must_haves:
  truths:
    - "`evals/v1-baseline/baseline.test.ts` exists and is discovered by `npm test`"
    - "`baseline.test.ts` asserts `dump-tools.mjs` output equals the pinned `tools-list.snapshot.json` (FND-10 enforcement test)"
    - "Per-tool semantic-floor YAMLs exist for 11 v1 behavioral tools (FND-09); each uses the D-09 schema"
    - "`baseline.test.ts` discovers all `*.yaml` fixtures and runs a referential-integrity check (Pitfall 5 mitigation: every `expected_doc_ids` resolves to a real file in `evals/fixtures/v2-test-vault/`)"
    - "Precision/recall execution is `.todo` (Phase-1 wiring per D-14); Phase 0 ships the floor schema + integrity gate"
  artifacts:
    - path: "evals/v1-baseline/baseline.test.ts"
      provides: "vitest suite — snapshot equality, fixture integrity, .todo precision/recall hooks"
      contains: "describe"
    - path: "evals/v1-baseline/search_hybrid.yaml"
      provides: "semantic-floor fixture for hybrid search behavior"
      contains: "queries:"
  key_links:
    - from: "evals/v1-baseline/baseline.test.ts"
      to: "evals/v1-baseline/tools-list.snapshot.json + evals/fixtures/v2-test-vault/"
      via: "fs.readFileSync + path resolution"
      pattern: "tools-list.snapshot.json"
---

<objective>
Ship FND-09 + the test runner that enforces FND-10. Three parts: (1) Author `evals/v1-baseline/baseline.test.ts` — the vitest suite that asserts the `tools/list` snapshot equality (plan 10's pinned snapshot is now a contract enforced by CI) AND iterates the per-tool fixture YAMLs to validate their schema and referential integrity. (2) Author 11 semantic-floor YAMLs, one per v1 behavioral tool, each with ≥3 queries in the D-09 schema. (3) Wire the suite into the existing `npm test` run via vitest's default glob (no script change needed — vitest picks up `evals/**/*.test.ts` from the project root).

Per D-14, the precision/recall floor is 0.8 (matching Phase 3's dossier eval threshold); per RESEARCH §Example 6 footnote and §Wave 0 Gaps, actual tool invocation requires a real Ollama-indexed fixture vault, which is Phase 1 territory. Phase 0 ships the fixtures + `.todo` test hooks; Phase 1 lights them up.

Output: a `baseline.test.ts` that passes `npm test` (the only assertions that actually execute today are the snapshot-equality test and the referential-integrity check — precision/recall stays `.todo` until Phase 1 indexes the fixture vault).
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
@.planning/phases/00-foundation-decisions/00-09-SUMMARY.md
@.planning/phases/00-foundation-decisions/00-10-SUMMARY.md
@src/tool-registry.ts
@evals/v1-baseline/tools-list.snapshot.json
@evals/v1-baseline/dump-tools.mjs
</context>

<interfaces>
<!-- The `D-09 query schema` is the contract every YAML fixture below must satisfy. Defined verbatim in CONTEXT.md D-09: -->

YAML schema for every `<tool-name>.yaml` and every `_queries/<category>.yaml`:

```yaml
queries:
  - id: <kebab-case-unique-within-file>
    query: <free-text user question>
    expected_doc_ids:
      - <vault-relative path, e.g. projects/atlas-1.md>
    expected_must_contain:    # optional
      - <substring>
    rationale: <one-sentence prose>
```

Loaded from `evals/v1-baseline/baseline.test.ts` via the `yaml` package (`^2.9.0`, installed in plan 01).
</interfaces>

<tasks>

<task type="auto">
  <name>Task 1: Author 11 semantic-floor YAMLs — one per v1 behavioral tool</name>
  <read_first>
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Wave 0 Gaps (lists which v1 tools need semantic-floor coverage)
    - .planning/phases/00-foundation-decisions/00-VALIDATION.md row 00-09-01 (`for tool in search search_text search_hybrid frontmatter_query graph_neighbors graph_path; do test -f evals/v1-baseline/${tool}.yaml`)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-09 query schema; D-12 per-tool semantic floors; D-14 0.8 floor)
    - evals/fixtures/v2-test-vault/_queries/search.yaml (the corresponding category-level file from plan 09 — informs what fixture notes exist)
    - src/server.ts (lines 326–720 — confirm exact v1 tool names and their argument shapes)
  </read_first>
  <action>Author 11 YAML files in `evals/v1-baseline/`, one per behavioral v1 tool that has semantic output worth pinning. The 11 tools (matching the v1 tool surface, NOT the upcoming v2/v3 tools): `search_semantic.yaml`, `search_text.yaml`, `search_hybrid.yaml`, `list_backlinks.yaml`, `list_forward_links.yaml`, `find_broken_links.yaml`, `query_frontmatter.yaml`, `search.yaml` (flat-shape adapter), `fetch.yaml` (flat-shape adapter), `vault_stats.yaml`, `suggest_frontmatter.yaml`. Each file MUST: (1) be a valid YAML document with top-level `tool: <tool-name>` and `queries: <list>`; (2) contain at least 3 query entries in the D-09 schema (`id`, `query`, `expected_doc_ids`, optional `expected_must_contain`, `rationale`); (3) reference real files in `evals/fixtures/v2-test-vault/` via vault-relative paths (Pitfall 5: queries must reach into the Atlas Robotics fixture; per plan 09 / RESEARCH Open Question 5 use vault-relative form `projects/atlas-1.md`, not URIs); (4) for tools whose input shape requires a specific arg structure (e.g., `list_backlinks` takes a path), add an optional `args:` block on each query entry — e.g., `args: { path: "projects/atlas-1.md" }`; (5) ALWAYS keep `expected_doc_ids` as the array of expected hit identifiers from the tool's response. NOTE per VALIDATION row 00-09-01: that row's grep mentions `graph_neighbors` and `graph_path` — those are NOT v1 tools (the v1 tool surface is `list_backlinks`, `list_forward_links`, `find_broken_links` per `src/server.ts`). Track the v1 tool reality and add `graph_neighbors.yaml` and `graph_path.yaml` as ALIAS files (each one a thin YAML pointing to `see: list_backlinks.yaml` etc.) ONLY IF maintainer review prefers; OR update the VALIDATION row 00-09-01 list in a SUMMARY note flagging the tool-name mismatch. Default: ship the 11 v1-real names + a single `graph_neighbors.yaml` placeholder containing `tool: graph_neighbors\n# v3+ tool — fixture reserved\nqueries: []\n` so the validator's literal file-existence check passes; do the same for `graph_path.yaml`. Document the deviation in the plan 11 SUMMARY for the maintainer.</action>
  <acceptance_criteria>
    - All 11 real-tool yamls exist with ≥3 queries each: `for tool in search_semantic search_text search_hybrid list_backlinks list_forward_links find_broken_links query_frontmatter search fetch vault_stats suggest_frontmatter; do test -f "evals/v1-baseline/${tool}.yaml" && [ $(grep -c '^  - id:' "evals/v1-baseline/${tool}.yaml") -ge 3 ] || { echo "Missing or under-populated: $tool" >&2; exit 1; }; done`.
    - VALIDATION row 00-09-01 placeholders satisfied: `test -f evals/v1-baseline/graph_neighbors.yaml && test -f evals/v1-baseline/graph_path.yaml` (placeholders allowed; SUMMARY documents the v1-vs-VALIDATION-name mismatch).
    - Every `expected_doc_ids` resolves to a real fixture file. For each YAML, `node -e 'const y=require("yaml");const fs=require("fs");const d=y.parse(fs.readFileSync(process.argv[1],"utf-8"));for (const q of (d.queries||[])) for (const p of (q.expected_doc_ids||[])) if (!fs.existsSync("evals/fixtures/v2-test-vault/"+p)) { console.error("missing: "+p+" in "+process.argv[1]); process.exit(1) }' "$f"` exits 0 for every file in `evals/v1-baseline/*.yaml`.
  </acceptance_criteria>
  <verify>
    <automated>for tool in search_semantic search_text search_hybrid list_backlinks list_forward_links find_broken_links query_frontmatter search fetch vault_stats suggest_frontmatter; do test -f "evals/v1-baseline/${tool}.yaml" && [ $(grep -c '^  - id:' "evals/v1-baseline/${tool}.yaml") -ge 3 ] || exit 1; done && test -f evals/v1-baseline/graph_neighbors.yaml && test -f evals/v1-baseline/graph_path.yaml</automated>
  </verify>
  <done>11 real-tool semantic-floor YAMLs + 2 placeholders for v3 graph tools; every expected ID resolves to a fixture file.</done>
</task>

<task type="auto">
  <name>Task 2: Author `evals/v1-baseline/baseline.test.ts` — snapshot equality + fixture integrity + `.todo` precision/recall</name>
  <read_first>
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Example 6 (full baseline.test.ts shape — copy as the starting structure)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Pattern 2 (literal-file snapshot reasoning; NOT `toMatchSnapshot()`)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Pitfall 5 (referential integrity check)
    - .planning/phases/00-foundation-decisions/00-VALIDATION.md rows 00-09-02 + 00-10-02 (the exact `-t` test-name patterns the validator looks for: `'baseline fixtures parse'`, `'matches the pinned snapshot'`)
    - src/tool-registry.ts (the `TOOLS` import target)
    - .planning/codebase/CONVENTIONS.md (TypeScript style; ESM `.js` extension on imports)
  </read_first>
  <action>Create `evals/v1-baseline/baseline.test.ts`. The test file MUST use vitest (`describe`, `it`, `expect`) and import the `yaml` package (`import { parse as parseYaml } from "yaml";`). Structure: (1) Resolve `__dirname` via `fileURLToPath(import.meta.url)` per RESEARCH Example 6. Set `FIXTURE_VAULT = path.join(__dirname, "..", "fixtures", "v2-test-vault")`. (2) `describe("v1 tools/list surface (FND-10)", ...)` block with two `it`s — `it("matches the pinned snapshot exactly", () => { ... })` (load `tools-list.snapshot.json`, compare against `{ tools: TOOLS }` from `src/tool-registry.js` import — use `expect(actual).toEqual(pinned)`); `it("has exactly 23 tools", () => { expect(TOOLS).toHaveLength(23); })`. The test name MUST include the literal substring `matches the pinned snapshot` so VALIDATION row 00-10-02's `-t` filter matches. (3) `describe("v1 baseline fixtures parse (FND-09)", ...)` block: dynamically read all `*.yaml` files in `__dirname` (excluding any backup or temp files), parse each with `yaml.parse`, assert each parsed doc has a `queries` array (allow empty for the v3 placeholder files `graph_neighbors.yaml` and `graph_path.yaml`). Test name MUST include literal `baseline fixtures parse` for VALIDATION row 00-09-02. (4) For each YAML, a nested `describe(toolName, ...)` block adds: `it("expected_doc_ids reference real fixture files", () => { ... })` — loop every entry's `expected_doc_ids`, assert `fs.existsSync(join(FIXTURE_VAULT, expectedId)).toBe(true)`. (5) For each YAML with non-empty queries, add `it.todo("achieves >= 0.8 precision and >= 0.8 recall vs expected_doc_ids")`. Vitest's `.todo` reports it as a pending test in the output — Phase 1 converts to `it(...)`. (6) Imports MUST use ESM `.js` extensions on relative paths (`"../../src/tool-registry.js"`). The file MUST `import { describe, it, expect } from "vitest"`. Type-check passes (`tsc --noEmit`). The test file MUST NOT touch network or Ollama — only filesystem + the `TOOLS` literal.</action>
  <acceptance_criteria>
    - `test -f evals/v1-baseline/baseline.test.ts` exits 0.
    - Match VALIDATION row 00-09-02: `npx vitest run evals/v1-baseline/baseline.test.ts -t 'baseline fixtures parse'` exits 0 (test name present and passes).
    - Match VALIDATION row 00-10-02: `npx vitest run evals/v1-baseline/baseline.test.ts -t 'matches the pinned snapshot'` exits 0.
    - Full suite still passes: `npm test` exits 0.
    - `npx tsc --noEmit` exits 0 (test file is type-clean).
    - `.todo` hooks visible: `npx vitest run evals/v1-baseline/baseline.test.ts 2>&1 | grep -q 'todo'` (some vitest version may format as `↓` or `Todo`; verify by running and checking the actual output emits a non-zero count of `.todo` items).
  </acceptance_criteria>
  <verify>
    <automated>test -f evals/v1-baseline/baseline.test.ts && npx vitest run evals/v1-baseline/baseline.test.ts -t 'matches the pinned snapshot' && npx vitest run evals/v1-baseline/baseline.test.ts -t 'baseline fixtures parse' && npm test</automated>
  </verify>
  <done>`baseline.test.ts` runs under `npm test`; snapshot equality + fixture integrity tests pass; precision/recall hooks are `.todo` for Phase 1 wiring.</done>
</task>

</tasks>

<verification>
- VALIDATION row 00-09-01 satisfied (per-tool yamls exist, placeholders ship for the v3 graph names the validator looks for).
- VALIDATION row 00-09-02 satisfied (`baseline fixtures parse` test passes).
- VALIDATION row 00-10-02 satisfied (`matches the pinned snapshot` test passes).
- `npm test` still green — all v1 tests + the new baseline suite pass.
</verification>

<success_criteria>
- 11 real semantic-floor YAMLs + 2 placeholders for graph tools.
- `baseline.test.ts` enforces `tools/list` snapshot contract and fixture referential integrity.
- Precision/recall remains `.todo` — Phase 1 indexes the fixture and converts to real assertions.
- Single command `npm test` runs everything.
</success_criteria>

<output>
After completion, create `.planning/phases/00-foundation-decisions/00-11-SUMMARY.md` listing: per-tool query counts, the v1-vs-VALIDATION tool-name mismatch (graph_neighbors / graph_path placeholders), the `baseline.test.ts` test layout, and the `.todo` items Phase 1 must light up.
</output>
