---
phase: 00-foundation-decisions
verified: 2026-05-14T22:30:00Z
status: gaps_found
score: 13/14 FND must-haves verified (1 PARTIAL); 1 phase-wide constraint failure (CI gate)
overall_verdict: PASS-with-caveats
verifier: Claude (gsd-verifier, goal-backward audit, independent of SIGN-OFF.md)
gaps:
  - truth: "`npm run lint:check` (the gate Phase 0 itself shipped) must pass on a clean tree so the CI workflow is functional from day 1 of Phase 1"
    status: failed
    reason: "Pre-existing prettier drift in 76 src/ files trips `prettier --check`, returning exit 1. Phase 0 explicitly built `lint:check` on top of `prettier --check` (D-21), shipped the CI workflow that invokes it, and merged the SIGN-OFF claim that the CI gate is green — but `npm run lint:check` exits 1 today on `main`. The next push to main lights CI red."
    artifacts:
      - path: "package.json:scripts.lint:check"
        issue: "Composes `prettier --check 'src/**/*.ts'` against a tree with 76 unformatted files."
      - path: ".github/workflows/ci.yml"
        issue: "Runs `npm run lint:check` on every PR and push:main — will fail on the next commit."
    missing:
      - "One-shot `npx prettier --write 'src/**/*.ts'` commit BEFORE Phase 1 begins (executor punted this to Phase 1 as 'housekeeping' but the gate is broken NOW)."
      - "OR: remove `prettier --check` from the `lint:check` chain until Phase 1 lands the formatting fix (acceptable if documented)."
deferred:
  - truth: "Alpine bake-test for POSIX-portability of shell lints"
    addressed_in: "Phase 0 §Manual-Only — to be run by maintainer pre-Phase-1"
    evidence: "VALIDATION row + SIGN-OFF §Known deferred items both list this explicitly; deferred because Docker daemon was unavailable in executor's host. Acceptable as a one-shot manual step; non-blocking."
human_verification:
  - test: "Alpine bake-test of `scripts/check-fixture-privacy.sh` and `scripts/lint-no-telemetry.sh`"
    expected: "Both lints exit 0 inside `alpine` container with BusyBox grep/find (proves POSIX portability; macOS BSD grep was used by executor)"
    why_human: "Requires Docker daemon access; documented as manual in VALIDATION.md and acknowledged in SIGN-OFF.md §Known deferred items."
  - test: "Confirm maintainer audit-trail for FND-14 under branch-less workflow"
    expected: "Maintainer attests on record (commit signed-off or wiki/issue note) that Phase 0 deliverables are accepted, since `branching_strategy: none` removes the PR-approval surface D-17 was written for"
    why_human: "SIGN-OFF.md still says `Maintainer: _to be recorded at PR approval time per D-17_` literally; the gate-checkpoint approval that the executor used as substitute is ephemeral and not captured anywhere persistent. A human must decide whether the branch-less variant constitutes a satisfactory audit-trail."
---

# Phase 0: Foundation & decisions — Verification Report

**Phase Goal (ROADMAP.md line 29):** Lock ADRs, architecture docs, eval fixtures, regression baselines, and CI lints so every later phase builds on a stable, public substrate.

**Verified:** 2026-05-14
**Status:** gaps_found (overall PASS-with-caveats: 13/14 FND requirements substantively satisfied; one cross-cutting CI gate inherits pre-existing prettier drift and was knowingly punted to Phase 1)
**Independent of SIGN-OFF.md self-assessment** — every claim independently traced to file evidence and command output.

---

## Per-FND audit

