---
phase: 02-memory-namespace-provenance-contract
plan: 03b
type: execute
wave: 1
depends_on: [02-02, 02-03]
files_modified:
  - src/write/write.ts
  - src/frontmatter/update.ts
  - src/server.ts
  - src/server.test.ts
autonomous: true
requirements:
  - MEM-07
  - MEM-11
must_haves:
  truths:
    - "v1 `write_note` against a memory-sink-resolved path returns `{ok:false, reason:\"sink_write_blocked\", sinkName, suggestion: \"use record_observation for sink '<name>'\"}` BEFORE the delivery layer is called"
    - "v1 `update_frontmatter` and `delete_note` apply the same `sink_write_blocked` refusal with operation-appropriate `suggestion` text"
    - "Server bootstrap order: `loadConfig → manager.openAll → registry.registerMemorySinks (writes sentinels) → catchupVault (fire-and-forget) → server.connect` — sentinels exist BEFORE catchup walks any vault"
    - "The `MemorySinkRegistry` instance is constructed once at bootstrap and threaded into BOTH the `ObsidianFsDelivery` constructor AND the v1 tool handlers"
    - "MEM-11: an MCP `write_note({vault, path: \"_memory/observations/foo.md\", body: \"x\"})` call returns the structured `sink_write_blocked` error with `suggestion` text containing `record_observation`; no file is created on disk"
    - "When the existing fixture has a `_memory/` folder with a sentinel and no `[[memory_sinks]]` config is present, auto-discovery synthesizes a default sink at bootstrap — preserves v1-baseline parity"
    - "v1-baseline eval suite remains byte-for-byte green: ordinary v1 tool invocations against non-sink paths are unchanged"
  artifacts:
    - path: src/write/write.ts
      provides: optional `registry?: MemorySinkRegistry` parameter on writeNote / deleteNote; entry-point Guard refuses sink-resolved targets early
    - path: src/frontmatter/update.ts
      provides: optional `registry?: MemorySinkRegistry` parameter on updateFrontmatter; same refusal
    - path: src/server.ts
      provides: bootstrap-time MemorySinkRegistry instantiation, ordering before catchup, threading into delivery adapters and v1 tool handlers; uses `joinVaultPath` / `pathInSink` from Plan 02-02 — no direct `node:path` import beyond Phase 1 surface
    - path: src/server.test.ts
      provides: MEM-11 targeted MCP integration test + bootstrap-order callback assertion
  key_links:
    - from: src/write/write.ts
      to: src/memory/registry.ts
      via: findSinkContaining check at writeNote entry
      pattern: "findSinkContaining"
    - from: src/server.ts
      to: src/adapters/delivery/obsidian-fs/sentinel.ts
      via: provisionSink is called from server bootstrap through MemorySinkRegistry.registerMemorySinks (provisioner callback)
      pattern: "provisionSink"
    - from: src/server.ts
      to: src/memory/registry.ts
      via: instantiation + registration + dependency-injection into adapter constructors
      pattern: "MemorySinkRegistry|registerMemorySinks"
---

<objective>
Land the **defense-in-depth slice + server bootstrap wiring** that makes Plan 02-02's substrate and Plan 02-03's chokepoint validator live inside the running MCP server.

In scope:
1. **MEM-07 entry-point Guards on v1 tools**:
   - `src/write/write.ts:writeNote()`, `src/write/write.ts:deleteNote()`, `src/frontmatter/update.ts:updateFrontmatter()` each refuse memory-sink-resolved targets early with `sink_write_blocked` (defense-in-depth — the authoritative refusal still lives at the delivery layer per ADR-002 I-6).
   - `registry: MemorySinkRegistry` is an OPTIONAL parameter — when standalone tests instantiate the v1 tool directly without a registry, the guard is silently skipped (preserves Phase 1 unit-test fixture compatibility). The MCP server always supplies the registry at production call sites.
