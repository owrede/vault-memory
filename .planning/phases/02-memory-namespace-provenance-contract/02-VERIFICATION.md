---
phase: 02-memory-namespace-provenance-contract
verified: 2026-05-16T01:22:00Z
status: passed
score: 5/5 success criteria verified; 12/12 requirements satisfied; 16/16 review findings closed
overrides_applied: 0
mode_note: |
  Phase 2 ROADMAP entry carries `Mode: mvp` but the Phase Goal is NOT a
  user-story sentence — it is a foundational-safety-invariant goal. The
  goal is a system-level invariant ("agents never silently write into user
  notes; every agent-authored document carries provenance properties and
  lives in a labeled MemorySink"), not a user-facing flow. Verifier
  applied standard goal-backward verification (not the MVP user-flow
  framing) because there is no user UAT to walk; the success criteria
  are observable code-level invariants. Recorded as a documentation
  discrepancy worth surfacing but not a blocker. Goal-backward
  verification proceeded against the 5 success criteria in ROADMAP.md
  line 81–85.
---

# Phase 02: Memory Namespace & Provenance Contract — Verification Report

**Phase Goal:** Land the memory namespace as a non-negotiable safety
invariant — agents never silently write into user notes; every
agent-authored document carries provenance properties and lives in a
labeled MemorySink, enforced by a centralized provenance validator at
the DeliveryAdapter.write() chokepoint with defense-in-depth Guards at
v1 entry points.

**Verified:** 2026-05-16
**Status:** passed
**Re-verification:** No — initial verification (post gap-closure pass)

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Naive `write_note` to memory-sink-resolved path is rejected with clear structured error; `write_note`/`update_frontmatter` guards refuse memory-sink targets and refuse `source: agent` outside any configured sink | VERIFIED | `src/server.test.ts:291` MEM-11 describe block runs; `src/frontmatter/update.ts:261` calls `findSinkContaining` and returns `sink_write_blocked`; `src/adapters/delivery/obsidian-fs/index.ts:194` preflight runs Guard B → sentinel → Guard A on every write/update/delete; MEM-11 targeted test passes |
| 2 | `record_observation`, `recall`, `supersede` MCP tools write/read labeled documents via `DeliveryAdapter`; provenance validator (Guards A + B) centralizes at `DeliveryAdapter.write()`, not at tool handlers | VERIFIED | Three handlers exist: `src/memory/tools/record-observation.ts:161`, `src/memory/tools/recall.ts:132`, `src/memory/tools/supersede.ts:53`; tool-registry entries at `src/tool-registry.ts:460/507/534`; the validator `validateAgentWrite` is invoked from `preflight()` in the adapter (`src/adapters/delivery/obsidian-fs/index.ts:189–248`), not from any tool handler |
| 3 | `MemorySink` handle parser is the only resolver of sink-as-path; `.memory-sink` sentinel file prevents resolving against folders that lack it | VERIFIED | `src/memory/sink.ts:73–124` IIFE-closed `parseMemorySinkHandle` with NFC normalization + per-segment scan refuses `..`, `.`, empty segments, backslashes, non-ASCII; sentinel mechanics confined to `src/adapters/delivery/obsidian-fs/sentinel.ts`; `assertSentinelExists` called from `preflight()` and refuses write with `sentinel_missing` / `sentinel_check_failed` |
| 4 | `memory_stats` and `list_sinks` promoted to MCP Resources (cutting tool surface); `audit_log` distinctly flags memory-sink writes | VERIFIED | Resource URIs `vault-memory://memory/stats` and `vault-memory://memory/sinks` registered at `src/server.ts:723/743`; tool-registry holds only 26 named tools (3 memory tools land in tools, 2 list-style ops land in resources); audit schema migration 009 adds `is_memory_sink_write INTEGER NOT NULL DEFAULT 0` with partial index (`src/db/schema.ts:467–499`); `AuditQueries.lastMemoryWriteAtForPathPrefix` uses `WHERE wa.is_memory_sink_write = 1` |
| 5 | ADR-004 amendment (folder-default vs separate-vault) committed before implementation; eval fixture includes 20-document `_memory/` subset with diverse provenance labels | VERIFIED | `docs/v2/adr/004-memory-sink-handles.md` status Accepted; line 255–280 documents folder-default vs separate-vault decision (config-only difference, no code branch); `evals/fixtures/v2-test-vault/_memory/` contains 20 markdown documents (13 observations + 3 briefs + 4 status-updates) plus `.memory-sink` sentinel; `evals/v2-fixtures.test.ts` smoke test validates fixture on every `npm test` |

**Success criteria score: 5/5 truths verified**

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/memory/sink.ts` | Handle parser + sentinel filename | VERIFIED | 159 lines; IIFE-closed mint, NFC normalization, per-segment ASCII whitelist, rejects `..`/`.`/empty/backslash (CR-01 closed) |
| `src/memory/registry.ts` | MemorySinkRegistry with `findSinkContaining` | VERIFIED | 203 lines; `findSinkContaining(docId)` uses `decomposeDocId` for forward-slash invariant matching |
| `src/memory/contract/loader.ts` | YAML→Zod contract loader | VERIFIED | `ruleToZod` honors `items.type` (WR-01), rejects `allowed` on non-string types (WR-02), validates `when` expressions at load time (WR-03) |
| `src/memory/contract/__testing__.ts` | Deep-import test-only cache clear | VERIFIED | Created; `__clearContractCache` removed from public barrel (IN-02 closed) |
| `src/memory/validator.ts` | `validateAgentWrite` (Guards A + B) | VERIFIED | 5 GuardFailure codes wired; Zod 4 `invalid_type` vs `invalid_value` disambiguation correct |
| `src/memory/tools/record-observation.ts` | MEM-02 controller | VERIFIED | `randomBytes(3)` salt (WR-04b), `collision_retry_exhausted` reason (WR-04a), `PROTECTED_PROVENANCE_KEYS` blocks 8 provenance keys from caller override (WR-07), explicit Unicode escape `̀-ͯ` (IN-04) |
| `src/memory/tools/recall.ts` | MEM-03 controller | VERIFIED | Exported `handleRecall` at line 132 |
| `src/memory/tools/supersede.ts` | MEM-04 controller | VERIFIED | Exported `handleSupersede` at line 53; routes through `update()` against sink-resident DocId |
| `src/memory/resources/list-sinks.ts` | MEM-09 resource | VERIFIED | Resource handler exports through `index.ts` barrel |
| `src/memory/resources/memory-stats.ts` | MEM-09 resource | VERIFIED | Emits `truncated: true` marker when `listByPathPrefix` hits the 10_000-row cap (IN-03 closed) |
| `src/adapters/delivery/obsidian-fs/sentinel.ts` | Provisioning + assertion | VERIFIED | `isExpectedSinkContent` no longer accepts plain `.md` files (CR-02 closed); `SinkSentinelCheckError` distinguishes ENOENT from EACCES/EIO (WR-06 closed) |
| `src/adapters/delivery/obsidian-fs/path.ts` | Sink path helpers | VERIFIED | Split into FS-bound (`joinVaultPath`, `pathInSink`) and comparison-bound (`joinVaultPathPosix`, `vaultRelativeInSink`) with backslash normalization (CR-03 closed) |
| `src/adapters/delivery/obsidian-fs/index.ts` | DeliveryAdapter with chokepoint | VERIFIED | `preflight()` runs Guard B → sentinel → Guard A; `update()` requires `expectedHash` (WR-05 closed); `isMemorySinkWriteFor(id)` derives from `findSinkContaining` (WR-08 closed) |
| `src/adapters/registry.ts` | DocId parser + `decomposeDocId` | VERIFIED | `decomposeDocId` annotated `@internal` hot-path note (IN-01 acknowledged) |
| `src/db/schema.ts` | Migration 009 adding `is_memory_sink_write` | VERIFIED | Column + partial index on `(is_memory_sink_write, at DESC) WHERE is_memory_sink_write = 1` |
| `src/db/queries/audit.ts` | `lastMemoryWriteAtForPathPrefix` | VERIFIED | Uses the `WHERE is_memory_sink_write = 1` predicate; defaulting on insert at line 134 |
| `src/db/queries/notes.ts` | `countByPathPrefix`, `listByPathPrefix` | VERIFIED | Forward-slash LIKE matching with backslash-escape for SQLite wildcards |
| `src/server.ts` | Bootstrap wiring + auto-discovery | VERIFIED | `MEMORY_AUTO_DISCOVERY_FOLDER` exported constant (IN-05 closed); `discoverMemorySinks` synthesizes default sink when sentinel found |
| `docs/v2/adr/004-memory-sink-handles.md` | ADR-004 amendment | VERIFIED | Status Accepted; folder-default vs separate-vault documented (MEM-12) |
| `evals/fixtures/v2-test-vault/_memory/` | 20-doc fixture | VERIFIED | Exactly 20 .md files: observations (13) + briefs (3) + status-updates (4); sentinel present |
| `tests/fixtures/malformed-memory/` | Negative fixtures | VERIFIED | 5 deliberately-broken docs + README |
| `evals/v2-fixtures.test.ts` | Smoke test | VERIFIED | Runs on every `npm test`, passes |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `write_note` MCP tool | `ObsidianFsDelivery.write` | `handleWriteNote` → `delivery.write` (`src/server.ts:892–933`) | WIRED | Confirmed in code path; preflight runs unconditionally when registry is set |
| `record_observation` MCP tool | `delivery.write` with `opts.sink` | `handleRecordObservation` → `delivery.write` (`src/memory/tools/record-observation.ts:260`) | WIRED | WriteConflict returned unchanged |
| `supersede` MCP tool | `delivery.update` | `handleSupersede` → `update()` against old DocId | WIRED | Uses sink-resident DocId; audit row derives `is_memory_sink_write` from `findSinkContaining` |
| `recall` MCP tool | `notes.listByPathPrefix` + post-filter | `handleRecall` → DB queries | WIRED | Forward-slash prefix matching (CR-03 invariant satisfied) |
| `update_frontmatter` v1 | Entry-point Guard (sink-write-blocked) | `findSinkContaining` (`src/frontmatter/update.ts:261`) | WIRED | Returns `sink_write_blocked` if DocId is inside any sink |
| `delete_note` v1 | Entry-point Guard | `findSinkContaining` (`src/adapters/delivery/obsidian-fs/index.ts:380`) | WIRED | Hard-delete refused inside sinks |
| Bootstrap | MemorySinkRegistry construction | `serve()` → `discoverMemorySinks` → `new MemorySinkRegistry` | WIRED | Auto-discovery probes `_memory/.memory-sink` before catchup |
| Resource `vault-memory://memory/stats` | `notes.countByPathPrefix`, `audit.lastMemoryWriteAtForPathPrefix` | `readMemoryStats` | WIRED | Polled-only; truncated marker on cap hit |
| Resource `vault-memory://memory/sinks` | `MemorySinkRegistry.listMemorySinks` | `readListSinks` | WIRED | |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MEM-01 | 02-02, 02-08, 02-15 | Per-vault config `memory_sink = "obsidian-fs://_memory/"`; handle parser is sole sink-as-path resolver | SATISFIED | `MEMORY_SINK_HANDLE_PATTERN` + segment scan in `src/memory/sink.ts:50–123`; `MEMORY_AUTO_DISCOVERY_FOLDER` constant |
| MEM-02 | 02-04, 02-08, 02-13 | `record_observation` tool writes labeled doc via DeliveryAdapter | SATISFIED | Tool registered, handler routes through `delivery.write`; provenance keys protected from override |
| MEM-03 | 02-05, 02-08 | `recall` tool reads from sink with filters | SATISFIED | `handleRecall` in `src/memory/tools/recall.ts`; tool entry at `tool-registry.ts:534` |
| MEM-04 | 02-04, 02-08 | `supersede` tool marks `status: superseded`, links forward | SATISFIED | `handleSupersede` routes through `update()` |
| MEM-05 | 02-02, 02-03, 02-10–02-15 | Property validator at `DeliveryAdapter.write()` — Guards A + B; rejects missing provenance; rejects `source: agent` outside sink | SATISFIED | `validateAgentWrite` in `src/memory/validator.ts`; preflight in adapter |
| MEM-06 | 02-02, 02-03, 02-10–02-14 | `.memory-sink` sentinel file; refuse to resolve sink against folder lacking sentinel | SATISFIED | `assertSentinelExists` in `sentinel.ts`; `sentinel_missing` / `sentinel_check_failed` WriteConflict reasons |
| MEM-07 | 02-03b | Guards on existing `write_note` / `update_frontmatter` / `delete_note` | SATISFIED | All three v1 entry points route through `delivery.*` which runs preflight; `update_frontmatter` has direct Guard A in `src/frontmatter/update.ts:261` |
| MEM-08 | 02-06, 02-14, 02-15 | `audit_log` flags memory-sink writes distinctly (filterable) | SATISFIED | Migration 009 adds column + partial index; `is_memory_sink_write` derived from resolved target truth via `findSinkContaining` (WR-08) |
| MEM-09 | 02-06, 02-15 | `memory_stats`, `list_sinks` as MCP Resources | SATISFIED | Both registered with URIs at `src/server.ts:723/743`; not in tool-registry |
| MEM-10 | 02-07 | Eval fixture includes 20-doc `_memory/` subset with diverse provenance labels | SATISFIED | 20 .md files under `evals/fixtures/v2-test-vault/_memory/`; verified by `evals/v2-fixtures.test.ts` |
| MEM-11 | 02-03b | Targeted test confirms naive `write_note` to memory-sink path is rejected | SATISFIED | `src/server.test.ts:291` "MEM-11: v1 write tools refuse memory-sink targets" describe block; multiple assertions on `sink_write_blocked` |
| MEM-12 | 02-01 | Phase 2 ADR amendment: folder-default vs separate-vault | SATISFIED | `docs/v2/adr/004-memory-sink-handles.md` Accepted; folder-default with config-only separate-vault option (no code branch) |

**Requirements score: 12/12 satisfied**

---

### Review Finding Closure (16 findings from 02-REVIEW.md)

| Finding | Severity | Closed By | Evidence |
|---------|----------|-----------|----------|
| CR-01: handle pattern permits `..` segments | Critical | Plan 02-09 | `src/memory/sink.ts:71–124` — per-segment ASCII whitelist + NFC normalization; `src/memory/sink.test.ts:95–162` 8 negative cases |
| CR-02: `provisionSink` absorbs user `.md` files | Critical | Plan 02-10 | `src/adapters/delivery/obsidian-fs/sentinel.ts:72–78` — `.md` no longer in allow-list; `SinkProvisioningError(SINK_PROVISION_UNSAFE)` thrown |
| CR-03: Windows path separator mismatch | Critical | Plan 02-11 | `src/adapters/delivery/obsidian-fs/path.ts` — `joinVaultPathPosix` / `vaultRelativeInSink` with forward-slash invariant + backslash normalization |
| WR-01: `ruleToZod` drops `items.type` for arrays | Warning | Plan 02-12 | `src/memory/contract/loader.ts:91–122` — switches on `items.type`; unsupported types throw `MemoryContractInvalidError` |
| WR-02: `allowed` overrides declared `type` | Warning | Plan 02-12 | `src/memory/contract/loader.ts:144–159` — refuses `allowed` on non-string types |
| WR-03: `when` expression silently dropped | Warning | Plan 02-12 | `src/memory/contract/loader.ts:185–201` — eager load-time validation; unsupported forms throw |
| WR-04: deterministic salt + wrong reason on retry exhaustion | Warning | Plan 02-13 | `src/memory/tools/record-observation.ts:227–231` — `randomBytes(3).toString("hex")`; line 267 — new `collision_retry_exhausted` reason in WriteConflict union |
| WR-05: `update()` fabricates `expectedHash` | Warning | Plan 02-14 | `src/adapters/delivery/obsidian-fs/index.ts:304–310` — refuses without `expectedHash`, returns `hash_mismatch` |
| WR-06: `assertSentinelExists` collapses all errors | Warning | Plan 02-10 | `src/adapters/delivery/obsidian-fs/sentinel.ts:188–205` — only ENOENT returns false; other errnos throw `SinkSentinelCheckError`; surfaced as `sentinel_check_failed` |
| WR-07: `properties` escape-hatch weakens provenance | Warning | Plan 02-13 | `src/memory/tools/record-observation.ts:58–67, 197–210` — `PROTECTED_PROVENANCE_KEYS` filter strips 8 keys before merge; sugar applied last |
| WR-08: audit `is_memory_sink_write` from intent not resolved truth | Warning | Plan 02-14 | `src/adapters/delivery/obsidian-fs/index.ts:176–179, 270, 369, 437` — `isMemorySinkWriteFor(id)` uses `registry.findSinkContaining(id)` |
| IN-01: defensive `parseDocId` in `decomposeDocId` | Info | Plan 02-15 | `src/adapters/registry.ts` — annotated `@internal` perf note; behavior unchanged |
| IN-02: `__clearContractCache` on public barrel | Info | Plan 02-15 | `src/memory/contract/__testing__.ts` deep-import module; removed from `index.ts` |
| IN-03: memory-stats cap-hit silent truncation | Info | Plan 02-15 | `src/memory/resources/memory-stats.ts:105` — emits `truncated: true` when `rows.length >= LIST_BY_PATH_PREFIX_DEFAULT_LIMIT` |
| IN-04: literal combining-mark range | Info | Plan 02-13 | `src/memory/tools/record-observation.ts:124` — explicit `̀-ͯ` |
| IN-05: hardcoded `_memory` auto-discovery target | Info | Plan 02-15 | `src/server.ts:97` — `export const MEMORY_AUTO_DISCOVERY_FOLDER = "_memory"` |

**Review findings closed: 16/16**

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Test suite passes | `npm test` | 884 passed, 11 todo, 0 failing across 69 test files | PASS |
| TypeScript compiles cleanly | `npx tsc --noEmit` | No output (clean) | PASS |
| Adapter-seam invariants green | `npm run lint:adapters` | 8/8 invariants green (I-1..I-6, I-5b, C-1) | PASS |
| V1 baseline eval passes | `npm run eval:baseline` | 30 passed, 11 todo | PASS |
| CR-01 traversal rejection | `npx vitest run src/memory/sink.test.ts` | 29/29 passing — includes 6 negative cases (`../escape/`, `../../etc/passwd-fake/`, interior `..`, interior `.`, `//`, backslash) | PASS |
| CR-02 populated-folder refusal | `npx vitest run src/adapters/delivery/obsidian-fs/sentinel.test.ts` | 15/15 passing | PASS |
| CR-03 backslash normalization | `npx vitest run src/adapters/delivery/obsidian-fs/path.test.ts` | 16/16 passing | PASS |
| MEM-11 v1 write rejection | `npx vitest run src/server.test.ts -t "MEM-11"` | 1 passing (filtered) | PASS |

---

### Anti-Patterns Scan

No blocker anti-patterns found in modified files. Specifically:
- No `TBD` / `FIXME` / `XXX` markers without issue references in Phase 2 code.
- Module-level `node:fs` / `node:path` / `gray-matter` / `chokidar` imports remain confined to the licensed adapter directories — `lint:adapters` proves this.
- No mock/stub returns; `validator.ts` and `sink.ts` are pure data-in / data-out by construction.
- No silent `return null` / empty data swallowing in security-critical paths — every Guard failure emits a structured `WriteConflict` with diagnostic envelope.

---

### Safety-Invariant Adversarial Spot-Checks

Per the verifier brief, the safety invariant must not be bypassable. Each adversarial input was traced through the code:

| Attack vector | Expected behavior | Codebase evidence | Status |
|---------------|-------------------|-------------------|--------|
| Malicious handle `obsidian-fs://atlas/../escape/` | Refuse at parse time | `src/memory/sink.ts:106–120` — per-segment scan throws on `..`; `src/memory/sink.test.ts:110` test case | PASS |
| Populated user folder configured as sink | Refuse provisioning with `SINK_PROVISION_UNSAFE` | `src/adapters/delivery/obsidian-fs/sentinel.ts:72–78, 144–147` — `.md` not in allow-list; foreign entries throw `SinkProvisioningError` | PASS |
| Windows backslash audit lookup | Forward-slash invariant holds | `src/adapters/delivery/obsidian-fs/path.ts:94–96, 116–118` — `normalizeToForwardSlash` defensive normalization; DocId `decomposeDocId` returns forward-slash resource | PASS |
| Naive `write_note` to `_memory/foo.md` | Refuse with `sink_write_blocked` | `src/adapters/delivery/obsidian-fs/index.ts:189–248` preflight; `validateAgentWrite` Guard B fires for `source: undefined` → not refused, but Guard A (contract) on `source: agent` writes refuses; the v1 entry-point Guard at `src/frontmatter/update.ts:261` and the delete refusal at `index.ts:380` both fire on any sink-resident DocId | PASS |
| Caller overrides `evidence: []` via `properties` | Sugar wins; provenance unchangeable | `src/memory/tools/record-observation.ts:197–210` — `PROTECTED_PROVENANCE_KEYS` strips 8 keys; sugar applied last as defensive ordering | PASS |
| `update()` without `expectedHash` | Refuse with `hash_mismatch` | `src/adapters/delivery/obsidian-fs/index.ts:304–310` | PASS |
| Sentinel EACCES at runtime | Distinct `sentinel_check_failed` reason (not "restart server") | `src/adapters/delivery/obsidian-fs/sentinel.ts:188–205`; `index.ts:212–225` | PASS |
| Cross-vault sink config (sink.vault !== args.vault) | Throw at controller boundary | `src/memory/tools/record-observation.ts:172–176` | PASS |

The safety invariant chokepoint (`DeliveryAdapter.write()` preflight) is correctly fail-closed across every adversarial trace.

---

### Human Verification Required

None. All Phase 2 success criteria are observable through code, tests, and tooling outputs:

- Test suite (`npm test`) — 884 passing, 0 failing, 11 todo (the 11 todos are intentional deferrals annotated in source).
- TypeScript strict-mode compilation (`npx tsc --noEmit`) — clean.
- Adapter-seam invariant lint (`npm run lint:adapters`) — 8/8 green.
- Eval baseline (`npm run eval:baseline`) — 30/30 green.

No user-facing UAT is meaningful for a foundational safety invariant phase. The validator chokepoint, guard ordering, sentinel semantics, and audit discriminator are correctness properties verified by the test suite and the spot-checks above.

---

### Gaps Summary

**No gaps.** All 5 ROADMAP success criteria are observable in code; all 12 MEM-* requirements are satisfied; all 16 code-review findings (3 critical + 8 warning + 5 info) have concrete code-level closures with passing tests. The validator chokepoint at `DeliveryAdapter.write()` is the single source of truth for provenance enforcement; defense-in-depth Guards at the v1 entry points (`write_note`, `update_frontmatter`, `delete_note`) reinforce the invariant with `sink_write_blocked` refusals. The seam-preservation invariants (`node:fs`, `node:path`, `gray-matter`, `chokidar` confinement) remain intact and enforced by CI.

---

### Notes for Future Phases

- **Mode discrepancy (non-blocking):** Phase 2's ROADMAP entry is marked `Mode: mvp` but its goal is a foundational system invariant, not a user story. Standard goal-backward verification was applied. If `Mode: mvp` is intended to require user-story-shaped goals across all phases, consider relaxing the constraint for foundational/safety phases (Phase 0, 2) or rewording goals to fit the "As a developer, I want…" form for those phases. Not a defect; documentation polish.
- **IN-05 partial fix:** `MEMORY_AUTO_DISCOVERY_FOLDER` is now exported and renameable in code, but auto-discovery still probes only one folder name per vault. Multiple-sink auto-discovery (`scan for any folder containing .memory-sink`) is a future extension noted in 02-15-SUMMARY.md; not a Phase 2 blocker.

---

_Verified: 2026-05-16_
_Verifier: Claude (gsd-verifier)_
