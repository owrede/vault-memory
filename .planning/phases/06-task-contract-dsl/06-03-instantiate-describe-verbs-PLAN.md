---
phase: 06-task-contract-dsl
plan: 03
type: execute
wave: 3
depends_on:
  - 06-01
  - 06-02
files_modified:
  - src/contracts/templates.ts
  - src/contracts/templates.test.ts
  - src/contracts/mcp-clients.ts
  - src/contracts/mcp-clients.test.ts
  - src/contracts/verbs/index.ts
  - src/contracts/verbs/index.test.ts
  - src/contracts/verbs/mcp-extension.ts
  - src/contracts/verbs/mcp-extension.test.ts
  - src/contracts/instantiate.ts
  - src/contracts/instantiate.test.ts
  - src/contracts/describe.ts
  - src/contracts/describe.test.ts
  - src/contracts/index.ts
  - src/tool-registry.ts
  - src/server.ts
  - evals/v1-baseline/tools-list.snapshot.json
autonomous: true
requirements:
  - CON-05
  - CON-06
  - CON-03
  - CON-11
user_setup: []

must_haves:
  truths:
    - "`resolveTemplate(value, bindings)` (~50 LOC at `src/contracts/templates.ts`) per RESEARCH Example 2 mustache resolver: handles `{{inputs.<name>}}` + `{{alias.field[i].sub}}` field traversal + array shorthand; whole-string `{{x}}` returns raw typed value; embedded `{{x}}` substitutes as string concat; undefined → `{ok: false, reason: 'unresolved_template', expression}`."
    - "`verbDispatcher(verb, args, deps)` (`src/contracts/verbs/index.ts`) closes the 11-verb baseline enum + literal handler + delegates `mcp://*` to `mcp-extension.ts`. Each baseline verb routes to its existing implementation: `search_hybrid` → `src/search/hybrid.ts:hybridSearch`; `compile_brief` → `src/brief/compile.ts:handleCompileBrief`; etc. (Per Assumption A9, verb signatures verified at implementation time — each verb's `args` shape matches what the contract YAML supplies after template resolution.)"
    - "`PeerMcpRegistry` (`src/contracts/mcp-clients.ts`) per RESEARCH Pattern 3 instantiates one MCP `Client` + `StdioClientTransport` per `[contracts.mcp_clients.<name>]` entry at server boot; failures are WARN'd (stderr) + marked unavailable (NOT a server-boot blocker per CONTEXT.md Claude's Discretion). `Symbol.dispose` on `PeerMcpClient` invokes `transport.close()` which kills the child process; `SIGTERM`/`SIGINT` handlers at server boot call `peerMcpRegistry.shutdown()` (Pitfall F4 mitigation)."
    - "`callMcpVerb(verb, args, deps)` (`src/contracts/verbs/mcp-extension.ts`) parses `mcp://<server>/<tool>` syntax, looks up client via `peerMcpRegistry.get(serverName)`, calls `client.callTool(toolName, args)`; wraps in `Promise.race([call, timeout(step_timeout_seconds * 1000)])` (Q-TIMEOUT: peer-MCP ONLY); returns either the tool result or `{ok: false, reason: 'verb_not_available'}` / `{ok: false, reason: 'mcp_client_unavailable'}` / `{ok: false, reason: 'assembly_step_failed', cause: 'timeout'}`."
    - "`instantiateContract(deps, {name, inputs, source_overrides?, sink_overrides?})` (`src/contracts/instantiate.ts`) orchestrates per RESEARCH §Architecture diagram steps (1)-(7): Zod-validate inputs against `parsed.inputZodSchema` → resolve overrides (default chain per D-A4b: explicit → `[contracts.defaults.<handle>]` → contract YAML literal → error if required) → validate sinks via `MemorySinkRegistry.resolveMemorySink` (D-A4c) → build template bindings table → for each assembly step (a) resolve `{{templates}}` (b) dispatch verb (c) write `contract_audit` `kind: 'contract_step'` row (d) bind output to `{{as}}` → run `write_back` via `DeliveryAdapter.write()` (MEM-05 chokepoint) → validate output against `output_shape` per Q-OUTPUT timing (validates the {steps, write_back} bundle returned to caller) → return shaped bundle."
    - "All 12 InstantiateError closed-enum failure modes (Plan 06-01 types.ts; includes `ambiguous_vault` from server-level dispatch per WARNING-6) are reachable via at least one test case (orchestrator-level reasons in `instantiate.test.ts`; `ambiguous_vault` covered by Task 6-03-05 server-wiring test)."
    - "`describe_contract(deps, {name})` (`src/contracts/describe.ts`) returns `{ok: true, json_schema: parsed.inputJsonSchema, summary: <markdown>}` per Q-DESCRIBE template (Inputs / Sources / Sinks / Assembly numbered list / write_back / Output Shape per RESEARCH §Q-DESCRIBE example). Pure function over `ParsedContract`. NO LLM."
    - "`instantiate_contract` + `describe_contract` are registered MCP Tools in `src/tool-registry.ts`; the auto-register stub `instantiateHandler` from Plan 06-02 is replaced with the real `instantiateContract` function."
    - "`evals/v1-baseline/tools-list.snapshot.json` regenerated additively (35 → 37 entries; default-OFF `auto_register_tools` keeps snapshot stable per RESEARCH §F7)."
    - "MEM-05 invariant un-bypassable by construction (Plan 06-01 ADR-006 Invariants C-1, C-2, C-3): the assembly verb enum has NO write verbs; `write_back:` is structurally separate; `sink_overrides` validation runs through `MemorySinkRegistry.resolveMemorySink`. Test 10 of instantiate.test.ts attempts a sink_override pointing at a non-MemorySink target and asserts the structured rejection."
    - "Concurrent `instantiate_contract` calls (Claude's Discretion) — two simultaneous calls with same target land via Phase 5 D-12 auto-supersede chain (`handleSupersede`); no mutex needed; test 18 of instantiate.test.ts exercises this."
    - "All 1346+ existing tests + Plans 06-01/06-02 tests stay green; new tests for templates, mcp-clients, verbs, instantiate, describe green."
  artifacts:
    - path: "src/contracts/templates.ts"
      provides: "resolveTemplate(value, bindings) — ~50 LOC mustache resolver (D-A2c); whole-string {{x}} returns typed value, embedded {{x}} string-concat substitutes"
      contains: "resolveTemplate"
    - path: "src/contracts/mcp-clients.ts"
      provides: "PeerMcpRegistry — boot + Symbol.dispose lifecycle for [contracts.mcp_clients.<name>] entries; WARN-on-fail + available flag (Pitfall F4 SIGTERM handler)"
      contains: "class PeerMcpRegistry"
    - path: "src/contracts/verbs/index.ts"
      provides: "verbDispatcher(verb, args, deps) — closed-baseline enum dispatch + literal handler + mcp:// delegation (D-A2a)"
      contains: "verbDispatcher"
    - path: "src/contracts/verbs/mcp-extension.ts"
      provides: "callMcpVerb(verb, args, deps) — peer-MCP routing with step_timeout_seconds (Q-TIMEOUT)"
      contains: "callMcpVerb"
    - path: "src/contracts/instantiate.ts"
      provides: "instantiateContract(deps, args) — full orchestration per RESEARCH §Architecture diagram"
      contains: "instantiateContract"
    - path: "src/contracts/describe.ts"
      provides: "describeContract(deps, args) — pure function over ParsedContract returning {json_schema, summary}"
      contains: "describeContract"
    - path: "src/tool-registry.ts"
      provides: "instantiate_contract + describe_contract tool entries (35 → 37 tools)"
      contains: "instantiate_contract"
    - path: "evals/v1-baseline/tools-list.snapshot.json"
      provides: "Tool surface snapshot regenerated additively: +2 entries (instantiate_contract, describe_contract); 35 → 37"
      contains: "instantiate_contract"
  key_links:
    - from: "src/contracts/instantiate.ts"
      to: "src/contracts/templates.ts"
      via: "resolveTemplate(step.args, bindings) before each verb dispatch"
      pattern: "resolveTemplate"
    - from: "src/contracts/instantiate.ts"
      to: "src/contracts/verbs/index.ts"
      via: "verbDispatcher(step.verb, resolvedArgs, deps)"
      pattern: "verbDispatcher"
    - from: "src/contracts/instantiate.ts"
      to: "src/memory/registry.ts"
      via: "MemorySinkRegistry.resolveMemorySink(target) — D-A4c sink validation"
      pattern: "resolveMemorySink"
    - from: "src/contracts/instantiate.ts"
      to: "src/adapters/delivery"
      via: "DeliveryAdapter.write({body, properties}, {sink}) — MEM-05 chokepoint (write_back)"
      pattern: "delivery\\.write"
    - from: "src/contracts/instantiate.ts"
      to: "src/db/queries/contract-audit.ts"
      via: "recordContractStep per step (Plan 06-01 audit writer)"
      pattern: "recordContractStep"
    - from: "src/contracts/verbs/mcp-extension.ts"
      to: "src/contracts/mcp-clients.ts"
      via: "peerMcpRegistry.get(serverName).callTool(toolName, args)"
      pattern: "callTool"
    - from: "src/server.ts"
      to: "src/contracts/mcp-clients.ts"
      via: "PeerMcpRegistry instantiated at boot + Symbol.dispose on SIGTERM/SIGINT (Pitfall F4)"
      pattern: "PeerMcpRegistry"
---

<objective>
Orchestration slice. Ship the verbs that USE contracts: `describe_contract` (CON-05) returns the input JSON Schema + auto-generated markdown summary; `instantiate_contract` (CON-06) is the L4 orchestrator — validates inputs, resolves overrides, dispatches assembly steps with template resolution + named-binding accumulation, writes through `DeliveryAdapter.write()` (MEM-05 chokepoint), validates output. The 11-verb baseline dispatcher routes to existing Phase 1-5 implementations; the `mcp://` peer-MCP extension lifts peer MCP servers into the assembly enum via SDK 1.29 `Client` + `StdioClientTransport`. After this slice, an MCP client can run `instantiate_contract({name: 'meeting-prep', inputs: {meeting_doc_id: 'obsidian-fs://my-vault/meetings/x.md'}})` end-to-end against a real vault and get a brief written into `_memory/_briefs/`.