2. **Server bootstrap wiring in `src/server.ts`**:
   - Construct `const memorySinkRegistry = new MemorySinkRegistry();` after `loadConfig` and `manager.openAll`, BEFORE `catchupVault` fire-and-forgets.
   - Call `await memorySinkRegistry.registerMemorySinks(config.memory_sinks, { resolveVaultAbsolutePath, defaultSinkName, contractGetter, provisioner })` where `provisioner` closes over `provisionSink` from `src/adapters/delivery/obsidian-fs/sentinel.ts`. `resolveVaultAbsolutePath(name)` returns `manager.require(name).config.path`. The bootstrap uses `joinVaultPath` from `src/adapters/delivery/obsidian-fs/path.ts` (Plan 02-02) anywhere it needs to combine vault root + relative path — keeping `node:path` confined to the licensed dir (server.ts is exempt under ADR-002 I-3 but the helper keeps style consistent).
   - Auto-discovery for backwards-compat: when `config.memory_sinks` is empty, scan each vault root for `_memory/` containing `.memory-sink`; synthesize a default sink config `{name: "default", handle: \`obsidian-fs://${vault}/_memory/\`, contract: "default-memory-v1"}`. This preserves the existing fixture's existing 15 memory docs as a "default sink" without requiring config edits — important for v1-baseline parity (RESEARCH §Runtime State Inventory line 351).
   - Move `catchupVault` invocation to AFTER `registerMemorySinks` completes (or fails fast).
   - Pass `memorySinkRegistry` into the `ObsidianFsDelivery` constructor and to all v1 tool handlers that need it (`handleWriteNote`, `handleUpdateFrontmatter`, `handleDeleteNote`).
3. **MEM-11 targeted MCP integration test** in `src/server.test.ts`:
   - Spawn the server against the v2 fixture vault (which has `_memory/` with sentinel — provisioned at server boot). Invoke `write_note({vault, path: "_memory/observations/test.md", body: "x"})` via the MCP test transport. Assert structured `sink_write_blocked` error with `suggestion` containing `record_observation`; on disk, no file created. Mirror for `update_frontmatter` and `delete_note`.
4. **Bootstrap-order test**: instrument bootstrap with optional `onPhase: (name: string) => void` callbacks (test-only entry point), assert `register_memory_sinks` fires before `catchup`.

Output: 4 files modified, all tests green, MEM-11 demonstrably blocked at the MCP boundary.

Risk note: server bootstrap order is the highest-risk piece. The sentinel-provisioning step must complete (or fail-fast) BEFORE `catchupVault` starts scanning. The Phase 1 catchup is fire-and-forget after `manager.openAll`; reorder it after `registerMemorySinks` (still fire-and-forget after that). If a future user puts non-memory files under `_memory/` and the sentinel is absent, bootstrap aborts with `SinkProvisioningError` — this is intended per ADR-004.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/02-memory-namespace-provenance-contract/02-CONTEXT.md
@.planning/phases/02-memory-namespace-provenance-contract/02-RESEARCH.md
@.planning/phases/02-memory-namespace-provenance-contract/02-PATTERNS.md
@.planning/phases/02-memory-namespace-provenance-contract/02-02-SUMMARY.md
@.planning/phases/02-memory-namespace-provenance-contract/02-03-SUMMARY.md
@docs/v2/adr/004-memory-sink-handles.md
@docs/v2/adr/002-adapter-seams.md
@src/server.ts
@src/write/write.ts
@src/frontmatter/update.ts
@src/memory/index.ts
@src/adapters/delivery/obsidian-fs/sentinel.ts
@src/adapters/delivery/obsidian-fs/path.ts

<interfaces>
From src/memory/index.ts (Plan 02-02 substrate):
- `MemorySinkRegistry` with `registerMemorySinks(configs, opts)`, `listMemorySinks()`, `resolveMemorySink(nameOrHandle)`, `getDefaultMemorySink()`, `findSinkContaining(docId)`.

From src/adapters/delivery/obsidian-fs/sentinel.ts (Plan 02-02):
- `provisionSink(sink, vaultAbsolutePath, opts): Promise<void>`
- `assertSentinelExists(sink, vaultAbsolutePath): Promise<boolean>`

From src/adapters/delivery/obsidian-fs/path.ts (Plan 02-02):
- `joinVaultPath(vaultRoot, relPath): string`
- `pathInSink(vaultAbsolutePath, sink, relativeSubpath?): string`

From src/adapters/registry.ts (Plan 02-02 addition):
- `decomposeDocId(docId): { scheme, authority, resource }` — useful inside writeNote's entry guard for formatting the DocId from a vault-relative path before calling `findSinkContaining`.

From src/adapters/delivery/types.ts (Phase 1 + Plan 02-03):
- `WriteConflict.reason` now includes `"sink_write_blocked"` plus envelope fields `sinkName?`, `suggestion?`.
- WriteSuccess uses `newHash` (NOT `hash`).

