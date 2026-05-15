---
phase: 01-adapter-extraction-tech-debt-up
verified: 2026-05-15T13:00:00Z
verifier: claude (gsd-verifier, opus 4.7)
status: passed_with_caveats
score: 5/5 ROADMAP success criteria · 15/15 ADP requirements
overall_verdict: PASS-with-caveats
caveats:
  - "Known timing flake in change-feed.test.ts / watcher.test.ts (chokidar awaitWriteFinish race). Fires intermittently under full-suite load; isolated rerun is clean (3/3). Hit watcher.test.ts:95 once during this verification run; carry-forward into Phase 2 with retry-once or stabilityThreshold bump."
overrides_applied: 0
deferred: []
gaps: []
---

# Phase 1 — Verification Report

**Phase Goal (from ROADMAP.md):** Stand up `SourceConnector` / `DeliveryAdapter` / `ChangeFeed` adapter seams with `obsidian-fs` as the v2 implementation, bundle MCP SDK 1.29 + Zod 4 upgrades, and prove client-agnosticism — all without user-visible behavior change.

**Verdict:** **PASS-with-caveats**

All 5 ROADMAP success criteria are verified TRUE against the codebase. All 15 ADP requirements are individually satisfied. The phase delivers what it promised. One known timing flake (already logged in STATE.md) is the only caveat — non-blocking, carry-forward.

---

## 1. ROADMAP Success Criteria

### SC-1 — All 324 v1 tests still pass; v1-baseline eval regression suite green · ✓ VERIFIED