Purpose: CON-05 (describe_contract MCP tool) + CON-06 (instantiate_contract MCP tool) + CON-03 (sources/sinks by handle; `{{default_source}}` variable handle pattern works in all reference contracts — exercised by tests that load Example 1/6/7 contracts and route through templates) + CON-11 ADR §Decisions 3, 5, 6, 7, 10, 11, 12 materialized in code. Plan 06-04 will then ship the 3 reference contracts + eval scenarios + CON-09 non-Claude proof + CON-10 stub-parity proof + the phase gate.

Output: 6 new modules in `src/contracts/` (templates, mcp-clients, verbs/index, verbs/mcp-extension, instantiate, describe); 2 new MCP Tools registered (`instantiate_contract`, `describe_contract`); the auto-register stub from Plan 06-02 swapped for the real `instantiateContract`; snapshot regenerated additively (35 → 37); 1346+-test floor holds.
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
@.planning/phases/06-task-contract-dsl/06-01-foundations-PLAN.md
@.planning/phases/06-task-contract-dsl/06-02-loader-registry-hot-reload-PLAN.md
@docs/v2/adr/006-task-contract-dsl.md
@docs/v2/adr/004-memory-sink-handles.md
@docs/v2/adr/005-brief-compile-strategy.md
@docs/v2/MEMORY_CONTRACT.md
@src/types.ts
@src/contracts/index.ts
@src/contracts/types.ts
@src/contracts/registry.ts
@src/contracts/input-schema.ts
@src/contracts/audit.ts
@src/contracts/loader.ts
@src/server.ts
@src/tool-registry.ts
@src/search/hybrid.ts
@src/brief/compile.ts
@src/brief/get.ts
@src/graph/expand.ts
@src/graph/cluster.ts
@src/frontmatter/query.ts
@src/sections/outline.ts
@src/sections/search-sections.ts
@src/memory/tools/recall.ts
@src/memory/tools/supersede.ts
@src/memory/registry.ts
@src/memory/validator.ts
@src/adapters/delivery
@src/db/queries/contract-audit.ts

<interfaces>
<!-- Canonical contracts the executor must follow. Do not explore the codebase beyond these. -->

From `src/contracts/types.ts` (Plan 06-01):
- `AssemblyVerb` union (11 baseline + `"literal"` + `` `mcp://${string}/${string}` ``).
- `ContractStep { as, verb, args?, value? }`.
- `WriteBackSpec { sink, document_kind, properties, body_from }`.
- `OverrideMap = Record<string, string>`.
- `InstantiateError` closed union — 12 reasons sealed for v2.0.0 per ADR-006 §Decision 7 (WARNING-6 patch added `ambiguous_vault` for server-level dispatch).

From `src/contracts/input-schema.ts` (Plan 06-01) — `parsed.inputZodSchema.safeParse(args.inputs)` is the canonical input validation gate (Pitfall F2: additionalProperties:false rejects typos).

From `src/contracts/audit.ts` (Plan 06-01) — `recordContractStep({contract, verb, step_alias, vault})` is the per-step audit writer. Payload-free signature (C-5). Called by instantiate.ts AFTER each verb dispatch completes (success or failure).

From `src/memory/registry.ts:142` — `MemorySinkRegistry.resolveMemorySink(handle) → MemorySink | undefined`. D-A4c: sink_overrides validate against this; on `undefined`, return `{ok: false, reason: 'sink_override_not_a_memory_sink', target, hint}`.

From `src/memory/tools/supersede.ts` — `handleSupersede({doc_id, replacement_doc_id, reason})` Phase 5 D-12 auto-supersede chain for concurrent contract writes to same target. `instantiateContract`'s write_back path delegates to `DeliveryAdapter.write()` which already handles the chain (Phase 5 BRF-08 lock).

From `src/adapters/delivery/index.ts` — `DeliveryAdapter.write(doc, opts)` is the MEM-05 chokepoint. Contract write_back ALWAYS routes through here — never construct a Document and DB-insert directly. Returns `{doc_id, ...}` on success; throws or returns an error envelope on failure.

From RESEARCH §Architecture (lines 161-213) — the orchestration diagram. Plan 06-03 implements steps (1)-(7) verbatim:
  (1) Zod-validate inputs (z.fromJSONSchema → safeParse)
  (2) Resolve overrides (handle chain per D-A4b)
  (3) Validate sinks via MemorySinkRegistry.resolveMemorySink
  (4) Build template binding table
  (5) For each assembly step:
      a. resolve {{templates}} (templates.ts)
      b. dispatch verb (verbs/index.ts or verbs/mcp-extension.ts)
      c. write contract_step audit row
      d. bind output to {{as}}
  (6) Run write_back via DeliveryAdapter (template resolve body_from + properties + sink)
  (7) Validate output against output_shape (Q-OUTPUT: validates {steps, write_back} bundle)

From RESEARCH §Pattern 3 (lines 332-373) — the canonical PeerMcpRegistry skeleton.

From RESEARCH §Pitfall F4 — `Symbol.dispose` on `PeerMcpClient` MUST call `transport.close()` (which invokes `child.kill()`). `src/server.ts` MUST register `process.on('SIGTERM'/'SIGINT')` handler to dispose the registry. Mirrors `VaultWatcher.stop()` cleanup from Phase 1.

From RESEARCH §Pitfall F6 — `output_shape` validation runs AFTER `write_back` completes. The bundle is `{steps: {[alias]: <output>}, write_back: {doc_id: <real DocId from DeliveryAdapter.write> | null}}`. Intermediate step outputs are advisory; only `write_back.doc_id` is ground-truth.

From RESEARCH §Q-DESCRIBE (lines 985-1015) — `describe_contract` markdown summary template (Inputs / Sources / Sinks / Assembly numbered list / write_back / Output Shape).

From RESEARCH §A9 — verb signature verification: not all baseline verbs use `{vault, ...}` consistently. Plan 06-03 verifies each verb's signature at implementation time and writes per-verb adaptation in `verbs/index.ts` if needed. Specifically check: `search_hybrid` (accepts `{query, vault, top_k, ...}`), `compile_brief` (`{vault, target, source_doc_ids, purpose, max_tokens, prepared_text?}`), `expand` (`{seed_doc_ids, hops, edge_types?, direction?}`), `cluster` (`{seed_doc_ids, method}`), `query_frontmatter` (`{vault, where, limit}`), `recall` (`{query, min_confidence?, types?, max_age_days?, sink?, vault}`), `get_brief` (`{vault, target, max_age_days?, allow_stale?}`), `read_note` (look up exact signature in `src/server.ts` handler — may be `{doc_id}` or `{vault, path}`), `get_outline` (`{doc_id}`), `search_sections` (`{query, limit}`), `list_backlinks` (look up in `src/server.ts`).

From RESEARCH §A8 — `compile_brief` returns `{body, doc_id, ...}` per Phase 5. The contract template `{{compiled.body}}` resolves to a string. `write_back.body_from` template MUST resolve to a string body suitable for `DeliveryAdapter.write({body, properties})`.

From @modelcontextprotocol/sdk:
- `Client` (`client/index.js`) — `client.connect(transport)`, `client.callTool({name, arguments}) → {content: [...]}`.
- `StdioClientTransport` (`client/stdio.js`) — `new StdioClientTransport({command, args?, env?})`, `.close()` kills child process.

From `evals/v1-baseline/tools-list.snapshot.json` post-Plan-06-02 (35 entries) — Plan 06-03 adds 2 more (`describe_contract`, `instantiate_contract`) → 37. Final Phase 6 snapshot baseline per RESEARCH §F7.

