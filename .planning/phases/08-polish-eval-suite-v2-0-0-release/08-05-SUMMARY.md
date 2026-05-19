---
phase: 08-polish-eval-suite-v2-0-0-release
plan: 05
subsystem: release-engineering
tags: [REL-08, mcp-resources, deprecation, snapshot, agent-discovery]
provides:
  - 5 new MCP Resources (vaults, models, recent, stats, backlinks)
  - canonical RESOURCES literal (src/resource-registry.ts)
  - resources-list.snapshot.json (pinned 10-entry surface)
  - dump-resources.mjs (snapshot regenerator)
  - DEPRECATED notice on 5 v1 tools (additive, non-breaking)
requires:
  - Plan 08-01 (CHANGELOG deprecation block already in place)
affects:
  - src/server.ts (5 new server.registerResource calls)
  - src/tool-registry.ts (5 description-only edits)
  - src/memory/resources/index.ts (5 new URI constants)
  - src/memory/index.ts (barrel re-exports)
  - evals/v1-baseline/baseline.test.ts (REL-08 describe block + DEPRECATED assertion)
  - evals/v1-baseline/tools-list.snapshot.json (regenerated with DEPRECATED descriptions)
  - evals/v1-baseline/resources-list.snapshot.json (NEW)
  - scripts/smoketest-non-claude.mjs (DEPRECATED_TOOLS + EXPECTED_RESOURCE_URIS assertions)
  - package.json (eval:snapshot chains both dumps)
tech-stack:
  added: []
  patterns:
    - RFC 6570 reserved expansion ({+docId}) for path-style URI variables
    - MCP Resource-template listing via client.listResourceTemplates()
    - Resource read handler delegates to existing internal handler (GAT-01 seam preservation)
key-files:
  created:
    - src/resource-registry.ts
    - evals/v1-baseline/dump-resources.mjs
    - evals/v1-baseline/resources-list.snapshot.json
  modified:
    - src/server.ts
    - src/tool-registry.ts
    - src/memory/resources/index.ts
    - src/memory/index.ts
    - evals/v1-baseline/baseline.test.ts
    - evals/v1-baseline/tools-list.snapshot.json
    - scripts/smoketest-non-claude.mjs
    - package.json
    - dist/cli.js
    - dist/cli.js.map
decisions:
  - "Templated Resources surface via resources/templates/list (SDK 1.29); smoketest unions client.listResources() + client.listResourceTemplates()"
  - "backlinks Resource uses RFC 6570 reserved expansion {+docId} to preserve `/` in multi-segment paths"
  - "Snapshot test for resources committed in Task 2 with placeholder failures, made green by Task 4 — single executor, ordering safe"
metrics:
  duration: ~25min
  completed: 2026-05-19
requirements:
  - REL-08
---

# Phase 8 Plan 5: REL-08 Resource promotions Summary

Promoted 5 list-style v1 tools to MCP Resources to land the canonical (non-deprecated) tool surface at exactly 32. Each promotion is additive: the tool stays callable through v2.x with a DEPRECATED notice in its description, and a parallel MCP Resource is registered. Resource read handlers delegate to the same internal handler functions the v1 tool handlers already call — no logic duplication (GAT-01 seam preservation).

## Tool → Resource Map

| v1 Tool          | New MCP Resource URI                                   | Resource Read Delegate    |
| ---------------- | ------------------------------------------------------ | ------------------------- |
| `list_vaults`    | `vault-memory://vaults`                                | `handleListVaults`        |
| `list_models`    | `vault-memory://models/{vault}`                        | `listModels`              |
| `recent_notes`   | `vault-memory://recent/{vault}`                        | `handleRecentNotes`       |
| `vault_stats`    | `vault-memory://stats/{vault}`                         | `handleVaultStats`        |
| `list_backlinks` | `vault-memory://backlinks/{vault}/{+docId}`            | `listBacklinks`           |

The `list_backlinks` Resource uses RFC 6570 reserved expansion (`{+docId}`) so multi-segment docIds (e.g. `notes/sub/file.md`) parse as a single value instead of being truncated at the first `/`.

## Tool descriptions edited (5)

Each description got a `DEPRECATED since v2.0.0 — prefer MCP Resource <uri>...` suffix in `src/tool-registry.ts`:

- `list_vaults` (line ~42) — references `vault-memory://vaults`
- `list_backlinks` (line ~198) — references `vault-memory://backlinks/{vault}/{+docId}`
- `list_models` (line ~341) — references `vault-memory://models/{vault}`
- `vault_stats` (line ~448) — references `vault-memory://stats/{vault}`
- `recent_notes` (line ~459) — references `vault-memory://recent/{vault}`

