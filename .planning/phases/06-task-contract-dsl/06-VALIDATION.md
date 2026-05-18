---
phase: 6
slug: task-contract-dsl
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-18
source: extracted from 06-RESEARCH.md §Validation Architecture
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Extracted verbatim from `06-RESEARCH.md §Validation Architecture` per
> the plan-checker non-blocking concern 5 (project config sets
> `nyquist_validation: true` but no VALIDATION.md existed before this
> patch). Single source of truth lives here; PLAN files cross-reference.

---

## Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@^2.1.8` (already installed) |
| Config file | none — uses vitest defaults |
| Quick run command | `npx vitest run src/contracts/` |
| Full suite command | `npm test` |
| Lint command | `bash scripts/lint-adapters.sh` (filename-based `--exclude='*.test.ts'` — confirmed 06-01 Task 5 WARNING-1 discovery) |
| Type-check command | `npx tsc --noEmit` |

## Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? | Plan |
|--------|----------|-----------|-------------------|--------------|------|
| CON-01 | YAML round-trip preserves comments | unit | `npx vitest run src/contracts/loader.test.ts -t "round-trip"` | Wave 0 (Plan 06-01 stub; filled by Plan 06-02 Task 1) | 06-02 |
| CON-01 | Zod 4 validates parsed contract shape | unit | `npx vitest run src/contracts/schema.test.ts` | Plan 06-01 Task 5 | 06-01 |
| CON-02 | Contracts addressed by `name` (collision is load error) | unit | `npx vitest run src/contracts/registry.test.ts` | Plan 06-01 Task 5 | 06-01 |
| CON-02 | Boot scan filters to `^_contracts/[^/]+\.yaml$` (Pitfall F3) | unit | `npx vitest run src/contracts/loader.test.ts -t "non-recursion"` | Plan 06-02 Task 1 | 06-02 |
| CON-03 | `{{default_source}}` variable handle works | unit | `npx vitest run src/contracts/templates.test.ts` | Plan 06-03 Task 1 | 06-03 |
| CON-03 | Default chain order (override → config → contract literal) | integration | `npx vitest run src/contracts/instantiate.test.ts -t "default chain"` | Plan 06-03 Task 4 | 06-03 |
| CON-04 | `list_contracts` MCP Resource | integration | `npx vitest run src/contracts/resources.test.ts` | Plan 06-04 Task 3 | 06-04 |
| CON-05 | `describe_contract` output shape | unit | `npx vitest run src/contracts/describe.test.ts` | Plan 06-03 Task 5 | 06-03 |
| CON-06 | `instantiate_contract` orchestration (19 cases incl. all 12 InstantiateError reasons) | integration | `npx vitest run src/contracts/instantiate.test.ts` | Plan 06-03 Task 4 | 06-03 |
| CON-07 | Three reference contracts validate via ContractFileSchema + buildInputSchema | integration | `npx vitest run src/contracts/reference-contracts.test.ts` | Plan 06-04 Task 1 | 06-04 |
| CON-08 | Eval scenarios per contract (mocked compile_brief per Q-CI-LLM) | integration | `npx vitest run src/contracts/eval-runner.test.ts` | Plan 06-04 Task 2 | 06-04 |
| CON-09 | Non-Claude MCP client proof | smoketest | `node scripts/smoketest-non-claude.mjs` | Plan 06-04 Task 4 (extends existing) | 06-04 |
| CON-10 | Stub-parity proof | integration | `npx vitest run src/adapters/source/conformance.test.ts -t "contracts stub-parity"` | Plan 06-04 Task 2 (extends existing) | 06-04 |
| CON-11 | ADR exists | manual + grep | `ls docs/v2/adr/006-task-contract-dsl.md && grep -q "## Decision: Dual MCP surface" docs/v2/adr/006-task-contract-dsl.md` | Plan 06-01 Task 1 | 06-01 |
| CON-12 | `yaml ^2.6` in deps + ADR rationale | manual | `grep '"yaml":' package.json && grep -q "## Decision: yaml@2.9 rationale" docs/v2/adr/006-task-contract-dsl.md` | already in package.json from Phase 0; ADR ships in 06-01 | 06-01 |

## Decision-to-Test Coverage