From Plan 06-02 `src/server.ts` — `instantiateHandler` stub exists; Plan 06-03 Task 6-03-05 swaps it for the real `instantiateContract` function bound to per-vault deps.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 6-03-01: resolveTemplate — mustache {{alias.field}} resolver (D-A2c, RESEARCH Example 2 ~50 LOC)</name>
  <files>src/contracts/templates.ts, src/contracts/templates.test.ts, src/contracts/index.ts</files>
  <behavior>
    - Test 1: `resolveTemplate("{{inputs.name}}", {inputs: {name: "Atlas"}, steps: {}})` returns `{ok: true, value: "Atlas"}` — whole-string single expression returns the RAW typed value (string here).
    - Test 2: `resolveTemplate("{{step1.count}}", {inputs: {}, steps: {step1: {count: 42}}})` returns `{ok: true, value: 42}` — whole-string returns the raw NUMBER (not stringified).
    - Test 3: `resolveTemplate("{{step1.doc_ids}}", {inputs: {}, steps: {step1: {doc_ids: ["a", "b"]}}})` returns `{ok: true, value: ["a", "b"]}` — array shorthand returns the raw array.
    - Test 4: `resolveTemplate("Brief for {{inputs.target}}", {inputs: {target: "Atlas"}, steps: {}})` returns `{ok: true, value: "Brief for Atlas"}` — embedded substitution string-concats.
    - Test 5: `resolveTemplate("{{a.x}} {{b.y}}", {inputs: {}, steps: {a: {x: 1}, b: {y: 2}}})` returns `{ok: true, value: "1 2"}` — multiple embedded substitutions; non-string values JSON-stringified.
    - Test 6: `resolveTemplate("{{nope.x}}", {inputs: {}, steps: {}})` returns `{ok: false, reason: "unresolved_template", expression: "{{nope.x}}"}` — undefined alias.
    - Test 7: `resolveTemplate("{{step1.missing}}", {inputs: {}, steps: {step1: {x: 1}}})` returns `{ok: false, reason: "unresolved_template", expression: "{{step1.missing}}"}` — undefined field.
    - Test 8: `resolveTemplate({foo: "{{inputs.x}}", bar: ["{{inputs.y}}"]}, ...)` recurses into objects + arrays, resolving each leaf string.
    - Test 9: `resolveTemplate({foo: 42, bar: null}, ...)` passes non-string leaves through unchanged.
    - Test 10: `resolveTemplate("plain", ...)` returns `{ok: true, value: "plain"}` — strings without `{{` are returned unchanged.
    - Test 11: Field path traversal — `resolveTemplate("{{step1.nested.field[0]}}", {steps: {step1: {nested: {field: ["a", "b"]}}}})` returns `{ok: true, value: "a"}`. (Per RESEARCH Example 2 — `path.split(/[.[\]]/).filter(Boolean)` handles both `.` and `[i]` notation.)
    - Test 12: First unresolved template in an object short-circuits — `resolveTemplate({a: "{{ok.x}}", b: "{{bad.y}}"}, {steps: {ok: {x: 1}}})` returns the `unresolved_template` for `{{bad.y}}` (not the partial result).
    - Test 13: All 1346+ tests + Plan 06-01/06-02 tests stay green.
  </behavior>
  <action>
    Implement `src/contracts/templates.ts` verbatim from RESEARCH §Example 2 (lines 593-665). Total ~50 LOC. Pure function, zero deps. Export the `TemplateBindings` interface + `TemplateResolveResult` discriminated union + `resolveTemplate` function.

    Behavior contract (from Example 2):
    - Whole-string `^\{\{...\}\}$` → return raw typed value via `lookup(path, bindings)`.
    - Else: regex-replace embedded `{{...}}` with `lookup` result; non-string values JSON-stringified; undefined → set `failed` flag.
    - Recursion: arrays + objects walked, each leaf string resolved.
    - Non-string leaves (number, boolean, null) pass through unchanged.

    Add to `src/contracts/index.ts` barrel: `export { resolveTemplate, type TemplateBindings, type TemplateResolveResult } from "./templates.js";`.

    Co-locate `templates.test.ts` with the 13 Behavior cases. Use object literals only (no YAML).

    Security note: per ADR-006 §Decision 5 + Invariant C-7, `resolveTemplate` operates ONLY on contract YAML (read at boot, never user-supplied at call time). Inputs are pure values, never re-evaluated as templates. The implementation does NOT recursively resolve a value if it happens to contain `{{` — it returns the raw value. (Test 1 covers this: `inputs.name = "Atlas"` returns `"Atlas"`, never `"{{Atlas}}"` re-substitution.) **Critical invariant verified by test:** `resolveTemplate("{{inputs.x}}", {inputs: {x: "{{inputs.y}}"}, steps: {}})` returns `{ok: true, value: "{{inputs.y}}"}` (raw string, NOT a recursive substitution).

    Adapter-seam: zero `fs`/`path`/`yaml`/`chokidar` imports. Pure function only.
  </action>
  <verify>
    <automated>npx vitest run src/contracts/templates.test.ts && npx tsc --noEmit && bash scripts/lint-adapters.sh</automated>
  </verify>
  <done>resolveTemplate green for all 13 cases; ~50 LOC; whole-string returns typed value; embedded substitutes as string concat; template injection invariant (Test 1 + critical invariant) verified.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 6-03-02: PeerMcpRegistry + Symbol.dispose lifecycle (D-A2a peer-MCP, Pitfall F4, RESEARCH Pattern 3)</name>
  <files>src/contracts/mcp-clients.ts, src/contracts/mcp-clients.test.ts, src/contracts/index.ts</files>
  <behavior>
    - Test 1: `PeerMcpRegistry` constructed with an empty `{}` config has `registry.size === 0`; subsequent `start({})` is a no-op.
    - Test 2: `start({gh: {command: "echo", args: ["test"]}})` attempts to launch the child; on connect failure (e.g., `echo` exits immediately without speaking MCP protocol), the registry marks `gh` as unavailable + writes a structured WARN to stderr; subsequent `registry.get("gh").available === false`.
    - Test 3: `registry.get("nonexistent")` returns `undefined`.
    - Test 4: `Symbol.dispose` on a PeerMcpClient invokes `transport.close()` — verified via spy. Pitfall F4: child process MUST be killed (not just orphaned).
    - Test 5: `registry.shutdown()` calls `Symbol.dispose` on every client and clears the internal map.
    - Test 6: With a SUCCESSFUL stub server (use a tiny inline `node` MCP server spawned in tests, similar to `scripts/smoketest-non-claude.mjs:41-42` pattern), `start({test: {command: 'node', args: ['./test/fixtures/stub-mcp-server.mjs']}})` connects + `registry.get('test').available === true` + `await registry.get('test').client.listTools()` returns the stub's tool list. **NOTE:** if creating an inline stub MCP server is too heavy for this slice, the test MAY use a mock `Client` injected via a constructor parameter (`PeerMcpRegistry` accepts an optional `clientFactory` for testability). The simpler mock path is acceptable for unit tests; CON-09 smoketest in Plan 06-04 exercises the real path end-to-end.
    - Test 7: `registry.get('test').callTool('some_tool', {x: 1})` forwards to `client.callTool({name: 'some_tool', arguments: {x: 1}})` and returns the parsed result (NOT the raw `{content: [...]}` envelope — peel one layer, see Action below).
    - Test 8: All 1346+ tests + Plan 06-01/06-02 + Task 6-03-01 tests stay green.
  </behavior>
  <action>
    Implement `src/contracts/mcp-clients.ts` per RESEARCH §Pattern 3 (lines 332-373):

    ```typescript
    import { Client } from "@modelcontextprotocol/sdk/client/index.js";
    import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

    export interface PeerMcpClientConfig {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }

    export interface PeerMcpClient {
      callTool(name: string, args: unknown): Promise<unknown>;
      available: boolean;
      [Symbol.dispose](): void;
    }

    // Optional injection point for testing.
    export type ClientFactory = (cfg: PeerMcpClientConfig) => Promise<{ client: Client; transport: { close(): void } }>;

    export class PeerMcpRegistry {
      private clients = new Map<string, PeerMcpClient>();
      constructor(private clientFactory?: ClientFactory) {}

      get size(): number { return this.clients.size; }

      async start(configs: Record<string, PeerMcpClientConfig>): Promise<void> {
        for (const [name, cfg] of Object.entries(configs)) {
          try {
            const { client, transport } = this.clientFactory
              ? await this.clientFactory(cfg)
              : await this.defaultConnect(cfg);
            this.clients.set(name, this.wrapAvailable(client, transport));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[contracts] peer-MCP client '${name}' failed to start: ${msg}\n`);
            this.clients.set(name, this.wrapUnavailable(name));
          }
        }
      }

      get(name: string): PeerMcpClient | undefined { return this.clients.get(name); }

      async shutdown(): Promise<void> {
        for (const c of this.clients.values()) c[Symbol.dispose]();
        this.clients.clear();
      }

      private async defaultConnect(cfg: PeerMcpClientConfig): Promise<{ client: Client; transport: StdioClientTransport }> {
        const transport = new StdioClientTransport({ command: cfg.command, args: cfg.args ?? [], env: cfg.env });
        const client = new Client({ name: "vault-memory-peer", version: "2.0.0" });
        await client.connect(transport);
        return { client, transport };
      }

      private wrapAvailable(client: Client, transport: { close(): void }): PeerMcpClient {
        return {
          available: true,
          async callTool(name: string, args: unknown): Promise<unknown> {
            const res = await client.callTool({ name, arguments: args as Record<string, unknown> });
            // Peel MCP envelope: result.content[0] is typically {type:'text', text: '...'}. Return parsed JSON if applicable.
            const first = (res as any)?.content?.[0];
            if (first?.type === "text" && typeof first.text === "string") {
              try { return JSON.parse(first.text); } catch { return first.text; }
            }
            return res;
          },
          [Symbol.dispose](): void { transport.close(); },
        };
      }

      private wrapUnavailable(_name: string): PeerMcpClient {
        return {
          available: false,
          async callTool(): Promise<unknown> { throw new Error("peer-MCP client unavailable"); },
          [Symbol.dispose](): void {},
        };
      }
    }
    ```

    Export from `src/contracts/index.ts` barrel: `export { PeerMcpRegistry, type PeerMcpClient, type PeerMcpClientConfig } from "./mcp-clients.js";`.

    Co-locate `mcp-clients.test.ts` with the 8 Behavior cases. Use the `clientFactory` injection path for unit tests — mock Client returns `{ content: [{type: 'text', text: JSON.stringify({hello: 'world'})}] }` from `callTool`. For Test 4, the mock transport's `close()` is a spy.

    Plan 06-04 will exercise the real `defaultConnect` path via the CON-09 non-Claude smoketest extension.

    Adapter-seam: imports `@modelcontextprotocol/sdk/client/*` only. No `fs`/`path`/`yaml`/`chokidar`. The `StdioClientTransport` internally spawns a child process via Node's `child_process.spawn` — that's allowed because it's encapsulated inside the SDK, not in `src/contracts/`.
  </action>
  <verify>
    <automated>npx vitest run src/contracts/mcp-clients.test.ts && npx tsc --noEmit && bash scripts/lint-adapters.sh</automated>
  </verify>
  <done>PeerMcpRegistry green for all 8 cases; Symbol.dispose kills child process (Pitfall F4); WARN-on-fail + available flag; `clientFactory` injection for testability; SDK Client + StdioClientTransport pattern verified.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 6-03-03: verbDispatcher + literal handler + mcp:// extension with Q-TIMEOUT (D-A2a, RESEARCH §A9)</name>
  <files>src/contracts/verbs/index.ts, src/contracts/verbs/index.test.ts, src/contracts/verbs/mcp-extension.ts, src/contracts/verbs/mcp-extension.test.ts, src/contracts/index.ts</files>
  <behavior>
    - Test 1 (literal): `verbDispatcher("literal", {}, {value: "hello"}, deps)` returns `"hello"` — `literal` verb's "args" is the `value` field of the step (not the `args` field). The dispatcher peels the step shape correctly.
    - Test 2 (literal preserves type): `verbDispatcher("literal", {}, {value: [1, 2, 3]}, deps)` returns the array verbatim.
    - Test 3 (baseline verb — search_hybrid): `verbDispatcher("search_hybrid", {query: "test", vault: "my-vault", top_k: 5}, undefined, deps)` calls `deps.hybridSearch({query, vault, top_k})` and returns its result. Test mocks `hybridSearch` to return `{hits: [{doc_id: 'x'}]}` and asserts dispatcher passes through.
    - Test 4 (baseline verb — compile_brief): `verbDispatcher("compile_brief", {vault, target, source_doc_ids, purpose, max_tokens}, undefined, deps)` calls `deps.handleCompileBrief(deps, args)`. Test verifies the deps object passed through unchanged.
    - Test 5 (per-verb signature adaptation): For each of the 11 baseline verbs, a test verifies the args shape matches the verb's signature. Per RESEARCH §A9, write per-verb adaptation code only where signatures diverge (e.g., `read_note` may need `{doc_id} → {vault, path}` if its existing implementation takes a vault+path pair). Document each verb's exact signature in a JSDoc comment block at the top of `verbs/index.ts`.
    - Test 6 (unknown verb): `verbDispatcher("write_note", {}, undefined, deps)` returns `{ok: false, reason: "verb_not_available", verb: "write_note"}` — write verbs are NOT in the assembly enum per D-A2a / Invariant C-1. (The Zod schema rejects this at contract load, but defense-in-depth at dispatch.)
    - Test 7 (mcp:// — peer client available): `verbDispatcher("mcp://gh/list_issues", {repo: "x"}, undefined, deps)` delegates to `callMcpVerb` which looks up `deps.peerMcpRegistry.get("gh")`; if available, calls `callTool("list_issues", {repo: "x"})`; returns the parsed result.
    - Test 8 (mcp:// — peer client unavailable): `verbDispatcher("mcp://ghost/x", {}, undefined, deps)` returns `{ok: false, reason: "mcp_client_unavailable", verb: "mcp://ghost/x", client_name: "ghost"}`.
    - Test 9 (mcp:// — peer client present but unavailable): When `peerMcpRegistry.get("gh").available === false` (e.g., the connection failed at boot), returns `{ok: false, reason: "mcp_client_unavailable", verb: ..., client_name: "gh"}`.
    - Test 10 (Q-TIMEOUT — peer-MCP only): `callMcpVerb("mcp://gh/slow", {}, deps, {timeoutSeconds: 1})` with a mocked client that hangs returns `{ok: false, reason: "assembly_step_failed", step_alias: <passed-in>, cause: "timeout"}` after 1s. Baseline verbs (Test 11) are NOT wrapped in this timeout.
    - Test 11 (Q-TIMEOUT — baseline NOT wrapped): `verbDispatcher("search_hybrid", {query: "x"}, undefined, deps, {timeoutSeconds: 0.001})` does NOT timeout even with an absurdly small timeout — the timeout option is ignored for baseline verbs (Q-TIMEOUT decision).
    - Test 12 (mcp:// malformed): `verbDispatcher("mcp://onlyslashbad", {}, undefined, deps)` is caught by Zod at contract load (Plan 06-01 schema regex enforces `^mcp:\/\/[a-z][a-z0-9_-]*\/[a-z][a-z0-9_-]*$`); defense-in-depth dispatcher returns `{ok: false, reason: "verb_not_available", verb: "mcp://onlyslashbad"}`.
    - Test 13: All 1346+ tests + Plan 06-01/06-02 + Tasks 6-03-01/02 tests stay green.
  </behavior>
  <action>
    Before implementation, audit the 11 baseline verbs' signatures by reading the existing handlers in `src/server.ts` (or wherever each tool's handler is registered). Document each in a JSDoc block at the top of `src/contracts/verbs/index.ts`:

    ```typescript
    /**
     * Baseline verb signatures (verified against existing implementations per RESEARCH §A9):
     * - search_hybrid: ({query, vault, top_k?, recency_weight?, authority_weight?, superseded?, expand?}) → {hits}
     * - expand: ({seed_doc_ids, hops, vault, edge_types?, direction?, filter_properties?}) → {doc_ids, edges}
     * - cluster: ({seed_doc_ids, vault, method}) → {clusters}
     * - recall: ({query, vault, min_confidence?, types?, max_age_days?, sink?}) → {hits}
     * - compile_brief: ({vault, target, source_doc_ids, purpose, max_tokens?, prepared_text?}) → {ok, doc_id, body?}
     * - get_brief: ({vault, target, max_age_days?, allow_stale?}) → Brief | {stale: true, ...} | null
     * - query_frontmatter: ({vault, where, limit?}) → {doc_ids, rows}
     * - list_backlinks: ({doc_id, vault}) → {backlinks}
     * - get_outline: ({doc_id, vault}) → {nodes}
     * - search_sections: ({query, vault, limit?}) → {hits}
     * - read_note: ({doc_id, vault}) → {body, properties, ...}
     *
     * Each adapter in verbDispatcher reshapes contract YAML args (post-template-resolution) into the verb's expected shape.
     */
    ```

    Then implement `verbDispatcher`:

    ```typescript
    import type { AssemblyVerb } from "../types.js";
    import { callMcpVerb } from "./mcp-extension.js";

    export interface VerbDeps {
      vault: { config: { name: string }; db: unknown };
      hybridSearch: (args: any) => Promise<unknown>;
      handleExpand: (args: any) => Promise<unknown>;
      handleCluster: (args: any) => Promise<unknown>;
      handleRecall: (args: any) => Promise<unknown>;
      handleCompileBrief: (args: any) => Promise<unknown>;
      handleGetBrief: (args: any) => Promise<unknown>;
      handleQueryFrontmatter: (args: any) => Promise<unknown>;
      handleListBacklinks: (args: any) => Promise<unknown>;
      handleGetOutline: (args: any) => Promise<unknown>;
      handleSearchSections: (args: any) => Promise<unknown>;
      handleReadNote: (args: any) => Promise<unknown>;
      peerMcpRegistry: import("../mcp-clients.js").PeerMcpRegistry;
    }

    export interface VerbDispatchOpts {
      timeoutSeconds: number;
      stepAlias: string;
    }

    /** D-A2a closed baseline + literal + mcp:// dispatcher. */
    export async function verbDispatcher(
      verb: AssemblyVerb,
      args: Record<string, unknown> | undefined,
      step: { value?: unknown },
      deps: VerbDeps,
      opts: VerbDispatchOpts,
    ): Promise<unknown> {
      if (verb === "literal") return step.value;
      if (typeof verb === "string" && verb.startsWith("mcp://")) {
        return callMcpVerb(verb, args ?? {}, deps.peerMcpRegistry, opts);
      }
      switch (verb) {
        case "search_hybrid": return deps.hybridSearch(args);
        case "expand": return deps.handleExpand(args);
        case "cluster": return deps.handleCluster(args);
        case "recall": return deps.handleRecall(args);
        case "compile_brief": return deps.handleCompileBrief(args);
        case "get_brief": return deps.handleGetBrief(args);
        case "query_frontmatter": return deps.handleQueryFrontmatter(args);
        case "list_backlinks": return deps.handleListBacklinks(args);
        case "get_outline": return deps.handleGetOutline(args);
        case "search_sections": return deps.handleSearchSections(args);
        case "read_note": return deps.handleReadNote(args);
        default:
          return { ok: false, reason: "verb_not_available", verb };
      }
    }
    ```

    Implement `src/contracts/verbs/mcp-extension.ts`:

    ```typescript
    import type { PeerMcpRegistry } from "../mcp-clients.js";
    import type { VerbDispatchOpts } from "./index.js";

    const MCP_VERB_RE = /^mcp:\/\/([a-z][a-z0-9_-]*)\/([a-z][a-z0-9_-]*)$/;

    export async function callMcpVerb(
      verb: string,
      args: Record<string, unknown>,
      registry: PeerMcpRegistry,
      opts: VerbDispatchOpts,
    ): Promise<unknown> {
      const match = MCP_VERB_RE.exec(verb);
      if (!match) return { ok: false, reason: "verb_not_available", verb };
      const [, serverName, toolName] = match;
      const client = registry.get(serverName!);
      if (!client || !client.available) {
        return { ok: false, reason: "mcp_client_unavailable", verb, client_name: serverName };
      }
      // Q-TIMEOUT: wrap ONLY peer-MCP verbs.
      const timeoutMs = opts.timeoutSeconds * 1000;
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), timeoutMs),
      );
      try {
        return await Promise.race([client.callTool(toolName!, args), timeoutPromise]);
      } catch (err) {
        const cause = err instanceof Error && err.message === "timeout" ? "timeout" : (err instanceof Error ? err.message : String(err));
        return { ok: false, reason: "assembly_step_failed", step_alias: opts.stepAlias, cause };
      }
    }
    ```

    Export from `src/contracts/index.ts` barrel: `export { verbDispatcher, type VerbDeps, type VerbDispatchOpts } from "./verbs/index.js"; export { callMcpVerb } from "./verbs/mcp-extension.js";`.

    Co-locate the two test files with the 13 Behavior cases. Mock each baseline verb's handler with a tiny `vi.fn()`; assert the dispatcher's call shape matches the documented signature.

    Adapter-seam: zero `fs`/`path`/`yaml`/`chokidar` imports. SDK + Plan 06-01/02 modules only.
  </action>
  <verify>
    <automated>npx vitest run src/contracts/verbs/ && npx tsc --noEmit && bash scripts/lint-adapters.sh</automated>
  </verify>
  <done>verbDispatcher + callMcpVerb green for all 13 cases; 11 baseline verb signatures documented + adapted in JSDoc; literal handler peels step.value; mcp:// extension wrapped with Q-TIMEOUT; baseline verbs NOT wrapped (Test 11); structured errors for verb_not_available + mcp_client_unavailable + assembly_step_failed.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 6-03-04: instantiateContract orchestrator (CON-06, RESEARCH §Architecture (1)-(7), D-A4a/b/c, Q-OUTPUT)</name>
  <files>src/contracts/instantiate.ts, src/contracts/instantiate.test.ts, src/contracts/index.ts</files>
  <behavior>
    - Test 1 (CON-06 happy path): With a stub registry containing meeting-prep (RESEARCH Example 1 simplified to use only `literal` verbs), `instantiateContract(deps, {name: 'meeting-prep', inputs: {meeting_doc_id: 'obsidian-fs://v/p.md', context_hops: 1}})` runs all assembly steps → resolves write_back → returns `{ok: true, steps: {meeting: ..., linked: ..., clustered: ..., compiled: ...}, write_back: {doc_id: <DocId from DeliveryAdapter.write>}}`.
    - Test 2 (unknown_contract): `instantiateContract(deps, {name: 'no-such', inputs: {}})` returns `{ok: false, reason: 'unknown_contract', name: 'no-such'}`.
    - Test 3 (invalid_inputs): Inputs failing Zod validation against `parsed.inputZodSchema` return `{ok: false, reason: 'invalid_inputs', issues: <z.ZodFormattedError>}`. Includes additionalProperties:false rejection (Pitfall F2): typo'd key fails.
    - Test 4 (unknown_override_handle): `source_overrides: {nope: 'x://'}` against a contract declaring only `default_source` returns `{ok: false, reason: 'unknown_override_handle', handle: 'nope', valid_handles: ['default_source']}`.
    - Test 5 (missing_required_source): Contract with `default_source: {required: true}` and no override + no config default returns `{ok: false, reason: 'missing_required_source', handle: 'default_source', hint: ...}`.
    - Test 6 (default chain order): With contract declaring `default_source: {handle: 'obsidian-fs://contract-lit'}` + config `[contracts.defaults.default_source] = 'obsidian-fs://config-default'` + call-time `source_overrides: {default_source: 'stub://override'}`, the resolved value is `'stub://override'` (explicit wins). Without the override, `'obsidian-fs://config-default'` wins. Without both, `'obsidian-fs://contract-lit'` wins. With `required: true` and none → missing_required_source.
    - Test 7 (sink_override_not_a_memory_sink — D-A4c): `sink_overrides: {default_sink: 'obsidian-fs://not-a-sink/'}` where the target is NOT a registered MemorySink → `{ok: false, reason: 'sink_override_not_a_memory_sink', target: 'obsidian-fs://not-a-sink/', hint: ...}`. Test mocks `MemorySinkRegistry.resolveMemorySink` to return `undefined` for the target.
    - Test 8 (sink_override happy): `sink_overrides: {default_sink: '_memory/_briefs'}` where the registry resolves it → instantiation proceeds.
    - Test 9 (unresolved_template): Contract step `as: x, verb: literal, value: '{{nope.field}}'` returns `{ok: false, reason: 'unresolved_template', expression: '{{nope.field}}'}`.
    - Test 10 (assembly_step_failed): A baseline verb that throws → `{ok: false, reason: 'assembly_step_failed', step_alias: <as>, cause: <error message>}`.
    - Test 11 (named binding accumulation): A two-step contract where step 2's args reference `{{step1.foo}}` works correctly; the bindings table grows as steps complete.
    - Test 12 (write_back happy): A contract with write_back routes the resolved `body_from` + `properties` through `DeliveryAdapter.write({body, properties}, {sink})` and the returned `doc_id` lands in `bundle.write_back.doc_id`. Mock `DeliveryAdapter.write` to return `{doc_id: 'obsidian-fs://v/_memory/_briefs/foo.md' as DocId}`.
    - Test 13 (write_back_failed): When `DeliveryAdapter.write` throws → `{ok: false, reason: 'write_back_failed', cause: <error message>}`.
    - Test 14 (validation_failed_on_output_shape): Output_shape Zod schema (built from `parsed.output_shape` via `buildInputSchema`-like wrapper) rejects the bundle → `{ok: false, reason: 'validation_failed_on_output_shape', issues: ...}`.
    - Test 15 (Q-OUTPUT — bundle shape): The validated bundle is `{steps: {[alias]: <output>}, write_back: {doc_id, sink} | null}`. Test asserts the shape matches Q-OUTPUT exactly. When no `write_back` block exists in the contract, `bundle.write_back === null`.
    - Test 16 (contract_audit per step): After a 3-step contract instantiation, `vault.db.contractAudit.listByKind('contract_step', {vault: 'my-vault'})` returns 3 rows with the correct contract/verb/step_alias values + monotonic ts. Payload-free (C-5 enforced by the writer's signature).
    - Test 17 (audit row on failure): When step 2 fails with `assembly_step_failed`, step 1's audit row IS written (it succeeded), step 2's audit row is ALSO written (failure is also a step event — useful for debugging). Plan 06-03 chooses: write the step audit row AFTER attempt regardless of success/failure (matches "per step of instantiate_contract" CONTEXT.md wording).
    - Test 18 (concurrent — Claude's Discretion): Two `instantiateContract` calls with same contract name + same `target` interleave; both succeed; both `write_back.doc_id` land via `DeliveryAdapter.write` which delegates to the Phase 5 D-12 auto-supersede chain. No mutex; no `assembly_step_failed`. Test mocks DeliveryAdapter to return two distinct doc_ids.
    - Test 19: All 1346+ tests + Plan 06-01/06-02 + Tasks 6-03-01/02/03 tests stay green.
  </behavior>
  <action>
    Implement `src/contracts/instantiate.ts` per RESEARCH §Architecture (1)-(7). The function signature:

    ```typescript
    import { z } from "zod";  // WARNING-5: top-level import for output_shape Zod build (no dynamic import in the hot path)
    import type { ContractRegistry } from "./registry.js";
    import type { ParsedContract, InstantiateError, OverrideMap } from "./types.js";
    import { resolveTemplate, type TemplateBindings } from "./templates.js";
    import { verbDispatcher, type VerbDeps } from "./verbs/index.js";
    import { recordContractStep, type ContractAuditDeps } from "./audit.js";
    import { buildInputSchema } from "./input-schema.js";  // re-uses additionalProperties:false wrapper (Pitfall F2) — kept for input validation
    import type { MemorySinkRegistry } from "../memory/registry.js";
    import type { DeliveryAdapter } from "../adapters/delivery/types.js";

    export interface InstantiateDeps extends VerbDeps, ContractAuditDeps {
      registry: ContractRegistry;
      memorySinks: MemorySinkRegistry;
      delivery: DeliveryAdapter;
      configDefaults: Record<string, string>;
      stepTimeoutSeconds: number;
    }

    export interface InstantiateArgs {
      name: string;
      inputs: Record<string, unknown>;
      source_overrides?: OverrideMap;
      sink_overrides?: OverrideMap;
    }

    export type InstantiateResult =
      | { ok: true; steps: Record<string, unknown>; write_back: { doc_id: string; sink: string } | null }
      | InstantiateError;

    export async function instantiateContract(
      deps: InstantiateDeps,
      args: InstantiateArgs,
    ): Promise<InstantiateResult> {
      // (1) Lookup contract.
      const parsed = deps.registry.get(args.name);
      if (!parsed) return { ok: false, reason: "unknown_contract", name: args.name };

      // (2) Zod-validate inputs.
      const inputCheck = parsed.inputZodSchema.safeParse(args.inputs);
      if (!inputCheck.success) {
        return { ok: false, reason: "invalid_inputs", issues: inputCheck.error.format() };
      }

      // (3) Resolve override handles + (4) validate sink targets.
      const validSourceHandles = Object.keys(parsed.sources);
      for (const handle of Object.keys(args.source_overrides ?? {})) {
        if (!validSourceHandles.includes(handle)) {
          return { ok: false, reason: "unknown_override_handle", handle, valid_handles: validSourceHandles };
        }
      }
      const validSinkHandles = Object.keys(parsed.sinks);
      for (const handle of Object.keys(args.sink_overrides ?? {})) {
        if (!validSinkHandles.includes(handle)) {
          return { ok: false, reason: "unknown_override_handle", handle, valid_handles: validSinkHandles };
        }
      }
      // Default chain per D-A4b: explicit → config → contract YAML literal → error if required.
      const resolvedSources: Record<string, string | null> = {};
      for (const [handle, decl] of Object.entries(parsed.sources)) {
        const v = args.source_overrides?.[handle] ?? deps.configDefaults[handle] ?? decl.handle;
        if (!v && decl.required) {
          return { ok: false, reason: "missing_required_source", handle, hint: `pass via source_overrides or set [contracts.defaults.${handle}] in config.toml` };
        }
        resolvedSources[handle] = v ?? null;
      }
      const resolvedSinks: Record<string, string | null> = {};
      for (const [handle, decl] of Object.entries(parsed.sinks)) {
        const v = args.sink_overrides?.[handle] ?? deps.configDefaults[handle] ?? decl.handle;
        if (!v && decl.required) {
          return { ok: false, reason: "missing_required_source", handle, hint: `pass via sink_overrides or set [contracts.defaults.${handle}] in config.toml` };
        }
        if (v) {
          // D-A4c MemorySink invariant.
          const sink = deps.memorySinks.resolveMemorySink(v);
          if (!sink) {
            return { ok: false, reason: "sink_override_not_a_memory_sink", target: v, hint: "sinks must be a registered MemorySink handle (see list_sinks)" };
          }
        }
        resolvedSinks[handle] = v ?? null;
      }

      // (4) Build template binding table — sources + sinks visible to `{{default_source}}` style refs.
      const bindings: TemplateBindings = {
        inputs: { ...inputCheck.data, ...resolvedSources, ...resolvedSinks },  // sources/sinks accessible via {{default_source}} etc.
        steps: {},
      };

      // (5) Execute steps.
      for (const step of parsed.assembly) {
        // (a) resolve templates on args.
        const resolvedArgs = step.args ? resolveTemplate(step.args, bindings) : { ok: true, value: undefined };
        if (!resolvedArgs.ok) {
          recordContractStep(deps, { contract: parsed.name, verb: step.verb, step_alias: step.as, vault: deps.vault.config.name });
          return { ok: false, reason: "unresolved_template", expression: resolvedArgs.expression };
        }
        // Resolve `value` too (for literal verb).
        const resolvedValue = step.value !== undefined ? resolveTemplate(step.value, bindings) : { ok: true, value: undefined };
        if (!resolvedValue.ok) {
          recordContractStep(deps, { contract: parsed.name, verb: step.verb, step_alias: step.as, vault: deps.vault.config.name });
          return { ok: false, reason: "unresolved_template", expression: resolvedValue.expression };
        }
        // (b) dispatch verb.
        let output: unknown;
        try {
          output = await verbDispatcher(
            step.verb,
            resolvedArgs.value as Record<string, unknown> | undefined,
            { value: resolvedValue.value },
            deps,
            { stepAlias: step.as, timeoutSeconds: deps.stepTimeoutSeconds },
          );
        } catch (err) {
          recordContractStep(deps, { contract: parsed.name, verb: step.verb, step_alias: step.as, vault: deps.vault.config.name });
          return { ok: false, reason: "assembly_step_failed", step_alias: step.as, cause: err instanceof Error ? err.message : String(err) };
        }
        // If verbDispatcher returned a structured error envelope, surface it (verb_not_available / mcp_client_unavailable / assembly_step_failed).
        if (output && typeof output === "object" && "ok" in (output as Record<string, unknown>) && (output as { ok: boolean }).ok === false) {
          recordContractStep(deps, { contract: parsed.name, verb: step.verb, step_alias: step.as, vault: deps.vault.config.name });
          return output as InstantiateError;
        }
        // (c) write audit row.
        recordContractStep(deps, { contract: parsed.name, verb: step.verb, step_alias: step.as, vault: deps.vault.config.name });
        // (d) bind output.
        bindings.steps[step.as] = output;
      }

      // (6) Run write_back via DeliveryAdapter.write (MEM-05 chokepoint).
      let writeBackResult: { doc_id: string; sink: string } | null = null;
      if (parsed.write_back) {
        const wb = parsed.write_back;
        const sinkResolved = resolveTemplate(wb.sink, bindings);
        const bodyResolved = resolveTemplate(wb.body_from, bindings);
        const propsResolved = resolveTemplate(wb.properties, bindings);
        if (!sinkResolved.ok) return { ok: false, reason: "unresolved_template", expression: sinkResolved.expression };
        if (!bodyResolved.ok) return { ok: false, reason: "unresolved_template", expression: bodyResolved.expression };
        if (!propsResolved.ok) return { ok: false, reason: "unresolved_template", expression: propsResolved.expression };
        if (typeof bodyResolved.value !== "string") {
          return { ok: false, reason: "write_back_failed", cause: `body_from must resolve to a string, got ${typeof bodyResolved.value}` };
        }
        try {
          const writeRes = await deps.delivery.write(
            { body: bodyResolved.value, properties: propsResolved.value as Record<string, unknown> },
            { sink: sinkResolved.value as string },
          );
          writeBackResult = { doc_id: (writeRes as { doc_id: string }).doc_id, sink: sinkResolved.value as string };
        } catch (err) {
          return { ok: false, reason: "write_back_failed", cause: err instanceof Error ? err.message : String(err) };
        }
      }

      // (7) Validate bundle against output_shape (Q-OUTPUT).
      const bundle = { steps: bindings.steps, write_back: writeBackResult };
      if (parsed.output_shape) {
        const { zodSchema } = buildInputSchema(
          { steps: { type: "object" }, write_back: { type: ["object", "null"] } },  // wrap permissively for top-level
          [],
        );
        // Simpler approach: build a Zod schema from parsed.output_shape directly via z.fromJSONSchema.
        // The output_shape from the YAML applies to the bundle as a whole.
        // For v2.0.0, validate only the `bundle` object against `parsed.output_shape` if it's a JSON Schema object.
        // (Documented in ADR-006 §Decision 10 — Q-OUTPUT.)
        // Implementation note: use z.fromJSONSchema(parsed.output_shape).safeParse(bundle) when output_shape is provided.
        try {
          const outputSchema = z.fromJSONSchema(parsed.output_shape) as { safeParse: (v: unknown) => { success: boolean; error?: { format: () => unknown } } };
          const check = outputSchema.safeParse(bundle);
          if (!check.success) {
            return { ok: false, reason: "validation_failed_on_output_shape", issues: check.error?.format() };
          }
        } catch (err) {
          // If parsed.output_shape isn't a valid Zod-parseable schema, log via stderr and skip validation.
          process.stderr.write(`[contracts] output_shape validation skipped: ${err instanceof Error ? err.message : String(err)}\n`);
        }
      }

      return { ok: true, steps: bindings.steps, write_back: writeBackResult };
    }
    ```

    Export from `src/contracts/index.ts` barrel: `export { instantiateContract, type InstantiateDeps, type InstantiateArgs, type InstantiateResult } from "./instantiate.js";`.

    Co-locate `instantiate.test.ts` with the 19 Behavior cases. Use stub deps:
    - `StubMemorySinkRegistry` whose `resolveMemorySink(handle)` returns a fixture sink or undefined per the test case.
    - `StubDeliveryAdapter` whose `write()` is a `vi.fn()` returning `{doc_id: 'obsidian-fs://v/_memory/_briefs/test.md'}`.
    - `StubVerbHandlers` for each baseline verb (mock the 11 with `vi.fn()`).
    - A `:memory:` SQLite DB + `db.migrate()` + `ContractAuditDeps`.

    For Test 1 happy path, use the simplest possible synthetic contract: 1 input + 2 steps using `literal` verb + write_back with `body_from: '{{step2.value}}'`. This avoids depending on real verb implementations and keeps the test isolated to the orchestrator.

    Adapter-seam: zero `fs`/`path`/`yaml`/`chokidar` imports. Only Plan 06-01/02 modules + Phase 2 MemorySinkRegistry types + DeliveryAdapter types + zod.
  </action>
  <verify>
    <automated>npx vitest run src/contracts/instantiate.test.ts && npx tsc --noEmit && bash scripts/lint-adapters.sh</automated>
  </verify>
  <done>instantiateContract orchestrator green for all 19 cases; all 11 orchestrator-level InstantiateError reasons reachable in tests (the 12th — `ambiguous_vault` — fires only from server-level dispatch in Task 6-03-05); MEM-05 invariant un-bypassable verified (Test 7); Q-OUTPUT bundle shape correct (Test 15); per-step contract_audit rows written payload-free; concurrent calls (Test 18) work via Phase 5 D-12 supersede chain.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 6-03-05: describeContract + MCP tool registration + server wiring (CON-05, Q-DESCRIBE, +2 tools)</name>
  <files>src/contracts/describe.ts, src/contracts/describe.test.ts, src/contracts/index.ts, src/tool-registry.ts, src/server.ts, evals/v1-baseline/tools-list.snapshot.json</files>
  <behavior>
    - Test 1 (describe — happy): For the RESEARCH §Q-DESCRIBE example contract (meeting-prep), `describeContract(deps, {name: 'meeting-prep'})` returns `{ok: true, json_schema: <parsed.inputJsonSchema>, summary: <markdown>}`. The summary contains the headings `## Inputs`, `## Sources`, `## Sinks`, `## Assembly`, `## write_back`, `## Output Shape` and lists each input with `- **<name>** (<type>, <required?>): <description>`.
    - Test 2 (unknown_contract): `describeContract(deps, {name: 'nope'})` returns `{ok: false, reason: 'unknown_contract', name: 'nope'}`.
    - Test 3 (assembly numbered list): The summary lists each assembly step as `1. **<as>** ← \`<verb>(<args summary>)\`` per RESEARCH §Q-DESCRIBE template. The `<args summary>` is a compact rendering of `step.args` (top-level keys + values; nested objects elided as `{...}`).
    - Test 4 (write_back description): When `parsed.write_back` exists, the summary contains `## write_back\nWrites a <document_kind> document to <sink> with body from <body_from>.`. When absent, the summary omits the section.
    - Test 5 (output_shape description): When `parsed.output_shape` is `{type: 'object', properties: {brief_doc_id: {$ref: '#/types/DocId'}, cluster_count: {type: 'integer'}}}` (post-resolveRefs), the summary contains a compact rendering like `\`{brief_doc_id: DocId, cluster_count: integer}\``. When absent, the section is omitted.
    - Test 6 (sources/sinks rendering): The summary lists each declared source/sink with `- **<handle>** → \`<default URI>\` (<required?> <kind>)`. For sinks, append `(required MemorySink)`.
    - Test 7 (pure function): `describeContract` does NOT touch the DB, the network, or the FS — verified by passing a `deps` object with `null` for everything except `registry`.
    - Test 8 (instantiate_contract MCP tool): Tool registered in `src/tool-registry.ts` with `inputSchema: z.object({name: z.string(), inputs: z.record(z.string(), z.unknown()).default({}), source_overrides: z.record(z.string(), z.string()).optional(), sink_overrides: z.record(z.string(), z.string()).optional()})`.
    - Test 9 (describe_contract MCP tool): Tool registered in `src/tool-registry.ts` with `inputSchema: z.object({name: z.string()})`.
    - Test 10 (handler dispatch in server.ts): The `instantiate_contract` and `describe_contract` handlers in `src/server.ts` route to `instantiateContract` / `describeContract` with per-vault deps. The auto-register stub `instantiateHandler` from Plan 06-02 is REPLACED with a closure that calls `instantiateContract(perVaultDeps, args)`.
    - Test 11 (snapshot diff): `evals/v1-baseline/tools-list.snapshot.json` increases by exactly 2 entries (`describe_contract`, `instantiate_contract`); 35 prior entries byte-identical. Final count: 37 (per RESEARCH §F7).
    - Test 12 (E2E small): With a real `:memory:` DB + stub MemorySinkRegistry + stub DeliveryAdapter, registering a tiny contract via the loader (or manually via `registry.set`), calling `instantiate_contract` via the MCP server handler returns the expected bundle wrapped in MCP envelope `{content: [{type: 'text', text: JSON.stringify({ok: true, steps, write_back})}]}`.
    - Test 13: All 1346+ tests + Plan 06-01/06-02 + Tasks 6-03-01/02/03/04 tests stay green.
  </behavior>
  <action>
    Implement `src/contracts/describe.ts` per RESEARCH §Q-DESCRIBE template (lines 985-1015). Pure function over `ParsedContract`:

    ```typescript
    import type { ContractRegistry } from "./registry.js";
    import type { ParsedContract } from "./types.js";

    export interface DescribeDeps { registry: ContractRegistry; }

    export interface DescribeArgs { name: string; }

    export type DescribeResult =
      | { ok: true; json_schema: object; summary: string }
      | { ok: false; reason: "unknown_contract"; name: string };

    export function describeContract(deps: DescribeDeps, args: DescribeArgs): DescribeResult {
      const parsed = deps.registry.get(args.name);
      if (!parsed) return { ok: false, reason: "unknown_contract", name: args.name };
      return { ok: true, json_schema: parsed.inputJsonSchema, summary: renderSummary(parsed) };
    }

    function renderSummary(parsed: ParsedContract): string {
      const lines: string[] = [];
      lines.push(`# ${parsed.name}`);
      lines.push("");
      if (parsed.description) { lines.push(parsed.description); lines.push(""); }

      lines.push("## Inputs");
      for (const [name, spec] of Object.entries(parsed.inputs)) {
        const s = spec as Record<string, unknown>;
        const type = (s.type as string | undefined) ?? (s.$ref ? `\`${s.$ref}\`` : "any");
        const required = parsed.required.includes(name) ? "required" : "optional";
        const desc = (s.description as string | undefined) ?? "";
        lines.push(`- **${name}** (${type}, ${required}): ${desc}`);
      }
      lines.push("");

      if (Object.keys(parsed.sources).length) {
        lines.push("## Sources");
        for (const [handle, decl] of Object.entries(parsed.sources)) {
          lines.push(`- **${handle}** → \`${decl.handle}\` (${decl.required ? "required" : "optional"})`);
        }
        lines.push("");
      }

      if (Object.keys(parsed.sinks).length) {
        lines.push("## Sinks");
        for (const [handle, decl] of Object.entries(parsed.sinks)) {
          lines.push(`- **${handle}** → \`${decl.handle}\` (${decl.required ? "required" : "optional"} MemorySink)`);
        }
        lines.push("");
      }

      lines.push("## Assembly");
      parsed.assembly.forEach((step, i) => {
        const argsRender = step.args ? `(${Object.keys(step.args).join(", ")})` : "()";
        lines.push(`${i + 1}. **${step.as}** ← \`${step.verb}${argsRender}\``);
      });
      lines.push("");

      if (parsed.write_back) {
        lines.push("## write_back");
        lines.push(`Writes a ${parsed.write_back.document_kind} document to \`${parsed.write_back.sink}\` with body from \`${parsed.write_back.body_from}\`.`);
        lines.push("");
      }

      if (parsed.output_shape) {
        lines.push("## Output Shape");
        const props = (parsed.output_shape as { properties?: Record<string, unknown> }).properties ?? {};
        const compact = Object.entries(props).map(([k, v]) => {
          const t = (v as { type?: string; $ref?: string }).type ?? (v as { $ref?: string }).$ref ?? "any";
          return `${k}: ${t}`;
        }).join(", ");
        lines.push(`\`{${compact}}\``);
        lines.push("");
      }

      return lines.join("\n");
    }
    ```

    Export from `src/contracts/index.ts` barrel: `export { describeContract, type DescribeDeps, type DescribeArgs, type DescribeResult } from "./describe.js";`.

    Extend `src/tool-registry.ts` with two new entries:

    ```typescript
    {
      name: "describe_contract",
      description: "Returns the input JSON Schema + an auto-generated markdown summary for a contract (Q-DESCRIBE).",
      inputSchema: z.object({
        name: z.string().min(1),
      }),
    },
    {
      name: "instantiate_contract",
      description: "Runs a contract: Zod-validates inputs, resolves source/sink overrides (strict per D-A4b; MemorySink-only sinks per D-A4c), executes assembly steps with {{template}} resolution + named-binding accumulation, runs write_back via DeliveryAdapter (MEM-05 chokepoint), validates output. Returns {ok, steps, write_back} bundle or a structured error envelope.",
      inputSchema: z.object({
        name: z.string().min(1),
        inputs: z.record(z.string(), z.unknown()).default({}),
        source_overrides: z.record(z.string(), z.string()).optional(),
        sink_overrides: z.record(z.string(), z.string()).optional(),
      }),
    },
    ```

    Wire handlers in `src/server.ts`. For each vault, build `instantiateDeps`:

    ```typescript
    const peerMcpRegistry = new PeerMcpRegistry();
    await peerMcpRegistry.start(globalContractsConfig?.mcp_clients ?? {});
    shutdownDisposables.push({ dispose: () => peerMcpRegistry.shutdown() });
    process.on("SIGTERM", () => { void peerMcpRegistry.shutdown(); });
    process.on("SIGINT", () => { void peerMcpRegistry.shutdown(); });

    // Per-vault instantiate deps:
    function buildInstantiateDeps(vault: Vault): InstantiateDeps {
      const cfg = vault.config.contracts;
      return {
        vault,
        registry: contractRegistries.get(vault.config.name)!.registry,
        memorySinks: memorySinkRegistry,
        delivery: deliveryAdapters.get(vault.config.name)!,
        contractAudit: vault.db.contractAudit,
        configDefaults: cfg?.defaults ?? {},
        stepTimeoutSeconds: cfg?.step_timeout_seconds ?? 30,
        peerMcpRegistry,
        hybridSearch: (args) => hybridSearch(vault, args),
        handleExpand: (args) => handleExpand(vault, args),
        handleCluster: (args) => handleCluster(vault, args),
        handleRecall: (args) => handleRecall(vault, args),
        handleCompileBrief: (args) => handleCompileBrief(briefDeps, args),
        handleGetBrief: (args) => handleGetBrief(briefDeps, args),
        handleQueryFrontmatter: (args) => queryFrontmatter(vault, args),
        handleListBacklinks: (args) => handleListBacklinks(vault, args),
        handleGetOutline: (args) => handleGetOutline(vault, args),
        handleSearchSections: (args) => handleSearchSections(vault, args),
        handleReadNote: (args) => handleReadNote(vault, args),
      };
    }
    ```

    Replace the Plan 06-02 stub `instantiateHandler` with the real one. The auto-register callback already uses `deps.instantiateHandler`; now bind:

    ```typescript
    const instantiateHandler = async (contractName: string, args: unknown) => {
      const vault = /* infer from auto-register context — pass vault into syncAutoRegistered callback */;
      return instantiateContract(buildInstantiateDeps(vault), { name: contractName, inputs: args as Record<string, unknown> });
    };
    ```

    The MCP tool handlers for `describe_contract` + `instantiate_contract` need to determine which vault's registry to use. Per CONTEXT.md operating-environment, vault scoping comes from either (a) an explicit `vault` arg (some tools have one) or (b) the per-vault config fallout. For Plan 06-03, the simplest design: contract names are vault-scoped (same name in two vaults = two distinct contracts). The tool handler accepts an optional `vault` arg; if present, dispatch to that vault's registry; if absent and only one vault is configured, use it; if absent and multiple vaults exist, return `{ok: false, reason: "ambiguous_vault", available_vaults: [...]}` — **a member of the unified 12-reason `InstantiateError` closed union** added in 06-01 Task 5 per WARNING-6 / ADR-006 §Decision 7. Single discriminated union for callers; no two-level envelope. Add a server-wiring test in Task 6-03-05 that confirms: (a) single-vault dispatch returns the orchestrator result unchanged; (b) multi-vault dispatch with no `vault` arg returns `{ok:false, reason:"ambiguous_vault", available_vaults: [<name>...]}`; (c) explicit `vault` arg overrides ambiguity.

    Regenerate `evals/v1-baseline/tools-list.snapshot.json` additively (35 → 37) following the Plan 06-02 regen pattern.

    Co-locate `describe.test.ts` with the 7 describe-only Behavior cases. Add server-wiring + snapshot tests to existing test files or create a new `src/contracts/server-integration.test.ts`.

    Adapter-seam: `src/contracts/describe.ts` is pure (zero deps). `src/server.ts` wires everything (allowed to import freely per existing exemptions). `src/tool-registry.ts` adds two entries.
  </action>
  <verify>
    <automated>npx vitest run src/contracts/ && npm test && bash scripts/lint-adapters.sh && diff <(jq -S '.' evals/v1-baseline/tools-list.snapshot.json) <(jq -S '.' evals/v1-baseline/tools-list.snapshot.json) >/dev/null</automated>
  </verify>
  <done>describeContract pure function green; describe_contract + instantiate_contract MCP tools registered; server wires PeerMcpRegistry + SIGTERM/SIGINT cleanup (Pitfall F4); per-vault InstantiateDeps built; auto-register stub replaced with real instantiateContract; snapshot regenerated additively (35 → 37); 1346+ existing tests + Plans 06-01/02 + Tasks 6-03-01/02/03/04 tests stay green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| MCP client → instantiate_contract | Inputs validated by Zod against contract's `inputZodSchema` (additionalProperties:false); overrides validated against declared handle names + MemorySinkRegistry. |
| Template resolver → step args | Operates only on contract YAML (read at boot); user inputs are pure values, never re-evaluated as templates (C-7 invariant; test in templates.test.ts verifies). |
| verbDispatcher → peer MCP | `mcp://` calls wrapped in Q-TIMEOUT; failures return structured error envelopes (`verb_not_available`, `mcp_client_unavailable`, `assembly_step_failed`). |
| write_back → DeliveryAdapter | MEM-05 chokepoint; sink validated via MemorySinkRegistry.resolveMemorySink (D-A4c); peer-MCP outputs CANNOT become real DocIds (C-3). |
| PeerMcpRegistry → child processes | Symbol.dispose kills child via transport.close() (Pitfall F4); SIGTERM/SIGINT handlers in server.ts call peerMcpRegistry.shutdown(). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-06-03-01 | Tampering | Contract input `{{nested}}` template injection (user supplies an input containing `{{inputs.secret}}` hoping it gets resolved against `bindings`) | mitigate | `resolveTemplate` operates on contract YAML at boot, NOT on user inputs at call time. C-7 invariant. templates.test.ts Test 1 + critical invariant test verifies that `inputs.x = "{{inputs.y}}"` returns the raw string `"{{inputs.y}}"` (not a re-substitution). Documented in ADR-006 §Decision 5. |
| T-06-03-02 | Tampering | sink_overrides bypass to overwrite a user note | mitigate | D-A4c MemorySinkRegistry.resolveMemorySink validates every sink_override; non-sink targets reject with structured error. instantiate.test.ts Test 7 enforces. Invariant C-2 documented in ADR-006. |
| T-06-03-03 | Elevation of Privilege | Peer-MCP verb writes data that gets used as if a real DocId | mitigate | Pitfall F6 / Invariant C-3: peer-MCP outputs are advisory step bindings only; only `DeliveryAdapter.write()`'s return value populates `bundle.write_back.doc_id`. The write_back.body_from template resolves a string from a peer-MCP output, but the resulting DocId is sourced from the local DeliveryAdapter response — peer-MCP cannot fabricate a DocId. Documented in ADR-006 §Decision 10 + Invariant C-3. |
| T-06-03-04 | Denial of Service | Peer-MCP verb hangs indefinitely | mitigate | Q-TIMEOUT: callMcpVerb wraps in `Promise.race([call, timeout(step_timeout_seconds * 1000)])`. Default 30s. mcp-extension.test.ts Test 10 enforces. |
| T-06-03-05 | Denial of Service | Baseline verb's runaway query | accept | Baseline verbs use their own timeout discipline (SQLite query timeout, Ollama HTTP timeout). Q-TIMEOUT decision: wrapping baseline verbs adds latency overhead for no benefit. Documented in ADR-006 §Decision 11. |
| T-06-03-06 | Tampering | Two concurrent instantiate_contract calls with same target collide | mitigate | Phase 5 D-12 auto-supersede chain inside DeliveryAdapter.write handles ordering atomically. No mutex in Plan 06-03. instantiate.test.ts Test 18 enforces. Documented in ADR-006 §Decision 11 + Phase 5 PHASE-5-SIGN-OFF.md. |
| T-06-03-07 | Information Disclosure | Audit log captures peer-MCP verb output (e.g., private PR text from `mcp://github/list_issues`) | mitigate | recordContractStep signature excludes any output/payload field; Plan 06-01 C-5 invariant; instantiate.ts only passes `{contract, verb, step_alias, vault}` to the writer. Per-step audit row written regardless of success/failure; output is NEVER captured. Documented in ADR-006 §Decision 4 + Invariant C-5. |
| T-06-03-08 | Elevation of Privilege | Malicious peer MCP server spawned via `[contracts.mcp_clients.X.command]` | accept | `command` is a user-config string; same trust level as `~/.vault-memory/config.toml`. `StdioClientTransport` uses `spawn(command, args)` with NO shell — args pass verbatim, no shell escape needed. Documented in ADR-006 §Threat Model + Pitfall F4 mitigation (SIGTERM/SIGINT child kill). |
| T-06-03-SC | Tampering | npm install of new dependencies | N/A | Zero net-new runtime deps in Plan 06-03 (yaml, zod, MCP SDK all pre-installed). No supply-chain checkpoint. |
</threat_model>

