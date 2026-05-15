---
phase: 02-memory-namespace-provenance-contract
plan: 06
subsystem: audit + mcp-resources
tags: [sqlite, migration, mcp-sdk, mcp-resources, audit-log, memory-sink]

# Dependency graph
requires:
  - phase: 02-memory-namespace-provenance-contract
    provides: MemorySinkRegistry + sentinel + DeliveryAdapter facade (Plans 02-02 / 02-03)
  - phase: 02-memory-namespace-provenance-contract
    provides: record_observation + supersede tools writing under opts.sink (Plans 02-04 / 02-05)
provides:
  - audit discriminator column `is_memory_sink_write` (migration v9) + partial index for memory-only filtering
  - `RecordWriteInput.isMemorySinkWrite` + `ListWritesFilter.isMemorySinkWrite`
  - `AuditLogEntry.is_memory_sink_write` boolean + `getAuditLog({is_memory_sink_write})` filter
  - `audit_log` MCP tool input schema gains optional `is_memory_sink_write` (description unchanged)
  - `vault-memory://memory/sinks` MCP Resource (list registered sinks)
  - `vault-memory://memory/stats` MCP Resource (per-sink doc_count / by_type / by_status / last_write_at)
  - `docs/tools/audit_log.md` canonical doc for the new filter (replaces description-text bump)
affects:
  - Future memory-eval phases (sink-level usage telemetry from the stats Resource)
  - Phase 5/6 polling/subscription enhancements (currently polled-only)
  - Audit-log consumers — output rows gain one additive boolean field

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Function-style migration (idempotent) for column additions when fixture tests rewind user_version"
    - "Pure-function MCP Resource handlers (registry / DB queries only — no fs)"
    - "Polled-only MCP Resources (no notifyResourceUpdated in v2.0.0)"
    - "Additive optional input fields preserve byte-identical v1 tool descriptions"

key-files:
  created:
    - src/memory/resources/list-sinks.ts
    - src/memory/resources/list-sinks.test.ts
    - src/memory/resources/memory-stats.ts
    - src/memory/resources/memory-stats.test.ts
    - src/memory/resources/index.ts
    - src/db/queries/audit.test.ts
    - docs/tools/audit_log.md
  modified:
    - src/db/schema.ts
    - src/db/types.ts
    - src/db/queries/audit.ts
    - src/db/queries/notes.ts
    - src/audit/audit.ts
    - src/audit/audit.test.ts
    - src/adapters/delivery/obsidian-fs/write.ts
    - src/adapters/delivery/obsidian-fs/write.test.ts
    - src/adapters/delivery/obsidian-fs/index.ts
    - src/adapters/stub/delivery.ts
    - src/tool-registry.ts
    - src/server.ts
    - src/server.test.ts
    - src/memory/index.ts
    - evals/v1-baseline/tools-list.snapshot.json

key-decisions:
  - "Migration v9 is function-style (idempotent) instead of pure SQL — keeps fixture tests that rewind user_version from crashing on duplicate-column errors, matches the runMigration005 / runMigration008 precedent."
  - "Audit discriminator flag derived at the DeliveryAdapter facade from opts.sink !== undefined — single derivation site; write/update/delete all consume the same shared WriteOptions.sink (no per-op options-type symmetry work)."
  - "audit_log MCP tool description text is byte-identical to Phase 1; the new is_memory_sink_write filter is additive in the input JSON Schema and documented in docs/tools/audit_log.md. Honors the v1 backwards-compat invariant."
  - "MCP Resources use flat URIs (per RESEARCH §Q4 + CONTEXT D-Q4): one Resource per capability, not per sink. Polled-only — no notifyResourceUpdated."
  - "memory-stats aggregates from per-vault SQLite (NotesQueries + AuditQueries) — no filesystem walk. ADR-002 I-2/I-3/I-4 preserved (no fs / path / gray-matter in src/memory/)."
  - "StubDelivery deliberately not extended with audit recording — it is in-memory only, audit is DB-backed. Inline comment added to call out the asymmetry for future maintainers."

patterns-established:
  - "Idempotent column-add migration: PRAGMA table_info(...) → conditional ALTER → IF NOT EXISTS index"
  - "MCP Resource handler shape: pure function over registry / DB; serialize via JSON.stringify(..., null, 2) at the registerResource callback"
  - "Per-sink stats: count via path-prefix LIKE (with backslash-escape for `%` / `_`), aggregate frontmatter JSON parse-tolerantly"
  - "Memory-only audit filter: SQLite partial index on (is_memory_sink_write, at DESC) WHERE is_memory_sink_write = 1"

requirements-completed:
  - MEM-08
  - MEM-09

# Metrics
duration: 16min
completed: 2026-05-15
---

# Phase 2 Plan 06: Audit Discriminator + MCP Resources Summary

