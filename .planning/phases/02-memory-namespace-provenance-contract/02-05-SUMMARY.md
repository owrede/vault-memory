---
phase: 02-memory-namespace-provenance-contract
plan: 05
subsystem: memory
tags:
  [
    mem-03,
    recall,
    citation-packet,
    d-01,
    mcp-tool,
    tools-list-snapshot,
    seam-preservation,
    yaml-date-coercion,
  ]
dependency_graph:
  requires:
    - .planning/phases/02-memory-namespace-provenance-contract/02-02-SUMMARY.md (MemorySinkRegistry, decomposeDocId, sink-resolved path prefix)
    - .planning/phases/02-memory-namespace-provenance-contract/02-04-SUMMARY.md (controller-shape model, tool-registry pattern, server dispatch wiring)
    - docs/v2/MEMORY_CONTRACT.md (default-memory-v1 — supplies observed_at + status + confidence + type keys)
    - docs/v2/adr/004-memory-sink-handles.md (sink resolution + path-prefix invariant)
    - docs/v2/adr/002-adapter-seams.md (SourceConnector.formatDisplayUrl — the URL-construction seam)
    - src/tool-registry.ts (TOOLS literal + TOOL_SCHEMAS — single source of truth for tools/list)
    - src/search/hybrid.ts (Phase 1 hybridSearch; recall is layered on top, search_hybrid surface unchanged)
    - src/adapters/source/types.ts (Phase 1 SourceConnector.readDocument + optional formatDisplayUrl)
  provides:
    - handleRecall(deps, args) — MEM-03 controller (recall MCP tool)
    - RecallArgs / RecallDeps / RecallSearchHybridInput types
    - CitationPacket type (8 D-01 fields) — shared with Phase 3 ASM-05
    - toCitationPacket(doc, displayUrl) mapper
    - displayUrlFor(docId, source) — adapter-seam delegation wrapper
    - TOOLS literal extended with `recall` (snapshot grows 25 → 26)
    - TOOL_SCHEMAS.recall Zod 4 raw shape
  affects:
    - Phase 3 ASM-05 (assembly tools) — consumes CitationPacket type
    - Plan 02-06 (MCP Resources memory_stats / list_sinks) — recall surface complete
    - Plan 02-07 (fixture extension A→B→C Spire chain) — recall already hides superseded docs, the new chain verifies in 02-07's integration
    - v1-baseline regression suite — tools-list snapshot now has 26 entries; 23 v1 entries byte-identical (Plan 02-04 pin preserved)
tech_stack:
  added: []
  patterns:
    - Controller-shape model (Plan 02-04 precedent): `handleRecall(deps, args)`
      accepts a `RecallDeps` closure-bag + a `RecallArgs` struct. The
      server-side dispatch in `src/server.ts` builds the deps from
      bootstrap-time singletons (memorySinkRegistry, manager,
      per-vault SourceConnector, hybridSearch closure).
    - Adapter-seam delegation for display URLs: `displayUrlFor(docId, source)`
      delegates to the optional `SourceConnector.formatDisplayUrl(id)` rather
      than encoding the obsidian:// URL inline — keeps src/memory/ free of
      adapter-specific URL literals (I-5b lint invariant).
    - Pure controller: no `node:fs`, no `node:path`, no `gray-matter`,
      no `chokidar` under `src/memory/tools/recall.ts`. All side effects
      flow through the SourceConnector + MemorySinkRegistry + searchHybrid
      closures.
    - YAML Date coercion (Rule 1 bug fix): `observed_at` arrives as a
      JS `Date` from gray-matter (canonical ISO triggers the YAML
      timestamp schema rule). `observedAtIso(value)` accepts both Date
      and string and emits a canonical ISO string for filter + sort.
    - Filter-then-sort-then-truncate (D-01): hide superseded → filter
      provenance → sort `observed_at` DESC with mtime tiebreak →
      truncate to `args.limit ?? 20`. Truncate is LAST so e.g.
      `limit: 5` always returns the 5 newest qualifying packets.
    - Post-filter approach (RESEARCH §Q7): inner `searchHybrid` runs
      with `top_k: 200`; recall filters down to sink-resolved paths.
      User-approved fallback (NOT shipped) is to add
      `include_paths?: string[]` to `search_hybrid` if benchmarks ever
      show this is too slow. Phase 2 ships the post-filter; the
      fallback is documented in `recall.ts`'s top-of-file comment.
    - 8-field D-01 packet floor: CitationPacket has exactly
      `{doc_id, source_handle, title, heading_path, mtime, hash,
      display_url, properties}` — Phase 3 may extend additively;
      Phase 2 ships all 8 as the floor.
    - Read-side `hash` naming: packet `hash` mirrors `Document.hash`
      (the canonical content hash returned by
      `SourceConnector.readDocument`). DISTINCT from write-side
      `WriteSuccess.newHash` returned by record_observation / supersede.
      Both names are correct in their respective domains; the packet
      uses the read-side name because citation packets are read
      artifacts.
    - Defensive shallow-copy in the mapper: `toCitationPacket` spreads
      `properties` and `heading_path` so caller mutations on the
      returned packet cannot leak back into the source `Document`.