<verification>
**Acceptance:**
- `npm test` — 1346+ existing tests + Plan 06-01 + Plan 06-02 + Plan 06-03 tests all green.
- `npx tsc --noEmit` — clean.
- `bash scripts/lint-adapters.sh` — zero hits inside `src/contracts/` (no `fs`/`path.join`/`gray-matter`/`chokidar` outside `src/server.ts`).
- `npm run eval:baseline` — v1-baseline byte-identical for the 23 v1 tools.
- `evals/v1-baseline/tools-list.snapshot.json` — 37 entries; diff against post-06-02 (35) shows exactly +2 (`describe_contract`, `instantiate_contract`).

**Eval queries:** none new in this slice; eval YAMLs ship in Plan 06-04.

**Manual verification:**
1. Start `vault-memory serve` with `_contracts/meeting-prep.yaml` (RESEARCH Example 1 — using `literal` verbs where Plan 06-04 will eventually substitute real verbs).
2. Issue MCP `describe_contract({name: 'meeting-prep'})` from MCP Inspector. Verify response contains both `json_schema` and `summary` (markdown).
3. Issue `instantiate_contract({name: 'meeting-prep', inputs: {meeting_doc_id: 'obsidian-fs://my-vault/meetings/x.md', context_hops: 1}})`. Verify response is `{ok: true, steps: {...}, write_back: {doc_id, sink}}`.
4. Issue `instantiate_contract({name: 'meeting-prep', inputs: {meeting_doc_id: 'no-scheme'}})`. Verify response is `{ok: false, reason: 'invalid_inputs', issues: {...}}` (pattern rejection).
5. Issue `instantiate_contract({name: 'meeting-prep', inputs: {...}, sink_overrides: {default_sink: 'obsidian-fs://my-vault/notes/'}})` (NOT a registered MemorySink). Verify rejection with `sink_override_not_a_memory_sink`.
6. Inspect `audit_log` for `kind: 'contract_step'` rows from the successful call.
</verification>