**`is_memory_sink_write` audit column (migration v9) + two MCP Resources (`memory/sinks`, `memory/stats`) — distinguishes agent memory writes from user writes and exposes sink topology / usage stats without growing the tool surface.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-05-15T20:48:09Z
- **Completed:** 2026-05-15T21:04:49Z
- **Tasks:** 2
- **Files modified:** 15 (10 modified, 7 created including tests + docs)

## Accomplishments

- Migration v9 adds `is_memory_sink_write INTEGER NOT NULL DEFAULT 0` to `write_audit` + a partial index on `(is_memory_sink_write, at DESC) WHERE is_memory_sink_write = 1`. Idempotent (function-style) so fixture tests that rewind `user_version` keep working.
- `AuditQueries.recordWrite` / `listWrites` extended with the flag — Phase 1 callers default to `false` (zero call-site churn).
- The DeliveryAdapter facade (`ObsidianFsDelivery.write/update/delete`) derives the flag from `opts.sink !== undefined`. Sink-routed writes (`record_observation`, `supersede`) stamp `1`; v1 writes / `update_frontmatter` / `delete_note` stamp `0`.
- `audit_log` MCP tool gains an optional `is_memory_sink_write` filter (additive input field; description text byte-identical to Phase 1). New capability documented in `docs/tools/audit_log.md`.
- Two MCP Resources registered through `server.registerResource(...)`:
  - `vault-memory://memory/sinks` — returns `{total, sinks: [{name, handle, vault, contract, default, resolves_to}]}`.
  - `vault-memory://memory/stats` — returns `{total_docs, sinks: [{name, vault, handle, doc_count, by_type, by_status, last_write_at}]}`.
- Both Resources polled-only (CONTEXT D-Q4). MCP server now advertises the `resources` capability.
- 13 new tests (6 db-queries, 4 facade audit-discriminator, 3 resource list/read end-to-end via InMemoryTransport). Full suite: 790 passed / 11 todo / 0 failed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration v9 + audit shape extensions + write-path flag wiring** — `745133a` (feat)
2. **Task 2: list_sinks + memory_stats MCP Resources + server registration + tests** — `eeff1fe` (feat)

## Files Created/Modified

### Created

- `src/memory/resources/list-sinks.ts` — pure handler returning `{total, sinks: [...]}` from the registry.
- `src/memory/resources/memory-stats.ts` — per-sink doc/type/status counts + last-write timestamp from the DB.
- `src/memory/resources/index.ts` — barrel + canonical URI constants.
- `src/memory/resources/list-sinks.test.ts` — 3 cases (empty / multi-sink / explicit default).
- `src/memory/resources/memory-stats.test.ts` — 5 cases (empty / aggregation / last_write_at / missing vault / malformed FM).
- `src/db/queries/audit.test.ts` — 6 cases on the new column + filter; plus v1→v9 migration replay assertion.
- `docs/tools/audit_log.md` — documents the new optional filter (replaces MCP description-text bump).

### Modified

- `src/db/schema.ts` — appends migration v9 (function-style, idempotent).
- `src/db/types.ts` — adds `is_memory_sink_write: 0 | 1` to `WriteAuditRow`.
- `src/db/queries/audit.ts` — extends `RecordWriteInput` / `ListWritesFilter`; INSERT + WHERE bind the new column; adds `lastMemoryWriteAtForPathPrefix` for the stats Resource.
- `src/db/queries/notes.ts` — adds `countByPathPrefix` + `listByPathPrefix` (backslash-escaped LIKE) used by stats.
- `src/audit/audit.ts` — extends `AuditLogEntry` + `GetAuditLogInput`; maps DB 0/1 → JS boolean.
- `src/audit/audit.test.ts` — pins legacy-rows-as-false + new filter behavior.
- `src/adapters/delivery/obsidian-fs/write.ts` — `WriteNoteInput`/`DeleteNoteInput` gain `isMemorySinkWrite`; threaded into `recordWrite`.
- `src/adapters/delivery/obsidian-fs/write.test.ts` — adds writeNote/deleteNote + ObsidianFsDelivery facade cases stamping `0` vs `1`.
- `src/adapters/delivery/obsidian-fs/index.ts` — facade derives `isMemorySinkWrite: opts?.sink !== undefined` for write/update/delete.
- `src/adapters/stub/delivery.ts` — documents why no audit hook is added (in-memory, audit is DB-backed).
- `src/tool-registry.ts` — `audit_log` JSON Schema + Zod gain optional `is_memory_sink_write`; description text unchanged.
- `src/server.ts` — imports the resource symbols; advertises `resources` capability; registers both Resources after `setupMemorySinks`.
- `src/server.test.ts` — adds MEM-09 InMemoryTransport integration (resources/list + resources/read for both URIs) + MEM-08 audit-filter integration.
- `src/memory/index.ts` — re-exports the resource handlers + URI constants.
- `evals/v1-baseline/tools-list.snapshot.json` — regenerated; only diff is the additive `is_memory_sink_write` field on `audit_log.inputSchema`; description text byte-identical.

## Decisions Made