key_files:
  created:
    - src/memory/citation-packet.ts
    - src/memory/citation-packet.test.ts
    - src/memory/tools/recall.ts
    - src/memory/tools/recall.test.ts
    - .planning/phases/02-memory-namespace-provenance-contract/02-05-SUMMARY.md
  modified:
    - src/memory/index.ts (re-export CitationPacket + toCitationPacket + displayUrlFor)
    - src/memory/tools/index.ts (barrel: re-export handleRecall + RecallArgs/RecallDeps)
    - src/tool-registry.ts (TOOLS gains recall; TOOL_SCHEMAS.recall raw shape)
    - src/tool-registry.test.ts (length pin 25 → 26; +6 recall schema cases)
    - src/server.ts (handleRecall dispatch; searchHybrid closure passed as a dep)
    - src/server.test.ts (length pin 25 → 26 in Plan 02-04 block; +6 MEM-03 end-to-end cases)
    - evals/v1-baseline/tools-list.snapshot.json (regenerated; 26 entries)
    - evals/v1-baseline/baseline.test.ts (length pin 25 → 26)
decisions:
  - "displayUrlFor() delegates to SourceConnector.formatDisplayUrl()
    rather than encoding obsidian://open?vault=…&file=… inline. The
    plan's Task 1 action block showed an inline implementation, but
    the I-5b lint rule (`obsidian://` literal allowed only in source
    adapter / types / registry / server.ts) blocked the literal under
    src/memory/. The seam delegation preserves the plan's INTENT
    (`display_url` field on the packet is the obsidian:// URL when
    reading an obsidian-fs doc) while honoring the adapter-seam
    architecture. Phase 3 Notion / Slack adapters publish their own
    deep-link URLs through the same seam without touching
    src/memory/."
  - "observed_at coercion handles both string AND Date inputs.
    Discovered during Task 3 integration trace: gray-matter
    (via js-yaml) deserializes canonical ISO-8601 timestamps as JS
    Date objects via the YAML `tag:yaml.org,2002:timestamp` schema
    rule. The v2 fixture's frontmatter contains unquoted ISO
    timestamps, so `Document.properties.observed_at` arrives as a
    Date — not a string. The previous `typeof === 'string'`
    narrowing dropped every fixture doc. The new helper
    `observedAtIso(value)` returns a canonical ISO string for both
    shapes and `null` for unparseable inputs. The helper is used
    by both the `max_age_days` filter and the `observed_at` sort.
    Pinned by a co-located test case."
  - "Recall dispatch in src/server.ts wraps the controller output as
    `{packets, count}` for the MCP response shape. Other tools use
    the same envelope convention (`{hits, count}`, `{entries, count}`,
    `{notes, count}`). The plan's must_have truth #2 says the result
    shape is 'a list of citation packets' — the controller still
    returns the bare array; the server adds the standard envelope at
    the dispatch boundary."
  - "Recall's inner searchHybrid is wired via a closure so the
    controller stays decoupled from the embedding-model / Ollama
    surface. The bootstrap closure forwards the production
    `defaultModel` + `ollama` instance; unit tests inject a stub
    returning a fixed candidate list. This mirrors the
    `deliveryAdapterFor` / `sourceConnectorFor` closures already in
    use for record_observation / supersede."
  - "DocId vault-name extraction in the packet-mapping loop uses
    `decomposeDocId` from src/adapters/registry.js (consumed, not
    duplicated per Plan 02-02's single-resolver rule). Earlier draft
    inlined the regex split — caught during cleanup; switched to the
    canonical helper before commit."
  - "Test-side YAML Date assertion uses a local `toIso()` coercer
    rather than introducing a `String.prototype.toMatch`-friendly
    cast on every test. Mirrors what the controller does internally
    so the test assertion line reads naturally."
metrics:
  duration: "~50 min"
  completed: 2026-05-15
  tasks_completed: 3
  commits: 3
  files_created: 5
  files_modified: 8
  tests_added: 31
  baseline_tests_before: 732
  total_tests_after: 763
---

# Phase 2 Plan 02-05: Memory-Read Tool Slice (Recall + Citation Packet) Summary

**One-liner:** Lands `recall` (MEM-03) — the third and final memory MCP
tool — together with the **D-01 8-field `CitationPacket`** shape that
Phase 3 ASM-05 will import unchanged. `handleRecall` routes a
natural-language query through the existing `searchHybrid` pipeline
with a generous `top_k: 200`, post-filters to sink-resolved paths,
loads full `Document` objects via `SourceConnector.readDocument` for
canonical hash + property bag, applies provenance filters
(`status≠"superseded"` → `min_confidence` → `types` → `max_age_days`),
sorts `observed_at` DESC with `mtime` tiebreak, then truncates to
`limit`. The controller is **seam-pure** (no `node:fs / node:path /
gray-matter / chokidar`); display URLs flow through the adapter's
`formatDisplayUrl` seam so the `obsidian://` literal stays inside the
obsidian-fs adapter (I-5b). One **Rule 1 bug fix** landed during Task 3
integration: YAML deserializes canonical ISO timestamps as `Date`
objects, not strings — a new `observedAtIso(value)` helper accepts both
shapes. The tools/list snapshot grows from 25 → 26 entries; the 23 v1
entries remain byte-identical (Plan 02-04 pin preserved).

## What Was Built

Three atomic commits landed the slice:

### Task 1 — CitationPacket type + mapper + displayUrlFor (commit `2ba7fa4`)

- **`src/memory/citation-packet.ts`** — the D-01 packet shape:
  ```typescript
  export interface CitationPacket {
    doc_id: DocId;
    source_handle: SourceHandle;
    title: string;
    heading_path: string[];
    mtime: number;
    hash: string;            // read-side Document.hash
    display_url: string;
    properties: Record<string, unknown>;
  }
  ```
  Plus:
  - `toCitationPacket(doc, displayUrl)` — maps a `Document` (or its
    read-side subset) into a packet. Shallow-copies `properties` and
    `heading_path` so caller mutations cannot leak back into the
    source.
  - `displayUrlFor(docId, source)` — adapter-seam wrapper that calls
    `source.formatDisplayUrl?.(docId) ?? docId`. Keeps the
    `obsidian://` URL literal inside the obsidian-fs adapter per the
    I-5b lint invariant; future Notion/Slack adapters publish their
    own deep-link conventions through the same seam.
- **`src/memory/citation-packet.test.ts`** — 8 cases:
  - 8-field shape pin (key-set assertion).
  - `packet.hash` mirrors `Document.hash` (negative pin: no `newHash`
    field on the packet).
  - `heading_path` defaults to `[]` when absent.
  - Mutating `packet.heading_path` does not affect the source doc.
  - Mutating `packet.properties` does not affect the source doc.
  - `displayUrlFor` delegates to `source.formatDisplayUrl`.
  - Fallback to DocId string when adapter omits `formatDisplayUrl`.
  - Fallback when `formatDisplayUrl` returns `null`.
- **`src/memory/index.ts`** re-exports the new symbols so Phase 3
  ASM-05 imports `CitationPacket` from the same public surface.

### Task 2 — handleRecall + tool-registry wiring + co-located tests (commit `694b9d2`)

- **`src/memory/tools/recall.ts`** — the controller:
  ```typescript
  export interface RecallArgs {
    query: string;
    min_confidence?: "direct" | "inferred" | "uncertain";
    types?: string[];
    max_age_days?: number;
    sink?: string;
    limit?: number;
    vaults?: string[];
  }
  export async function handleRecall(
    deps: RecallDeps, args: RecallArgs,
  ): Promise<CitationPacket[]>;
  ```
  Pipeline:
  1. Resolve sinks (single via `args.sink` OR all configured).
  2. Intersect with `args.vaults` if provided.
  3. Inner `searchHybrid` with `top_k: 200`.
  4. Post-filter to sink-resolved paths (`hit.vault === sink.vault &&
     hit.notePath.startsWith(sink.resolveToRelativePath)`).
  5. De-dupe by `(vault, notePath)` — best score wins.
  6. Load full `Document` via `SourceConnector.readDocument`.
  7. Apply filters in order: hide `status: "superseded"` →
     `min_confidence` ordinal → `types` exact-match → `max_age_days`
     window.
  8. Sort `observed_at` DESC, `mtime` DESC tiebreak.
  9. Truncate AFTER sort.
  10. Map each surviving Document → `CitationPacket` (display URL via
      the adapter seam).
- **`src/memory/tools/recall.test.ts`** — 11 vitest cases (10 in
  Task 2, +1 added in Task 3 for the YAML-Date fix):
  - Happy path: 4/5 docs (superseded hidden) in `observed_at` DESC
    order, 8 fields each, `hash` mirrors `Document.hash`,
    `display_url` starts with `obsidian://`.
  - `min_confidence: "inferred"` excludes uncertain.
  - `types: ["observation"]` excludes non-observation.
  - `max_age_days: 30` excludes 60d-old doc.
  - `status: "superseded"` hidden by default.
  - `limit: 2` returns exactly 2 newest after filter+sort.
  - Empty search → `[]`.
  - Unknown sink throws (`/Unknown memory sink/`).
  - Each packet `display_url` is the canonical obsidian:// URL.
  - Sink scoping: `sink: "default"` excludes archive-sink docs;
    multi-sink default queries both.
  - YAML Date coercion (added in Task 3 deviation): observed_at as a
    JS `Date` is correctly filtered + sorted.
- **`src/memory/tools/index.ts`** barrel re-exports `handleRecall` +
  types.
- **`src/tool-registry.ts`** — `TOOLS` gains the `recall` literal
  entry (preserves JSON-snapshot stability); `TOOL_SCHEMAS.recall`
  declares the Zod 4 raw shape with per-field `.describe()`:
  ```typescript
  recall: {
    query: z.string().min(1)...,
    min_confidence: z.enum([...])...,
    types: z.array(z.string().min(1))...,
    max_age_days: z.number().int().positive()...,
    sink: z.string().min(1)...,
    limit: z.number().int().positive().max(200)...,
    vaults: z.array(z.string().min(1))...,
  }
  ```
- **`src/tool-registry.test.ts`** — 6 new schema cases; length pin
  25 → 26.
- **`src/server.ts`** — `recall` handler in the dispatch map.
  Constructs `RecallDeps` from `memorySinkRegistry`, `manager`,
  per-vault `SourceConnector` via the adapter registry, and a
  `searchHybrid` closure that forwards the production
  `defaultModel` + `ollama` instance. Response envelope:
  `{packets, count}` (mirrors `{hits, count}` and `{entries, count}`).
- **`evals/v1-baseline/tools-list.snapshot.json`** regenerated via
  `node evals/v1-baseline/dump-tools.mjs` (26 entries).
- **`evals/v1-baseline/baseline.test.ts`** length pin 25 → 26.

### Task 3 — Server-level MEM-03 integration tests + YAML-Date fix (commit `ff51abe`)

- **`src/server.test.ts`** — new `describe("Plan 02-05: MEM-03 recall
  end-to-end")` block, 6 cases:
  - `tools/list` includes `recall` + the 25 prior entries = 26 total.
  - `recall({query: "Atlas pilot"})` against the v2 fixture: live
    2026-04-16 doc returned; 2026-04-20 `status: superseded` doc
    hidden. 8 D-01 fields per packet; `display_url` starts with
    `obsidian://`; `hash` non-empty.
  - `recall({types: ["brief"]})` filters out observation-typed docs.
  - `recall({limit: 3, max_age_days: 3650})` returns 3 packets in
    `observed_at` DESC order across mixed sinks (10-year window is
    clock-drift-stable).
  - `recall({sink: "nonexistent"})` throws (caught by server.ts
    try/catch at the dispatch boundary).
  - Zod-boundary: empty query rejected by `buildToolSchema("recall")`.
- **`src/memory/tools/recall.ts`** — Rule 1 bug fix: new
  `observedAtIso(value)` helper accepts both `Date` and `string`
  inputs and returns a canonical ISO string. The filter
  (`max_age_days` window) and the sort (`observed_at` DESC) both use
  it. The previous `typeof === "string"` narrowing dropped every
  YAML-Date-shaped doc.
- **`src/memory/tools/recall.test.ts`** — +1 case pinning the
  YAML-Date coercion (Date object filtered + sorted correctly).

## Verification Performed

```bash
# Per-task automated checks
npx vitest run --no-coverage src/memory/citation-packet.test.ts        # Task 1: 8 ✓
npx vitest run --no-coverage src/memory/tools/recall.test.ts \
  src/tool-registry.test.ts                                            # Task 2: 11 + 22 ✓
node evals/v1-baseline/dump-tools.mjs > /tmp/snap.json && \
  diff /tmp/snap.json evals/v1-baseline/tools-list.snapshot.json       # snapshot in sync ✓
npx vitest run --no-coverage src/server.test.ts                        # Task 3: 33 ✓

# Plan <verification> block
npx vitest run --no-coverage                          # 763 / 774 (11 todo) ✓
npx tsc --noEmit                                      # clean ✓
bash scripts/lint-adapters.sh                         # all I-* + I-5b + C-1 green ✓
npm run eval:baseline                                 # 30 / 41 (11 todo) v1-baseline green ✓
```

Test count delta:
- Plan 02-05 added 31 new tests:
  - 8 citation-packet.test.ts
  - 11 recall.test.ts (10 + 1 YAML-Date case)
  - 6 tool-registry.test.ts (recall schema)
  - 6 server.test.ts (MEM-03 end-to-end)
- Net total: 732 → 763 passing.

## Deviations from Plan

Two deviations — both inside Rule 1 / Rule 2 latitude. No
architectural changes; no plan-intent drift.

### [Rule 2 — Missing critical functionality] displayUrlFor delegates through the SourceConnector seam

The plan's Task 1 action block specified:

```typescript
export function displayUrlFor(docId: DocId): string {
  const parts = decomposeDocId(docId);
  if (parts.scheme === "obsidian-fs") {
    const vaultParam = encodeURIComponent(parts.authority);
    const fileParam = encodeURIComponent(parts.resource);
    return `obsidian://open?vault=${vaultParam}&file=${fileParam}`;
  }
  return docId;
}
```

Wiring that into `src/memory/citation-packet.ts` tripped the I-5b lint
invariant (the `obsidian://` URL literal is allowed only under
`src/adapters/source/obsidian-fs/`, `src/adapters/source/types.ts`,
`src/adapters/registry.ts`, or `src/server.ts`). The fix:
`displayUrlFor(docId, source)` now delegates to the optional
`SourceConnector.formatDisplayUrl(id)` (ADR-002 §SourceConnector — the
single licensed minting site for adapter-specific deep-link URLs).
When the adapter omits the method or returns `null`, the helper falls
back to the DocId string so callers always get a non-null
`display_url` on the citation packet.