<success_criteria>
1. `resolveTemplate` (~50 LOC) ships in `src/contracts/templates.ts` with all 13 cases passing; template injection invariant (C-7) verified.
2. `PeerMcpRegistry` ships in `src/contracts/mcp-clients.ts` with `Symbol.dispose` lifecycle; SIGTERM/SIGINT shutdown handlers registered in `src/server.ts` (Pitfall F4).
3. `verbDispatcher` + `callMcpVerb` ship in `src/contracts/verbs/`; closed baseline enum (11 verbs) + `literal` + `mcp://` extension dispatched correctly; Q-TIMEOUT applied to peer-MCP only.
4. `instantiateContract` ships in `src/contracts/instantiate.ts`; all 7 orchestration steps from RESEARCH §Architecture diagram implemented; all 11 orchestrator-level InstantiateError reasons reachable in tests; the 12th reason `ambiguous_vault` reachable from server-level dispatch test in Task 6-03-05 (WARNING-6 unified enum); MEM-05 invariant un-bypassable; bundle shape matches Q-OUTPUT; per-step contract_audit payload-free.
5. `describeContract` ships in `src/contracts/describe.ts`; pure function over ParsedContract; Q-DESCRIBE markdown template rendered correctly.
6. `describe_contract` + `instantiate_contract` MCP Tools registered; auto-register stub from Plan 06-02 replaced with real handler.
7. `evals/v1-baseline/tools-list.snapshot.json` regenerated additively (35 → 37); default-OFF `auto_register_tools` keeps snapshot stable.
8. `npm test` + `npx tsc --noEmit` + `bash scripts/lint-adapters.sh` + `npm run eval:baseline` all green.
9. CON-05 (describe_contract) + CON-06 (instantiate_contract) + CON-03 (handle-based sources/sinks + `{{default_source}}` variable handles work; tested by exercising override default chain in Test 6) + CON-11 ADR §Decisions 3, 5, 6, 7, 10, 11, 12 all materialized.

