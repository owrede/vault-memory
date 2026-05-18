---
phase: 05-compiled-brief-layer
verified: 2026-05-18T11:46:30Z
status: passed
score: 5/5 success criteria + 11/11 BRF requirements verified
overrides_applied: 0
re_verification:
  previous_status: null
  previous_score: null
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 5: Compiled brief layer — Verification Report

**Phase Goal (ROADMAP.md):** Defeat the 85%-rediscovery failure mode by shipping compiled briefs as first-class `Document`s in `_memory/_briefs/` with deterministic source-hash staleness propagation — vault-memory's signature v2 differentiator.

**Verified:** 2026-05-18T11:46:30Z
**Status:** ✅ PASSED
**Re-verification:** No — initial verification.

---

## Goal Achievement

### Success Criteria — Observable Truths

| # | Success Criterion | Status | Evidence |
|---|---|---|---|
| 1 | 20-doc brief flips stale within one change-feed cycle; same on stub adapter (source-neutrality) | ✅ VERIFIED | `evals/fixtures/v2-test-vault/_queries/briefs-curated.yaml` + `briefs-staleness-stub.yaml` + `src/adapters/source/conformance.test.ts` BRF-11 block runs 4 cases × 2 adapters = 8 tests, all green. `briefs-curated.test.ts` (5 tests) passes. |
| 2 | `compile_brief` resolves LLM via MCP Sampling → local Ollama → caller-supplied text; no remote LLM SDK bundled | ✅ VERIFIED | `src/brief/llm-ladder.ts` `resolveLlmStrategy()` implements 4 tiers (sampling, ollama, prepared_text, structured `BriefLlmUnavailableError`). ADR-005 `Status: Accepted` documents the ladder + B-4 invariant ("No remote LLM SDK bundled"). `bash scripts/lint-adapters.sh` green. |
| 3 | `get_brief({target, max_age_days?, allow_stale?})` returns fresh / stale+changed_sources / null; `list_briefs` is MCP Resource (not Tool) | ✅ VERIFIED | `src/brief/get.ts:55-78` discriminated union covers all three branches. `src/server.ts` `registerResource("briefs", ...)` confirmed — `list_briefs` is NOT in the 34-entry tools snapshot. `src/brief/resources.ts` `readListBriefs()` pure handler over registry+manager+source. |
| 4 | Staleness daemon subscribes via ChangeFeed; single-owner lock at `~/.vault-memory/locks/<vault>.lock`; replays missed events; preserves rename links | ✅ VERIFIED | `src/brief/daemon.ts` `BriefStalenessDaemon.start()` calls `tryAcquireLock` (lock.ts line 96), runs `runStartupScan`, then `feed.subscribe()`. Rename grace-window logic in `handleCreate`/`handleDelete`. `src/server.ts:356-358` bootstraps daemon per-vault in post-connect chain. Tests: `daemon.test.ts` (11 tests) + conformance BRF-11 Tests 2 & 4. |
| 5 | Briefs are `Document`s in `_memory/_briefs/` with all 6 required properties; routed through `DeliveryAdapter` | ✅ VERIFIED | `src/brief/compile.ts` mints `target`, `purpose`, `compiled_from`, `compiled_at`, `confidence`, chunk-level `source_hashes`. `src/memory/contract/default-brief-v1.ts` widens status enum to `active \| stale \| superseded \| archived`. Delivery routed through `DeliveryAdapter` (deps wire `deliveryAdapterFor` per vault). `compile.test.ts` (14 tests) all green. |

**Success Criteria Score:** **5/5 VERIFIED**

### BRF Requirement Traceability