Every locked decision in `06-CONTEXT.md <decisions>` has at least one test:

| Decision | Coverage |
|----------|----------|
| D-A1 (dual MCP surface) | 06-02 Task 3 server-wiring tests + 06-04 Task 4 smoketest |
| D-A1b (per-vault `auto_register_tools`) | 06-01 Task 3 config-loader.test.ts |
| D-A1c (`tool_prefix` default `vm_`, A7 .min(1)) | 06-01 Task 3 config-loader.test.ts + 06-02 Task 2 auto-register.test.ts (prefix override) |
| D-A2a (closed verb enum + literal + mcp://) | 06-03 Task 3 verbs/index.test.ts (all 11 + literal + mcp://) |
| D-A2b (`list_contract_verbs` Resource + audit signal) | 06-04 Task 3 resources.test.ts (Tests 4-7) |
| D-A2c (mustache templates) | 06-03 Task 1 templates.test.ts (13 cases) |
| D-A3a (JSON Schema subset, additionalProperties:false per Pitfall F2) | 06-01 Task 4 input-schema.test.ts |
| D-A3b ($ref to TYPES_CATALOG) | 06-01 Task 4 json-schema-ref.test.ts + types-catalog.test.ts |
| D-A4a (override target = handle name) | 06-03 Task 4 instantiate.test.ts Tests 4-6 |
| D-A4b (strict override validation + default chain) | 06-03 Task 4 instantiate.test.ts Tests 4-6 |
| D-A4c (sink_overrides MemorySink-only) | 06-03 Task 4 instantiate.test.ts Tests 7-8 |
| D-LOAD (ChangeFeed hot reload) | 06-02 Task 1 loader.test.ts (Tests 6-14) |
| Q-AUD (separate contract_audit table) | 06-01 Task 2 contract-audit.test.ts |
| Q-TIMEOUT (peer-MCP only) | 06-03 Task 3 verbs/mcp-extension.test.ts Tests 10-11 |
| Q-OUTPUT (bundle shape validation) | 06-03 Task 4 instantiate.test.ts Tests 14-15 |
| Q-DESCRIBE (auto-generated markdown) | 06-03 Task 5 describe.test.ts |
| Q-CI-LLM (mock compile_brief in CI evals; WARNING-4) | 06-04 Task 2 eval-runner.test.ts + conformance extension |

## Sampling Rate (Nyquist)

- **Per task commit:** `npx vitest run <task-specific test files>` (matches task `<verify>` block)
- **Per wave merge:** `npm test && npx tsc --noEmit && bash scripts/lint-adapters.sh`
- **Per slice gate (sign-off):** `npm test && npx tsc --noEmit && bash scripts/lint-adapters.sh && npm run eval:baseline && node scripts/smoketest-non-claude.mjs`
- **Phase gate (Plan 06-04 sign-off):** all of the above + manual snapshot review of `evals/v1-baseline/tools-list.snapshot.json` diff (additive: +3 tools across 06-02/03; MCP Resources not in snapshot per Phase 5 BRF-09 precedent)

## Wave 0 Gaps (test stubs to create in Plan 06-01 Task 5)

- [ ] `src/contracts/loader.test.ts` — D-LOAD (filled by Plan 06-02 Task 1)
- [ ] `src/contracts/templates.test.ts` — D-A2c (filled by Plan 06-03 Task 1)
- [ ] `src/contracts/mcp-clients.test.ts` — D-A2a peer-MCP (filled by Plan 06-03 Task 2)
- [ ] `src/contracts/verbs/index.test.ts` — D-A2a baseline + literal + mcp:// (filled by Plan 06-03 Task 3)
- [ ] `src/contracts/instantiate.test.ts` — CON-06 (filled by Plan 06-03 Task 4)
- [ ] `src/contracts/describe.test.ts` — CON-05 (filled by Plan 06-03 Task 5)
- [ ] `src/contracts/auto-register.test.ts` — D-A1 dynamic registration (filled by Plan 06-02 Task 2)
- [ ] `src/contracts/resources.test.ts` — CON-04 + D-A2b (filled by Plan 06-04 Task 3)
- [ ] `src/contracts/reference-contracts.test.ts` — CON-07 (filled by Plan 06-04 Task 1)

New test files NOT among Wave-0 stubs (created fresh by later plans):
- `src/contracts/eval-runner.test.ts` — CON-08 + CON-10 (created by Plan 06-04 Task 2 per WARNING-2 lock)
- `src/contracts/server-integration.test.ts` (or inline in `auto-register.test.ts`) — `ambiguous_vault` server-level dispatch (WARNING-6; created by Plan 06-03 Task 5)

New non-test fixtures created by later plans:
- `evals/fixtures/v2-test-vault/_contracts/{meeting-prep,project-status,code-review-brief,smoketest-trivial}.yaml` (Plan 06-04 Task 1)
- `evals/fixtures/v2-test-vault/_queries/contracts-{meeting-prep,project-status,code-review-brief,stub-parity}.yaml` (Plan 06-04 Task 2)
- `src/adapters/source/conformance.test.ts` extension for CON-10 stub-parity (Plan 06-04 Task 2)
- `scripts/smoketest-non-claude.mjs` extension for CON-09 (Plan 06-04 Task 4)

## Manual-Only Verifications

- `evals/v1-baseline/tools-list.snapshot.json` regen review (additive diff: +1 in Plan 06-02, +2 in Plan 06-03, 0 in Plan 06-04). Final delta: +3 tools (34 → 37). MCP Resources (`list_contracts`, `list_contract_verbs`) are NOT in the tools snapshot per Phase 5 BRF-09 precedent.
- `docs/v2/PHASE-6-SIGN-OFF.md` — human-review gate per Plan 06-04 `autonomous: false` declaration. Reviewer confirms: all 12 CON-* requirements ticked with commit SHAs; all 5 ROADMAP success criteria traced to tests; ADR-006 13-decision traceability table populated.
- Interactive smoketest (Plan 06-04 Task 4): `vault-memory serve` against the fixture vault + MCP Inspector run-through of `describe_contract` + `instantiate_contract` + `list_contracts` Resource.

## Coverage Floor

- Pre-Phase-6 (post-Phase-5): 1346 tests baseline (per STATE.md). Phase 6 baseline check.
- Post-Phase-6 estimate: 1346 + ~80 new tests = ~1426 tests. Concrete count documented in `docs/v2/PHASE-6-SIGN-OFF.md` at sign-off time via `npm test 2>&1 | tail`.
- Zero regressions in the 1346 pre-Phase-6 tests.
- `npm run eval:baseline` byte-identical (v1 tool responses unchanged; Phase 6 is purely additive).

## Risk Sampling

High-risk areas requiring extra test density (per RESEARCH §Pitfalls + §Security):

1. **Pitfall F1 (SDK rejects raw JSON Schema)** — covered by `input-schema.test.ts` Test 10 (asserts `zodSchema instanceof z.ZodObject === true`).
2. **Pitfall F2 (additionalProperties default)** — covered by `input-schema.test.ts` Test 11 (typo'd input key rejected).
3. **Pitfall F3 (namespace collision with Phase 2 `_contracts/memory/`)** — covered by `loader.test.ts` Tests 2 + 11.
4. **Pitfall F4 (peer-MCP zombie processes)** — covered by `mcp-clients.test.ts` Test 4 + SIGTERM/SIGINT registration verified manually in 06-03 Task 5 server-wiring test.
5. **Pitfall F6 (peer-MCP outputs fabricating DocIds)** — covered by C-3 invariant in ADR-006 + `instantiate.test.ts` Test 12 (write_back.doc_id sourced from DeliveryAdapter, not from step output template).
6. **C-7 template injection invariant** — covered by `templates.test.ts` "critical invariant" test (inputs containing `{{...}}` are NOT recursively re-substituted).
7. **MEM-05 un-bypassable** — covered by `instantiate.test.ts` Test 7 (sink_override pointing at non-MemorySink rejected).
8. **C-5 audit payload-free** — enforced by TypeScript signature in `src/contracts/audit.ts`; test 12 in `audit.test.ts` asserts tsc rejects any attempt to pass `output`/`payload`.

---

*Validation strategy created: 2026-05-18 (extracted from 06-RESEARCH.md per plan-checker non-blocking concern 5)*
*Last updated: 2026-05-18*
