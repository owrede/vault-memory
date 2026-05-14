---
phase: 00-foundation-decisions
plan: 05
subsystem: docs
tags: adr, memory, memory-sink, provenance, sentinel-file, folder-default, separate-vault, safety-invariant, madr, git-history

# Dependency graph
requires:
  - phase: 00-foundation-decisions
    provides: "Restore-from-history relocate-then-amend pattern proven on ADR-001 (00-02), ADR-002 (00-03), ADR-003 (00-04). Index README at docs/v2/adr/README.md has rows for 001/002/003; ready for ADR-004 to append. MEMORY_CONTRACT.md already published (Phase 0 plan 07) and ready for ADR-004 to cross-link."
provides:
  - "ADR-004 publicly readable at docs/v2/adr/004-memory-sink-handles.md (filename unchanged from internal-dev path)"
  - "ADR-004 closes the open hard-isolation question: folder-default is the only code path; separate-vault is config-only (FND-03)"
  - "ADR-004 documents the `.memory-sink` sentinel file as the positive opt-in marker for any folder used as a memory sink"
  - "ADR-004 has Invariants (M-1..M-5) governing memory sink handles — distinct namespace from ADR-002's I-N adapter invariants and ADR-003's H-N hash invariants"
  - "Examples section includes obsidian-fs folder-default worked example (v2, ships) and a parallel notion-api v3 sketch demonstrating the source-neutrality property M-2 enshrines"
  - "docs/v2/adr/README.md index appended with ADR-004 row — all four v2 ADRs (001-004) now in the Accepted table"
  - "ADR-004 cross-links to docs/v2/MEMORY_CONTRACT.md (the operational, validator-level normative source) — the architectural decision points at the operational expression of it"
  - "Phase 2 prerequisite (per STATE blocker: 'Phase 2 memory-namespace work must wait on ADR-004 folder-default amendment') is now satisfied"
affects: [00-13, 00-14, 02-*]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Memory-sink-domain invariant prefix `M-N` (distinct from ADR-002's `I-N` adapter prefix and ADR-003's `H-N` hash prefix). Phase 9 adversarial review must grep all three: `^- \\*\\*I-[1-9]\\*\\*:`, `^- \\*\\*H-[1-9]\\*\\*:`, `^- \\*\\*M-[1-9]\\*\\*:`. Each ADR introducing a new invariant domain claims a new single-letter prefix."
    - "Amendment-as-H2-after-Decision pattern: when a previously-accepted ADR has an open question that a later phase closes, add a new H2 `## Amendment - <decision title>` immediately after the original `## Decision` (and its H3 children) and before `## Consequences`. The amendment is the normative source for the resolved question; the original `## Decision` is preserved for historical traceability with the open question intact."
    - "Sentinel-file pattern for positive opt-in to a privileged code path: any folder used as a memory sink MUST contain a `.memory-sink` file at its root. Defense-in-depth against accidental misconfiguration. Synced via the user's normal sync mechanism (Git/Obsidian Sync/iCloud/Syncthing). Content is informational, presence is the gate."

key-files:
  created:
    - "docs/v2/adr/004-memory-sink-handles.md (restored from history 3c9322d at public path; then amended with frontmatter + Amendment H2 + Sentinel file + Config examples + Invariants M-1..M-5 + Examples + status Accepted)"
  modified:
    - "docs/v2/adr/README.md (ADR-004 row appended; ADR-001/002/003 rows preserved unchanged)"

