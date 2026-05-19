---
phase: 08-polish-eval-suite-v2-0-0-release
plan: 01
subsystem: release-engineering
tags: [changelog, release, rel-02, rel-08]
requires: []
provides:
  - "CHANGELOG.md [Unreleased] block contains Phase 5 (compiled briefs) entries"
  - "CHANGELOG.md [Unreleased] block contains Phase 7 (Obsidian plugin) entries"
  - "CHANGELOG.md [Unreleased] block contains REL-08 deprecation block for 5 list-style tools"
affects:
  - "CHANGELOG.md (additive only — 46 insertions, 0 deletions)"
tech-stack:
  added: []
  patterns:
    - "Keep-a-Changelog grouping: Added / Changed / Dependencies / Migration / Documentation / Deprecated"
    - "Voice anchor: terse-technical, no marketing superlatives, bold short-name bullets"
    - "RFC 6570 reserved expansion ({+docId}) for path-style URI variables"
key-files:
  created:
    - ".planning/phases/08-polish-eval-suite-v2-0-0-release/deferred-items.md"
    - ".planning/phases/08-polish-eval-suite-v2-0-0-release/08-01-SUMMARY.md"
  modified:
    - "CHANGELOG.md"
decisions:
  - "Insert Phase 5 + Phase 7 bullets at the END of the existing [Unreleased] Added block (lines 73–84 for Phase 5, 85–91 for Phase 7), preserving the Phase 6 / Phase 4 / Phase 1 / Phase 2 / Phase 3 ordering already established. Pure-append strategy: zero modifications to existing lines, only insertions."
  - "Use RFC 6570 reserved expansion form `{+docId}` (not the plain `{docId}`) for the list_backlinks Resource URI so multi-segment docIds with slashes parse correctly. Explicit parenthetical added to the bullet to explain the +."
  - "Treat Phase 5 brief artifacts and Phase 7 plugin state as 'NOT a server schema migration' explicitly in the ### Migration section, so downstream consumers reading the changelog know v2.0.0 ships no Phase 5 or Phase 7 SQLite migration beyond Migration 013 (which IS documented)."
  - "Add a single consolidated ### Deprecated (Phase 8 / REL-08) sub-section in [Unreleased] rather than per-tool sprinkles. One block keeps the v3.0.0 removal schedule discoverable in a single place."
  - "Do not modify the ### Documentation section's existing FND-* bullets. Append Phase 5 sign-off + ADR-005 + Phase 7 plugin docs + ADR-007 as four new bullets at the END of the section so the FND ordering remains intact."
metrics:
  duration: "5 minutes"
  completed: "2026-05-19T14:20:00Z"
  tasks_completed: 3
  files_modified: 1
  files_created: 2
  commits: 1
---

# Phase 8 Plan 01: CHANGELOG Backfill (Phase 5 + Phase 7 + REL-08) Summary

**One-liner:** CHANGELOG.md `[Unreleased]` block now carries the missing Phase 5 (compiled briefs) and Phase 7 (Obsidian plugin) entries plus a 5-bullet `### Deprecated (Phase 8 / REL-08)` block — purely additive 46-line insertion, zero existing-line edits, list_backlinks Resource URI uses RFC 6570 reserved expansion `{+docId}` so path-style docIds parse.

## What was built

### Phase 5 (compiled briefs) — backfilled into [Unreleased]

**Added (lines 73–84 of the new CHANGELOG.md):**

1. Compiled brief layer (ADR-005) — top-level Phase 5 framing bullet with cross-links to `docs/v2/PHASE-5-SIGN-OFF.md` and `docs/v2/adr/005-brief-compile-strategy.md`.
2. 2 new MCP tools (`compile_brief`, `get_brief`) with explicit "Tool count: 32 → 34" delta and snapshot-test status.
3. `vault-memory://briefs` MCP Resource (BRF-09) — flagged as Resource (not Tool) so it does not count toward the REL-08 tool budget.
4. Brief staleness daemon (BRF-05..08) — single-owner lock at `~/.vault-memory/locks/<vault>.lock`, startup full scan, rename grace-window.
5. `default-brief-v1` MemoryContract — required-properties list spelled out.
6. ChunkId brand + content-stable fragment helpers.
7. `OllamaClient.chat()` `/api/chat` route — first non-embedding LLM call in vault-memory history, governed by ADR-005.
8. 3 new eval YAMLs (`briefs-curated.yaml`, `briefs-staleness-stub.yaml`, `briefs-from-cluster.yaml`).
9. Cross-adapter conformance for brief tools (4 cases × 2 adapters = 8 runs).

**Changed (lines 99–101):**

- "Tool surface count: 32 → 34 (Phase 5)" — additive only.
- Server bootstrap order extended to register `_memory/_briefs/` sink + start `BriefStalenessDaemon` per vault.

**Migration (lines 121–123):**

