# Phase 6: Task contract DSL - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship **declarative task contracts** as YAML documents (Zod-validated, comment-preserving) in `_contracts/`, addressable by name, instantiable via MCP, with **handle-based source/sink portability** that sets the v3 multi-source template. Phase 6 formalizes the orchestration layer that Phase 5 D-01 deliberately left to the caller — "Phase 6 contract DSL formalizes auto-discovery declaratively." Phase 6 lands these concrete surfaces:

1. **Contract `Document` shape** (CON-01, CON-02) — YAML files under `_contracts/` (default `MemorySink` per ADR-004), one per contract, Zod-4 validated. Schema fields: `version`, `name`, `description`, `inputs`, `sources`, `assembly`, `output_shape`, `write_back`. Comments preserved on round-trip (`yaml ^2.6` round-trip mode; CON-12 locks the dep). Contract loading is **hot-reloaded** via `ChangeFeed` subscription (matches Phase 5 daemon pattern; see D-LOAD).

2. **`list_contracts({source?})` MCP Resource** (CON-04) — discovery; promoted from Tool per Phase 3 ASM-13 + Phase 4 sign-off + Phase 5 BRF-09 precedent.

3. **`describe_contract({name})` MCP tool** (CON-05) — returns the contract's JSON-Schema `inputs`, declared `sources`/`sinks` (handles + their default URIs), assembly step DAG (verb names + named bindings), `output_shape`, and `write_back` destination handle(s).

4. **`instantiate_contract({name, inputs, source_overrides?, sink_overrides?})` MCP tool** (CON-06) — Zod-validates `inputs` against the contract's input schema, validates `source_overrides`/`sink_overrides` against declared handles (strict — see D-A4b/D-A4c), executes the assembly steps in order with named-binding template resolution (D-A2c), routes `write_back` writes through `DeliveryAdapter` to a MemorySink-validated target (D-A4c), returns the shaped bundle plus the new `DocId` of any written artifact.

5. **Three reference contracts ship** (CON-07): `meeting-prep`, `project-status`, `code-review-brief` — each authored as `_contracts/<name>.yaml`, each chains baseline verbs only (no peer-MCP custom verbs in v2.0.0), each has a paired eval scenario under `evals/fixtures/v2-test-vault/_queries/contracts-<name>.yaml` with expected `output_shape` (CON-08).

6. **MCP surface model** (CON-11 ADR — D-A1) — **both** surfaces ship: generic `instantiate_contract` tool is always available; per-contract auto-registration as MCP Tools is gated by per-vault `[contracts] auto_register_tools = false` (default OFF). When ON: each contract surfaces as a tool named `<prefix><name>` where `prefix` is `[contracts] tool_prefix = "vm_"` by default (e.g., `vm_meeting_prep`); the contract's `inputs` JSON-Schema becomes the MCP `inputSchema`; `ChangeFeed` events emit `tools/list_changed`. A manual `register_contracts_as_tools({vault?})` tool is **always available** regardless of config — one-shot scan + register + notify, for explicit refresh on demand.

7. **Assembly verbs — closed baseline + `literal` escape + peer-MCP extension** (D-A2a) — `assembly:` step `verb:` field accepts: (a) one of the 11 baseline read/assembly verbs (`search_hybrid`, `expand`, `cluster`, `recall`, `compile_brief`, `get_brief`, `query_frontmatter`, `list_backlinks`, `get_outline`, `search_sections`, `read_note`) — Zod enum validated at contract-load; (b) `literal` — injects a pre-computed value into the pipeline (CON-10 stub-parity eval needs this; lets non-LLM deployments produce shaped output); (c) `mcp://<server-name>/<tool-name>` — resolves against peer MCP servers declared in `[contracts.mcp_clients]` config (vault-memory acts as MCP *client* to peers). Write verbs (`write_note`, `delete_note`, `update_frontmatter`, `record_observation`, `supersede`) are NOT in the assembly verb set; the only legal write path is the structured `write_back:` block, which is validated as a MemorySink target (D-A4c).

8. **Custom-verb housekeeping — `list_contract_verbs` MCP Resource + `audit_log` integration** (D-A2b) — Resource `vault-memory://contract-verbs/{vault}` returns `{baseline: [...], custom: [{verb, declared_in: '[contracts.mcp_clients]', used_by_contracts: [...], invocation_count, last_seen}]}`. Each step of `instantiate_contract` writes an `audit_log` row with `kind: "contract_step", verb, contract, ts`; the Resource aggregates these rows for the usage signal — making "which peer-MCP verbs are popular?" answerable in-product. This data becomes the prioritization signal for promoting custom verbs into the baseline in v2.x.

9. **Step composition — named bindings + mustache template resolution** (D-A2c) — every step has an `as:` alias; later steps reference earlier outputs via `{{alias.field}}`. `{{inputs.<name>}}` references the contract's inputs uniformly. A small (~50 LOC) template resolver substitutes at step-execution time. Supports reordering, fan-out, and reach-back across multi-step contracts. The resolver runs *after* Zod input validation but *before* the verb dispatcher.

10. **Input schema — JSON Schema subset embedded in YAML + `$ref` to a vault-memory type catalog** (D-A3a, D-A3b) — `inputs:` is a JSON Schema fragment per field. Zero translation when an auto-registered tool's MCP `inputSchema` is produced (MCP `inputSchema` IS JSON Schema). vault-memory ships a fixed type catalog accessible via `$ref: '#/types/<TypeName>'`: `DocId`, `Handle`, `ChunkId`, `MemorySink`. The catalog grows **additively** per phase (Phase 10 may extend `DocId.pattern` for `notion://`); never breaking changes.

11. **`source_overrides` / `sink_overrides` semantics** (CON-10; D-A4a, D-A4b, D-A4c) —
    - **Target form:** by contract-declared **handle name** (e.g., `default_source`, `audit_sink`). NOT by URI scheme. Matches the `{{default_source}}` variable handle pattern.
    - **Validation:** strict. Unknown override handle → `{ok:false, reason:"unknown_override_handle", handle:"<name>", valid_handles:[...]}`. Missing required source (declared as `required: true` in `sources:` block) → `{ok:false, reason:"missing_required_source", handle:"default_source", hint:"pass via source_overrides or set [contracts.defaults.<handle>] in config.toml"}`.
    - **Sink invariant:** every `sink_overrides` value MUST resolve to a registered MemorySink via Phase 2 `MemorySinkRegistry.resolveMemorySink(handle)`. Non-sink targets reject with `{ok:false, reason:"sink_override_not_a_memory_sink", target:"<uri>", hint:"sinks must be a registered MemorySink handle (see list_sinks)"}`. **This makes the Phase 2 memory-namespace invariant un-bypassable by construction** — a contract author cannot accidentally or intentionally point `write_back` at a user note.
    - **CON-10 stub-parity proof:** the eval calls `instantiate_contract({..., source_overrides: {default_source: 'stub://test-fixture'}})` against each of the three reference contracts and asserts identical `output_shape` against the obsidian-fs run.