This change is invisible at the packet surface: an `obsidian-fs`
DocId still produces an `obsidian://open?vault=…&file=…` URL byte-for-
byte identical to what the inline implementation would have emitted
(verified by an `obsidian-fs/index.ts:formatDisplayUrl` test that pre-
dates this plan + the new recall.test.ts case asserting the exact
output string). The recall controller calls `decomposeDocId` to extract
the vault name, resolves the source via the existing
`sourceConnectorFor` closure, and forwards it to `displayUrlFor`.

- **Files modified:** `src/memory/citation-packet.ts`,
  `src/memory/citation-packet.test.ts`, `src/memory/tools/recall.ts`
- **Commits:** `2ba7fa4` (initial), `694b9d2` (refactor on recall wire)

### [Rule 1 — Bug] observed_at coercion handles JS Date objects

YAML frontmatter parsers (`gray-matter` → `js-yaml`) deserialize
canonical ISO-8601 timestamps via the YAML
`tag:yaml.org,2002:timestamp` schema rule, producing JS `Date`
objects — not strings. The v2 fixture's frontmatter uses unquoted ISO
timestamps:

```yaml
observed_at: 2026-04-22T08:00:00Z
```

so `Document.properties.observed_at` arrives as
`Date { 2026-04-22T08:00:00.000Z }`. The Task 2 implementation
narrowed on `typeof === "string"`, which dropped every fixture doc.
Discovered during Task 3 integration trace; fixed inline with a new
helper:

```typescript
function observedAtIso(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}
```

Both the `max_age_days` filter and the `observed_at` sort use the
helper. A co-located test case (`"filters + sorts correctly when
observed_at is a JS Date object (not a string)"`) pins the behavior.

- **Files modified:** `src/memory/tools/recall.ts`,
  `src/memory/tools/recall.test.ts`, `src/server.test.ts`
- **Commit:** `ff51abe`

## Authentication Gates

None. Greenfield read-side code on top of the existing search +
adapter substrates; no external services touched.

## Truths Verified (from plan `must_haves.truths`)

- ✓ **MCP tool `recall({query, min_confidence?, types?, max_age_days?,
  sink?})` returns a list of citation packets from memory-sink-scoped
  documents** — verified by `recall.test.ts > happy path` and the
  server-level `recall on the v2 fixture` cases.
- ✓ **Result shape is the Phase 3 citation-packet floor: 8 fields per
  packet** — pinned by `citation-packet.test.ts > toCitationPacket
  returns exactly the 8 D-01 fields, all present` + every
  `recall.test.ts` happy-path case asserts the same key-set.
- ✓ **Packet `hash` is the READ-SIDE `Document.hash` field** — pinned
  by `citation-packet.test.ts > packet.hash mirrors Document.hash
  (read-side; never aliased to newHash)` and a negative assertion
  `(packet as Record<string, unknown>).newHash).toBeUndefined()`.
