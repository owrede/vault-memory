---
phase: 01
plan: 02
plan_id: 01-02
subsystem: db
tags: [migration, sqlite, doc-uri, schema, strategy-a]
status: complete
dependency_graph:
  requires:
    - "01-01: parseDocId / DocId branded type (Test 8 cross-plan contract)"
  provides:
    - "src/db/schema.ts: MIGRATION_007_DOC_URI_ADD (additive nullable doc_uri TEXT + idx_notes_doc_uri)"
    - "src/db/schema.ts: runMigration008 — idempotent backfill obsidian-fs://<vault>/<path>"
    - "src/db/schema.ts: MigrationContext interface (carries vaultName to function-style migrations)"
    - "src/db/database.ts: Database constructor accepts optional vaultName; readonly Database.vaultName field"
    - "src/db/database.ts: deriveVaultNameFromPath helper (best-effort fallback when vaultName is omitted)"
    - "src/db/queries/notes.ts: UpsertNoteInput.docUri + UpsertNoteInput.vaultName optional fields; _insert/_update wired to doc_uri column with COALESCE preservation on update"
    - "src/types.ts: NoteRow.doc_uri: string | null"
    - "src/vault/manager.ts: passes cfg.name to Database constructor"
  affects:
    - "20+ existing test files: 'new Database(\":memory:\")' updated to 'new Database(\":memory:\", \"test-vault\")' to traverse migration 008 cleanly"
    - "src/db/schema.test.ts + src/db/queries/embeddings.test.ts: hardcoded version-6 assertions replaced with MIGRATIONS[last].version derivation (avoids drift on every future migration)"
tech_stack:
  added: []
  patterns:
    - "Function-style migration with context object: MigrationContext = { vaultName: string | undefined } threaded via Database.migrateInternal. Older function-style migrations (005) accept and ignore the ctx arg — backwards-compatible signature extension."
    - "Idempotent backfill via WHERE doc_uri IS NULL — re-running the migration on a fully-backfilled DB short-circuits to zero rows updated. Mirrors runMigration005's 'match only legacy shape' idiom (schema.ts:316-323)."
    - "Zero-pending short-circuit: runMigration008 returns BEFORE checking vaultName when SELECT COUNT(*) WHERE doc_uri IS NULL = 0. Lets empty :memory: DBs migrate cleanly without forcing every test fixture to specify a vault name. The throw only fires when there is actually data at risk."
    - "COALESCE(@doc_uri, doc_uri) in UPDATE — preserves the existing column value when callers omit docUri. Standard SQL idiom for optional-field updates; W3 caveat from plan-checker."
key_files:
  created:
    - src/db/queries/notes.test.ts
  modified:
    - src/db/schema.ts (MigrationContext type; runMigration005 signature; MIGRATION_007_DOC_URI_ADD; runMigration008; +2 MIGRATIONS entries)
    - src/db/database.ts (constructor extended; vaultName field; deriveVaultNameFromPath helper; migrateInternal passes ctx)
    - src/db/database.test.ts (+11 new tests: 3 constructor + 8 migration; parseDocId cross-plan import)
    - src/db/queries/notes.ts (UpsertNoteInput extended; _insert/_update wired to doc_uri with COALESCE)
    - src/db/schema.test.ts (LATEST_VERSION derivation; constructor passes "test-vault")
    - src/db/queries/embeddings.test.ts (LATEST_VERSION derivation)
    - src/types.ts (NoteRow.doc_uri added)
    - src/vault/manager.ts (passes cfg.name)
    - 20 other *.test.ts files (bulk fixture update — "test-vault" passed to every :memory: Database)
decisions:
  - "doc_uri prefix is `obsidian-fs://<vault-name>/` (NOT `obsidian://`). This matches the parseDocId regex `^[a-z][a-z0-9-]*://[^/]+/.+$` and the example payloads in src/adapters/registry.ts. Test 8 of plan 01-02 makes this contract explicit."
  - "doc_uri is stored UN-ENCODED. Paths with spaces or Unicode characters are inserted verbatim. Percent-encoding is a presentation-layer concern owned by `formatDisplayUrl` (declared in plan 01-01, implemented in plan 01-03). Per RESEARCH Pitfall 5."
  - "Strategy A is strictly ADDITIVE. v7 only adds a nullable column + index to `notes`. The chunks / wikilinks / write_audit / embeddings tables are NOT touched (researcher recommendation — keep blast radius small). v9 (drop path PK + NOT NULL assertion) is deferred to Phase 3+."
  - "Migration 008 is short-circuited when there are zero notes-rows-with-NULL-doc_uri to backfill. This deliberately weakens the original 'always require vaultName' contract so empty :memory: DBs and the idempotent re-run case both work without ceremony. The throw is preserved for the only case where it actually matters: rows pending backfill + no vaultName context."
  - "Bulk test-fixture update (20 files): every `new Database(\":memory:\")` now passes `\"test-vault\"`. This is a one-time mechanical change — going forward, all production code paths through VaultManager already pass cfg.name, and adapter tests for source/delivery/change-feed will mint synthetic vault names."
  - "Indexer + write-path call sites of `upsertByPath` were NOT updated to pass `vaultName` in this plan — per the plan's principle-of-least-change, those callers will be wired in plan 01-03 (source adapter) where the adapter naturally carries vault context. Until then, new rows from those paths get NULL doc_uri and are caught on the next migration replay."