key-decisions:
  - "Restore-from-history pattern (proven in plans 00-02/03/04) applied a fourth time. Source path docs/dev/004-memory-sink-handles.md was untracked at HEAD (removed in cbed220 ~5 commits before this phase). Retrieved byte-identical content via `git show 3c9322d:docs/dev/004-memory-sink-handles.md`, wrote to the new public path with unchanged filename, committed as `A` (add). The two-commit pattern between Task 1 (edf4688) and Task 2 (8510c13) preserves `--follow` walkability across the move; pre-rename history is recoverable via the multi-path query."
  - "Folder-default is the only code path (FND-03 closure). The original ADR-004 left the choice open as a 'Phase 2 implementer decision' in its `### Hard-isolation question` subsection. The amendment H2 closes that question: separate-vault is achieved purely through `config.toml`, not through a code branch. M-2 enshrines this normatively. The implementation gets a single code path to test (Phase 2 ADP-13 conformance) and a zero-cost migration from folder-default to separate-vault (edit TOML, no rebuild)."
  - "Sentinel file `.memory-sink` is the positive opt-in marker. The handle parser refuses to resolve a `MemorySink` against a folder lacking the sentinel. Sentinel content is informational (timestamp + sink name); presence is the gate. Server startup creates the sentinel automatically when a configured sink resolves successfully and the target folder is empty (or contains only contract-shaped documents); if the folder has unrelated user notes, startup aborts with a structured error rather than silently labeling user data as a memory sink. This is the defense-in-depth concretion that turns 'don't accidentally write to user notes' from a hope into a check."
  - "Two TOML config examples, side-by-side. (a) folder-default: a single `[[vaults]]` plus a `[[memory_sinks]]` with handle `obsidian-fs://my-vault/_memory`; (b) separate-vault: two `[[vaults]]` entries (my-vault + agent-memory) plus a `[[memory_sinks]]` with handle `obsidian-fs://agent-memory/`. Both examples include the `[memory]` block with `sink = \"@default\"` (matches VALIDATION row 00-03-02 grep pattern). Same code path; different TOML shape."
  - "Invariant prefix `M-N` (memory). ADR-002 uses `I-N` for adapter-confinement; ADR-003 uses `H-N` for hash semantics; ADR-004 uses `M-N` for memory-sink invariants. Each ADR's invariant prefix is greppable in isolation. Five Invariants exactly (M-1..M-5) — matching the plan's must-have spec without bonus invariants. Every potential extra was already covered by an existing M-N (e.g., 'sink reads MUST also go through the registry' is implicit in M-1's 'ONLY resolver' wording)."
  - "Examples include a v3 notion-api parallel example, not just two v2 obsidian-fs variants. Beyond the D-04 minimum (one obsidian-fs + one notion-api), the example concretizes M-2's source-neutrality property: same `DeliveryAdapter.write({sink, doc})` call shape, same `Document` properties, only the resolved adapter and the on-disk/on-API result differ. This is the 'show don't tell' artifact for ADR-001's URI-opaque identity rule applied to the memory subsystem."
  - "Status promoted Proposed -> Accepted in the same commit that adds the amendment + Invariants + Examples (8510c13) -- same pattern as plans 00-02/03/04."
  - "Cross-link to docs/v2/MEMORY_CONTRACT.md added in the header (under `**Related:**`). MEMORY_CONTRACT.md is the operational normative source (validator behavior, property schema, exact rejection messages); ADR-004 is the architectural decision that established the contract's existence. Bidirectional traceability: MEMORY_CONTRACT.md's frontmatter already declares `depends-on: ADR-003, ADR-004`."

patterns-established:
  - "Memory-sink-domain invariants use prefix `M-N`. Adapter-confinement invariants `I-N` (ADR-002), hash-domain invariants `H-N` (ADR-003), memory-sink invariants `M-N` (ADR-004). Adversarial audit greps all three prefixes."
  - "Amendment H2 placement: when a previously-accepted ADR has an open question that a later phase decision closes, add `## Amendment - <title>` AFTER the existing `## Decision` (and its H3 children) and BEFORE `## Consequences`. The original `### Hard-isolation question` H3 stays in place as historical record; the amendment is the normative source for the resolved question."
  - "Sentinel-file gate: any folder participating in a privileged code path (memory sink, in this ADR; future similar paths in v3 connectors) MUST contain a sentinel file at its root before the registry resolves a handle to it. Server startup may create the sentinel only when the folder is empty or contains only contract-shaped documents; otherwise startup aborts."
  - "Dual config-example pattern in ADRs: when a config flag selects between two TOML shapes that share a code path, the ADR's `### Config examples` H3 must show both shapes side-by-side (folder-default + separate-vault here). Each example must include the `[memory]` (or equivalent) consuming block, not just the `[[memory_sinks]]` declaration block, so the validator regex `sink *= *\"@` matches at least once."

requirements-completed: [FND-01, FND-03, FND-04, FND-13]

