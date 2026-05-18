---
phase: 06-task-contract-dsl
plan: 01
subsystem: contracts
tags: [adr, foundations, contract-audit, types-catalog, json-schema, registry]
requires: [phase-5-sign-off, MEM-05-chokepoint, ADR-005-llm-ladder]
provides:
  - ADR-006
  - migration-014-contract_audit
  - vault.db.contractAudit
  - "[contracts] config block"
  - TYPES_CATALOG (DocId/Handle/ChunkId/MemorySink)
  - resolveRefs ($ref → catalog)
  - buildInputSchema (Pitfall F1/F2 chokepoint)
  - ContractRegistry (first-wins)
  - slugify (zero-dep)
  - recordContractStep/LoadError + aggregateVerbUsage (C-5)
  - ContractFileSchema (Zod for v1 YAML shape)
  - CONTRACT_PATH_REGEX
  - InstantiateError closed 12-reason union
affects:
  - src/db/schema.ts (migration 014 added)
  - src/db/database.ts (contractAudit wired)
  - src/types.ts (AppConfig.contracts added)
  - src/config/loader.ts (ContractsConfigSchema added)
tech-stack:
  added: []        # zero new deps — yaml@2.9 already installed (Phase 0)
  patterns:
    - "Migration analog runMigration013 → runMigration014 (DDL-only)"
    - "Three-line Database wiring (BriefSourcesQueries analog)"
    - "Zod .optional().default() for backwards-compatible config blocks"
    - "Closed discriminated union for error envelopes (sealed for v2.0.0)"
    - "Object.freeze for additive-only catalogs"
    - "z.fromJSONSchema chokepoint for SDK 1.29 inputSchema compatibility"
key-files:
  created:
    - docs/v2/adr/006-task-contract-dsl.md
    - src/db/queries/contract-audit.ts
    - src/db/queries/contract-audit.test.ts
    - src/contracts/types.ts
    - src/contracts/types-catalog.ts
    - src/contracts/types-catalog.test.ts
    - src/contracts/json-schema-ref.ts
    - src/contracts/json-schema-ref.test.ts
    - src/contracts/input-schema.ts
    - src/contracts/input-schema.test.ts
    - src/contracts/registry.ts
    - src/contracts/registry.test.ts
    - src/contracts/slug.ts
    - src/contracts/slug.test.ts
    - src/contracts/audit.ts
    - src/contracts/audit.test.ts
    - src/contracts/schema.ts
    - src/contracts/schema.test.ts
    - src/contracts/index.ts
    - src/contracts/loader.test.ts (Wave-0 stub)
    - src/contracts/templates.test.ts (Wave-0 stub)
    - src/contracts/mcp-clients.test.ts (Wave-0 stub)
    - src/contracts/verbs/index.test.ts (Wave-0 stub)
    - src/contracts/instantiate.test.ts (Wave-0 stub)
    - src/contracts/describe.test.ts (Wave-0 stub)
    - src/contracts/auto-register.test.ts (Wave-0 stub)
    - src/contracts/resources.test.ts (Wave-0 stub)
    - src/contracts/reference-contracts.test.ts (Wave-0 stub)
  modified:
    - src/db/schema.ts
    - src/db/database.ts
    - src/types.ts
    - src/config/loader.ts
    - src/config/loader.test.ts
decisions:
  - "ADR-006 dual MCP surface: generic instantiate_contract + per-vault auto_register_tools (default OFF, A7 tool_prefix .min(1))"
  - "Closed 11-verb assembly enum + literal + mcp:// peer (no write verbs in the set — D-A2a)"
  - "contract_audit is a NEW table (NOT extending write_audit) per Q-AUD; FK constraint on write_audit.note_id blocks orchestration rows"
  - "Sealed 12-reason InstantiateError discriminated union (incl. ambiguous_vault per WARNING-6 for server dispatch level)"
  - "Type catalog with x-validator: memory-sink extension keyword; survives z.fromJSONSchema unchanged (Assumption A3 verified)"
  - "CONTRACT_PATH_REGEX = ^_contracts/[^/]+\\.yaml$ (Pitfall F3 non-recursion)"
  - "Wave-0 stubs use it.todo() (one per file) so vitest accepts the file"
metrics:
  duration: "~25 min"
  tasks_completed: 5
  files_created: 30
  files_modified: 5
  net_new_tests: 50  # 9 contract-audit + 19 config (incl 11 new) + 20 contracts/* foundation
  test_floor: 1445   # 1395 baseline → 1445 passed + 9 todo
  tools_added: 0
  new_runtime_deps: 0
  date_completed: "2026-05-18"
---

# Phase 06 Plan 01: Foundations Summary

One-liner: ADR-006 + migration 014 (`contract_audit`) + `[contracts]` config block + `src/contracts/` foundations (types, catalog, $ref resolver, input-schema, registry, slugifier, audit writers, ContractFileSchema) plus 9 Wave-0 test stubs — the substrate every other Phase 6 slice depends on, with zero MCP surface changes and zero new runtime deps.

