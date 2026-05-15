---
phase: 01
plan: 04
plan_id: 01-04
subsystem: adapters
status: complete
tags: [adapters, delivery, obsidian-fs, conformance, stub, client-info, display-url, git-mv]
requirements: [ADP-02, ADP-06, ADP-13]
dependency_graph:
  requires: [01-01, 01-02, 01-03]
  provides: [ObsidianFsDelivery, StubDelivery, delivery conformance suite, D-01 rewire, D-02 capture]
  affects: [src/server.ts, src/frontmatter/update.ts, src/adapters/stub/source.ts]
tech_stack:
  added: []
  patterns: [v1-to-v2-WriteResult mapping at facade seam, lazy clientId getter closure, shared-Map StubSource+StubDelivery]
key_files:
  created:
    - src/adapters/delivery/obsidian-fs/index.ts (now ObsidianFsDelivery facade + legacy re-exports)
    - src/adapters/delivery/obsidian-fs/index.test.ts (12 cases)
    - src/adapters/delivery/conformance.test.ts (22 cases)
    - src/adapters/stub/delivery.ts (StubDelivery)
    - src/adapters/stub/delivery.test.ts (10 cases)
  modified:
    - src/adapters/delivery/obsidian-fs/write.ts (DEFAULT_CLIENT_ID hardcode removed; import-path rewrites)
    - src/adapters/delivery/obsidian-fs/fs.ts (import-path rewrites only; safeJoinInsideVault byte-identical)
    - src/adapters/delivery/obsidian-fs/write.test.ts (import-path rewrites only)
    - src/adapters/delivery/obsidian-fs/fs.test.ts (no changes — sibling imports preserved)
    - src/adapters/stub/source.ts (Map-passing overload + inner() escape hatch)
    - src/frontmatter/update.ts (gray-matter + node:fs imports REMOVED; routes via Source/Delivery)
    - src/server.ts (D-01 obsidianUrl deleted; D-02 lazy clientId; write/update/delete handlers reroute)
    - src/server.test.ts (obsidianUrl tests retargeted to ObsidianFsSource.formatDisplayUrl; D-02 fallback test added)
  removed:
    - src/write/ (empty directory; all files git mv'd to src/adapters/delivery/obsidian-fs/)
decisions:
  - "URL encoding parity reconciliation strategy (a): preserve byte-for-byte. ObsidianFsSource.formatDisplayUrl and v1 obsidianUrl produce IDENTICAL output; no adjustment needed. v1-baseline eval url field unchanged."
  - "Lazy clientId getter (string | () => string) constructor signature lets the server bootstrap the registry BEFORE the MCP initialize handshake while still surfacing post-handshake client_info via getClientVersion()?.name."
  - "Watcher suppression hook (onBeforeFsWrite) was inside writeNote/deleteNote. The v2 DeliveryAdapter surface does not expose it; we now call suppression.add() in the handler BEFORE dispatching. Over-suppresses by ~2s TTL on failed writes — harmless."
  - "v1 WriteResult shape (with noteId: number) preserved at the wire boundary for the write_note / delete_note MCP tools. The DeliveryAdapter v2 shape (with doc_id: DocId) is the internal contract; handlers derive noteId from the DB after the write."
metrics:
  duration_seconds: 1196
  duration_human: "~20 minutes"
  tests_added: 44 (10 stub + 12 obsidian-fs facade + 22 conformance — 2 facade-specific obsidian-fs tests inside conformance.test.ts)
  total_tests_passing: 540 (was 510)
  completed_date: 2026-05-15
---

# Phase 01 Plan 04: Delivery adapter extraction + D-01 formatDisplayUrl rewire + D-02 client_info capture + StubDelivery + conformance

DeliveryAdapter seam landed end-to-end: `src/write/*` relocated to
`src/adapters/delivery/obsidian-fs/`, wrapped in an `ObsidianFsDelivery`
facade, write/update/delete tool handlers route through
`registry.resolveDelivery(handle)`, MCP `client_info` captured via a
lazy getter to replace the `"claude-code"` hardcode (D-02), `obsidianUrl`
helper deleted in favor of `source.formatDisplayUrl` (D-01), conformance
proven by a parameterized test bank over `[obsidian-fs, stub]` adapters.

## URL encoding parity

**Audit of v1 `obsidianUrl()` at `src/server.ts:957`** (the helper being deleted
in Task 06 step D, per D-01):

```typescript
export function obsidianUrl(vaultName: string, notePath: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(notePath)}`;
}
```

Behavior:
- Uses `encodeURIComponent` per-segment (`vaultName` and `notePath` are each
  encoded independently).
- Spaces become `%20`; `#` becomes `%23`; `?` becomes `%3F`; `/` becomes `%2F`.
- Per-segment encoding (NOT whole-URL `encodeURI`).

