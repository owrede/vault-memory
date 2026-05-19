---
phase: 07-visual-contract-editor-canvas
plan: 07
subsystem: contract-editor / watcher
tags: [CAN-08, watcher, suppression, mcp-notification, plugin]
dependency-graph:
  requires:
    - 07-01-contract-format
    - 07-03-mcp-bridge
    - 07-04-plugin-tools
    - 07-05-editor-view
  provides:
    - hash-keyed-suppression
    - contracts-reloaded-notification
    - reload-notifier
  affects:
    - src/adapters/change-feed/obsidian-fs/suppression.ts
    - src/contracts/loader.ts
    - src/plugin-tools/index.ts
    - src/server.ts
    - plugin/src/services/mcp-client.ts
    - plugin/main.ts
    - plugin/src/views/contract-editor/view.ts
tech-stack:
  added: []
  patterns:
    - additive-overload (SuppressionSet.add legacy + options-object form)
    - hash-keyed-echo-suppression (CAN-08 D-WATCH-PLUGIN-OUT)
    - mcp-resource-updated-fanout (one underlying handler → multiple subs)
key-files:
  created:
    - src/plugin-tools/suppress-contract-write.ts
    - src/plugin-tools/suppress-contract-write.test.ts
    - plugin/src/services/reload-notifier.ts
    - plugin/src/services/reload-notifier.test.ts
  modified:
    - src/adapters/change-feed/obsidian-fs/suppression.ts
    - src/adapters/change-feed/obsidian-fs/suppression.test.ts
    - src/contracts/loader.ts
    - src/contracts/loader.test.ts
    - src/plugin-tools/index.ts
    - src/plugin-tools/index.test.ts
    - src/server.ts
    - src/server.plugin-gating.test.ts
    - plugin/src/services/mcp-client.ts
    - plugin/src/views/contract-editor/view.ts
    - plugin/main.ts
decisions:
  - "SuppressionSet API choice: overloaded `add(path, ttlMsOrOpts)` accepting `number` (legacy) OR `{ttlMs?, hash?}` (new). Rationale: planner option (a) — keeps call-site simplicity for the new `suppress_contract_write` tool while preserving every existing path-only / ttl-only caller verbatim. Rejected: split `add` + `addHashed` (option b) on call-site verbosity grounds."
  - "MCP notification method: `notifications/resources/updated` with `uri = vault-memory://contracts/reloaded` and `_meta.path` carrying the YAML companion path. Rationale: the resource-updated method already exists in the MCP SDK with a published Zod schema (ResourceUpdatedNotificationSchema); inventing a new method would require a custom schema on both ends. The `_meta.path` payload saves the plugin a follow-up `readResource` round-trip in the common case."
  - "ReloadNotifier as an injectable-dependencies class. Rationale: keeps the production wiring (main.ts: workspace walk + Modal) out of the unit test surface. The notifier becomes pure logic — translate YAML path → contract path, filter on `openContractPaths()`, call `promptReload()` — and is fully testable in vitest without spawning Obsidian."
metrics:
  tasks_completed: 3
  duration: "~12m"
  completed: 2026-05-19
---

# Phase 7 Plan 07: Self-write suppression + external-edit reload (CAN-08) Summary

Closed the YAML-companion echo loop and surfaced external `.yaml` edits as a user-facing reload prompt — without adding a single new file watcher.

## What Changed

### 1. `SuppressionSet` — hash-keyed entries (additive)

Extended `src/adapters/change-feed/obsidian-fs/suppression.ts` with an overloaded `add(path, ttlMsOrOpts)`:
- `add(path)` — unchanged
- `add(path, 5000)` — unchanged (number = TTL ms)
- `add(path, { ttlMs?, hash? })` — new options form

`consume(path, hash?)` is now hash-aware: when the stored entry has a recorded hash AND the caller supplies one, equality is required; mismatch returns false AND leaves the entry intact (RESEARCH §6 Pitfall 1 mitigation). Legacy path-only entries fall through unchanged.

### 2. Phase 6 `ContractRegistry` loader — honors suppression

`startContractRegistry` gained two new options:
- `suppression?: SuppressionSet` — the shared set from server bootstrap
- `onExternalReload?: (path) => void` — fires after a non-suppressed reload completes

`handleChangeEvent` now reads the on-disk YAML body once, SHA-256s it, and calls `suppression.consume(path, hash)` BEFORE re-validating. Suppressed events drop silently (no audit, no callback). Non-suppressed reloads fire `onExternalReload` so the server bootstrap can emit the MCP notification.

### 3. New MCP tool: `suppress_contract_write` (6th plugin tool)

`src/plugin-tools/suppress-contract-write.ts` — plugin-gated tool that registers a hash-keyed suppression entry:
- Input: `{path, hash, ttl_ms?}`
- Zod-validates `path` against `^_contracts/[^/]+\.yaml$` (non-recursive, Pitfall F3-aligned)
- Hash must be 64-char lowercase hex
- TTL bounded 200..30_000 ms (THREAT-T-07-07-02 mitigation)