| Req | Description | Implementation | Tests | Status |
|---|---|---|---|---|
| BRF-01 | Brief Document w/ provenance properties | `default-brief-v1.ts` + `compile.ts` (mints all 6 props) | `compile.test.ts` (14), `default-brief-v1.test.ts` | ✅ |
| BRF-02 | LLM strategy ADR — Sampling → Ollama → prepared_text; no remote SDK | `docs/v2/adr/005-brief-compile-strategy.md` (Accepted), `llm-ladder.ts` | `llm-ladder.test.ts` (12) | ✅ |
| BRF-03 | `compile_brief` MCP tool, routed through DeliveryAdapter | `compile.ts` + `tool-registry.ts:582` + `server.ts:802` | `compile.test.ts` (14) | ✅ |
| BRF-04 | `get_brief` with D-13 decision tree | `get.ts` + `tool-registry.ts:630` + `server.ts:848` | `get.test.ts` (11) | ✅ |
| BRF-05 | Daemon subscribes via ChangeFeed | `daemon.ts` `feed.subscribe()` | `daemon.test.ts` (11), conformance BRF-11 (8) | ✅ |
| BRF-06 | Single-owner `~/.vault-memory/locks/<vault>.lock` w/ carve-out | `lock.ts` (`// vault-memory:claude-ok` on lines 1, 25, 27) | `lock.test.ts` (8), `daemon.test.ts` Test 4 | ✅ |
| BRF-07 | Startup replay handles missed events | `daemon.ts` `runStartupScan` + `daemon_state` cursor | `daemon.test.ts` Tests 2/3, conformance BRF-11 Test 2 | ✅ |
| BRF-08 | Rename preserves brief→source links | `daemon.ts` rename grace-window | `daemon.test.ts` Test 7, conformance BRF-11 Test 4 | ✅ |
| BRF-09 | `list_briefs` MCP Resource (not Tool) | `resources.ts` + `server.ts` `registerResource` | `resources.test.ts` (7) | ✅ |
| BRF-10 | 20-doc eval — modify source flips stale | `briefs-curated.yaml` | `briefs-curated.test.ts` (5) | ✅ |
| BRF-11 | Source-neutrality via stub ChangeFeed | `briefs-staleness-stub.yaml` + `conformance.test.ts` BRF-11 block | 4 cases × 2 adapters = 8 tests | ✅ |