12. **Contract loading — hot reload via `ChangeFeed`** (D-LOAD) — at server boot, `src/contracts/loader.ts` scans `_contracts/*.yaml`, validates each, builds in-memory `ContractRegistry`. At runtime, subscribes to `ChangeFeed` on `_contracts/` (alongside indexer + Phase 5 staleness daemon). On `create`/`update`/`delete`/`rename`: re-validate, mutate the in-memory registry, emit MCP `tools/list_changed` if `auto_register_tools: true`. Matches the Phase 5 D-07 daemon "in-process at server boot" lifecycle.

13. **Phase 6 ADR** (CON-11) — `docs/v2/adr/006-task-contract-dsl.md`. Authored BEFORE implementation (matches Phase 0/2/4/5 discipline; plan 06-01). Documents: the dual MCP surface (Tools + generic), the closed-verb enum + `literal` + `mcp://` extension, the named-binding template grammar, the JSON-Schema-with-`$ref` input shape, the strict override semantics, the MemorySink-only sink invariant, the contract hot-reload lifecycle, the `yaml ^2.6` rationale (comment preservation is CON-01).

Phase 6 sits at L4 (memory + compiled artifacts → workflows) per `docs/v2/ARCHITECTURE.md` (revised; L4 "Compiled briefs + Task contracts" section). It **composes lower layers; it does not introduce new ones** — consumes Phase 1 adapter seams, Phase 2 MemorySink + DeliveryAdapter, Phase 3 citation packets (assembly steps emit packets), Phase 4 graph primitives (verbs callable from assembly), Phase 5 brief layer (compile_brief is the L4 LLM-touching verb). `_contracts/*.yaml` lives in `_contracts/` which is a default MemorySink sub-namespace (ADR-004 §"folder-default").

**Operating environment (inherited)** — few expert users collaborating on a shared Obsidian vault via Syncthing / iCloud / git-sync; multiple MCP clients per server. Implications for Phase 6: (a) contracts edited via Obsidian (or future Phase 7 Canvas) sync across collaborators via the substrate; (b) the chokidar/ChangeFeed already handles cross-client edit propagation; (c) the `audit_log` aggregation surfaces *per-vault* contract usage — cross-vault rollup is a deployment concern, not a v2 product feature.

</domain>

<decisions>
## Implementation Decisions

User direction (2026-05-18): all four gray areas were selected and discussed. The user departed from the recommended option on D-A1 (chose "both surfaces" + config gate instead of "generic only") and D-A1c (chose user-controlled prefix `vm_` instead of fixed `contract_`). All other decisions accepted the recommended option.

### MCP Surface Model (CON-11 ADR)

- **D-A1: Both surfaces ship. Generic `instantiate_contract` is always available; per-contract auto-registration as MCP Tools is gated.** Default OFF. Per-vault config `[contracts] auto_register_tools = false`. When ON: each contract in `_contracts/*.yaml` registers as a tool whose name is `<prefix><snake_case_contract_name>`. `ChangeFeed` events on `_contracts/` trigger re-validation + `tools/list_changed` notification (SDK 1.29 `notifications/tools/list_changed`). A manual `register_contracts_as_tools({vault?})` tool is **always callable** — one-shot scan + register + notify. The manual command path is the explicit-control escape valve regardless of `auto_register_tools` setting.
  - **Rationale (rejected alternatives):** "Generic only" (option 1) sacrifices discoverability — Claude can't auto-suggest `vm_meeting_prep` from `tools/list`. "Auto-register every contract by default" (option 2) breaks REL-08 ≤32 tools budget as users author contracts and makes `tools-list.snapshot.json` vault-dependent. MCP Prompts (option 3) was rejected because ChatGPT Custom Connector does not consume MCP Prompts at all (kills CON-09 non-Claude proof). The dual-surface + config gate keeps the snapshot test stable in CI (default-OFF) while letting power users opt into native discoverability per-vault.

- **D-A1b: Per-vault config `[contracts] auto_register_tools` (default `false`).** Lives in `~/.vault-memory/config.toml` per vault (Phase 1 `loadConfig` extension). Per-vault not global because two vaults attached to the same server may have very different contract preferences (e.g., a personal vault wants discoverable contracts; a team-audit vault wants the snapshot stable).