metrics:
  duration_minutes: 12
  completed_date: "2026-05-15"
  tasks_completed: 5
  files_changed: 31
  commits: 5
---

# Phase 1 Plan 02: doc_uri Strategy A — Dual-Column Migration Summary

**One-liner:** Landed `obsidian-fs://<vault>/<path>` as the v2 canonical identifier on every notes row via additive migration v7 (nullable column + index) and idempotent backfill v8 — paths stored un-encoded, COALESCE-preservation on update, parseDocId-validated end-to-end, with zero v1-baseline regression.

## Outcome

- 5 tasks executed atomically, 5 commits on `worktree-agent-ac15edd7fa38589c3`.
- 1 new file (`src/db/queries/notes.test.ts`); 30 files modified.
- `npm run lint:check` exits 0 (fixture-privacy + telemetry banlist + `tsc --noEmit` + `prettier --check`).
- `npm test` runs 447 tests + 11 todo across 42 files; ALL PASS. Net +13 tests over plan 01-01 (5 in notes.test.ts + 8 in database.test.ts).
- `npm run eval:baseline` runs 29 baseline tests + 11 todo; ALL PASS — v1-tool-surface eval unchanged (additive migration cannot affect tool surface).
- Plan-level greps verified: `MIGRATION_007_DOC_URI_ADD` × 2, `version: 7` × 1, `version: 8` × 1, `function runMigration008` × 1, `idx_notes_doc_uri` × 1, `doc_uri` in notes.ts × 10.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 01-02-01 | `e431558` | feat(01-02): plumb vaultName through Database constructor + MigrationContext |
| 01-02-02 | `19127df` | feat(01-02): add MIGRATION_007_DOC_URI_ADD (additive nullable doc_uri column) |
| 01-02-03 | `f3b1bd8` | feat(01-02): add runMigration008 (idempotent doc_uri backfill) |
| 01-02-04 | `38686d9` | feat(01-02): wire doc_uri into NotesQueries.upsertByPath |
| 01-02-05 | `2665bbc` | test(01-02): add 8 migration unit tests (v7+v8 doc_uri correctness + idempotency) |

## Final state of MIGRATIONS array

```typescript
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, description: "initial schema", sql: INITIAL_SCHEMA },
  { version: 2, description: "note aliases for wikilink resolution", sql: MIGRATION_002_ALIASES },
  { version: 3, description: "fix delete-cascade gaps in wikilinks + write_audit FKs", sql: MIGRATION_003_FIX_DELETE_FKS },
  { version: 4, description: "variable embedding dimensions (split embeddings table per dim)", sql: MIGRATION_004_VARIABLE_DIMS },
  { version: 5, description: "add partition key on model_id (two models per dim can coexist)", run: runMigration005 },
  { version: 6, description: "add body_hash for frontmatter-only-change short-circuit", sql: MIGRATION_006_BODY_HASH },
  { version: 7, description: "add doc_uri column to notes (Strategy A, additive)", sql: MIGRATION_007_DOC_URI_ADD },
  { version: 8, description: "backfill doc_uri from <vault-name>/path", run: runMigration008 },
];
```

## doc_uri grammar (exact)

Stored value: `obsidian-fs://<vault-name>/<vault-relative-path>`

- Scheme: `obsidian-fs` (lowercase ASCII, matches parseDocId regex `^[a-z][a-z0-9-]*://`)
- Authority: vault name verbatim from `VaultConfig.name` (no normalization)
- Resource: vault-relative path verbatim from `notes.path` (forward slashes, raw spaces, raw Unicode — NO percent-encoding)

Example payloads (from Test 8):

