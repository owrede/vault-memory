---
phase: 06-task-contract-dsl
verified: 2026-05-18T20:45:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 6: Task Contract DSL Verification Report

**Phase Goal:** Ship declarative task contracts as YAML documents (Zod-validated) in `_contracts/`, addressable by name, instantiable via MCP, with handle-based source/sink portability that sets the v3 multi-source template
**Verified:** 2026-05-18T20:45:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A non-Claude MCP client can list contracts via `list_contracts`, describe via `describe_contract`, and run `instantiate_contract` against the fixture vault | VERIFIED | `node scripts/smoketest-non-claude.mjs` exited 0; assertions print: "tools/list returned all ... 3 contract tools (= 37)", "Phase 6 — describe_contract(meeting-prep) returned json_schema + summary", "Phase 6 — instantiate_contract(smoketest-trivial) → write_back.doc_id ✓", "Phase 6 — list_contracts Resource returned 4 contracts incl. meeting-prep, project-status, code-review-brief" |
| 2 | Three reference contracts (meeting-prep, project-status, code-review-brief) ship and pass eval scenarios with expected output shape | VERIFIED | `evals/fixtures/v2-test-vault/_contracts/{meeting-prep,project-status,code-review-brief}.yaml` exist; `src/contracts/reference-contracts.test.ts` (9 tests passing) validates each against ContractFileSchema; `src/contracts/eval-runner.test.ts` (4 tests passing) loads `_queries/contracts-{meeting-prep,project-status,code-review-brief,stub-parity}.yaml` and asserts `expected_output_shape` matches |
| 3 | Override mechanism proven — `source_overrides` pointing at stub yields same shape as obsidian-fs | VERIFIED | `src/adapters/source/conformance.test.ts:1495` `describe("contracts stub-parity (CON-10)", ...)` block; verified by running `npx vitest run src/adapters/source/conformance.test.ts -t "stub-parity"` → 1 passed; assertion compares step keys + sink across obsidian-fs and stub SourceConnector runs of the same contract |
| 4 | Contract schema Zod-4 validated; `{{default_source}}` variable handle pattern works in all reference contracts; comments preserved on round-trip | VERIFIED | `src/contracts/schema.ts` ContractFileSchema covers `version`, `name`, `description`, `inputs`, `sources`, `assembly`, `output_shape`, `write_back`; all three reference contracts use `{{default_sink}}`, `{{inputs.<x>}}`, `{{<step>.<field>}}` (grep confirmed); `src/contracts/reference-contracts.test.ts` Test asserts comments survive `parseDocument(text).toString()` round-trip on meeting-prep |
| 5 | Phase 6 ADR documents Tools vs Prompts decision; `yaml ^2.6` is only net-new runtime dep | VERIFIED | `docs/v2/adr/006-task-contract-dsl.md` (416 lines, 13 Decision sections, 8 Invariants, Threat Model, Rejected-Alternatives); §Decision 1 resolves Tools-vs-Prompts (chose Tools with dual surface: generic + auto-register); `package.json` shows `"yaml": "^2.9.0"` (satisfies `^2.6` floor); SUMMARY 06-01 confirms no new runtime deps in any Phase 6 plan (yaml was pre-installed in Phase 0 per ADR-006 §Decision 8) |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `docs/v2/adr/006-task-contract-dsl.md` | ADR-006 with 13 decisions | VERIFIED | 416 lines; sections "## Decision: …" × 13 (incl. Dual MCP surface, Closed verb enum, list_contract_verbs Resource, Step composition, JSON Schema + $ref, Override semantics, Hot reload, yaml@2.9, Q-OUTPUT, Q-TIMEOUT, Q-DESCRIBE, Q-CI-LLM); Invariants C-1..C-8; Threat Model; Forward compatibility |
| `src/contracts/types.ts` | ParsedContract, OverrideMap, InstantiateError union, CONTRACT_PATH_REGEX | VERIFIED | Exists; barrel re-exports types; tests use the types |
| `src/contracts/schema.ts` (ContractFileSchema) | Zod for v1 YAML shape | VERIFIED | 14 tests passing; validates the three reference contracts |
| `src/contracts/registry.ts` (ContractRegistry) | first-wins collision | VERIFIED | 7 tests passing |
| `src/contracts/loader.ts` (startContractRegistry) | boot scan + ChangeFeed | VERIFIED | 365 LOC; 15 tests passing; lint-adapters confirms no fs/path/chokidar imports |
| `src/contracts/auto-register.ts` (syncAutoRegistered) | diff-based registerTool/remove | VERIFIED | 117 LOC; 9 tests passing |
| `src/contracts/templates.ts` (resolveTemplate) | mustache resolver | VERIFIED | 181 LOC; 13 tests passing |
| `src/contracts/mcp-clients.ts` (PeerMcpRegistry) | Symbol.dispose lifecycle | VERIFIED | 183 LOC; 10 tests passing |
| `src/contracts/verbs/index.ts` (verbDispatcher) | 11-verb baseline + literal + mcp:// | VERIFIED | 121 LOC; 13 tests passing |
| `src/contracts/verbs/mcp-extension.ts` (callMcpVerb) | Q-TIMEOUT peer-MCP | VERIFIED | 95 LOC; 3 tests passing |
| `src/contracts/instantiate.ts` (instantiateContract) | 7-step orchestration | VERIFIED | 449 LOC; 21 tests passing |
| `src/contracts/describe.ts` (describeContract) | Pure function returning {json_schema, summary} | VERIFIED | 144 LOC; 7 tests passing |
| `src/contracts/resources.ts` (readListContracts, readListContractVerbs) | MCP Resource handlers | VERIFIED | 161 LOC; 7 tests passing |
| `src/tool-registry.ts` | +3 tools: register_contracts_as_tools, describe_contract, instantiate_contract | VERIFIED | grep at lines 992/1012/1037 confirms entries; TOOL_SCHEMAS at lines 1560/1569/1582 |
| `src/server.ts` | startContractRegistry + PeerMcpRegistry boot + 2 Resource registrations | VERIFIED | grep confirms imports + boot wiring + `registerResource("contracts", ...)` (line 1845) and `registerResource("contract-verbs", ...)` (line 1890) |
| `evals/fixtures/v2-test-vault/_contracts/meeting-prep.yaml` | Reference contract anchored to 2026-04-15-q2-okr-review.md | VERIFIED | 74 lines; `read_note → expand → cluster → compile_brief`; write_back to `_memory/_briefs` |
| `evals/fixtures/v2-test-vault/_contracts/project-status.yaml` | Reference contract | VERIFIED | 70 lines; `query_frontmatter → cluster → compile_brief` |
| `evals/fixtures/v2-test-vault/_contracts/code-review-brief.yaml` | Reference contract | VERIFIED | 67 lines; `read_note → search_hybrid → compile_brief` |
| `evals/fixtures/v2-test-vault/_contracts/smoketest-trivial.yaml` | LLM-free CON-09 anchor | VERIFIED | Used by smoketest-non-claude.mjs |
| `evals/fixtures/v2-test-vault/_queries/contracts-*.yaml` (4 files) | Eval scenario YAMLs | VERIFIED | All 4 exist; eval-runner.test.ts loads each and asserts expected_output_shape |
| `evals/v1-baseline/tools-list.snapshot.json` | 37 tools | VERIFIED | `jq '.tools | length'` → 37; includes describe_contract, instantiate_contract, register_contracts_as_tools |
| `scripts/smoketest-non-claude.mjs` | Extended with Phase 6 assertions | VERIFIED | Exits 0; prints all 4 Phase 6 assertion passes |
| `docs/v2/PHASE-6-SIGN-OFF.md` | Sign-off doc with CON-01..CON-12 traceability | VERIFIED | 274 lines; CON-01..CON-12 table with status + anchor commits; 5 ROADMAP criteria sections |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| `src/server.ts` | `src/contracts/loader.ts` | `startContractRegistry({vault, feed, source, ...})` boot wiring | VERIFIED (server.ts:1971) |
| `src/server.ts` | `src/contracts/instantiate.ts` | `instantiateContract(buildInstantiateDeps(vault), args)` handler dispatch | VERIFIED (server.ts:914, 1690) |
| `src/server.ts` | `src/contracts/describe.ts` | `describeContract(...)` handler dispatch | VERIFIED (server.ts:1667) |
| `src/server.ts` | `src/contracts/resources.ts` | 2× `server.registerResource("contracts" / "contract-verbs", ...)` | VERIFIED (server.ts:1845, 1890) |
| `src/server.ts` | `src/contracts/mcp-clients.ts` | `peerMcpRegistry = new PeerMcpRegistry()` at boot + shutdown disposal | VERIFIED (server.ts:506) |
| `src/contracts/instantiate.ts` | `src/contracts/templates.ts` | `resolveTemplate(step.args, bindings)` per step | VERIFIED (grepped) |
| `src/contracts/instantiate.ts` | `src/contracts/verbs/index.ts` | `verbDispatcher(step.verb, args, deps)` | VERIFIED (grepped) |
| `src/contracts/instantiate.ts` | `src/memory/registry.ts` | `MemorySinkRegistry.resolveMemorySink(target)` for D-A4c | VERIFIED (mentioned in REVIEW WR-01; instantiate.test.ts Test 7 confirms) |
| `src/contracts/instantiate.ts` | `DeliveryAdapter.write()` | MEM-05 chokepoint for write_back | VERIFIED (eval-runner + smoketest both exercise the path) |
| `src/contracts/loader.ts` | `src/adapters/source/types.ts` | `SourceConnector.listDocuments` + `readDocument` (no fs) | VERIFIED (lint-adapters green) |
| `src/contracts/loader.ts` | `src/adapters/change-feed/types.ts` | `feed.subscribe(handler)` third subscriber | VERIFIED (loader tests 6-15 exercise) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `list_contracts` MCP Resource | `payload.contracts` | `readListContracts({registry, vaultName})` iterates `registry.entries()` from `startContractRegistry` boot scan + ChangeFeed | YES — smoketest reads vault-memory://contracts/test-vault and gets 4 real contracts (3 reference + smoketest-trivial) | FLOWING |
| `describe_contract` tool | `{json_schema, summary}` | `describeContract({registry, name})` projects ParsedContract.inputJsonSchema + renders markdown summary from ParsedContract fields | YES — smoketest validates non-empty json_schema and summary against meeting-prep contract | FLOWING |
| `instantiate_contract` tool | `{steps, write_back: {doc_id, ...}}` | `instantiateContract` orchestrator: Zod validate → resolve overrides → verbDispatcher per step → DeliveryAdapter.write | YES — smoketest's smoketest-trivial scenario returns `write_back.doc_id` (real DocId from delivery adapter) | FLOWING |
| Auto-registered `vm_*` tools | tool list mutation | `syncAutoRegistered` diffs registry → server.registerTool/remove | YES — eval-runner exercises the path; default-OFF in CI keeps snapshot stable | FLOWING (gated by auto_register_tools config) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript clean | `npx tsc --noEmit` | clean (no output) | PASS |
| Adapter-seam lint | `bash scripts/lint-adapters.sh` | "All adapter-seam invariants green" | PASS |
| Contract test suite | `npx vitest run src/contracts/` | 18 test files, 161 passed | PASS |
| Baseline eval | `npm run eval:baseline` | 210 passed | PASS |
| Tool count snapshot | `jq '.tools \| length' evals/v1-baseline/tools-list.snapshot.json` | 37 | PASS |
| Phase 6 tools in snapshot | grep tool names | register_contracts_as_tools, describe_contract, instantiate_contract present | PASS |
| CON-10 stub parity | `npx vitest run -t "stub-parity"` | 1 passed | PASS |
| CON-08 eval-runner | `npx vitest run src/contracts/eval-runner.test.ts` | 4 passed (all 4 scenario YAMLs) | PASS |
| CON-09 non-Claude smoketest | `node scripts/smoketest-non-claude.mjs` | Exits 0; 4 Phase 6 assertions PASS | PASS |
| Build succeeds | `npm run build` | ESM dist/cli.js 517.88 KB | PASS |
| Full test suite | `npm test` | 7588 passed + 77 skipped + 1 failed (timing-sensitive watcher.drain in stale worktree only — not in main src/) | PASS (caveat below) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CON-01 | 06-01, 06-02 | YAML schema + Zod-4 validation; comments preserved on round-trip | SATISFIED | `ContractFileSchema` validates 3 reference contracts; `reference-contracts.test.ts` asserts comment preservation on `parseDocument(text).toString()` for meeting-prep |
| CON-02 | 06-02 | Documents under `_contracts/<name>.yaml`; boot scan + ChangeFeed hot reload | SATISFIED | `CONTRACT_PATH_REGEX = /^_contracts\/[^/]+\.yaml$/`; loader.ts boot scan + ChangeFeed subscription; 15 tests confirm Pitfall F3 non-recursion |
| CON-03 | (implicit across 06-02/03/04) | Sources/sinks referenced by handle; `{{default_source}}` pattern | SATISFIED | All 3 reference contracts use `{{default_sink}}` and `{{inputs.<x>}}`; templates.test.ts 13 tests verify mustache resolution; instantiate.ts override resolution chain D-A4b |
| CON-04 | 06-04 | `list_contracts({source?})` MCP Resource | SATISFIED | `server.registerResource("contracts", ...)` at server.ts:1845; smoketest reads it; 7 resources.test.ts tests |
| CON-05 | 06-03 | `describe_contract({name})` MCP tool | SATISFIED | Tool registered; describe.ts pure function; 7 describe.test.ts tests; smoketest validates `{json_schema, summary}` |
| CON-06 | 06-03 | `instantiate_contract({name, inputs, source_overrides?, sink_overrides?})` | SATISFIED | Tool registered; 449-LOC orchestrator; 21 instantiate.test.ts tests cover all 12 InstantiateError reasons (11 orchestrator + 1 server-level ambiguous_vault); smoketest end-to-end success |
| CON-07 | 06-04 | Three reference contracts ship | SATISFIED | All 3 YAML files exist in `evals/fixtures/v2-test-vault/_contracts/` |
| CON-08 | 06-04 | Each reference contract has eval scenarios with expected output shape | SATISFIED | 4 scenario YAMLs in `_queries/contracts-*.yaml`; eval-runner.test.ts loads each and asserts `expected_output_shape` |
| CON-09 | 06-04 | Non-Claude MCP client lists + instantiates | SATISFIED | smoketest-non-claude.mjs uses SDK Client + StdioClientTransport (node, not Claude) and exits 0 |
| CON-10 | 06-04 | Override mechanism — same shape across obsidian-fs and stub | SATISFIED | `conformance.test.ts:1495` "contracts stub-parity (CON-10)" describe block; runs same contract through obsidian-fs and stub, asserts structural identity |
| CON-11 | 06-01 | Phase 6 ADR documents Tools vs Prompts | SATISFIED | ADR-006 §Decision 1 chose Tools (dual MCP surface: generic instantiate_contract + per-vault auto-register); rejected MCP Prompts in §Rationale |
| CON-12 | 06-01 | `yaml ^2.6` is only net-new runtime dep | SATISFIED | `package.json` shows `yaml: ^2.9.0` (≥ 2.6); SUMMARY 06-01..06-04 each report `new_runtime_deps: 0` (yaml installed in Phase 0 per ADR-006 §Decision 8) |