- **D-A1c: Tool name prefix is `[contracts] tool_prefix` (default `"vm_"`).** Contract `name: meeting-prep` registers as `vm_meeting_prep`. Slug rule: contract `name` (YAML, kebab-case) → snake_case → prefix-prepend. `vm_` is short for "vault-memory" — brandable, easily searched, reserves a namespace under our control. Collision policy: two contracts in the same vault declaring the same `name` is a **load error**; the second one rejects with structured error and is excluded from the registry; the first registers normally. Cross-vault collisions are impossible (each vault's tool list is independent).
  - **Departure from recommended** (option 1 fixed `contract_` prefix). Cost: one extra config knob (we wanted YAGNI but the user wanted control). Payoff: deployments can rebrand; `vm_` reads better in audit logs than `contract_meeting_prep`.

### Assembly Verb Vocabulary

- **D-A2a: Closed baseline enum + `literal` escape-hatch + peer-MCP `mcp://` extension.** The `assembly:` step `verb:` field accepts exactly:
  - **Baseline (closed Zod enum, 11 verbs):** `search_hybrid`, `expand`, `cluster`, `recall`, `compile_brief`, `get_brief`, `query_frontmatter`, `list_backlinks`, `get_outline`, `search_sections`, `read_note`. These are all read-only or LLM-touching (compile_brief) verbs; no write verbs in the enum.
  - **Escape-hatch:** `literal` — step injects `value: <string-or-doc>` into the pipeline. Required for CON-10 stub-parity (deterministic input avoids LLM variance). Also lets non-LLM deployments produce shaped output (CON-09 ChatGPT Custom Connector proof can use a contract that uses `literal` only + non-LLM verbs).
  - **Peer-MCP extension:** `mcp://<server-name>/<tool-name>` — resolved against `[contracts.mcp_clients]` config entries. Each entry declares a peer MCP server vault-memory connects to as an MCP *client* (separate session per peer, lifecycle bound to `vault-memory serve`). Calls flow: vault-memory MCP server (us) → vault-memory MCP client (us) → peer MCP server. Latency cost is real (cross-process); planner verifies acceptable for v2.
  - **No write verbs in the assembly enum.** The Phase 2 memory-namespace invariant is preserved by construction: the only path to a write is `write_back:` which validates targets through `MemorySinkRegistry.resolveMemorySink()` (D-A4c).
  - **Rationale (rejected alternatives):** "Open `tool: <any-registered-tool-name>`" (option 2) breaks the memory-namespace invariant (a contract could call `write_note` directly). "Closed enum, no escape-hatch" (option 1/3) blocks CON-10 deterministic stub-parity and forces every test deployment to configure an LLM. The chosen shape is **safety-first (closed write set) + flexibility-via-extension (peer MCP for everything else)**.

- **D-A2b: Custom-verb housekeeping — `list_contract_verbs` Resource + `audit_log` integration.**
  - **Resource:** `vault-memory://contract-verbs/{vault}` returns `{baseline: [<verb>, ...], custom: [{verb: 'mcp://github/list_issues', declared_in: '[contracts.mcp_clients]', used_by_contracts: ['my-pr-review'], invocation_count: 42, last_seen: '2026-05-17T14:00:00Z'}, ...]}`.
  - **audit_log integration:** every step of `instantiate_contract` writes a row with `kind: "contract_step", contract: "<contract-name>", verb: "<verb>", step_alias: "<as>", ts: <unix-ms>, vault: "<name>"`. The Resource aggregates by `verb` to produce `invocation_count` and `last_seen` per the user's "usage signal" rationale.
  - **Promotion path for v2.x:** if a peer-MCP verb hits high `invocation_count` across many vaults, that's the prioritization signal for promoting it into the baseline enum in a future minor release (e.g., v2.1 adds `github_list_issues` if everyone is using it).
  - Phase 2 audit_log already exists; this is additive: a new `kind: "contract_step"` row and a new query namespace `src/db/queries/audit.ts` extension for the aggregation.

- **D-A2c: Step composition — named bindings + mustache `{{alias.field}}` templates.**
  - Every step in `assembly:` MUST have an `as:` alias (Zod required).
  - References to other steps use `{{alias.field}}` mustache syntax; `{{inputs.<name>}}` references the contract's `inputs` uniformly.
  - A small (~50 LOC) template resolver substitutes at step-execution time, AFTER Zod input validation and BEFORE the verb dispatcher. It handles: (a) lookup against the named-bindings table; (b) field path traversal (`{{step1.doc_id}}` against `{doc_id: "..."}`); (c) array shorthand (`{{step1.doc_ids}}` against an array); (d) error on undefined alias / undefined field — emit `{ok:false, reason:"unresolved_template", expression:"{{foo.bar}}"}`.
  - **Rationale (rejected alternatives):** Implicit `$prev` only (option 2) can't fan-out (two later steps depending on the same earlier output); forces unnatural ordering. The mustache-style is verbose but explicit — `describe_contract` output makes the data flow visible.

### Input Schema Declaration

- **D-A3a: JSON Schema subset embedded in YAML.** Each `inputs:` field is a JSON Schema fragment. Pass-through to MCP `inputSchema` is byte-equivalent (MCP `inputSchema` IS JSON Schema). Zod 4 parses JSON Schema into a validator at contract-load time (Zod 4 ships first-class JSON Schema support). Supported keywords: `type`, `description`, `pattern`, `enum`, `format`, `default`, `required` (via parent-level array per JSON Schema convention). Each `inputs:` is internally wrapped as `{type:'object', properties: <fields>, required: [<requireds>]}` for MCP pass-through, but YAML authors write the flat `inputs: { <name>: { type, description, ... } }` form for readability.

- **D-A3b: `$ref: '#/types/<TypeName>'` resolves to a vault-memory type catalog.** Initial catalog (ships in code at `src/contracts/types.ts`):
  - `DocId` → `{type: 'string', pattern: '^[a-z][a-z0-9-]*://', description: 'Opaque document identifier per ADR-001'}`
  - `Handle` → same shape (currently identical to DocId; future-proof for divergence)
  - `ChunkId` → `{type: 'string', pattern: '^[a-z][a-z0-9-]*://.+#chunk-[0-9a-f]{7}$', description: 'Content-stable chunk identifier per Phase 5 ADR-003 H-5'}`
  - `MemorySink` → `{type: 'string', description: 'Registered MemorySink handle (see list_sinks)', x-validator: 'memory-sink'}` — the `x-validator` extension triggers runtime resolution through `MemorySinkRegistry.resolveMemorySink()` at instantiation time.
  - Resolver (~20 LOC) at `src/contracts/json-schema-ref.ts` handles `$ref: '#/types/<name>'` lookup against the catalog. Unknown ref → load error.
  - **Additive evolution only.** Phase 10 may extend `DocId.pattern` for `notion://` schemes; never narrow.

### `source_overrides` / `sink_overrides` Semantics (CON-10)

- **D-A4a: Override target = contract-declared handle name.** Each contract declares its sources/sinks in a `sources:` block by handle name with required/optional semantics:
  ```yaml
  sources:
    default_source: { handle: 'obsidian-fs://my-vault', required: true }
    audit_log_source: { handle: 'obsidian-fs://team-audit', required: false }
  ```
  Override syntax:
  ```
  instantiate_contract({
    name: 'meeting-prep',
    inputs: {...},
    source_overrides: { default_source: 'stub://test-fixture' }   // by HANDLE NAME, not by scheme
  })
  ```
  `audit_log_source` stays as declared unless explicitly overridden. CON-10 eval is trivial: override `default_source: 'stub://test-fixture'`, leave any other handles, assert same-shape output.
  - **Rationale (rejected alternatives):** By URI scheme (option 2) can't selectively override one of two same-scheme sources. "Both" (option 3) adds precedence complexity without a CON-10 driver — the eval just needs handle-name targeting.

- **D-A4b: Strict validation on overrides.** No silent ignore, no fallback for missing required.
  - **Unknown handle in override:** `{ok: false, reason: "unknown_override_handle", handle: "foo", valid_handles: ["default_source", "audit_log_source"]}`
  - **Missing required source:** `{ok: false, reason: "missing_required_source", handle: "default_source", hint: "pass via source_overrides or set [contracts.defaults.default_source] in config.toml"}`
  - **Optional source with neither default nor override:** the step that references it gets `null`; verbs handle `null` per their own contract. Documented in the Phase 6 ADR per-verb.
  - **Default chaining:** `instantiate_contract` resolves a handle in this order: (1) explicit `source_overrides` arg, (2) `~/.vault-memory/config.toml` `[contracts.defaults.<handle>]`, (3) contract YAML's `sources.<handle>.handle` literal, (4) error if `required: true`.

- **D-A4c: `sink_overrides` MUST resolve to a registered MemorySink.** Validation runs through Phase 2 `MemorySinkRegistry.resolveMemorySink(target)`.
  - Non-sink target → `{ok: false, reason: "sink_override_not_a_memory_sink", target: "<uri>", hint: "sinks must be a registered MemorySink handle (see list_sinks)"}`.
  - This is the **memory-namespace invariant enforced at the contract surface** — a contract author cannot accidentally or intentionally point `write_back:` at a user note. The same invariant applies to the contract's declared `sources.<x>` if that source is used as a write_back target (which it shouldn't be — `write_back:` is structurally separate).
  - `write_back:` block schema:
    ```yaml
    write_back:
      sink: '{{default_sink}}'                 # handle reference
      document_kind: 'brief' | 'observation' | 'custom'
      properties: { ... }                       # PropertyBag overrides
      body_from: '{{compile_step.body}}'        # template reference to a step output
    ```

