---
phase: 00-foundation-decisions
plan: 10
type: execute
wave: 2
depends_on: [01]
files_modified:
  - src/tool-registry.ts
  - src/server.ts
  - evals/v1-baseline/dump-tools.mjs
  - evals/v1-baseline/tools-list.snapshot.json
autonomous: false
requirements: [FND-10]
user_setup:
  - service: maintainer-veto-on-src-change
    why: "Per RESEARCH Assumption A5, the `src/tool-registry.ts` extraction is the ONLY `src/` change in Phase 0 (CONTEXT.md otherwise mandates zero src/ changes). The PR for this plan MUST be flagged for maintainer review with the explicit choice between (a) accept the 5-line extract, or (b) reject and fall back to spinning the full MCP server inside `dump-tools.mjs` to issue an in-process `tools/list` JSON-RPC call."
must_haves:
  truths:
    - "`src/tool-registry.ts` exports a `TOOLS` constant that holds the literal 23-tool array previously embedded in `src/server.ts` lines 326–720"
    - "`src/server.ts` imports `TOOLS` from `./tool-registry.js` and uses it in the `ListToolsRequestSchema` handler — runtime behavior is byte-identical"
    - "`evals/v1-baseline/dump-tools.mjs` imports `TOOLS` and emits a canonical `{tools: <array>}` JSON object to stdout"
    - "`evals/v1-baseline/tools-list.snapshot.json` is the pinned, hand-committed snapshot containing exactly 23 tool entries (FND-10)"
    - "Every v1 test still passes after the extraction (zero behavior change)"
  artifacts:
    - path: "src/tool-registry.ts"
      provides: "Importable TOOLS array"
      contains: "export const TOOLS"
    - path: "evals/v1-baseline/dump-tools.mjs"
      provides: "Snapshot generator"
      contains: "TOOLS"
    - path: "evals/v1-baseline/tools-list.snapshot.json"
      provides: "Pinned tools/list contract"
      contains: "list_vaults"
  key_links:
    - from: "src/server.ts"
      to: "src/tool-registry.ts"
      via: "import { TOOLS } from './tool-registry.js'"
      pattern: "from \"\\./tool-registry"
---

<objective>
Pin the v1 `tools/list` JSON-RPC surface as a literal-file snapshot (FND-10). Two parts: (1) the ONE pre-approved `src/` change in Phase 0 — extract the 23-tool literal array from `src/server.ts` lines 326–720 into a new `src/tool-registry.ts` exporting `TOOLS`, and import it back into `server.ts` (Pitfall 4 + Assumption A5 mitigation). (2) Author `evals/v1-baseline/dump-tools.mjs` (the generator) and the pinned `tools-list.snapshot.json` (the contract). Per D-11 / RESEARCH Pattern 2, the snapshot is a literal hand-committed JSON file, NOT a vitest `toMatchSnapshot()` (whose auto-update behavior defeats the "drift is loud" goal).

This plan is flagged `autonomous: false` because the `src/` extraction requires maintainer approval per RESEARCH Assumption A5 / Open Question 1. The Task-1 checkpoint resolves the choice between extraction vs. in-process JSON-RPC alternative BEFORE any code is touched.

Output: `tool-registry.ts` + `dump-tools.mjs` + `tools-list.snapshot.json`; `npm test` still green.
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
@src/server.ts
@.planning/codebase/TESTING.md
</context>

<tasks>

<task type="checkpoint:decision" gate="blocking">
  <name>Task 1: Maintainer decision — `src/tool-registry.ts` extraction vs. in-process JSON-RPC alternative</name>
  <decision>How to expose the v1 `tools/list` payload to the snapshot generator without spinning up a full MCP server.</decision>
  <context>
    CONTEXT.md mandates "Zero `src/` changes" in Phase 0. RESEARCH Assumption A5 + Open Question 1 flag this single 5-line non-behavioral extraction as the documented exception. The maintainer's choice determines the rest of this plan.
  </context>
  <options>
    <option id="option-a">
      <name>Extract `TOOLS` constant into `src/tool-registry.ts` (RESEARCH-recommended)</name>
      <pros>5-line non-behavioral change. Importable from `dump-tools.mjs` with one line. No runtime MCP server spin-up. Snapshot test runs in &lt;1 second. Pure refactor — TypeScript compiler verifies behavior preservation. Sets up Phase 1's tool-registration migration to `registerTool(...)` cleanly.</pros>
      <cons>Violates the literal "zero src/ changes" CONTEXT directive. Requires maintainer veto-or-accept per Assumption A5.</cons>
    </option>
    <option id="option-b">
      <name>Keep `src/` untouched; `dump-tools.mjs` spawns the MCP server in-process and issues a `tools/list` JSON-RPC call</name>
      <pros>Zero src/ change. Snapshot exercises the actual MCP wire surface, not just the literal array.</pros>
      <cons>~30 lines of harness in `dump-tools.mjs`. Snapshot generation now requires `better-sqlite3`/`sqlite-vec`/etc. to be installable in CI even though the snapshot doesn't use them. Slower (~3–5s per run). Adds a real dependency on the MCP SDK transport in a snapshot test that should be a pure literal comparison.</cons>
    </option>
  </options>
  <resume-signal>Select `option-a` or `option-b`. Tasks 2–4 below are written assuming `option-a`; if `option-b` is chosen, replan Task 2 (no `src/` edit) and Task 3 (in-process JSON-RPC harness in `dump-tools.mjs`) before resuming.</resume-signal>