- ✓ **`properties` in each packet contains the contract-required keys
  plus contract-allowed extras** — verified by the happy-path test
  asserting `properties.confidence`, `properties.type`,
  `properties.status` after `toCitationPacket` and by the v2 fixture
  test asserting `properties.observed_at`.
- ✓ **Filter pipeline applies BEFORE truncation** — pinned by
  `recall.test.ts > limit: 2 returns exactly the 2 newest packets
  after filter+sort` (limit applied AFTER `observed_at` sort).
- ✓ **When `sink` is omitted, all configured memory sinks are
  queried; results merged before sort+truncate** — pinned by the
  multi-sink `handleRecall — sink scoping` test where the archive-sink
  doc is included in `recall({})` but excluded in
  `recall({sink: "default"})`.
- ✓ **When `sink` is provided, only that single sink's documents are
  returned** — same test as above; archive doc excluded when
  `sink: "default"`.
- ✓ **Documents with `status: "superseded"` are hidden by default** —
  pinned by `recall.test.ts > hides status:'superseded' docs by
  default` and `server.test.ts > 'Atlas pilot' returns the live ...
  doc; the 2026-04-20 superseded doc is hidden`.
- ✓ **Implementation routes through `search_hybrid` with post-filter
  on memory-sink-resolved paths** — confirmed by source inspection
  (`recall.ts` calls `deps.searchHybrid(...)` and filters by
  `hit.notePath.startsWith(sink.resolveToRelativePath)`).