**Comparison against 01-03's `ObsidianFsSource.formatDisplayUrl`** at
`src/adapters/source/obsidian-fs/index.ts:154`:

```typescript
formatDisplayUrl(id: DocId): string {
  const rel = this.docIdToPath(id);
  const vault = encodeURIComponent(this.vault.name);
  const file = encodeURIComponent(rel);
  return `obsidian://open?vault=${vault}&file=${file}`;
}
```

**Verdict: byte-for-byte identical.** Both use `encodeURIComponent` per-segment
on the same two fields (`vault.name`, `rel` path) and produce the exact same
template string `obsidian://open?vault=${vault}&file=${file}`.

**Reconciliation strategy chosen: (a) — preserve byte-for-byte.**

No adjustment needed in `src/adapters/source/obsidian-fs/index.ts`. Task 06
deleted `obsidianUrl()` and rewired call sites to
`source.formatDisplayUrl(docId)` without any change to the eval baseline's
`url` field. Verified post-rewire by:
- `npm run eval:baseline` → 29 passed, 11 todo — pre-plan baseline preserved.
- `tools-list.snapshot.json` byte-equality test still GREEN (unchanged).
- Replaced the v1 `obsidianUrl` unit tests in `src/server.test.ts` with
  equivalent tests against `ObsidianFsSource.formatDisplayUrl` asserting the
  SAME input → output pairs. Parity pinned at the unit-test level.

(Strategy (b) — regenerating the v1-baseline `url` fixtures with maintainer
sign-off — was the explicit fallback. Not needed.)

## Task-by-task

| Task | Commit | Summary |
|------|--------|---------|
| 01-04-01 | `dec0316` | `git mv src/write/*` → `src/adapters/delivery/obsidian-fs/`; import-path rewrites; W4 pre-read landed |
| 01-04-02 | `efd73ba` | `ObsidianFsDelivery` facade implements `DeliveryAdapter`; `DEFAULT_CLIENT_ID="claude-code"` removed |
| 01-04-03 | `5b9d97b` | `StubDelivery` (in-memory; shared-Map with `StubSource` via overloaded constructor) |
| 01-04-04 | `84ac6d3` | Parameterized `DeliveryAdapter` conformance suite (10 cases × 2 adapters + 2 obsidian-fs-only invariants) |
| 01-04-05 | `0911f20` | `src/frontmatter/update.ts` routes via Source/Delivery; gray-matter + node:fs imports REMOVED |
| 01-04-06 | `f42306d` | `server.ts`: D-02 lazy clientId capture; D-01 `obsidianUrl` deleted; write/update/delete handlers reroute through `delivery.*` |
| 01-04-07 | `8d15cdf` | Empty `src/write/` removed; lazy clientId getter signature finalized |

## Conformance test results

10 cases × 2 adapters (`obsidian-fs`, `stub`), gated on published capabilities:

| Case | obsidian-fs | stub | Gated on |
|------|-------------|------|----------|
| 1. publishes honest DeliveryCapabilities (4 keys) | PASS | PASS | — |
| 2. handle has `<scheme>://<authority>` shape | PASS | PASS | — |
| 3. write(new id) → ok, created:true | PASS | PASS | — |
| 4. write(existing id) → ok, created:false | PASS | PASS | hashProtected (strong supplies expectedHash) |
| 5. update(unknown id) → not_found | PASS | PASS | — |
| 6. delete(known id) → ok; re-write shows created:true | PASS | PASS | hashProtected (strong supplies expectedHash) |
| 7. hashProtected=strong REJECTS conflicting expectedHash | PASS | (gated out) | hashProtected===strong |
| 8. hashProtected=none IGNORES expectedHash | (gated out) | PASS | hashProtected===none |
| 9. WriteResult.doc_id round-trips input DocId | PASS | PASS | — |
| 10. delete(unknown id) → not_found | PASS | PASS | — |
| +obsidian-fs only: file actually on disk after write | PASS | — | — |
| +obsidian-fs only: path traversal rejected via `safeJoinInsideVault` | PASS | — | — |

