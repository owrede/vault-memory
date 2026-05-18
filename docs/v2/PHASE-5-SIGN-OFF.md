# Phase 5 — Sign-Off

**Phase:** 5 — Compiled brief layer
**Sign-off date:** 2026-05-18
**Branch:** `phase-5-compiled-brief-layer`
**Maintainer:** _to be recorded at PR approval time per D-17_
**Final tool count:** 34 tools + 3 Resources (`list_sinks`, `memory_stats`, `list_briefs`)

This document is the canonical artifact for the BRF-01..BRF-11
requirements + the five Phase 5 success criteria from
`.planning/ROADMAP.md` §"Phase 5". Maintainer approval on the final
Phase 5 PR carrying this file (plus the four MCP tools + Resource, the
staleness daemon, and the cross-adapter conformance suite) IS the
audit-trail event — there is no separate signed-commit ceremony.

## What shipped

Phase 5 promotes vault-memory from a typed-edge graph layer to vault-
memory's **signature differentiator**: compiled briefs as first-class
`Document`s in `_memory/_briefs/`. The compile/get/list trio plus a
single-owner staleness daemon close the "agents rediscover 85% of
context every run" failure mode that motivated the v2 program.

| Tool / surface              | Slice  | What it returns                                                                                                                                                       |
|-----------------------------|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `compile_brief`             | 05-02  | LLM-strategy ladder (D-10: MCP Sampling → Ollama → `prepared_text`) + D-11 wikilink emission + D-12 auto-supersede on target collision. Writes through DeliveryAdapter. |
| `get_brief`                 | 05-02  | D-13 decision tree (staleness dominates; age independent; supersede-chain follow). Returns null when caller MUST recompile.                                            |
| `list_briefs` **(Resource)**| 05-04  | `vault-memory://briefs?target=<pattern>` — discovery surface; pure read over MemorySinkRegistry + VaultManager + SourceConnector. NOT a Tool.                          |
| Staleness daemon            | 05-03  | Subscribes to `ChangeFeed`; runs startup full scan (BRF-07) and rename grace-window (BRF-08); single-owner via `~/.vault-memory/locks/<vault>.lock`.                   |

Plus the **substrate work**:

- **Migration 013** (05-01) — `chunks.chunk_id_fragment`,
  `brief_sources` (D-06 reverse-index), `daemon_state`.
- **ChunkId brand + content-stable fragment helpers** (05-01) —
  `parseChunkId`, `formatChunkId`, `decomposeChunkId`,
  `computeChunkHash`, `computeChunkIdFragment`. Content-derived chunk
  IDs are essential for the v3 multi-user story (every user
  recomputes identical fragments over the same source text).
- **`default-brief-v1` MemoryContract** (05-01) — provenance frame
  required by every brief Document; the `_memory/_briefs/` sink
  binds to this contract at registration time.
- **OllamaClient.chat()** (05-02) — `/api/chat` route alongside
  `/api/embed`; first non-embedding LLM call in vault-memory history
  (ADR-005 governs).
- **Lockfile primitive** (05-03) — `fs.open('wx')` + PID liveness.
- **`brief_sources` reverse-index** is the source-of-truth for the
  `(brief, chunk)` relationship; `daemon_state` carries the per-
  vault change-feed cursor for BRF-07 startup replay.

Tool surface grows from **32 → 34**: the 32 Phase 4 entries byte-
identical (per-name verified against the regenerated snapshot), plus
`compile_brief` + `get_brief`. The `list_briefs` Resource lives on the
**MCP Resources** discovery surface, NOT the tools list. See "REL-08
hand-off to Phase 8" below for the budget treatment.

## Phase 5 success criteria — disposition

The five criteria from `.planning/ROADMAP.md` §"Phase 5":

### Criterion 1 — 20-doc staleness eval + cross-adapter source-neutrality

> After compiling a brief for a 20-document project, modifying one
> source flips the brief to `stale: true` within one change-feed
> cycle (verified by eval); the same scenario passes when the stub
> adapter is the change-feed source — proving source-neutrality.

**Status: ✅ MET.**

- `evals/fixtures/v2-test-vault/_queries/briefs-curated.yaml`
  (slice 2/3) drives the curated 20-document Atlas Robotics
  scenario end-to-end.
- `evals/fixtures/v2-test-vault/_queries/briefs-staleness-stub.yaml`
  (this slice) declares the BRF-11 cross-adapter parametric run
  (`adapters: [obsidian-fs, stub]`).
- `evals/fixtures/v2-test-vault/_queries/briefs-from-cluster.yaml`
  (slice 3) drives the cluster-fed compile scenario.