### Contract Loading & Lifecycle

- **D-LOAD: Hot reload via `ChangeFeed` subscription.** Mirrors the Phase 5 daemon "in-process at server boot" pattern (Phase 5 D-07).
  - **Boot:** `src/contracts/loader.ts` scans `_contracts/*.yaml`, validates each (Zod against the contract schema), builds `ContractRegistry` (in-memory `Map<name, ParsedContract>`), and — if `auto_register_tools: true` — also registers each contract as an MCP Tool.
  - **Runtime:** subscribe to `ChangeFeed` on the `_contracts/` path (alongside the indexer + Phase 5 staleness daemon — all three handlers fan out from the same `ChangeFeed` per `Disposable` contract). Events:
    - `create` / `update`: re-parse, re-validate; on success → update registry + emit `tools/list_changed` if auto-register is ON. On failure → keep prior version in registry (graceful degradation), write `audit_log` row `kind: "contract_load_error", file, error_message`.
    - `delete`: remove from registry + emit `tools/list_changed`.
    - `rename`: `unlink + add` (per Phase 1 obsidian-fs semantics) — handled as delete-then-create.
  - **Multi-MCP-client compatibility:** if multiple `vault-memory serve` processes attach to the same vault, all of them scan + register independently. There's no lock — contract registration is read-only with respect to the filesystem (we don't write `_contracts/`, the user does). Each process's registry converges on the same state from the same source files.
  - **`audit_log` for load errors:** structured `kind: "contract_load_error"` rows let users debug malformed contracts via `audit_log` queries without log-diving.

### Claude's Discretion

Several implementation areas were deliberately **not discussed**. Researcher + planner choose, anchored by the ADRs + the new Phase 6 ADR (D-A1/D-A2/D-A3/D-A4/D-LOAD) + the CON-01..CON-12 contracts.

- **The exact YAML schema of `output_shape:`.** Likely a JSON Schema subset that callers can `describe_contract` against and that `instantiate_contract` validates the bundle against before returning. Researcher reads the three reference contracts' intended outputs and picks the minimum-viable schema. Recommendation lean: same shape as `inputs:` (JSON Schema subset + `$ref` catalog).

- **Where peer-MCP client sessions are held in the process tree.** Likely `src/contracts/mcp-clients.ts` instantiates `Client` (SDK) connections per `[contracts.mcp_clients.<name>]` entry at server boot; `Disposable` on shutdown. Planner verifies SDK 1.29 client lifecycle ergonomics. Connection failures at boot: WARN, mark verb as unavailable, contracts that reference an unavailable verb fail at instantiation with `{ok:false, reason:"mcp_client_unavailable", verb:"mcp://<server>/<tool>"}`. No retry loop in v2.

- **YAML library round-trip mode specifics.** `yaml ^2.6` supports comment preservation via `parseDocument` / `Document.toString()` round-trip. Researcher verifies: (a) the round-trip preserves comments byte-equivalent for the three reference contracts; (b) Zod validates the parsed JS value (not the YAML AST); (c) the `write_back` path NEVER round-trips contracts — contracts are user-authored, vault-memory only reads them.

- **Error envelope shape for `instantiate_contract` failures.** Returns `{ok: false, reason: <enum>, ...}` for predictable failure modes. The enum: `unknown_contract`, `invalid_inputs`, `unknown_override_handle`, `missing_required_source`, `sink_override_not_a_memory_sink`, `unresolved_template`, `verb_not_available`, `mcp_client_unavailable`, `assembly_step_failed`, `write_back_failed`, `validation_failed_on_output_shape`. Planner finalizes the closed enum during plan 06-01 ADR authoring.

- **`describe_contract` Zod-to-human-readable summary.** Recommendation lean: return both `{json_schema: <inputs JSON Schema>, summary: <markdown human-readable>}`. The summary is generated at boot from the parsed contract; `auto_register_tools` consumers see only the JSON Schema; humans browsing via MCP Inspector see the summary.

- **Concurrent `instantiate_contract` calls.** Two agents simultaneously call `instantiate_contract({name: 'meeting-prep', inputs: {meeting_doc_id: X}})`. Both succeed independently; both write_back rows (if any) land via `DeliveryAdapter.write()`; if both target the same `_memory/_briefs/<target>.md`, the Phase 5 D-12 auto-supersede chain handles ordering. No mutex required in Phase 6.

- **Step-level timeouts.** Recommendation lean: per-step soft timeout from `[contracts] step_timeout_seconds = 30` config; on timeout, structured `{ok:false, reason:"assembly_step_failed", step_alias, cause:"timeout"}`. Mostly relevant for peer-MCP verbs.

- **The three reference contracts' exact `assembly:` step lists.** Researcher drafts in plan 06-02 (or 06-03 — planner decides) against Atlas Robotics fixture. Sketch:
  - `meeting-prep`: `read_note` (the meeting) → `expand` (linked context) → `cluster` (group by topic) → `compile_brief` (synthesize) → `write_back` to `_memory/_briefs/<meeting_slug>--<ts>.md`.
  - `project-status`: `query_frontmatter` (project notes) → `cluster` → `compile_brief` → write_back to `_memory/_briefs/<project_slug>--<ts>.md`.
  - `code-review-brief`: `read_note` (the PR / diff doc) → `search_hybrid` (related code/notes) → `compile_brief` → write_back.

- **CON-09 non-Claude proof — exact MCP client to test against.** Recommendation lean: MCP Inspector + the existing `search`/`fetch` flat-shape adapter for ChatGPT Custom Connectors should both be exercised in CON-09. Planner picks which is the canonical "non-Claude" test; both should pass.

- **`audit_log` retention for `contract_step` rows.** Same as existing `audit_log` retention (Phase 2 default; not specified here). If `contract_step` rows balloon (a popular contract called thousands of times), a future migration can add a retention policy. Out of v2.0.0 scope.