- ✓ **`decomposeDocId` consumed from `src/adapters/registry.ts`, NOT
  duplicated** — confirmed by `grep`:

  ```bash
  grep -n decomposeDocId src/memory/tools/recall.ts
  # src/memory/tools/recall.ts:64:import { decomposeDocId, formatDocId } from "../../adapters/registry.js";
  # src/memory/tools/recall.ts:194:    const { authority: vaultName } = decomposeDocId(doc.id);
  ```
- ✓ **Dependency on 02-04 was real: both plans modify the same
  cross-cutting files** — verified by inspecting the commit graph
  (Plan 02-04 commits `1ee9d00`/`8dd5b73`/`9daba33` touch the same
  set of files this plan touches; sequencing recall in wave 3 after
  02-04's wave 2 avoided the merge conflict).

## Known Stubs

None. Every behavior in the plan's `<behavior>` blocks is wired
end-to-end with co-located tests. The contingency `include_paths`
fallback (RESEARCH §Q7) is documented in `recall.ts`'s top-of-file
comment but explicitly NOT shipped per the plan — that lands only if a
future benchmark on a large vault shows the post-filter is too slow.

## Threat Flags

None.

The added surface is a pure read-side controller on top of the
already-vetted Phase 1 hybridSearch + Phase 1 ObsidianFsSource
adapters:

- `handleRecall` reads only `args` + the `MemorySinkRegistry` (sole
  resolver per ADR-004 §Resolution) + the `SourceConnector` (for
  `readDocument` to access `Document.hash` + properties) + the
  injected `searchHybrid` closure. No FS, no network, no DB beyond
  what the embedded `hybridSearch` already touches in Phase 1.
- `search_hybrid` API surface unchanged — recall is a CONSUMER. The
  contingency `include_paths?: string[]` parameter is documented but
  not added; the Phase 1 surface (and its existing pinned snapshot
  entry) is byte-identical.
- The new `obsidian://` URL exposure to the agent flows through the
  same `SourceConnector.formatDisplayUrl` seam that the v1 `search`
  / `fetch` tools have used since Phase 1 — no new attack surface.
- The new YAML `Date` coercion (`observedAtIso`) only accepts inputs
  that are `Date` or `string`; any other shape (number, object,
  array, null) returns `null` and the doc is dropped from the
  `max_age_days`-filtered results. Cannot be exploited to bypass
  filters with crafted property values.

## Commits

| Task | Commit  | Description                                                              |
| ---- | ------- | ------------------------------------------------------------------------ |
| 1    | 2ba7fa4 | feat(02-05): add CitationPacket type + mapper + displayUrlFor            |
| 2    | 694b9d2 | feat(02-05): handleRecall controller + tool-registry wiring              |
| 3    | ff51abe | test(02-05): MEM-03 end-to-end recall integration + YAML Date fix        |

## Requirements Touched

- **MEM-03** — `recall` MCP tool registered, Zod-validated at the
  handler boundary, schema published in `TOOL_SCHEMAS.recall`,
  end-to-end tested (controller-level + server-level), routes through
  `search_hybrid` with post-filter on memory-sink-resolved paths,
  hides `status: "superseded"` by default, applies the
  `min_confidence` / `types` / `max_age_days` provenance filters in
  the documented order, sorts `observed_at` DESC with `mtime`
  tiebreak, truncates to `limit ?? 20` AFTER filter+sort, and returns
  the 8-field D-01 CitationPacket. **Fully delivered.**

MEM-02 (record_observation), MEM-04 (supersede), MEM-05 (validator),
MEM-06 (config), MEM-11 (v1 write-tool refusal of memory targets) are
all closed in earlier Phase 2 plans. With MEM-03 landed, the Phase 2
ROADMAP success criterion #2 (record_observation + recall + supersede
all routed through the appropriate seams) is fully satisfied.