- MIGRATION_013 spelled out: `chunks.chunk_id_fragment`, `brief_sources`, `daemon_state`.
- Explicit note that Phase 5 brief artifacts are NOT a server schema migration (briefs land via the standard `DeliveryAdapter.write()` path; the `default-brief-v1` contract is registered at bootstrap, not persisted in SQLite).

**Documentation (line 160 + line 161):**

- `docs/v2/PHASE-5-SIGN-OFF.md` and `docs/v2/adr/005-brief-compile-strategy.md` linked.

### Phase 7 (Obsidian plugin) — backfilled into [Unreleased]

**Added (lines 85–91):**

1. Obsidian plugin (ADR-007) — `plugin/` community-plugin package, manifest v2.0.0, sideload-capable, default-OFF gating, 1.9 MB built artifact.
2. Variant C three-pane editor (palette + Svelte Flow canvas + Zod-derived inspector), `@xyflow/svelte` MIT canvas, `registerView` + `registerExtensions(['contract'])`.
3. `.contract` JSON envelope (`vmFormatVersion: 1`) + pure-TS round-trip codec with byte-identical 3rd/4th-emission fixed-point.
4. 3 reference `.contract` files (`meeting-prep`, `project-status`, `code-review-brief`).
5. 6 new plugin-control MCP tools (`set_runtime_config`, `resolve_secret`, `set_mcp_client`, `get_runtime_stats`, `trigger_reindex`, `suppress_contract_write`) — **explicitly flagged "gated by `[plugin] enabled = true`, default OFF"** + the default-OFF tool count clarification (37 unchanged when flag is off; 43 when on).
6. Electron safeStorage-backed secrets (PLG-02) with `${secret:name}` placeholder grammar.
7. Plugin chrome — settings, reindex, stats, connectors panels (PLG-01/03/04/05).
8. Hash-aware `SuppressionSet.consume(path, hash)` extension (CAN-08).
9. `vm-install` + `vm-update` Claude Code skills with SHA-256 verification.
10. 6 plugin docs under `docs/v2/plugin/`.

**Changed (lines 102–103):**

- `SuppressionSet.consume()` accepts an optional `hash` argument — Phase 1 callers see byte-identical behavior.
- Default-OFF plugin tool gating in `src/server.ts` so `tools/list` keeps the v1 snapshot byte-identical.

**Dependencies (lines 111–113):**

- `@xyflow/svelte` and Svelte/esbuild/vitest plugin-only toolchain — server bundle unaffected.

**Documentation (lines 162–163):**

- `docs/v2/plugin/README.md` and `docs/v2/adr/007-contract-editor.md` linked.

### REL-08 deprecation block — appended to [Unreleased]

**New sub-section `### Deprecated (Phase 8 / REL-08)` at lines 166–174:**

| Tool | Canonical Resource | Notes |
|---|---|---|
| `list_vaults` | `vault-memory://vaults` | Cross-vault discovery |
| `list_models` | `vault-memory://models/{vault}` | Per-vault embedding-model inventory |
| `recent_notes` | `vault-memory://recent/{vault}` | mtime-DESC recent notes |
| `vault_stats` | `vault-memory://stats/{vault}` | Per-vault stats |
| `list_backlinks` | **`vault-memory://backlinks/{vault}/{+docId}`** | Uses RFC 6570 reserved expansion — `{+docId}` allows `/` in the variable value |

Each bullet ends with "The tool remains callable through v2.x; removal scheduled for v3.0.0." per acceptance criteria.

## Exact line range of inserted content

The new CHANGELOG.md is 416 lines (up from 371 — purely additive). All insertions land inside the existing `## [Unreleased]` block (line 13) and BEFORE `## [1.0.0] — 2026-05-12` (now at line 175). Insertion points:

| Insertion | Line range (new file) | Type |
|---|---|---|
| Phase 5 bullets in `### Added` | 73–84 (12 lines) | additive |
| Phase 7 bullets in `### Added` | 85–91 (7 lines) | additive |
| Phase 5 + Phase 7 entries in `### Changed` | 99–103 (5 lines) | additive |
| Phase 7 plugin entries in `### Dependencies` | 111–113 (3 lines) | additive |
| Phase 5 + Phase 7 entries in `### Migration` | 121–123 (3 lines) | additive |
| Phase 5 + Phase 7 entries in `### Documentation` | 160–164 (5 lines, includes blank-line trailer ending the section) | additive |
| New `### Deprecated (Phase 8 / REL-08)` section | 165–174 (10 lines) | additive |

Diff stats: 46 insertions, 0 deletions. `git diff --shortstat` confirms `1 file changed, 46 insertions(+)`.

## Cross-reference resolution

All 4 plan-mandated cross-reference targets resolve on disk:

- `docs/v2/PHASE-5-SIGN-OFF.md` — EXISTS
- `docs/v2/adr/005-brief-compile-strategy.md` — EXISTS
- `docs/v2/plugin/README.md` — EXISTS
- `docs/v2/adr/007-contract-editor.md` — EXISTS

