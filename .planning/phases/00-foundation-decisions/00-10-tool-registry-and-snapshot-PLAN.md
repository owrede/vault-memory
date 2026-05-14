---
phase: 00-foundation-decisions
plan: 10
type: execute
wave: 3
depends_on: [02]
files_modified:
  - src/tool-registry.ts
  - src/server.ts
  - evals/v1-baseline/dump-tools.mjs
  - evals/v1-baseline/tools-list.snapshot.json
autonomous: true
requirements: [FND-10]
user_setup:
  - service: maintainer-veto-on-src-change
    why: "Per RESEARCH Assumption A5, the `src/tool-registry.ts` extraction is the ONLY `src/` change in Phase 0 (CONTEXT.md otherwise mandates zero src/ changes). The maintainer's ack of A5 is captured in plan 02 Task 0 (the Phase-0 pre-execution assumption checkpoint). This plan executes assuming A5=option-a. If A5=option-b was chosen, halt and re-plan via `/gsd-plan-phase 0 --gaps` BEFORE this plan starts."
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

Wave 3, depending on plan 02. Plan 02 Task 0 resolves assumption A5 (option-a or option-b); if option-a, this plan executes as written. If option-b was chosen, halt this plan before Task 1 — see §context_compliance.

Output: `tool-registry.ts` + `dump-tools.mjs` + `tools-list.snapshot.json`; `npm test` still green.
</objective>

<context_compliance>
**Assumption A5 gate (resolved in plan 02 Task 0).**

This plan implements **option-a**: extract the literal 23-tool array from `src/server.ts` into a new `src/tool-registry.ts`. The `src/` change is the ONE documented exception to CONTEXT.md's "zero `src/` changes" rule and is gated by maintainer ack in plan 02 Task 0.

**If plan 02 Task 0 resolved A5 to `option-b`** (no `src/` change; `dump-tools.mjs` spins up the MCP server in-process and issues a `tools/list` JSON-RPC call): HALT this plan. Tasks 1–3 below are option-a–specific. Re-plan via `/gsd-plan-phase 0 --gaps` before resuming. The new plan would: drop the `src/tool-registry.ts` task, expand `evals/v1-baseline/dump-tools.mjs` to ~30 lines that import the MCP SDK transport, instantiate the server, send `tools/list`, and write the response — accepting the slower (~3–5s) snapshot generation and the implicit runtime-dependency surface that comes with it.

The executor MUST confirm plan 02 Task 0's answer before proceeding. If the answer is missing (plan 02 did not run, or its SUMMARY is empty for A5), refuse to start and request the maintainer answer.
</context_compliance>

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
@.planning/phases/00-foundation-decisions/00-02-SUMMARY.md
@src/server.ts
@.planning/codebase/TESTING.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extract `TOOLS` constant — create `src/tool-registry.ts` + update `src/server.ts` (assumes A5=option-a)</name>
  <read_first>
    - .planning/phases/00-foundation-decisions/00-02-SUMMARY.md (confirm A5=option-a; if option-b, halt per §context_compliance)
    - src/server.ts lines 326–720 (the literal 23-tool array passed into the `ListToolsRequestSchema` handler — read the whole array; the order matters because the snapshot pins it in registration order)
    - src/server.ts lines 1–50 (existing imports and module style — match exactly)
    - .planning/codebase/CONVENTIONS.md (TypeScript conventions — strict mode, `import type` where appropriate, `.js` extension on relative imports)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Pitfall 4 (the rationale for the extraction; Example 5 for the import shape)
  </read_first>
  <action>(A) Create `src/tool-registry.ts`. The file MUST: (1) declare `export const TOOLS = [ ... ] as const;` where `[ ... ]` is the EXACT literal array currently embedded in `src/server.ts`'s `ListToolsRequestSchema` handler (lines 326–720) — copy verbatim, preserve registration order. (2) Use the SAME imports that `src/server.ts` uses for the JSON-Schema objects already in the array (likely none — the array uses JSON-Schema literal objects, not Zod schemas, per the existing pattern). (3) Add a top-of-file comment: `// Single literal source of truth for v1 tools/list. Imported by src/server.ts (runtime) and evals/v1-baseline/dump-tools.mjs (snapshot generator).` (B) Edit `src/server.ts` minimally: (1) add `import { TOOLS } from "./tool-registry.js";` to the imports block (ESM `.js` extension is mandatory per project conventions); (2) replace the literal `[...]` argument in the `ListToolsRequestSchema` handler's response with `TOOLS`. The handler shape becomes `return { tools: TOOLS };` or equivalent — verify against the existing handler shape on lines ~720. No other src changes. Do NOT change tool definitions, schemas, names, or order. (C) Run `npm run build && npm test` — every existing v1 test (324 tests per CONTEXT) MUST still pass.</action>
  <acceptance_criteria>
    - `test -f src/tool-registry.ts && grep -q '^export const TOOLS' src/tool-registry.ts` exits 0.
    - `grep -q "from \"./tool-registry.js\"" src/server.ts || grep -q "from './tool-registry.js'" src/server.ts` (server imports the registry).
    - `npx tsx -e 'import("./src/tool-registry.ts").then(m=>{if(!Array.isArray(m.TOOLS)||m.TOOLS.length!==23)process.exit(1)})'` exits 0.
    - `npx tsc --noEmit` exits 0 (type-check passes — Phase 1 is not allowed to type-error this either).
    - `npm test` exits 0 (all 324 existing tests still pass).
  </acceptance_criteria>
  <verify>
    <automated>test -f src/tool-registry.ts && grep -q '^export const TOOLS' src/tool-registry.ts && grep -qE 'from "\./tool-registry\.js"|from .\./tool-registry\.js.' src/server.ts && npx tsc --noEmit && npm test</automated>
  </verify>
  <done>`TOOLS` exported from `src/tool-registry.ts`; `src/server.ts` imports it; type-check + tests pass; zero behavior change.</done>
</task>

<task type="auto">
  <name>Task 2: Author `evals/v1-baseline/dump-tools.mjs` + generate the pinned `tools-list.snapshot.json`</name>
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
- VALIDATION rows 00-10-01 + 00-10-02 pass (Task 2 acceptance + the snapshot-equality test in plan 11).
- `npm test` green confirms the extraction did not break v1.
</verification>

<success_criteria>
- A5=option-a confirmed via plan 02 SUMMARY before any task starts.
- `src/tool-registry.ts` extracted; `src/server.ts` imports it; 324 v1 tests still pass.
- `dump-tools.mjs` deterministic; snapshot pinned with 23 tools.
- Plan 11 will add the vitest test that asserts `dump-tools.mjs` output equals the pinned snapshot.
</success_criteria>

<output>
After completion, create `.planning/phases/00-foundation-decisions/00-10-SUMMARY.md` recording: confirmation that A5=option-a was honored (per plan 02 Task 0), the exact lines deleted from `src/server.ts`, the exact lines added to `src/tool-registry.ts`, npm-test outcome (test count + pass count), and confirmation that the snapshot file has 23 entries in `list_vaults`…`suggest_frontmatter` order.
</output>