## Self-Check

- File `src/memory/citation-packet.ts` exists ✓
- File `src/memory/citation-packet.test.ts` exists ✓
- File `src/memory/tools/recall.ts` exists ✓
- File `src/memory/tools/recall.test.ts` exists ✓
- File `.planning/phases/02-memory-namespace-provenance-contract/02-05-SUMMARY.md` exists ✓
- File `src/memory/index.ts` modified ✓
- File `src/memory/tools/index.ts` modified ✓
- File `src/tool-registry.ts` modified ✓
- File `src/tool-registry.test.ts` modified ✓
- File `src/server.ts` modified ✓
- File `src/server.test.ts` modified ✓
- File `evals/v1-baseline/tools-list.snapshot.json` regenerated ✓
- File `evals/v1-baseline/baseline.test.ts` modified ✓
- Commit `2ba7fa4` exists on branch ✓
- Commit `694b9d2` exists on branch ✓
- Commit `ff51abe` exists on branch ✓
- Plan `<verification>` block passes: `npx vitest run --no-coverage`
  reports 763 / 774 (11 todo); `npx tsc --noEmit` clean; `bash
  scripts/lint-adapters.sh` all I-* + I-5b + C-1 green;
  `node evals/v1-baseline/dump-tools.mjs --check` snapshot in sync;
  `npm run eval:baseline` 30 / 41 (11 todo) green ✓

## Self-Check: PASSED