All cases pass. The honest-capabilities I-7 contract is the bedrock: every
behavioral assertion that differs across adapters is GATED on the
`hashProtected` capability descriptor — we never test "strong" behavior
against the stub.

## v1 backwards-compat

| v1 Tool | Snapshot Untouched | Handler Routed Through Delivery? | Output Shape Preserved? |
|---------|---|---|---|
| `write_note` | YES | YES via `handleWriteNote` → `delivery.write(docId, partial, opts)` | YES — `{ok, noteId, newHash, created, reason?, ...}` v1 shape (noteId derived from DB) |
| `update_frontmatter` | YES | YES via refactored `updateFrontmatter` (registry-aware) | YES — merge DSL + diff emission preserved |
| `delete_note` | YES | YES via `handleDeleteNote` → `delivery.delete(docId, opts)` | YES — `{ok, noteId, newHash, created}` shape |
| `read_note` | YES | NO (plan 01-03 routed it via Source) | YES |
| `fetch` | YES | NO; the `url` field now flows through `source.formatDisplayUrl` (byte-identical per parity audit) | YES |
| `search` | YES | NO (DB-backed); the `url` field now flows through `source.formatDisplayUrl` | YES |
| All other 18 tools | YES | NO | YES |

`evals/v1-baseline/tools-list.snapshot.json` byte-equality test GREEN —
all 23 v1 tools still in the snapshot with unchanged input schemas.

## D-02 client_info capture

The lazy-getter pattern was the key implementation decision. The MCP SDK's
`Server.getClientVersion()` returns `undefined` until the `initialize`
handshake completes, but the AdapterRegistry must be populated at
bootstrap so handlers can resolve adapters synchronously on every tool
call. Resolution:

```typescript
let serverRef: Server | undefined;
const getClientId = (): string => serverRef?.getClientVersion()?.name ?? "unknown";
for (const vault of manager.list()) {
  const delivery = new ObsidianFsDelivery(vault, getClientId); // <-- lazy
  adapterRegistry.registerDelivery(delivery.handle, delivery);
}
// ... later ...
serverRef = server;
await server.connect(transport);
```

Every write reads `serverRef.getClientVersion()?.name` at call time, so:
- Pre-handshake writes (none in practice, but defensive) → `"unknown"`.
- Post-handshake writes by a conformant MCP client → e.g. `"claude-code"`,
  `"claude-desktop"`, `"chatgpt"`, etc. — the value the client itself
  reports.
- Post-handshake writes by a non-conformant client that didn't send
  optional `clientInfo` (RESEARCH Pitfall 4) → `"unknown"`.

Per-call `opts.clientId` (when supplied via the v1 `client_id` tool arg)
still overrides the default. Audit-log attribution is now honest:
"unknown" when we don't know, the client's self-reported name when we do.

## StubDelivery + StubSource shared-Map (plan-checker W2)

The conformance test's "delete known id → exists check" case (#6) uses
the indirect "subsequent write of same DocId shows created:true again"
assertion. But for direct read-after-write observability, `StubDelivery`
and `StubSource` can share their backing `Map<DocId, Document>` —
`StubSource`'s constructor now accepts `Document[] | Map<DocId, Document>`
(additive overload) and exposes the underlying map via `.inner()`.
`src/adapters/stub/delivery.test.ts` has a dedicated round-trip case
that wires both adapters to the same map and reads back a write
immediately.

## Phase 2 seam preservation

The `DeliveryAdapter.write()` interface signature is UNCHANGED. The
TSDoc note in `src/adapters/delivery/types.ts` lines 28–40 still flags
the entry point for Phase 2 MemorySink guards A (provenance required)
and B (`source:agent` outside configured sink rejected).
`ObsidianFsDelivery.write()` has ONLY the Phase 1 safety in place
(`write_enabled` flag check + `safeJoinInsideVault` path safety + OCC
via `expectedHash`). No Phase 1 code blocks Phase 2's guard insertion.

## Notes for plan 01-05 (change-feed extraction)

- `chokidar` is still in `src/watcher/` (untouched by this plan).
- The `AdapterRegistry` already exposes `registerChangeFeed` /
  `resolveChangeFeed` (from plan 01-01); plan 01-05 will wire an
  `ObsidianFsChangeFeed` instance into it.