- **`tools-list.snapshot.json` regen strategy.** Default-OFF `auto_register_tools` means the snapshot stays stable in CI (only +`describe_contract` + `instantiate_contract` + `register_contracts_as_tools` net-new tools land — three tools — plus `list_contracts` and `list_contract_verbs` MCP Resources). Verified in Phase 6 PR; one snapshot regen with the additive diff.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 6 specs (the WHAT)
- `.planning/REQUIREMENTS.md` §"Task Contract DSL (Phase 6)" — CON-01..CON-12 (precise deliverable list)
- `.planning/ROADMAP.md` §"Phase 6: Task contract DSL" — goal + 5 success criteria
- `.planning/PROJECT.md` — v2 mission; "user-defined task contracts that any MCP-aware agent can discover and instantiate" (the Phase 6 thesis); note that PROJECT.md was authored with Phase 7 numbering for contracts but ROADMAP renumbered to Phase 6 — ROADMAP is authoritative

### ADRs (lock the type contracts and invariants)
- `docs/v2/adr/001-document-identity.md` — opaque `DocId`; URI shape used by `$ref: '#/types/DocId'` (D-A3b)
- `docs/v2/adr/002-adapter-seams.md` — `DeliveryAdapter` interface (write_back chokepoint); `SourceConnector` (assembly verb backing); capability descriptors at `src/adapters/capabilities.ts`; **`assembly tools take a handle and never touch the filesystem directly`** is verbatim
- `docs/v2/adr/003-document-shape.md` — `Document` shape used by `_contracts/*.yaml` files (they ARE Documents per CON-02); `PropertyBag` for contract properties; chunk identity from H-5 informs `$ref: '#/types/ChunkId'`
- `docs/v2/adr/004-memory-sink-handles.md` — `MemorySinkRegistry`; `resolveMemorySink(handle)` (D-A4c sink validation); `_contracts/` is a sub-namespace of the default `_memory/` sink (or its own configured sink — planner verifies)
- `docs/v2/MEMORY_CONTRACT.md` — `write_back` provenance keys (`source: agent`, `compiled_from`, `confidence`, etc.); contract instantiation writes satisfy MEM-05 validator
- `docs/v2/ARCHITECTURE.md` §"L4 — Compiled briefs + Task contracts" — `instantiate_contract` is the L4 orchestrator; "contracts compose layers; they do not introduce new ones"
- `docs/v2/AGENT_AGNOSTIC.md` — `list_contracts` as MCP Resource (CON-04); non-Claude MCP client proof (CON-09); MCP Prompts ruled out for v2 (D-A1 rationale)
- `docs/v2/adr/005-brief-compile-strategy.md` — Phase 5 LLM ladder applies to the `compile_brief` assembly verb (D-A2a baseline enum); contracts inherit Phase 5 D-10 ladder via the verb
- `docs/v2/adr/006-task-contract-dsl.md` (NEW — authored by plan 06-01) — the dual MCP surface (D-A1), closed-verb enum + `literal` + peer-MCP extension (D-A2a), `audit_log` usage signal (D-A2b), named-binding templates (D-A2c), JSON-Schema-with-`$ref` input shape (D-A3a/D-A3b), strict override semantics (D-A4a/D-A4b), MemorySink-only sink invariant (D-A4c), hot-reload lifecycle (D-LOAD), `yaml ^2.6` rationale

### Prior phase outputs Phase 6 consumes directly
- `.planning/phases/05-compiled-brief-layer/05-CONTEXT.md` — D-01 caller-supplied sources (Phase 6 contracts formalize the orchestration that Phase 5 deliberately deferred); D-10 LLM ladder applies inside `compile_brief` verb; D-12 auto-supersede chain handles concurrent contract writes to same target
- `docs/v2/PHASE-5-SIGN-OFF.md` — Phase 5 sign-off; explicit hand-off to Phase 6 for orchestration-as-data
- `.planning/phases/04-graph-as-retrieval/04-CONTEXT.md` — `expand` + `cluster` + indexer unified parse pass (contracts in `_contracts/*.yaml` are picked up by the indexer for back-edge extraction if they contain wikilinks in `description:` fields)
- `.planning/phases/03-bundles-authority-staleness/03-CONTEXT.md` — D-05 8-field citation packet shape; assembly verbs that produce packets feed downstream verbs uniformly
- `.planning/phases/02-memory-namespace-provenance-contract/02-CONTEXT.md` — `MemorySinkRegistry` API (D-A4c sink validation); `supersede()` tool (concurrent contract writes); MEM-05 property validator (write_back satisfies this); `audit_log` writer (D-A2b housekeeping)
- `.planning/phases/01-adapter-extraction-tech-debt-up/01-CONTEXT.md` — `ChangeFeed` interface (D-LOAD hot reload); adapter-seam CI greps (Phase 6 code in `src/contracts/` must not import `fs` directly)
- `.planning/phases/00-foundation-decisions/00-CONTEXT.md` — eval discipline; Atlas Robotics fixture (CON-08 contract eval scenarios)
- `docs/v2/adr/ADVERSARIAL-REVIEW.md` — anything touching new MCP surface model, override semantics, or the verb enum

### Phase 1–5 code Phase 6 reads and extends
- `src/types.ts` — extend with `Contract`, `ContractSchema` (parsed Zod-validated form), `AssemblyStep`, `ContractInputs`, `OverrideMap`, `ContractRegistry`; reuse `Document` shape for the YAML file's on-disk form (CON-02)
- `src/adapters/source/types.ts` + capabilities — verbs in the assembly enum dispatch to adapter operations; capability descriptors gate which verbs are available against a given source
- `src/adapters/change-feed/types.ts` — `ChangeFeed.subscribe()` (D-LOAD); contracts loader registers a third handler on `_contracts/` alongside indexer + Phase 5 staleness daemon
- `src/adapters/delivery/index.ts` — `DeliveryAdapter.write()` (write_back chokepoint); contracts write through this — no shortcut
- `src/memory/registry.ts` — `MemorySinkRegistry.resolveMemorySink(handle)` (D-A4c invariant enforcement)
- `src/memory/validator.ts` — MEM-05 property validator; write_back writes must satisfy it
- `src/memory/tools/supersede.ts` — concurrent contract writes to same target handled by Phase 5 D-12 auto-supersede chain
- `src/db/queries/audit.ts` — extend with `kind: "contract_step"` and `kind: "contract_load_error"` row support; add aggregation query for `list_contract_verbs` Resource (`SELECT verb, COUNT(*), MAX(ts) FROM audit_log WHERE kind = 'contract_step' GROUP BY verb`)
- `src/tool-registry.ts` — register `describe_contract`, `instantiate_contract`, `register_contracts_as_tools` (tools); register `list_contracts`, `list_contract_verbs` (MCP Resources via SDK 1.29 `ListResourcesRequestSchema`)
- `src/server.ts` — instantiate `ContractRegistry` after `MemorySinkRegistry`, before `ChangeFeed.subscribe()` for watcher/daemon; subscribe to `_contracts/` events
- `src/brief/compile.ts` — `compile_brief` verb is callable from `assembly:` (D-A2a baseline); contract calls dispatch to this same function
- `src/brief/get.ts` — `get_brief` verb (D-A2a baseline)
- `src/graph/expand.ts`, `src/graph/cluster.ts` — `expand` / `cluster` verbs (D-A2a baseline)
- `src/search/hybrid.ts` — `search_hybrid` verb (D-A2a baseline)
- `src/frontmatter/query.ts` — `query_frontmatter` verb (D-A2a baseline)
- `src/sections/*.ts` — `get_outline` / `search_sections` verbs (D-A2a baseline)
- `src/memory/tools/recall.ts` — `recall` verb (D-A2a baseline)
- `src/adapters/source/conformance.test.ts` — extend with contract instantiation + CON-10 stub-parity assertions
- `evals/v1-baseline/baseline.test.ts` — must stay green; no v1 tool surface change
- `evals/v1-baseline/tools-list.snapshot.json` — additive diff: `describe_contract`, `instantiate_contract`, `register_contracts_as_tools` (3 new tools), `list_contracts`, `list_contract_verbs` (2 new MCP Resources). Default-OFF `auto_register_tools` keeps snapshot stable across deployments. One regen in Phase 6 PR.
- `evals/fixtures/v2-test-vault/_queries/` — NEW: `contracts-meeting-prep.yaml`, `contracts-project-status.yaml`, `contracts-code-review-brief.yaml`, `contracts-stub-parity.yaml` (CON-10)
- `evals/fixtures/v2-test-vault/_contracts/` — NEW directory with the three reference contracts as YAML files (also serves as documentation by example)

