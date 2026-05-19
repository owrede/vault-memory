---
phase: 07-visual-contract-editor-canvas
plan: 03
subsystem: plugin-lifecycle
tags: [plugin, mcp-client, settings, obsidian]
dependency_graph:
  requires: [07-01]
  provides: [VaultMemoryMcpClient, SettingsStore, VaultMemorySettingsTab, CliNotFoundError]
  affects: [07-04, 07-05, 07-07, 07-08, 07-09, 07-10]
tech_stack:
  added:
    - "@modelcontextprotocol/sdk client/index.js + client/stdio.js + types.js"
  patterns:
    - "Plugin → server stdio MCP client (analog: src/contracts/mcp-clients.ts PeerMcpRegistry)"
    - "Injectable ClientFactory pattern for test isolation (no real child_process.spawn in unit tests)"
    - "MCP envelope peeling: {content: [{type: 'text', text: '<json>'}]} → parsed JS value"
    - "loadData/saveData round-trip with merge-on-load for forward-compatible settings"
    - "Boot-time CliNotFoundError → Notice + persistent settings-tab banner (non-fatal failure mode)"
key_files:
  created:
    - plugin/src/services/settings-store.ts
    - plugin/src/services/settings-store.test.ts
    - plugin/src/services/mcp-client.ts
    - plugin/src/services/mcp-client.test.ts
    - plugin/src/chrome/settings-tab.ts
    - plugin/.gitignore
  modified:
    - plugin/main.ts
    - plugin/src/views/contract-editor/view.ts
    - plugin/tests/mocks/obsidian.ts
decisions:
  - "CliNotFoundError is non-fatal: the plugin loads even when `vault-memory` is not on PATH, so the user can edit local .contract files and fix the Server Command setting via the settings-tab banner without restarting Obsidian."
  - "ContractEditorView constructor signature changed from `(leaf)` to `(leaf, plugin)`. Required so subsequent plans reach `this.plugin.mcpClient` / `this.plugin.settingsStore` without a workspace-walk."
  - "Build artifacts (`plugin/main.js`, `plugin/main.css`, source maps) added to a new `plugin/.gitignore`. The v2.0.0 release tarball (D-DIST-PRIMARY) ships these from the GitHub Release asset, not the source tree."
  - "Test-stub Client emits all notifications to all registered handlers; the wrapper itself routes by progressToken. Matches the real-world architecture (one ProgressNotificationSchema handler, many token subscribers) better than schema-literal stub matching."
metrics:
  duration_seconds: 490
  duration_human: "8m 10s"
  tasks_completed: 3
  files_created: 6
  files_modified: 3
  tests_added: 12
  commits: 5
  completed: "2026-05-19T06:54:57Z"
---

# Phase 7 Plan 03: Plugin Lifecycle (settings + MCP client + missing-CLI banner) Summary

Promote the spike's minimal `plugin/main.ts` into a full Obsidian-plugin lifecycle that owns settings persistence, spawns `vault-memory serve` over stdio, and surfaces a discoverable failure mode when the CLI is not on PATH — locking the bootstrap surface so Wave-3 chrome plans (07-08..07-10) and the editor plan (07-05) attach without re-thinking startup.

## What Shipped

### `plugin/src/services/settings-store.ts` (PLG-01 / D-CHROME-SETTINGS)

Typed wrapper over Obsidian `Plugin.loadData()` / `saveData()`. Persistence target: `.obsidian/plugins/vault-memory/data.json`.

**Field list with restart-required mapping** (per 07-CONTEXT.md L94–100 and "Settings restart-vs-hot-swap mapping"):

| Setting              | Type              | Default                  | Restart required? |
| -------------------- | ----------------- | ------------------------ | ----------------- |
| `ollamaUrl`          | `string`          | `"http://localhost:11434"` | yes               |
| `embeddingModel`     | `string`          | `"bge-m3"`               | yes               |
| `rerankerEnabled`    | `boolean`         | `false`                  | no (hot-swap)     |
| `defaultVault`       | `string \| null`  | `null`                   | no (hot-swap)     |
| `indexerBatchSize`   | `number`          | `32`                     | no (hot-swap)     |
| `ftsTokenizer`       | `string \| null`  | `null`                   | yes               |
| `serverCommand`      | `string`          | `"vault-memory"`         | yes               |
| `serverArgs`         | `string[]`        | `["serve"]`              | yes               |

Merge-on-load semantics: older `data.json` files missing keys introduced in later plugin versions degrade to defaults rather than failing.

API surface: `load()`, `save()`, `get(key)`, `set(key, value)`, `isRestartRequired(key)`, `snapshot()`.

### `plugin/src/services/mcp-client.ts` — `VaultMemoryMcpClient`