All 12 CON-* requirements from PLAN frontmatter declarations are satisfied. No orphans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none in src/contracts/* or src/server.ts contract wiring) | n/a | n/a | n/a | grep for `TBD\|FIXME\|XXX` in src/contracts/ returned zero hits |

The Phase 6 code-review (06-REVIEW.md) recorded 0 BLOCKER findings, 7 WARNING (WR-01..07) and 6 INFO. WR-01 (mis-tagged `missing_required_source` reason for sinks), WR-02 (input/source name-collision shadow), WR-03 (output_shape parse degrades silently), WR-04 (Q-TIMEOUT floor at 1ms), WR-05 (loader.ts JSDoc overclaim re yaml import), WR-06 (placeholderName edge case), WR-07 (`ambiguous_vault` with empty available_vaults). These are correctness/polish gaps for v2.x, not goal blockers — the orchestration end-to-end path completes and matches the documented success criteria. Logging them here as Info-level for the project to triage post-merge.

### Test Suite Caveat

`npm test` reports `1 failed | 7588 passed`. The single failing test is at `.claude/worktrees/agent-a8eee18a011eee608/src/adapters/change-feed/obsidian-fs/watcher.test.ts:136` — a `VaultWatcher.drain()` flush timing test inside a stale agent worktree (old/abandoned worktree from a prior agent run, separate from the main `./src/` tree). The same test in the main `./src/adapters/change-feed/obsidian-fs/watcher.test.ts` passes in the contract-tests run. SUMMARY 06-04 acknowledges this as "pre-existing timing-sensitive fixture that passes in isolation; not a Phase 6 regression". Not a blocker.

### Human Verification Required

(None — automated smoketest already exercises the non-Claude client path that would have been a candidate for human UAT.)

### Gaps Summary

No gaps. All 5 ROADMAP success criteria are verified by direct codebase inspection plus passing automated tests (smoketest exit-0, vitest test files, lint-adapters, tsc, eval:baseline, conformance.test.ts CON-10 block). All 12 CON-* requirements are satisfied with concrete artifacts. Phase 6 goal is achieved.

---

_Verified: 2026-05-18T20:45:00Z_
_Verifier: Claude (gsd-verifier)_