### NEW Phase 6 modules (`src/contracts/` — L4 per `docs/v2/ARCHITECTURE.md`)
- `src/contracts/types.ts` — internal types for parsed contracts, registry, override maps
- `src/contracts/schema.ts` — Zod schema for the YAML contract shape; validates at load time
- `src/contracts/loader.ts` — boot scan + `ChangeFeed` hot reload (D-LOAD)
- `src/contracts/registry.ts` — `Map<name, ParsedContract>` + lookup APIs
- `src/contracts/types-catalog.ts` — `DocId`, `Handle`, `ChunkId`, `MemorySink` JSON-Schema catalog (D-A3b)
- `src/contracts/json-schema-ref.ts` — `$ref: '#/types/<name>'` resolver (D-A3b)
- `src/contracts/templates.ts` — mustache `{{alias.field}}` resolver (~50 LOC, D-A2c)
- `src/contracts/verbs/index.ts` — closed-baseline verb dispatcher + `literal` handler
- `src/contracts/verbs/mcp-extension.ts` — peer-MCP `mcp://<server>/<tool>` resolver + client sessions
- `src/contracts/mcp-clients.ts` — peer MCP client lifecycle (boot/shutdown); reads `[contracts.mcp_clients]` config
- `src/contracts/instantiate.ts` — `instantiate_contract` entry point: validate inputs → validate overrides → resolve sources/sinks → execute steps → run write_back → return shaped bundle
- `src/contracts/describe.ts` — `describe_contract` entry point: returns input JSON Schema + sources/sinks + assembly DAG + output_shape
- `src/contracts/resources.ts` — `list_contracts` + `list_contract_verbs` MCP Resource registrations
- `src/contracts/auto-register.ts` — when `auto_register_tools: true`, dynamically register each contract as a tool; emit `tools/list_changed` on registry mutations
- `src/contracts/tests/*` — vitest co-located test files

### Codebase maps (read for Phase 6 mechanics)
- `.planning/codebase/ARCHITECTURE.md` — current layer model; `src/contracts/` is L4 (alongside `src/brief/`)
- `.planning/codebase/STRUCTURE.md` — "Where to Add New Code" recipes; `src/contracts/` directory placement
- `.planning/codebase/CONVENTIONS.md` — ESM + `.js` extensions, kebab-case files, Zod validation discipline, type-check-as-lint
- `.planning/codebase/TESTING.md` — vitest layout; new tests co-located in `src/contracts/*.test.ts`; conformance extension lives next to `src/adapters/source/conformance.test.ts`
- `.planning/codebase/INTEGRATIONS.md` — Ollama + MCP SDK touchpoints; peer MCP client integration is net-new for Phase 6
- `.planning/codebase/STACK.md` — confirms SDK 1.29 has Client APIs for peer MCP connections; `yaml ^2.6` is the only net-new runtime dep

### External references
- MCP Specification §"Tools" — `tools/list_changed` notification semantics (D-A1 auto-register)
- MCP Specification §"Resources" — Resource registration shape (`list_contracts`, `list_contract_verbs`)
- MCP Specification §"Client" — peer MCP client connection lifecycle (D-A2a `mcp://` extension)
- MCP SDK 1.29 docs — `Server.notification()` / `Client.connect()` ergonomics
- JSON Schema 2020-12 — input schema dialect; the `$ref` resolution mechanism (D-A3b)
- `yaml ^2.6` docs — `parseDocument` / `Document.toString()` round-trip; comment preservation contract (CON-01)
- Zod 4 docs — JSON Schema parser (`z.toJSONSchema` reverse + JSON-Schema-to-Zod via the in-tree extension)