From src/write/write.ts (Phase 1 — current writeNote/deleteNote signature):
- The v1 handlers return discriminated `{ok:true, ...}` / `{ok:false, reason, ...}` shapes; extend the union with the Plan 02-03 reasons.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: MEM-07 entry-point Guards on v1 tools (write_note / update_frontmatter / delete_note)</name>
  <files>src/write/write.ts, src/frontmatter/update.ts</files>
  <behavior>
    - `writeNote({...}, vault, registry?)` returns `{ok:false, reason:"sink_write_blocked", sinkName, suggestion: "use record_observation for sink '<name>'"}` when the target relative path resolves into a sink via `registry.findSinkContaining(docId)`.
    - `deleteNote` and `updateFrontmatter` apply the same refusal.
    - The refusal happens BEFORE any FS read.
    - When `registry` is omitted (standalone test paths), behavior is identical to Phase 1 — no guard fires.
  </behavior>
  <action>
    **Entry-point Guard in `src/write/write.ts:writeNote()`**:

    Before the existing `write_enabled` check (mirror the lines around `obsidian-fs/write.ts:155–157`), add:

    ```typescript
    if (registry) {
      const docId = formatDocId("obsidian-fs", vault.config.name, relativePath);
      const sink = registry.findSinkContaining(docId);
      if (sink !== null) {
        return {
          ok: false,
          reason: "sink_write_blocked",
          sinkName: sink.name,
          message: `Target ${relativePath} resolves into MemorySink "${sink.name}". v1 write_note is refused for memory-sink targets.`,
          suggestion: `Use record_observation for sink '${sink.name}'.`,
        };
      }
    }
    ```

    The `registry` parameter is OPTIONAL — when standalone tests instantiate `writeNote` without a registry, the guard is silently skipped (preserves Phase 1 test compatibility). The MCP server always supplies the registry, so production callers are always guarded.

    Apply the same pattern to:
    - `src/write/write.ts:deleteNote()` (same refusal: `sink_write_blocked` with `suggestion: "Use supersede to retire memory documents. Hard deletion is not yet supported in v2.0.0."`).
    - `src/frontmatter/update.ts:updateFrontmatter()` (same refusal: `suggestion: "Use record_observation + supersede for memory updates."`).

    Existing co-located tests for `src/write/write.test.ts` and `src/frontmatter/update.test.ts` MUST continue to pass unchanged (they instantiate without registry). Add NEW cases to those test files that DO pass a registry containing a sink and assert the `sink_write_blocked` refusal — three new cases total (one per tool).
  </action>
  <verify>
    <automated>npx vitest run --no-coverage src/write/write.test.ts src/frontmatter/update.test.ts</automated>
  </verify>
  <done>All existing v1 unit tests still pass; new cases (one per tool) demonstrate the `sink_write_blocked` refusal when a registry with a matching sink is supplied; `tsc --noEmit` clean.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Server bootstrap wiring + auto-discovery + MEM-11 integration test + bootstrap-order assertion</name>
  <files>src/server.ts, src/server.test.ts</files>
  <behavior>
    - Server bootstrap order (verified by callback hooks in the test): `loadConfig → manager.openAll → registry.registerMemorySinks → catchupVault (fire-and-forget) → server.connect`. Sentinels are written before catchup walks the fixture.
    - Auto-discovery: when `config.memory_sinks` is empty AND a vault contains `_memory/.memory-sink`, the server synthesizes a default sink config `{name: "default", handle: "obsidian-fs://<vault>/_memory/", contract: "default-memory-v1"}`.
    - The `MemorySinkRegistry` instance is shared with both `ObsidianFsDelivery` (constructor parameter) and the v1 tool handlers (`handleWriteNote`, `handleUpdateFrontmatter`, `handleDeleteNote`).
    - MEM-11 integration test: an MCP `write_note({vault: "v2-test-vault", path: "_memory/observations/test.md", body: "x"})` call returns the structured `sink_write_blocked` error with `suggestion` containing `record_observation`. The `_memory/` folder is unchanged on disk.
    - The same MCP-level rejection applies for `update_frontmatter({vault, path: "_memory/..."}` and `delete_note({vault, path: "_memory/..."}` against any path inside a configured sink.
  </behavior>
  <action>
    **Step 1 — `src/server.ts` bootstrap wiring**:

    In `src/server.ts:serve()`:
    1. After `loadConfig()` and `manager.openAll()`, before `catchupVault` fire-and-forgets, instantiate `const memorySinkRegistry = new MemorySinkRegistry();`.
    2. Build the `memorySinksConfig` list:
       - If `config.memory_sinks.length > 0`, use that directly.
       - Else, run auto-discovery: for each registered vault, check whether `joinVaultPath(vault.config.path, "_memory/.memory-sink")` exists; if so, synthesize `{name: "default", handle: \`obsidian-fs://${vault.config.name}/_memory/\`, contract: "default-memory-v1"}`.
    3. Call `await memorySinkRegistry.registerMemorySinks(memorySinksConfig, { resolveVaultAbsolutePath: (name) => manager.require(name).config.path, defaultSinkName: config.memory?.default_sink, contractGetter: getContract, provisioner: async (sink, vaultAbs) => provisionSink(sink, vaultAbs, { version: VERSION }) });`.
    4. Pass `memorySinkRegistry` into the `ObsidianFsDelivery` constructor (Plan 02-03 made this an optional parameter) and to all v1 tool handlers that need it (`handleWriteNote`, `handleUpdateFrontmatter`, `handleDeleteNote`).
    5. Move `catchupVault` invocation to AFTER `registerMemorySinks` completes (or fails fast).
    6. Surface a test-only `onPhase: (name: string) => void` hook on the bootstrap entry point. In production it defaults to a no-op; in tests it appends to an ordered array. Phases reported: `load_config`, `open_vaults`, `register_memory_sinks`, `start_catchup`, `connect_transport`.

    All `path.join` calls in server.ts route through `joinVaultPath` (Plan 02-02) for consistency.

    **Step 2 — `src/server.test.ts` MEM-11 integration test**:

    Add a `describe("MEM-11: v1 write tools refuse memory-sink targets")` block. Setup: spawn the server against the v2 fixture vault (which has `_memory/` with sentinel — provisioned at server boot via auto-discovery). Invoke the MCP tool `write_note` with `{vault: "v2-test-vault", path: "_memory/observations/test.md", body: "x"}` via the test harness. Assert:
    - `response.isError === false` (this is a domain error, not protocol error; per RESEARCH §Q1).
    - `JSON.parse(response.content[0].text)` matches `{ok: false, reason: "sink_write_blocked", sinkName: "default", message: /MemorySink "default"/, suggestion: /record_observation/}`.
    - The `_memory/` folder is unchanged (no file created at the target path).

    Mirror the same shape for `update_frontmatter` and `delete_note` against a path inside `_memory/`.

    **Step 3 — Bootstrap-order test**:

    Add a small test that uses the `onPhase` hook to capture the phase order. Assert the captured array is `["load_config", "open_vaults", "register_memory_sinks", "start_catchup", "connect_transport"]` (or includes `register_memory_sinks` strictly before `start_catchup`). This is the simplest way to verify the invariant without mtime trickery.
  </action>
  <verify>
    <automated>npx vitest run --no-coverage src/server.test.ts && npm test</automated>
  </verify>
  <done>MEM-11 integration test passes (naive write_note / update_frontmatter / delete_note to `_memory/...` returns the structured error); bootstrap-order callback shows `register_memory_sinks` before `start_catchup`; full `npm test` suite passes; `npm run eval:baseline` green (v1 path behavior unchanged when no sink involved); `bash scripts/lint-adapters.sh` clean.</done>
