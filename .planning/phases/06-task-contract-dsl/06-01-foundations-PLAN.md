---
phase: 06-task-contract-dsl
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - docs/v2/adr/006-task-contract-dsl.md
  - src/db/schema.ts
  - src/db/queries/contract-audit.ts
  - src/db/queries/contract-audit.test.ts
  - src/db/database.ts
  - src/config/loader.ts
  - src/config/loader.test.ts
  - src/contracts/index.ts
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
  - src/contracts/loader.test.ts
  - src/contracts/templates.test.ts
  - src/contracts/mcp-clients.test.ts
  - src/contracts/verbs/index.test.ts
  - src/contracts/instantiate.test.ts
  - src/contracts/describe.test.ts
  - src/contracts/auto-register.test.ts
  - src/contracts/resources.test.ts
  - src/contracts/reference-contracts.test.ts
autonomous: true
requirements:
  - CON-11
  - CON-12
  - CON-01
user_setup: []

must_haves:
  truths:
    - "ADR-006 exists in git BEFORE any src/contracts/loader.ts or src/contracts/instantiate.ts implementation commit (mirrors Phase 0/2/4/5 discipline)."
    - "ADR-006 resolves D-A1/D-A1b/D-A1c (dual MCP surface + per-vault config gate + tool_prefix), D-A2a (closed-baseline verb enum + literal + mcp:// extension), D-A2b (list_contract_verbs Resource + contract_audit signal), D-A2c (mustache template grammar), D-A3a/D-A3b (JSON-Schema-with-$ref input shape + type catalog), D-A4a/D-A4b/D-A4c (handle-name overrides + strict validation + MemorySink-only sink invariant), D-LOAD (ChangeFeed hot reload), Q-AUD (separate contract_audit table), Q-TIMEOUT (wrap only peer-MCP verbs in step_timeout_seconds), Q-OUTPUT (output_shape validates the {steps, write_back} bundle returned to caller), Q-DESCRIBE (describe_contract returns {json_schema, summary} markdown), Q-CI-LLM (WARNING-4: CI eval scenarios mock compile_brief deterministically; LLM ladder proven by Phase 5 tests, not Phase 6 evals)."
    - "ADR-006 documents the CON-12 rationale that `yaml@^2.9.0` (already installed via Phase 0 ADP-08) satisfies the requirement's `^2.6` floor — no `npm install` is performed in Phase 6."
    - "After `db.migrate()`, a `contract_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, contract TEXT, verb TEXT, step_alias TEXT, vault TEXT, ts INTEGER NOT NULL, error_message TEXT)` table exists with `idx_contract_audit_kind_ts (kind, ts)` and `idx_contract_audit_verb (verb)`; migration is version 14."
    - "`vault.db.contractAudit` is wired onto Database (mirrors `vault.db.briefSources` wiring shape from Plan 05-01)."
    - "`src/config/loader.ts` AppConfigSchema accepts an optional `[contracts]` block with: `auto_register_tools: boolean (default false)`, `tool_prefix: string regex /^[a-z_][a-z0-9_]*$/ default \"vm_\"` (Zod .min(1) — A7), `step_timeout_seconds: positive int default 30`, `defaults: Record<string,string> default {}`, `mcp_clients: Record<string, {command, args?, env?}> default {}`. Existing config.toml files without `[contracts]` parse byte-identical (backwards-compatible per Example 5)."
    - "`src/contracts/types-catalog.ts` exports a `TYPES_CATALOG` constant with the 4 declared types (DocId, Handle, ChunkId, MemorySink) — MemorySink carries `x-validator: 'memory-sink'`; ChunkId pattern matches Phase 5 ADR-003 H-5 (`^[a-z][a-z0-9-]*://.+#chunk-[0-9a-f]{7}$`)."
    - "`src/contracts/json-schema-ref.ts` `resolveRefs(schema)` resolves `$ref: '#/types/<name>'` against TYPES_CATALOG; YAML-author additions on the same node win (spread order matches Example 3); unknown ref form or unknown target throws synchronously."
    - "`src/contracts/input-schema.ts` `buildInputSchema(yamlInputs, required)` wraps to `{type:'object', properties, required, additionalProperties: false}` (Pitfall F2 fix) and returns `{zodSchema: ZodObject, jsonSchema: object}`; the `x-validator: 'memory-sink'` extension keyword passes through unchanged (Assumption A3 verified in test)."
    - "`src/contracts/slug.ts` `slugify(name, prefix)` plain string replace (kebab → snake, then prefix); zero deps; collides only on intentional same-name (D-A1c first-wins)."
    - "`src/contracts/registry.ts` ContractRegistry is a `Map<name, ParsedContract>` wrapper with `set`/`get`/`delete`/`entries`/`size`; same-name `set` returns a structured `{ok: false, reason: 'duplicate_name'}` (caller writes contract_audit row); does NOT mutate registry on duplicate."
    - "`src/contracts/audit.ts` exports `recordContractStep(deps, {contract, verb, step_alias, vault})` + `recordContractLoadError(deps, {file, error_message, vault})` + `aggregateVerbUsage(deps, vault) → {verb, invocation_count, last_seen}[]`; all three use `vault.db.contractAudit` only — NEVER store verb output payloads (security pattern from RESEARCH §Security)."
    - "Wave-0 stub test files exist for every later-slice module (loader.test.ts, templates.test.ts, mcp-clients.test.ts, verbs/index.test.ts, instantiate.test.ts, describe.test.ts, auto-register.test.ts, resources.test.ts, reference-contracts.test.ts) — describe-block-only is acceptable so plans 06-02/03/04 can fill them without scaffolding work."
    - "Branded ParsedContract, ContractStep, ContractInputs, OverrideMap, WriteBackSpec, and the discriminated InstantiateError union (closed enum of 12 reasons per RESEARCH Claude's Discretion + Q-OUTPUT + WARNING-6 patch) are exported from `src/contracts/types.ts`."
    - "`src/contracts/schema.ts` Zod schema for the YAML contract file shape exists and validates the three Example 1/6/7 reference contracts (loaded as text via `parseDocument` in unit tests) — but the loader.ts that wires it to ChangeFeed lands in Plan 06-02."
    - "All 1346+ existing tests stay green (Phase 5 baseline); scripts/lint-adapters.sh emits zero hits inside `src/contracts/` (no `fs`, `path.join`, `gray-matter`, `chokidar` imports — adapter-seam discipline per ADR-002 I-1)."
  artifacts:
    - path: "docs/v2/adr/006-task-contract-dsl.md"
      provides: "Phase 6 ADR — dual MCP surface (D-A1), closed verb enum + literal + mcp:// (D-A2a), contract_audit signal (D-A2b), mustache templates (D-A2c), JSON-Schema-with-$ref inputs (D-A3a/b), strict overrides (D-A4a/b), MemorySink-only sink invariant (D-A4c), ChangeFeed hot reload (D-LOAD), yaml@2.9 rationale (CON-12)"
      contains: "## Decision"
    - path: "src/db/schema.ts"
      provides: "runMigration014 appended to MIGRATIONS array (version 14) — contract_audit table with kind/contract/verb/step_alias/vault/ts/error_message + two indexes"
      contains: "runMigration014"
    - path: "src/db/queries/contract-audit.ts"
      provides: "ContractAuditQueries — insert (single row, no batch — contract orchestration is per-step), listByKind, aggregateVerbUsage; mirrors AuditQueries shape"
      contains: "class ContractAuditQueries"
    - path: "src/config/loader.ts"
      provides: "AppConfigSchema extended with optional [contracts] block; backwards-compatible (.optional().default(...))"
      contains: "ContractsConfigSchema"
    - path: "src/contracts/types.ts"
      provides: "ParsedContract, ContractStep, ContractInputs, OverrideMap, WriteBackSpec, InstantiateError closed union (12 reasons incl. ambiguous_vault), ContractAuditRow"
      contains: "ParsedContract"
    - path: "src/contracts/types-catalog.ts"
      provides: "TYPES_CATALOG with DocId, Handle, ChunkId, MemorySink (x-validator: memory-sink)"
      contains: "TYPES_CATALOG"
    - path: "src/contracts/json-schema-ref.ts"
      provides: "resolveRefs(schema) — $ref: '#/types/<name>' resolver (~20 LOC) per Example 3"
      contains: "resolveRefs"
    - path: "src/contracts/input-schema.ts"
      provides: "buildInputSchema(yamlInputs, required) → {zodSchema, jsonSchema} — wraps with additionalProperties: false (Pitfall F2)"
      contains: "buildInputSchema"
    - path: "src/contracts/registry.ts"
      provides: "ContractRegistry — Map<name, ParsedContract> + first-wins collision policy"
      contains: "class ContractRegistry"
    - path: "src/contracts/slug.ts"
      provides: "slugify(name, prefix) — kebab→snake + prefix prepend (no deps per RESEARCH Anti-Patterns)"
      contains: "export function slugify"
    - path: "src/contracts/audit.ts"
      provides: "recordContractStep + recordContractLoadError + aggregateVerbUsage — all route through vault.db.contractAudit only"
      contains: "recordContractStep"
    - path: "src/contracts/schema.ts"
      provides: "ContractFileSchema — Zod for the YAML contract shape (version, name, description, inputs, sources, sinks, assembly, output_shape, write_back)"
      contains: "ContractFileSchema"
    - path: "src/contracts/index.ts"
      provides: "Plan 06-01 barrel (only foundation modules; loader/instantiate/describe/resources land in later slices)"
      contains: "export"
  key_links:
    - from: "src/db/database.ts"
      to: "src/db/queries/contract-audit.ts"
      via: "import + constructor wiring (vault.db.contractAudit)"
      pattern: "new ContractAuditQueries"
    - from: "src/db/schema.ts"
      to: "MIGRATIONS array"
      via: "version 14 entry — contract_audit table"
      pattern: "version: 14"
    - from: "src/contracts/input-schema.ts"
      to: "src/contracts/json-schema-ref.ts"
      via: "resolveRefs is called before z.fromJSONSchema to expand $ref nodes"
      pattern: "resolveRefs"
    - from: "src/contracts/schema.ts"
      to: "src/contracts/json-schema-ref.ts"
      via: "inputs/output_shape Zod schema accepts $ref-shaped objects; resolveRefs runs at load time"
      pattern: "resolveRefs"
    - from: "src/config/loader.ts"
      to: "AppConfigSchema"
      via: "ContractsConfigSchema attached as optional with .default()"
      pattern: "contracts:"