All 13 `docs/v2/*.md` links in CHANGELOG.md resolve (verified by `for link in $(grep -oE 'docs/v2/[A-Za-z0-9._/-]+\.md' CHANGELOG.md | sort -u); do test -f "$link" || echo MISSING; done` → zero MISSING output).

## Confirmation: list_backlinks URI uses `{+docId}` form

```
$ grep -n 'vault-memory://backlinks/{vault}/{+docId}' CHANGELOG.md
174:- **`list_backlinks`** → `vault-memory://backlinks/{vault}/{+docId}` (per-document backlink listing). The URI uses RFC 6570 reserved expansion: `{+docId}` allows `/` in the variable value so multi-segment `docId`s like `obsidian-fs://my-vault/notes/sub/file.md` parse correctly. The tool remains callable through v2.x; removal scheduled for v3.0.0.
```

The `{+docId}` reserved-expansion prefix is present verbatim, and the parenthetical explanation of the `+` semantics is inline per the plan's B2 ripple guidance.

## Verification — all acceptance criteria met

| Criterion (from plan 08-01) | Result |
|---|---|
| `grep -q "compile_brief" CHANGELOG.md` | PASS |
| `grep -q "Variant C" CHANGELOG.md` | PASS |
| `grep -q "default OFF\|default-OFF" CHANGELOG.md` | PASS |
| `grep -q "vault-memory://backlinks/{vault}/{+docId}" CHANGELOG.md` | PASS |
| `grep -c "vault-memory://" CHANGELOG.md` ≥ 5 | PASS (10 occurrences) |
| `## [Unreleased]` heading intact | PASS (no rename) |
| `grep -i "blazingly\|magnificent\|amazing\|revolutionary\|world.class" CHANGELOG.md` returns 0 | PASS (0 matches) |
| Existing Phase 2/3/4/6 entries byte-identical | PASS (`git diff` shows 0 deletion lines, 46 insertion lines) |
| Every `docs/v2/*.md` link resolves on disk | PASS (13/13) |

## Deviations from Plan

### Auto-fixed Issues

**None.** Plan executed exactly as written — three tasks, additive-only edit to a single file, no scope expansion.

### Out-of-scope discoveries (logged, not fixed)

**1. Pre-existing `lint-no-telemetry.sh` false positive on `Entry` ↔ `sentry`**

- **Surfaced during:** Task 3 verify (running `npm run lint:check`).
- **Files affected:** `src/contracts/resources.ts` (lines 46, 57, 64, 112, 122, 147) + `src/contracts/index.ts` (lines 84, 87).
- **Root cause:** The banlist contains `sentry` as a case-insensitive substring match. `ListContractsEntry` and `ListContractVerbsEntry` contain the substring `sEntry` (within "Entry"), tripping the banlist.
- **Pre-existing?** YES — introduced by Phase 6 commit `9aaf325` (`feat(06-04): list_contracts + list_contract_verbs MCP Resources`); not caused by plan 08-01.
- **Scope-boundary disposition:** Out of scope for plan 08-01 (CHANGELOG-only). Logged to `.planning/phases/08-polish-eval-suite-v2-0-0-release/deferred-items.md` with a suggested fix (either escape comments on the 8 lines OR tighten the banlist regex to a word-boundary form `\bsentry\b`).

## Threat-model coverage

| Threat ID | Mitigation status |
|---|---|
| T-08-01-I (broken cross-references) | MITIGATED — all 4 plan-mandated `docs/v2/*.md` links + all 13 `docs/v2/*.md` links in CHANGELOG.md verified to exist on disk in Task 3. |
| T-08-01-R (CHANGELOG voice drift) | MITIGATED — `grep -ciE "blazingly\|magnificent\|amazing\|revolutionary\|world.class" CHANGELOG.md` returns 0; voice anchored to existing Phase 4/6 entries (bold short-name bullets, tool-count deltas, ADR cross-refs). |

## Known Stubs

None. Plan 08-01 is a documentation-only edit; no source files modified.

## Commits

| Task | Commit | Files |
|---|---|---|
| 1 (audit) | (no commit — audit only, no file changes) | — |
| 2 (write entries) | `f364431` | `CHANGELOG.md` |
| 3 (verify links + lint) | (no commit — verification only) | — |

## Self-Check: PASSED

Verified after writing this SUMMARY.md:

- `[ -f CHANGELOG.md ] && grep -q "compile_brief" CHANGELOG.md` → FOUND
- `[ -f CHANGELOG.md ] && grep -q "Variant C" CHANGELOG.md` → FOUND
- `[ -f CHANGELOG.md ] && grep -q 'vault-memory://backlinks/{vault}/{+docId}' CHANGELOG.md` → FOUND
- `git log --oneline --all | grep -q "f364431"` → FOUND
- `[ -f .planning/phases/08-polish-eval-suite-v2-0-0-release/deferred-items.md ]` → FOUND
- `[ -f .planning/phases/08-polish-eval-suite-v2-0-0-release/08-01-SUMMARY.md ]` → FOUND (this file)