</task>

<task type="auto">
  <name>Task 2: Extract `TOOLS` constant — create `src/tool-registry.ts` + update `src/server.ts` (assumes option-a)</name>
  <read_first>
    - src/server.ts lines 326–720 (the literal 23-tool array passed into the `ListToolsRequestSchema` handler — read the whole array; the order matters because the snapshot pins it in registration order)
    - src/server.ts lines 1–50 (existing imports and module style — match exactly)
    - .planning/codebase/CONVENTIONS.md (TypeScript conventions — strict mode, `import type` where appropriate, `.js` extension on relative imports)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Pitfall 4 (the rationale for the extraction; Example 5 for the import shape)
  </read_first>
  <action>(A) Create `src/tool-registry.ts`. The file MUST: (1) declare `export const TOOLS = [ ... ] as const;` where `[ ... ]` is the EXACT literal array currently embedded in `src/server.ts`'s `ListToolsRequestSchema` handler (lines 326–720) — copy verbatim, preserve registration order. (2) Use the SAME imports that `src/server.ts` uses for the JSON-Schema objects already in the array (likely none — the array uses JSON-Schema literal objects, not Zod schemas, per the existing pattern). (3) Add a top-of-file comment: `// Single literal source of truth for v1 tools/list. Imported by src/server.ts (runtime) and evals/v1-baseline/dump-tools.mjs (snapshot generator).` (B) Edit `src/server.ts` minimally: (1) add `import { TOOLS } from "./tool-registry.js";` to the imports block (ESM `.js` extension is mandatory per project conventions); (2) replace the literal `[...]` argument in the `ListToolsRequestSchema` handler's response with `TOOLS`. The handler shape becomes `return { tools: TOOLS };` or equivalent — verify against the existing handler shape on lines ~720. No other src changes. Do NOT change tool definitions, schemas, names, or order. (C) Run `npm run build && npm test` — every existing v1 test (324 tests per CONTEXT) MUST still pass.</action>
  <acceptance_criteria>
    - `test -f src/tool-registry.ts && grep -q '^export const TOOLS' src/tool-registry.ts` exits 0.
    - `grep -q "from \"./tool-registry.js\"" src/server.ts || grep -q "from './tool-registry.js'" src/server.ts` (server imports the registry).
    - `node -e 'import("./src/tool-registry.ts").then(m=>{if(!Array.isArray(m.TOOLS)||m.TOOLS.length!==23)process.exit(1)})'` — actually use tsx since this is TS: `npx tsx -e 'import("./src/tool-registry.ts").then(m=>{if(!Array.isArray(m.TOOLS)||m.TOOLS.length!==23)process.exit(1)})'` exits 0.
    - `npx tsc --noEmit` exits 0 (type-check passes — Phase 1 is not allowed to type-error this either).
    - `npm test` exits 0 (all 324 existing tests still pass).
  </acceptance_criteria>
  <verify>
    <automated>test -f src/tool-registry.ts && grep -q '^export const TOOLS' src/tool-registry.ts && grep -qE 'from "\./tool-registry\.js"|from .\./tool-registry\.js.' src/server.ts && npx tsc --noEmit && npm test</automated>
  </verify>
  <done>`TOOLS` exported from `src/tool-registry.ts`; `src/server.ts` imports it; type-check + tests pass; zero behavior change.</done>
</task>