---

<objective>
Foundations slice. Author ADR-006 BEFORE any orchestration code (matches Phase 0/2/4/5 discipline). Ship the substrate every other Phase 6 slice depends on: migration 014 (`contract_audit` table per Q-AUD), the `[contracts]` config block (Example 5, backwards-compatible), the type catalog + `$ref` resolver + JSON-Schema-to-Zod wrapper (D-A3a/b), the ContractRegistry shell, the slugifier (D-A1c), the contract-audit writer/aggregator, the YAML contract Zod schema (CON-01), and Wave-0 test stubs for every later module.

Purpose: CON-11 (Phase 6 ADR) + CON-12 (yaml dep + rationale doc — already installed; ADR carries the rationale) + the foundational half of CON-01 (Zod schema for the YAML shape; comment-preserving round-trip is exercised in Plan 06-02's loader where `parseDocument` actually runs). No MCP surface changes in this slice — the contract registry is empty at end of plan; agents see no behavior change.

Output: ADR-006 in `docs/v2/adr/`, migration 014 + ContractAuditQueries wired onto Database, AppConfigSchema extended with `[contracts]` (backwards-compatible), 8 new modules in `src/contracts/` (types, types-catalog, json-schema-ref, input-schema, registry, slug, audit, schema, index barrel), 9 Wave-0 test stub files for plans 06-02/03/04, 1346-test floor holds, lint-adapters zero hits.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/06-task-contract-dsl/06-CONTEXT.md
@.planning/phases/06-task-contract-dsl/06-RESEARCH.md
@.planning/phases/06-task-contract-dsl/06-VALIDATION.md
@.planning/phases/05-compiled-brief-layer/05-CONTEXT.md
@docs/v2/PHASE-5-SIGN-OFF.md
@docs/v2/adr/001-document-identity.md
@docs/v2/adr/002-adapter-seams.md
@docs/v2/adr/003-document-shape.md
@docs/v2/adr/004-memory-sink-handles.md
@docs/v2/adr/005-brief-compile-strategy.md
@docs/v2/MEMORY_CONTRACT.md
@docs/v2/ARCHITECTURE.md
@docs/v2/AGENT_AGNOSTIC.md
@src/types.ts
@src/db/schema.ts
@src/db/database.ts
@src/db/queries/audit.ts
@src/db/queries/brief_sources.ts
@src/db/queries/wikilinks.ts
@src/config/loader.ts
@src/memory/registry.ts
@src/memory/contract/default-v1.ts
@src/memory/contract/default-brief-v1.ts

<interfaces>
<!-- Canonical contracts the executor must follow. Do not explore the codebase beyond these. -->

From src/db/schema.ts:957 — MIGRATIONS array layout (append-only). Current head version 13. Phase 6 appends version 14. The runMigration14 function follows the same shape as runMigration013 (Phase 5) and runMigration011 (Phase 4) — see Plan 05-01 for the canonical analog. No backfill needed for migration 014 because contract_audit is a brand-new table with no existing rows to migrate.

From src/db/queries/audit.ts — AuditQueries class shape (snake_case columns ↔ camelCase API at row boundary, prepared statements, transactional batch insert via db.transaction). ContractAuditQueries mirrors this verbatim minus the batch insert (orchestration writes one row per step).

From src/db/database.ts — three-line wiring pattern Phase 5 used for briefSources/daemonState: import + readonly field declaration + ctor construction after this.migrate(). ContractAuditQueries lands the same way.

From src/config/loader.ts — AppConfigSchema is a Zod object; the existing `[brief.ollama]` block lands as an optional nested object with `.optional().default(...)` for backwards compatibility. The `[contracts]` block follows the same pattern. Per-vault scope: lives in `~/.vault-memory/config.toml` under each vault entry (per D-A1b — NOT global).

From src/memory/contract/default-v1.ts:25-83 — Zod schema authoring style for contract files (descriptive .describe() on every field, .superRefine for cross-field invariants, exported PascalCase Schema + camelCase parse helper). ContractFileSchema in `src/contracts/schema.ts` follows the same style.

From src/memory/registry.ts:142,190 — `resolveMemorySink(handle)` + `findSinkContaining(uri)`. D-A4c sink-override validation will call `resolveMemorySink` directly in Plan 06-03; Plan 06-01 only references the API in ADR-006 prose.

From Plan 05-01 frontmatter and src/types.ts — DocId branded type pattern (`export type DocId = string & { readonly __brand: "DocId" }`). Plan 06-01 reuses DocId; does NOT re-brand. The ContractName is NOT branded in Phase 6 (kept as plain string per YAGNI; promotion path exists).

From src/contracts (does not exist yet — confirmed via `ls` at planning time): the entire directory is greenfield. No imports to worry about colliding.

From scripts/lint-adapters.sh — CI grep enforces zero `fs`/`path.join`/`gray-matter`/`chokidar` outside adapter dirs. `src/contracts/` is subject to this rule from day one. ZERO exemptions in Plan 06-01 — all foundation files are pure code with no I/O. Plan 06-02's loader.ts and Plan 06-03's mcp-clients.ts also have zero `fs`/`path.join` imports (they delegate to SourceConnector / SDK Client respectively).

From RESEARCH.md §Don't Hand-Roll — `z.fromJSONSchema()` is the only way to convert JSON Schema to Zod; SDK 1.29's `registerTool({inputSchema})` REJECTS plain JSON Schema literals (Pitfall F1). buildInputSchema is the chokepoint that prevents this trap.

From RESEARCH.md §Pitfall F2 — `z.fromJSONSchema` honors `additionalProperties` from input; buildInputSchema MUST set `additionalProperties: false` explicitly before passing to fromJSONSchema or typo'd input keys are silently dropped at runtime.

From RESEARCH.md §A3 — `x-validator: 'memory-sink'` extension keyword passes through z.fromJSONSchema unchanged (verified in REPL). Plan 06-01 unit-tests this with a tiny `it("x-validator extension survives fromJSONSchema")` case. If the assumption holds (it does per A3), no stripping step is needed.

From RESEARCH.md §Pitfall F3 — task-contract loader (Plan 06-02) scans only top-level `_contracts/*.yaml`; Plan 06-01 does NOT scan anything but DOES define the path-matcher regex constant `^_contracts/[^/]+\.yaml$` and exports it from `src/contracts/index.ts` for Plan 06-02 to consume.

From RESEARCH.md §A11 — current migration head is 13 (verified). Plan 06-01 appends 14.

From `evals/v1-baseline/tools-list.snapshot.json` (34 entries verified) — Plan 06-01 does NOT regenerate the snapshot (no tools added in this slice). Plan 06-04 handles the additive snapshot regen (+3 tools: describe_contract, instantiate_contract, register_contracts_as_tools).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 6-01-01: Author ADR-006 — task contract DSL (D-A1..D-LOAD + Q-AUD/Q-TIMEOUT/Q-OUTPUT/Q-DESCRIBE/Q-CI-LLM + CON-12 yaml rationale)</name>
  <files>docs/v2/adr/006-task-contract-dsl.md</files>
  <action>
    Author the Phase 6 ADR following the structural analog `docs/v2/adr/005-brief-compile-strategy.md`. The ADR must land BEFORE any `src/contracts/loader.ts` or `src/contracts/instantiate.ts` implementation commit (matches Phase 0/2/4/5 discipline). Sections in order:

    1. `## Context` — cite v2 PROJECT.md thesis ("user-defined task contracts that any MCP-aware agent can discover and instantiate"); cite Phase 5 D-01 hand-off ("caller-supplied source set — Phase 6 contract DSL formalizes auto-discovery declaratively"); cite REL-08 tool-budget pressure (Phase 6 adds 3 tools → 37 total, REL-08 reconciliation deferred to Phase 8 per Pitfall F7); cite the namespace collision warning (Pitfall F3 — `_contracts/memory/*.yaml` belongs to Phase 2 MemoryContract loader, NOT this DSL).

    2. `## Decision: Dual MCP surface — generic + auto-register` (D-A1, D-A1b, D-A1c). Document: (a) generic `instantiate_contract` always available; (b) per-contract auto-registration as MCP Tools is gated by per-vault `[contracts] auto_register_tools = false` (default OFF, A7-validated tool_prefix must be Zod .min(1)); (c) tool_prefix is user-configurable string default `vm_` (D-A1c departure from researcher recommendation `contract_` — captured here verbatim); (d) ChangeFeed events trigger `McpServer.sendToolListChanged()` (high-level SDK 1.29 API per RESEARCH §3, NOT the lower-level `server.notification(...)` CONTEXT.md mentioned); (e) `register_contracts_as_tools({vault?})` is always callable regardless of config (explicit-control escape valve); (f) snapshot-stability story (default-OFF keeps `evals/v1-baseline/tools-list.snapshot.json` stable across deployments).

    3. `## Decision: Closed assembly verb enum + literal escape + mcp:// extension` (D-A2a). List the 11 baseline verbs verbatim. Document the THREE structural mechanisms that enforce the memory-namespace invariant by construction: (1) no write verbs in the assembly enum; (2) `write_back:` structurally separate from `assembly:`; (3) `sink_overrides` resolves to a registered MemorySink only (D-A4c). Document Pitfall-equivalent: a peer-MCP server that exposes write tools is responsible for its OWN backing-store invariants (vault-memory only guarantees its own MemorySink invariants — peer-MCP outputs land as advisory step bindings, not as DocIds).

    4. `## Decision: Custom-verb housekeeping — list_contract_verbs Resource + contract_audit signal` (D-A2b + Q-AUD). Resource at `vault-memory://contract-verbs/{vault}` returns `{baseline: [...], custom: [...]}` with `invocation_count` + `last_seen` aggregated from `contract_audit` rows. Q-AUD resolution: NEW `contract_audit` table (migration 014) — NOT extending `write_audit`, because `write_audit.note_id INTEGER NOT NULL` foreign-key constraint blocks orchestration rows (same wall Phase 5 daemon hit per RESEARCH §Don't Hand-Roll). Audit rows store `{kind, contract, verb, step_alias, vault, ts, error_message?}` ONLY — NEVER step output payloads (Security pattern from §Security: peer-MCP outputs may contain sensitive data; we don't capture them in SQLite).

    5. `## Decision: Step composition — named bindings + {{alias.field}} mustache` (D-A2c). Every step has required `as:` alias (Zod-enforced). `{{inputs.<name>}}` references contract inputs uniformly. Resolver runs AFTER Zod input validation and BEFORE verb dispatch. Undefined alias/field → `{ok: false, reason: 'unresolved_template', expression}`. Note the security invariant: templates only operate on contract YAML (read at boot), NEVER on user-supplied inputs at call time — inputs are pure values, never re-evaluated as templates (RESEARCH §Security threat: template injection mitigation).

    6. `## Decision: JSON Schema subset embedded in YAML + #/types/ catalog $ref` (D-A3a, D-A3b). Supported keywords: `type, description, pattern, enum, format, default, required, additionalProperties`. Internal wrap as `{type:'object', properties, required, additionalProperties: false}` (Pitfall F2 fix). Type catalog: `DocId, Handle, ChunkId, MemorySink`. `MemorySink` carries `x-validator: 'memory-sink'` extension keyword triggering runtime `MemorySinkRegistry.resolveMemorySink()` at instantiation time. Catalog is additive-only (Phase 10 may extend `DocId.pattern` for `notion://`; never narrow). The Zod 4 `fromJSONSchema` API is REQUIRED — SDK 1.29 `registerTool({inputSchema})` REJECTS raw JSON Schema literals (Pitfall F1).

    7. `## Decision: Override semantics — handle-name + strict validation + MemorySink-only sinks` (D-A4a, D-A4b, D-A4c). Override target = contract-declared handle name (NOT URI scheme). Default chain: explicit override → `[contracts.defaults.<handle>]` → contract YAML literal → error if `required: true`. Closed error envelope enum: `unknown_contract, invalid_inputs, unknown_override_handle, missing_required_source, sink_override_not_a_memory_sink, unresolved_template, verb_not_available, mcp_client_unavailable, assembly_step_failed, write_back_failed, validation_failed_on_output_shape, ambiguous_vault` (12 reasons; sealed for v2.0.0). The `ambiguous_vault` reason fires from the server-level `instantiate_contract`/`describe_contract` tool handlers when the caller omits `vault` and multiple vaults are configured; carries `available_vaults: string[]` for client-side disambiguation. Including it in the same closed union (rather than a wrapper envelope) keeps callers parsing a single discriminated union.

    8. `## Decision: Hot reload via ChangeFeed` (D-LOAD). Mirrors Phase 5 daemon Phase-5-D-07 "in-process at server boot" pattern. Boot scan ONLY top-level `_contracts/*.yaml` (regex `^_contracts/[^/]+\.yaml$` — Pitfall F3 non-recursion: `_contracts/memory/*.yaml` belongs to Phase 2 MemoryContract loader). ChangeFeed events: create/update → re-parse + re-validate + mutate registry + emit `tools/list_changed` if auto-register ON; delete → remove + emit; rename → unlink+add (per Phase 1 obsidian-fs semantics); parse-failure → keep prior registry version (graceful degradation) + write `contract_audit` `kind: 'contract_load_error'`. Multi-process compatibility: no lock (read-only on FS; each process converges).

    9. `## Decision: yaml@2.9 rationale (CON-12 satisfied by Phase 0 install)` — already installed at `^2.9.0` per Phase 0 ADP-08. CON-12's `^2.6` floor is satisfied. NO `npm install` in Phase 6. Rationale: `yaml@2.x` is the only library that round-trips comments byte-equivalent via `parseDocument` + `toJS()` + `toString()`; Phase 6 only READS contracts (round-trip preservation matters for Phase 7 Canvas authoring); empirical REPL verification per RESEARCH Assumption A1.

    10. `## Decision: Output validation timing (Q-OUTPUT)` — `output_shape` validates the bundle returned to caller, where bundle = `{steps: {[alias]: <output>}, write_back: {doc_id: <real DocId from DeliveryAdapter.write> | null}}`. Intermediate step outputs are advisory, not authoritative (Pitfall F6). Only `write_back.doc_id` is ground-truth (sourced from `DeliveryAdapter.write()` response, NOT from a step output template — this is the MEM-05 chokepoint guarantee).

    11. `## Decision: Step-level timeouts (Q-TIMEOUT)` — wrap ONLY peer-MCP verbs in `Promise.race([fn(), timeoutAfter(step_timeout_seconds)])`. Baseline verbs are local SQLite/Ollama with their own timeout discipline; wrapping them adds latency overhead + flaky-test surface for no benefit. Default `step_timeout_seconds = 30`.

    12. `## Decision: describe_contract output shape (Q-DESCRIBE)` — returns `{json_schema, summary}`. `summary` is auto-generated markdown per RESEARCH §Q-DESCRIBE template (Inputs / Sources / Sinks / Assembly numbered list / write_back / Output Shape). Pure function over ParsedContract. No LLM involved.

    13. `## Decision: CI eval LLM strategy (Q-CI-LLM)` — **WARNING-4 resolution: option (b) mock-in-CI.** The CON-08 (eval scenarios per contract) and CON-10 (stub-parity proof) tests run the orchestrator end-to-end against the three reference contracts (`meeting-prep`, `project-status`, `code-review-brief`), each of which terminates in `compile_brief`. Resolving the Phase 5 LLM ladder (MCP Sampling | Ollama | prepared_text) in CI couples our test pipeline to Ollama model availability + version drift, which Phase 5's own tests already cover. Therefore Phase 6 CI evals (Plan 06-04 Task 2 — `src/contracts/eval-runner.test.ts`) inject a deterministic `mockCompileBrief` that returns `{ok: true, doc_id: <deterministic slug under _memory/_briefs/>, body: <stub citing source_doc_ids>}`. This isolates the test to what Phase 6 actually owns: orchestration, override resolution, template binding, write_back chokepoint, output_shape validation. CON-09 (non-Claude smoketest) still proves the FULL end-to-end stack without an LLM by using `_contracts/smoketest-trivial.yaml` (literal-only assembly; no `compile_brief` step). The LLM ladder itself remains Phase 5's contract — Phase 6 inherits it for production use, but does NOT re-test it. Documented as a deliberate evaluation-scope decision, not a coverage gap.

    14. `## Invariants` — number these `C-1` (closed assembly verb set + no write verbs in enum, D-A2a), `C-2` (sink_overrides MUST resolve to a registered MemorySink, D-A4c — un-bypassable by construction), `C-3` (peer-MCP outputs are advisory bindings, not real DocIds — only DeliveryAdapter.write produces a real DocId, Pitfall F6), `C-4` (tool_prefix Zod .min(1) + first-wins collision policy, D-A1c + A7), `C-5` (contract_audit stores `{contract, verb, step_alias, vault, ts}` ONLY — never step output payloads, Security §I), `C-6` (boot scan and ChangeFeed dispatch filter to `^_contracts/[^/]+\.yaml$` — non-recursive, Pitfall F3), `C-7` (templates operate on contract YAML never on user-supplied inputs at call time, Security §Tampering), `C-8` (Q-CI-LLM: CI eval pipeline injects a deterministic `mockCompileBrief`; production paths use the Phase 5 LLM ladder unchanged — the mock is test-only and never reachable from `src/server.ts` wiring).

    15. `## Threat Model` — STRIDE table from RESEARCH §Security covering the 8 enumerated threat patterns (YAML billion-laughs DoS, template injection, peer-MCP command injection, arbitrary code execution via untrusted contract, memory-sink bypass, audit-log leakage, $ref to unknown URI, malicious auto-register). For each: STRIDE category + standard mitigation + reference to the C-N invariant that closes it.

    16. `## Rationale (rejected alternatives)` — for each Decision section above, list the rejected option per CONTEXT.md `<decisions>` rationale and CONTEXT.md `<deferred>`. Specifically call out: MCP Prompts surface rejected for CON-09 ChatGPT Custom Connector incompatibility (D-A1); open `tool: <any-registered-tool-name>` rejected for memory-namespace invariant bypass (D-A2a); macros / sub-contracts deferred to v2.x (Deferred); in-process TypeScript plugins rejected for v2 + v3 (Deferred); Q-CI-LLM rejected option (a) "require Ollama in CI" — adds Ollama-version dependency to Phase 6's CI and would re-test what Phase 5 already proves.

    17. `## Forward compatibility` — Phase 7 Canvas authoring will WRITE contracts (round-trip; yaml@2.9 was chosen for this); Phase 10 Notion connector grows the TYPES_CATALOG.DocId.pattern additively; v2.x may promote a peer-MCP verb into the baseline enum based on `contract_audit` `invocation_count` signal (D-A2b); v2.x may add `verb: macro:<name>` if Deferred macros prove worth shipping. NO breaking changes to ParsedContract.assembly[].verb literal set without a major version bump.

    The ADR must be reviewable in one read; aim for ~400-550 lines (13 Decision sections + Invariants + Threat Model + Rationale + Forward compatibility). NO codebase changes in this task — pure documentation. File path: `docs/v2/adr/006-task-contract-dsl.md`.
  </action>
  <verify>
    <automated>test -f docs/v2/adr/006-task-contract-dsl.md && grep -q "## Decision: Dual MCP surface" docs/v2/adr/006-task-contract-dsl.md && grep -q "## Decision: Closed assembly verb enum" docs/v2/adr/006-task-contract-dsl.md && grep -q "## Decision: Custom-verb housekeeping" docs/v2/adr/006-task-contract-dsl.md && grep -q "## Decision: Step composition" docs/v2/adr/006-task-contract-dsl.md && grep -q "## Decision: JSON Schema subset embedded in YAML" docs/v2/adr/006-task-contract-dsl.md && grep -q "## Decision: Override semantics" docs/v2/adr/006-task-contract-dsl.md && grep -q "## Decision: Hot reload via ChangeFeed" docs/v2/adr/006-task-contract-dsl.md && grep -q "## Decision: yaml@2.9 rationale" docs/v2/adr/006-task-contract-dsl.md && grep -q "## Decision: Output validation timing" docs/v2/adr/006-task-contract-dsl.md && grep -q "## Decision: Step-level timeouts" docs/v2/adr/006-task-contract-dsl.md && grep -q "## Decision: describe_contract output shape" docs/v2/adr/006-task-contract-dsl.md && grep -q "## Decision: CI eval LLM strategy" docs/v2/adr/006-task-contract-dsl.md && grep -q "## Invariants" docs/v2/adr/006-task-contract-dsl.md && grep -q "C-1" docs/v2/adr/006-task-contract-dsl.md && grep -q "C-8" docs/v2/adr/006-task-contract-dsl.md && grep -q "## Threat Model" docs/v2/adr/006-task-contract-dsl.md</automated>
  </verify>
  <done>ADR-006 exists with all 13 Decision sections (D-A1..D-LOAD + Q-AUD/Q-TIMEOUT/Q-OUTPUT/Q-DESCRIBE/Q-CI-LLM + yaml rationale) + Invariants C-1..C-8 + Threat Model + Rationale + Forward compatibility. Lints clean (no code changes).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 6-01-02: Migration 014 — contract_audit table + ContractAuditQueries + Database wiring (per Q-AUD)</name>
  <files>src/db/schema.ts, src/db/queries/contract-audit.ts, src/db/queries/contract-audit.test.ts, src/db/database.ts</files>
  <behavior>
    - Test 1: After `db.migrate()` on a fresh DB, the `contract_audit` table exists with columns `(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, contract TEXT, verb TEXT, step_alias TEXT, vault TEXT, ts INTEGER NOT NULL, error_message TEXT)` — verified via `PRAGMA table_info(contract_audit)`.
    - Test 2: Indexes `idx_contract_audit_kind_ts (kind, ts)` and `idx_contract_audit_verb (verb)` exist — verified via `PRAGMA index_list(contract_audit)`.
    - Test 3: Migration is registered as `version: 14` in the MIGRATIONS array — appended AFTER existing version 13 entry.
    - Test 4: Migration is idempotent — second `db.migrate()` call on an already-migrated DB does not throw, does not re-create the table (CREATE TABLE IF NOT EXISTS), does not duplicate indexes.
    - Test 5: `vault.db.contractAudit.insert({kind: 'contract_step', contract: 'meeting-prep', verb: 'search_hybrid', step_alias: 'related', vault: 'my-vault', ts: 1700000000})` writes one row; `vault.db.contractAudit.insert({kind: 'contract_load_error', vault: 'my-vault', ts: 1700000001, error_message: 'malformed yaml at line 5'})` writes a second row with NULL contract/verb/step_alias.
    - Test 6: `vault.db.contractAudit.listByKind('contract_step', {limit: 100})` returns rows ordered by `ts DESC`; `listByKind('contract_load_error')` filters correctly.
    - Test 7: `vault.db.contractAudit.aggregateVerbUsage('my-vault')` returns `[{verb, invocation_count, last_seen}]` from `SELECT verb, COUNT(*) AS invocation_count, MAX(ts) AS last_seen FROM contract_audit WHERE kind = 'contract_step' AND vault = ? GROUP BY verb ORDER BY invocation_count DESC` — verified with a seed of 5 rows across 2 verbs.
    - Test 8: Three existing baseline-verb-named rows + 2 `mcp://gh/list_issues` peer-verb rows aggregate into a 2-row result with correct counts/timestamps (regression: ensures aggregator handles both baseline and `mcp://` verb names uniformly).
    - Test 9: All 1346+ existing tests stay green.
  </behavior>
  <action>
    Implement migration 014 following the analog `runMigration013` at `src/db/schema.ts` (Phase 5; no backfill since contract_audit is greenfield — DDL-only).

    Step A — DDL idempotency:
    ```typescript
    function runMigration014(db: BetterSqliteDatabase): void {
      db.exec(`
        CREATE TABLE IF NOT EXISTS contract_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          contract TEXT,
          verb TEXT,
          step_alias TEXT,
          vault TEXT,
          ts INTEGER NOT NULL,
          error_message TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_contract_audit_kind_ts ON contract_audit(kind, ts);
        CREATE INDEX IF NOT EXISTS idx_contract_audit_verb ON contract_audit(verb);
      `);
    }
    ```

    Register migration in `MIGRATIONS` array (append AFTER existing entry version 13):
    ```typescript
    { version: 14, description: "contract_audit table — Phase 6 / CON-* / Q-AUD", run: runMigration014 }
    ```

    Create `src/db/queries/contract-audit.ts` per analog `src/db/queries/audit.ts` and `src/db/queries/brief_sources.ts` (Phase 5). Snake_case ↔ camelCase mapping at row boundary. Pure prepared statements; one row per insert (no batch — orchestration writes step-by-step).

    Public API:
    ```typescript
    export interface ContractAuditRow {
      kind: "contract_step" | "contract_load_error";
      contract?: string;
      verb?: string;
      stepAlias?: string;
      vault?: string;
      ts: number;            // unix ms
      errorMessage?: string;
    }

    export interface ContractAuditQueries {
      insert(row: ContractAuditRow): void;
      listByKind(kind: string, opts?: { limit?: number; vault?: string }): ContractAuditRow[];
      aggregateVerbUsage(vault: string): Array<{ verb: string; invocation_count: number; last_seen: number }>;
    }
    ```

    Implementation prepares four statements: `_insert`, `_listByKindAll`, `_listByKindAndVault`, `_aggregate`. The aggregator query is the exact text in RESEARCH §D-A2b: `SELECT verb, COUNT(*) AS invocation_count, MAX(ts) AS last_seen FROM contract_audit WHERE kind = 'contract_step' AND vault = ? GROUP BY verb ORDER BY invocation_count DESC` (use prepared statement with `?` bind; do NOT inline `kind = 'contract_step'` as a parameter — it's a constant filter for D-A2b semantics).

    Wire onto `Database` in `src/db/database.ts` (three-line pattern from `BriefSourcesQueries` at Plan 05-01): import `ContractAuditQueries`, declare `readonly contractAudit: ContractAuditQueries`, construct after `this.migrate()`.

    Co-locate `contract-audit.test.ts` building on `:memory:` DB + `db.migrate()` per Phase 5 idiom. Assert DDL via `db.prepare("PRAGMA table_info(contract_audit)").all()` and `PRAGMA index_list(contract_audit)`.

    Adapter-seam discipline: zero `fs`/`path.join`/`gray-matter`/`chokidar` imports. Comment block at top of `runMigration014` cites Phase 6 / Q-AUD and points to `runMigration013` analog.
  </action>
  <verify>
    <automated>npx vitest run src/db/queries/contract-audit.test.ts && npx tsc --noEmit && bash scripts/lint-adapters.sh && npm test</automated>
  </verify>
  <done>Migration 014 + ContractAuditQueries all green; Database wired with new namespace; 1346+ existing tests stay green; lint-adapters zero hits.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 6-01-03: AppConfigSchema [contracts] block (D-A1b, D-A1c, A7) + backwards-compat test</name>
  <files>src/config/loader.ts, src/config/loader.test.ts</files>
  <behavior>
    - Test 1: Parsing a config.toml WITHOUT any `[contracts]` section produces a vault config whose `contracts` field equals the documented defaults: `{auto_register_tools: false, tool_prefix: "vm_", step_timeout_seconds: 30, defaults: {}, mcp_clients: {}}` (backwards-compat — Example 5).
    - Test 2: Parsing `[contracts]\nauto_register_tools = true\ntool_prefix = "x_"` yields the overridden values; other fields keep defaults.
    - Test 3: Parsing `[contracts]\ntool_prefix = ""` REJECTS (Zod fails — A7 enforced: `.min(1)`).
    - Test 4: Parsing `[contracts]\ntool_prefix = "1bad"` REJECTS (regex `^[a-z_][a-z0-9_]*$` enforced).
    - Test 5: Parsing `[contracts.defaults]\ndefault_source = "obsidian-fs://my-vault"` populates `contracts.defaults.default_source` correctly.
    - Test 6: Parsing `[contracts.mcp_clients.gh]\ncommand = "gh-mcp-server"\nargs = ["--config", "/p"]\n` populates `contracts.mcp_clients.gh` as `{command: "gh-mcp-server", args: ["--config", "/p"], env: undefined}`.
    - Test 7: Parsing `[contracts]\nstep_timeout_seconds = 0` REJECTS (positive int constraint).
    - Test 8: Parsing `[contracts]\nstep_timeout_seconds = -5` REJECTS.
    - Test 9: Parsing `[contracts.mcp_clients.bad]\ncommand = ""` REJECTS (`z.string().min(1)` on command).
    - Test 10: All existing config.toml fixtures in tests still parse identically (backwards-compat regression).
  </behavior>
  <action>
    Extend `src/config/loader.ts` AppConfigSchema with the `[contracts]` block per RESEARCH Example 5 (lines 729-772). Implementation:

    ```typescript
    const McpClientConfigSchema = z.object({
      command: z.string().min(1).describe("Peer MCP server executable path"),
      args: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).optional(),
    });

    const ContractsConfigSchema = z.object({
      auto_register_tools: z.boolean().default(false).describe("D-A1b — per-vault gate for auto-registering contracts as MCP Tools"),
      tool_prefix: z.string().min(1).regex(/^[a-z_][a-z0-9_]*$/).default("vm_").describe("D-A1c — slug prefix for auto-registered tool names; A7 enforces non-empty"),
      step_timeout_seconds: z.number().int().positive().default(30).describe("Q-TIMEOUT — applied only to peer-MCP verbs (baseline verbs use their own discipline)"),
      defaults: z.record(z.string(), z.string()).default({}).describe("D-A4b — default chain step 2 — handle → URI"),
      mcp_clients: z.record(z.string(), McpClientConfigSchema).default({}).describe("D-A2a — peer MCP clients vault-memory connects to as an MCP client"),
    });

    // Inside AppConfigSchema (or VaultConfigSchema — match the existing `[brief.ollama]` placement from Plan 05-01):
    contracts: ContractsConfigSchema.optional().default({
      auto_register_tools: false,
      tool_prefix: "vm_",
      step_timeout_seconds: 30,
      defaults: {},
      mcp_clients: {},
    }),
    ```

    The `[contracts]` block lives at the same scope as `[brief.ollama]` from Phase 5 — per-vault (D-A1b), NOT global. Confirm by reading `src/config/loader.ts` to identify whether `brief` sits inside `VaultConfigSchema` or at top-level; mirror that placement for `contracts`.

    Co-locate test cases extending `src/config/loader.test.ts` (or creating it if not present — check before editing). Use `smol-toml` to build TOML strings inline per existing test idiom. Cover all 10 Behavior assertions above.

    Backwards-compat regression: include at least one test that asserts the previously-stored AppConfig shape (pre-Phase-6) parses to a config with `.contracts` equal to the defaults — ensures no existing user breaks on `vault-memory serve` after upgrade.

    Adapter-seam discipline: zero new `fs`/`path.join` imports (loader already touches these via existing code path; the diff in this task is Zod-only).
  </action>
  <verify>
    <automated>npx vitest run src/config/loader.test.ts && npx tsc --noEmit && npm test</automated>
  </verify>
  <done>AppConfigSchema accepts `[contracts]` block with documented defaults; backwards-compat verified; A7 (.min(1) on tool_prefix) enforced; all 1346+ existing tests stay green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 6-01-04: Type catalog + $ref resolver + buildInputSchema (D-A3a, D-A3b, Pitfall F1, F2, A3)</name>
  <files>src/contracts/types-catalog.ts, src/contracts/types-catalog.test.ts, src/contracts/json-schema-ref.ts, src/contracts/json-schema-ref.test.ts, src/contracts/input-schema.ts, src/contracts/input-schema.test.ts</files>
  <behavior>
    - Test 1 (types-catalog): TYPES_CATALOG.DocId equals `{type: "string", pattern: "^[a-z][a-z0-9-]*://", description: ...}`.
    - Test 2 (types-catalog): TYPES_CATALOG.ChunkId pattern matches `"obsidian-fs://v/p.md#chunk-a3f5b2c"` and rejects malformed strings (anchor: Phase 5 ADR-003 H-5 7-hex fragment).
    - Test 3 (types-catalog): TYPES_CATALOG.MemorySink carries `"x-validator": "memory-sink"` (extension keyword the contracts runtime respects).
    - Test 4 ($ref resolver): `resolveRefs({foo: {$ref: '#/types/DocId'}})` returns `{foo: <TYPES_CATALOG.DocId>}`.
    - Test 5 ($ref resolver): `resolveRefs({foo: {$ref: '#/types/DocId', description: 'override'}})` returns `{foo: {...TYPES_CATALOG.DocId, description: 'override'}}` — YAML-author additions on the same node WIN (spread order per Example 3).
    - Test 6 ($ref resolver): `resolveRefs({foo: {$ref: '#/types/Unknown'}})` throws synchronously with a message containing the bad ref.
    - Test 7 ($ref resolver): `resolveRefs({foo: {$ref: 'http://example.com/x'}})` throws — only `#/types/<name>` form is accepted (Security: no HTTP fetches, no FS reads).
    - Test 8 ($ref resolver): Nested schemas resolve correctly: `resolveRefs({items: [{$ref: '#/types/DocId'}], nested: {$ref: '#/types/Handle'}})` recurses into arrays and objects.
    - Test 9 ($ref resolver): Schemas without any `$ref` pass through unchanged (deep-clone or structurally equal).
    - Test 10 (buildInputSchema): Given `{meeting_doc_id: {$ref: '#/types/DocId'}}` and `required: ['meeting_doc_id']`, returns `{zodSchema, jsonSchema}` where `jsonSchema.additionalProperties === false` (Pitfall F2 fix) and `zodSchema instanceof z.ZodObject === true` (Pitfall F1 verification per RESEARCH §B).
    - Test 11 (buildInputSchema): `zodSchema.safeParse({meeting_doc_id: 'obsidian-fs://v/p.md'})` succeeds; `safeParse({meeting_doc_id: 'no-scheme'})` fails (pattern enforced); `safeParse({meeting_doc_id: 'obsidian-fs://v/p.md', typo: 1})` FAILS (additionalProperties:false; Pitfall F2 regression).
    - Test 12 (buildInputSchema): `x-validator: 'memory-sink'` extension keyword survives the round-trip through `z.fromJSONSchema` unchanged (Assumption A3 verification). If this assertion fails in practice, replace the wrapper with a `stripExtensions(jsonSchema)` step BEFORE `fromJSONSchema` and re-attach extensions to `jsonSchema` (NOT to `zodSchema`) — the test acts as the canary.
    - Test 13 (buildInputSchema): Returned `jsonSchema` is byte-pass-through suitable for MCP `tools/list` (no Zod-only metadata leaks; structured-clone-equal to the input wrapped form).
  </behavior>
  <action>
    Implement three modules per RESEARCH Examples 3-4 and Pattern 2.

    `src/contracts/types-catalog.ts` (RESEARCH Example 4 verbatim):
    ```typescript
    /** $ref: '#/types/<TypeName>' catalog per D-A3b. Additive evolution only — never narrow. */
    export const TYPES_CATALOG: Readonly<Record<string, object>> = Object.freeze({
      DocId: {
        type: "string",
        pattern: "^[a-z][a-z0-9-]*://",
        description: "Opaque document identifier per ADR-001",
      },
      Handle: {
        type: "string",
        pattern: "^[a-z][a-z0-9-]*://",
        description: "Source or sink handle (currently identical to DocId; future-proof for divergence)",
      },
      ChunkId: {
        type: "string",
        pattern: "^[a-z][a-z0-9-]*://.+#chunk-[0-9a-f]{7}$",
        description: "Content-stable chunk identifier per Phase 5 ADR-005 H-5",
      },
      MemorySink: {
        type: "string",
        description: "Registered MemorySink handle (see list_sinks)",
        "x-validator": "memory-sink",
      },
    });
    ```

    `src/contracts/json-schema-ref.ts` (RESEARCH Example 3 ~20 LOC):
    ```typescript
    import { TYPES_CATALOG } from "./types-catalog.js";

    /** Resolve $ref: '#/types/<name>' nodes against TYPES_CATALOG. YAML-author additions on the same node win. */
    export function resolveRefs(schema: unknown): unknown {
      if (Array.isArray(schema)) return schema.map(resolveRefs);
      if (schema && typeof schema === "object") {
        const obj = schema as Record<string, unknown>;
        if (typeof obj["$ref"] === "string") {
          const ref = obj["$ref"];
          const match = ref.match(/^#\/types\/(\w+)$/);
          if (!match) throw new Error(`Unknown $ref form (only '#/types/<name>' accepted): ${ref}`);
          const catalogEntry = TYPES_CATALOG[match[1]!] as Record<string, unknown> | undefined;
          if (!catalogEntry) throw new Error(`Unknown $ref target: ${ref}`);
          const { $ref: _drop, ...rest } = obj;
          return { ...catalogEntry, ...rest };
        }
        return Object.fromEntries(
          Object.entries(obj).map(([k, v]) => [k, resolveRefs(v)]),
        );
      }
      return schema;
    }
    ```

    `src/contracts/input-schema.ts` (RESEARCH Pattern 2):
    ```typescript
    import { z } from "zod";
    import { resolveRefs } from "./json-schema-ref.js";

    export interface BuiltInputSchema {
      zodSchema: z.ZodObject<z.ZodRawShape>;
      jsonSchema: {
        type: "object";
        properties: Record<string, unknown>;
        required: string[];
        additionalProperties: false;
      };
    }

    /** D-A3a: wrap flat `inputs: { <name>: <jsonSchema> }` as the canonical object form,
     *  resolve $ref against TYPES_CATALOG, then produce a Zod validator. */
    export function buildInputSchema(
      yamlInputs: Record<string, unknown>,
      required: string[] = [],
    ): BuiltInputSchema {
      const resolvedProperties = resolveRefs(yamlInputs) as Record<string, unknown>;
      const jsonSchema = {
        type: "object" as const,
        properties: resolvedProperties,
        required,
        additionalProperties: false as const,  // Pitfall F2: explicit
      };
      // Pitfall F1: fromJSONSchema produces a ZodObject that registerTool accepts; raw JSON Schema does NOT.
      const zodSchema = z.fromJSONSchema(jsonSchema) as z.ZodObject<z.ZodRawShape>;
      return { zodSchema, jsonSchema };
    }
    ```

    Co-locate three test files with the 13 assertions enumerated in Behavior. Use a tiny YAML-free test corpus (object literals only — keep tests pure).

    Important: in Test 12 (x-validator survival), use a real `z.fromJSONSchema` call and inspect either the produced ZodObject's `.shape` (the extension keyword should NOT cause a parse failure) or simply assert that `buildInputSchema({sink: {$ref: '#/types/MemorySink'}}, ['sink'])` does not throw and the returned `jsonSchema.properties.sink["x-validator"] === "memory-sink"`.

    Adapter-seam discipline: zero `fs`/`path.join`/`gray-matter`/`chokidar`/`yaml` imports in any of the three implementation files (only `zod`). Tests can import `yaml` if needed for cross-checks but stick to object literals where possible.
  </action>
  <verify>
    <automated>npx vitest run src/contracts/types-catalog.test.ts src/contracts/json-schema-ref.test.ts src/contracts/input-schema.test.ts && npx tsc --noEmit && bash scripts/lint-adapters.sh</automated>
  </verify>
  <done>TYPES_CATALOG + resolveRefs + buildInputSchema all green; Pitfall F1 (zodSchema instanceof ZodObject) and Pitfall F2 (additionalProperties:false) and Assumption A3 (x-validator survives) verified by tests; lint-adapters zero hits; no new runtime deps.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 6-01-05: ContractRegistry + slugifier + contract-audit writer + Zod schema for contract files + types + barrel + Wave-0 stubs</name>
  <files>src/contracts/types.ts, src/contracts/registry.ts, src/contracts/registry.test.ts, src/contracts/slug.ts, src/contracts/slug.test.ts, src/contracts/audit.ts, src/contracts/audit.test.ts, src/contracts/schema.ts, src/contracts/schema.test.ts, src/contracts/index.ts, src/contracts/loader.test.ts, src/contracts/templates.test.ts, src/contracts/mcp-clients.test.ts, src/contracts/verbs/index.test.ts, src/contracts/instantiate.test.ts, src/contracts/describe.test.ts, src/contracts/auto-register.test.ts, src/contracts/resources.test.ts, src/contracts/reference-contracts.test.ts</files>
  <behavior>
    - Test 1 (types): ParsedContract, ContractStep, ContractInputs, OverrideMap, WriteBackSpec, InstantiateError union are all exported from `src/contracts/types.ts` and importable as branded/aliased types. InstantiateError is a closed discriminated union of exactly 12 reasons per ADR-006 §Decision 7 enum (11 orchestrator reasons + `ambiguous_vault` from server-level dispatch).
    - Test 2 (slug): `slugify("meeting-prep", "vm_")` === `"vm_meeting_prep"`; `slugify("project-status", "")` === `"project_status"`; non-kebab inputs (e.g., `meetingPrep`) pass through with hyphens-only replaced.
    - Test 3 (slug): No external deps imported — `grep -E "from ['\"](lodash|change-case)" src/contracts/slug.ts` is empty.
    - Test 4 (registry): `new ContractRegistry()` is empty (`registry.size === 0`).
    - Test 5 (registry): `registry.set("meeting-prep", parsed)` succeeds and `registry.get("meeting-prep")` returns the parsed contract.
    - Test 6 (registry): A second `registry.set("meeting-prep", differentParsed)` returns `{ok: false, reason: "duplicate_name"}` AND does NOT replace the original (first-wins per D-A1c). The original is still retrievable via `registry.get`.
    - Test 7 (registry): `registry.delete("meeting-prep")` removes; subsequent `registry.set("meeting-prep", parsedV2)` succeeds (delete clears the first-wins lock).
    - Test 8 (registry): `registry.entries()` returns `[[name, ParsedContract], ...]` in insertion order (Map semantics).
    - Test 9 (audit): `recordContractStep(deps, {contract: 'meeting-prep', verb: 'search_hybrid', step_alias: 'related', vault: 'my-vault'})` writes a row with `kind: 'contract_step'`, `ts: Date.now()`, no payload. Verified by querying `vault.db.contractAudit.listByKind('contract_step')`.
    - Test 10 (audit): `recordContractLoadError(deps, {file: '_contracts/bad.yaml', error_message: 'malformed yaml at line 5', vault: 'my-vault'})` writes a row with `kind: 'contract_load_error'`, `error_message` populated, contract/verb/step_alias NULL.
    - Test 11 (audit): `aggregateVerbUsage(deps, 'my-vault')` after 3 steps using `search_hybrid` + 2 steps using `mcp://gh/list_issues` returns `[{verb: 'search_hybrid', invocation_count: 3, ...}, {verb: 'mcp://gh/list_issues', invocation_count: 2, ...}]` ordered DESC by invocation_count.
    - Test 12 (audit security): audit writer never accepts a `payload` or `output` field — the function signature does not even declare one. Verified by TypeScript strict-mode type-check failure if a test attempts `recordContractStep(deps, {output: 'x'})`.
    - Test 13 (schema): Zod ContractFileSchema validates each of the three reference contracts (Example 1 meeting-prep, Example 6 project-status, Example 7 code-review-brief) parsed via `parseDocument(yamlText).toJS()`. Use string literals embedded in the test file (do NOT read from `_contracts/` because that's Plan 06-02's loader's job and the files don't exist yet).
    - Test 14 (schema): Zod ContractFileSchema rejects a contract missing `name` (or `version`, or `assembly`); rejects a contract with `version: 2` (only `1` is supported in v2.0.0 per CONTEXT.md "Deferred"); rejects an `assembly` step missing `as:` (D-A2c requires every step to have an alias); rejects a contract with two steps sharing the same `as:` alias.
    - Test 15 (schema): The `assembly[].verb` Zod schema accepts ALL 11 baseline enum verbs verbatim (`search_hybrid, expand, cluster, recall, compile_brief, get_brief, query_frontmatter, list_backlinks, get_outline, search_sections, read_note`); accepts `literal`; accepts `mcp://<server>/<tool>` matching `^mcp:\/\/[a-z][a-z0-9_-]*\/[a-z][a-z0-9_-]*$`; rejects `write_note` (D-A2a no-write-verbs invariant).
    - Test 16 (barrel): `src/contracts/index.ts` re-exports the 5 foundation modules created in this plan (types, types-catalog, json-schema-ref, input-schema, registry) + the slugifier + audit writer + schema. Loader/templates/verbs/mcp-clients/instantiate/describe/auto-register/resources are NOT exported (they don't exist yet — Plans 06-02/03/04 add them).
    - Test 17 (Wave-0 stubs): Each of the 9 stub test files exists and parses; running them yields zero `it()` tests (only `describe` blocks).
    - Test 18: All 1346+ existing tests stay green.
  </behavior>
  <action>
    Create `src/contracts/types.ts` with the foundation type surface. Use the exact union and field names from RESEARCH §Architecture + Decisions 5-7 of ADR-006:

    ```typescript
    import type { DocId } from "../types.js";
    import type { z } from "zod";

    export type AssemblyVerb =
      | "search_hybrid" | "expand" | "cluster" | "recall"
      | "compile_brief" | "get_brief" | "query_frontmatter"
      | "list_backlinks" | "get_outline" | "search_sections"
      | "read_note"
      | "literal"
      | `mcp://${string}/${string}`;

    export interface ContractStep {
      as: string;
      verb: AssemblyVerb;
      args?: Record<string, unknown>;   // contains {{template}} expressions
      value?: unknown;                   // only for verb: "literal"
    }

    export interface ContractSourceDecl {
      handle: string;
      required: boolean;
    }

    export interface ContractSinkDecl {
      handle: string;
      required: boolean;
    }

    export interface WriteBackSpec {
      sink: string;                     // template expression or literal
      document_kind: "brief" | "observation" | "custom";
      properties: Record<string, unknown>;
      body_from: string;                // template expression
    }

    /** YAML inputs flat form: { <fieldName>: <jsonSchemaFragment> }. */
    export type ContractInputs = Record<string, unknown>;

    export interface ParsedContract {
      version: 1;
      name: string;
      description: string;
      inputs: ContractInputs;
      required: string[];
      sources: Record<string, ContractSourceDecl>;
      sinks: Record<string, ContractSinkDecl>;
      assembly: ContractStep[];
      output_shape?: object;            // JSON Schema (post-resolveRefs)
      write_back?: WriteBackSpec;
      // Caches built once at load time:
      inputZodSchema: z.ZodObject<z.ZodRawShape>;
      inputJsonSchema: object;          // for MCP inputSchema pass-through
    }

    export type OverrideMap = Record<string, string>;

    /** D-A4b + Q-OUTPUT + WARNING-6 closed envelope — sealed for v2.0.0 per ADR-006 §Decision 7. */
    export type InstantiateError =
      | { ok: false; reason: "unknown_contract"; name: string }
      | { ok: false; reason: "invalid_inputs"; issues: unknown }
      | { ok: false; reason: "unknown_override_handle"; handle: string; valid_handles: string[] }
      | { ok: false; reason: "missing_required_source"; handle: string; hint: string }
      | { ok: false; reason: "sink_override_not_a_memory_sink"; target: string; hint: string }
      | { ok: false; reason: "unresolved_template"; expression: string }
      | { ok: false; reason: "verb_not_available"; verb: string }
      | { ok: false; reason: "mcp_client_unavailable"; verb: string; client_name: string }
      | { ok: false; reason: "assembly_step_failed"; step_alias: string; cause: string }
      | { ok: false; reason: "write_back_failed"; cause: string }
      | { ok: false; reason: "validation_failed_on_output_shape"; issues: unknown }
      // WARNING-6 / ADR-006 §Decision 7: server-level dispatch returns this when caller omits `vault` and multiple vaults are configured.
      | { ok: false; reason: "ambiguous_vault"; available_vaults: string[] };

    export interface ContractAuditRow {
      kind: "contract_step" | "contract_load_error";
      contract?: string;
      verb?: string;
      step_alias?: string;
      vault?: string;
      ts: number;
      error_message?: string;
    }

    /** Path-matcher constant for Plan 06-02 loader scan + ChangeFeed dispatch (Pitfall F3 non-recursion). */
    export const CONTRACT_PATH_REGEX = /^_contracts\/[^/]+\.yaml$/;
    ```

    Create `src/contracts/slug.ts` (~10 LOC, no deps per RESEARCH Anti-Patterns):
    ```typescript
    /** D-A1c: kebab-case contract name → prefix + snake_case tool name. First-wins on collision is the registry's job. */
    export function slugify(name: string, prefix: string): string {
      return prefix + name.replace(/-/g, "_");
    }
    ```

    Create `src/contracts/registry.ts`:
    ```typescript
    import type { ParsedContract } from "./types.js";

    export type RegistrySetResult = { ok: true } | { ok: false; reason: "duplicate_name" };

    export class ContractRegistry {
      private readonly contracts = new Map<string, ParsedContract>();

      get size(): number { return this.contracts.size; }
      get(name: string): ParsedContract | undefined { return this.contracts.get(name); }

      /** D-A1c first-wins collision policy. */
      set(name: string, contract: ParsedContract): RegistrySetResult {
        if (this.contracts.has(name)) return { ok: false, reason: "duplicate_name" };
        this.contracts.set(name, contract);
        return { ok: true };
      }

      delete(name: string): boolean { return this.contracts.delete(name); }
      entries(): IterableIterator<[string, ParsedContract]> { return this.contracts.entries(); }
      names(): string[] { return Array.from(this.contracts.keys()); }
    }
    ```

    Create `src/contracts/audit.ts` per RESEARCH §Security — payload-free signature:
    ```typescript
    import type { ContractAuditQueries } from "../db/queries/contract-audit.js";

    export interface ContractAuditDeps { contractAudit: ContractAuditQueries; }

    export function recordContractStep(
      deps: ContractAuditDeps,
      args: { contract: string; verb: string; step_alias: string; vault: string },
    ): void {
      deps.contractAudit.insert({
        kind: "contract_step",
        contract: args.contract,
        verb: args.verb,
        stepAlias: args.step_alias,
        vault: args.vault,
        ts: Date.now(),
      });
    }

    export function recordContractLoadError(
      deps: ContractAuditDeps,
      args: { file: string; error_message: string; vault: string },
    ): void {
      deps.contractAudit.insert({
        kind: "contract_load_error",
        vault: args.vault,
        ts: Date.now(),
        errorMessage: `${args.file}: ${args.error_message}`,
      });
    }

    export function aggregateVerbUsage(
      deps: ContractAuditDeps,
      vault: string,
    ): Array<{ verb: string; invocation_count: number; last_seen: number }> {
      return deps.contractAudit.aggregateVerbUsage(vault);
    }
    ```

    Create `src/contracts/schema.ts` — Zod for the YAML contract file shape. Follow `default-v1.ts` authoring style. The schema accepts the flat `inputs: { <name>: <fragment> }` author form. Verb is the closed enum + literal + `mcp://...` regex. `assembly` must be non-empty array; every step requires `as:`; step `as:` aliases must be unique across the array (use `.superRefine` for that cross-field check). `version` is `z.literal(1)` (v2.0.0 only supports version 1; v2.x can add `z.union([z.literal(1), z.literal(2)])`).

    Skeleton:
    ```typescript
    import { z } from "zod";

    const BASELINE_VERBS = ["search_hybrid", "expand", "cluster", "recall", "compile_brief", "get_brief", "query_frontmatter", "list_backlinks", "get_outline", "search_sections", "read_note"] as const;
    const MCP_VERB_RE = /^mcp:\/\/[a-z][a-z0-9_-]*\/[a-z][a-z0-9_-]*$/;
    const VerbSchema = z.union([
      z.enum([...BASELINE_VERBS, "literal"]),
      z.string().regex(MCP_VERB_RE),
    ]);

    const StepSchema = z.object({
      as: z.string().min(1).regex(/^[a-z_][a-z0-9_]*$/, "alias must be snake_case"),
      verb: VerbSchema,
      args: z.record(z.string(), z.unknown()).optional(),
      value: z.unknown().optional(),
    });

    const HandleDeclSchema = z.object({
      handle: z.string().min(1),
      required: z.boolean().default(true),
    });

    const WriteBackSchema = z.object({
      sink: z.string().min(1),
      document_kind: z.enum(["brief", "observation", "custom"]),
      properties: z.record(z.string(), z.unknown()).default({}),
      body_from: z.string().min(1),
    });

    export const ContractFileSchema = z.object({
      version: z.literal(1),
      name: z.string().min(1).regex(/^[a-z][a-z0-9-]*$/, "name must be kebab-case"),
      description: z.string().default(""),
      inputs: z.record(z.string(), z.unknown()).default({}),
      required: z.array(z.string()).default([]),
      sources: z.record(z.string(), HandleDeclSchema).default({}),
      sinks: z.record(z.string(), HandleDeclSchema).default({}),
      assembly: z.array(StepSchema).min(1),
      output_shape: z.unknown().optional(),
      write_back: WriteBackSchema.optional(),
    }).superRefine((data, ctx) => {
      const aliases = new Set<string>();
      for (const step of data.assembly) {
        if (aliases.has(step.as)) {
          ctx.addIssue({ code: "custom", path: ["assembly"], message: `duplicate step alias '${step.as}'` });
        }
        aliases.add(step.as);
      }
    });
    ```

    Create `src/contracts/index.ts` barrel (Plan 06-01 surface only):
    ```typescript
    export * from "./types.js";
    export { TYPES_CATALOG } from "./types-catalog.js";
    export { resolveRefs } from "./json-schema-ref.js";
    export { buildInputSchema, type BuiltInputSchema } from "./input-schema.js";
    export { ContractRegistry, type RegistrySetResult } from "./registry.js";
    export { slugify } from "./slug.js";
    export { recordContractStep, recordContractLoadError, aggregateVerbUsage, type ContractAuditDeps } from "./audit.js";
    export { ContractFileSchema } from "./schema.js";
    ```

    Create the 9 Wave-0 stub test files. Each is a minimal vitest file with a `describe(...)` and a comment pointing to the slice that fills it. Examples:

    `src/contracts/loader.test.ts`:
    ```typescript
    import { describe } from "vitest";
    describe("startContractRegistry (D-LOAD, CON-01 round-trip)", () => {
      // Stubs land in Plan 06-02 (loader + ChangeFeed hot reload).
    });
    ```

    Same shape for: `templates.test.ts` (D-A2c, plan 06-03), `mcp-clients.test.ts` (D-A2a peer-MCP, plan 06-03), `verbs/index.test.ts` (D-A2a baseline dispatcher, plan 06-03), `instantiate.test.ts` (CON-06, plan 06-03), `describe.test.ts` (CON-05, plan 06-03), `auto-register.test.ts` (D-A1, plan 06-04), `resources.test.ts` (CON-04 + D-A2b, plan 06-04), `reference-contracts.test.ts` (CON-07/08, plan 06-04).

    Co-locate test files per Behavior assertions 1-17. Adapter-seam discipline applies to PRODUCTION code in `src/contracts/*.ts` (NOT to `src/contracts/*.test.ts`).

    **Lint-adapters test-file carve-out mechanism (WARNING-1 discovery, verified at planning time):**
    `scripts/lint-adapters.sh` invokes `grep -arEn "$pattern" src --include='*.ts' --exclude='*.test.ts' --exclude-dir='__test_helpers__'` (see script around line 54). The exclusion is **filename-based** — any file ending in `.test.ts` is invisible to all `check()` invariant greps. The `ESCAPE_MARK='vault-memory:claude-ok'` comment is for **non-test production files** that need a legitimate exception (e.g., Phase 5 `src/brief/lock.ts` reading `~/.vault-memory/locks/`), NOT for test files.
    Implication for Plan 06-01..06-04: test files in `src/contracts/*.test.ts` can freely import `node:fs/promises`, `yaml`, `gray-matter`, `chokidar` without any escape marker. No special header needed. Production files in `src/contracts/*.ts` (non-test) MUST stay clean. This invariant is what makes the inline vitest eval-runner in Plan 06-04 Task 2 viable.

    The only `yaml` import in this slice's test code is in `schema.test.ts` (using `parseDocument` to feed test fixtures into ContractFileSchema). That's a `.test.ts` file → lint-adapters skips it via the filename exclusion.

    Run `bash scripts/lint-adapters.sh` at the end and verify zero hits in `src/contracts/*.ts` (non-test) files.
  </action>
  <verify>
    <automated>npx vitest run src/contracts/ && npx tsc --noEmit && bash scripts/lint-adapters.sh && npm test</automated>
  </verify>
  <done>All foundation modules in src/contracts/ green; ContractRegistry first-wins enforced; slugifier dep-free; ContractFileSchema validates the 3 reference contracts and rejects malformed ones; payload-free audit writer; 9 Wave-0 stub files exist; src/contracts/index.ts barrel surfaces the Plan 06-01 modules only; 1346+ existing tests stay green; lint-adapters zero hits inside src/contracts/.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Migration runner → SQLite | Synchronous transactions; contract_audit is DDL-only (no backfill loop). |
| Config parser → Zod | TOML `[contracts]` block validated by Zod at load time; A7 enforces non-empty tool_prefix. |
| JSON Schema $ref resolver → TYPES_CATALOG | Only `#/types/<name>` form accepted; HTTP refs, file refs, JSON-Pointer refs all throw at parse time (Security: no HTTP fetches, no FS reads from contract YAML). |
| Audit writer → DB | Payload-free function signatures enforce by TypeScript that no step output ever lands in contract_audit (Security: peer-MCP outputs may contain sensitive data). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-06-01-01 | Tampering | $ref forms beyond `#/types/<name>` (e.g., `$ref: 'http://evil.example/x.json'`) attempting HTTP fetch or FS read | mitigate | `resolveRefs` regex `^#/types/(\w+)$` rejects all other forms at contract load (cached as `contract_load_error`). No HTTP client, no `fetch`, no `fs` in `src/contracts/json-schema-ref.ts`. Test 7 enforces. |
| T-06-01-02 | Tampering | Empty `tool_prefix` collides auto-registered tool with v1 tool name (e.g., `read-note` contract slugs to `read_note` and overwrites v1 `read_note` tool) | mitigate | A7: Zod `.min(1)` on `tool_prefix`; Test 3 enforces. Documented in ADR-006 §Decision 1. |
| T-06-01-03 | Information Disclosure | Audit-log captures sensitive verb output (e.g., a `mcp://github/list_issues` response containing private PR text) | mitigate | `recordContractStep` signature excludes any `output`/`payload` field; TypeScript strict-mode rejects at compile time; Test 12 attempts the bad call and verifies tsc fails. Documented in ADR-006 §Decision 4 + Invariant C-5. |
| T-06-01-04 | Tampering | TOML `[contracts.mcp_clients.<name>.command]` shell injection (e.g., `command = "bash; rm -rf /"`) | accept | Same trust level as the rest of `~/.vault-memory/config.toml` (user-owned). Plan 06-03 uses `spawn(command, args)` with NO shell — args pass verbatim. Documented in ADR-006 §Threat Model. |
| T-06-01-05 | Denial of Service | Migration 014 on a vault that already has version 14 reapplied (re-run scenarios) | mitigate | `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` ensure idempotency; Test 4 enforces. |
| T-06-01-SC | Tampering | npm install of new dependencies | N/A | ZERO net-new runtime deps in Phase 6 (yaml@^2.9, zod@^4.4.3, MCP SDK ^1.29 all pre-installed and vetted in Phases 0+1). No supply-chain checkpoint needed. RESEARCH §Package Legitimacy Audit confirms. |
</threat_model>

<verification>
**Acceptance:**
- `npm test` — 1346+ existing tests stay green + new tests for contract-audit, config-loader (extended), types-catalog, json-schema-ref, input-schema, registry, slug, audit, schema all pass.
- `npx tsc --noEmit` — clean (new types in `src/contracts/types.ts` + `src/db/queries/contract-audit.ts` compile under strict + `noUncheckedIndexedAccess`).
- `bash scripts/lint-adapters.sh` — zero hits inside `src/contracts/` (no `fs`/`path.join`/`gray-matter`/`chokidar` imports in any non-test file).
- `npm run eval:baseline` — v1-baseline byte-identical; no MCP tool changes in this slice.
- Manual: ADR-006 read for completeness — every Decision section above is present; Threat Model table covers the 8 RESEARCH §Security threat patterns.

**Eval queries:** none new in this slice; eval YAMLs land in Plan 06-04.

**Snapshot checks:** No tool-list snapshot regen — additive Phase 6 tools land in Plans 06-02 (`register_contracts_as_tools`) and 06-03 (`describe_contract`, `instantiate_contract`) and the regen ships in Plan 06-04.

**Wave 0 stub references:** This slice creates all 9 `src/contracts/*.test.ts` stub files (loader, templates, mcp-clients, verbs/index, instantiate, describe, auto-register, resources, reference-contracts) so Plans 06-02/03/04 fill them without scaffolding work.
</verification>

<success_criteria>
1. ADR-006 exists at `docs/v2/adr/006-task-contract-dsl.md` with all 12 Decision sections + Invariants C-1..C-7 + Threat Model + Rationale + Forward compatibility, authored BEFORE any `src/contracts/loader.ts` or `src/contracts/instantiate.ts` implementation commit.
2. Migration 014 lands; `contract_audit` table with documented columns + two indexes; idempotent.
3. `vault.db.contractAudit` namespace wired onto Database with `insert`/`listByKind`/`aggregateVerbUsage` surfaces.
4. `AppConfigSchema` accepts `[contracts]` block (auto_register_tools, tool_prefix .min(1), step_timeout_seconds, defaults, mcp_clients); backwards-compatible.
5. `TYPES_CATALOG` (DocId, Handle, ChunkId, MemorySink w/ x-validator), `resolveRefs`, `buildInputSchema` all green; Pitfall F1 + F2 + Assumption A3 verified by tests.
6. `ContractRegistry` first-wins enforced; `slugify` dep-free; `recordContractStep`/`recordContractLoadError`/`aggregateVerbUsage` payload-free; `ContractFileSchema` validates Examples 1/6/7 and rejects malformed ones.
7. 9 Wave-0 stub files exist in `src/contracts/`; barrel `src/contracts/index.ts` re-exports Plan 06-01 modules only.
8. `npm test` + `npx tsc --noEmit` + `bash scripts/lint-adapters.sh` + `npm run eval:baseline` all green.
9. Zero new runtime deps (`grep -E '"yaml"|"zod"|"@modelcontextprotocol/sdk"' package.json` shows no version changes).
10. Tool count unchanged (still 34 per `evals/v1-baseline/tools-list.snapshot.json`).

**After this slice, agents can:** nothing new yet (no MCP tool changes). The substrate is alive; Plan 06-02 lights up the loader + ChangeFeed + `register_contracts_as_tools` Tool.
</success_criteria>

<commit>
Atomic commit messages (one per task, or one batch commit at slice end):

```
docs(06-01): ADR-006 task contract DSL (D-A1..D-LOAD + Q-AUD/TIMEOUT/OUTPUT/DESCRIBE + yaml rationale)

Refs: CON-11, CON-12
```

```
feat(06-01): migration 014 — contract_audit table + ContractAuditQueries

- CREATE contract_audit (kind, contract, verb, step_alias, vault, ts,
  error_message) with idx_contract_audit_kind_ts + idx_contract_audit_verb;
  no backfill (greenfield).
- Wire ContractAuditQueries onto Database (insert / listByKind /
  aggregateVerbUsage). Payload-free signatures enforce C-5 invariant.

Refs: Q-AUD, D-A2b, ADR-006 §Decision 4
```

```
feat(06-01): config [contracts] block — auto_register_tools, tool_prefix, defaults, mcp_clients

- AppConfigSchema gains optional ContractsConfigSchema; backwards-compat
  via .optional().default(...).
- A7: tool_prefix Zod .min(1) prevents v1-tool collision via empty prefix.
- step_timeout_seconds (Q-TIMEOUT) positive int default 30.

Refs: D-A1b, D-A1c, A7, Q-TIMEOUT
```

```
feat(06-01): TYPES_CATALOG + $ref resolver + buildInputSchema (D-A3a/b, F1/F2/A3)

- src/contracts/types-catalog.ts — DocId/Handle/ChunkId/MemorySink with
  x-validator extension.
- src/contracts/json-schema-ref.ts — ~20 LOC resolver; only #/types/<name>
  form accepted; YAML-author additions on same node win.
- src/contracts/input-schema.ts — buildInputSchema sets
  additionalProperties:false explicitly (Pitfall F2) and produces a real
  ZodObject via z.fromJSONSchema (Pitfall F1). x-validator survives the
  round-trip (Assumption A3 verified).

Refs: D-A3a, D-A3b, Pitfall F1, Pitfall F2
```

```
feat(06-01): ContractRegistry + slugifier + audit writer + ContractFileSchema + Wave-0 stubs

- src/contracts/types.ts — ParsedContract, ContractStep, WriteBackSpec,
  closed 12-reason InstantiateError union (incl. ambiguous_vault per WARNING-6),
  CONTRACT_PATH_REGEX (Pitfall F3).
- src/contracts/registry.ts — first-wins collision policy (D-A1c).
- src/contracts/slug.ts — kebab→snake+prefix, zero deps.
- src/contracts/audit.ts — payload-free recordContractStep /
  recordContractLoadError / aggregateVerbUsage (C-5 enforced by signature).
- src/contracts/schema.ts — Zod ContractFileSchema validates v1 contract
  files; verb enum closed (no write verbs per D-A2a / C-1); step alias
  uniqueness via superRefine.
- src/contracts/index.ts — Plan 06-01 barrel.
- 9 Wave-0 stub files for plans 06-02/03/04.

Refs: CON-01 (schema half), D-A1c, D-A2a, D-A2b, D-A2c (alias), Pitfall F3
```
</commit>

<output>
Create `.planning/phases/06-task-contract-dsl/06-01-SUMMARY.md` when done.
</output>
