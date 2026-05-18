# ADR-006 — Task Contract DSL

**Status:** Accepted
**Phase:** 6 — Task Contract DSL
**Supersedes:** none
**Superseded by:** none
**Related:** ADR-001 (document identity), ADR-002 (adapter seams), ADR-003 (document shape), ADR-004 (memory-sink handles), ADR-005 (brief compile strategy).

---

## Context

vault-memory v1 exposes 23 retrieval/write MCP tools. The Phase 6 brief from `.planning/PROJECT.md` advances vault-memory from "retrieval substrate" into a *full agentic knowledge layer*. The thesis is explicit:

> user-defined task contracts that any MCP-aware agent can discover and instantiate.

Phase 5 (compiled-brief layer, ADR-005) shipped `compile_brief` with a **caller-supplied** source set — the agent must already know which `source_doc_ids` belong in the brief. Phase 5 D-01 deliberately deferred *auto-discovery* of sources to Phase 6, where it can be declared *once* per task and instantiated by *any* agent that speaks MCP.

This ADR locks the surface area, the safety invariants, and the runtime semantics for that declarative task layer. It must land BEFORE any `src/contracts/loader.ts` or `src/contracts/instantiate.ts` implementation commit (mirrors Phase 0/2/4/5 discipline).

Three external constraints frame every decision below:

1. **Tool budget.** v1 ships 23 tools; Phases 2-5 add 11; Phase 6 adds 3 (`describe_contract`, `instantiate_contract`, `register_contracts_as_tools`) → **37 total**. The REL-08 reconciliation (collapse near-duplicate retrieval tools) is deferred to Phase 8 per Pitfall F7 — Phase 6 does NOT touch the v1 surface.
2. **Namespace collision warning.** `_contracts/memory/*.yaml` belongs to the Phase 2 MemoryContract loader (`src/memory/contract/`). The Phase 6 task-contract loader scans ONLY top-level `_contracts/*.yaml` files. Boot scan and ChangeFeed dispatch share a single matcher: `^_contracts/[^/]+\.yaml$` (Pitfall F3).
3. **Backwards-compat invariant.** v1 tool shapes do NOT change. v1 baseline snapshot (`evals/v1-baseline/tools-list.snapshot.json`, 34 entries) stays stable unless an explicit additive regen lands in Plan 06-04.

---

## Decision: Dual MCP surface — generic + auto-register

(Resolves D-A1, D-A1b, D-A1c.)

vault-memory exposes contracts via TWO MCP surfaces; either is sufficient for an MCP-aware agent to discover and instantiate a task:

1. **Generic surface — always on.** `instantiate_contract({name, inputs, overrides?, vault?})` and `describe_contract({name, vault?})` are always available. They work for `ChatGPT Custom Connectors`, `Claude.ai Deep Research`, and any generic MCP client. This surface is the **stable** discovery point — no contract-name churn ever forces a tool-list-change notification.
2. **Per-contract auto-registration — opt-in, per-vault.** Each loaded contract MAY be registered as a top-level MCP Tool (e.g., `vm_meeting_prep`) when the per-vault config flag `[contracts] auto_register_tools = true`. The default is `false` so that:
   - Fresh installs see no behavior change.
   - The `tools-list.snapshot.json` v1 baseline stays byte-stable across deployments.
   - Users opt in explicitly when they want the IDE-style discoverability.

**`tool_prefix`** is a per-vault config string (default `vm_`, A7-validated Zod `.min(1)`, regex `^[a-z_][a-z0-9_]*$`). Two structural reasons for the default:
- It SHALL be non-empty (`.min(1)`) so a contract named `read-note` cannot slug to the v1 tool name `read_note` and shadow it. Mitigation T-06-01-02.
- Default `vm_` (NOT researcher recommendation `contract_`) is a deliberate D-A1c departure — three letters, distinct from any v1 tool, easy to grep, and pronounceable.

**`register_contracts_as_tools({vault?})`** is the escape valve — callable regardless of config flag, so an agent can force registration on-demand without the user editing config.toml. This MUST be supported because some MCP clients (Claude.ai) treat tool changes as a session boundary and a power-user workflow may want to flip mode mid-session.