| #  | Promise | Verdict | Evidence (file paths · line counts · SHAs) | Notes |
|----|---------|---------|--------------------------------------------|-------|
| **FND-01** | ADRs 001–004 relocated from gitignored `docs/dev/` to public `docs/v2/adr/` | **PASS** | `git ls-files docs/v2/adr/` shows all four tracked. `.gitignore` line 16 now only ignores `docs/dev/gsd-agent-knowledg-layer.md`. `git log --follow docs/v2/adr/001-document-identity.md` traces back through `e1b2524` (relocate commit) preserving history. | Original `docs/dev/00{1,2,3,4}-*.md` files still exist on disk as **untracked** leftovers (`git status` shows `docs/dev/` as untracked). Recommend `rm -rf docs/dev/00{1,2,3,4}-*.md` for cleanliness; non-blocking. |
| **FND-02** | ADR-003 amended: hash semantics + chunk-level `source_hashes` | **PASS** | `docs/v2/adr/003-document-shape.md:294` — `sha256(canonical(blocks_text) \|\| canonical(PropertyBag))`. RFC 8785, NFC, LF, IEEE 754 all present (lines 296, 323, 327, 329, 333, 349–357). `source_hashes` schema documented at line 392. | Robust amendment; exceeds the FND-02 floor. |
| **FND-03** | ADR-004 amended: folder-default sink, separate-vault config-only | **PASS** | `docs/v2/adr/004-memory-sink-handles.md:242` "Amendment — Folder-default is the only code path". `[memory] sink = "@…"` syntax at line 320–323. `.memory-sink` sentinel at line 276. Invariant M-2: "No source code MUST branch on which form is in use" (line 467). | Clean amendment; ties to MEMORY_CONTRACT Guard A/B. |
| **FND-04** | Every ADR has Invariants + Examples; adversarial review confirms Phase-10 agent could implement Notion from ADRs alone | **PASS** | All four ADRs carry `## Invariants` + `## Examples` (grep confirms). Every ADR has both `obsidian-fs://` AND `notion-api://` worked examples. `ADVERSARIAL-REVIEW.md` (23 KB) raises 10 findings; 6 amended in Phase 0 (Findings 1, 2, 4, 7, 9, 10 via commits `aa320de`, `709339a`, `01ba6bd`); 4 deferred-v3 (Findings 3, 5, 6, 8 via `e911d53`). Reviewer's own §Stop summary recommends EXACTLY this 6/4 amend/defer split — confirming the deferrals are reviewer-endorsed, not sloppy. | The deferred findings (F3 listDocuments scope, F5 modifiedSince, F6 excludeGlobs grammar, F8 BlockNode caps) are all **adapter-internal capability surface**, not v2 cross-source architectural gaps. The general principle (adapters publish honest capability descriptors) is already in ADR-002 I-7. A Phase 10 agent has the contract; the deferred details are implementer judgment calls inside their adapter, not unspecified v2 invariants. NOTION-ADAPTER-PLAN.md (companion artifact) cross-references each deferred finding inline. |
| **FND-05** | `docs/v2/ARCHITECTURE.md` published; ≤800 lines; L0–L4 layer model | **PASS** | File: 455 lines (well under 800). Layer model visualized at lines 47–60 (L0 → L4). Cross-links to ADRs 001–004. | Substantive content, not placeholder. |
| **FND-06** | `docs/v2/MEMORY_CONTRACT.md` — provenance property contract | **PASS** | File: 542 lines. All 7 required keys defined with type/values/validator behavior/worked example: `source`, `confidence`, `evidence`, `status`, `observed_at`, `superseded_by`, `type` (lines 53–80+). Guards A and B specified against `DeliveryAdapter.write()` chokepoint. | Operational expression of ADR-004 invariants; well-scoped. |
| **FND-07** | `docs/v2/AGENT_AGNOSTIC.md` — MCP canonical | **PASS** | File: 210 lines. Stance section at line 19 explicitly names "MCP is the canonical client interface" and disclaims Claude-only, ChatGPT-only, vendor-SDK bundling. | No Claude-only strings; matches the AGENT_AGNOSTIC norm. |
| **FND-08** | Fixture vault: 50–100 notes; ≥3 hand-labeled queries per category | **PASS** | 56 narrative `.md` notes (excluding `_queries/`); 15 `_memory/` subset; 7 `_queries/*.yaml` files. Per-file query counts: brief=5, bundle=5, contract=5, dossier=6, graph=5, memory=6, search=7. All ≥3. Sample `_memory/status-updates/*.md` carries full MEMORY_CONTRACT provenance properties (`source: agent`, `confidence: direct`, `evidence: [...]`, `status: active`, `observed_at`, `type: status-update`). | Fixture is hand-authored and legible. _memory subset target was "~20"; ships 15. Minor under-shoot vs context-statement (20) but VALIDATION row 00-08-02 required ≥15, which passes. |
| **FND-09** | v1 regression suite frozen — every v1 tool's expected behavior captured | **PARTIAL** | 13 `*.yaml` baseline fixtures; 11 cover real v1 tools (`search`, `search_text`, `search_semantic`, `search_hybrid`, `query_frontmatter`, `list_backlinks`, `list_forward_links`, `find_broken_links`, `fetch`, `vault_stats`, `suggest_frontmatter`). 2 are placeholders (`graph_neighbors`, `graph_path`) — both explicitly note "v3+ tool, NOT part of the v1 surface" inline. `baseline.test.ts` parses every fixture; verifies referential integrity (every `expected_doc_id` resolves to a fixture file); per-tool precision/recall asserted as `.todo` for Phase 1 to wire. 29 passed + 11 todo. | 11 of the 23 v1 tools have behavioral fixtures (~48%). The 12 uncovered tools are: `list_vaults`, `read_note`, `write_note`, `update_frontmatter`, `delete_note`, `audit_log`, `list_models`, `start_shadow_index`, `switch_active_model`, `vacuum_embeddings`, `index_runs`, `recent_notes`. Most are admin/write/index-management surface that does not have a semantic-floor concept (precision/recall doesn't apply to `list_vaults`); but `read_note` and `recent_notes` arguably do. FND-09 says "every v1 tool's expected behavior captured" — verbatim, this is not satisfied. **Goal-backward read:** FND-10's snapshot pin already fences the entire 23-tool *shape*; FND-09 is meant to fence behavior on tools where behavior is observable. 11 retrieval/graph tools is a defensible interpretation. The two graph placeholders are documented inline, not silently empty. PARTIAL not FAIL because the gap is interpretable and the suite is a working regression floor for the tools that matter for Phase 1's refactor. |
| **FND-10** | `tools/list` snapshot pins JSON for all 23 v1 tools; drift fails CI | **PASS** | `evals/v1-baseline/tools-list.snapshot.json` contains 23 tool entries (verified by Python json parse). `node evals/v1-baseline/dump-tools.mjs \| diff - evals/v1-baseline/tools-list.snapshot.json` → exit 0 (byte-identical). `baseline.test.ts:34` asserts `expect(actual).toEqual(pinned)` and `toHaveLength(23)`. Test passes. CI workflow runs `npm test` which includes this test. | Snapshot is the single contract for the v1 tool surface and is byte-deterministic. `src/tool-registry.ts` (`294e30f`) is the single source of truth imported by both `server.ts` and `dump-tools.mjs`. Strong implementation. |
| **FND-11** | `scripts/check-fixture-privacy.sh` — fixture allowlist guard | **PASS** | File exists, executable (rwxr-xr-x), POSIX shell. `sh scripts/check-fixture-privacy.sh` → exit 0 on current tree. Operates on `git ls-tree -r --name-only HEAD` (committed state, not working tree — robust to debris). Allowlist: `v2-test-vault` only. Red-test executed inline by executor (SUMMARY confirms a sneaky `evals/fixtures/sneaky-vault/` commit trips exit 1 + clear error). | Clean implementation. Note: only POSIX flags used (no `-P` / `--include` / `--exclude-dir`) — confirmed by grep. |
| **FND-12** | `scripts/lint-no-telemetry.sh` — telemetry banlist | **PASS** | File exists, executable, POSIX shell. `sh scripts/lint-no-telemetry.sh` → exit 0 (65 files scanned). Banlist regex includes all required tokens (`analytics`, `telemetry`, `posthog`, `segment\.com`, `mixpanel`, `sentry`, `datadog`, `track\(`, `trackEvent`, `report\(`, `reportMetric`). Escape comment `// vault-memory:no-telemetry-ok` documented. Red-test was performed manually (per VALIDATION §Manual-Only) — executor SUMMARY claims maintainer-eyes-on completion. | Manual red-test (banlist trips + escape suppresses) was deferred to maintainer eyes per design — that is documented in VALIDATION §Manual-Only. The Alpine bake-test is deferred (Docker unavailable in executor's host); recorded under §Known deferred items in SIGN-OFF. Non-blocking. |
| **FND-13** | ADR index page lists contested choices with numbered ADRs | **PASS** | `docs/v2/adr/README.md` — MADR-style table. 4 Accepted rows (001–004). 14 Open rows (005–018) with `Status: Open` and `Phase: v3-Phase-10` for v3 work. Flat bullet enumeration repeats the 14 entries so `Status: Open` appears once per ADR (validation row 00-13-02 compatibility). Deferred-v3 section (added in `e911d53`) catalogues the 4 adversarial-review-deferred findings (F3, F5, F6, F8) with theme + target Open ADR. | Strong single-entry-point parking lot for v3. No drift. |
| **FND-14** | Maintainer sign-off on all Phase 0 docs/ADRs | **PASS-with-caveat** | `docs/v2/SIGN-OFF.md` exists with all 14 FND rows checked `[x]` and resolving 7-hex commit SHAs (every SHA verified to exist via `git cat-file -e`). **CAVEAT:** the literal `**Maintainer:** _to be recorded at PR approval time per D-17_` is unchanged. The project's `.planning/config.json` sets `branching_strategy: "none"` — there is no PR. Per the 00-15-SUMMARY executor note, FND-14 was satisfied via the gate-blocking checkpoint's `approved` reply (ephemeral, not captured in the file). | D-17 specifies "PR approval IS the audit". The branch-less variant the executor applied is defensible adaptation, but the audit-trail event (chat checkpoint reply) is not persistently captured. Recommend: maintainer edits SIGN-OFF.md to either name themselves explicitly OR adds a signed-off-by trailer to a follow-up commit. Surfaced under §Human verification. |

**Score: 13 PASS, 1 PARTIAL (FND-09). No outright FAIL.**

---

## Constraints check (PROJECT.md + CLAUDE.md)

| Constraint | Honored? | Evidence |
|------------|----------|----------|
| TypeScript 5.7+, Node ≥22, ESM-only, MCP SDK ≥1.0.4 | ✓ | No language/runtime changes. `package.json` unchanged except `yaml@^2.9.0` added (D-10, pulled forward). |
| Local-only network (`localhost:11434` Ollama only) | ✓ | Zero new network surface introduced. |
| Backwards-compatible v1.x API | ✓ | All 23 v1 tools preserved (snapshot pinned, byte-identical). Only `src/` change is `tool-registry.ts` extraction; `server.ts` imports from it. |
| Seam preservation (adapter modules, chokidar isolation) | N/A — Phase 1 work | Phase 0 ships no adapter code. |
| Memory namespace is sacrosanct | ✓ — at spec level | MEMORY_CONTRACT.md Guards A/B specified at `DeliveryAdapter.write()` chokepoint; runtime enforcement is Phase 2. |
| Document identity opaque (URI-style) | ✓ — at spec level | ADR-001 amendments include I-6 canonical-serialization invariant (closes the URL-encoding + UUID-serialization ambiguity). |
| `Document` as canonical content type | ✓ — at spec level | ADR-003 H-1..H-6 invariants in place. |
| Test discipline — 324 → 397+ tests, no regression | ✓ | 397 passed + 11 todo (40 files). Pre-existing `src/watcher/watcher.test.ts` timing flake is unrelated to Phase 0 (passes in isolation). |
| Branch hygiene — phase-N-slug | **N/A — overridden** | `.planning/config.json` sets `branching_strategy: "none"` — Phase 0 committed straight to main. PROJECT.md cites this rule but is silently overridden by GSD config. Not a Phase 0 violation per se; surfaced for visibility. |
| Eval discipline — fixture vault from Phase 0 | ✓ | Atlas Robotics fixture shipped (FND-08). |
| No premature LLM coupling | ✓ | Zero LLM calls added. |
| **CI lint:check gate must function** | **✗ FAILED** | `npm run lint:check` exits 1 today due to prettier drift in 76 pre-existing `src/` files. The CI workflow Phase 0 shipped will fail on the next push to main. Executor verified the drift is pre-existing (HEAD~30 also fails) and deferred fix to Phase 1, but the operational reality is: the gate Phase 0 built is RED on `main` right now. This is the only material constraint violation. |

---

## Deferred-v3 review (4 adversarial-review findings)

| # | Finding | Defer to | Justified? |
|---|---------|----------|-----------|
| F3 | `listDocuments` scope (Notion's integration-sharing model means "list everything" is impossible) | ADR-010 + ADR-018 | **Yes.** This is genuinely Notion-specific operational reality, not a cross-source architectural gap. ADR-002 I-7 already requires honest capability descriptors. |
| F5 | `modifiedSince` as hint vs guarantee (Notion has no server-side filter) | ADR-011 + ADR-018 | **Yes.** Same reasoning — capability flag pattern fits the existing I-7 framework. |
| F6 | `excludeGlobs` grammar per adapter | ADR-018 | **Yes.** Per-adapter glob grammar is capability-descriptor detail. |
| F8 | `BlockNode` caps + truncation marker | ADR-008 + ADR-018 | **Defensible but borderline.** Truncation policy affects hash stability (which is a v2 invariant per H-5). However, the resolution recommended (truncation marker is part of hash → re-reading is stable) is consistent with H-5; the *values* of caps are adapter judgment. Accept. |

**Overall: the 4 deferrals match the adversarial reviewer's own §Stop summary recommendation. Not sloppy.** The reviewer explicitly wrote: "findings that are adapter-internal capability surface defer to v3 Phase-10 work."

---

## Phase 1 readiness assessment

**Genuinely unblocked:**

- ADP-01..ADP-04 (adapter module skeletons + canonical types): ADR-002 specifies all three seam interfaces with Invariants; ADR-003 specifies `Document`/`BlockNode`/`Edge`/`PropertyBag`; ADR-001 specifies `DocId`/`SourceHandle`/`MemorySink` URI shape. Sufficient.
- ADP-05 (branded `DocId`): ADR-001 I-6 closes the canonical-serialization question.
- ADP-06 (capability descriptors): ADR-002 has `SourceCapabilities` and `DeliveryCapabilities` defined, including `refHashKind` and `hashProtected` enum (`'strong' | 'best-effort' | 'none'`).
- ADP-07 (`doc_uri` column): ADR-001 specifies the URI; Strategy A dual-column migration is unblocked.
- ADP-08/09 (SDK 1.29 + Zod 4): No Phase 0 dependency; can land at any time.
- ADP-12 (CI greps): Phase 0's CI workflow scaffold is in place; Phase 1 adds the grep rules to the same `lint:check` chain.
- ADP-13 (stub-adapter conformance): Atlas Robotics fixture (56 notes + `_queries/*`) is the substrate.
- ADP-15 (324 tests + baseline still green): baseline currently 29-pass + 11-todo; the .todo lift to real assertions is exactly Phase 1's task.

**Blocked / soft-blocked:**

- **Soft-block:** the CI workflow Phase 0 shipped is currently RED on `main`. Phase 1's first commit will trigger a CI red unless the prettier housekeeping (`npx prettier --write 'src/**/*.ts'`) lands first. This is trivially fixable (one commit) but needs to happen BEFORE Phase 1's first refactor PR — otherwise the team is debugging Phase 1 changes against a red baseline.
- **Soft-block:** Alpine bake-test (manual) should run once before Phase 1 lands its first CI-triggering change.

**Phase 1 inherits a clean ADR substrate, working eval fixtures, and a 23-tool snapshot pin. It does NOT inherit a green CI.**

---

## Anti-patterns scan (Phase 0 modified files)

- `src/tool-registry.ts` (only `src/` change): no TODO/FIXME/HACK markers; substantive (23 tool definitions with full input schemas); imported and used by `src/server.ts:50`. WIRED + REAL.
- `evals/v1-baseline/baseline.test.ts`: `.todo` placeholders for precision/recall floors. These ARE acknowledged stubs but with explicit Phase-1-handoff documentation in the file's header comment (lines 11–15). Acceptable — they exist precisely to keep the test discoverable and Phase 1 lights them up.
- `evals/v1-baseline/graph_neighbors.yaml`, `graph_path.yaml`: empty `queries: []` placeholders with header comment "v3+ tool, NOT part of the v1 surface." Acceptable — they exist to satisfy VALIDATION row 00-09-01's grep manifest, which was authored against tool-name speculation rather than the actual v1 surface. Documented honestly.
- No `placeholder` / `coming soon` strings in `docs/v2/*` or ADRs.
- No telemetry/analytics tokens (lint clean).
- No empty `return null` / `return {}` patterns introduced.

---

## Recommendations

### Blocking (must resolve before Phase 1 starts)

1. **Fix the prettier drift.** Run `npx prettier --write 'src/**/*.ts'` and commit as `style: apply prettier --write across src/ (Phase 0 → Phase 1 housekeeping)`. Without this, the CI workflow Phase 0 shipped is non-functional. The executor knew this and deferred it; do not let Phase 1 inherit a red gate.

### Non-blocking follow-ups

2. **Clean up `docs/dev/` untracked files.** `docs/dev/001-document-identity.md` through `004-memory-sink-handles.md` still exist on disk as untracked debris (only `docs/dev/gsd-agent-knowledg-layer.md` is intentionally gitignored). Remove them so the relocation is observably complete.
3. **Run the Alpine bake-test once.** A 30-second `docker run --rm alpine` against the two shell lints; documented in VALIDATION §Manual-Only and SIGN-OFF §Known deferred items.
4. **Persist the FND-14 audit-trail event.** Either: (a) edit SIGN-OFF.md's `Maintainer` field to name the maintainer explicitly with date, OR (b) add a `Signed-off-by:` trailer on a follow-up commit. The current chat-checkpoint approval is ephemeral and won't survive into future audit reviews.
5. **FND-09 coverage gap (PARTIAL):** consider adding lightweight baseline fixtures for `read_note`, `recent_notes`, and `vault_stats` arguments as Phase 1 housekeeping — these have observable behavior worth pinning. The 12 admin/write tools (list_vaults, list_models, write_note, etc.) are reasonably out of scope for semantic-floor eval; the snapshot pin (FND-10) already fences their shape.

### Watch-items for Phase 1

- The `src/watcher/watcher.test.ts` test has a timing-based flake on the second invocation in a parallel run (passes in isolation). Pre-existing; not Phase 0's fault. Phase 1 should not regress it further; consider stabilizing if Phase 1 touches the watcher.
- The branch-less workflow (`branching_strategy: none`) means PROJECT.md's "Branch hygiene" constraint is silently overridden by GSD config. PROJECT.md should be reconciled with reality, OR `.planning/config.json` flipped. Visibility item for the maintainer.

---

## Overall verdict: **PASS-with-caveats**

Phase 0 substantively delivers on its stated goal: the public substrate (ADRs + architecture docs + eval fixtures + regression baselines + CI scaffolding) is in place. 13/14 FND requirements are independently verified. FND-09 is PARTIAL (defensible interpretation gap, not a defect). The one material caveat is the broken CI gate — Phase 0 shipped a workflow that runs `prettier --check` against a tree that has 76 unformatted files. This is a one-commit fix the executor knowingly deferred to Phase 1; treat it as a blocker on Phase 1's first PR.

The adversarial review is robust (10 findings, 6 amended / 4 deferred-v3, with the reviewer's own §Stop summary endorsing exactly this split). The 4 deferrals are adapter-internal capability surface that ADR-002 I-7 already covers in principle; a Phase 10 contractor has enough contract to begin without inventing v2 invariants.

The audit-trail event for FND-14 is the one place where executor adaptation (branch-less variant of D-17) leaves a thin paper trail — surfaced for human decision.

---

*Verifier: Claude (gsd-verifier, goal-backward audit)*
*Verified independent of SIGN-OFF.md self-assessment; every claim traced to file evidence or command output.*