### Operating-environment context (informs design choices)
- **Few expert users, shared vault, multiple MCP clients per server** — `auto_register_tools: false` default keeps `tools-list.snapshot.json` stable across multi-client deployments; per-vault config lets one client (Claude Code) opt in while another (ChatGPT Connector) sees only the generic surface
- **Local-first, no telemetry, peer-MCP-only network beyond localhost:11434** — `[contracts.mcp_clients]` is the controlled escape valve; user authorizes each peer server explicitly in config; no auto-discovery from the wider network
- **Indexer picks up `_contracts/*.yaml` for wikilink back-edges** — if a contract's `description:` field contains `[[Note]]`, Phase 4 D-02 indexer creates the back-edge automatically; contracts become first-class graph nodes like briefs (same trick Phase 5 D-11 used)
- **Audit log is the usage signal for v2.x baseline promotion** — D-A2b makes "which custom verbs are popular" answerable in-product, so v2.x can promote based on real data, not guesses

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`DeliveryAdapter.write()`** (`src/adapters/delivery/index.ts`) — write_back chokepoint; contract write_back routes through this verbatim. No new write path.
- **`MemorySinkRegistry.resolveMemorySink()`** (`src/memory/registry.ts`) — D-A4c invariant enforcement; sink_overrides validation calls this directly.
- **Phase 5 `compile_brief`** (`src/brief/compile.ts`) — assembly verb baseline; contracts call this function directly when `verb: compile_brief` is in `assembly:`.
- **Phase 5 `get_brief`** (`src/brief/get.ts`) — assembly verb baseline.
- **Phase 4 `expand` + `cluster`** (`src/graph/expand.ts`, `src/graph/cluster.ts`) — assembly verb baseline.
- **Phase 3 citation packet builders** (`src/assembly/`) — `search_hybrid`, `recall`, `get_outline`, `search_sections` produce the 8-field citation packets that flow as `{{alias.<field>}}` data into downstream steps.
- **`ChangeFeed.subscribe()`** (`src/adapters/change-feed/types.ts`) — D-LOAD hot reload; contract loader registers a third handler on `_contracts/`. Already supports fan-out per `Disposable` contract.
- **Phase 2 `audit_log` writer** (`src/db/queries/audit.ts`) — D-A2b housekeeping; new `kind: "contract_step"` and `kind: "contract_load_error"` rows extend the existing schema.
- **Phase 2 `supersede()`** (`src/memory/tools/supersede.ts`) — concurrent `instantiate_contract` writes to the same memory target use the Phase 5 D-12 auto-supersede chain.
- **`tool-registry.ts`** (Phase 0) — central registration; 3 new tools (`describe_contract`, `instantiate_contract`, `register_contracts_as_tools`) + 2 new MCP Resources (`list_contracts`, `list_contract_verbs`) land here.
- **MCP SDK 1.29 `Server.setRequestHandler(ListResourcesRequestSchema, ...)`** — pattern from Phase 2 `memory_stats`/`list_sinks` and Phase 5 `list_briefs`; Phase 6 follows.
- **MCP SDK 1.29 `Server.notification('notifications/tools/list_changed')`** — D-A1 auto-register dynamic tool list.
- **MCP SDK 1.29 `Client`** — peer-MCP `mcp://` extension; planner verifies the client lifecycle pattern.
- **`OllamaClient.chat()`** (added in Phase 5 D-10) — already in place for `compile_brief` verb; no Phase 6 changes needed.
- **`evals/fixtures/v2-test-vault/`** — Atlas Robotics fixture; CON-08 eval scenarios + CON-10 stub parity live here.
- **Stub `ChangeFeed`** (per Phase 5 BRF-11) — CON-10 stub-parity proof uses the same stub source.
- **`SuppressionSet`** (Phase 1) — prevents infinite recompile loops when contracts are edited by Obsidian; reused for the contract loader watcher.

### Established Patterns
- **Adapter-seam discipline** — no `fs`, `gray-matter`, `path.join` outside `src/adapters/*/`. `src/contracts/` reads contracts via the `MemorySinkRegistry` + `DeliveryAdapter`-paired SourceConnector (it does NOT touch chokidar or fs directly). CI greps enforce.
- **Strictly additive schema migrations** — Phase 6 adds NO new tables; reuses `audit_log` with new `kind` values. Migration 013 may add an index `audit_log_kind_ts_idx` if D-A2b aggregation needs it (planner decides).
- **Forward-only supersede** (Phase 2 D-03) — concurrent contract writes to same memory target use Phase 5 D-12 chain.
- **Vitest co-location** — `src/contracts/schema.test.ts`, `src/contracts/loader.test.ts`, `src/contracts/templates.test.ts`, `src/contracts/instantiate.test.ts`, etc.
- **Conformance suite extension** — `src/adapters/source/conformance.test.ts` extends with contract instantiation + CON-10 stub-parity assertions against both obsidian-fs and stub.
- **Snapshot pinning** — `evals/v1-baseline/tools-list.snapshot.json` additive diff (3 tools + 2 resources); default-OFF `auto_register_tools` keeps it stable.
- **Phase 5 D-11 wikilink-in-body** — same trick: if contract `description:` contains `[[Note]]`, Phase 4 D-02 indexer creates back-edges; contracts become graph nodes.

### Integration Points
- **`src/contracts/loader.ts` (NEW)** — boot scan + `ChangeFeed` subscription on `_contracts/`; populates `ContractRegistry`.
- **`src/contracts/registry.ts` (NEW)** — `Map<name, ParsedContract>` + lookup; mutation triggers `tools/list_changed` when auto-register is ON.
- **`src/contracts/schema.ts` (NEW)** — Zod schema for YAML contract shape; runtime validation on every load + reload.
- **`src/contracts/templates.ts` (NEW)** — `{{alias.field}}` mustache resolver (~50 LOC).
- **`src/contracts/verbs/index.ts` (NEW)** — closed-baseline verb dispatcher; case-by-case calls into `src/search/`, `src/graph/`, `src/brief/`, etc.
- **`src/contracts/verbs/mcp-extension.ts` (NEW)** — peer-MCP client routing.
- **`src/contracts/mcp-clients.ts` (NEW)** — per-peer `Client` session lifecycle.
- **`src/contracts/types-catalog.ts` (NEW)** — `$ref: '#/types/<name>'` JSON Schema catalog.
- **`src/contracts/json-schema-ref.ts` (NEW)** — `$ref` resolver (~20 LOC).
- **`src/contracts/instantiate.ts` (NEW)** — orchestrator: input validation → override validation → step execution with named bindings → write_back → output_shape validation → return.
- **`src/contracts/describe.ts` (NEW)** — describe_contract output builder.
- **`src/contracts/resources.ts` (NEW)** — MCP Resource registration for `list_contracts` + `list_contract_verbs`.
- **`src/contracts/auto-register.ts` (NEW)** — D-A1 dynamic tool list management.
- **`src/server.ts`** — wire `ContractRegistry` after `MemorySinkRegistry`; subscribe to `_contracts/` ChangeFeed; instantiate peer-MCP clients.
- **`src/tool-registry.ts`** — register the 3 net-new tools + 2 net-new MCP Resources.
- **`src/db/queries/audit.ts`** — extend with `kind: "contract_step"` + `kind: "contract_load_error"` row support; add aggregation query for `list_contract_verbs`.
- **`src/config/loader.ts`** — add `[contracts]` section to AppConfigSchema: `auto_register_tools: boolean (default false)`, `tool_prefix: string (default "vm_")`, `mcp_clients: Record<string, McpClientConfig>` (peer-MCP entries), `defaults: Record<string, string>` (default handle URIs), `step_timeout_seconds: number (default 30)`.
- **`evals/fixtures/v2-test-vault/_contracts/`** — 3 reference contracts as YAML files (also documentation by example).
- **`evals/fixtures/v2-test-vault/_queries/contracts-*.yaml`** — 4 eval scenarios (3 reference + 1 stub parity).
- **`evals/v1-baseline/tools-list.snapshot.json`** — one regen with additive diff.
- **`docs/v2/adr/006-task-contract-dsl.md`** (NEW — plan 06-01 authors).
- **`package.json`** — add `yaml ^2.6` to runtime dependencies (CON-12).

</code_context>

<specifics>
## Specific Ideas

- **The Phase 6 ADR is authored BEFORE implementation** (matches Phase 0/2/4/5 discipline). Plan 06-01 is "Author ADR 006 — task contract DSL + MCP surface + verb enum + override semantics + load lifecycle"; everything else depends on it.