Default-OFF gate preserved: `PLUGIN_TOOL_NAMES` grew from 5 → 6, but the v1-baseline `tools-list.snapshot.json` stays byte-identical because the gate ships disabled.

### 4. Server bootstrap — emits `vault-memory://contracts/reloaded`

`src/server.ts` threads the shared `suppression` instance into both `startContractRegistry({suppression, onExternalReload})` and `syncPluginTools({suppression})`. The `onExternalReload` handler emits `notifications/resources/updated` with `uri: "vault-memory://contracts/reloaded"` and `_meta.path` — but only when `config.plugin.enabled === true`.

### 5. Plugin: ReloadNotifier (no new watchers)

`plugin/src/services/reload-notifier.ts` — subscribes to `notifications/resources/updated`, filters on URI, maps `_contracts/<n>.yaml` → `<n>.contract`, and only fires the prompt when the affected `.contract` is open in a workspace leaf.

`plugin/src/services/mcp-client.ts` was extended: it now registers a `ResourceUpdatedNotificationSchema` handler on connect that fans out to every `genericSubs` entry whose method matches. Previously `onNotification` stored subscriptions but never delivered events.

### 6. Plugin: `emitYamlCompanion` strict ordering

`plugin/src/views/contract-editor/view.ts` now SHA-256s the YAML body (via SubtleCrypto in the renderer process — no Node `crypto` dependency), `await`s the `suppress_contract_write` MCP call, and THEN writes the YAML. Suppress-call failures are logged but non-fatal — the change-feed re-validate path is idempotent on the same body.

`plugin/main.ts` constructs a `ReloadNotifier` after MCP connect, supplies workspace-walk + Modal callbacks, and stops it on `onunload`.

## Test Counts

| Surface | New tests | Total |
|---|---|---|
| SuppressionSet | 5 | 12 |
| Contract loader | 3 | 18 |
| `suppress_contract_write` | 9 | 9 |
| `syncPluginTools` count assertions | (updated 2 existing) | 4 |
| Plugin-gating test count assertions | (updated 2 existing) | 3 |
| ReloadNotifier | 5 | 5 |
| **Total NEW tests** | **22** | — |

Plan called for 15 new tests minimum (4 suppression + 3 loader + 4 tool + 4 notifier); delivered 22 (the extra coverage came from `(a2)`, `(b2)`, `(b3)`, `(c2)`, `(d2)` boundary cases in `suppress_contract_write.test.ts` and the `(c2)` non-matching-URI case in `reload-notifier.test.ts`).

## must_haves.truths verification

- ✅ `SuppressionSet` accepts optional `hash` argument; existing callers untouched (12/12 suppression tests pass; 1657/1668 root tests pass with 11 skipped, zero regressions)
- ✅ Phase 6 loader calls `suppression.consume(path, hash)` BEFORE re-validating (Test 16 — suppressed write proves it)
- ✅ Plugin SHA-256s + calls `suppress_contract_write` BEFORE `adapter.write` (view.ts lines 235 and 252 confirm strict ordering)
- ✅ Server emits `vault-memory://contracts/reloaded`; plugin's `ReloadNotifier` surfaces the Modal (5 unit tests + production wiring in main.ts)
- ✅ Zero new file watchers: `grep -rn "chokidar" plugin/` finds only doc-comment mentions, no new imports

## Snapshot byte-identity

`evals/v1-baseline/baseline.test.ts` passes — the v1 tools-list snapshot is byte-identical under the default-OFF gate. Confirmed because the 6th plugin tool only registers when `[plugin] enabled = true`.

## Deviations from Plan

None — plan executed as written. Minor expansions:
- 22 tests delivered vs. 15 planned (extra boundary coverage was cheap to add).
- The mcp-client `onNotification` API existed (from 07-03) but did not actually dispatch — this was treated as a Rule 2 missing-critical-functionality finding and fixed inline (ReloadNotifier would have been a silent no-op otherwise). The fix is part of the Task 3 commit.

## Self-Check: PASSED

- FOUND: src/adapters/change-feed/obsidian-fs/suppression.ts (modified)
- FOUND: src/contracts/loader.ts (modified)
- FOUND: src/plugin-tools/suppress-contract-write.ts (created)
- FOUND: src/plugin-tools/suppress-contract-write.test.ts (created)
- FOUND: plugin/src/services/reload-notifier.ts (created)
- FOUND: plugin/src/services/reload-notifier.test.ts (created)
- FOUND: commit b027a7f (Task 1 — SuppressionSet + loader)
- FOUND: commit bf5c85f (Task 2 — suppress_contract_write tool)
- FOUND: commit a79f235 (Task 3 — ReloadNotifier + view.ts)