`name` and `inputSchema` are byte-identical to pre-edit for all 5 entries — only the `description` field changed.

## Snapshot counts (canonical for v2.0.0)

| Surface | Snapshot file                                       | Count | Notes                                                  |
| ------- | --------------------------------------------------- | ----- | ------------------------------------------------------ |
| tools   | `evals/v1-baseline/tools-list.snapshot.json`        | 37    | 5 entries carry "DEPRECATED" in description           |
| resources | `evals/v1-baseline/resources-list.snapshot.json`  | 10    | 5 pre-existing + 5 newly promoted                      |

Canonical (non-deprecated) tool surface = 37 − 5 = **32** + **10 Resources**.

## Final test count

- `npm test`: 1661 passed, 11 skipped (135 test files)
- `npm run eval:baseline`: 34 passed, 11 skipped (45 — added 4 new: DEPRECATED count, snapshot equality, length === 10, path-style docId roundtrip)
- `node scripts/smoketest-non-claude.mjs`: PASSED, including new assertions:
  - `REL-08 — 5 v1 tools annotated DEPRECATED in description`
  - `REL-08 — resources/list returned all 10 Resource URIs (5 existing + 5 promoted)`
- `npm run build`: success (`dist/cli.js` 556.69 KB)

## Commits

| # | Hash    | Task | Message |
|---|---------|------|---------|
| 1 | `fb4734f` | Task 1 | feat(08-05): add URI constants + canonical RESOURCES literal |
| 2 | `c7fcf37` | Task 2 + 5 prep | feat(08-05): register 5 new MCP Resources + backlinks roundtrip test |
| 3 | `d763d26` | Task 3 | docs(08-05): annotate 5 v1 tools as DEPRECATED in tool-registry |
| 4 | `a70c938` | Task 4 | chore(08-05): regenerate snapshots + add dump-resources.mjs |
| 5 | `a55ad2b` | Task 6 | test(08-05): extend non-Claude smoketest with REL-08 assertions |

Task 5's content (RESOURCES snapshot describe block + DEPRECATED-count assertion in baseline.test.ts) was landed in Task 2's commit because they share file boundaries. The plan's intended outcomes are all delivered.

Task 7 (full CI sweep) had no code changes — just the verification run; results recorded above.

## Deviations from Plan

### Mid-task discoveries (auto-resolved)

**1. [Rule 1 — Bug] Templated MCP Resources surface under `resources/templates/list`, not `resources/list`**
- **Found during:** Task 6 smoketest first run
- **Issue:** The MCP spec separates static-URI Resources (`resources/list`) from templated Resources (`resources/templates/list`). The initial smoketest query relied on `client.listResources()` alone and reported 6 missing URIs.
- **Fix:** Smoketest now also calls `client.listResourceTemplates()` and unions both URI sets before the presence check.
- **Files modified:** `scripts/smoketest-non-claude.mjs`
- **Commit:** `a55ad2b`

**2. [Rule 1 — Bug] In-process `client.callTool` requires a Zod input schema, not `undefined`**
- **Found during:** Task 2 backlinks roundtrip test first run
- **Issue:** Registering the test-mirror `list_backlinks` tool with `inputSchema: undefined` caused the SDK to drop the arguments object; the handler received `{vault: undefined, path: undefined}` and the tool returned `isError: true`.
- **Fix:** Pass a Zod object schema `{ vault: z.string(), path: z.string() }` to `server.registerTool`.
- **Files modified:** `evals/v1-baseline/baseline.test.ts`
- **Commit:** `c7fcf37`

### Out-of-scope discoveries (logged, not fixed)

**Phase-7 carryover I-2 violation in `src/plugin-tools/set-mcp-client.ts:33`** — already documented in `deferred-items.md` as out-of-scope for Phase 8. `npm run lint:check` still fails on this single line; per the orchestrator brief, do not fix.

## Threat Surface Scan

No new threat surface introduced. Each Resource read handler delegates to an existing internal handler (T-08-05-T mitigation as planned). The `{+docId}` reserved-expansion form (T-08-05-U mitigation) is exercised end-to-end by the path-style roundtrip test in `baseline.test.ts`.

## Self-Check: PASSED

- src/resource-registry.ts: FOUND
- evals/v1-baseline/dump-resources.mjs: FOUND
- evals/v1-baseline/resources-list.snapshot.json: FOUND (10 entries, backlinks template includes `{+docId}`)
- evals/v1-baseline/tools-list.snapshot.json: FOUND (37 entries, exactly 5 with DEPRECATED)
- Commits fb4734f, c7fcf37, d763d26, a70c938, a55ad2b: all present in `git log`