Wraps `@modelcontextprotocol/sdk` 1.x `Client` over `StdioClientTransport`. Method surface:

| Method                        | Behavior                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `connect()`                   | Spawns the child via `defaultClientFactory`; promotes ENOENT to `CliNotFoundError`.                         |
| `callTool(name, args)`        | Wraps `Client.callTool({name, arguments: args})` and peels the MCP envelope to a parsed JS value.           |
| `onProgress(token, handler)`  | Subscribes to `notifications/progress` filtered by `progressToken`. Returns an unsubscribe function.        |
| `onNotification(method, h)`   | Generic subscribe (07-07 watcher uses this for `vault-memory://contracts/reloaded`).                        |
| `disconnect()`                | Idempotent close of Client + transport. Clears subscriptions.                                               |
| `available` (field)           | `true` between successful `connect()` and `disconnect()`, otherwise `false`.                                |

`ClientFactory` is an injectable constructor parameter — tests supply a stub that returns a mock Client without spawning a real child process. Mirrors the `src/contracts/mcp-clients.ts` pattern.

### `plugin/src/chrome/settings-tab.ts` — `VaultMemorySettingsTab`

Skeleton `PluginSettingTab` with three deliberately-minimal display elements:

1. `<h2>vault-memory settings</h2>` — section header.
2. **Missing-CLI banner** (rendered only when `plugin.cliMissing === true`):

   > "vault-memory CLI not found. Install via the `/vm-install` skill or set the Server Command setting to the absolute path of `vault-memory`."

3. `<div data-testid="settings-placeholder">` — stable selector anchor that 07-08 swaps for the full settings UI without re-anchoring tests.

### `plugin/main.ts` — full `VaultMemoryPlugin` lifecycle