- The watcher-suppression hook semantics changed slightly here: the
  v1 `onBeforeFsWrite` callback inside `writeNote`/`deleteNote` is now
  fired by the MCP handler BEFORE dispatching to delivery (server.ts
  cases for `write_note` + `delete_note`). This over-suppresses by
  ~2s TTL on failed writes (harmless). Plan 01-05 may revisit whether
  the change-feed should expose a "suppress this path for N ms"
  surface in its public API.

## Notes for Phase 2 (memory namespace MEM-01..12)

- `DeliveryAdapter.write()` is the single chokepoint for memory-sink
  guards. The TSDoc note signals the seam.
- Phase 2 inserts guard A + guard B INSIDE `ObsidianFsDelivery.write()`
  (and inside future adapters' `write()` methods). The interface
  signature does not change.
- `WriteOptions.sink?: MemorySinkHandle` is already declared (plan
  01-01); Phase 1 implementations accept-and-ignore.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Facade `update()` re-write conflict on Phase-1 callers**

- **Found during:** Task 04 conformance test for `update`.
- **Issue:** `ObsidianFsDelivery.update()` called `writeNote` without
  passing `expectedHash`. For an existing file, `writeNote` then refused
  the write with `hash_mismatch` (the v1 "file already exists, supply
  expectedHash" guard). Conformance case 5/6 hit this.
- **Fix:** Compute the current on-disk hash from the just-read
  `existingBody` + `existingFm` via `computeNoteHash`, and pass it
  through as `effectiveExpectedHash` when the caller didn't supply
  one. Caller-supplied `opts.expectedHash` still wins. Documented
  inline in `index.ts`.
- **Commit:** `84ac6d3` (Task 04).

**2. [Rule 3 — Blocking issue] Lazy clientId getter signature**

- **Found during:** Task 06 wiring.
- **Issue:** The MCP SDK's `Server.getClientVersion()` returns `undefined`
  until the `initialize` handshake completes. We populate the
  `AdapterRegistry` BEFORE `server.connect()`, so a static `clientId:
  string` constructor would freeze in "unknown" forever.
- **Fix:** `ObsidianFsDelivery` constructor accepts `string | (() => string)`.
  The server passes a lazy closure `() => serverRef?.getClientVersion()
  ?.name ?? "unknown"`. The getter is invoked on every `delivery.write()`
  / `.update()` / `.delete()` call — post-handshake calls see the real
  client name, pre-handshake calls see "unknown".
- **Commit:** `8d15cdf` (Task 07).

**3. [Rule 1 — Bug] `updateFrontmatter` re-write conflict on no-opts**

- **Found during:** Task 05 test pass.
- **Issue:** Same root cause as deviation #1, but via the refactored
  `updateFrontmatter` path. Calling `delivery.write()` without
  `expectedHash` would surface as `hash_mismatch` for the second-edit
  case.
- **Fix:** When `opts.expectedHash` is omitted, pass `currentHash`
  (just read from the source) through as the OCC token. The user's
  caller-supplied `opts.expectedHash` (from the v1 tool arg) is checked
  earlier in the function and still gates first.
- **Commit:** `0911f20` (Task 05).

### Auth gates

None encountered.

## Self-Check: PASSED

- All 7 task commits exist in `git log`: `dec0316`, `efd73ba`, `5b9d97b`,
  `84ac6d3`, `0911f20`, `f42306d`, `8d15cdf`.
- All created files exist on disk (verified via `ls` of paths in
  `key_files.created`).
- `npm run lint:check` (tsc --noEmit) — clean.
- `npm test` — 540 tests pass across 48 files (11 todo).
- `npm run eval:baseline` — 29 passed, 11 todo. tools-list.snapshot.json
  byte-equality GREEN.
- `grep "obsidianUrl|DEFAULT_CLIENT_ID|claude-code" src/server.ts` →
  comment references only (no production code).
- `grep "gray-matter\|node:fs" src/frontmatter/update.ts` → comment
  references only (no imports).
- `safeJoinInsideVault` preserved BYTE-FOR-BYTE: `git log --follow
  src/adapters/delivery/obsidian-fs/fs.ts` shows the rename from
  `src/write/fs.ts` with import-path-only changes (no edits to
  function bodies).
- `test -d src/write` → false. Directory fully removed.