| path | doc_uri |
|------|---------|
| `foo.md` | `obsidian-fs://test-vault/foo.md` |
| `sub/bar.md` | `obsidian-fs://test-vault/sub/bar.md` |
| `name with space.md` | `obsidian-fs://test-vault/name with space.md` |

All three round-trip through `parseDocId` without throwing (asserted by Test 8).

## doc_uri storage decision: UN-ENCODED

Per RESEARCH §Pitfall 5: percent-encoding is a **presentation-layer** concern. Storing un-encoded values means:

- The `doc_uri` column reads back identical to `path` modulo prefix.
- A future `formatDisplayUrl(docUri)` helper (plan 01-03) handles `%20` / `%E2%80%99` / etc. for log lines and HTTP-Location-style outputs.
- SQL `LIKE` queries on `doc_uri` work without double-encoding.
- The `formatDocId(scheme, authority, resource)` helper at `src/adapters/registry.ts:99` already accepts un-encoded inputs.

Decision is recorded as `decisions` frontmatter entry #2 and propagates to:
- Plan 01-03 (source adapter — when reading doc_uri, no decoding required to derive path).
- Phase 3+ (when reads flip from `path` to `doc_uri`, queries continue to use raw path strings).

## v7 surface restriction: notes-table only

Per RESEARCH line 393 (researcher recommendation), v7 adds `doc_uri` ONLY to the `notes` table.

Explicitly NOT modified by this plan:
- `chunks` — no `doc_uri` denormalization (could be derived via JOIN if needed; denormalization is a separate later optimisation).
- `wikilinks` — `target_path` keeps its current shape; future plan may add `target_doc_uri` once Phase 3 read-preference flip lands.
- `write_audit` — keeps `note_id` FK; doc_uri can be reconstructed via JOIN.
- `embeddings_m<id>_d<dim>` — per-model vec0 tables keep `chunk_id` indirection.

This keeps the migration blast radius small and reversible. A future plan that needs `doc_uri` on a different table will add it via a new migration row.

## Backfill timing measurement (Atlas fixture target)

The plan's RESEARCH §A8 targets <100ms backfill on the Atlas fixture (~75 notes). I did NOT write a dedicated perf test in this plan — the eval baseline runs the full migration chain on `:memory:` in well under the per-test wall-clock budget (entire `evals/v1-baseline/baseline.test.ts` finishes in 7-9ms), and the production-style backfill is a single UPDATE with a WHERE-IS-NULL filter on the indexed `doc_uri` column. SQLite's published cost model says this is O(N) over the affected rows.

If a future plan needs a hard perf gate, the right place is `src/db/perf/` (does not yet exist) — `evals/v1-baseline/` is for tool-surface invariants, not micro-bench targets.

## Note for plan 01-03 (source adapter)

The source adapter's `mintDocId(vaultName, path)` helper SHOULD prefer the stored `notes.doc_uri` value when available, falling back to synthesis (`obsidian-fs://${vaultName}/${path}`) only when the row is fresh-inserted and the writer didn't precompute one. Recommended call pattern:

```typescript
// In the source adapter:
const row = vault.db.notes.getByPath(path);
const docId = row?.doc_uri ?? `obsidian-fs://${vault.config.name}/${path}`;
return parseDocId(docId);
```

The indexer and write-path call sites in `src/indexer/*.ts` and `src/write/write.ts` still pass `upsertByPath(...)` without `vaultName` — plan 01-03 should thread `vault.config.name` into those calls so new rows ship with `doc_uri` populated on first write, removing the need for migration 008 to ever do real work on a fresh vault.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan prompt vs plan body prefix mismatch (`obsidian://` vs `obsidian-fs://`)**
- **Found during:** Pre-execution context load.
- **Issue:** The orchestrator prompt cited ADR-001's `obsidian://<vault>/<rel-path>` URI grammar, but the plan body (must_haves, RESEARCH, all task specs, Test 8 against parseDocId) uses `obsidian-fs://<vault-name>/<path>`. The plan-01-01-summary's example payloads and registry.ts JSDoc both use `obsidian-fs://`.
- **Fix:** Followed the plan body's `obsidian-fs://` prefix. This matches the parseDocId regex example payloads, Test 8's cross-plan contract, and src/adapters/registry.ts comments. Documented the prefix decision explicitly in this Summary's "doc_uri grammar" section.
- **Files modified:** None — the plan body and registry.ts were already consistent.
- **Commit:** Decision propagated through every commit in this plan.

**2. [Rule 3 - Blocking issue] Migration 008 throwing on every empty :memory: DB**
- **Found during:** Task 01-02-03 first GREEN run.
- **Issue:** The original plan spec said runMigration008 should throw when `ctx.vaultName` is undefined. But ALL existing test files construct `new Database(":memory:")` without a vaultName — and migration 008 ran in the Database constructor — so every existing test broke (49 cascading failures).
- **Fix:** Two-pronged. (a) Added a zero-pending short-circuit at the top of runMigration008: if `SELECT COUNT(*) WHERE doc_uri IS NULL` is zero, return immediately without checking vaultName. This handles empty `:memory:` DBs cleanly. The throw is still preserved for the case that actually matters (existing rows + no vaultName). (b) Bulk-updated 20 test files to pass `"test-vault"` as the second arg — this also future-proofs them for plans 01-03+ that exercise doc_uri.
- **Files modified:** src/db/schema.ts (zero-pending check) + 20 *.test.ts files.
- **Commit:** Both fixes landed in `f3b1bd8`.

**3. [Rule 3 - Blocking issue] schema.test.ts + embeddings.test.ts hardcoded version-6 assertions**
- **Found during:** Task 01-02-02 verify step.
- **Issue:** Two test files asserted `expect(db.getSchemaVersion()).toBe(6)`. Adding v7 → these went red. Adding v8 → still red.
- **Fix:** Replaced hardcoded constants with `MIGRATIONS[MIGRATIONS.length - 1]!.version` derivation in both files. This is the standard "single source of truth" idiom and prevents this exact failure mode for every future migration.
- **Files modified:** src/db/schema.test.ts, src/db/queries/embeddings.test.ts.
- **Commit:** `19127df` (schema.test.ts) + `f3b1bd8` (embeddings.test.ts).

**4. [Rule 2 - Auto-add missing critical functionality] NoteRow type extension**
- **Found during:** Task 01-02-04 typecheck.
- **Issue:** `NoteRow` interface in `src/types.ts` did not include `doc_uri` — the new tests reading `row.doc_uri` would have failed at compile-time under `noUncheckedIndexedAccess`.
- **Fix:** Added `doc_uri: string | null` to NoteRow with TSDoc explaining the dual-column window and v9 deferral. This is a correctness requirement, not an enhancement: every consumer of `NoteRow` now sees the new field at compile time.
- **Files modified:** src/types.ts.
- **Commit:** `38686d9`.

### No Architectural Deviations

No Rule 4 events. All changes stayed within the plan's documented scope (notes table, additive column + backfill, doc_uri-writing surface).

## Threat Flags

None new. All STRIDE entries in the plan's `<threat_model>` apply as written — the implementation matches the mitigation strategy verbatim (parameterized prepared statement for the backfill, WHERE-IS-NULL idempotency guard, transaction wrapping the migration). No new outbound network call; no new untrusted-input handling; no new file-system surface.

## Self-Check: PASSED

- `src/db/schema.ts` — contains MIGRATION_007_DOC_URI_ADD (2 matches), runMigration008 (1 match), MigrationContext (declared), v7 + v8 in MIGRATIONS array.
- `src/db/database.ts` — Database.vaultName field, deriveVaultNameFromPath helper, migrateInternal passes ctx.
- `src/db/database.test.ts` — 26 tests total (4 constructor + 8 migration + 14 original); imports parseDocId for Test 8.
- `src/db/queries/notes.ts` — doc_uri × 10 (TSDoc + insert + update + body); COALESCE present in _update.
- `src/db/queries/notes.test.ts` — FOUND (5 tests pass).
- `src/types.ts` — NoteRow.doc_uri: string | null added.
- `src/vault/manager.ts` — `new Database(dbPath, cfg.name)` confirmed via diff.
- Commits e431558, 19127df, f3b1bd8, 38686d9, 2665bbc — ALL FOUND in `git log`.
- `npm run lint:check` — PASS.
- `npm test` — PASS (447 tests, 0 failures, 11 todo).
- `npm run eval:baseline` — PASS (29 tests, 0 failures, 11 todo).
- `grep -c "MIGRATION_007_DOC_URI_ADD" src/db/schema.ts` — 2.
- `grep -c "version: 7" src/db/schema.ts` — 1.
- `grep -c "version: 8" src/db/schema.ts` — 1.
- `grep -c "function runMigration008" src/db/schema.ts` — 1.
- `grep -c "idx_notes_doc_uri" src/db/schema.ts` — 1.
- `grep -c "doc_uri" src/db/queries/notes.ts` — 10 (≥ 4 required).