**Tool-list-change notifications.** When a contract is added/removed/renamed and `auto_register_tools = true`, the server calls `McpServer.sendToolListChanged()` (high-level SDK 1.29 API per RESEARCH §3, NOT the low-level `server.notification(...)` the original CONTEXT.md mentioned). When `auto_register_tools = false`, no notification fires — only the generic surface is affected, and that surface is stable (contract names live INSIDE `instantiate_contract.name`, not as separate tool names).

---

## Decision: Closed assembly verb enum + literal escape + mcp:// extension

(Resolves D-A2a.)

Every `assembly[].verb` value MUST belong to one of THREE syntactic categories:

1. **Baseline enum** (11 verbs, exhaustive):
   `search_hybrid`, `expand`, `cluster`, `recall`, `compile_brief`, `get_brief`, `query_frontmatter`, `list_backlinks`, `get_outline`, `search_sections`, `read_note`.
2. **`literal`** — escape hatch for embedding fixed values into the assembly graph (e.g., a hard-coded query string, a constant section heading, a fixture-pinned `chunk_id`).
3. **`mcp://<server>/<tool>`** — invocation of a peer MCP server registered under `[contracts.mcp_clients.<server>]`. Regex `^mcp:\/\/[a-z][a-z0-9_-]*\/[a-z][a-z0-9_-]*$`.

**No `tool: <any-registered-tool-name>` open form.** That open form was rejected because it would let a contract author smuggle a write tool (`write_note`, `record_observation`, `supersede`) into an `assembly:` block, bypassing the memory-namespace invariant by construction. Three structural mechanisms enforce the invariant:

1. **No write verbs in the assembly enum.** The 11 baseline verbs are all read-only. Writes happen ONLY via `write_back:` (separate block).
2. **`write_back:` is structurally separate from `assembly:`.** The YAML grammar puts them at sibling keys, so a contract author cannot mistake one for the other; a step CANNOT be a write op.
3. **`sink_overrides`** in caller args resolves to a registered MemorySink only (D-A4c, Invariant C-2). The runtime check `MemorySinkRegistry.resolveMemorySink(handle)` is the chokepoint.

**Peer-MCP trust model.** A peer MCP server that exposes write tools is responsible for its OWN backing-store invariants — vault-memory only guarantees its own MemorySink invariants. Peer-MCP outputs land as advisory step bindings (named `as:` outputs in the orchestration map), NEVER as real DocIds (Invariant C-3, Pitfall F6 chokepoint).

---

## Decision: Custom-verb housekeeping — `list_contract_verbs` Resource + `contract_audit` signal

(Resolves D-A2b + Q-AUD.)

A new MCP Resource at `vault-memory://contract-verbs/{vault}` returns:

```json
{ "baseline": ["search_hybrid", ...], "custom": [{"verb": "mcp://gh/list_issues", "invocation_count": 14, "last_seen": 1700000000}, ...] }
```

The `custom` array aggregates from the `contract_audit` table — verbs that contracts actually exercised, with usage frequency and recency. This becomes the v2.x **promotion signal**: a peer-MCP verb that consistently shows high `invocation_count` is a candidate for being absorbed into the baseline enum.