Public fields (so chrome/editor/watcher plans don't need a workspace walk):

- `settingsStore: SettingsStore`
- `mcpClient: VaultMemoryMcpClient`
- `cliMissing: boolean`
- `cliMissingMessage: string | null`

**onload ordering** (per plan §action):

1. Construct + load `SettingsStore`.
2. Construct `VaultMemoryMcpClient` from `serverCommand` + `serverArgs`.
3. `await mcpClient.connect()` inside `try`/`catch`. On `CliNotFoundError`, set `cliMissing=true` and continue. On any other error, also continue but with a generic "server failed to start" message — the plugin must remain operable so the user can fix the Server Command setting via the settings tab.
4. `registerView(VIEW_TYPE_CONTRACT, leaf => new ContractEditorView(leaf, this))`.
5. `registerExtensions(["contract"], VIEW_TYPE_CONTRACT)`.
6. `addSettingTab(new VaultMemorySettingsTab(app, this))`.
7. If `cliMissing`, fire a 10-second `Notice` with recovery copy:

   > "vault-memory CLI not found on PATH — run /vm-install to set up. The contract editor will load but cannot reach the server."

**onunload** calls `await mcpClient?.disconnect()` (idempotent + best-effort).

### `plugin/src/views/contract-editor/view.ts`

Constructor signature changed from `(leaf)` to `(leaf, plugin)`. The plugin instance is stored as `readonly plugin: VaultMemoryPlugin` so 07-05 (editor body), 07-07 (watcher), 07-08 (chrome), 07-09 (secrets), and 07-10 (connectors) can reach services through `this.plugin.<field>`.

### `plugin/tests/mocks/obsidian.ts`

Extended `Plugin` stub with instance-level `__pluginData` storage so `loadData()` / `saveData()` round-trip across `SettingsStore` instances — simulates an Obsidian restart cycle. Deep-clones via JSON on save to mirror the real persistence boundary.

## Must-Haves — Truths Verified

- **Plugin loads in Obsidian with `registerView` + `registerExtensions(['contract'])` bound:** `plugin/main.ts:101–105`. Build produces `plugin/main.js` (1.1 MB).
- **Plugin holds a single VaultMemoryMcpClient spawning `vault-memory serve`:** `plugin/main.ts:71–74` (constructed from settings) + `plugin/main.ts:78` (`connect()`). Disconnect in `onunload` at `plugin/main.ts:120`.
- **Settings persist via `loadData()` / `saveData()` and survive restart:** `plugin/src/services/settings-store.test.ts` test (c) instantiates a fresh `SettingsStore` against the same `Plugin` after `set` + `save` and confirms the new values are returned by `load()`.
- **Plugin surfaces a banner when CLI not on PATH:** Notice in `plugin/main.ts:109` + persistent banner in `plugin/src/chrome/settings-tab.ts:36` (class `vm-cli-missing-banner`).

## Acceptance Criteria Greps

```text
plugin/main.ts:47:  VaultMemoryMcpClient,
plugin/main.ts:58:  mcpClient!: VaultMemoryMcpClient;
plugin/main.ts:71:    this.mcpClient = new VaultMemoryMcpClient({
plugin/main.ts:46:  CliNotFoundError,
plugin/main.ts:80:      if (err instanceof CliNotFoundError) {
plugin/main.ts:106:    this.addSettingTab(new VaultMemorySettingsTab(this.app, this));
plugin/main.ts:78:      await this.mcpClient.connect();
plugin/src/chrome/settings-tab.ts:24:export class VaultMemorySettingsTab extends PluginSettingTab {
plugin/src/views/contract-editor/view.ts:73:  constructor(leaf: WorkspaceLeaf, plugin: VaultMemoryPlugin) {
```

## Verification Output

```text
$ cd plugin && npm run typecheck
> tsc --noEmit
# (no output → exit 0)

$ cd plugin && npm test
✓ src/services/settings-store.test.ts (5 tests) 2ms
✓ src/services/mcp-client.test.ts (7 tests) 5ms
Test Files  2 passed (2)
     Tests  12 passed (12)

$ cd plugin && npm run build
# … 12 esbuild-svelte upstream warnings (all from @xyflow/svelte/dist), no errors
$ ls plugin/main.js
-rw-r--r--  1 wrede  staff  1145078 May 19 08:53 main.js
```

## Commits

| Hash    | Type    | Description                                                         |
| ------- | ------- | ------------------------------------------------------------------- |
| 1ddc44c | test    | failing settings-store tests + obsidian mock loadData/saveData      |
| 0a5340e | feat    | SettingsStore implementation (PLG-01 / D-CHROME-SETTINGS)           |
| a553f05 | test    | failing VaultMemoryMcpClient tests (6 behaviors + CliNotFoundError) |
| 904c0de | feat    | VaultMemoryMcpClient implementation                                 |
| 42b2047 | feat    | wire VaultMemoryPlugin lifecycle + settings-tab skeleton            |

## Deviations from Plan

**None of substance.**

Two minor adjustments noted under "Decisions":

1. The MCP client test's stub `Client` was simplified after the first RED→GREEN — instead of matching by Zod schema literal (which is awkward to introspect in a stub), the stub dispatches all notifications to all registered handlers and lets the wrapper itself filter by `progressToken`. This mirrors the production architecture more accurately than schema-literal matching would.
2. Added `plugin/.gitignore` (not in plan's `files_modified`) to keep esbuild outputs (`main.js`, `main.css`, source maps) out of the source tree. Build outputs ship from the GitHub Release asset per D-DIST-PRIMARY. This is a [Rule 3 - Blocking] auto-fix — without it the next per-task commit would have polluted the worktree.

## Known Stubs

The settings-tab placeholder div (`data-testid="settings-placeholder"`) is an **intentional stub** that 07-08 fills in with the full settings UI. Documented in `plugin/src/chrome/settings-tab.ts:48–51` and `plugin/src/chrome/settings-tab.ts:55–58` with the explicit "Plan 07-08 replaces this placeholder" comment. The plugin still loads and is operable without it — only the UI knob density is reduced to "load + missing-CLI banner" which is the plan's stated minimum.

## Threat Surface Scan

No new threat surface beyond what's enumerated in the plan's `<threat_model>`. The CLI-missing failure path resolves to a `Notice` + settings-tab banner (T-07-03-03 mitigation), the `serverCommand` setting remains at its default (`"vault-memory"`) until 07-08 exposes the UI for editing (T-07-03-01 deferred mitigation), and the settings file contains no secrets (T-07-03-02 accept).

## Self-Check: PASSED

- [x] `plugin/src/services/settings-store.ts` exists (FOUND)
- [x] `plugin/src/services/settings-store.test.ts` exists (FOUND, 5 tests pass)
- [x] `plugin/src/services/mcp-client.ts` exists (FOUND)
- [x] `plugin/src/services/mcp-client.test.ts` exists (FOUND, 7 tests pass)
- [x] `plugin/src/chrome/settings-tab.ts` exists (FOUND)
- [x] `plugin/main.ts` modified (FOUND)
- [x] `plugin/src/views/contract-editor/view.ts` modified — constructor accepts `(leaf, plugin)` (FOUND)
- [x] `plugin/tests/mocks/obsidian.ts` extended with loadData/saveData round-trip (FOUND)
- [x] `plugin/main.js` builds cleanly (1.1 MB output)
- [x] `npm run typecheck` exits 0
- [x] `npm test` — 12/12 pass
- [x] Commits 1ddc44c, 0a5340e, a553f05, 904c0de, 42b2047 present in git log