- Authoritative cross-adapter enforcement: 4 conformance test cases ×
  2 SourceConnector adapters = 8 test runs in
  `src/adapters/source/conformance.test.ts` (the new
  `"compile_brief + staleness daemon (BRF-11 source-neutrality)"`
  block). Tests: update flips stale (1), startup scan recovers
  missed events (2), delete past grace-window marks stale (3),
  rename within grace-window preserves brief→source link (4).

Resolving slices: **05-02 (compile/get), 05-03 (staleness eval), 05-04 (cross-adapter conformance)**.

### Criterion 2 — LLM strategy ladder via documented order

> `compile_brief` resolves its LLM strategy via the documented
> ladder MCP Sampling → local Ollama → caller-passed text (per the
> Phase 5 ADR); vault-memory never bundles a remote LLM SDK.

**Status: ✅ MET.**

- ADR-005 (`docs/v2/adr/005-brief-compile-strategy.md`, slice 1)
  governs the LLM strategy decision and forbids any bundled remote
  LLM SDK.
- `src/brief/llm-ladder.ts` (slice 2) implements
  `resolveLlmStrategy(deps, args)` returning a discriminated union
  `{kind: "sampling" | "ollama" | "prepared_text"}` based on
  capability probes (MCP `getClientCapabilities().sampling` first;
  then `[brief.ollama]` config probe; then `args.prepared_text`).
- `compileWithLlm` dispatches per kind. No remote LLM SDK is
  imported anywhere in `src/`; `bash scripts/lint-adapters.sh`
  remains green.
- Pinned by `src/brief/llm-ladder.test.ts`,
  `src/brief/compile.test.ts` (tier-2 ollama mock + tier-3 prepared
  text scenarios), and conformance tests that exercise only the
  tier-3 `prepared_text` path (no Ollama dependency in CI).

Resolving slice: **05-02**.

### Criterion 3 — `get_brief` D-13 + `list_briefs` as Resource

> `get_brief({target, max_age_days?, allow_stale?})` returns a
> fresh brief, or `stale: true` with the changed-source list, or
> null forcing recompile; `list_briefs` is exposed as an MCP
> Resource (not Tool).

**Status: ✅ MET.**

- `handleGetBrief` (slice 2) implements the D-13 decision tree:
  staleness dominates (returns `{brief: null, stale: true,
  changed_sources, reason: "stale_blocked"}` when stale &
  !allow_stale); age is independent (returns `too_old_blocked` even
  on non-stale briefs); follows the supersede chain forward-only
  with a 100-hop cycle guard.
- `readListBriefs` (this slice) is a pure function over
  `MemorySinkRegistry` + `VaultManager` + `SourceConnector`. The
  resource is registered in `src/server.ts` at
  `vault-memory://briefs` with optional `?target=<pattern>`
  substring filter. NOT a Tool — MCP `registerResource` is used.
- Pinned by `src/brief/get.test.ts` (8 D-13 scenarios) and
  `src/brief/resources.test.ts` (7 tests covering empty vault,
  three briefs, superseded inclusion, target substring filter,
  source_count parity, age_days math, adapter-seam discipline).

Resolving slices: **05-02 (get_brief), 05-04 (list_briefs Resource)**.

### Criterion 4 — Staleness daemon: ChangeFeed + single-owner + startup + rename

> Staleness daemon subscribes via `ChangeFeed.subscribe()`, runs
> single-owner enforced by `~/.vault-memory/locks/<vault>.lock`,
> replays missed events on startup, and preserves brief→source
> links across rename events.

**Status: ✅ MET.**

- `BriefStalenessDaemon.start(vault, feed, deps)` (slice 3)
  acquires the lock first via `tryAcquireLock`; on contention,
  logs a structured `daemon_already_owned` warning and returns
  `{acquired: false}` without subscribing.
- Startup full scan (BRF-07) walks `brief_sources.listBriefDocIds()`
  and flips briefs stale where current chunk hashes have diverged
  from `recorded_hash`. Cursor stored in `daemon_state` table
  bounds the replay window.
- Rename grace-window (BRF-08): `handleDelete` enters a 5-second
  pending-deletes hold; `handleCreate` within the window with
  matching chunk hashes rewrites `brief_sources.chunk_doc_id` in
  place via `UPDATE` — the brief stays `status: "active"`.
- Pinned by `src/brief/daemon.test.ts` (10 scenarios — startup
  divergence, lock contention, update event, delete past grace,
  rename within grace, failing delivery.update, drainPending, etc.)
  and the cross-adapter conformance suite (this slice).