# Metrics
duration: ~5min
completed: 2026-05-14
---

# Phase 00 Plan 05: ADR-004 Memory Sink Vertical Slice Summary

**ADR-004 (Memory Sink Handles) — the last of the four foundational v2 ADRs and the load-bearing architectural decision for the memory-namespace safety invariant — relocated from gitignored `docs/dev/` to public `docs/v2/adr/` (filename unchanged), amended to close the open hard-isolation question by committing to folder-default as the ONLY code path (with separate-vault relegated to config-only via TOML), with the `.memory-sink` sentinel file documented as the positive opt-in marker, dual TOML config examples (folder-default + separate-vault), five normative Invariants (M-1..M-5) governing handle resolution / zero-code-branch / sentinel gate / DeliveryAdapter chokepoint / user-write-tool refusal, and a two-example Examples section showing v2 obsidian-fs folder-default and a v3 notion-api parallel demonstrating source-neutrality. MADR-style index appended with ADR-004 row — all four v2 ADRs (001-004) now Accepted. ADR-004 cross-links to docs/v2/MEMORY_CONTRACT.md (Phase 0 plan 07), establishing the bidirectional link between the architectural decision and its operational validator.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-14T15:47:44Z
- **Completed:** 2026-05-14T15:52:03Z
- **Tasks:** 3 (all auto)
- **Files modified:** 1 created (docs/v2/adr/004-memory-sink-handles.md), 1 modified (docs/v2/adr/README.md)

## Accomplishments

- **Task 1 (edf4688):** Restored byte-identical historical content from `3c9322d:docs/dev/004-memory-sink-handles.md` to `docs/v2/adr/004-memory-sink-handles.md`. 311 lines, zero content edits. Multi-path history query yields 4 commits (relocate + cbed220 + 3c9322d + 4f6da8a). Same restore-from-history pattern proven in plans 00-02/03/04.
- **Task 2 (8510c13):** Amended ADR-004 with: (1) YAML frontmatter (title, status: Accepted, phase: 0, tags, depends-on: ADR-001/002/003); (2) header status promoted Proposed -> Accepted; (3) cross-link to docs/v2/MEMORY_CONTRACT.md under `**Related:**`; (4) `## Amendment - Folder-default is the only code path` H2 closing the open hard-isolation question; (5) `### Sentinel file - .memory-sink` H3; (6) `### Config examples` H3 with two complete TOML blocks (folder-default + separate-vault) — both including a `[memory]` block with `sink = "@default"`; (7) `## Invariants` section with M-1..M-5 normative bullets; (8) `## Examples` section AFTER `## Consequences` with worked obsidian-fs folder-default example and parallel notion-api v3 sketch. File grew from 311 to 655 lines.
- **Task 3 (f3a4537):** Appended ADR-004 row to the Accepted v2 ADRs table in `docs/v2/adr/README.md`. ADR-001/002/003 rows preserved unchanged. All four v2 ADRs (001-004) now Accepted in the index.

## Task Commits

Each task was committed atomically:

1. **Task 1: Relocate ADR-004** — `edf4688` (docs)
2. **Task 2: Amend ADR-004** — `8510c13` (docs)
3. **Task 3: Append ADR-004 row to index** — `f3a4537` (docs)

**Plan metadata:** this SUMMARY.md (final commit after self-check)

## Files Created/Modified

- `docs/v2/adr/004-memory-sink-handles.md` — created (restored from `3c9322d:docs/dev/004-memory-sink-handles.md`, then amended). 655 lines. Public-facing canonical ADR.
- `docs/v2/adr/README.md` — modified (one row appended to the Accepted v2 ADRs table; 001/002/003 rows untouched).

## Decisions Made