**BRF Score:** **11/11 SATISFIED**

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/brief/compile.ts` | BRF-03 compile_brief controller | ✅ VERIFIED | `handleCompileBrief` exported (line 241); writes all 6 brief properties; routes through DeliveryAdapter |
| `src/brief/get.ts` | BRF-04 get_brief controller | ✅ VERIFIED | `handleGetBrief` w/ D-13 decision tree (fresh / stale+changed / null / too_old) |
| `src/brief/daemon.ts` | BRF-05/06/07/08 daemon | ✅ VERIFIED | `BriefStalenessDaemon.start()` w/ lock acquire, startup scan, feed.subscribe, rename grace-window |
| `src/brief/lock.ts` | BRF-06 single-owner lock + carve-out marker | ✅ VERIFIED | `// vault-memory:claude-ok` marker present on lines 1, 25, 27; `tryAcquireLock` uses `fs.open(path, 'wx')` |
| `src/brief/resources.ts` | BRF-09 list_briefs Resource | ✅ VERIFIED | `readListBriefs` pure handler; registered as Resource (not Tool) at `vault-memory://briefs` |
| `src/brief/llm-ladder.ts` | BRF-02 D-10 ladder | ✅ VERIFIED | 4 tiers: sampling → ollama → prepared_text → `BriefLlmUnavailableError`; `BriefLlmSamplingRefusedError` distinct |
| `src/brief/body-validator.ts` | D-11 wikilink validator | ✅ VERIFIED | `validateAndPatchBody` pure module; appends `## Sources` for missing refs |
| `src/brief/source-hashes.ts` | Chunk-level source_hashes builder | ✅ VERIFIED | `buildSourceHashes` exported; pure module |
| `src/brief/chunk-id.ts` | ChunkId helper (`<DocId>#chunk-<n>` n=first-7-sha256) | ✅ VERIFIED | Pure module; no fs/path imports |
| `src/memory/contract/default-brief-v1.ts` | Brief contract w/ `stale` status | ✅ VERIFIED | Status enum widened to `active \| stale \| superseded \| archived` |
| `src/db/queries/brief_sources.ts` | Reverse-index queries | ✅ VERIFIED | `BriefSourcesQueries` class w/ `sourcesForBrief`, `briefsForChunkDoc` |
| `src/db/queries/daemon_state.ts` | Daemon cursor queries | ✅ VERIFIED | `DaemonStateQueries` class shipped |
| `src/db/schema.ts` migration 013 | chunk_id_fragment + brief_sources + daemon_state | ✅ VERIFIED | `runMigration013` at line 883; registered in MIGRATIONS array as `version: 13` (line 1022) |
| `src/tool-registry.ts` | compile_brief + get_brief as Tools | ✅ VERIFIED | Both registered (lines 582, 630); `list_briefs` NOT in tools |
| `src/server.ts` daemon bootstrap | Post-connect fire-and-forget chain | ✅ VERIFIED | `briefDaemons` Map at line 306; daemon.start in catchup chain (lines 348-358) |
| `src/ollama/client.ts` | `.chat()` method | ✅ VERIFIED | `async chat(request: ChatRequest): Promise<ChatResponse>` at line 206 |
| `src/types.ts` exports | Brief, ChunkId, BriefStatus, BriefSourceHash | ✅ VERIFIED | All 4 types exported (lines 382, 392, 401, 411) |
| `evals/.../briefs-curated.yaml` | BRF-10 primary eval | ✅ VERIFIED | File present; `briefs-curated.test.ts` 5 tests pass |
| `evals/.../briefs-from-cluster.yaml` | D-02 pipeline integration | ✅ VERIFIED | File + matching `.test.ts` present, 4 tests pass |
| `evals/.../briefs-staleness-stub.yaml` | BRF-11 cross-adapter | ✅ VERIFIED | File present |
| `src/adapters/source/conformance.test.ts` BRF-11 block | Parametric over obsidian-fs + stub | ✅ VERIFIED | 4 brief cases × 2 adapters = 8 assertions, all green |
| `evals/v1-baseline/tools-list.snapshot.json` | 34 tools, additive, +compile_brief +get_brief | ✅ VERIFIED | 34 entries; 32 prior tools byte-identical; +`compile_brief` +`get_brief` confirmed |
| `docs/v2/PHASE-5-SIGN-OFF.md` | Executor sign-off w/ 32→34 delta + REL-08 plan | ✅ VERIFIED | Documents tool delta, REL-08 retirement plan, BRF traceability table, migration delta |
| `docs/v2/adr/005-brief-compile-strategy.md` | ADR — Accepted; capability ladder + no-remote-SDK + ChunkId + recompile chain | ✅ VERIFIED | `Status: Accepted — Phase 5 foundation`; documents tiers 1-3, B-4 invariant, ChunkId D-04, recompile chain semantics |

---

## Static Analysis Gates

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | ✅ Clean (no output) |
| Adapter seam lint | `bash scripts/lint-adapters.sh` | ✅ All I-1..I-6 + I-5b + C-1 green |

## Test Gate

| Tree | Command | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| `src/` (main) | `vitest run --dir src --no-file-parallelism` | 1298 | 1298 | 0 | 0 |
| `evals/` (main) | `vitest run --dir evals --no-file-parallelism` | 88 | 77 | 0 | 11 |
| `src/brief/` (focused) | `vitest run --dir src/brief --no-file-parallelism` | 82 | 82 | 0 | 0 |
| Combined main tree | — | **1386** | **1375** | **0** | **11** |

**Main tree above 1211 floor (Phase 4):** ✅ 1375 > 1211 (+164 tests delta).

**Worktree noise:** Initial parallel run reported 1 failure in `src/adapters/change-feed/obsidian-fs/change-feed.test.ts` ("emits delete on an unlinked .md file"). Git history (commits `260da64`, `ff635f3`) shows this is a known flaky chokidar-timing test from Phase 1 with `test.retry(1)` patches. Sequential rerun is green (70/70 passing). Not introduced by Phase 5; not a Phase 5 gap.

