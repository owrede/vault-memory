---
phase: 00-foundation-decisions
plan: 03
subsystem: docs
tags: adr, adapter-seams, source-connector, delivery-adapter, change-feed, capability-descriptors, madr, git-history

# Dependency graph
requires:
  - phase: 00-foundation-decisions
    provides: "Two-commit relocate-then-amend pattern proven on ADR-001 (plan 00-02). ADR index README seeded with ADR-001 row, ready for ADR-002 to append."
provides:
  - "ADR-002 publicly readable at docs/v2/adr/002-adapter-seams.md (renamed from 002-source-and-delivery-seams per D-01)"
  - "ADR-002 has Invariants (I-1..I-7) and Examples (obsidian-fs + notion-api SourceConnector sketches + ChangeFeed rename event)"
  - "Six required dependency-confinement invariants explicit (chokidar, fs.*, path.*, gray-matter, .md literals, write routing) — Phase 1 CI greps will consume these"
  - "docs/v2/adr/README.md MADR-style index appended with ADR-002 row"
  - "Pattern continuation: plans 00-04 (ADR-003) and 00-05 (ADR-004) can apply the same restore-from-history → amend → append-row sequence"
affects: [00-04, 00-05, 00-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Filename change during ADR relocation (002-source-and-delivery-seams → 002-adapter-seams) executed as part of the restore-from-history commit — D-01 / Pitfall 1 mitigation worked as designed"
    - "Invariant numbering extends beyond the 6 required (I-7 capability honesty) — ADR-conformance audits should grep `I-[1-9]+` not just `I-[1-5]`"
    - "Worked SourceConnector sketches use TypeScript-style code blocks with explicit capability descriptors per scheme — Phase 9 adversarial review can grep the capability deltas table"

key-files:
  created:
    - "docs/v2/adr/002-adapter-seams.md (restored from history 3c9322d at new public path with new filename; then amended with frontmatter + Invariants + Examples + status Accepted)"
  modified:
    - "docs/v2/adr/README.md (ADR-002 row appended under ## Accepted v2 ADRs table)"

key-decisions:
  - "Restore-from-history pattern (proven in plan 00-02 deviation #1) applied again here. Source path `docs/dev/002-source-and-delivery-seams.md` was already untracked at HEAD (removed in cbed220, ~5 commits before this plan) — literal `git mv` impossible. Retrieved byte-identical content from `git show 3c9322d:docs/dev/002-source-and-delivery-seams.md`, wrote to new path with new filename, committed as `A` (add). Filename change happened simultaneously with the relocate, which is precisely the D-01 / Pitfall 1 scenario the plan was set up to handle."
  - "Invariant set: seven bullets, not six. The plan required six (a–f); I added I-7 (capability-descriptor honesty) because it follows naturally from the ## Capability descriptors section and Phase 10 already commits to a capability-contract test suite (see ADR Open follow-ups). Phase 9 adversarial review will grep `^- \\*\\*I-[1-9]\\*\\*:` (matches all 7) rather than `[1-6]`."
  - "Examples section uses TypeScript impl sketches rather than ADR-001's identity-decomposition tables. This is content-appropriate: ADR-001 is about an identifier shape (table renders well); ADR-002 is about three interfaces (code sketches render the contract better). The cross-source signal — both `obsidian-fs://` and `notion-api://` appearing in the same ADR — is preserved per D-04."
  - "ChangeEvent example references ADR-001 Invariant I-4 explicitly (rename-as-delete-plus-create is FORBIDDEN). This is the first cross-ADR invariant citation; future ADRs are encouraged to follow the same pattern when their invariants depend on another ADR's invariant."

patterns-established:
  - "ADR Invariant numbering is open-ended. Plans may add Invariants beyond the explicit must-have list when they emerge naturally from the ADR body. Greps should use `I-[1-9]+` not bounded ranges."
  - "ADR Examples format: choose the shape that fits the ADR. Identifier ADRs use decomposition tables; interface ADRs use TypeScript impl sketches. Both must include `obsidian-fs://` and `notion-api://` appearances per D-04."
  - "Cross-ADR invariant citation: when an ADR-N invariant implies behavior governed by ADR-M, cite it as `per ADR-M Invariant I-X`. Phase 9 adversarial review will use this as a hint for ADR-graph cross-checking."

requirements-completed: [FND-01, FND-04, FND-13]

# Metrics
duration: ~10min
completed: 2026-05-14
---

# Phase 00 Plan 03: ADR-002 Adapter Seams Vertical Slice Summary

**ADR-002 (Source & Delivery Seams) relocated from gitignored `docs/dev/` to public `docs/v2/adr/` with simultaneous filename change (D-01: `002-source-and-delivery-seams.md` → `002-adapter-seams.md`), amended with seven normative Invariants (I-1..I-7 governing chokidar/fs.*/path.*/gray-matter/`.md` literals/write routing/capability honesty) and three worked Examples (obsidian-fs SourceConnector sketch, notion-api SourceConnector sketch, obsidian-fs ChangeFeed rename event), and the MADR-style index appended with its second row — continuing the pattern proven on ADR-001 in plan 00-02 with one extra wrinkle (filename change) cleanly handled.**

## Performance

- **Duration:** ~10 min
- **Tasks:** 3 (all type=auto)
- **Files changed:** 1 created (`docs/v2/adr/002-adapter-seams.md`, 453 lines), 1 modified (`docs/v2/adr/README.md`, +1 line)

## Accomplishments

- **Task 1:** Restored ADR-002 byte-identical content from history (`3c9322d:docs/dev/002-source-and-delivery-seams.md`) to the new public path `docs/v2/adr/002-adapter-seams.md`. The filename change (`002-source-and-delivery-seams` → `002-adapter-seams`) happened in this same restore commit, which is the exact scenario D-01 / RESEARCH Open Question 3 / Pitfall 1 were planned to mitigate.
- **Task 2:** Amended ADR-002 with YAML frontmatter (`title`, `status: Accepted`, `phase: 0`, `tags: adapters, seams, source-connector, delivery-adapter, change-feed, capability-descriptors`), promoted `**Status:**` line Proposed → Accepted, added `## Invariants` section with seven bullets covering the six required dependency-confinement rules plus a seventh capability-descriptor-honesty invariant, and added `## Examples` section with three worked sketches: `ObsidianFsSource` `SourceConnector` impl + capability descriptors, `NotionApiSource` `SourceConnector` impl + differing capability descriptors, and a cross-cutting `obsidian-fs` `ChangeFeed` rename event citing ADR-001 I-4.
- **Task 3:** Appended ADR-002 row to the existing `## Accepted v2 ADRs` table in `docs/v2/adr/README.md`. Append-only — ADR-001 row untouched; `## Open ADRs (v3 / Phase 10)` placeholder untouched (plan 00-13 owns that).

## Six Required Invariants — Mapping to ADR Bullets

The plan required at least six invariants covering specific topics. Here is the mapping (and the one bonus):

| Required topic | ADR bullet | Confinement target |
|---|---|---|
| (a) chokidar forbidden outside change-feed | **I-1** | `src/adapters/change-feed/` |
| (b) raw `fs.*` calls forbidden outside adapters | **I-2** | `src/adapters/source/obsidian-fs/`, `src/adapters/delivery/obsidian-fs/`, `src/config/` |
| (c) `path.join`/`path.resolve` forbidden outside adapters | **I-3** | adapter modules + `src/config/` |
| (d) `gray-matter` forbidden outside obsidian-fs source/delivery | **I-4** | `src/adapters/source/obsidian-fs/`, `src/adapters/delivery/obsidian-fs/` |
| (e) bare `.md` literals forbidden outside adapters | **I-5** | adapter modules |
| (f) all writes route through DeliveryAdapter | **I-6** | direct fs.write* forbidden outside delivery adapter |
| **bonus** — capability descriptors must be honest | **I-7** | Phase 10 capability-contract test suite |

The bonus I-7 was added because the ADR body's `## Capability descriptors` section and `## Open follow-ups` already commit to capability-contract testing in Phase 10; codifying it as an invariant makes the existing commitment greppable.

## git log --follow history-preservation check outcome

Same outcome as plan 00-02 (the source path was already untracked at HEAD):

- **`git log --follow --oneline docs/v2/adr/002-adapter-seams.md`** → 2 commits (the two new commits in this plan: relocate `cc81978`, amend `c794268`). The plan's literal acceptance criterion ("≥ 2 commits via single-path `--follow`") is met.
- **`git log --all --oneline -- 'docs/dev/002-source-and-delivery-seams.md' 'docs/v2/adr/002-adapter-seams.md'`** (multi-path query) → 5 commits across both paths, including the historical seed commits `4f6da8a` and `3c9322d` from before the `cbed220` deletion, plus the `cbed220` deletion commit itself.

This is the same situation 00-02 documented for ADR-001 (deviation #1). The single-path `--follow` traverses the 100%-similarity rename between `cc81978` and `c794268` (cleanly handling the in-place amendment as a rename detection target). Pre-rename history is reachable only via multi-path query.

## ADR index state after this plan

`docs/v2/adr/README.md` now lists two ADRs under `## Accepted v2 ADRs`:

```
| #   | Title                                                                  | Status   | Phase | Supersedes | Tags                                                                                |
|-----|------------------------------------------------------------------------|----------|-------|------------|-------------------------------------------------------------------------------------|
| 001 | [Document identity is opaque, URI-style](001-document-identity.md)     | Accepted | 0     | —          | identity, source-agnostic, uri, opaque-id                                           |
| 002 | [Source & Delivery Seams](002-adapter-seams.md)                        | Accepted | 0     | —          | adapters, seams, source-connector, delivery-adapter, change-feed, capability-descriptors |
```

The `## Open ADRs (v3 / Phase 10)` placeholder is unchanged — plan 00-13 will populate it once ADRs 003 and 004 land.

## Task Commits

Each task was committed atomically:

1. **Task 1: Restore ADR-002 from history at new path with new filename** — `cc81978`
2. **Task 2: Add Invariants + Examples; status Accepted** — `c794268`
3. **Task 3: Append ADR-002 row to index** — `87d4a2a`

**Plan metadata:** this SUMMARY.md (to be committed at end of execution)

## Files Created/Modified

- `docs/v2/adr/002-adapter-seams.md` — created (453 lines after amendment). Public-facing canonical ADR. Frontmatter `status: Accepted`. Seven Invariants (I-1..I-7). Two `SourceConnector` impl sketches + one `ChangeFeed` rename example.
- `docs/v2/adr/README.md` — modified (one row appended under `## Accepted v2 ADRs`). 26 lines total.

## Decisions Made

- **Restore-from-history pattern reused.** Plan 00-02 deviation #1 documented that `cbed220` removed all four ADRs (001–004) from tracking before this phase began. ADR-002 was in exactly that state at HEAD. The plan's literal `git mv` step is impossible; the restore-from-history workflow is the operative pattern. Plans 00-04 (ADR-003) and 00-05 (ADR-004) will need the same approach.
- **Filename change handled inside the restore commit.** D-01 / Pitfall 1 anticipated risk: doing the filename change in the same commit as content edits would create a high-noise diff and break rename detection. Resolution: the restore commit `cc81978` contains the filename change but zero content edits (the content is the byte-identical historical text). The Task 2 amendment commit `c794268` performs the in-place amendment, which git's rename detection sees as a high-similarity match against `cc81978`'s file at the same path. `--follow` walks cleanly through both.
- **Seven Invariants, not six.** Added I-7 (capability honesty) because the ADR body already commits to a Phase 10 capability-contract test suite. Codifying it as an invariant makes the existing commitment auditable. Future ADR-conformance audits should grep `I-[1-9]+` not `I-[1-5]` or `I-[1-6]`.
- **Examples use TypeScript impl sketches.** Content-appropriate choice. ADR-001 (identifier shape) uses decomposition tables; ADR-002 (three interfaces) uses code sketches. Both forms include `obsidian-fs://` and `notion-api://` per D-04. The capability-deltas table at the end of the Examples section gives Phase 9 adversarial review a single grep target for source-neutrality validation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Source path `docs/dev/002-source-and-delivery-seams.md` was already untracked at HEAD**

- **Found during:** Task 1 (pre-execution check before the literal `git mv` step)
- **Issue:** Identical to plan 00-02 deviation #1. Commit `cbed220` (~5 commits before this phase began) removed `docs/dev/002-source-and-delivery-seams.md` from tracking via `git rm`. Plan 01's gitignore narrowing did not restore it. At HEAD (`cf735b7`), the file existed in neither the working tree nor the index. A literal `git mv` from the source path fails with "invalid source".
- **Fix:** Retrieved byte-identical pre-deletion content from history (`git show 3c9322d:docs/dev/002-source-and-delivery-seams.md`), wrote it directly to the target path `docs/v2/adr/002-adapter-seams.md` (note: filename also changed per D-01), and committed as an `A` (add). The two-commit pattern (Task 1 + Task 2) still works as intended — git rename detection sees a 100%-similarity match between `cc81978` and `c794268` at the new path, so `--follow` walks the relocate→amend boundary cleanly.
- **Files modified:** `docs/v2/adr/002-adapter-seams.md` (created in Task 1)
- **Verification:**
  - `git log --follow --oneline docs/v2/adr/002-adapter-seams.md` → 2 commits (relocate + amend)
  - `git log --all --oneline -- 'docs/dev/002-source-and-delivery-seams.md' 'docs/v2/adr/002-adapter-seams.md'` → 5 commits across both paths
- **Committed in:** `cc81978` (Task 1 commit)
- **Plan implication for plans 00-04 / 00-05:** ADRs 003 and 004 are in identical state. Same pattern applies. The `docs/dev/00X-*.md` source paths are untracked; restore from `3c9322d` or `4f6da8a` and commit at the new public path.

**2. [Rule 1 — Bug, no fix required] Plan's verification regex `^\\*\\*I-[1-9]\\*\\*:` is over-strict**

- **Found during:** Task 2 (running plan's automated verify command)
- **Issue:** Identical to plan 00-02 deviation #2. The plan's verify regex anchors `**I-N**:` at the start of the line, but the canonical markdown form (proven on ADR-001) is `- **I-N**:` (a markdown bullet). The over-strict regex would return 0 matches even though the invariants are present in the correct canonical form.
- **Fix:** No fix to the ADR text — the bullets are the canonical form. The corrected verify command is `grep -cE '^- \\*\\*I-[1-9]\\*\\*:' docs/v2/adr/002-adapter-seams.md` and it returns 7 (matching all seven Invariants).
- **Files modified:** none
- **Verification:** `grep -cE '^- \*\*I-[1-9]\*\*:' docs/v2/adr/002-adapter-seams.md` → 7
- **Committed in:** n/a (no code change; documented here so future plan authors stop writing the over-strict regex)

---

**Total deviations:** 2 auto-fixed (1 Rule 3 — Blocking, 1 Rule 1 — verification-script bug with no required text fix)
**Impact on plan:** Both deviations are inherited from plan 00-02 / prior history. Neither affects the ADR text or downstream consumers. Plans 00-04 and 00-05 should follow the same restore-from-history approach.

## Issues Encountered

- **Concurrent sibling agent in `evals/fixtures/v2-test-vault/`.** No path overlap with this plan. Skill manifest enforced in worktree boundary check.
- **`git log --follow` single-path walkability across the public/internal boundary:** Same known consequence as ADR-001 — the source-path deletion happened 5 commits before this plan's relocate. Multi-path queries are the durable history mechanism. Already documented in 00-02 SUMMARY; carried forward here for plan 00-04 / 00-05 / 00-13 awareness.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Wave 3 continuation:** plans 00-04 (ADR-003) and 00-05 (ADR-004) can fan out in parallel using the same restore-from-history + amend + index-append pattern. The README index has room for two more rows.
- **Phase 1 inherits:** ADR-002's seven Invariants are the contract Phase 1's `scripts/lint-adapters.sh` (or equivalent CI grep script) must satisfy. I-1..I-6 are mechanically greppable; I-7 is enforced by Phase 10's capability-contract test suite.
- **Phase 9 (adversarial review) inherits:** the same canonical Invariants + Examples shape, now with code-sketch Examples in addition to ADR-001's table-form Examples. Both forms satisfy D-04 source-neutrality grep.
- **Plan 00-13 (final ADR index audit) inherits:** an index with two accepted rows, ready to grow to four accepted rows + open rows after plans 00-04 and 00-05 land.
- **No new blockers introduced.**

---
*Phase: 00-foundation-decisions*
*Plan: 03*
*Completed: 2026-05-14*

## Self-Check: PASSED

- `docs/v2/adr/002-adapter-seams.md` — FOUND
- `docs/v2/adr/README.md` — FOUND (modified with ADR-002 row appended)
- `.planning/phases/00-foundation-decisions/00-03-SUMMARY.md` — FOUND
- Commit `cc81978` (Task 1 relocate-with-rename) — FOUND
- Commit `c794268` (Task 2 amend with Invariants + Examples) — FOUND
- Commit `87d4a2a` (Task 3 index append) — FOUND
- Source path `docs/dev/002-source-and-delivery-seams.md` — ABSENT (as required)
- STATE.md / ROADMAP.md — NOT modified (as required)