## Commits

| Task | Commit | Description |
|---|---|---|
| 6-01-01 | `eac3cc4` | ADR-006 task contract DSL |
| 6-01-02 | `e2c3461` | Migration 014 + ContractAuditQueries |
| 6-01-03 | `cd59d7d` | `[contracts]` config block |
| 6-01-04 | `ed51845` | TYPES_CATALOG + $ref resolver + buildInputSchema |
| 6-01-05 | `bdb3978` | ContractRegistry + slug + audit writer + ContractFileSchema + Wave-0 stubs |

## What landed

### ADR-006 (Task 1)

Phase 6 ADR authored BEFORE any orchestration code (mirrors Phase 0/2/4/5 discipline). Resolves the full Phase 6 decision graph in 13 numbered Decision sections:

1. Dual MCP surface (D-A1/A1b/A1c) — generic `instantiate_contract` always on; per-vault `auto_register_tools` (default OFF); tool_prefix `vm_` (A7 .min(1)).
2. Closed assembly verb enum + `literal` + `mcp://...` (D-A2a / C-1).
3. `list_contract_verbs` Resource + `contract_audit` signal (D-A2b / Q-AUD).
4. Step composition via `as:` aliases and `{{...}}` templates (D-A2c).
5. JSON-Schema-with-$ref input shape + type catalog (D-A3a/b).
6. Override semantics — handle name, strict validation, MemorySink-only sinks (D-A4a/b/c).
7. ChangeFeed hot reload (D-LOAD).
8. yaml@2.9 rationale (CON-12 satisfied by Phase 0).
9. Output validation timing (Q-OUTPUT) — bundle = `{steps, write_back}`; only `write_back.doc_id` is ground truth.
10. Step-level timeouts only on peer-MCP verbs (Q-TIMEOUT).
11. `describe_contract` returns `{json_schema, summary}` (Q-DESCRIBE).
12. CI evals inject `mockCompileBrief` (Q-CI-LLM option b).

Plus eight named invariants (C-1..C-8), a STRIDE Threat Model covering the eight enumerated patterns (T-1..T-8), a Rejected-Alternatives table, and a Forward-Compatibility note.

### Migration 014 + ContractAuditQueries (Task 2)

DDL-only migration; mirrors `runMigration013`:
- `contract_audit` table with `(id, kind, contract, verb, step_alias, vault, ts, error_message)` columns.
- `idx_contract_audit_kind_ts` and `idx_contract_audit_verb` indexes.
- Idempotent via `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`.

`ContractAuditQueries` exposes `insert`, `listByKind({limit?, vault?})`, `aggregateVerbUsage(vault)`. Aggregator filters to `kind = 'contract_step' AND verb IS NOT NULL` so load_error rows never inflate the histogram.

`vault.db.contractAudit` wired in `src/db/database.ts` per the BriefSourcesQueries three-line pattern.

### `[contracts]` config block (Task 3)

`AppConfigSchema` gains `ContractsConfigSchema` (`.optional().default(...)`):
- `auto_register_tools: boolean = false`
- `tool_prefix: string = "vm_"` (A7 enforced via `.min(1).regex(/^[a-z_][a-z0-9_]*$/)`)
- `step_timeout_seconds: number int positive = 30`
- `defaults: Record<string, string> = {}`
- `mcp_clients: Record<string, {command, args?, env?}> = {}`

Backwards-compat verified by Tests 1 + 10 + 11. `DEFAULT_CONFIG` also carries the contracts defaults so the ENOENT branch returns the documented shape.

Added `ContractsConfig` and `ContractsMcpClientConfig` types in `src/types.ts`.

### Type catalog + $ref resolver + buildInputSchema (Task 4)

- `TYPES_CATALOG` = frozen catalog of `DocId / Handle / ChunkId / MemorySink`. `MemorySink` carries the `x-validator: "memory-sink"` extension keyword.
- `resolveRefs(schema)` resolves `$ref: "#/types/<name>"` only — HTTP, file://, and JSON-Pointer forms throw synchronously (T-06-01-01 gate). YAML-author additions on the same node WIN (Example 3 spread order).
- `buildInputSchema(yamlInputs, required)` wraps to `{type:"object", properties, required, additionalProperties: false}` (Pitfall F2 fix) and returns `{zodSchema: ZodObject, jsonSchema: object}` (Pitfall F1 fix). Assumption A3 verified — `x-validator` survives `z.fromJSONSchema` unchanged.

### Registry + slug + audit writers + ContractFileSchema + barrel + 9 Wave-0 stubs (Task 5)