- **A1 = merge** (inherited from plan 00-02): two-commit relocate-then-amend pattern is safe — no squash-merge collapse risk.
- **Restore-from-history (not literal `git mv`)** — applied for the fourth time. The source path `docs/dev/004-memory-sink-handles.md` was already untracked at HEAD (removed in `cbed220` ~5 commits before Phase 0). Same approach as plans 00-02/03/04.
- **Folder-default is the only code path (FND-03 closure).** The original ADR-004's `### Hard-isolation question` left the folder-vs-separate-vault default open. The amendment H2 closes this: separate-vault is config-only. M-2 enshrines normatively. This was the explicit STATE blocker for Phase 2 ("Phase 2 memory-namespace work must wait on ADR-004 amendment") and is now resolved.
- **Sentinel file `.memory-sink`** as the positive opt-in marker. Handle parser refuses to resolve against a folder lacking the sentinel. Server startup creates it automatically only when the folder is empty or contract-shaped; aborts otherwise.
- **Dual TOML config examples side-by-side** — folder-default and separate-vault. Both include the `[memory]` block with `sink = "@default"` (matches VALIDATION row 00-03-02 grep pattern).
- **Invariant prefix `M-N`** (memory). Distinct from ADR-002's `I-N` (adapter) and ADR-003's `H-N` (hash). Five invariants exactly, no bonus bullets.
- **v3 notion-api parallel example** included beyond the v2 minimum, to concretize M-2's source-neutrality property: same `DeliveryAdapter.write({sink, doc})` call shape, different resolved adapter and result. Demonstrates the FND-01 (source-agnostic-ready) property at the memory-subsystem layer.
- **Cross-link to docs/v2/MEMORY_CONTRACT.md** in the header `**Related:**` field. ADR-004 is the architectural decision; MEMORY_CONTRACT.md is its operational validator-level expression. Bidirectional: MEMORY_CONTRACT.md's frontmatter declares `depends-on: ADR-003, ADR-004`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Source path `docs/dev/004-memory-sink-handles.md` was already untracked at HEAD**

- **Found during:** Task 1.
- **Issue:** The plan's acceptance criteria for Task 1 assume a literal `git mv docs/dev/004-memory-sink-handles.md docs/v2/adr/...` will succeed against a tracked file at the source path. But commit `cbed220` (predating Phase 0 by ~5 commits) removed the entire `docs/dev/` directory from tracking. At HEAD the file existed in neither the working tree nor the index.
- **Fix:** Restore-from-history pattern (the same fix used in plans 00-02/03/04). Retrieved byte-identical content via `git show 3c9322d:docs/dev/004-memory-sink-handles.md`, wrote it to `docs/v2/adr/004-memory-sink-handles.md`, committed as an `A` (add). The two-commit pattern (Tasks 1 + 2) between `edf4688` and `8510c13` still produces a 100%-similarity rename for `git log --follow`, validating the half-of-the-pattern this plan was supposed to prove. Pre-rename history is recoverable via the multi-path query `git log --all -- 'docs/dev/004-memory-sink-handles.md' 'docs/v2/adr/004-memory-sink-handles.md'` (5 commits across both paths).
- **Files modified:** `docs/v2/adr/004-memory-sink-handles.md` (created via restore-to-target).
- **Verification:** `git log --all --oneline -- 'docs/dev/004-memory-sink-handles.md' 'docs/v2/adr/004-memory-sink-handles.md' | wc -l` → 5.
- **Committed in:** `edf4688` (Task 1).

**2. [Rule 1 — Verification regex] Plan's verify regex `^\\*\\*M-[1-5]\\*\\*:` is over-strict**