## Adapter-Seam Carve-Out Audit

- `src/brief/lock.ts` lines 1, 25, 27 contain `// vault-memory:claude-ok` markers ✅
- Grep across `src/brief/*.ts` for `node:fs` / `node:path` / `gray-matter` / `chokidar` imports outside lock.ts: **0 hits** (all matches are in comments only) ✅
- `bash scripts/lint-adapters.sh` green ✅

## Tool Budget Audit

- 34 tools in `evals/v1-baseline/tools-list.snapshot.json` ✅
- Includes `compile_brief` + `get_brief` ✅
- `list_briefs` is NOT in tools (registered via `server.registerResource(...)` in `src/server.ts`) ✅
- 32 prior v1+Phase 1-4 tool names byte-identical ✅
- Sign-off doc documents 32→34 delta and REL-08 (Phase 8) retirement plan ✅

## Migration Audit

- `src/db/schema.ts` `runMigration013` defined at line 883 ✅
- MIGRATIONS array entry `version: 13` at line 1022, `run: runMigration013` at line 1025 ✅
- Migration covers chunk_id_fragment column-add + brief_sources table + daemon_state table ✅

## ADR Audit

- `docs/v2/adr/005-brief-compile-strategy.md` exists ✅
- Status: `Accepted — Phase 5 foundation` ✅
- Documents capability-first ladder (Tier 1 MCP Sampling, Tier 2 Local Ollama, Tier 3 prepared_text, Tier 4 structured error) ✅
- B-4 invariant: "No remote LLM SDK bundled" ✅
- ChunkId definition (`<DocId>#chunk-<n>` where n=first-7-hex-of-sha256(NFC(chunk_text))) ✅
- Recompile chain semantics documented (status enum, supersede chain) ✅

## Cross-Phase Invariant Check

- v1 tool snapshot is additive only — 32 prior tools preserved byte-identically ✅
- Phase 4 test floor (1211) is preserved ✅
- No regressions in existing test suites ✅

## Behavioral Spot-Checks

| Behavior | Result | Status |
|---|---|---|
| `npx tsc --noEmit` produces no diagnostics | Clean | ✅ PASS |
| `bash scripts/lint-adapters.sh` exits 0 | All invariants green | ✅ PASS |
| `npx vitest run src/brief/` exits 0 | 82/82 brief tests pass | ✅ PASS |
| `npx vitest run src/adapters/source/conformance.test.ts` BRF-11 block | 8/8 (4 cases × 2 adapters) pass | ✅ PASS |
| Brief eval (`briefs-curated.test.ts`) exits 0 | 5/5 pass | ✅ PASS |
| Brief-from-cluster eval (`briefs-from-cluster.test.ts`) exits 0 | 4/4 pass | ✅ PASS |
| 34-tool snapshot count via `grep -c '"name"'` | 34 entries | ✅ PASS |

## Anti-Patterns Found

None. All brief modules carry explicit "Pure module. No fs / gray-matter / chokidar / path imports" comments where applicable; the single lock-file carve-out is marked with `// vault-memory:claude-ok` per ADR-005 §"Lockfile carve-out". No TBD/FIXME/XXX debt markers introduced by Phase 5 commits.

## Human Verification Required

None. All success criteria are observable in code + tests; no UI / real-time / external-service behaviors require manual confirmation.

---

## Gaps Summary

No gaps. All 5 success criteria, all 11 BRF requirements, all 23 expected artifacts, both static gates, and both eval suites verify green. The signature v2 differentiator (compiled-brief layer) is operational, source-neutral (proven by stub-adapter BRF-11 conformance), backwards-compatible (32 prior tools byte-identical), and architecturally clean (single adapter-seam carve-out at `lock.ts` with the required marker).

---

_Verified: 2026-05-18T11:46:30Z_
_Verifier: Claude (gsd-verifier, goal-backward methodology)_

## VERIFICATION PASSED