- **Function-style migration v9.** Pure SQL `ALTER ... ADD COLUMN` was the first attempt, but the existing embeddings-migration fixture (`embeddings.test.ts`) rewinds `user_version` to replay migrations on a DB whose `write_audit` already has the v9 column. SQLite has no `ADD COLUMN IF NOT EXISTS`, so a pure-SQL v9 trips with "duplicate column name". The function-style variant runs `PRAGMA table_info(write_audit)` first; matches the `runMigration005` / `runMigration008` precedent already in the file. Behavior on a clean v8→v9 upgrade is unchanged.
- **Single derivation site at the facade.** The audit flag is derived from `opts.sink !== undefined` exactly once (inside `ObsidianFsDelivery.write/update/delete`). The internal `writeNote`/`deleteNote` accept `isMemorySinkWrite` as a parameter; Phase 1 callers leave it `undefined` → `false`. This avoids re-deriving the flag at each call site and keeps the v1 fixture tests passing unchanged.
- **`audit_log` description text byte-identical.** The plan's must-have called out the v1 backwards-compat invariant — only the input schema gains a new optional field. Documentation for the new capability lives in `docs/tools/audit_log.md` instead. Verified by re-running `node evals/v1-baseline/dump-tools.mjs` and confirming only the inputSchema row changes.
- **`memory-stats` is DB-only, no filesystem walk.** `NotesQueries.countByPathPrefix` + `listByPathPrefix` query the indexed `notes` table; `AuditQueries.lastMemoryWriteAtForPathPrefix` uses the v9 partial index. No `node:fs` import added to `src/memory/` (ADR-002 I-2/I-3/I-4 preserved; verified by `scripts/lint-adapters.sh`).
- **Polled-only Resources.** CONTEXT D-Q4 + Deferred Ideas explicitly defer subscription/`notifyResourceUpdated` to Phase 5/6. The Resource handlers project from the registry and DB synchronously; agents re-read to refresh.
- **Tolerant frontmatter parsing in memory-stats.** Stored frontmatter that fails to JSON.parse is silently treated as empty (a corrupted row should not crash the Resource). The indexer writes well-formed JSON; this is a defensive hedge.

## Deviations from Plan

None — the plan executed as written. Two small implementation refinements worth calling out (still in scope of the plan's tasks):

1. Migration v9 changed from pure SQL to function-style (idempotent) — direct consequence of catching the fixture-test regression during the first test run. The behavior contract is unchanged.
2. Backslash-escape on `LIKE` prefixes — added because sink paths contain `_` (which is a LIKE wildcard). Cost: ~5 lines. Without it, a sink at `_memory/` would also match `Xmemory/`. Pure correctness fix.

## Issues Encountered

- **Initial migration v9 trip on fixture replay.** First run of `npm test` failed in `src/db/queries/embeddings.test.ts` because that test rewinds `user_version` to 3 to replay migrations against a hand-crafted v3 DB whose `write_audit` already carries the v9 column. Resolved by changing v9 from pure SQL to function-style with a `PRAGMA table_info` guard. All 790 tests then green.

## User Setup Required

None — no external service configuration. Migration v9 applies automatically on next `vault-memory serve` (or any DB open).

## Next Phase Readiness

- ROADMAP Phase 2 success criterion 4 ("audit + Resources slice") fully satisfied: MEM-08 + MEM-09 shipped.
- Wave 5 left a clean baseline; Wave 4 of this phase (which 02-06 belongs to per `wave: 4` frontmatter) builds on Plans 02-04 + 02-05 without altering their behavior.
- All 23 v1 tools remain byte-identical at the description-text level. `tools/list` count stays at 26 (23 v1 + 3 Phase 2 tools — no tools added here). New MCP Resources surface is additive.
- Next plan (02-07/02-08 per the phase plan ordering) can rely on:
  - `is_memory_sink_write` discriminator for any memory-only audit-export / telemetry work.
  - `vault-memory://memory/sinks` Resource for any agent-discovery flow.
  - `vault-memory://memory/stats` Resource for any per-sink usage / health reporting.

## Self-Check: PASSED

- `src/db/schema.ts` migration v9: FOUND
- `src/memory/resources/list-sinks.ts`: FOUND
- `src/memory/resources/memory-stats.ts`: FOUND
- `src/memory/resources/index.ts`: FOUND
- `src/memory/resources/list-sinks.test.ts`: FOUND
- `src/memory/resources/memory-stats.test.ts`: FOUND
- `src/db/queries/audit.test.ts`: FOUND
- `docs/tools/audit_log.md`: FOUND
- Commit `745133a` (Task 1): FOUND
- Commit `eeff1fe` (Task 2): FOUND
- `npx tsc --noEmit`: clean
- `npx vitest run --no-coverage`: 790 passed / 11 todo / 0 failed
- `bash scripts/lint-adapters.sh`: all green
- `node evals/v1-baseline/dump-tools.mjs` snapshot diff: only `audit_log.inputSchema` gained `is_memory_sink_write` (description bytes unchanged)

---

*Phase: 02-memory-namespace-provenance-contract*
*Completed: 2026-05-15*