<task type="auto">
  <name>Task 3: Author `evals/v1-baseline/dump-tools.mjs` + generate the pinned `tools-list.snapshot.json`</name>
  <read_first>
    - src/tool-registry.ts (just created)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Example 5 (dump-tools.mjs shape) + §Pattern 2 (literal-file snapshot rationale) + §Pitfall 4 (deterministic-stringify)
    - .planning/phases/00-foundation-decisions/00-VALIDATION.md rows 00-10-01 + 00-10-02 (verification commands)
  </read_first>
  <action>(A) Create `evals/v1-baseline/dump-tools.mjs` with the exact pattern from RESEARCH §Example 5: an ESM script that imports `TOOLS` from `../../src/tool-registry.js`, wraps as `{ tools: TOOLS }`, and emits `JSON.stringify(payload, null, 2) + "\\n"` to stdout. The file MUST: (1) have a shebang line `#!/usr/bin/env node`; (2) be executable (`chmod +x`); (3) import via ESM relative path with `.js` extension (Node ESM resolution); (4) use 2-space indentation and a single trailing newline (matches what `npm run eval:snapshot` will pipe to a file). Do NOT load any runtime modules from `dist/` — the snapshot must work against `src/` source via tsx/Node ESM. NOTE: Because `src/tool-registry.ts` is TypeScript, the simplest path is for `dump-tools.mjs` to be invoked via `node --experimental-strip-types` (Node ≥22.6) OR via `npx tsx evals/v1-baseline/dump-tools.mjs`. Per `package.json#engines.node = ">=22"` and CONTEXT, Node 22+ supports `--experimental-strip-types`; update the package.json `eval:snapshot` script (plan 01 stub) to run as `node --experimental-strip-types evals/v1-baseline/dump-tools.mjs > evals/v1-baseline/tools-list.snapshot.json` if direct .mjs → .ts import doesn't resolve, OR switch the script to `tsx evals/v1-baseline/dump-tools.mjs > ...`. Verify locally whichever resolves cleanly. (B) Generate the pinned snapshot: run `npm run eval:snapshot` (or the resolved invocation above) — output written to `evals/v1-baseline/tools-list.snapshot.json`. (C) Manually inspect `tools-list.snapshot.json` — it MUST be a JSON object `{ "tools": [...] }`, the array MUST have exactly 23 entries, the first entry's `name` MUST be `list_vaults` and the last MUST be `suggest_frontmatter` (per RESEARCH §Pitfall 4 — registration order confirmed). Commit this generated file as the contract — drift fails CI per D-11.</action>
  <acceptance_criteria>
    - `test -f evals/v1-baseline/dump-tools.mjs && test -x evals/v1-baseline/dump-tools.mjs` exits 0.
    - Match VALIDATION row 00-10-01 (adapted — snapshot is `{tools: [...]}` not bare array): `node -e 'const j=JSON.parse(require("fs").readFileSync("evals/v1-baseline/tools-list.snapshot.json","utf-8"));if(!j.tools||!Array.isArray(j.tools)||j.tools.length!==23)process.exit(1)'` exits 0.
    - First and last tool names match: `node -e 'const j=JSON.parse(require("fs").readFileSync("evals/v1-baseline/tools-list.snapshot.json","utf-8"));if(j.tools[0].name!=="list_vaults"||j.tools[22].name!=="suggest_frontmatter")process.exit(1)'` exits 0.
    - Re-running the generator is byte-deterministic: `npm run eval:snapshot && git diff --exit-code evals/v1-baseline/tools-list.snapshot.json` exits 0 (no diff after regeneration).
  </acceptance_criteria>
  <verify>
    <automated>test -x evals/v1-baseline/dump-tools.mjs && node -e 'const j=JSON.parse(require("fs").readFileSync("evals/v1-baseline/tools-list.snapshot.json","utf-8"));if(!j.tools||j.tools.length!==23||j.tools[0].name!=="list_vaults"||j.tools[22].name!=="suggest_frontmatter")process.exit(1)'</automated>
  </verify>
  <done>`dump-tools.mjs` produces deterministic output; pinned snapshot file committed with 23 tools in registration order.</done>
</task>

</tasks>

<verification>
- VALIDATION rows 00-10-01 + 00-10-02 pass (Task 3 acceptance + the snapshot-equality test in plan 11).
- `npm test` green confirms the extraction did not break v1.
</verification>

<success_criteria>
- `src/tool-registry.ts` extracted; `src/server.ts` imports it; 324 v1 tests still pass.
- `dump-tools.mjs` deterministic; snapshot pinned with 23 tools.
- Plan 11 will add the vitest test that asserts `dump-tools.mjs` output equals the pinned snapshot.
</success_criteria>

<output>
After completion, create `.planning/phases/00-foundation-decisions/00-10-SUMMARY.md` recording: which decision (option-a/option-b) the maintainer chose, the exact lines deleted from `src/server.ts`, the exact lines added to `src/tool-registry.ts`, npm-test outcome (test count + pass count), and confirmation that the snapshot file has 23 entries in `list_vaults`…`suggest_frontmatter` order.
</output>