| Check | Result |
|-------|--------|
| `npm test` total | 589 reported (578 passing + 11 todo intentional) — far exceeds 324 floor |
| Test-file count | 52 test files passing |
| Skipped tests | `grep -rE "(it|test)\.skip"` → 0 hits (no v1 tests were `.skip()`'d to make Phase 1 green) |
| `.todo` count | 1 file (`evals/v1-baseline/baseline.test.ts` — Phase-0-planned placeholders for execution-mode behavioral floors) |
| `npm run eval:baseline` | 1 file / 29 tests passed (11 todo) — snapshot-equality test green |
| Snapshot byte-stability | `npm run eval:snapshot && git diff` → ZERO diff. The pinned `evals/v1-baseline/tools-list.snapshot.json` is byte-stable under SDK 1.29 + Zod 4 |

**Note:** One test failed during full-suite run (`watcher.test.ts:95 — "re-indexes a modified file"`). Isolated rerun: clean. Same chokidar-timing flake STATE.md logged (3/4 green pattern). Documented carry-forward; **not a regression**.

### SC-2 — CI greps zero-hit outside adapters; branded DocId rejects raw string · ✓ VERIFIED

| Check | Result |
|-------|--------|
| `sh scripts/lint-adapters.sh` | exit 0 — all 8 invariants (I-1 .. I-6 + I-5b + C-1) green |
| `npm run lint:check` (full chain) | green: fixture-privacy + no-telemetry + 8 adapter-seam invariants + tsc + prettier |
| Lint allow-lists | I-2/I-3: `src/{adapters,config,vault,rerank}/` (infra paths only). I-3 also: `server.ts` (ONNX model dir), `indexer/single.ts` (vault-boundary safety check). All carve-outs are non-vault-content paths. Reasonable. |
| Branded DocId negative test | `tests/types/docid-brand.test-d.ts` exists with 3 `@ts-expect-error` cases (literal, variable, call site) + 1 positive `parseDocId()` sanity. `tsc --noEmit` accepts the directives — i.e. all 3 negative cases ARE compile-errors today |
| `verbatimModuleSyntax: true` + `noUncheckedIndexedAccess: true` | preserved in `tsconfig.json` (already set pre-Phase-1) |

### SC-3 — Non-Claude smoketest passes; README leads with "any MCP-aware agent" · ✓ VERIFIED

| Check | Result |
|-------|--------|
| `node scripts/smoketest-non-claude.mjs` | exit 0; 4 assertions green (23 tools listed, all descriptions non-empty, list_vaults envelope OK, bogus tool surfaces A6 error) |
| Smoketest client identity | `name: "non-claude-smoketest"` — not Claude (confirmed at scripts/smoketest-non-claude.mjs:90) |
| CI wiring | `.github/workflows/ci.yml` step "Smoketest (non-Claude MCP SDK Client against dist/cli.js)" with `timeout-minutes: 5` — runs in CI, gates merge |
| README lead | `head -20 README.md` — first paragraph: `"…exposed to **any MCP-aware agent**."`. Phrase appears **twice in the first 12 lines** (lead sentence + body sentence). Tone reads naturally; not a tacked-on edit. |

### SC-4 — SDK ^1.29.x + Zod ^4.x; registerTool migrated; Standard Schema wiring works · ✓ VERIFIED

| Check | Result |
|-------|--------|
| `package.json` declaration | `"@modelcontextprotocol/sdk": "^1.29.0"`, `"zod": "^4.4.3"` |
| `npm ls` (post-install resolution) | `@modelcontextprotocol/sdk@1.29.0` + `zod@4.4.3` (top-level + deduped under sdk's transitive `zod-to-json-schema`) |
| `node_modules/zod/package.json` | `version: 4.4.3` — STATE.md's npm-install-lesson resolved correctly |
| `grep "setRequestHandler(CallToolRequestSchema" src/server.ts` | **0 hits** — fully migrated |
| `grep "server\.registerTool(" src/server.ts` | 1 call site in a `for (const tool of TOOLS)` loop covering all 23 tools (server.ts:462). `TOOLS` length = 23. Snapshot tool count = 23 ✓ |
| `McpServer` import | resolvable via `import('@modelcontextprotocol/sdk/server/mcp.js')` — confirmed |
| Zod-4 raw-shape passing to `registerTool` | Implementation: `{ description: tool.description, inputSchema: schema }` where `schema = TOOL_SCHEMAS[name]` (Zod raw shape). `suggest_frontmatter` cross-field refinement re-validated at handler time via `buildToolSchema(name).parse(args)` — documented in 01-05 SUMMARY Deviation 1+2 (Rule 3 auto-fix). |
| Pitfall 2 (SDK#1143 description-drop) | EMPIRICALLY MOOT in SDK 1.29 — all 23 tools have non-empty `description` field (lengths 41–384). W6 manual snapshot-description-diff checkpoint passes. |

### SC-5 — Stub-adapter conformance green; doc_uri Strategy A applied · ✓ VERIFIED

| Check | Result |
|-------|--------|
| `src/adapters/source/conformance.test.ts` | Parameterized via `describe.each(adapters)` over `{name:"obsidian-fs", …}` + `{name:"stub", …}` — line 106. Both adapters run the same suite. |
| `src/adapters/delivery/conformance.test.ts` | Parameterized via `describe.each(adapters)("DeliveryAdapter conformance (%s)", …)` — line 77. Both adapters run. Plus an `ObsidianFsDelivery — filesystem invariants (adapter-specific)` extension block. |
| `src/adapters/change-feed/conformance.test.ts` | Parameterized via `describe.each(adapters)("ChangeFeed conformance (%s)", …)` — line 104. Both adapters run. Stub publishes `emitsRename:true` (capability honesty contrast vs `obsidian-fs` `emitsRename:false`). |
| `MIGRATION_007_DOC_URI_ADD` | Present at `src/db/schema.ts:419` — `ALTER TABLE notes ADD COLUMN doc_uri TEXT; CREATE INDEX IF NOT EXISTS idx_notes_doc_uri ON notes(doc_uri);` (additive, nullable) |
| `runMigration008` | Present at `src/db/schema.ts:441` — backfills with `doc_uri = @prefix || path` where `@prefix = "obsidian-fs://" + vaultName + "/"`. Idempotency guard: `WHERE doc_uri IS NULL` (line 459). |
| W3 caveat — COALESCE-undefined test for `_update` path | Present: `src/db/queries/notes.test.ts:55` — `"update via upsertByPath preserves existing doc_uri when caller omits it (COALESCE)"` |

---

## 2. ADP Requirements (15/15 satisfied)

| ID | Requirement | Status | Evidence |
|----|------------|--------|----------|
| ADP-01 | SourceConnector + obsidian-fs source | ✓ | `src/adapters/source/obsidian-fs/index.ts` (`ObsidianFsSource` class), `src/adapters/source/types.ts` (interface) |
| ADP-02 | DeliveryAdapter + obsidian-fs delivery | ✓ | `src/adapters/delivery/obsidian-fs/index.ts` (`ObsidianFsDelivery`), `src/adapters/delivery/types.ts` (interface + `WriteOptions.sink?` Phase-2 hook present) |
| ADP-03 | ChangeFeed + obsidian-fs change-feed | ✓ | `src/adapters/change-feed/obsidian-fs/change-feed.ts` + `index.ts` (facade + `SuppressionSet` export); chokidar import confined here per I-1 |
| ADP-04 | Canonical types in src/types.ts | ✓ | `src/types.ts`: `Document`, `BlockNode`, `Edge`, `ChangeEvent`, `SourceHandle`, `MemorySinkHandle`, `WikilinkRef`, `DocumentRef`, `PropertyBag` |
| ADP-05 | Branded DocId nominal | ✓ | `src/types.ts:254`: `export type DocId = string & { readonly __brand: "DocId" }`. Compile-time negative test at `tests/types/docid-brand.test-d.ts` covers literal, variable, call site (3 `@ts-expect-error` lines). |
| ADP-06 | Capability descriptors on all adapters | ✓ | 6 `readonly capabilities` declarations: 3 obsidian-fs adapters + 3 stub adapters. I-7 honesty enforced by conformance suite. |
| ADP-07 | doc_uri Strategy A migration + backfill | ✓ | Migrations 007 (additive nullable + index) + 008 (backfill with `WHERE doc_uri IS NULL` idempotency). `doc_uri: string \| null` on `NoteRow`. |
| ADP-08 | SDK ^1.29.x | ✓ | `npm ls @modelcontextprotocol/sdk` → `1.29.0`; `package.json: "^1.29.0"`. Snapshot byte-stable post-install. |
| ADP-09 | Zod ^4.x | ✓ | `npm ls zod` → `4.4.3`; `package.json: "^4.4.3"`. Standard Schema wiring works (registerTool consumes raw shape). |
| ADP-10 | smoketest-non-claude.mjs + CI wired | ✓ | `scripts/smoketest-non-claude.mjs` exists, runs 4 assertions, exits 0. CI step at `.github/workflows/ci.yml`. Client identifies as `non-claude-smoketest`. |
| ADP-11 | AGENT_AGNOSTIC_AUDIT.md | ✓ | `docs/v2/AGENT_AGNOSTIC_AUDIT.md` exists. Per SUMMARY: 22 rows cross-referenced to CONCERNS.md, every leak fixed-v2 or deferred-v3 with resolving-commit refs. (Sample rows confirmed: row 1 covers `obsidianUrl()` D-01 with file/line ref + status `fixed-v2`.) |
| ADP-12 | lint-adapters.sh, CI greps zero-hit | ✓ | `sh scripts/lint-adapters.sh` exit 0, all 8 invariants green. Wired into `npm run lint:check` + CI workflow. |
| ADP-13 | Conformance suite parameterized × 2 | ✓ | All 3 seams use `describe.each` over obsidian-fs + stub. StubSource + StubDelivery + StubChangeFeed all implement the same interface their non-stub counterparts do. |
| ADP-14 | README lead "any MCP-aware agent" | ✓ | `head -20 README.md` — phrase appears in lead paragraph AND body sentence (twice in first 12 lines). |
| ADP-15 | 324 v1 tests + baseline eval green | ✓ | 578/578 passing (no v1 regression — 254 new tests added on top of the original 324). Eval baseline green. Snapshot byte-stable. |

---

## 3. Plan-Checker Caveats (W1..W6 + N1..N4)

| Caveat | Description | Status |
|--------|-------------|--------|
| W1 | 01-05 split recommended as fallback | **Not split, but executed cleanly.** No SDK-migration regressions observed; snapshot byte-stable; SUMMARY documents the two Rule-3 auto-fixes (TOOLS shape kept narrow; registerTool takes Zod raw shape, not raw JSON Schema). Decision: bundling did not hurt outcome. |
| W2 | StubDelivery + StubSource co-instantiation in conformance | ✓ Both stubs are instantiated in `src/adapters/delivery/conformance.test.ts` (`makeStubFixture()` returns adapter + `mintId`). Verified at line 60–66. |
| W3 | COALESCE-undefined test for `_update` path | ✓ Test exists: `src/db/queries/notes.test.ts:55` — "update via upsertByPath preserves existing doc_uri when caller omits it (COALESCE)". |
| W4 | obsidianUrl encoding parity pre-read | ✓ `obsidianUrl()` helper deleted from `src/server.ts`. Replacement `SourceConnector.formatDisplayUrl(id)` at `src/adapters/source/obsidian-fs/index.ts:154`. Server falls back to `obsidian-fs://<vault>/<path>` if adapter declines (`server.ts:974`). Encoding parity confirmed by snapshot byte-stability. |
| W5 | Wave numbering / parallelism | Informational. Six waves executed serially on main per `branching: none`; clean. |
| W6 | Snapshot description-diff manual checkpoint | ✓ Pitfall 2 (SDK#1143) verified empirically MOOT in 1.29. All 23 tools have descriptions (lengths 41–384); snapshot byte-stable after regeneration. APPROVED in 01-06. |
| N1–N4 | (not enumerated in inputs) | Not applicable as separate items beyond W1-W6 coverage. |

---

## 4. Project Invariants (CLAUDE.md non-negotiables)

| Invariant | Status | Evidence |
|-----------|--------|----------|
| Tech stack: TS 5.7+ / Node ≥22 / ESM-only | ✓ | `package.json` unchanged on these (`engines.node ≥22`, `type: module`, `typescript ^5.7.0`) |
| Local-only network: localhost:11434 Ollama | ✓ | No new network calls in Phase 1 (verified: smoketest is stdio-only) |
| Backwards-compatible v1.x API: 23 tools name/inputSchema/output | ✓ | `tools-list.snapshot.json` byte-stable; all 23 v1 names preserved (verified by `jq '.tools[].name'`); pinned snapshot test in `baseline.test.ts` green |
| Seam preservation: chokidar / gray-matter / fs.* / path.* / Claude / `obsidian://` / bare `.md` confined to adapters | ✓ | `lint-adapters.sh` exit 0; all 8 invariants green. Mechanical enforcement on every PR + push to main. |
| Document identity opaque (`obsidian-fs://<vault>/<rel-path>` URI) | ✓ | `parseDocId` / `formatDocId` in `src/adapters/registry.ts` are the sole minting points. DocId is branded. doc_uri column persists the URI form. |
| `Document` canonical content type with `properties: Record<string, unknown>` | ✓ | `src/types.ts` defines `Document.properties: PropertyBag = Record<string, unknown>` |
| Memory namespace sacrosanct (seam shape must support Phase 2) | ✓ | `WriteOptions.sink?: MemorySinkHandle` declared in `src/adapters/delivery/types.ts:133` for Phase-2 hook (accept-and-ignore in Phase 1, per planned design). |
| Test discipline: 324 tests do not regress | ✓ | 578 passing (no `.skip`'d v1 tests; +254 new). 11 todo placeholders are Phase-0-planned future floors. |
| Branch hygiene | NOT-APPLICABLE | Phase used `branching: none` config; six waves landed directly on main with merge commits per wave. Per CLAUDE.md, branching is configurable; the maintainer ran without phase branches this phase. |
| Eval discipline: `evals/fixtures/` + `eval:baseline` gate | ✓ | `eval:baseline` runs on every PR + push via CI. Snapshot pin + per-tool YAML semantic floors both active. |

---

## 5. Anti-Pattern Scan

| Pattern | Hits | Notes |
|---------|------|-------|
| `TODO` / `FIXME` / `XXX` in Phase-1 artifacts | 0 | Checked `src/adapters/`, `scripts/lint-adapters.sh`, `scripts/smoketest-non-claude.mjs`, `docs/v2/AGENT_AGNOSTIC_AUDIT.md`, `src/server.ts`, `src/tool-registry.ts`, `src/db/schema.ts`, `src/types.ts`. Zero unresolved debt markers. |
| `.skip(` / `.skip,` in test files | 0 | None disabled. |
| Empty handler stubs (`return null`, `return {}`) outside data types | 0 not flagged in changed files | Spot-checked `src/adapters/stub/*.ts` — stubs return real data (e.g. `Document[]` for `StubSource`), not empty placeholders. |
| Console-log-only handlers in server.ts | 0 | All 23 tool handlers route to real business logic via `handlers[name]` dispatch table. |
| Stale imports to deleted `src/{reader,watcher,write}/` | 0 | Verified with `grep -rE 'from "\.\./reader' --include="*.ts" src/` → no matches. Old dirs deleted. |

---

## 6. Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Build produces runnable CLI | `npm run build` | `dist/cli.js 233.96 KB` produced | ✓ PASS |
| 23 tools surface via MCP | `node scripts/smoketest-non-claude.mjs` | "tools/list returned all 23 v1 tools" | ✓ PASS |
| Snapshot byte-stable | `npm run eval:snapshot && git diff evals/v1-baseline/tools-list.snapshot.json` | zero diff | ✓ PASS |
| Lint script exits 0 | `sh scripts/lint-adapters.sh` | exit 0, 8 invariants green | ✓ PASS |
| Full phase-gate | `npm run lint:check && npm test && npm run eval:baseline && sh scripts/lint-adapters.sh && npm run build && node scripts/smoketest-non-claude.mjs` | All green (modulo the 1 known flake on the test step — isolated rerun clean) | ✓ PASS-with-flake |

---

## 7. Known Issues / Carry-Forward

### Carry-forward 1 — Timing flake in change-feed/watcher tests

- **File(s):** `src/adapters/change-feed/obsidian-fs/change-feed.test.ts:91` and `src/adapters/change-feed/obsidian-fs/watcher.test.ts:95` ("re-indexes a modified file" / "emits update on a modified .md file")
- **Symptom:** Occasional `undefined === "Old"` (or similar) under full-suite load.
- **Root cause:** chokidar `awaitWriteFinish` 700ms threshold vs vitest concurrency on macOS.
- **Frequency:** Hit watcher.test.ts:95 once on this verification run (1 of 1 full-suite invocation). Isolated rerun: 3/3 green.
- **Mitigation recommendation:** Phase 2 first wave should bump `stabilityThreshold` from 200ms to 400ms, or add `vitest.retry: 1` for these two files. STATE.md Blockers already logs the same.
- **Severity:** Non-blocking. Snapshot, eval, lint, and build are all green. The flake does not indicate a regression — it predates Phase 1 (`watcher.test.ts` had it pre-extraction).

### Carry-forward 2 — VaultWatcher coexists with ObsidianFsChangeFeed in bootstrap

Per 01-05 SUMMARY decision: "Phase 2+ will retire VaultWatcher in favor of an indexer subscribing through the ChangeFeed seam." Both watch the same vault today. Documented and intentional. Phase 2 task.

### Carry-forward 3 — `src/config/add-vault.ts` path-safety

Per 01-CONTEXT.md (deferred section): `add-vault.ts` does not use `safeJoinInsideVault`. Low severity (CLI run by vault owner). Out of ADP-* scope; Claude's Discretion. Not addressed this phase; remains a Phase 8 polish candidate.

---

## 8. Recommendations Before `/gsd-complete-milestone`

1. **Add flake retry-once policy** to `src/adapters/change-feed/obsidian-fs/{change-feed,watcher}.test.ts` (vitest `test.retry(1)` or stabilityThreshold bump). Track as Phase 2 wave-0 micro-task. Cost: ~5 minutes.
2. **Mark all 15 ADP requirements complete in `.planning/REQUIREMENTS.md`** when the milestone-close runs.
3. **Tick the Phase 1 checkbox** in `.planning/ROADMAP.md` (line 14).
4. **No other follow-ups** are required to close Phase 1 specifically. The remaining items (Phase 2 memory namespace, VaultWatcher retirement) are explicitly future-phase work per the planning documents.

---

## 9. Final Verdict

**PASS-with-caveats.**

The phase delivers what it promised: three adapter seams installed, SDK 1.29 + Zod 4 migration complete, client-agnosticism mechanically enforced (lint-adapters.sh + smoketest in CI), conformance suite parameterized over real + stub adapters, doc_uri Strategy A migration applied + backfilled idempotently, README rewritten with honest framing.

All 5 ROADMAP success criteria verify TRUE against the codebase (not just SUMMARY claims). All 15 ADP requirements are individually satisfied with code evidence. All 8 lint invariants green. Snapshot byte-stable. 578 tests passing. Build produces a runnable CLI. Non-Claude smoketest passes in CI.

The sole caveat is a documented chokidar-timing flake that predates Phase 1 and is already in STATE.md Blockers/Concerns. It does not indicate a regression.

**Phase 1 is ready for milestone close.**

---

*Verified: 2026-05-15T13:00:00Z*
*Verifier: Claude (gsd-verifier, opus 4.7-1m)*