**Q-AUD resolution: NEW `contract_audit` table.** NOT an extension of `write_audit`, because `write_audit.note_id INTEGER NOT NULL` foreign-key constraint blocks orchestration rows (same wall Phase 5 daemon hit per RESEARCH §Don't Hand-Roll). Migration 014 creates:

```sql
CREATE TABLE contract_audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL,           -- 'contract_step' | 'contract_load_error'
  contract      TEXT,
  verb          TEXT,
  step_alias    TEXT,
  vault         TEXT,
  ts            INTEGER NOT NULL,        -- epoch ms
  error_message TEXT
);
CREATE INDEX idx_contract_audit_kind_ts ON contract_audit(kind, ts);
CREATE INDEX idx_contract_audit_verb    ON contract_audit(verb);
```

**Security pattern (mitigates T-06-01-03).** Audit rows store ONLY `{kind, contract, verb, step_alias, vault, ts, error_message?}` — NEVER step output payloads. Peer-MCP outputs may contain sensitive data (private PR text, secret tokens, customer records); we explicitly never capture them in SQLite. The `recordContractStep` TypeScript signature does not even declare an `output` field — strict-mode tsc rejects any attempt to add one (Invariant C-5, Test 12).

---

## Decision: Step composition — named bindings + `{{alias.field}}` mustache

(Resolves D-A2c.)

Every `assembly[]` step has a required `as:` alias (Zod-enforced) — a snake_case identifier unique across the assembly array. Step outputs land at `state[<as>]`, and downstream steps reference them through mustache templates: `{{search_results.docs[0]}}`, `{{related.id}}`, `{{inputs.meeting_doc_id}}`.

`{{inputs.<name>}}` references contract inputs uniformly with step outputs — the resolver treats `inputs` as a synthetic alias bound after Zod input validation.

The resolver runs AFTER Zod input validation and BEFORE verb dispatch. Resolution failure (undefined alias, undefined field, malformed expression) returns `{ok: false, reason: "unresolved_template", expression}` immediately — no partial execution.

**Security invariant (mitigates template injection — T-06-01-Tampering).** Templates operate on **contract YAML** (read at boot or by the loader's ChangeFeed dispatch), NEVER on user-supplied inputs at call time. Inputs are pure values — never re-evaluated as templates. This is Invariant C-7; the resolver is a parser, not an evaluator, and it never recurses into resolved values to check for further `{{...}}` patterns.

---

## Decision: JSON Schema subset embedded in YAML + `#/types/` catalog `$ref`

(Resolves D-A3a, D-A3b.)

The contract YAML's `inputs:` block declares input fields as JSON Schema fragments. Supported keywords:

- `type, description, pattern, enum, format, default, required, additionalProperties`.

The `inputs:` form is FLAT — each key is a field name, each value is a JSON Schema fragment:

```yaml
inputs:
  meeting_doc_id:
    $ref: "#/types/DocId"
    description: "ID of the meeting note to compile a brief for"
  attendees:
    type: array
    items: { type: string }
```

**Internal wrap (Pitfall F2 fix).** `buildInputSchema(yamlInputs, required)` wraps the flat form into `{type: "object", properties: yamlInputs, required, additionalProperties: false}` BEFORE passing to `z.fromJSONSchema`. The explicit `additionalProperties: false` is non-optional — without it, typo'd input keys are silently dropped at runtime (verified in REPL).

**Type catalog.** A small, additive-only catalog at `src/contracts/types-catalog.ts`:

| Name | Shape |
|---|---|
| `DocId` | `string, pattern: ^[a-z][a-z0-9-]*://` |
| `Handle` | `string, pattern: ^[a-z][a-z0-9-]*://` (currently identical to DocId; future-proof) |
| `ChunkId` | `string, pattern: ^[a-z][a-z0-9-]*://.+#chunk-[0-9a-f]{7}$` (matches Phase 5 ADR-003 H-5) |
| `MemorySink` | `string` + `"x-validator": "memory-sink"` (extension keyword) |

Contract authors reference them via `$ref: "#/types/<name>"`. Additive evolution only — Phase 10 may extend `DocId.pattern` to also match `notion://...` (additive); we MUST NEVER narrow.

**Pitfall F1.** The Zod 4 `z.fromJSONSchema` API is required — SDK 1.29's `registerTool({inputSchema})` REJECTS raw JSON Schema literals (verified). `buildInputSchema` is the chokepoint that prevents this trap from leaking into the verb dispatcher.

**Assumption A3 verified.** The `"x-validator": "memory-sink"` extension keyword passes through `z.fromJSONSchema` unchanged — Zod 4 ignores unknown JSON Schema keywords rather than throwing. The runtime memory-sink validation happens at instantiation time via `MemorySinkRegistry.resolveMemorySink(handle)` — it inspects `jsonSchema.properties.*["x-validator"]` (NOT the Zod schema) and runs the registry lookup.

---

## Decision: Override semantics — handle-name + strict validation + MemorySink-only sinks

(Resolves D-A4a, D-A4b, D-A4c.)

**Override target = contract-declared handle name** (NOT URI scheme). When a contract declares:

```yaml
sources:
  meeting:
    handle: "obsidian-fs://my-vault"
    required: true
sinks:
  brief_sink:
    handle: "obsidian-fs://my-vault/_memory/_briefs/"
```

callers override by handle name:

```jsonc
instantiate_contract({
  name: "meeting-prep",
  inputs: { ... },
  overrides: {
    sources: { meeting: "obsidian-fs://other-vault" },
    sinks:   { brief_sink: "obsidian-fs://other-vault/_memory/_briefs/" }
  }
})
```

**Default chain** (in resolution order):

1. Explicit caller override (`overrides.sources.meeting` / `overrides.sinks.brief_sink`)
2. Per-vault config defaults (`[contracts.defaults.meeting]` in config.toml)
3. Contract YAML literal (`sources.meeting.handle`)
4. Error if `required: true`

**Closed error envelope** — a discriminated union sealed for v2.0.0 with EXACTLY 12 reasons (11 orchestrator-level + 1 server-dispatch-level):

| Reason | Carrying field(s) | Layer |
|---|---|---|
| `unknown_contract` | `name` | server |
| `invalid_inputs` | `issues` (Zod issue tree) | orchestrator |
| `unknown_override_handle` | `handle`, `valid_handles[]` | orchestrator |
| `missing_required_source` | `handle`, `hint` | orchestrator |
| `sink_override_not_a_memory_sink` | `target`, `hint` | orchestrator (D-A4c) |
| `unresolved_template` | `expression` | orchestrator |
| `verb_not_available` | `verb` | orchestrator |
| `mcp_client_unavailable` | `verb`, `client_name` | orchestrator |
| `assembly_step_failed` | `step_alias`, `cause` | orchestrator |
| `write_back_failed` | `cause` | orchestrator |
| `validation_failed_on_output_shape` | `issues` | orchestrator |
| `ambiguous_vault` | `available_vaults[]` | server dispatch |

The `ambiguous_vault` reason fires from the server-level `instantiate_contract`/`describe_contract` tool handlers when the caller omits `vault` and multiple vaults are configured. Including it in the same closed union (rather than a wrapper envelope) keeps callers parsing a single discriminated union — WARNING-6 resolution.

**D-A4c sink invariant.** Every value a contract resolves at a `sink_overrides[*]` slot MUST be a registered MemorySink. `MemorySinkRegistry.resolveMemorySink(handle)` is the chokepoint — if the lookup returns undefined, the orchestrator returns `{ok: false, reason: "sink_override_not_a_memory_sink", target: handle, hint: "expected one of: " + registry.list().join(", ")}`. This is un-bypassable by construction (Invariant C-2): there is no other path from a YAML/override string to a DeliveryAdapter call.

---

## Decision: Hot reload via ChangeFeed

(Resolves D-LOAD.)

The contract loader mirrors the Phase 5 daemon's "in-process at server boot" pattern (Phase-5-D-07). Boot path:

1. `serve()` constructs a `ContractRegistry` per vault.
2. ChangeFeed adapter (Phase 1 `src/adapters/change-feed/obsidian-fs/`) emits the initial scan as create events.
3. Loader filters to `^_contracts/[^/]+\.yaml$` (Pitfall F3 non-recursion — `_contracts/memory/*.yaml` belongs to the Phase 2 MemoryContract loader).
4. For each match: parse YAML via `parseDocument` (yaml@2.9), validate via `ContractFileSchema`, build the Zod input schema via `buildInputSchema`, attempt `ContractRegistry.set(name, parsed)`. Collision → `{ok: false, reason: "duplicate_name"}` → write `contract_audit kind: 'contract_load_error'` row. Parse/validate failure → keep prior registry version unchanged (graceful degradation per Phase-5 D-07) → write `contract_audit kind: 'contract_load_error'`.

**Steady-state events.**

- `create` / `update` → re-parse, re-validate, mutate registry, emit `tools/list_changed` if `auto_register_tools = true`.
- `delete` → remove from registry, emit `tools/list_changed` if applicable.
- `rename` → unlink + add (per Phase 1 obsidian-fs ChangeFeed semantics).
- Parse failure → keep prior registry version; write `contract_audit` error row.

**Multi-process compatibility.** No lock is required — the contract directory is read-only from each process's perspective, and each process independently converges to the same registry state. There is no shared mutable state to coordinate.

---

## Decision: yaml@2.9 rationale (CON-12 satisfied by Phase 0 install)

`yaml@^2.9.0` is already installed via Phase 0 ADP-08 — `package.json` lists it as a direct dependency. CON-12's `^2.6` floor is satisfied. **No `npm install` is performed in Phase 6.**

Rationale for the choice itself:

- `yaml@2.x` is the only mainstream Node YAML library that round-trips comments byte-equivalent through `parseDocument` + `toJS()` + `toString()` (empirically verified per RESEARCH Assumption A1).
- Phase 6 currently only READS contracts — round-trip preservation does not matter yet. However, Phase 7 will WRITE contracts (Canvas authoring UI), and yaml@2.9 is the library that path will need. Choosing yaml@2.9 in Phase 6 avoids a library swap at Phase 7.
- `gray-matter` (already used by `src/reader/` for note frontmatter) is NOT suitable — it is opinionated about YAML-front-matter-in-markdown, and it does not preserve comments.

---

## Decision: Output validation timing (Q-OUTPUT)

`output_shape` validates the **bundle** returned to the caller, where the bundle is:

```typescript
{
  steps: { [alias]: <step output> },
  write_back: { doc_id: <real DocId from DeliveryAdapter.write> | null }
}
```

Intermediate step outputs are **advisory** — they have no formal schema (Pitfall F6). Only `write_back.doc_id` is **ground-truth** — it is sourced from `DeliveryAdapter.write()`'s return value, NOT from a step output template, NOT from any contract YAML field. This is the **MEM-05 chokepoint guarantee**: every agent-authored DocId originates inside the DeliveryAdapter, never in user-controlled text.

If `output_shape` is provided and validation fails, the orchestrator returns `{ok: false, reason: "validation_failed_on_output_shape", issues}` — but the write_back DocId is already permanent (already written to FS / future Notion). Validation failure does NOT roll back the write; it surfaces the schema mismatch so the contract author can fix the contract.

---

## Decision: Step-level timeouts (Q-TIMEOUT)

Wrap ONLY peer-MCP verbs in `Promise.race([fn(), timeoutAfter(step_timeout_seconds)])`. Baseline verbs (the 11-verb enum) are local SQLite/Ollama with their own timeout discipline; wrapping them adds latency overhead + flaky-test surface for no benefit.

Default `step_timeout_seconds = 30` per `[contracts]` config block. Configurable per-vault.

On timeout the orchestrator returns `{ok: false, reason: "assembly_step_failed", step_alias, cause: "timeout after Xs"}`.

---

## Decision: describe_contract output shape (Q-DESCRIBE)

`describe_contract({name, vault?})` returns `{json_schema, summary}` where:

- `json_schema` = the pass-through `inputJsonSchema` cached on the ParsedContract (the post-`additionalProperties:false` wrap form — Pitfall F2).
- `summary` = auto-generated markdown per the RESEARCH §Q-DESCRIBE template:

```
# {name}

{description}

## Inputs

- `meeting_doc_id` (DocId, required): ID of the meeting note to compile a brief for
- `attendees` (string[]): ...

## Sources

- `meeting`: `obsidian-fs://my-vault` (required)

## Sinks

- `brief_sink`: `obsidian-fs://my-vault/_memory/_briefs/` (required)

## Assembly

1. `search_for_followups` (search_hybrid): ...
2. `expand_threads` (expand): ...
3. `final_brief` (compile_brief): ...

## Write back

- Sink: `{{brief_sink}}`
- Document kind: `brief`
- Properties: status=fresh, kind=meeting-prep

## Output shape

```json
{ ... }
```
```

This is a pure function over `ParsedContract`. NO LLM involved. NO peer-MCP calls.

---

## Decision: CI eval LLM strategy (Q-CI-LLM)

**WARNING-4 resolution: option (b) mock-in-CI.**

The CON-08 (per-contract eval scenarios) and CON-10 (stub-parity proof) tests run the orchestrator end-to-end against the three reference contracts (`meeting-prep`, `project-status`, `code-review-brief`), each of which terminates in `compile_brief`. Resolving the Phase 5 LLM ladder (MCP Sampling | Ollama | prepared_text) in CI would couple our test pipeline to Ollama model availability + version drift, which Phase 5's own tests already cover.

Therefore Phase 6 CI evals (Plan 06-04 Task 2 — `src/contracts/eval-runner.test.ts`) inject a deterministic `mockCompileBrief` that returns:

```typescript
{ ok: true,
  doc_id: "<deterministic slug under _memory/_briefs/>",
  body: "<stub citing source_doc_ids>" }
```

This isolates the test to what Phase 6 actually owns: orchestration, override resolution, template binding, write_back chokepoint, output_shape validation. CON-09 (non-Claude smoketest) still proves the FULL end-to-end stack without an LLM by using `_contracts/smoketest-trivial.yaml` (literal-only assembly; no `compile_brief` step).

**The LLM ladder itself remains Phase 5's contract** — Phase 6 inherits it for production use, but does NOT re-test it. The mock is test-only (Invariant C-8) and never reachable from `src/server.ts` wiring.

This is a deliberate evaluation-scope decision, not a coverage gap.

---

## Invariants

These eight invariants are tested either by code (Plan 06-01..06-04 unit suites) or by code review at slice sign-off.

| ID | Statement | Enforced by |
|---|---|---|
| C-1 | Closed assembly verb set; no write verbs in the enum. | Zod `ContractFileSchema` (Plan 06-01); `verbs/index.ts` dispatcher (Plan 06-03). |
| C-2 | `sink_overrides` value MUST resolve to a registered MemorySink — un-bypassable by construction. | `MemorySinkRegistry.resolveMemorySink` chokepoint in `instantiate.ts` (Plan 06-03). |
| C-3 | Peer-MCP outputs are advisory bindings, not real DocIds. Only `DeliveryAdapter.write()` produces a real DocId. | `WriteBackSpec` shape + write_back step in `instantiate.ts` (Plan 06-03). |
| C-4 | `tool_prefix` Zod `.min(1)` + first-wins collision policy on contract-name registration. | `ContractsConfigSchema` + `ContractRegistry.set` (Plan 06-01). |
| C-5 | `contract_audit` stores `{kind, contract, verb, step_alias, vault, ts, error_message?}` ONLY — never step output payloads. | TypeScript signature on `recordContractStep` (Plan 06-01) — strict mode rejects an `output` argument. |
| C-6 | Boot scan and ChangeFeed dispatch filter to `^_contracts/[^/]+\.yaml$` — non-recursive. | `CONTRACT_PATH_REGEX` constant + loader filter (Plan 06-01 const, Plan 06-02 loader). |
| C-7 | Templates operate on contract YAML; never on user-supplied inputs at call time. | Template resolver is a parser, not an evaluator; resolved values are not re-scanned for `{{...}}` (Plan 06-03). |
| C-8 | Q-CI-LLM: CI eval pipeline injects a deterministic `mockCompileBrief`; production paths use the Phase 5 LLM ladder unchanged. | `eval-runner.test.ts` is the only injection site; `src/server.ts` never imports it (Plan 06-04). |

---

## Threat Model

STRIDE coverage of the eight enumerated threat patterns from RESEARCH §Security. Each row references the invariant that closes it.

| ID | STRIDE | Component | Mitigation |
|---|---|---|---|
| T-1 | Denial of Service | YAML billion-laughs / aliases-bomb DoS at contract load | `yaml@^2.9` ships with default anchor-expansion limits; loader caps individual file size (read budget enforced in Plan 06-02). |
| T-2 | Tampering | Template injection via user-supplied input that contains `{{...}}` | C-7. Resolver parses contract YAML only; inputs are pure values. |
| T-3 | Tampering | Peer-MCP command injection via `[contracts.mcp_clients.<name>.command]` shell metacharacters | Spawn uses `child_process.spawn(command, args)` with no shell (Plan 06-03). Trust scope is the same as the rest of `~/.vault-memory/config.toml` (user-owned). |
| T-4 | Elevation of Privilege | Arbitrary code execution via malicious contract YAML | Contract YAML is data only — no `eval`, no dynamic import, no FS operations from `src/contracts/*.ts`. Verbs are dispatched via a closed enum (C-1). |
| T-5 | Tampering | Memory-sink bypass — agent-authored doc lands outside a MemorySink | C-2 + MEM-05 chokepoint at `DeliveryAdapter.write`. |
| T-6 | Information Disclosure | Audit log leakage — peer-MCP output captured in `contract_audit` | C-5. `recordContractStep` signature excludes any `output`/`payload` field. |
| T-7 | Tampering | `$ref` to external URL or filesystem path | `resolveRefs` regex `^#/types/(\w+)$` rejects all other forms at parse time. No `fs`, no `fetch` in `src/contracts/json-schema-ref.ts`. |
| T-8 | Spoofing | Malicious auto-register — a contract slug shadows a v1 tool name | C-4. `tool_prefix` Zod `.min(1)` prevents empty prefix; first-wins on name collision protects existing registrations. |

---

## Rationale (rejected alternatives)

| Decision | Rejected | Why |
|---|---|---|
| Dual MCP surface (D-A1) | MCP Prompts surface | Rejected for CON-09 ChatGPT Custom Connector incompatibility — ChatGPT's Custom Connector spec exposes Tools, not Prompts. Phase 6 needs to be reachable from every MCP-aware client; Tools are the lowest-common-denominator. |
| Closed verb enum (D-A2a) | Open `tool: <any-registered-tool-name>` form | Memory-namespace invariant bypass risk — would let a contract author smuggle `write_note` into `assembly:`. Three structural mitigations (no write verbs, separate write_back, MemorySink-only sinks) all depend on the closed enum. |
| Custom verbs via `mcp://` (D-A2a) | First-class plugin API | Plugins introduce dynamic-import + signed-binary supply-chain risk; an MCP server is sandboxed-by-process and audited via `mcp_clients` config block. Plugins deferred to v3 if ever. |
| `contract_audit` (Q-AUD) | Extend `write_audit` | Blocked by FK constraint `note_id INTEGER NOT NULL` — orchestration rows have no note_id. Same wall Phase 5 daemon hit. |
| Templates only on YAML (C-7) | Allow `{{...}}` re-evaluation on resolved values | Template injection risk. The resolver is a one-shot parser; it does NOT recurse into resolved values. |
| Macros / sub-contracts | Deferred to v2.x | YAGNI per Operating Rule 6. May add `verb: macro:<name>` if `contract_audit` usage data justifies the complexity. |
| In-process TypeScript plugins | Deferred to v3 (if ever) | Same supply-chain reasoning as plugins above. |
| CI eval requires Ollama (Q-CI-LLM option a) | Re-tests Phase 5's LLM ladder | Adds Ollama-version dependency to Phase 6's CI for zero new coverage — Phase 5 already proves the ladder. |
| Empty `tool_prefix` allowed | Without A7 | Risk T-06-01-02: a contract named `read-note` would shadow v1 `read_note`. Zod `.min(1)` prevents. |

---

## Forward compatibility

- **Phase 7 (Canvas authoring)** will WRITE contracts. yaml@2.9 was chosen for round-trip preservation; the ContractFileSchema + `parseDocument` boundary is the place that path will hook.
- **Phase 10 (Notion connector)** will grow `TYPES_CATALOG.DocId.pattern` to include `notion://...` — additive only.
- **v2.x verb promotion** — a peer-MCP verb that consistently shows high `invocation_count` in `contract_audit` is a candidate for being absorbed into the baseline enum. The aggregator (`aggregateVerbUsage`) is the operational signal.
- **v2.x macro support** — if Deferred macros prove worth shipping, `verb: macro:<name>` would land as a new structural category alongside baseline / literal / mcp:// — no breaking changes to existing verb literals.
- **Breaking-change rule.** NO breaking changes to `ParsedContract.assembly[].verb` literal set without a major version bump. Additive evolution only.

---

## References

- RESEARCH: `.planning/phases/06-task-contract-dsl/06-RESEARCH.md` (Examples 1, 3, 4, 5, 6, 7; Pitfalls F1, F2, F3, F6, F7; Assumption A1, A3; A7; §Security).
- CONTEXT: `.planning/phases/06-task-contract-dsl/06-CONTEXT.md`.
- VALIDATION: `.planning/phases/06-task-contract-dsl/06-VALIDATION.md`.
- ADR-005 — Phase 5 brief-compile strategy, the LLM ladder Phase 6 inherits (Q-CI-LLM).
- ADR-004 — MemorySink handle invariants (D-A4c).
- ADR-002 — adapter-seam discipline (loader + verbs MUST stay free of `fs`/`chokidar`/`gray-matter`).
- ADR-001 — opaque DocId identity (Pitfall F6).