- `ContractRegistry` first-wins collision policy (D-A1c / C-4).
- `slugify(name, prefix)` zero-dep (assertion: source file has no `import` statements).
- `recordContractStep` / `recordContractLoadError` / `aggregateVerbUsage` — payload-free signatures enforced by TypeScript strict mode (C-5).
- `ContractFileSchema` Zod schema validates the three reference contracts (RESEARCH Examples 1/6/7) and rejects:
  - Missing `name`, missing `version`, `version: 2`.
  - Assembly step missing `as:`.
  - Duplicate `as:` aliases across the assembly array (superRefine).
  - Verbs outside the closed enum (write_note, arbitrary names, malformed mcp:// shape).
- `CONTRACT_PATH_REGEX` exported from `types.ts` for Plan 06-02's loader.
- `InstantiateError` closed 12-reason union (incl. `ambiguous_vault` for server dispatch).
- `src/contracts/index.ts` barrel surfaces Plan 06-01 modules ONLY (loader, templates, mcp-clients, verbs, instantiate, describe, auto-register, resources are NOT exported yet).
- 9 Wave-0 test stubs (each with one `it.todo()`) so Plans 06-02/03/04 fill them without scaffolding work.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Wave-0 stub files needed `it.todo()` for vitest acceptance**

- **Found during:** Task 5 — running `npx vitest run src/contracts/`
- **Issue:** Plan said "describe-block-only is acceptable so plans 06-02/03/04 can fill them without scaffolding work." Vitest 2.1.9 actually fails with "No test found in suite" on a `describe()` with an empty body.
- **Fix:** Each stub describe block now contains a single `it.todo("filled in by the slice referenced above")`. Stubs are still trivially fillable in later slices — `it.todo` reads as a placeholder by design.
- **Files modified:** 9 stub files under `src/contracts/`.
- **Commit:** `bdb3978`

**2. [Rule 3 — Blocking] `z.fromJSONSchema` strict typing required cast**

- **Found during:** Task 4 — `npx tsc --noEmit`
- **Issue:** Zod 4 types `JSONSchema.properties` as `Record<string, _JSONSchema>`. Our YAML inputs are `Record<string, unknown>` at the type system level (we cannot pre-type-check user YAML).
- **Fix:** Single-line `as unknown as Parameters<typeof z.fromJSONSchema>[0]` cast at the call site, with a comment explaining why structural compatibility at runtime is sound (the contract YAML is JSON Schema by construction).
- **Files modified:** `src/contracts/input-schema.ts`.
- **Commit:** `ed51845`

### Architectural Changes

None.

## Threat Surface Scan

Plan 06-01 adds the `contract_audit` table at a SQL trust boundary and the `[contracts.mcp_clients.*]` config block which carries a future spawn target. Both are in scope of the plan's `<threat_model>` and ADR-006 §Threat Model. No undocumented new surface.

## Known Stubs

The 9 Wave-0 test files are intentional stubs documented in the plan and ADR-006 (Decision §7). Each contains a single `it.todo()`. They are NOT a stub of user-facing behavior — they are scaffolding for Plans 06-02/03/04 to fill. None of them appear in the production code path.

## Verification

- `npm test` → 1445 passed | 11 skipped | 9 todo (1465 total). Phase 5 baseline of 1395 preserved + 50 net new tests in this slice.
- `npx tsc --noEmit` → clean.
- `bash scripts/lint-adapters.sh` → zero hits in `src/contracts/`.
- `npm run eval:baseline` → 30 passed | 11 skipped — v1 baseline preserved.
- `evals/v1-baseline/tools-list.snapshot.json` → 34 tools unchanged (no MCP surface changes in this slice).

## What's next

Plan 06-02 (loader + ChangeFeed hot reload) will:
- Implement `src/contracts/loader.ts` — boot scan of `^_contracts/[^/]+\.yaml$` via Phase 1 ChangeFeed, parse via yaml@2.9, validate via `ContractFileSchema`, build input schema via `buildInputSchema`, register via `ContractRegistry`.
- Wire `register_contracts_as_tools` MCP Tool.
- Fill `src/contracts/loader.test.ts` stub with the actual loader tests.

## Self-Check: PASSED

Files created (key set sampled):
- FOUND: docs/v2/adr/006-task-contract-dsl.md
- FOUND: src/db/queries/contract-audit.ts
- FOUND: src/contracts/types.ts
- FOUND: src/contracts/types-catalog.ts
- FOUND: src/contracts/json-schema-ref.ts
- FOUND: src/contracts/input-schema.ts
- FOUND: src/contracts/registry.ts
- FOUND: src/contracts/slug.ts
- FOUND: src/contracts/audit.ts
- FOUND: src/contracts/schema.ts
- FOUND: src/contracts/index.ts
- FOUND: 9 Wave-0 stub test files

Commits verified in `git log --oneline`:
- FOUND: eac3cc4 (ADR-006)
- FOUND: e2c3461 (migration 014)
- FOUND: cd59d7d ([contracts] config)
- FOUND: ed51845 (TYPES_CATALOG + $ref + buildInputSchema)
- FOUND: bdb3978 (Registry + slug + audit + schema + stubs)
