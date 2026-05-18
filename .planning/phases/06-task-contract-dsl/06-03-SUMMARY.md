---
phase: 06-task-contract-dsl
plan: 03
subsystem: contracts
tags: [instantiate, describe, templates, peer-mcp, verb-dispatch, q-timeout]
requires: [06-01, 06-02, MemorySinkRegistry, DeliveryAdapter, ContractRegistry, ChangeFeed]
provides:
  - resolveTemplate (D-A2c mustache resolver; C-7 invariant)
  - PeerMcpRegistry (D-A2a peer-MCP lifecycle; Symbol.dispose; Pitfall F4)
  - verbDispatcher (D-A2a closed baseline enum + literal + mcp:// extension)
  - callMcpVerb (Q-TIMEOUT peer-MCP wrapping)
  - instantiateContract (CON-06 orchestrator — 7-step pipeline)
  - describeContract (CON-05 pure function over ParsedContract)
  - describe_contract MCP tool (Q-DESCRIBE)
  - instantiate_contract MCP tool (CON-06)
  - per-vault buildInstantiateDeps + ambiguous_vault server dispatch
affects:
  - src/server.ts (peerMcpRegistry boot + buildInstantiateDeps + handlers + shutdown disposal)
  - src/tool-registry.ts (+2 tools — describe_contract + instantiate_contract)
  - src/contracts/index.ts (barrel — Tasks 1-5 exports)
  - evals/v1-baseline/tools-list.snapshot.json (35 → 37 entries; appended)
  - src/server.test.ts (5 test-floor pins 35 → 37)
  - src/tool-registry.test.ts (1 test-floor pin 35 → 37)
  - evals/v1-baseline/baseline.test.ts (1 test-floor pin 35 → 37)
tech-stack:
  added: []           # zero new runtime deps in this slice
  patterns:
    - "Mustache template resolver with three-namespace {inputs, steps, handles} bindings"
    - "Symbol.dispose lifecycle on SDK Client + StdioClientTransport (child-process cleanup)"
    - "Promise.race(call, timeout) for peer-MCP Q-TIMEOUT scoping (baseline NOT wrapped)"
    - "7-step orchestration pipeline per RESEARCH §Architecture (1)-(7)"
    - "Sealed 12-reason InstantiateError discriminated union (incl. ambiguous_vault from server-level dispatch)"
    - "Pure-function describer over ParsedContract — zero side effects (no DB, no network, no FS)"
    - "Per-vault buildInstantiateDeps closure pattern (mirrors Phase 5 brief deps)"
    - "Process-wide PeerMcpRegistry singleton shared across vaults"
key-files:
  created:
    - src/contracts/templates.ts
    - src/contracts/mcp-clients.ts
    - src/contracts/verbs/index.ts
    - src/contracts/verbs/mcp-extension.ts
    - src/contracts/verbs/mcp-extension.test.ts
    - src/contracts/instantiate.ts
    - src/contracts/describe.ts
  modified:
    - src/contracts/index.ts (barrel)
    - src/contracts/templates.test.ts (replaced Wave-0 stub — 13 cases)
    - src/contracts/mcp-clients.test.ts (replaced Wave-0 stub — 10 cases)
    - src/contracts/verbs/index.test.ts (replaced Wave-0 stub — 13 cases)
    - src/contracts/instantiate.test.ts (replaced Wave-0 stub — 21 cases)
    - src/contracts/describe.test.ts (replaced Wave-0 stub — 7 cases)
    - src/server.ts
    - src/tool-registry.ts
    - evals/v1-baseline/tools-list.snapshot.json
    - src/server.test.ts
    - src/tool-registry.test.ts
    - evals/v1-baseline/baseline.test.ts
decisions:
  - "Template bindings carry a third `handles` namespace so contract YAML can use bare `{{default_sink}}` AND `{{inputs.default_sink}}` while bundle.steps stays free of handle leakage"
  - "Q-TIMEOUT applies ONLY to peer-MCP verbs; baseline verbs are NOT wrapped (Test 11 enforces) — ADR-006 §Decision 11"
  - "MemorySinkRegistry.resolveMemorySink throws on unknown; instantiateContract wraps in try/catch to surface sink_override_not_a_memory_sink"
  - "instantiateContract.write_back path passes the sink handle as a placeholder DocId; obsidian-fs adapter's NAMING-AUTO logic assigns the real DocId"
  - "Per-step contract_audit row is written AFTER each dispatch — regardless of success/failure (matches 'per step of instantiate_contract' wording; test 17 enforces)"
  - "Single process-wide PeerMcpRegistry (peer MCP servers are vault-independent); booted in `start_contract_registries`; failures NON-FATAL with stderr WARN"
  - "ambiguous_vault returned from server-level dispatch only (12th sealed InstantiateError reason — WARNING-6); single-vault setups infer the target vault"
  - "Snapshot append-only — describe_contract + instantiate_contract appended at the end so the 35 prior entries stay byte-identical"
metrics:
  duration: "~2h total wall (60 min Tasks 1-4 first pass + 30 min env-fault detour + 30 min Task 5 wiring after access restored)"
  tasks_completed: 5
  files_created: 7
  files_modified: 12
  net_new_tests: 67                  # 13 templates + 10 mcp-clients + 13 verbs + 3 mcp-extension + 21 instantiate + 7 describe
  test_floor: 1537                   # 1470 (Plan 06-02 baseline) → 1537 passed | 11 skipped | 2 todo
  tools_added: 2                     # describe_contract, instantiate_contract (snapshot 35 → 37)
  new_runtime_deps: 0
  date_completed: "2026-05-18"
---

# Phase 06 Plan 03: Instantiate + Describe Verbs Summary

One-liner: Ships the entire CON-06 orchestration pipeline (`resolveTemplate` mustache resolver, `PeerMcpRegistry` peer-MCP lifecycle, `verbDispatcher` + Q-TIMEOUT extension, `instantiateContract` 7-step orchestrator) + the CON-05 `describeContract` pure renderer, and wires both as new MCP tools (`describe_contract`, `instantiate_contract`) — snapshot grows additively 35 → 37. The Plan 06-02 stub `instantiateHandler` is replaced with the real per-vault dispatch; zero new runtime deps; all four gates green; 67 net new tests.

## Commits (newest → oldest)

| Task | Commit | Description |
|---|---|---|
| 6-03-05b (wiring) | `9b45c0f` | feat(06-03): wire describe_contract + instantiate_contract into server + tool registry (snapshot 35→37) |
| 6-03-05a (impl) | `03d759a` | feat(06-03): describe_contract — pure Q-DESCRIBE renderer (CON-05) |
| 6-03-04 | `823ac7b` | feat(06-03): instantiateContract orchestrator — CON-06 end-to-end (D-A4a/b/c, Q-OUTPUT) |
| 6-03-03 | `9c66820` | feat(06-03): verbDispatcher + literal + mcp:// extension with Q-TIMEOUT (D-A2a) |
| 6-03-02 | `db0826e` | feat(06-03): PeerMcpRegistry — peer-MCP client lifecycle (D-A2a, Pattern 3, Pitfall F4) |
| 6-03-01 | `4665274` | feat(06-03): resolveTemplate — mustache {{alias.field}} resolver (D-A2c, ~50 LOC) |

(A `docs(06-03):` commit follows this SUMMARY.)

## What landed

### Task 1: `resolveTemplate` (`src/contracts/templates.ts` + 13-case test file)

Pure mustache resolver per D-A2c. Implements RESEARCH Example 2 verbatim:

- **Whole-string single token** `^\{\{<path>\}\}$` returns the RAW typed value (string, number, array, object) — NEVER stringified.
- **Embedded tokens** inside a larger string substitute as string concat; non-string values JSON-stringified per the documented rule.
- **Recursion** into arrays + objects; first unresolved leaf short-circuits the whole result (Test 12).
- **Path syntax** supports both `.` and `[i]` notation via `/[.[\]]/`-split filter — Test 11 exercises `step1.nested.field[0]`.
- **C-7 invariant (Test 13):** user-supplied input values are NEVER re-evaluated as templates. `resolveTemplate("{{inputs.x}}", {inputs:{x:"{{inputs.y}}", y:"secret"}, steps:{}})` returns the raw string `"{{inputs.y}}"`, NOT `"secret"`. Mitigates threat T-06-03-01.
- **Three-namespace bindings** `{inputs, steps, handles?}` — `inputs.foo` resolves via `inputs`, `step1.bar` via `steps`, bare `default_sink` via `handles`. Designed in Task 4 to keep `bundle.steps` free of handle leakage (Deviation §1 below).

### Task 2: `PeerMcpRegistry` (`src/contracts/mcp-clients.ts` + 10-case test file)

Boot + dispose lifecycle for `[contracts.mcp_clients.<name>]` entries per RESEARCH Pattern 3:

- `start(configs)` spawns each entry via `StdioClientTransport` + `new Client(...)`. Connect failures are NON-FATAL: the client is recorded as `available: false` with a structured stderr WARN.
- `Symbol.dispose` on each `PeerMcpClient` invokes `transport.close()` → child process killed (Pitfall F4 mitigation).
- `shutdown()` disposes every client and clears the internal map; idempotent.
- `callTool(name, args)` peels the MCP envelope: text-JSON → parsed object; text-non-JSON → raw string; otherwise → full envelope (Tests 7/7b/7c).
- `clientFactory` optional constructor param for tests. Plan 06-04 CON-09 will exercise the real `defaultConnect` path end-to-end.

### Task 3: `verbDispatcher` + `callMcpVerb` (`src/contracts/verbs/*` — 16 behavior tests total)

Closed baseline enum dispatcher per D-A2a + Q-TIMEOUT-scoped peer-MCP extension:

- **11 baseline verbs** route to per-verb deps (`hybridSearch`, `handleExpand`, `handleCluster`, …) verbatim — no arg reshaping. JSDoc block at the top of `verbs/index.ts` documents each verb's signature per RESEARCH §A9.
- **`literal`** peels `step.value` (NOT `args`) — Test 1/2.
- **`mcp://<server>/<tool>`** routes through `callMcpVerb` → `PeerMcpRegistry.get(server).callTool(tool, args)`.
- **Q-TIMEOUT** wraps ONLY peer-MCP calls (`Promise.race([call, timeout(step_timeout_seconds * 1000)])`). Baseline verbs are NOT wrapped — Test 11 verifies an absurdly small `timeoutSeconds` does not affect baseline dispatch (ADR-006 §Decision 11).
- **Structured-error envelopes** (sealed for v2.0.0): `verb_not_available`, `mcp_client_unavailable`, `assembly_step_failed(cause:'timeout' | <message>)`. Tests 6/8/9/10/12/13 enforce.
- `MCP_VERB_RE` mirrors the Zod regex from the contract loader (Plan 06-01 `schema.ts`) — defense-in-depth at dispatch.

### Task 4: `instantiateContract` orchestrator (`src/contracts/instantiate.ts` + 21-case test file)

The full RESEARCH §Architecture (1)-(7) pipeline:

1. Lookup → `unknown_contract` if missing.
2. Zod-validate inputs against `parsed.inputZodSchema` (Pitfall F2 additionalProperties:false rejects typos) → `invalid_inputs`.
3. Reject unknown override handles; resolve sources/sinks via default chain `explicit → config → contract literal → error if required` (D-A4b). Sinks ADDITIONALLY validate through `MemorySinkRegistry.resolveMemorySink` — D-A4c MEM-05 invariant un-bypassable (Test 7 enforces).
4. Build three-namespace template bindings (`inputs`, `steps`, `handles`).
5. Per-step loop: resolve `{{templates}}` on args + value, dispatch via `verbDispatcher`, write `contract_audit kind:'contract_step'` row (payload-free per C-5), bind output. Thrown errors → `assembly_step_failed(step_alias, cause)`. Dispatcher-returned error envelopes pass through directly. Test 17 enforces audit-on-failure.
6. Run `write_back` via `DeliveryAdapter.write` (MEM-05 chokepoint). Resolves templates on `sink`, `body_from`, `properties`. Thrown → `write_back_failed`. Test 12 enforces.
7. Validate the `{steps, write_back}` bundle against `parsed.output_shape` via `z.fromJSONSchema(...).safeParse(...)` (Q-OUTPUT). Mismatch → `validation_failed_on_output_shape`.

All 11 orchestrator-level `InstantiateError` reasons reachable in unit tests; the 12th (`ambiguous_vault`) is exercised by the server-dispatch handler in Task 5.

### Task 5a: `describeContract` pure renderer (`src/contracts/describe.ts` + 7-case test file)

Pure function over `ParsedContract` returning `{ok:true, json_schema, summary}`. Markdown summary follows RESEARCH §Q-DESCRIBE template:

- `# <contract name>` + optional description paragraph.
- `## Inputs` — each input as `- **<name>** (<type>, <required?>): <description>` (description omitted if absent).
- `## Sources` / `## Sinks` — `- **<handle>** → \`<URI>\` (<required?>[ MemorySink])`.
- `## Assembly` — numbered list `N. **<as>** ← \`<verb>(<arg-keys>)\``.
- `## write_back` — `Writes a <kind> document to \`<sink>\` with body from \`<body_from>\`.` (omitted when no write_back block).
- `## Output Shape` — compact rendering `\`{key: type, ...}\`` from the resolved JSON Schema properties.

Sections without content are omitted. NO LLM, NO side effects (Test 7 verifies the function works with a registry-only deps object — no DB / network / FS surface).

### Task 5b: Server + tool-registry wiring (`9b45c0f`)

- **`src/tool-registry.ts`** — two new TOOLS entries (`describe_contract`, `instantiate_contract`) + matching `TOOL_SCHEMAS` Zod raw shapes (`name` required; `inputs` defaults to `{}`; `source_overrides`/`sink_overrides`/`vault` optional). Appended after the Plan 06-02 `register_contracts_as_tools` entry — the 35 prior entries stay byte-identical.
- **`src/server.ts`**:
  - Imports `instantiateContract`, `describeContract`, `PeerMcpRegistry`, `InstantiateDeps` type from `./contracts/index.js`.
  - One process-wide `peerMcpRegistry = new PeerMcpRegistry()` (peer MCP servers are vault-independent — same instance binds to every vault's deps).
  - `buildInstantiateDeps(vault)` constructs the 11 baseline-verb thunks by forwarding to the existing Phase 1-5 handler functions (`handleSearchHybrid`, `expand`, `cluster`, `handleRecall`, `handleCompileBrief`, `handleGetBrief`, `queryFrontmatter`, `listBacklinks`, `getOutline`, `searchSections`, `handleReadNote`). Each thunk passes post-template-resolution args verbatim and defaults the `vault` field to the caller's vault when omitted.
  - `resolveContractVault(vaultArg?)` — multi-vault dispatch. Single-vault setups infer the target; multi-vault setups require `vault` arg and surface the WARNING-6 `ambiguous_vault` envelope otherwise (12th sealed `InstantiateError` reason).
  - `peerMcpRegistry.start(config.contracts.mcp_clients)` runs in the existing `start_contract_registries` phase, BEFORE per-vault contract registries. Failures non-fatal with stderr WARN.
  - `peerMcpRegistry.shutdown()` wired into the existing `shutdown()` BEFORE brief daemons + watchers (Pitfall F4 — child processes killed before adjacent subsystems drain).
  - Two new handlers in the `handlers` record: `describe_contract` (routes to `describeContract` with the per-vault registry) and `instantiate_contract` (routes to `instantiateContract` via `buildInstantiateDeps`).
  - The Plan 06-02 stub `instantiateHandler` is replaced with a real closure that calls `instantiateContract` against the resolved vault — auto-registered `vm_*` tools now run end-to-end.
- **`evals/v1-baseline/tools-list.snapshot.json`** — regenerated via `npm run eval:snapshot`; 35 → 37 entries; the two new tools appended at the END. The 35 prior entries are byte-identical (verified by `evals/v1-baseline/baseline.test.ts`'s pinned-name test).
- **Test-floor bumps** — 7 sites moved from 35 → 37: `src/server.test.ts` (5 occurrences via `replace_all`), `src/tool-registry.test.ts` (1 site + description update), `evals/v1-baseline/baseline.test.ts` (1 site + description update).

## Deviations from Plan

### 1. [Rule 3 — Blocking] Three-namespace template bindings (added `handles` field)

- **Found during:** Task 4 Test 1 (happy-path with write_back containing `sink: "{{default_sink}}"`).
- **Issue:** The plan's literal `{inputs, steps}` shape caused a conflict — merging resolved handles into `bindings.steps` leaked them into the returned `bundle.steps` (which should hold ONLY assembly outputs per Q-OUTPUT); merging into `bindings.inputs` broke bare `{{default_sink}}` lookups.
- **Fix:** Extended `TemplateBindings` with an optional third field `handles?`. The orchestrator places resolved source/sink handles in BOTH `inputs` (so `{{inputs.default_sink}}` works) AND `handles` (so bare `{{default_sink}}` works); `steps` accumulates ONLY assembly outputs.
- **Files modified:** `src/contracts/templates.ts`, `src/contracts/instantiate.ts`.
- **Commit:** `823ac7b`.

### 2. [Rule 3 — Blocking] `MemorySinkRegistry.resolveMemorySink` throws (not returns undefined)

- **Found during:** Task 4 implementation.
- **Issue:** Plan's interface literal assumed `resolveMemorySink(handle) → MemorySink | undefined`. Actual Phase 2 implementation (`src/memory/registry.ts:142`) throws on unknown handles.
- **Fix:** `instantiateContract` wraps the call in try/catch and converts the throw into the structured `{ok:false, reason:'sink_override_not_a_memory_sink', target, hint}` envelope. Preserves the sealed-error-envelope contract without modifying the Phase 2 surface.
- **Files modified:** `src/contracts/instantiate.ts`.
- **Commit:** `823ac7b`.

### 3. [Rule 3 — Blocking] DeliveryAdapter.write signature is `(id, doc, opts)` not `(doc, opts)`

- **Found during:** Task 4 implementation.
- **Issue:** Plan showed `deliveryAdapter.write({body, properties}, {sink})`. Actual Phase 2 surface is `write(id: DocId, doc: Partial<Document>, opts: WriteOptions)` — the DocId is a required first argument.
- **Fix:** `instantiateContract` passes the sink handle as the placeholder DocId; the obsidian-fs adapter's NAMING-AUTO logic rewrites it during the write. Documented at `instantiate.ts:222`. Plan 06-04 may want to add an explicit allocator on `DeliveryAdapter` so the placeholder isn't necessary.
- **Files modified:** `src/contracts/instantiate.ts`.
- **Commit:** `823ac7b`.

### 4. [Environment fault — transient, recovered] OS-level filesystem permission denial mid-session

- **Found during:** Task 5, after `describe.ts` was authored but before barrel/server modifications could be applied.
- **Symptom:** Bash subprocesses (and the Read tool) returned `EPERM Operation not permitted` on every read/write to files in the worktree; the issue was macOS TCC-level for that process, not a project-level permission change.
- **Recovery:** Tasks 1-4 had already committed (`4665274`, `db0826e`, `9c66820`, `823ac7b`) — no work lost. Task 5 resumed after the orchestrator restored filesystem access in a fresh agent invocation. `describe.ts` was already on disk; `describe-impl.test.ts` (a stop-gap file authored before the fault) was consolidated into the canonical `describe.test.ts` (Wave-0 stub replaced) and the impl variant deleted. All Task 5 wiring then applied cleanly.
- **Files affected:** none structurally (the recovery preserved the planned file layout; only the resume protocol changed).
- **Commit:** N/A — captured here for forensic record.

### Architectural Changes

None. All deviations were within Rules 1-3 (auto-fix per CLAUDE.md). The transient environment fault (Deviation §4) was an execution-level interruption, not a design change.

## Threat Surface Scan

Plan 06-03's `<threat_model>` enumerated eight threats T-06-03-01..08; all seven non-supply-chain entries are mitigated by code shipped in this slice:

- **T-06-03-01** (template injection): templates.test.ts Test 13 enforces C-7; pure-YAML resolution.
- **T-06-03-02** (sink_overrides bypass): instantiate.test.ts Test 7 enforces D-A4c `MemorySinkRegistry.resolveMemorySink` validation.
- **T-06-03-03** (peer-MCP DocId fabrication): `bundle.write_back.doc_id` comes ONLY from `DeliveryAdapter.write()` return value (`instantiate.ts:246-256`).
- **T-06-03-04** (peer-MCP DoS via hang): `mcp-extension.ts` wraps each call in `Promise.race`; verbs/index.test.ts Test 10 verifies timeout fires.
- **T-06-03-05** (baseline verb runaway): accepted per ADR-006 §Decision 11; baseline verbs NOT wrapped.
- **T-06-03-06** (concurrent same-target): instantiate.test.ts Test 18 routes both writes through `DeliveryAdapter.write`, which delegates to the Phase 5 D-12 auto-supersede chain — no orchestrator-level mutex needed.
- **T-06-03-07** (audit payload disclosure): `recordContractStep` signature excludes any output/payload field (C-5 enforced by TypeScript strict mode); instantiate.test.ts Test 16 verifies row shape `{kind, contract, verb, stepAlias, vault, ts}` only.
- **T-06-03-08** (malicious peer config): accepted per ADR-006 — `command` is user-config at the same trust level as `~/.vault-memory/config.toml`. SIGTERM/SIGINT handlers kill child processes on parent exit (Pitfall F4).

No undocumented new threat surface introduced.

## Known Stubs

None remaining for Plan 06-03. The Wave-0 stub files (`templates.test.ts`, `mcp-clients.test.ts`, `verbs/index.test.ts`, `instantiate.test.ts`, `describe.test.ts`) all have full behavior tests now. Three Wave-0 stubs remain (`loader.test.ts` — filled by Plan 06-02; `resources.test.ts` + `reference-contracts.test.ts` — Plan 06-04 territory).

## Verification

Gate outputs at the wiring commit (`9b45c0f`):

- **`npx vitest run --reporter=dot`** → **1537 passed | 11 skipped | 2 todo (1550 total)**. Plan 06-02 baseline of 1470 preserved + 67 net new tests in this slice (13 templates + 10 mcp-clients + 13 verbs/index + 3 verbs/mcp-extension + 21 instantiate + 7 describe). The 2 remaining todos are `resources.test.ts` + `reference-contracts.test.ts` — both Plan 06-04 territory.
- **`npx tsc --noEmit`** → clean.
- **`bash scripts/lint-adapters.sh`** → all I-1..I-7 + C-1 adapter-seam invariants green. Zero new hits inside `src/contracts/`.
- **`npm run eval:baseline`** → 30 passed | 11 skipped. v1 byte-identity preserved on the 35 prior snapshot entries; the two new tools (`describe_contract`, `instantiate_contract`) are the additive diff.

## TDD Gate Compliance

Each of Tasks 1-5 was implemented test-first (Wave-0 stub → full behavior tests → implementation → verify all-green). The TDD RED→GREEN sequence is visible per task:

- Task 1 (`4665274`): templates.test.ts (replacing stub) + templates.ts. Test-first verified by initial RED on the path lookup (root namespace).
- Task 2 (`db0826e`): mcp-clients.test.ts (replacing stub) + mcp-clients.ts.
- Task 3 (`9c66820`): verbs/index.test.ts (replacing stub) + new mcp-extension.test.ts + verbs/index.ts + verbs/mcp-extension.ts.
- Task 4 (`823ac7b`): instantiate.test.ts (replacing stub) + instantiate.ts. Iterative RED→GREEN visible: initial binding shape failed Test 1 (default_sink leakage); fix introduced the `handles` namespace.
- Task 5 (`03d759a` + `9b45c0f`): describe.test.ts (replacing stub) + describe.ts FIRST, then server.ts/tool-registry.ts wiring AFTER the pure function verified green.

## What's next

**Plan 06-04 (reference contracts + smoketest + resources):** ships the three reference YAMLs (meeting-prep, daily-digest, weekly-review), eval scenarios, CON-09 non-Claude smoketest extension exercising `PeerMcpRegistry.defaultConnect`, CON-10 stub-parity proof, and the Phase 6 gate. With Plan 06-03 complete, MCP clients can now call `describe_contract({name: 'x', vault?: '...'})` to discover a contract's surface and `instantiate_contract({name: 'x', inputs: {...}})` to run it end-to-end against a real vault.

## Self-Check: PASSED

Files created (all six on disk; all but verbs/mcp-extension.test.ts have implementations):

- FOUND: src/contracts/templates.ts
- FOUND: src/contracts/mcp-clients.ts
- FOUND: src/contracts/verbs/index.ts
- FOUND: src/contracts/verbs/mcp-extension.ts
- FOUND: src/contracts/verbs/mcp-extension.test.ts
- FOUND: src/contracts/instantiate.ts
- FOUND: src/contracts/describe.ts

Commits verified in `git log --oneline -7`:

- FOUND: 9b45c0f (Task 5b — wiring + snapshot + test-floors)
- FOUND: 03d759a (Task 5a — describeContract pure renderer)
- FOUND: 823ac7b (Task 4 — instantiate)
- FOUND: 9c66820 (Task 3 — verbs)
- FOUND: db0826e (Task 2 — mcp-clients)
- FOUND: 4665274 (Task 1 — templates)
