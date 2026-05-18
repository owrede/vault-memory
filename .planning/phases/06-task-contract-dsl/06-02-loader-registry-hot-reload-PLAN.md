---
phase: 06-task-contract-dsl
plan: 02
type: execute
wave: 2
depends_on:
  - 06-01
files_modified:
  - src/contracts/loader.ts
  - src/contracts/loader.test.ts
  - src/contracts/auto-register.ts
  - src/contracts/auto-register.test.ts
  - src/contracts/index.ts
  - src/tool-registry.ts
  - src/server.ts
  - evals/v1-baseline/tools-list.snapshot.json
autonomous: true
requirements:
  - CON-01
  - CON-02
  - CON-04
  - CON-11
user_setup: []

must_haves:
  truths:
    - "`startContractRegistry({vault, feed, source, config, server, onRegistryChange?})` boots a ContractRegistry by scanning ONLY top-level `_contracts/*.yaml` (regex `CONTRACT_PATH_REGEX` from Plan 06-01 — Pitfall F3 non-recursion; `_contracts/memory/*.yaml` is invisible to the task-contract loader by design)."
    - "Boot scan reads contracts via `SourceConnector.listDocuments({pathPrefix: '_contracts/'})` and `SourceConnector.readDocument(handle)` — NEVER via `fs`/`path.join`/`chokidar` (adapter-seam discipline; ADR-002 I-1; lint-adapters enforces)."
    - "YAML round-trip preservation (CON-01): the parsed `Document` shape (.toJS() of `parseDocument`) feeds Zod ContractFileSchema; comments survive a round-trip when (later in Phase 7) Canvas authoring round-trips a contract — Plan 06-02 verifies the LOAD half via Test 1 below (parseDocument → toJS → ContractFileSchema → ParsedContract → assert input contract's text round-trips byte-equivalent via parseDocument(text).toString())."
    - "Each contract loaded: (a) Zod-validated via ContractFileSchema, (b) inputs resolved via `resolveRefs` + `buildInputSchema` to produce a cached `inputZodSchema` + `inputJsonSchema` on the ParsedContract, (c) `registry.set(name, parsed)` invoked — duplicate-name returns structured error + writes `contract_audit` `kind: 'contract_load_error'` (D-A1c first-wins)."
    - "ChangeFeed subscription registers a THIRD handler on the per-vault `ObsidianFsChangeFeed` (alongside indexer from Phase 1 + brief staleness daemon from Phase 5 — three concurrent subscribers per RESEARCH §A5 verified). Subscription returns a `Disposable` chained into the server shutdown sequence."
    - "ChangeFeed handler filters events by `CONTRACT_PATH_REGEX.test(event.id)`. Events outside `_contracts/<single>.yaml` are NO-OPs (Pitfall F3). Recognized events: `create`/`update` → re-parse + re-validate + `registry.set` (or `registry.delete + set` for update); `delete` → `registry.delete`; `rename` → handled as delete-then-create per Phase 1 obsidian-fs semantics."
    - "Parse failure during ChangeFeed handler does NOT mutate the registry (graceful degradation per D-LOAD — keep prior version) and writes `contract_audit` `kind: 'contract_load_error'` with the file path + error message. Idempotency per Pitfall F5: boot scan + ChangeFeed `create` for the same file BOTH write attempt rows, but `registry.set` returns `duplicate_name` on the second attempt (NO-OP, which is the desired behavior)."
    - "When `auto_register_tools: true` is set in the vault config, every registry mutation (boot scan completion, ChangeFeed event success) triggers `syncAutoRegistered(server, registry, prefix)` which: (a) diffs desired vs. currently-registered, (b) calls `server.registerTool(...)` for adds with `inputSchema: parsed.inputZodSchema`, (c) calls `RegisteredTool.remove()` for deletes, (d) calls `server.sendToolListChanged()` exactly once at the end. When `auto_register_tools: false` (the default), `syncAutoRegistered` is a NO-OP."
    - "`register_contracts_as_tools({vault?})` is a registered MCP Tool ALWAYS callable regardless of `auto_register_tools` config (D-A1 explicit-control escape valve). On call: scans the registry for the targeted vault(s), runs `syncAutoRegistered`, returns `{ok: true, registered: [<toolName>...], unregistered: [<toolName>...]}`."
    - "`src/server.ts` boot sequence wires `startContractRegistry` AFTER `MemorySinkRegistry` (Phase 2) and AFTER the brief staleness daemon (Phase 5) for each vault. The returned `Disposable` is registered in the shutdown sequence (graceful close on SIGTERM/SIGINT)."
    - "Tool surface lifts 34 → 35 (one new tool: `register_contracts_as_tools`). `evals/v1-baseline/tools-list.snapshot.json` regenerated additively. Default-OFF `auto_register_tools` keeps the snapshot stable across vaults (no `vm_*` tools appear in CI per RESEARCH §F7 — A10 noted)."
    - "All 1346+ existing tests + Plan 06-01 tests stay green; new tests for loader + auto-register green."
  artifacts:
    - path: "src/contracts/loader.ts"
      provides: "startContractRegistry(opts) — boot scan + ChangeFeed subscriber; returns Disposable; uses CONTRACT_PATH_REGEX (Pitfall F3); writes contract_load_error rows on parse failure (graceful degradation per D-LOAD)"
      contains: "startContractRegistry"
    - path: "src/contracts/auto-register.ts"
      provides: "syncAutoRegistered(server, registry, prefix) — diff-based add/remove + sendToolListChanged exactly once per mutation cycle (D-A1)"
      contains: "syncAutoRegistered"
    - path: "src/tool-registry.ts"
      provides: "register_contracts_as_tools tool entry (always available, regardless of auto_register_tools config) — explicit-control escape valve"
      contains: "register_contracts_as_tools"
    - path: "src/server.ts"
      provides: "Bootstrap wiring — startContractRegistry per vault after Phase 2/Phase 5 daemons; Disposable in shutdown sequence; register_contracts_as_tools handler dispatch"
      contains: "startContractRegistry"
    - path: "evals/v1-baseline/tools-list.snapshot.json"
      provides: "+1 entry: register_contracts_as_tools (additive; describe_contract + instantiate_contract land in Plan 06-03)"
      contains: "register_contracts_as_tools"
  key_links:
    - from: "src/server.ts"
      to: "src/contracts/loader.ts"
      via: "startContractRegistry({vault, feed, source, config, server, onRegistryChange}) per vault at boot"
      pattern: "startContractRegistry"
    - from: "src/contracts/loader.ts"
      to: "src/adapters/source/types.ts"
      via: "SourceConnector.listDocuments + readDocument (no fs)"
      pattern: "listDocuments"
    - from: "src/contracts/loader.ts"
      to: "src/adapters/change-feed/types.ts"
      via: "feed.subscribe(handler) — third concurrent subscriber"
      pattern: "feed.subscribe"
    - from: "src/contracts/loader.ts"
      to: "src/contracts/registry.ts"
      via: "registry.set / delete on event"
      pattern: "registry\\.(set|delete)"
    - from: "src/contracts/auto-register.ts"
      to: "@modelcontextprotocol/sdk"
      via: "server.registerTool(..., {inputSchema: parsed.inputZodSchema}) + RegisteredTool.remove() + server.sendToolListChanged()"
      pattern: "sendToolListChanged"
    - from: "src/contracts/loader.ts"
      to: "src/contracts/auto-register.ts"
      via: "onRegistryChange callback invokes syncAutoRegistered when auto_register_tools=true"
      pattern: "syncAutoRegistered"