**After this slice, agents can:** call `describe_contract` to discover what a contract does + call `instantiate_contract` to RUN it end-to-end against a real vault. The three reference contracts + eval scenarios + CON-09/CON-10 proofs + phase gate ship in Plan 06-04.
</success_criteria>

<commit>
Atomic commit messages (one per task, or one batch commit at slice end):

```
feat(06-03): resolveTemplate — mustache {{alias.field}} resolver (D-A2c, ~50 LOC)

- src/contracts/templates.ts — whole-string {{x}} returns raw typed value;
  embedded {{x}} string-concat substitutes; recursion into objects + arrays;
  field-path + array-shorthand traversal; undefined → unresolved_template error.
- Template injection invariant (C-7): operates only on contract YAML, never
  on user-supplied inputs at call time. Verified by templates.test.ts.

Refs: D-A2c, ADR-006 §Decision 5, Invariant C-7
```

```
feat(06-03): PeerMcpRegistry — peer-MCP client lifecycle (D-A2a, Pattern 3, Pitfall F4)

- src/contracts/mcp-clients.ts — SDK 1.29 Client + StdioClientTransport per
  [contracts.mcp_clients.<name>] entry; WARN-on-fail + available flag;
  Symbol.dispose kills child process; clientFactory injection for testability.
- src/server.ts — SIGTERM/SIGINT handlers call peerMcpRegistry.shutdown().

Refs: D-A2a, Pitfall F4, Pattern 3
```

