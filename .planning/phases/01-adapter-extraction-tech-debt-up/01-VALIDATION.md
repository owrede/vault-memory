---
phase: 1
slug: adapter-extraction-tech-debt-up
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-14
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: derived from `01-RESEARCH.md` §Validation Architecture (lines 801–856).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest ^2.1.8` (existing; co-located `*.test.ts`) |
| **Config file** | None (vitest defaults) |
| **Quick run command** | `npm run lint:check && npm test -- --run` |
| **Full suite command** | `npm run lint:check && npm test && npm run eval:baseline && sh scripts/lint-adapters.sh && node scripts/smoketest-non-claude.mjs` |
| **Estimated runtime** | ~60–120 seconds (quick); ~3–6 min (full incl. eval + smoketest) |

---

## Sampling Rate

- **After every task commit:** `npm test -- --run <changed file globs>` (vitest auto-routes) + `sh scripts/lint-adapters.sh` once it exists (plan 01-06)
- **After every plan wave (PR boundary):** `npm run lint:check && npm test && npm run eval:baseline && sh scripts/lint-adapters.sh`
- **Before `/gsd-verify-work` (phase gate):** Full suite above **plus** `node scripts/smoketest-non-claude.mjs` **plus** `npm run build` (verifies `dist/cli.js` still bundles under SDK 1.29 / Zod 4)
- **Max feedback latency:** ~120 seconds (quick command) — well under the 5-min Nyquist threshold

---

## Per-Task Verification Map

> Per-requirement mapping. The planner will further decompose each plan into tasks and may extend this table. Test files marked `❌ W0` are Wave 0 dependencies (created before first non-Wave-0 task in their plan).

| Req ID | Behavior | Plan | Test Type | Automated Command | File Exists | Status |
|--------|----------|------|-----------|-------------------|-------------|--------|
| ADP-01 | `SourceConnector` interface implemented by `obsidian-fs`; all read paths route through it | 01-03 | unit + integration | `npm test -- src/adapters/source` | ❌ W0 | ⬜ pending |
| ADP-02 | `DeliveryAdapter` interface implemented by `obsidian-fs`; all write paths route through it | 01-04 | unit + integration | `npm test -- src/adapters/delivery` | ❌ W0 | ⬜ pending |
| ADP-03 | `ChangeFeed` interface implemented; chokidar confined; subscribe/close lifecycle correct | 01-05 | unit | `npm test -- src/adapters/change-feed` | ❌ W0 | ⬜ pending |
| ADP-04 | Canonical types (`Document`, `BlockNode`, `Edge`, `ChangeEvent`, `SourceHandle`, `MemorySink`) compile and are referenced from src/ | 01-01 | typecheck | `npm run lint` (`tsc --noEmit`) | ✓ partial (`src/types.ts`) | ⬜ pending |
| ADP-05 | Branded `DocId` rejects raw `string` at compile time (negative test) | 01-01 | typecheck negative test | `npm run lint`; `tests/types/docid-brand.test-d.ts` | ❌ W0 | ⬜ pending |
| ADP-06 | Capability descriptors present on both source and delivery adapters; conformance suite asserts honesty | 01-01..05 | conformance | `npm test -- 'src/adapters/**/conformance.test.ts'` | ❌ W0 | ⬜ pending |
| ADP-07 | Migrations 007 + 008 apply cleanly; backfill produces non-null `doc_uri` for every row; idempotent | 01-02 | unit (DB-level) | `npm test -- src/db` | ✓ partial (`src/db/database.test.ts`) | ⬜ pending |
| ADP-08 | SDK 1.29 installed; `tools/list` snapshot still matches; `registerTool` migration green | 01-05 | snapshot + unit | `npm run eval:snapshot && npm test -- src/server.test.ts` | ✓ partial (snapshot regenerated) | ⬜ pending |
| ADP-09 | Zod 4 installed; all schemas parse without runtime error; v1-baseline eval set behaviorally identical | 01-05 | unit + eval | `npm test && npm run eval:baseline` | ✓ | ⬜ pending |
| ADP-10 | Non-Claude smoketest passes end-to-end against MCP Inspector CLI | 01-06 | smoketest (e2e) | `node scripts/smoketest-non-claude.mjs` | ❌ W0 | ⬜ pending |
| ADP-11 | Audit doc enumerates Claude/Obsidian assumptions; each either fixed or labeled v3 | 01-06 | manual review | `cat docs/v2/AGENT_AGNOSTIC_AUDIT.md` | ❌ W0 | ⬜ pending |
| ADP-12 | CI greps (I-1..I-6 + Claude-leak) return zero hits outside adapter modules | 01-06 | shell lint | `sh scripts/lint-adapters.sh` | ❌ W0 | ⬜ pending |
| ADP-13 | Stub-adapter conformance suite passes for both `obsidian-fs` and stub | 01-03..05 | parameterized test | `npm test -- 'src/adapters/**/conformance.test.ts'` | ❌ W0 | ⬜ pending |
| ADP-14 | README lead paragraph starts with "any MCP-aware agent" framing | 01-06 | manual review | `head -20 README.md` | ✓ (README exists; rewrite) | ⬜ pending |
| ADP-15 | All 324 v1 tests + v1-baseline eval still green at phase end | 01-01..06 | full suite | `npm test && npm run eval:baseline` | ✓ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> Files / scripts / fixtures that must exist before the corresponding plan's non-Wave-0 tasks can verify. The planner will assign these to the first task of each plan (or split into a dedicated Wave-0 task list per plan).

- [ ] `src/adapters/source/types.ts` — `SourceConnector`, `SourceCapabilities`, `ListOptions`, `DocumentRef` (plan 01-01 → ADP-01, ADP-06)
- [ ] `src/adapters/delivery/types.ts` — `DeliveryAdapter`, `DeliveryCapabilities`, `WriteOptions`, `WriteResult` (plan 01-01 → ADP-02, ADP-06)
- [ ] `src/adapters/change-feed/types.ts` — `ChangeFeed`, `ChangeEvent` (plan 01-01 → ADP-03)
- [ ] `src/adapters/registry.ts` — handle parser, `parseDocId`, `mintDocId` (plan 01-01 → ADP-05)
- [ ] `src/adapters/capabilities.ts` — shared capability types (plan 01-01 → ADP-06)
- [ ] `tests/types/docid-brand.test-d.ts` — compile-time `expectError<DocId, string>` (plan 01-01 → ADP-05)
- [ ] `src/adapters/source/conformance.test.ts` — parameterized over obsidian-fs + stub (plan 01-03 → ADP-13)
- [ ] `src/adapters/delivery/conformance.test.ts` — parameterized over obsidian-fs + stub (plan 01-04 → ADP-13)
- [ ] `src/adapters/change-feed/conformance.test.ts` — parameterized over obsidian-fs + stub (plan 01-05 → ADP-13)
- [ ] `src/adapters/stub/{source,delivery,change-feed}.ts` — in-memory stub adapters (plans 01-03..05 → ADP-13)
- [ ] `src/db/schema.ts` — append MIGRATION_007 (additive column) + MIGRATION_008 (backfill) (plan 01-02 → ADP-07)
- [ ] `scripts/lint-adapters.sh` — POSIX shell lint enforcing I-1..I-6 + Claude-leak greps (plan 01-06 → ADP-12)
- [ ] `scripts/smoketest-non-claude.mjs` — non-interactive Inspector CLI smoketest (plan 01-06 → ADP-10)
- [ ] `docs/v2/AGENT_AGNOSTIC_AUDIT.md` — leak inventory + per-leak v2/v3 label (plan 01-06 → ADP-11)
- [ ] `.github/workflows/ci.yml` — CI step invoking `scripts/lint-adapters.sh` and the smoketest (plan 01-06 → ADP-10, ADP-12)
- [ ] `evals/v1-baseline/tools-list.snapshot.json` — regenerate under SDK 1.29 + Zod 4 (plan 01-05 → ADP-08, ADP-09)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Agent-agnostic audit completeness | ADP-11 | Requires human judgment per leak whether it's fixable now (v2) or deferred (v3) | Open `docs/v2/AGENT_AGNOSTIC_AUDIT.md` and confirm each row has a Status column entry of `fixed-v2` or `deferred-v3` with a one-line rationale; maintainer sign-off in the PR description |
| README lead framing | ADP-14 | Tone/voice check — automated grep insufficient | `head -20 README.md` — first sentence MUST start with or contain "any MCP-aware agent" framing; PR reviewer confirms it reads naturally |
| `tools/list` snapshot diff under SDK 1.29 + Zod 4 | ADP-08, ADP-09 | Pitfall 2 (issue #1143) may silently drop `description` strings; auto-diff doesn't catch semantic regressions | After regenerating `evals/v1-baseline/tools-list.snapshot.json`, manually diff against the Phase-0 baseline; confirm no `description` fields are empty/missing for any of the 23 tools; if regression detected, fall back to the raw-JSON-Schema workaround from `tool-registry.ts` (already documented in RESEARCH §Pitfall 2) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (verified once planner emits PLAN.md files)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all `❌ W0` references in the verification map
- [ ] No watch-mode flags in any test command (vitest `--run` enforced in quick command)
- [ ] Feedback latency < 120s for the quick command
- [ ] `nyquist_compliant: true` set in frontmatter once the planner sign-off list above is checked

**Approval:** pending