---

<objective>
Loader slice. Wire the ContractRegistry from Plan 06-01 into the running server: boot scan + ChangeFeed hot-reload subscription (D-LOAD), automatic dynamic MCP Tool registration when `auto_register_tools: true` (D-A1 + Pattern 4), and the always-callable `register_contracts_as_tools` escape-valve tool. This is the slice that makes contracts discoverable — at the end of it, an MCP client running `tools/list` against a vault with `auto_register_tools: true` sees `vm_meeting_prep`, `vm_project_status`, etc., even though `describe_contract` and `instantiate_contract` (the verbs that actually USE them) don't ship until Plan 06-03.

Purpose: CON-01 (round-trip half — verify `parseDocument` + `toJS` + Zod validation of the YAML contract shape, comments preserved on a round-trip pass), CON-02 (Documents in `_contracts/` namespace — Pitfall F3 non-recursion enforced), CON-04 (the eventual `list_contracts` MCP Resource depends on the registry being populated; the Resource itself ships in Plan 06-04), CON-11 (ADR-006 §Decision 1 dual MCP surface + §Decision 8 hot reload, materialized).

Output: `src/contracts/loader.ts` + `auto-register.ts` shipped + tested, `src/tool-registry.ts` gains one entry, `src/server.ts` boot sequence extended, `evals/v1-baseline/tools-list.snapshot.json` regenerated additively (34 → 35), 1346+-test floor holds.
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
@docs/v2/adr/002-adapter-seams.md
@docs/v2/adr/006-task-contract-dsl.md
@src/types.ts
@src/server.ts
@src/tool-registry.ts
@src/brief/daemon.ts
@src/brief/resources.ts
@src/adapters/source/types.ts
@src/adapters/change-feed/types.ts
@src/contracts/index.ts
@src/contracts/types.ts
@src/contracts/registry.ts
@src/contracts/schema.ts
@src/contracts/input-schema.ts
@src/contracts/json-schema-ref.ts
@src/contracts/slug.ts
@src/contracts/audit.ts
@src/config/loader.ts

<interfaces>
<!-- Canonical contracts the executor must follow. Do not explore the codebase beyond these. -->

From `src/adapters/source/types.ts` — `SourceConnector` interface. The two methods Plan 06-02 calls:
- `listDocuments({pathPrefix?: string, ...}) → AsyncIterable<DocumentHandle>` — boot scan filters with `pathPrefix: '_contracts/'` then runs `CONTRACT_PATH_REGEX.test(handle.relativePath)` to exclude `_contracts/memory/*.yaml` and `_contracts/<sub>/<sub>/*.yaml`.
- `readDocument(handle) → Promise<{text: string, mtime: number, ...}>` — returns raw YAML text; loader passes to `parseDocument(text).toJS()` then to ContractFileSchema.

From `src/adapters/change-feed/types.ts` — `ChangeFeed.subscribe(handler) → Disposable`. The handler receives `ChangeEvent { kind: 'create'|'update'|'delete'|'rename', id: <relative-path>, ... }`. Plan 06-02's handler filters by `CONTRACT_PATH_REGEX.test(event.id)`.

From `src/brief/daemon.ts` (Phase 5) — established Disposable / subscription pattern. Plan 06-02 mirrors the structure: an `async function startContractRegistry(opts): Promise<Disposable>` that does boot work then returns a Disposable wrapping `sub.dispose()`.