- **Found during:** Task 2 (running plan's automated verify command).
- **Issue:** The plan's verify regex `grep -cE '^\\*\\*M-[1-5]\\*\\*:'` anchors `**M-N**:` at the start of the line with no preceding dash. But the canonical markdown form (and the form ADR-001's I-N / ADR-003's H-N use) is `- **M-N**:` — a markdown bullet. The no-dash regex returns 0 matches; the bullet-form regex `^- \\*\\*M-[1-5]\\*\\*:` returns 5 matches. This is the same verification-script over-specificity documented in plan 00-02's deviation #2.
- **Fix:** No fix to the ADR text — the bullets follow the canonical bullet form ADRs 001/002/003 already use. Documented here for plan-checker awareness. The broader acceptance criterion ("at least 5 invariants present in `**M-N**:` bullet form") is met.
- **Files modified:** none.
- **Verification:** `grep -cE '^- \\*\\*M-[1-5]\\*\\*:' docs/v2/adr/004-memory-sink-handles.md` → 5.
- **Committed in:** n/a (no code change; documented for plan-author awareness, matching the precedent in plan 00-02 deviation #2).

**3. [Rule 1 — Verification text] Initial `**no code\\n branch**` markdown line wrap defeated grep**

- **Found during:** Task 2 verification immediately before commit.
- **Issue:** First draft of the amendment paragraph wrapped the bolded phrase across a line break: `**no code\n branch**`. The plan's `grep -qi 'no code branch'` requires the literal substring on a single physical line; the wrap defeated the grep.
- **Fix:** Rewrote the sentence to keep `**no code branch**` on a single line within the prose (no behavioral change; same wording, different wrapping). The amendment paragraph reads exactly as planned.
- **Files modified:** `docs/v2/adr/004-memory-sink-handles.md` (one paragraph reflow).
- **Verification:** `grep -qi 'no code branch' docs/v2/adr/004-memory-sink-handles.md` → OK.
- **Committed in:** `8510c13` (Task 2) — the fix was applied before the Task 2 commit, so this never landed as a separate commit.

---

**Total deviations:** 3 auto-fixed (1 Rule 3 — Blocking, 1 Rule 1 — verification-script over-specificity with no required text fix, 1 Rule 1 — line-wrap fix before commit).
**Impact on plan:** All three deviations are either (a) inherited from prior history (`cbed220` deletion), (b) verification-script over-specificity matching the precedent in plan 00-02, or (c) a pre-commit reflow with no plan-text change. None affects the ADR content or the downstream pattern.

## Issues Encountered

- **`git log --follow` single-path walkability across the public/internal boundary** (same as plans 00-02/03/04). Single-path `--follow` on the new path reaches the two new commits (relocate + amend) but not the pre-`cbed220` history, because the deletion preceded the rename. Multi-path queries recover full history (5 commits across both paths). The plan's `<verification>` manual step should run the multi-path query, not single-path `--follow`.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **All four v2 ADRs (001-004) are now Accepted in `docs/v2/adr/`** with the canonical Invariants + Examples shape. Phase 0's foundational-ADR work is complete.
- **Phase 2 (memory namespace) unblocked:** the STATE blocker "Phase 2 memory-namespace work must wait on ADR-004 folder-default amendment" is satisfied. Phase 2 can begin implementation against the M-1..M-5 invariants and the dual TOML config shape.
- **Phase 9 adversarial review inherits:** four invariant prefix families to grep (`I-N` adapters, `H-N` hash, `M-N` memory; plus ADR-001's `I-1..I-5` which uses the same `I-N` prefix as ADR-002 — Phase 9 must disambiguate by source ADR, not prefix alone).
- **Plan 13 (final ADR index audit) inherits:** an index with four Accepted rows (001-004), ready for the open-ADR enumeration.
- **No new blockers introduced.**

## Stub tracking

None. The ADR is fully written; no TODO/placeholder/coming-soon strings; no empty data wired to UI rendering (n/a — this is a documentation deliverable). The `.memory-sink` sentinel and the `--memory-vault` `add-vault` flag mentioned in the amendment are Phase 2 implementation deliverables, not stubs in this plan — the ADR is the architectural decision, not the implementation.

---
*Phase: 00-foundation-decisions*
*Plan: 05*
*Completed: 2026-05-14*

## Self-Check: PASSED

- `docs/v2/adr/004-memory-sink-handles.md` — FOUND
- `docs/v2/adr/README.md` — FOUND
- `.planning/phases/00-foundation-decisions/00-05-SUMMARY.md` — FOUND
- Commit `edf4688` (Task 1 relocate) — FOUND
- Commit `8510c13` (Task 2 amend) — FOUND
- Commit `f3a4537` (Task 3 index row) — FOUND
- No modifications to STATE.md, ROADMAP.md, or evals/fixtures/v2-test-vault/ — VERIFIED (`git diff HEAD~3 HEAD --name-only` returns only `docs/v2/adr/004-memory-sink-handles.md` and `docs/v2/adr/README.md`).
- Multi-path history (5 commits across `docs/dev/` + `docs/v2/adr/`) — VERIFIED.
- Cross-link to `docs/v2/MEMORY_CONTRACT.md` present — VERIFIED.