Resolving slice: **05-03**.

### Criterion 5 — Briefs are `Document`s with provenance properties

> Briefs are `Document`s in `_memory/_briefs/` with properties
> `compiled_from`, `compiled_at`, chunk-level `source_hashes`,
> `confidence`, `target`, `purpose`; brief writes route through
> `DeliveryAdapter`.

**Status: ✅ MET.**

- `compile_brief` builds the brief `Document` with `properties`
  including `source: "agent"`, `confidence: "inferred"`,
  `evidence: parsedSourceDocIds`, `status: "active"`,
  `observed_at`, `superseded_by: null`, `type: "brief"`, `target`,
  `purpose`, `compiled_from`, `compiled_at`, chunk-level
  `source_hashes` map, and `model` audit attribution.
- Writes go through `deliveryAdapterFor(vaultName).write(newDocId,
  briefDoc, {sink: briefSink.handle})` — the same DeliveryAdapter
  contract that gates every memory-namespace write since Phase 2.
  The brief sink is registered at `_memory/_briefs/` and bound to
  the `default-brief-v1` MemoryContract (slice 1).
- Pinned by `src/brief/compile.test.ts` Test 13 (YAML round-trip
  for `source_hashes` keys containing `#chunk-` substrings) and
  the eval YAMLs.

Resolving slices: **05-01 (contract + types), 05-02 (compile_brief)**.

## BRF requirement traceability

| ID     | Description                                                              | Artifact                                                                              | Test                                                                                | Status |
|--------|--------------------------------------------------------------------------|---------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------|--------|
| BRF-01 | Brief Document in `_memory/_briefs/` with provenance properties          | `default-brief-v1` MemoryContract + `src/brief/compile.ts`                            | `src/brief/compile.test.ts` (13 tests) + `default-brief-v1.test.ts`                 | ✅     |
| BRF-02 | Phase 5 ADR resolves LLM strategy                                        | `docs/v2/adr/005-brief-compile-strategy.md`                                           | doc review at sign-off                                                              | ✅     |
| BRF-03 | `compile_brief` MCP tool                                                 | `src/brief/compile.ts` + `src/tool-registry.ts`                                       | `src/brief/compile.test.ts`                                                         | ✅     |
| BRF-04 | `get_brief` MCP tool with D-13 decision tree                             | `src/brief/get.ts` + `src/tool-registry.ts`                                           | `src/brief/get.test.ts` (8 tests)                                                   | ✅     |
| BRF-05 | Staleness daemon subscribes to `ChangeFeed`                              | `src/brief/daemon.ts`                                                                 | `src/brief/daemon.test.ts` + `conformance.test.ts` (BRF-11 block)                   | ✅     |
| BRF-06 | Single-owner via `~/.vault-memory/locks/<vault>.lock`                    | `src/brief/lock.ts` + `BriefStalenessDaemon.start` guard                              | `src/brief/lock.test.ts` + `src/brief/daemon.test.ts` Test 4 (lock contention)      | ✅     |
| BRF-07 | Startup replay handles missed events                                     | `src/brief/daemon.ts` `runStartupScan` + `daemon_state` cursor                        | `src/brief/daemon.test.ts` Tests 2 & 3 + `conformance.test.ts` BRF-11 Test 2        | ✅     |
| BRF-08 | Rename-event preserves brief→source links                                | `src/brief/daemon.ts` `handleCreate`/`handleDelete` grace-window                      | `src/brief/daemon.test.ts` Test 7 + `conformance.test.ts` BRF-11 Test 4             | ✅     |
| BRF-09 | `list_briefs` as MCP **Resource** (not Tool)                             | `src/brief/resources.ts` + `src/server.ts` `registerResource("briefs", ...)`          | `src/brief/resources.test.ts` (7 tests)                                             | ✅     |
| BRF-10 | 20-doc eval — modify source, brief flips stale within one cycle          | `evals/fixtures/v2-test-vault/_queries/briefs-curated.yaml`                           | eval runner + `briefs-curated.test.ts`                                              | ✅     |
| BRF-11 | Same scenario passes against stub `ChangeFeed`                           | `briefs-staleness-stub.yaml` + `conformance.test.ts` BRF-11 block                     | conformance suite (4 cases × 2 adapters = 8 runs)                                   | ✅     |

## Tool-count delta and REL-08 hand-off to Phase 8

- **Before Phase 5** (post-Phase 4): **32 tools** + 2 Resources
  (`list_sinks`, `memory_stats`).
- **After Phase 5**: **34 tools** (+`compile_brief`, +`get_brief`)
  + **3 Resources** (+`list_briefs` at `vault-memory://briefs`).