From `src/brief/resources.ts` (Phase 5) — established MCP Resource registration pattern (used by Plan 06-04 for `list_contracts`/`list_contract_verbs`; Plan 06-02 doesn't ship Resources).

From `src/tool-registry.ts` — Phase 1 plan 01-05 design note: `getZodSchemaObject` REJECTS raw JSON Schema; tools must hand a Zod schema (Plan 06-01 `buildInputSchema` returns the right shape; auto-register passes `parsed.inputZodSchema` directly). For the static `register_contracts_as_tools` tool, the input schema is a small hand-written Zod object: `{vault: z.string().optional()}`.

From `@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:102, 153, 206`:
- `McpServer.registerTool(name, config, callback) → RegisteredTool` — returns a handle.
- `RegisteredTool.remove(): void` — dynamic removal (SDK 1.29 documented).
- `McpServer.sendToolListChanged(): void` — sync notification (NOT the lower-level `server.notification('notifications/tools/list_changed')` CONTEXT.md mentioned).

From `src/contracts/types.ts` (Plan 06-01) — `CONTRACT_PATH_REGEX = /^_contracts\/[^/]+\.yaml$/`. ParsedContract has cached `inputZodSchema` + `inputJsonSchema`. The 11-reason InstantiateError union exists; loader only uses `unknown_contract` and the internal `RegistrySetResult` from `registry.ts` (`duplicate_name`).

From `src/contracts/audit.ts` (Plan 06-01) — `recordContractLoadError(deps, {file, error_message, vault})` is the only audit call Plan 06-02 makes. Plan 06-03 adds `recordContractStep` calls during instantiation.

From RESEARCH.md §Pattern 1 (lines 268-296) — the canonical `startContractRegistry` skeleton:
```typescript
export async function startContractRegistry(opts: {
  vault: Vault;
  feed: ChangeFeed;
  source: SourceConnector;
  config: ContractsConfig;
  server: McpServer;             // for syncAutoRegistered + Tool registration
  onRegistryChange?: () => void; // optional hook (e.g., for tests)
}): Promise<{ registry: ContractRegistry; dispose: () => void }> { ... }
```

From RESEARCH.md §Pattern 4 (lines 386-405) — the canonical `syncAutoRegistered` skeleton. The `Map<string, RegisteredTool>` lives in module scope and is keyed by `toolName` (post-prefix). Important: this Map is per-vault; either (a) make it a property of the per-vault loader state, or (b) namespace keys as `<vault>:<toolName>`. Plan 06-02 chooses (a) — `syncAutoRegistered` takes the registered Map as a parameter so each `startContractRegistry` instance owns its own.

From RESEARCH.md §Pitfall F3 — boot scan and ChangeFeed dispatch BOTH filter by `CONTRACT_PATH_REGEX`. Phase 2 `MemoryContract` loader scans `_contracts/memory/*.yaml` independently; Plan 06-02 must not interfere.

From RESEARCH.md §Pitfall F5 — ChangeFeed semantics: chokidar emits `add` for every existing file on initial scan unless `ignoreInitial: true`. Plan 06-02's `registry.set` returns `{ok:false, reason:'duplicate_name'}` on the second attempt → NO-OP. The `contract_audit` row dedup is desirable (latest error visible). Idempotency: parse + validate path is pure (no side effects beyond registry mutation + audit row).

From RESEARCH.md Assumption A10 — `tools/list_changed` notification is spec-compliant but real-client behavior varies (some clients cache). Default-OFF `auto_register_tools` means CI never exercises the path; CON-09 smoketest in Plan 06-04 manually calls `tools/list` post-registration to verify server-side correctness.

From `src/server.ts` (current state, post-Phase-5) — bootstrap sequence: `loadConfig → openVaults → MemorySinkRegistry (Phase 2) → ChangeFeed per vault (Phase 1) → VaultWatcher subscribes → BriefStalenessDaemon subscribes (Phase 5) → tools/resources registered → transport.connect()`. Plan 06-02 inserts `ContractRegistry subscribes (Phase 6)` AFTER BriefStalenessDaemon, BEFORE tools/resources registration. Each `Disposable` from `startContractRegistry(...)` is pushed to the existing shutdown array.

From `evals/v1-baseline/tools-list.snapshot.json` (34 entries verified) — Plan 06-02 regenerates additively for `register_contracts_as_tools` (+1). Plan 06-03 adds 2 more (`describe_contract`, `instantiate_contract`). Final Phase 6 snapshot: 37 entries (per RESEARCH §F7).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 6-02-01: startContractRegistry — boot scan + ChangeFeed subscription + graceful degradation</name>
  <files>src/contracts/loader.ts, src/contracts/loader.test.ts, src/contracts/index.ts</files>
  <behavior>
    - Test 1 (CON-01 round-trip via load path): Given a valid YAML contract text matching RESEARCH Example 1 (meeting-prep), `parseDocument(text).toJS()` feeds ContractFileSchema cleanly, the loader produces a ParsedContract with cached `inputZodSchema` (instanceof z.ZodObject) and `inputJsonSchema.additionalProperties === false`, AND `parseDocument(text).toString() === text` (byte-equivalent round-trip, comments preserved per RESEARCH §A1 / Example 1).
    - Test 2 (Pitfall F3 non-recursion): With a stub SourceConnector returning handles for `_contracts/meeting-prep.yaml` (valid) + `_contracts/memory/default-memory-v1.yaml` (Phase 2 MemoryContract file) + `_contracts/sub/nested.yaml`, ONLY `meeting-prep` is loaded into the registry. The other two are silently skipped (NOT a load error — they don't match `CONTRACT_PATH_REGEX`).
    - Test 3 (graceful degradation): Malformed YAML in `_contracts/bad.yaml` does NOT throw; loader writes a `contract_audit` `kind: 'contract_load_error'` row with `error_message` containing the parse error + file path; registry remains empty (no spurious entry); other valid contracts in the same scan still load.
    - Test 4 (Zod validation failure): A syntactically-valid YAML that violates ContractFileSchema (e.g., missing `assembly`) writes a `contract_load_error` row + skips registration.
    - Test 5 (duplicate-name first-wins): Two contracts both declaring `name: meeting-prep` (one at `_contracts/meeting-prep.yaml`, one at `_contracts/meeting-prep-2.yaml` whose YAML body has `name: meeting-prep`) — the first scanned wins; the second writes a `contract_load_error` row with `reason: duplicate_name`.
    - Test 6 (ChangeFeed `create` event): After boot scan completes with empty `_contracts/`, a stub ChangeFeed emits `{kind: 'create', id: '_contracts/foo.yaml'}` — loader fetches via `source.readDocument(handle)`, parses, registers; `registry.get('foo')` returns the parsed contract.
    - Test 7 (ChangeFeed `update` event): After a contract is loaded, emitting `{kind: 'update', id: '_contracts/foo.yaml'}` with new YAML content RE-PARSES and REPLACES via `registry.delete('foo') + registry.set('foo', newParsed)`.
    - Test 8 (ChangeFeed `delete` event): `{kind: 'delete', id: '_contracts/foo.yaml'}` calls `registry.delete('foo')`; subsequent `registry.get('foo')` returns undefined.
    - Test 9 (ChangeFeed `rename` event): Emitted as delete-then-create per Phase 1 obsidian-fs semantics; if Phase 1 emits a single `rename` event the loader handles it explicitly (delete old `id`, create new `id`). Test asserts the registry converges either way.
    - Test 10 (ChangeFeed parse failure on update): Existing contract loaded; ChangeFeed `update` with malformed YAML — registry KEEPS the prior version (graceful degradation per D-LOAD); writes `contract_load_error` row.
    - Test 11 (Pitfall F3 in ChangeFeed): `{kind: 'update', id: '_contracts/memory/default-memory-v1.yaml'}` is a NO-OP (no registry mutation, no audit row).
    - Test 12 (ChangeFeed events outside `_contracts/`): `{kind: 'update', id: 'notes/meeting.md'}` is a NO-OP.
    - Test 13 (Disposable lifecycle): The returned `dispose()` function unsubscribes the ChangeFeed handler; subsequent events do not mutate the registry.
    - Test 14 (Pitfall F5 idempotency): Calling `startContractRegistry` with a vault whose ChangeFeed emits an initial `create` for every existing file (chokidar `ignoreInitial: false` simulation) — the registry converges with no duplicate entries; `contract_audit` may contain duplicate `contract_load_error` rows on failed files (desirable per D-LOAD — latest error visible) but NO duplicate `set` operations succeed (registry's first-wins prevents).
    - Test 15 (onRegistryChange callback): If `opts.onRegistryChange` is provided, it fires AFTER every successful registry mutation (boot scan completion + each successful ChangeFeed event). NOT fired on parse failures.
    - Test 16: All 1346+ existing tests + Plan 06-01 tests stay green.
  </behavior>
  <action>
    Create `src/contracts/loader.ts` per RESEARCH §Pattern 1 (lines 268-296). The skeleton:

    ```typescript
    import { parseDocument } from "yaml";
    import { CONTRACT_PATH_REGEX, type ParsedContract } from "./types.js";
    import { ContractFileSchema } from "./schema.js";
    import { buildInputSchema } from "./input-schema.js";
    import { resolveRefs } from "./json-schema-ref.js";
    import { ContractRegistry } from "./registry.js";
    import { recordContractLoadError, type ContractAuditDeps } from "./audit.js";
    import type { Vault } from "../vault/index.js";
    import type { SourceConnector } from "../adapters/source/types.js";
    import type { ChangeFeed, ChangeEvent } from "../adapters/change-feed/types.js";

    export interface StartContractRegistryOpts {
      vault: Vault;
      feed: ChangeFeed;
      source: SourceConnector;
      auditDeps: ContractAuditDeps;
      onRegistryChange?: (event: "boot" | "create" | "update" | "delete") => void;
    }

    export interface StartedContractRegistry {
      registry: ContractRegistry;
      dispose: () => void;
    }

    export async function startContractRegistry(opts: StartContractRegistryOpts): Promise<StartedContractRegistry> {
      const registry = new ContractRegistry();
      await bootScan(opts, registry);
      opts.onRegistryChange?.("boot");
      const sub = opts.feed.subscribe(async (event: ChangeEvent) => {
        if (!CONTRACT_PATH_REGEX.test(event.id)) return;
        await handleChangeEvent(event, opts, registry);
      });
      return { registry, dispose: () => sub.dispose() };
    }
    ```

    Implement `bootScan(opts, registry)`:
    1. Iterate `opts.source.listDocuments({pathPrefix: '_contracts/'})`.
    2. For each handle, check `CONTRACT_PATH_REGEX.test(handle.relativePath)` — if false, skip (Pitfall F3).
    3. Read via `opts.source.readDocument(handle)` → text.
    4. `parseAndRegister(text, handle.relativePath, opts, registry)` — see below.

    Implement `parseAndRegister(text, file, opts, registry)`:
    1. Wrap in `try/catch`. On any throw, call `recordContractLoadError(opts.auditDeps, {file, error_message: String(err.message ?? err), vault: opts.vault.config.name})`.
    2. Inside try: `const doc = parseDocument(text); const raw = doc.toJS();`.
    3. `const validated = ContractFileSchema.safeParse(raw);` — on failure, throw `new Error(\`zod: \${JSON.stringify(validated.error.format())}\`)`.
    4. Build the cached schemas: `const {zodSchema, jsonSchema} = buildInputSchema(validated.data.inputs, validated.data.required);`. Resolve `output_shape` $refs too: `const outputShape = validated.data.output_shape ? resolveRefs(validated.data.output_shape) : undefined;`.
    5. Construct the ParsedContract object with all fields from `validated.data` plus the cached `inputZodSchema`, `inputJsonSchema`, and resolved `output_shape`.
    6. Call `registry.set(parsed.name, parsed)`. If `{ok:false, reason:'duplicate_name'}`, write `recordContractLoadError(...)` with `error_message: \`duplicate_name: '\${parsed.name}' already registered (first-wins per D-A1c)\``.

    Implement `handleChangeEvent(event, opts, registry)`:
    - `event.kind === 'delete'`: Look up the contract name from `event.id` is not directly possible (only the file path is known; the contract name is inside the YAML). Strategy: maintain a `fileToName: Map<string, string>` keyed by `event.id` populated by `bootScan` and `parseAndRegister`. On delete, look up the name; if known, `registry.delete(name)` + `opts.onRegistryChange?.('delete')`.
    - `event.kind === 'rename'`: Phase 1 emits this with `{id: newPath, oldId: oldPath, kind: 'rename'}` per `src/adapters/change-feed/types.ts`. Handle as: delete the old `name` (look up via `fileToName.get(event.oldId)`), then create the new (`parseAndRegister(text, event.id, opts, registry)`). If Phase 1 instead emits `delete` then `create` separately, the `create` branch covers it naturally.
    - `event.kind === 'create' | 'update'`: Read via `opts.source.readDocument(handle)` (synthesize handle from `event.id` per Phase 1's `ChangeEvent.id` semantics — should be a vault-relative path the source can consume). On `update`, if `fileToName.get(event.id)` is set, call `registry.delete(oldName)` first so re-registration can succeed (replace semantics). Then `parseAndRegister`.
    - Fire `opts.onRegistryChange?.(event.kind === 'rename' ? 'update' : event.kind)` on success.

    Implement the `fileToName: Map<string, string>` as a closure-local variable inside `startContractRegistry` shared by bootScan + handleChangeEvent.

    Export from `src/contracts/index.ts` barrel: `export { startContractRegistry, type StartContractRegistryOpts, type StartedContractRegistry } from "./loader.js";`.

    Co-locate `loader.test.ts` with the 16 Behavior cases. Use in-memory stubs:
    - `StubSourceConnector` returning a fixed `Map<relativePath, text>` for `listDocuments` + `readDocument`.
    - `StubChangeFeed` exposing an `emit(event)` method that fans out to the subscriber.
    - A `:memory:` SQLite DB + `db.migrate()` + `ContractAuditDeps = {contractAudit: db.contractAudit}`.

    For Test 1 (round-trip), use the verbatim YAML text from RESEARCH Example 1 (meeting-prep) including the `# top comment` header and inline `# comment` lines documented in §A1.

    Adapter-seam: `loader.ts` MUST NOT import `fs`, `path`, `gray-matter`, or `chokidar`. The only allowed file-touching import is `yaml` (`parseDocument` only) — which operates on already-read text, not on the FS. Run `bash scripts/lint-adapters.sh` to confirm.
  </action>
  <verify>
    <automated>npx vitest run src/contracts/loader.test.ts && npx tsc --noEmit && bash scripts/lint-adapters.sh && npm test</automated>
  </verify>
  <done>startContractRegistry green for all 16 cases; CON-01 round-trip verified on Example 1; Pitfall F3 non-recursion enforced; graceful degradation on parse + Zod failure; Disposable lifecycle clean; 1346+ existing tests + Plan 06-01 tests stay green; lint-adapters zero hits in src/contracts/.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 6-02-02: auto-register.ts — diff-based registerTool/remove + sendToolListChanged (D-A1, Pattern 4)</name>
  <files>src/contracts/auto-register.ts, src/contracts/auto-register.test.ts, src/contracts/index.ts</files>
  <behavior>
    - Test 1 (no-op when disabled): `syncAutoRegistered(server, registry, prefix, {enabled: false})` makes no `server.registerTool` calls and does NOT call `sendToolListChanged()` — early-return.
    - Test 2 (initial add): With `enabled: true`, an empty `registered` Map, and a registry containing `meeting-prep` + `project-status` and prefix `"vm_"` — calls `server.registerTool("vm_meeting_prep", {description, inputSchema: parsed.inputZodSchema, ...}, callback)` and `registerTool("vm_project_status", ...)`, populates the `registered` Map with both, and calls `server.sendToolListChanged()` EXACTLY ONCE at the end.
    - Test 3 (idempotent on no-op): Calling `syncAutoRegistered` twice in a row with the same registry state results in only one `sendToolListChanged()` call total (the second call's diff is empty; the implementation skips the notify when no diff occurred). Verified via spy on `server.sendToolListChanged`.
    - Test 4 (additive): Initial state has `vm_meeting_prep` registered; new registry adds `vm_project_status` — `syncAutoRegistered` calls `registerTool("vm_project_status", ...)` only (not re-registering `vm_meeting_prep`) and calls `sendToolListChanged()` once.
    - Test 5 (removal): Initial state has `vm_meeting_prep` + `vm_project_status` registered; new registry contains only `meeting-prep` — calls `registered.get("vm_project_status").remove()`, deletes from `registered`, calls `sendToolListChanged()` once.
    - Test 6 (mixed add + remove): Initial state has `vm_a` + `vm_b`; new registry contains `meeting-prep` + `b` — performs `remove("vm_a")` + `registerTool("vm_meeting_prep", ...)`; `vm_b` is untouched (handle preserved in the Map).
    - Test 7 (prefix override): Configured `tool_prefix: "x_"`, contracts `[meeting-prep, project-status]` — registers `x_meeting_prep`, `x_project_status`. Slug rule from Plan 06-01: `slugify(name, prefix)` returns `prefix + name.replace(/-/g, '_')`.
    - Test 8 (tool callback signature): The callback passed to `server.registerTool(...)` for an auto-registered contract is a thin shim that calls Plan 06-03's `instantiateContractHandler(parsed.name, args, deps)` — Plan 06-02 wires the shim with a deps object stubbed via `opts.instantiateHandler` (a function pointer the loader/server passes in). Test verifies the callback forwards args correctly. Plan 06-03 supplies the real handler; until then a `notYetImplemented` stub satisfies the type contract and Plan 06-04's smoketest exercises end-to-end.
    - Test 9 (mock server.registerTool returns a fake RegisteredTool with remove()): test exercises `.remove()` being called on the right handle on removal.
    - Test 10: All 1346+ tests + Plan 06-01 + Task 6-02-01 tests stay green.
  </behavior>
  <action>
    Create `src/contracts/auto-register.ts` per RESEARCH §Pattern 4 (lines 386-405):

    ```typescript
    import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
    import type { ContractRegistry } from "./registry.js";
    import type { ParsedContract } from "./types.js";
    import { slugify } from "./slug.js";

    export interface SyncAutoRegisteredOpts {
      enabled: boolean;
      instantiateHandler: (contractName: string, args: unknown) => Promise<unknown>;
    }

    /**
     * D-A1 dynamic tool list management. Maintains a per-loader `registered` Map that survives across calls.
     * Diff against the registry; call registerTool/remove as needed; call sendToolListChanged exactly once
     * per mutation cycle (only when at least one add or remove occurred).
     */
    export function syncAutoRegistered(
      server: McpServer,
      registry: ContractRegistry,
      prefix: string,
      registered: Map<string, RegisteredTool>,
      opts: SyncAutoRegisteredOpts,
    ): void {
      if (!opts.enabled) return;

      // Build the desired set: slug -> parsed.
      const desired = new Map<string, ParsedContract>();
      for (const [name, parsed] of registry.entries()) {
        desired.set(slugify(name, prefix), parsed);
      }

      let mutated = false;

      // Remove gone.
      for (const [toolName, regd] of Array.from(registered)) {
        if (!desired.has(toolName)) {
          regd.remove();
          registered.delete(toolName);
          mutated = true;
        }
      }

      // Add new.
      for (const [toolName, parsed] of desired) {
        if (registered.has(toolName)) continue;
        const regd = server.registerTool(
          toolName,
          {
            description: parsed.description,
            inputSchema: parsed.inputZodSchema,
          },
          async (args) => {
            const result = await opts.instantiateHandler(parsed.name, args);
            return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
          },
        );
        registered.set(toolName, regd);
        mutated = true;
      }

      if (mutated) server.sendToolListChanged();
    }
    ```

    Export from `src/contracts/index.ts` barrel: `export { syncAutoRegistered, type SyncAutoRegisteredOpts } from "./auto-register.js";`.

    Co-locate `auto-register.test.ts` with the 10 Behavior cases. Use minimal stubs:
    - `FakeMcpServer` with `registerTool(name, config, callback)` returning a `FakeRegisteredTool` with a spy-able `remove()`.
    - `sendToolListChanged()` is a spy.
    - `instantiateHandler` is `async () => ({ok: true, stub: true})` until Plan 06-03 supplies the real one.

    Adapter-seam: no `fs`/`path`/`yaml`/`chokidar` imports. SDK + Plan 06-01 modules only.
  </action>
  <verify>
    <automated>npx vitest run src/contracts/auto-register.test.ts && npx tsc --noEmit && bash scripts/lint-adapters.sh</automated>
  </verify>
  <done>syncAutoRegistered green for all 10 cases; diff-based add/remove + sendToolListChanged exactly once per mutation cycle; no-op when disabled; 1346+ existing tests + Plan 06-01 + Task 6-02-01 tests stay green; lint-adapters zero hits.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 6-02-03: register_contracts_as_tools MCP Tool + server bootstrap wiring + snapshot regen</name>
  <files>src/tool-registry.ts, src/server.ts, src/contracts/auto-register.test.ts, evals/v1-baseline/tools-list.snapshot.json</files>
  <behavior>
    - Test 1 (tool-registry entry): `register_contracts_as_tools` appears in the TOOLS array exported from `src/tool-registry.ts` with `inputSchema: z.object({vault: z.string().optional()})` and a description citing D-A1 ("Explicit-control escape valve — scans contracts and updates the dynamic tool registry regardless of auto_register_tools config").
    - Test 2 (always-callable): The tool is registered on every `vault-memory serve` start, regardless of any vault's `auto_register_tools` config value. Verified via the `tools/list` snapshot containing the entry post-Phase-6.
    - Test 3 (handler dispatch — single vault): Calling `register_contracts_as_tools({vault: "my-vault"})` invokes `syncAutoRegistered` with `enabled: true` (FORCED true for the explicit call, regardless of config) against the named vault's registry; returns `{ok: true, vault: "my-vault", registered: ["vm_meeting_prep", ...], unregistered: [...]}`.
    - Test 4 (handler dispatch — all vaults): Calling `register_contracts_as_tools({})` (no vault arg) loops over all vaults; returns `{ok: true, vaults: [{vault, registered, unregistered}, ...]}`.
    - Test 5 (unknown vault): `register_contracts_as_tools({vault: "nonexistent"})` returns `{ok: false, reason: "unknown_vault", vault: "nonexistent"}` — does NOT throw.
    - Test 6 (boot wiring): After `serve()` initialization on a fixture vault with `_contracts/` populated, every vault has its own `StartedContractRegistry`; the array of `Disposable`s is registered for SIGTERM/SIGINT shutdown (mirrors `VaultWatcher.stop()` pattern from Phase 1).
    - Test 7 (snapshot diff): `evals/v1-baseline/tools-list.snapshot.json` increases by exactly 1 entry — the `register_contracts_as_tools` tool — keeping all 34 prior entries byte-identical (`compile_brief`, `get_brief`, all 23 v1 tools, all Phase 3 + Phase 4 tools unchanged).
    - Test 8: With `auto_register_tools: false` in a vault config containing 3 contracts in `_contracts/*.yaml`, `tools/list` does NOT include any `vm_*` entries (default-OFF stability per RESEARCH §F7).
    - Test 9: With `auto_register_tools: true` in the SAME vault config + same 3 contracts, calling `tools/list` AFTER server start lists the 3 `vm_*` tools plus the 35 base tools (38 total in that test scenario; not the snapshot test — see Test 10).
    - Test 10 (snapshot stability across deployments): The snapshot test that compares `evals/v1-baseline/tools-list.snapshot.json` to runtime `tools/list` runs against a vault with `auto_register_tools: false` (or no `[contracts]` block at all) so `vm_*` tools don't appear in the snapshot. CI passes deterministically. This is the snapshot-stability story per CONTEXT.md Specifics + RESEARCH §F7.
    - Test 11: All 1346+ existing tests + Plan 06-01 + Tasks 6-02-01/02 tests stay green; the snapshot test now compares to the regenerated file (35 entries).
  </behavior>
  <action>
    Extend `src/tool-registry.ts` per the existing TOOLS array shape (read `src/tool-registry.ts` first to identify the exact registration pattern Phase 5 used for `compile_brief` + `get_brief`). Add ONE entry:

    ```typescript
    {
      name: "register_contracts_as_tools",
      description: "Explicit-control escape valve — scans the contract registry and updates the dynamic MCP tool list (registers new contracts as vm_<name> tools, unregisters removed ones) regardless of [contracts.auto_register_tools] config. Always callable. Returns a per-vault diff of {registered, unregistered}.",
      inputSchema: z.object({
        vault: z.string().optional().describe("Vault name; omit to apply to all vaults"),
      }),
      // handler signature follows existing TOOLS array convention; see e.g. compile_brief entry
    },
    ```

    Implement the handler in `src/server.ts` (or wherever TOOLS handlers live — match the Phase 5 placement):

    ```typescript
    async function handleRegisterContractsAsTools(deps, args) {
      const { vault } = args;
      const targetVaults = vault ? [vault] : Array.from(deps.vaultManager.vaults.keys());
      const results = [];
      for (const vname of targetVaults) {
        const v = deps.vaultManager.vaults.get(vname);
        if (!v) {
          if (vault) return { ok: false, reason: "unknown_vault", vault: vname };
          continue; // silently skip unknown in fan-out
        }
        const started = deps.contractRegistries.get(vname);  // populated at boot
        if (!started) continue;
        const before = new Set(started.registered.keys());
        syncAutoRegistered(
          deps.server,
          started.registry,
          v.config.contracts?.tool_prefix ?? "vm_",
          started.registered,
          { enabled: true, instantiateHandler: deps.instantiateHandler },  // FORCED true for explicit call
        );
        const after = new Set(started.registered.keys());
        results.push({
          vault: vname,
          registered: Array.from(after).filter(n => !before.has(n)),
          unregistered: Array.from(before).filter(n => !after.has(n)),
        });
      }
      return vault ? { ok: true, ...results[0] } : { ok: true, vaults: results };
    }
    ```

    Boot wiring in `src/server.ts` — after MemorySinkRegistry + BriefStalenessDaemon, before tools/resources registration:

    ```typescript
    const contractRegistries = new Map<string, StartedContractRegistry & { registered: Map<string, RegisteredTool> }>();
    for (const [vname, vault] of vaultManager.vaults) {
      const feed = changeFeeds.get(vname)!;
      const source = sourceConnectors.get(vname)!;
      const registered = new Map<string, RegisteredTool>();
      const started = await startContractRegistry({
        vault,
        feed,
        source,
        auditDeps: { contractAudit: vault.db.contractAudit },
        onRegistryChange: () => {
          // Re-run auto-register on every registry mutation when the config gate is ON.
          const cfg = vault.config.contracts;
          if (cfg?.auto_register_tools) {
            syncAutoRegistered(
              server,
              started.registry,
              cfg.tool_prefix ?? "vm_",
              registered,
              { enabled: true, instantiateHandler },
            );
          }
        },
      });
      contractRegistries.set(vname, { ...started, registered });
      // After boot scan completes, do an initial sync if auto-register is ON.
      const cfg = vault.config.contracts;
      if (cfg?.auto_register_tools) {
        syncAutoRegistered(server, started.registry, cfg.tool_prefix ?? "vm_", registered, { enabled: true, instantiateHandler });
      }
      // Register Disposable for shutdown.
      shutdownDisposables.push(started);
    }
    ```

    The `instantiateHandler` variable is a forward reference to Plan 06-03's `instantiate_contract` handler. For Plan 06-02, define a temporary stub:
    ```typescript
    const instantiateHandler = async (name: string, args: unknown) => {
      return { ok: false, reason: "not_yet_implemented", note: "instantiate_contract lands in Plan 06-03" };
    };
    ```
    Plan 06-03 swaps this stub for the real handler in its first task. The stub's existence keeps Plan 06-02's tests green (it's only invoked when an auto-registered `vm_*` tool is CALLED, not when it's registered — registration is what Plan 06-02 ships).

    Regenerate `evals/v1-baseline/tools-list.snapshot.json`:
    1. Identify the regen script (likely `npm run gen:snapshot` or similar — check `package.json` scripts).
    2. Run it against a vault with `auto_register_tools: false` (default).
    3. Verify the diff is EXACTLY +1 entry: `register_contracts_as_tools`. The 34 existing entries must be byte-identical.
    4. If the regen script doesn't exist, manually edit the JSON to add the entry in correct sort order; assert the only diff is the addition.

    Add tests to `src/contracts/auto-register.test.ts` (or a new `src/contracts/server-wiring.test.ts` — pick the location closer to other server-wiring tests in the codebase) covering Behavior cases 3-9. The snapshot test (Test 7) is whatever existing test runs `tools/list` against the snapshot file — verify it passes after the regen.

    Adapter-seam: `src/server.ts` is allowed `fs`/`path` (it's a top-level entry point per existing exemptions); `src/contracts/auto-register.ts` and `src/contracts/loader.ts` are NOT. Run `bash scripts/lint-adapters.sh` to confirm.
  </action>
  <verify>
    <automated>npx vitest run src/contracts/ && npm test && bash scripts/lint-adapters.sh && diff <(jq -S '.' evals/v1-baseline/tools-list.snapshot.json) <(jq -S '.' evals/v1-baseline/tools-list.snapshot.json) >/dev/null</automated>
  </verify>
  <done>register_contracts_as_tools registered + handler dispatched correctly; src/server.ts boot sequence wires ContractRegistry per vault with shutdown Disposable; snapshot regenerated additively (+1 entry); default-OFF auto_register_tools keeps snapshot stable; 1346+ existing tests + Plan 06-01 + Tasks 6-02-01/02 tests stay green; lint-adapters zero hits in src/contracts/.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| ChangeFeed handler → ContractRegistry | All registry mutations gated by `CONTRACT_PATH_REGEX.test(event.id)` (Pitfall F3); parse failures don't mutate (graceful degradation per D-LOAD). |
| Parsed contract → MCP Tool registration | Auto-register is per-vault config gated (D-A1b default OFF); `tool_prefix` Zod-validated non-empty (A7); slug collision = first-wins (D-A1c). |
| Boot scan → SourceConnector | All reads via `listDocuments` + `readDocument` — no direct FS access (ADR-002 I-1 invariant). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-06-02-01 | Tampering | A malicious contract author edits `_contracts/foo.yaml` to register a tool named `vm_compile_brief` overwriting Phase 5's tool | mitigate | (a) `tool_prefix` namespace `vm_*` is reserved for contracts (RESEARCH §Specifics — brand reservation); (b) `slugify("compile-brief", "vm_") = "vm_compile_brief"` collides with no v1/v2 tool (no existing tool starts with `vm_`); (c) if user sets `tool_prefix = ""`, A7 rejects empty string — but if they set `tool_prefix = "search_"` they could collide with `search_hybrid`. Document in ADR-006 §Threat Model: contract authors are trusted at the same level as user notes; collision via custom prefix is a user-configuration risk, not a privilege-escalation risk. Test 7 (custom prefix) demonstrates the mechanic. |
| T-06-02-02 | Denial of Service | A vault with 10,000 contracts in `_contracts/*.yaml` blocks server boot during scan | accept | Boot scan is O(N) over YAML files with `yaml@2.9` parse cost. Practical N is small (< 100 — contracts are user-authored). If N grows large in v2.x, can parallelize boot scan via `Promise.all` over `readDocument`. Out of v2.0.0 scope. |
| T-06-02-03 | Tampering | ChangeFeed fires `update` events faster than the loader can parse | accept | ChangeFeed emits events into Node's event loop; parsing happens synchronously per event in handler. Concurrent events queue naturally. Worst case: bursty edits = brief inconsistency in `registry` between events. The `auto_register_tools` notification fires per successful event, so clients see the converged state within one event-loop tick. |
| T-06-02-04 | Information Disclosure | Auto-registered tool descriptions leak sensitive vault content into `tools/list` response | accept | Contract `description` field is user-authored (in `_contracts/<name>.yaml`); same trust level as user notes. Document in ADR-006: contract descriptions surface to ALL connected MCP clients via `tools/list` — author accordingly. |
| T-06-02-SC | Tampering | npm install of new dependencies | N/A | Zero net-new runtime deps in Plan 06-02 (`yaml`, `zod`, MCP SDK all pre-installed). No supply-chain checkpoint. |
</threat_model>

<verification>
**Acceptance:**
- `npm test` — 1346+ existing tests + Plan 06-01 + Plan 06-02 tests all green.
- `npx tsc --noEmit` — clean.
- `bash scripts/lint-adapters.sh` — zero hits inside `src/contracts/` (no `fs`/`path.join`/`gray-matter`/`chokidar` imports outside `src/server.ts`).
- `npm run eval:baseline` — v1-baseline byte-identical for the 23 v1 tools; the additive `register_contracts_as_tools` entry does NOT change any existing tool's response shape.
- `evals/v1-baseline/tools-list.snapshot.json` — 35 entries (34 prior + 1 new); diff against pre-Phase-6 shows exactly one added entry.

**Eval queries:** none new in this slice; eval YAMLs land in Plan 06-04.

**Manual verification:**
1. Start `vault-memory serve` against a fixture vault with `_contracts/meeting-prep.yaml` populated (use the Example 1 YAML from RESEARCH for now).
2. Issue MCP `tools/list` from MCP Inspector or `scripts/smoketest-non-claude.mjs`. Verify `register_contracts_as_tools` is present; verify `vm_meeting_prep` is NOT present (default-OFF).
3. Edit `~/.vault-memory/config.toml`: add `[contracts]\nauto_register_tools = true` for that vault. Restart server.
4. Re-issue `tools/list`. Verify `vm_meeting_prep` is now present.
5. Call `register_contracts_as_tools({vault: "<vault-name>"})` from a non-Claude client to confirm explicit-control path works.
6. Touch `_contracts/meeting-prep.yaml` (e.g., add a comment); verify ChangeFeed picks up the update via `audit_log` queries (no `contract_load_error` row).
7. Add `_contracts/bad.yaml` with malformed YAML; verify `audit_log` contains a `contract_load_error` row; verify `vm_meeting_prep` still works (graceful degradation per D-LOAD).
</verification>

<success_criteria>
1. `startContractRegistry({vault, feed, source, auditDeps, onRegistryChange?})` ships in `src/contracts/loader.ts`; boot scan + ChangeFeed subscription per D-LOAD; CON-01 round-trip verified on Example 1; Pitfall F3 non-recursion enforced; graceful degradation on parse + Zod failure.
2. `syncAutoRegistered(server, registry, prefix, registered, opts)` ships in `src/contracts/auto-register.ts`; diff-based add/remove; `sendToolListChanged()` exactly once per mutation cycle; no-op when `enabled: false`.
3. `register_contracts_as_tools({vault?})` MCP Tool registered in `src/tool-registry.ts`; handler always callable regardless of config (D-A1 explicit-control escape valve).
4. `src/server.ts` boot sequence wires `ContractRegistry` per vault AFTER `MemorySinkRegistry` + `BriefStalenessDaemon`; Disposables registered for shutdown.
5. `evals/v1-baseline/tools-list.snapshot.json` regenerated additively (34 → 35); default-OFF `auto_register_tools` keeps snapshot stable across deployments.
6. `npm test` + `npx tsc --noEmit` + `bash scripts/lint-adapters.sh` + `npm run eval:baseline` all green.
7. CON-01 (round-trip half) + CON-02 (Documents in `_contracts/` namespace) + CON-04 (registry populated; Resource ships in Plan 06-04) + CON-11 (ADR §Decision 1 + §Decision 8 materialized) all green.

**After this slice, agents can:** see contracts auto-registered as `vm_*` MCP Tools (when `auto_register_tools: true`); manually trigger registration via `register_contracts_as_tools`; observe hot-reload as `_contracts/*.yaml` files change. **But they cannot yet INVOKE a contract** — `describe_contract` and `instantiate_contract` land in Plan 06-03.
</success_criteria>

<commit>
Atomic commit messages (one per task, or one batch commit at slice end):

```
feat(06-02): startContractRegistry — boot scan + ChangeFeed hot reload (D-LOAD)

- src/contracts/loader.ts — scans only top-level _contracts/*.yaml
  (Pitfall F3 non-recursion); parseDocument + Zod ContractFileSchema;
  buildInputSchema caches inputZodSchema + inputJsonSchema on ParsedContract.
- ChangeFeed third subscriber (alongside indexer + brief daemon); graceful
  degradation on parse failure (keep prior registry version + write
  contract_load_error audit row).
- fileToName map closure preserves identity across rename/delete events.
- Disposable lifecycle clean.

Refs: CON-01 (round-trip half), CON-02, D-LOAD, Pitfall F3, Pitfall F5
```

```
feat(06-02): syncAutoRegistered — dynamic MCP tool list (D-A1, Pattern 4)

- src/contracts/auto-register.ts — diff-based registerTool/remove;
  sendToolListChanged exactly once per mutation cycle; no-op when disabled.
- Per-loader `registered` Map preserves RegisteredTool handles for remove().
- Slug rule: slugify(name, prefix) (Plan 06-01); A7 enforced tool_prefix
  non-empty.

Refs: D-A1, Pattern 4
```

```
feat(06-02): register_contracts_as_tools tool + server bootstrap wiring (+1 tool)

- src/tool-registry.ts — register_contracts_as_tools entry (always callable).
- src/server.ts — startContractRegistry per vault after Phase 2/Phase 5
  daemons; Disposable registered for SIGTERM/SIGINT shutdown.
- Stub instantiateHandler (Plan 06-03 supplies the real one).
- evals/v1-baseline/tools-list.snapshot.json regenerated additively:
  34 → 35 entries; default-OFF auto_register_tools keeps snapshot stable.

Refs: D-A1 escape valve, CON-04 (registry populated), F7 (tool count 34→35)
```
</commit>

<output>
Create `.planning/phases/06-task-contract-dsl/06-02-SUMMARY.md` when done.
</output>