- **`yaml ^2.6` is locked because of CON-01 comment preservation.** Other YAML libraries lose comments on round-trip; `yaml ^2.6` ships `parseDocument` + `Document.toString()` that round-trip comments verbatim. This matters because Phase 7 Canvas authoring will round-trip YAML ↔ Canvas, and losing user comments would be a regression. CON-01 is satisfied by the library choice, not by extra code.

- **Memory-namespace invariant is enforced by THREE structural mechanisms in Phase 6** — together they make agent writes outside a MemorySink impossible by construction:
  1. The assembly verb enum has NO write verbs (D-A2a).
  2. `write_back:` is structurally a separate block from `assembly:` (CON-01 schema).
  3. `sink_overrides` and the contract's declared `sinks` MUST resolve to a registered MemorySink (D-A4c).

- **The peer-MCP extension is the "open" surface — but it's gated by config.** `[contracts.mcp_clients]` requires explicit user opt-in. This satisfies both the "extensibility" instinct and the "local-only network" constraint (each peer MCP client is a user-authorized connection, like a browser bookmark — not an auto-discovered service).

- **CON-09 non-Claude proof — Inspector + Custom Connector adapter — uses a contract that depends only on `literal` + a non-LLM baseline verb.** This is why the `literal` escape-hatch exists: a deployment without LLM access (or without MCP Sampling) can still pass CON-09 by running a contract that uses `literal` to inject inputs and `read_note`/`search_hybrid` to fetch shape.

- **CON-10 stub-parity test is the cleanest demonstration of "handle-based portability."** Same contract YAML, two source bindings (`obsidian-fs://...` vs `stub://test-fixture`), same output shape. This is what v3 multi-source will scale into Notion vs Obsidian: same contract, same output, different substrate. Phase 6 is the structural rehearsal.

- **`describe_contract` doubles as documentation.** Returns the contract's `description:` field + the JSON Schema for inputs + the assembly DAG + the output_shape. MCP Inspector users see this as the "what does this contract do?" panel. The reference contracts ship with rich descriptions so they serve as living examples.

- **The `audit_log` `kind: "contract_step"` rows are the V2.x baseline promotion signal.** When a peer-MCP verb (e.g., `mcp://github/list_issues`) hits high `invocation_count` across many vaults, that's the prioritization signal for promoting it into the baseline enum in v2.1+. The user explicitly called this out as a design rationale.

- **`vm_` prefix is reserved by vault-memory.** The prefix is user-configurable but the *default* `vm_` is a brand reservation. Contract authors and peer-MCP server authors should avoid emitting tools named `vm_*` themselves — that namespace is for vault-memory contract auto-registration.

- **Default-OFF `auto_register_tools` is the snapshot-test stability story.** CI runs against a fresh vault with no `[contracts.auto_register_tools]` override → `tools-list.snapshot.json` matches across machines. Power users opt-in per-vault; their deployments diverge from the snapshot intentionally.

- **Hot reload uses the same `ChangeFeed` as the indexer and Phase 5 daemon.** No separate watcher process. Three handlers fan out from one feed: indexer, brief staleness daemon, contract loader. Adding a fourth handler in Phase 7 (Canvas) follows the same pattern.

- **The `mcp://<server>/<tool>` syntax mirrors ADR-001 URI shape.** Identity is opaque, URI-style; routes through a registry; capability-gated. A peer-MCP verb is just another adapter-style identity — Phase 6 builds a tiny adapter layer on top of MCP Client SDK to make it feel native.

</specifics>

<deferred>
## Deferred Ideas

- **Macros / sub-contracts** (option 3 from Area 2's custom-tool extension question) — a "custom tool" as a named YAML composition over baseline verbs. The user picked peer-MCP instead. If real-world usage shows authors composing the same verb chain repeatedly, v2.x can add `verb: macro:<name>` resolving to a `_contracts/_macros/<name>.yaml` file. Out of v2.0.0.

- **In-process TypeScript plugins** (option 2 from Area 2's custom-tool question) — `_contracts/_tools/<name>.ts` loaded as JS modules. Rejected for v2 (security surface; not aligned with "data-not-code" YAML invariant). Probably out of v3 too.

- **Per-call LLM strategy override on `compile_brief` verb** — Phase 5 deferred. Phase 6 inherits the same deferral. If a contract author wants to pin an LLM strategy, set `[brief.ollama]` per vault or use the `literal` escape-hatch with pre-computed text.

- **MCP Prompts surface** (option 3 from Area 1's MCP surface question) — rejected because ChatGPT Custom Connector doesn't consume MCP Prompts at all (kills CON-09). If a v3 client ecosystem emerges that uses Prompts heavily, revisit.

- **Cross-vault contracts** — a contract in vault A reading sources in vault B. Out of v2.0.0; single-vault default. Revisit when Phase 10 Notion connector lands (a contract spanning Notion + Obsidian sources is a natural v3 use case).

- **Per-step retries / circuit breakers** — peer-MCP verb failures get a single attempt + structured error. No retry loop in v2. If peer MCP latency is a real problem, v2.x can add `step_retries: <n>` per-step config.

- **`audit_log` retention policy for `contract_step` rows** — same as existing Phase 2 default. If a popular contract balloons audit_log, future migration can add a TTL or rollup. Out of v2.0.0.

- **`tools-list.snapshot.json` per-vault variants** — when `auto_register_tools: true` is set, the snapshot diverges per vault. v2.0.0 documents this as expected; tests run against the default-OFF snapshot. v2.x may add a `--snapshot-include-contracts` CLI flag if maintainers need per-vault baselines.

- **LLM-generated contract summaries in `list_contracts`** — `describe_contract` already returns the contract's `description:` field. `list_contracts` could ship a one-line LLM summary if real UX demands it. v2.x territory.

- **Contract versioning / migration** — `version:` field is in the schema (CON-01) but v2.0.0 only supports `version: 1`. If we change schema in v2.x, a `version: 2` clause + migration path lands then.

- **GraphQL-style query language for assembly** — instead of `assembly:` step lists, declare a typed query that the runtime plans. Far out of v2.0.0; "do the simplest thing that works" wins.

- **Contract composition (one contract calling another)** — `verb: contract:<name>` to chain contracts. Open question whether this is needed; macros (above) cover the common case. Out of v2.0.0.

- **Phase 6 ADR 006 covers ONLY contract semantics, not peer-MCP client config schema.** The `[contracts.mcp_clients]` section schema is documented in `src/config/loader.ts` AppConfigSchema + the README peer-MCP setup guide; a future ADR may formalize peer-MCP discovery/auth if v3 multi-source needs it.

</deferred>

---

*Phase: 06-task-contract-dsl*
*Context gathered: 2026-05-18*
