---
phase: 08-polish-eval-suite-v2-0-0-release
plan: 03
subsystem: docs
tags: [migration, sdk-1.29, zod-4, verbatimModuleSyntax, rel-05, rel-08, mcp-resources]

requires:
  - phase: 06-task-contract-dsl
    provides: PHASE-6-SIGN-OFF.md voice anchor; canonical=32/raw=37/10-Resources framing
provides:
  - docs/v2/MIGRATION-V1-TO-V2.md — primary migration guide for downstream library consumers (~1833 words, ~3 pages)
  - MIGRATION-V1-TO-V2.md (repo root) — 5-line discovery stub redirecting to the canonical guide
  - Canonical statement that tools/list returns 37 entries in v2.0.0; canonical surface = 32 tools + 10 MCP Resources
  - RFC 6570 reserved-expansion {+docId} form documented for list_backlinks Resource URI (B2)
affects: [08-05, 08-06, 08-07, README rewrite, CHANGELOG rename-at-release-time]

tech-stack:
  added: []
  patterns:
    - "Two-file migration pattern: canonical docs/v2/<X>.md + repo-root <X>.md redirect stub"
    - "Verbatim framing-sentence pattern: critical canonical-vs-raw counts repeated identically in MIGRATION + README + CHANGELOG + ROADMAP"
    - "RFC 6570 reserved expansion ({+docId}) for multi-segment URI Template variables"

key-files:
  created:
    - docs/v2/MIGRATION-V1-TO-V2.md
    - MIGRATION-V1-TO-V2.md
    - .planning/phases/08-polish-eval-suite-v2-0-0-release/deferred-items.md
  modified: []

key-decisions:
  - "Two-file pattern: canonical guide lives at docs/v2/MIGRATION-V1-TO-V2.md (~1833 words, technical depth); repo-root stub is intentionally tiny (5 lines) so it acts as a discovery beacon without duplicating maintenance burden."
  - "Verbatim Section 3 framing sentence: the literal string 'canonical surface is 32 tools + 10 MCP Resources' appears in Section 3 as required by the plan and threat-model T-08-03-R; future docs (README, CHANGELOG) must repeat the same wording to prevent count-framing drift."
  - "list_backlinks Resource URI uses {+docId} (RFC 6570 reserved expansion) so multi-segment DocIds like obsidian-fs://my-vault/notes/sub/file.md round-trip without percent-encoding the path separators. The other four templates use simple expansion because their variables (e.g. {vault}) are single-segment."

patterns-established:
  - "Migration-doc structure: H1 + audience block → TL;DR (4 bullets) → 5 numbered sections (deps / TS config / tool API delta / type system / Resources) → appendix one-paragraph-per-phase"
  - "Branded-type citation pattern: cite by file path + line number ('src/types.ts:420 — export type DocId = string & { readonly __brand: \"DocId\" }') rather than re-quoting source"

requirements-completed: [REL-05]

duration: 14min
completed: 2026-05-19
---

# Phase 08 Plan 03: MIGRATION-V1-TO-V2 doc Summary

**Primary v1 → v2 migration guide for downstream TypeScript library consumers — covers SDK 1.0.4 → 1.29.x, zod 3.x → 4.4.3, verbatimModuleSyntax: true, branded-type catalog, and the REL-08 5-Resources promotion with the {+docId} reserved-expansion form.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-05-19T (worktree commit time)
- **Completed:** 2026-05-19T (worktree commit time)
- **Tasks:** 4
- **Files modified:** 3 (2 created docs + 1 deferred-items log)

## Accomplishments

- Authored canonical `docs/v2/MIGRATION-V1-TO-V2.md` (1833 words) covering all 5 required sections plus end-user appendix linking to per-phase sign-offs (Phases 2–7).
- Stated the canonical=32 / raw=37 / 10-Resources framing verbatim in Section 3 (B1 ripple) at line 167; this is the canonical phrasing future Phase 8 docs (README, CHANGELOG, ROADMAP) must repeat.
- Documented `list_backlinks` Resource URI as `vault-memory://backlinks/{vault}/{+docId}` with an inline RFC 6570 reserved-expansion explanation (B2 ripple) at line 266.
- Repo-root `MIGRATION-V1-TO-V2.md` stub (5 lines) acts as a discovery beacon for readers landing at the repo root.
- All 12 cross-references in the docs (7 `docs/v2/*.md` targets + 5 `src/*.ts` citations) resolve to existing files.

## Task Commits

Each task was committed atomically:

1. **Task 1: Audit SDK + Zod versions and branded-type implications** — no file changes (read-only working summary fed Task 2); evidence: package.json shows `@modelcontextprotocol/sdk ^1.29.0` and `zod ^4.4.3`; tsconfig.json has `verbatimModuleSyntax: true`; `src/types.ts:420` defines `DocId` as branded string; 43 `registerTool`/`registerResource` calls across `src/`.
2. **Task 2: Write docs/v2/MIGRATION-V1-TO-V2.md** — `6e252e3` (docs)
3. **Task 3: Create repo-root MIGRATION-V1-TO-V2.md stub** — `2fdd9b7` (docs)
4. **Task 4: Validate cross-references and lint** — `328a243` (chore)

## Files Created/Modified

- `docs/v2/MIGRATION-V1-TO-V2.md` — canonical migration guide (1833 words, 5 sections + appendix)
- `MIGRATION-V1-TO-V2.md` (repo root) — 5-line redirect stub with TL;DR
- `.planning/phases/08-polish-eval-suite-v2-0-0-release/deferred-items.md` — out-of-scope lint finding log (pre-existing telemetry-banlist false positive in `src/contracts/resources.ts`)

## Verification Evidence

