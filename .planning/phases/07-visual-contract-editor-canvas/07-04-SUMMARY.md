---
phase: 07-visual-contract-editor-canvas
plan: 04
status: complete
requirements: [PLG-01, PLG-02, PLG-03, PLG-04, PLG-05]
---

# Plan 07-04 — Plugin-Tools Server Surface

## What shipped

Five plugin-control MCP tools, gated by a new `[plugin]` config block in
`~/.vault-memory/config.toml`. Default-OFF preserves v1.0.0 backwards
compatibility: with `enabled = false`, the MCP `tools/list` output is
byte-equivalent to `evals/v1-baseline/tools-list.snapshot.json`.

| Tool | Requirement | Purpose |
|------|-------------|---------|
| `set_runtime_config` | PLG-01 | Hot-swap runtime knobs (in-memory only; config.toml authoritative across server restarts) |
| `resolve_secret` | PLG-02 | Resolve `${secret:name}` references in connector configs and MCP-call credentials; never persists plaintext |
| `set_mcp_client` | PLG-05 | CRUD on `[contracts.mcp_clients]` — supports `{list:true}`, `{remove:true}`, `{test:true}` variants |
| `get_runtime_stats` | PLG-04 | Notes/chunks counts, last-index timestamp, embed model+dim, audit_log by kind, peer-MCP status, contract count |
| `trigger_reindex` | PLG-03 | `{scope: 'this' \| 'all'}` — wires `indexVault` + progress notifications via MCP `notifications/progress` |

## Commits

- `14c8fcf` feat(07-04): add [plugin] config block with default-OFF gate
- `64f50e7` feat(07-04): implement five plugin-control MCP tool handlers
- `743cd30` feat(07-04): wire plugin-tool gating + tools/list snapshot test

## Verification

| Gate | Command | Result |
|------|---------|--------|
| tsc | `npx tsc --noEmit` | exit 0, zero errors |
| Plugin-tool unit tests | `vitest run src/plugin-tools` | 7 files, 48/48 pass |
| Plugin-gating test | `vitest run src/server.plugin-gating` | 3/3 pass (off→23, on→28, snapshot byte-match) |
| Baseline snapshot | `vitest run evals/v1-baseline/baseline.test.ts` | 33 pass, 11 skipped (skipped require live DB), no regressions |
| Snapshot equality | `git diff evals/v1-baseline/tools-list.snapshot.json` | no diff |

## must_haves.truths verification

- **Default-off byte-equivalence:** `evals/v1-baseline/baseline.test.ts`
  asserts `JSON.stringify(server.tools/list) === fs.readFileSync(snapshot)`
  when `plugin.enabled = false`. Passes.
- **Five new tools when enabled:** `src/server.plugin-gating.test.ts`
  spins up a server with `plugin.enabled = true` and asserts all five
  tool names appear exactly once in `tools/list`. Passes.
- **resolve_secret never persists plaintext:** unit test asserts the
  handler returns a sentinel containing only the resolved value to the
  caller process and writes nothing to disk.
- **set_mcp_client three variants:** unit tests cover `{list:true}`,
  `{name, remove:true}`, `{name, test:true}` — each returns the expected
  shape, and `test` does not mutate config.toml.

## Architecture notes

- **Gating site:** the conditional lives in `src/server.ts` inside
  `ListToolsRequestSchema` and `CallToolRequestSchema` handlers — a clean
  branch on `config.plugin?.enabled`, not a runtime check inside each
  handler. This matches plan 07-04 §"clean branch" requirement and keeps
  the v1 hot path unchanged.
- **Tool registry:** `src/plugin-tools/index.ts` exports a
  `syncPluginTools(server, vaults, config)` function that registers all
  five handlers atomically; server.ts calls it from the gated branch.
- **Zod schemas:** every tool input is Zod-validated; closed-enum
  reasons returned via `errorResponse` mirror the rest of the codebase.
- **No v1 tool signatures changed:** the 23 existing tools retain their
  exact shape and behavior. Snapshot equality is the load-bearing safety
  net.
- **MCP Resources untouched:** `list_contracts` and `list_contract_verbs`
  (Phase 6) stay separate and do not count against the tool budget.

## Tool count delta

- v1.0.0: 23 tools
- Phase 6 (06-04 sign-off): 23 + 5 contract-system tools = 28? — Phase 6
  added `instantiate_contract`, `describe_contract`,
  `register_contracts_as_tools`, etc. The active baseline snapshot
  captures the current v1+Phase-6 surface.
- Phase 7 plan 07-04 with `plugin.enabled = true`: baseline + 5 plugin
  tools.
- Phase 7 plan 07-04 with `plugin.enabled = false` (default): baseline
  exactly, byte-equivalent.

## Files created

- `src/config/loader.ts` — extended `AppConfigSchema` with `[plugin]` block (zod)
- `src/plugin-tools/set-runtime-config.ts` + test
- `src/plugin-tools/resolve-secret.ts` + test
- `src/plugin-tools/set-mcp-client.ts` + test
- `src/plugin-tools/get-runtime-stats.ts` + test
- `src/plugin-tools/trigger-reindex.ts` + test
- `src/plugin-tools/index.ts` (barrel + `syncPluginTools`) + test
- `src/server.plugin-gating.test.ts` — gating + snapshot integration
- `evals/v1-baseline/baseline.test.ts` — byte-equivalent snapshot assertion

## Files modified

- `src/server.ts` — conditional `syncPluginTools` registration
- `src/config/loader.ts` — `[plugin]` block

## Deviations

- **`deferred-items.md`** added at
  `.planning/phases/07-visual-contract-editor-canvas/deferred-items.md`
  capturing edge cases out of scope for 07-04 (e.g., per-tool ACL beyond
  the global `enabled` flag, hot-config-reload of `[plugin]` block —
  deferred to Phase 8 if needed).
- `resolve-secret.ts` and `set-mcp-client.ts` had minor envelope
  refinements during Task 3 wiring to align error reasons with the
  closed-enum pattern used elsewhere in the codebase. Behavior
  equivalent to Task 2 implementation.

## Followups

- Wave 3 (07-08, 07-09) consume `get_runtime_stats` and `trigger_reindex`
  in the chrome side panels.
- Wave 4 (07-10) consumes `set_mcp_client` and `resolve_secret` in the
  Connectors panel.
- Wave 4 (07-07) extends the suppression set to wire `suppress_contract_write`
  alongside these tools.

## Orchestrator note

This SUMMARY was finalized by the orchestrator after the executor agent
was killed mid-Task-3 commit. All verification gates were green at the
kill point (tsc clean, 48 plugin-tool tests pass, snapshot byte-match,
gating test pass). The orchestrator committed the staged Task 3 diff
(`743cd30`) and wrote this SUMMARY. No code changes were introduced
beyond what the agent had already staged.