</task>

</tasks>

<verification>
- v1 entry-point Guards refuse with `sink_write_blocked` (verified by unit tests in Task 1 and integration tests in Task 2).
- Server bootstrap order writes sentinels before catchup (verified by `onPhase` hook test).
- MEM-11 integration test passes — MCP `write_note` / `update_frontmatter` / `delete_note` against `_memory/...` is refused with `sink_write_blocked` + actionable `suggestion`.
- Auto-discovery synthesizes a default sink when `[[memory_sinks]]` is absent but a sentinel exists.
- v1-baseline eval suite remains byte-for-byte green: invocations against non-`_memory/` paths are unchanged.
- `bash scripts/lint-adapters.sh` reports zero new violations.
- All 324 v1 tests + Plan 02-02 substrate tests + Plan 02-03 validator/conformance tests + Plan 02-03b new tests pass (`npm test`).
</verification>

<success_criteria>
- ROADMAP Phase 2 success criterion 1 ("naive `write_note` to memory-sink path rejected with clear structured error; v1 tools refuse `source: agent` outside sink") fully satisfied by MEM-11 test + v1 entry-point Guards (Task 1) + agent_write_outside_sink in the Plan 02-03 validator.
- MEM-07 and MEM-11 satisfied.
- Backwards compatibility preserved: all 324 v1 tests green; v1-baseline eval green.
</success_criteria>

<output>
Create `.planning/phases/02-memory-namespace-provenance-contract/02-03b-SUMMARY.md` when done.
</output>