- **`evals/v1-baseline/tools-list.snapshot.json`** — additive-only
  diff verified per-name. The 32 prior entries are byte-identical;
  the two new tools are appended with full `inputSchema` per
  `src/tool-registry.ts`.
- **Strict-equality snapshot test re-enabled** in
  `evals/v1-baseline/baseline.test.ts` (was `.skip`'d in slice 2
  with a "regen deferred to Plan 05-04" comment — that loop is now
  closed).

### REL-08 retirement plan (Phase 8 hand-off)

**REL-08** (`docs/v2/REQUIREMENTS.md`) requires `tools/list` ≤ 32
entries for the v2.0.0 ship. Phase 5 lifts the count to 34 to ship
the brief-layer signature differentiator without compromising the
API. The retirement plan defers to Phase 8 (polish + release):

**Recommended candidates** for promotion to MCP Resources (Phase 8
ADR makes the final call; this is documentation only):

1. **`list_backlinks`** → `vault-memory://backlinks/{docId}` Resource
   (URI per-doc; client constructs from the document's DocId).
2. **`list_forward_links`** → `vault-memory://forward-links/{docId}` Resource
   (same pattern).

**Why these two**: pure-read discovery surfaces with no side
effects; Phase 4 made them fan out over typed `edges` so clients
that need `type` filtering can do it client-side; the v1 names
remain accessible via the Resource handle. Promotion is **additive
at the seam** — the Resource handlers reuse `listBacklinks` /
`listForwardLinks` from `src/graph/index.js` verbatim.

**Why not now**: Phase 5's primary job is the signature
differentiator. Bundling a tool-budget retirement into the same
phase would risk delivery and conflate two different release
decisions. Phase 8 (release gate) is the natural home — it already
audits the tool surface.

## Migration delta

- **Migration 013** (slice 1) — three tables:
  - `chunks.chunk_id_fragment` column (content-derived fragment).
  - `brief_sources` (D-06 reverse-index — `(brief_doc_id,
    chunk_id_fragment, chunk_doc_id, recorded_hash)`).
  - `daemon_state` (per-vault cursor + `last_full_scan` timestamp).

Migrations 001–012 (Phases 0–4) are unchanged. The v1 `chunks` table
gains a column additively; `noUncheckedIndexedAccess` consumers see
the new column as `T | undefined` until populated.

## Cross-phase hand-offs

### Phase 6 (contracts DSL)

- Contracts MAY reference `ChunkId` for chunk-level citations;
  `compile_brief` is the reference compiler binding for Phase 6
  contracts that need brief synthesis (the contract's `assembly`
  step calls `compile_brief` with `prepared_text` for deterministic
  output, or with no `prepared_text` for LLM-mediated synthesis).
- `prepared_text` (D-10 tier 3) is the deterministic on-ramp for
  Phase 6 contracts that don't need an LLM.

### Phase 10 / v3 (Notion connector)

- **BRF-11 cross-adapter conformance proves brief-layer source-
  neutrality.** A future Notion `ChangeFeed` slots into
  `feed.subscribe()` with no brief-layer changes. The same daemon
  + compile + get + resources code path runs unchanged.
- The `ChangeFeed.since: cursor` hook (deferred per CONTEXT
  `<deferred>`) becomes relevant when Notion's polling cursor
  lands; today the stub feed re-emits from index 0 and the
  obsidian-fs feed observes only post-subscribe events.

## Known follow-ups (deferred to v2.x / v3)

Per CONTEXT `<deferred>` block:

- **Block-level staleness** — deferred to v3 with Notion; v2's
  chunk-level staleness is sufficient for obsidian-fs.
- **Auto-recompile in `get_brief`** — deferred. A v2.x config flag
  may surface if friction is reported in the wild. Today callers
  always re-call `compile_brief` after a stale response.
- **Cross-vault briefs** — deferred to v3 / Phase 10 multi-source.
- **`brief_diff` tool** — deferred. Callers can compute the diff
  client-side from two `get_brief` responses.
- **LLM-generated summaries in `list_briefs`** — deferred. The
  Resource is a discovery surface; per-brief summaries would
  require LLM calls at read time which we have explicitly avoided.

## Known v2.0.0 limitations

| Limitation | Source | Widening path |
|---|---|---|
| Brief compilation is single-vault. | Per-vault `compile_brief` + `_memory/_briefs/` per-vault sink. | Phase 10 v3 — multi-source. |
| Staleness is chunk-level, not block-level. | `brief_sources` reverse-index keyed by chunk fragment. | Block-level rolls out with the Notion adapter (v3). |
| Daemon is single-owner per vault. | `~/.vault-memory/locks/<vault>.lock` enforces. | By design — the multi-process variant would require leader election (deferred). |
| LLM ladder requires Ollama OR MCP Sampling capability OR `prepared_text`. | D-10 ladder; no remote LLM SDK bundled. | v3 may expose pluggable LLM strategies behind a new adapter seam. |
| `list_briefs` Resource is polled-only (no `notifyResourceUpdated`). | CONTEXT D-Q4 — no MCP notifications in v2.0.0. | Phase 8 release-gate ADR may add notifications. |

## Test counts

| Phase / slice                       | Tests added | Suite total after |
|-------------------------------------|-------------|-------------------|
| Before Phase 5                      | —           | 1211 (Phase 4 sign-off) |
| 05-01 (foundations)                 | +49         | 1260              |
| 05-02 (compile + get)               | +60         | 1320              |
| 05-03 (staleness daemon)            | +39         | 1359              |
| **05-04 (BRF-09 + BRF-11 + gate)**  | **+15**     | **1374**          |

Slice 4 contribution:
- `src/brief/resources.test.ts` — 7 new tests.
- `src/adapters/source/conformance.test.ts` — 8 new test runs
  (4 cases × 2 adapters).

Final gates on the Phase 5 branch at sign-off:

```
npx tsc --noEmit                                      → clean
npm test                                              → 1374 passed, 12 skipped (106 files)
bash scripts/lint-adapters.sh                         → all 8 invariants green
npx vitest run src/brief/                             → 39 tests passed
npx vitest run src/adapters/source/conformance.test.ts → 49 tests passed
npx vitest run evals/v1-baseline/                     → 30 passed, 11 skipped
```

## Per-plan recap

| Plan  | Name                              | Outcome                                                                                                                                                                                |
|-------|-----------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 05-01 | Foundations                       | ADR-005 + migration 013 + brief barrel + ChunkId brand + source-hashes helpers + `default-brief-v1` contract + sub-folder sink ordering. Wave-0 stubs for slices 2/3/4.                  |
| 05-02 | compile + get                     | `OllamaClient.chat()` + LLM ladder (D-10) + body validator (D-11) + `compile_brief` MCP tool with D-12 supersede chain + `get_brief` with D-13 decision tree + `briefs-curated.yaml`.   |
| 05-03 | Staleness daemon                  | Lockfile primitive (`fs.open('wx')` + PID liveness) + `BriefStalenessDaemon` (startup scan + ChangeFeed subscribe + rename grace) + server daemon bootstrap + BRF-10 staleness eval.    |
| 05-04 | Phase gate (this plan)            | `list_briefs` MCP Resource (BRF-09) + cross-adapter conformance suite (BRF-11) + `briefs-staleness-stub.yaml` + tools-list snapshot regen (+2 tools) + this sign-off doc + ROADMAP flip. |

Resolving commit prefixes (per `git log --oneline`):

- 05-01: `4eeb80f`, `b0aeecd`, `f05fcf7`, `851234a`, `bb66f2d`, `8db05b5`
- 05-02: `d8dcca6`, `02da8f6`, `f5f0110`, `de41256`, `6faa58f`
- 05-03: `d891d66`, `4d46a8e`, `db2f4dc`, `9d724ba`, `82c7711`
- 05-04: `3db1be9`, `e499de5`, `843ae34`, plus this sign-off PR

## Adapter-seam audit

`bash scripts/lint-adapters.sh` green on the Phase 5 branch at
sign-off. All 8 invariants pass:

- I-1 (`chokidar`), I-2 (`node:fs`), I-3 (`node:path`),
  I-4 (`gray-matter`), I-5 (bare `.md` literals), I-5b (`obsidian://`
  literal), I-6 (raw `fs.writeFile`/`unlink`/`rename`), C-1 (Claude
  branding / hardcoded client-id) — all clean.

`src/brief/resources.ts` carries **zero** `fs`, `path`, `gray-matter`,
or `chokidar` imports — enforced by both `scripts/lint-adapters.sh`
and an explicit assertion in `src/brief/resources.test.ts` Test 10.
The `onnxruntime-node` / `@huggingface/tokenizers` imports remain
confined to `src/rerank/` (unchanged from v1.0.0).

## Audit trail

Maintainer PR approval on the final Phase 5 PR carrying this file is
the FND-14-style audit event for Phase 5. The PR title / SHA is
recorded here at merge time:

- PR: _to be filled in at merge_
- Merge SHA: _to be filled in at merge_

— end Phase 5 sign-off —