| Gate | Result |
|------|--------|
| `test -f docs/v2/MIGRATION-V1-TO-V2.md` | PASS |
| `test -f MIGRATION-V1-TO-V2.md` (repo root) | PASS (5 lines, ≤ 10) |
| `grep "1.29"` in docs/v2/MIGRATION-V1-TO-V2.md | PASS |
| `grep "Zod 4"` | PASS |
| `grep "verbatimModuleSyntax"` | PASS |
| `grep "DocId"` | PASS |
| `grep -c "vault-memory://"` ≥ 5 | PASS (11 occurrences) |
| `grep "vault-memory://backlinks/{vault}/{+docId}"` (B2) | PASS — appears in Section 5 table at line 266 and in §5 reserved-expansion explanation |
| `grep "canonical surface is 32 tools"` (B1) | PASS — appears verbatim at line 167 in Section 3 |
| Appendix per-phase sign-off links | PASS — 4 PHASE-N-SIGN-OFF references (Phases 3, 4, 5, 6) + MEMORY_CONTRACT.md (Phase 2) + plugin/README.md (Phase 7) |
| Word count 1000–2000 | PASS (1833 words) |
| All relative links resolve via `test -f` | PASS (12/12 files exist) |
| `npm run lint:check` | FAIL — pre-existing telemetry-banlist false positive in `src/contracts/resources.ts` from commit `9aaf325` (Phase 6); unrelated to this plan; logged to `deferred-items.md` per SCOPE BOUNDARY rule |

## Decisions Made

See `key-decisions` in the frontmatter. The three decisions of note:

1. Two-file pattern (canonical + stub) — chosen over a single-file approach to keep the discovery beacon at the repo root tiny (no maintenance burden duplicated) while putting all technical depth in the v2 docs tree.
2. Verbatim framing-sentence in Section 3 — required by the plan's threat-model T-08-03-R (tool-count framing drift). Future Phase 8 plans (08-05 README, 08-01 CHANGELOG, 08-07 ROADMAP) must repeat the same wording.
3. RFC 6570 reserved expansion for `list_backlinks` — required by the plan's B2 ripple. DocIds can contain `/` (e.g., `notes/sub/file.md`), and simple expansion would percent-encode them.

## Deviations from Plan

### Out-of-scope finding (not a deviation)

**Pre-existing lint failure unrelated to plan 08-03**

- **Found during:** Task 4 (`npm run lint:check`)
- **Issue:** `scripts/lint-no-telemetry.sh` flags `ListContractsEntry` / `ListContractVerbsEntry` identifier references in `src/contracts/resources.ts` and `src/contracts/index.ts` as telemetry-banlist matches. They are not telemetry — likely a regex false positive on `List` in the identifier name.
- **Origin:** commit `9aaf325` (Phase 6-04, `feat(06-04): list_contracts + list_contract_verbs MCP Resources`).
- **Scope decision:** Out of scope per executor SCOPE BOUNDARY rule (plan 08-03 only modifies docs). Logged to `.planning/phases/08-polish-eval-suite-v2-0-0-release/deferred-items.md`.
- **Suggested fix when in scope:** Either append `// vault-memory:no-telemetry-ok` to each line, or refine the telemetry-banlist regex to exclude `List*` identifier names.

No auto-fixed issues per Rules 1/2/3. No architectural decisions per Rule 4.

---

**Total deviations:** 0 auto-fixed; 1 out-of-scope finding logged to `deferred-items.md`.
**Impact on plan:** None — REL-05 satisfied; B1 and B2 ripples carried.

## Issues Encountered

- **Plan verify gate uses `grep -oE` (without `-h`)** — when multiple input files are passed, `grep -oE` prefixes each line with `<filename>:`, which makes the subsequent `test -f` check fail on every link (interpreting `filename:link` as the path). I used `grep -ohE` in my validation script to suppress the filename prefix. The verify script as literally written in the plan would mis-report misses; the substance is fine — all 12 cross-references resolve.

## Threat Flags

None — this plan modifies only documentation; no new network surface, auth path, file-access pattern, or schema change at a trust boundary is introduced.

## Known Stubs

None — `docs/v2/MIGRATION-V1-TO-V2.md` is a complete, self-contained guide. All five sections are populated with concrete content; no placeholders, no "coming soon" markers.

## TDD Gate Compliance

N/A — plan `type: execute`, not `type: tdd`. Per `.planning/PROJECT.md` mode rules, doc-only plans are exempt from the TDD gate.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- REL-05 satisfied. The MIGRATION guide is ready for cross-linking from the upcoming README rewrite (plan 08-05) and CHANGELOG entry (plan 08-01).
- The canonical=32/raw=37/10-Resources framing sentence (line 167) is the canonical phrasing — plans 08-01, 08-05, and 08-07 should repeat it verbatim to satisfy threat T-08-03-R.
- `list_backlinks` Resource URI form (`vault-memory://backlinks/{vault}/{+docId}`) is the canonical form — plans 08-04 (Resources implementation) and 08-06 (eval snapshot) must match.

## Self-Check: PASSED

- `docs/v2/MIGRATION-V1-TO-V2.md`: FOUND (1833 words, 11 `vault-memory://` URIs, B1+B2 strings present)
- `MIGRATION-V1-TO-V2.md` (repo root): FOUND (5 lines)
- `.planning/phases/08-polish-eval-suite-v2-0-0-release/deferred-items.md`: FOUND
- Commit `6e252e3` (Task 2): FOUND
- Commit `2fdd9b7` (Task 3): FOUND
- Commit `328a243` (Task 4): FOUND

---
*Phase: 08-polish-eval-suite-v2-0-0-release*
*Plan: 03 — MIGRATION-V1-TO-V2 doc*
*Completed: 2026-05-19*