```
feat(06-03): verbDispatcher + literal + mcp:// extension with Q-TIMEOUT (D-A2a)

- src/contracts/verbs/index.ts — closed 11-baseline-verb dispatcher routing
  to existing Phase 1-5 handlers; per-verb signature documented in JSDoc per
  RESEARCH §A9.
- src/contracts/verbs/mcp-extension.ts — mcp://<server>/<tool> routing via
  PeerMcpRegistry.get + callTool; Promise.race timeout (Q-TIMEOUT: peer-MCP
  only; baseline verbs NOT wrapped).
- Structured errors: verb_not_available, mcp_client_unavailable,
  assembly_step_failed(cause:timeout).

Refs: D-A2a, Q-TIMEOUT, Invariant C-1 (no write verbs)
```

```
feat(06-03): instantiateContract orchestrator — CON-06 end-to-end (D-A4a/b/c, Q-OUTPUT)

- src/contracts/instantiate.ts — 7-step orchestration per RESEARCH §Architecture:
  Zod-validate inputs (additionalProperties:false; Pitfall F2) → resolve override
  handles (default chain: explicit → config → contract literal → error if required)
  → validate sinks via MemorySinkRegistry.resolveMemorySink (D-A4c; MEM-05
  invariant un-bypassable per C-2) → build template bindings → per-step:
  resolve {{templates}} + dispatch verb + write contract_step audit row +
  bind output → run write_back via DeliveryAdapter (MEM-05 chokepoint) →
  validate bundle against output_shape (Q-OUTPUT: {steps, write_back}).
- All 11 orchestrator-level InstantiateError reasons reachable in tests; the
  12th (`ambiguous_vault` per WARNING-6) is tested at server-level in 06-03 Task 5.
- Concurrent calls (Claude's Discretion) route through Phase 5 D-12 auto-
  supersede chain inside DeliveryAdapter.write.

Refs: CON-06, D-A4a, D-A4b, D-A4c, Q-OUTPUT, Invariants C-1/C-2/C-3/C-5
```

```
feat(06-03): describeContract + MCP tool registration + server wiring (CON-05, +2 tools)

- src/contracts/describe.ts — pure function over ParsedContract; Q-DESCRIBE
  markdown template (Inputs / Sources / Sinks / Assembly numbered list /
  write_back / Output Shape).
- src/tool-registry.ts — describe_contract + instantiate_contract entries.
- src/server.ts — per-vault buildInstantiateDeps; Plan 06-02 stub
  instantiateHandler replaced with real instantiateContract closure.
- evals/v1-baseline/tools-list.snapshot.json regenerated additively:
  35 → 37 entries; default-OFF auto_register_tools keeps snapshot stable.

Refs: CON-05, Q-DESCRIBE
```
</commit>

<output>
Create `.planning/phases/06-task-contract-dsl/06-03-SUMMARY.md` when done.
</output>
