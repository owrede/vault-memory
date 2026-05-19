---
phase: 08-polish-eval-suite-v2-0-0-release
plan: 02
subsystem: docs
tags: [readme, documentation, ascii-diagram, voice-discipline, semver]

# Dependency graph
requires:
  - phase: 08-polish-eval-suite-v2-0-0-release
    provides: CHANGELOG [Unreleased] block backfilled by plan 08-01 (source for README §4 bullets)
provides:
  - Six-section v2-first README.md (30-second example, what this is, architecture, what's new, roadmap, install + docs)
  - Strict 7-bit ASCII L0-L4 + Adapter tier architecture diagram (23 lines, max width 79 columns)
  - Phase 9 hard gate + v3.0.0 Notion connector explicitly named in roadmap
  - Tool-surface delta framed as 32 canonical + 5 DEPRECATED in tools/list + 10 MCP Resources
  - Forward-reference contract on docs/v2/MIGRATION-V1-TO-V2.md (Wave 1 sibling plan 08-03)
affects:
  - 08-03 (MIGRATION-V1-TO-V2.md target — README §6 links here)
  - 08-08 (v2.0.0 release cut — README is the npmjs.com display text)
  - REL-09 (maintainer sign-off carryover into the Phase 8 sign-off doc)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Strict 7-bit ASCII for portable architecture diagrams (W1 mitigation)"
    - "Forward-reference link policy: a plan in wave N may link to artifacts produced by sibling plans in the same wave; maintainer confirms or flags at checkpoint"
    - "Six-section v2 README structure (D-11): 30-sec example -> what this is -> architecture -> what's new -> roadmap -> install + docs"

key-files:
  created:
    - .planning/phases/08-polish-eval-suite-v2-0-0-release/deferred-items.md
    - .planning/phases/08-polish-eval-suite-v2-0-0-release/08-02-SUMMARY.md
  modified:
    - README.md

key-decisions:
  - "Replaced markdown prerequisites table with bullet list to keep all README lines <=96 columns (avoids the wide-row pathology of GFM tables; preserves the same information density)"
  - "Logged pre-existing telemetry-banlist false positive in src/contracts/resources.ts to deferred-items.md rather than fixing inline (out of scope for the README rewrite; pre-dates Phase 8)"
  - "Used em-dash sparingly in §6 link list to keep multi-byte chars from pushing lines past 96 bytes (awk byte-count gate)"

patterns-established:
  - "Pattern: README architecture diagram is strict 7-bit ASCII (+ - | space + ASCII text). No Unicode box-drawing. Renders identically in GitHub web view, 100-col terminal, cat, and minimal editors."
  - "Pattern: SemVer-stability statement lives at the end of the install + docs section, linking back to CHANGELOG.md (Pitfall 7 mitigation)."
  - "Pattern: v2 README leads with 'any MCP-aware agent' framing in the first 4 lines; Claude Code is NOT privileged over other clients."

requirements-completed:
  - REL-03
  - REL-04
  - REL-09  # partial — full REL-09 sign-off carries into plan 08-08

# Metrics
duration: ~25min
completed: 2026-05-19
---

# Phase 8 Plan 02: README v2 rewrite Summary

**Six-section v2-first README.md with strict 7-bit ASCII L0-L4 architecture diagram, Phase 9 + v3.0.0 named explicitly in the roadmap, and the canonical-vs-raw tool-surface delta (32 canonical / 5 DEPRECATED / 37 raw / 10 MCP Resources).**

## Performance

- **Duration:** ~25 min (Tasks 1-2; Task 3 is a blocking human checkpoint and pauses execution)
- **Started:** 2026-05-19T13:54:00Z (approx, plan start)
- **Completed:** 2026-05-19T14:19:13Z (Tasks 1-2 complete; Task 3 awaiting maintainer)
- **Tasks completed:** 2 of 3 (Task 3 is a blocking human-verify checkpoint, NOT executed by this agent)
- **Files modified:** 1 (README.md)
- **Files created:** 2 (deferred-items.md, this SUMMARY.md)

## Accomplishments

- Rewrote `README.md` from a v1-centric reference layout into a six-section v2 pitch document following the D-11 structure (30-second example, what this is, architecture, what's new, roadmap, install + docs).
- Preserved the existing v1.0.0 README's "any MCP-aware agent" voice anchor in section 2 — no marketing superlatives, no Claude-Code privileging.
- Rendered the L0-L4 + Adapter tier layer model from `docs/v2/ARCHITECTURE.md` as a strict 7-bit ASCII block (`+ - | space` only — no Unicode box-drawing codepoints in U+2500..U+257F). Diagram is 23 lines, max width 79 columns; renders identically in GitHub web view, a 100-column terminal, `cat`, and minimal editors.
- Named **Phase 9 (pre-Phase-10 premise check, hard gate)** and **v3.0.0 (Notion connector + multi-source proof)** explicitly in section 5, sourcing the framing from `.planning/ROADMAP.md` §"Phase 9" and §"Phase 10".
- Framed the v2 tool-surface delta in the canonical-vs-raw form mandated by plan-checker finding B1: 23 v1 tools become **32 canonical tools + 5 DEPRECATED entries in `tools/list`** (raw count = 37; canonical count = 32; the 5 promoted list-style tools remain callable through v2.x with `DEPRECATED` in their `description`; removal scheduled for v3.0.0). Resources delta: 5 -> 10.
- Documented the SemVer-stability statement at the end of section 6 (Pitfall 7 mitigation): the 23 v1 tool names + input schemas are preserved byte-identical; CHANGELOG.md remains the canonical history.

## Task Commits

Each task was committed atomically:

1. **Task 1: Compose the new six-section README (replace existing content)** — `8916110` (docs)
2. **Task 2: Validate links and voice discipline; verify diagram renders** — `c694fca` (docs)
3. **Task 3: Maintainer cold-read sign-off (REL-09)** — NOT YET COMMITTED. Blocking human-verify checkpoint. Pending maintainer "approved" or revision asks.

_The plan-completion metadata commit will be made by the orchestrator after the maintainer checkpoint resolves and the agent resumes._

## Files Created/Modified

- `README.md` (modified, full rewrite) — six-section v2 pitch. 226 lines. Section headings:
  1. `## 30-second example` — npm install + Claude Desktop snippet + `meeting-prep` contract paragraph.
  2. `## What this is` — preserves v1 README:1-21 voice; ≤200 words around the agentic-knowledge-layer pitch + adapter-seams promise + "nothing leaves your machine".
  3. `## Architecture` — strict 7-bit ASCII L0-L4 + Adapter tier diagram (23 lines, max width 79 cols); cross-link to `docs/v2/ARCHITECTURE.md`.
  4. `## What's new in v2` — Phase 2-7 bullets sourced from CHANGELOG `[Unreleased]`; tool-surface delta with the canonical-vs-raw framing; Resources delta 5 -> 10.
  5. `## Roadmap` — Phase 9 (hard gate) one paragraph; v3.0.0 (Notion connector) one paragraph; v3.x/v4.0.0 mentioned as ideas, not commitments.
  6. `## Install and docs` — prerequisites bullets, install commands, 8 documentation links, SemVer-stability statement.
- `.planning/phases/08-polish-eval-suite-v2-0-0-release/deferred-items.md` (created) — pre-existing telemetry-banlist false positive logged out of scope.

## Verification Results

### Acceptance criteria gates (Tasks 1 + 2)

| Gate | Result |
|---|---|
| `grep -q "Phase 9" README.md` | PASS (REL-04) |
| `grep -q "v3" README.md` | PASS (REL-04) |
| `grep -q "MIGRATION-V1-TO-V2" README.md` | PASS |
| `grep -qi "meeting-prep" README.md` | PASS |
| `grep -q "MCP-aware agent" README.md` | PASS (REL-03 voice preserved) |
| `## ` heading count >= 6 | PASS (7 headings: 6 sections + License footer) |
| `grep -P '[\x{2500}-\x{257F}]' README.md` returns 0 | PASS (strict-ASCII W1 gate) |
| `grep -q "32 canonical" README.md` | PASS (B1 canonical-vs-raw framing) |
| `grep -q "DEPRECATED" README.md` | PASS |
| `grep -q "10 MCP Resources" README.md` | PASS |
| `awk '{ if (length > 96) ... }' README.md` exits 0 | PASS (max line = 96 bytes after table-to-bullet conversion) |
| Voice grep (`blazingly|magnificent|revolutionary|world.class`) | PASS (0 hits) |

### Link validation

13/14 relative links in README.md resolve to existing files. The one unresolved link is `docs/v2/MIGRATION-V1-TO-V2.md`, which is created by Wave 1 sibling plan **08-03**. This is an allowed forward reference per Task 3 acceptance criteria ("If MIGRATION-V1-TO-V2.md does not yet exist (plan 08-03 hasn't shipped), the link in §6 is allowed to be a forward reference — maintainer confirms or flags").

Resolved links:
- `./CHANGELOG.md` (twice)
- `.planning/ROADMAP.md`
- `docs/v2/AGENT_AGNOSTIC.md`
- `docs/v2/ARCHITECTURE.md`
- `docs/v2/MEMORY_CONTRACT.md`
- `docs/v2/PHASE-3-SIGN-OFF.md`
- `docs/v2/PHASE-4-SIGN-OFF.md`
- `docs/v2/PHASE-5-SIGN-OFF.md`
- `docs/v2/PHASE-6-SIGN-OFF.md`
- `docs/v2/adr/README.md`
- `docs/v2/plugin/INSTALL.md`
- `docs/v2/plugin/README.md`

### ASCII diagram dimensions

- Lines: **23** (including the two `+---` rule lines at top and bottom; the implementations row uses an embedded `|` separator between `obsidian-fs` and `notion-api`).
- Maximum line width: **79 bytes** (well under the 96-column cap and the 100-column terminal target).
- Character set: `+`, `-`, `|`, space, ASCII letters, digits, `(`, `)`, `,`, `.`, `:`. Zero Unicode characters in U+2500..U+257F.

### Strict-ASCII grep gate (W1)

`grep -P '[\x{2500}-\x{257F}]' README.md` returns **0 matches** — the canonical W1 gate is clear.

### Maintainer sign-off line

_To be filled in by the maintainer at Task 3 checkpoint resolution. Expected line:_

> Maintainer ([name]) cold-read README.md on [date] and signed off via "approved" on the Task 3 human-verify checkpoint. REL-09 satisfied for the README portion; full REL-09 closure carries to plan 08-08 (Phase 8 sign-off doc)._

## Decisions Made

- **Converted the prerequisites markdown table to a bullet list.** The original v1 README and the plan's Task 1 action both implied a `| What | Why | How |` table. After running the line-width check, the longest table row exceeded the 96-byte awk gate by 39 bytes. Rather than truncate prerequisite descriptions further (which would degrade clarity for new users), I converted the section to a bullet list with the same information density. The 30-second example section still leads with a runnable code block, so the "what to install" information is doubly available.
- **Used the literal `+ - | space` character set for the architecture diagram.** The original `docs/v2/ARCHITECTURE.md` uses Unicode box-drawing characters (`┌─┐`, `├─┤`, etc.), which the plan explicitly forbids in README.md per the W1 finding. I re-rendered the same L0-L4 + Adapter tier model with strict 7-bit ASCII, kept the same row groupings (each layer = title row + tools row), and used `.` (period) instead of Unicode middle-dot for the inline tool-name separator.
- **Logged the pre-existing `lint-no-telemetry.sh` false positive to deferred-items.md, not fixed.** `npm run lint:check` fails on identifiers `ListContractsEntry` / `ListContractVerbsEntry` in `src/contracts/resources.ts` (Phase 6 commit `9aaf325`). This pre-dates Phase 8 and is unrelated to the README rewrite. Per the deviation-rules scope boundary, out-of-scope failures are logged, not fixed.

## Deviations from Plan

None substantive. The pre-existing telemetry-banlist lint failure was logged to `deferred-items.md` per the scope-boundary rule — not auto-fixed. The prerequisites-table-to-bullet conversion is a stylistic adjustment that preserves all information; it was driven by the line-width gate, not by a deviation from the plan's intent.

## Issues Encountered

- **Markdown table rows are inherently wide.** The original v1 README's `| What | Why | How |` prerequisites table had multi-cell rows that exceeded 96 bytes when fully populated with brew install commands and links. Resolved by switching to a bullet list (see Decisions Made).
- **`npm run lint:check` fails on a pre-existing Phase 6 telemetry-banlist hit** unrelated to README. Logged to `deferred-items.md`; not fixed (out of scope).
- **Forward reference to `docs/v2/MIGRATION-V1-TO-V2.md`.** This is the sibling Wave 1 plan 08-03's deliverable. The Task 3 acceptance criteria explicitly allow this as a forward reference; the maintainer confirms or flags at the checkpoint.

## User Setup Required

None.

## Next Phase Readiness

- README is ready for the Task 3 human-verify cold-read checkpoint.
- After maintainer sign-off ("approved" or revisions), full REL-09 closure carries to plan 08-08 (Phase 8 sign-off doc).
- Wave 1 sibling plan 08-03 must land before the `docs/v2/MIGRATION-V1-TO-V2.md` link in §6 resolves; the orchestrator's Wave 1 sequencing handles this.

## Threat Flags

None. The README changes do not introduce new security surface; they replace prose that previously existed at the same trust boundaries (repo->npmjs.com, repo->GitHub web view). The threat register in the plan covers voice drift (T-08-02-R), broken links (T-08-02-I), and diagram tampering to Unicode (T-08-02-T) — all mitigated by the gates in Tasks 1-2.

## Self-Check

### Files created exist

- `README.md`: FOUND (modified, 226 lines)
- `.planning/phases/08-polish-eval-suite-v2-0-0-release/deferred-items.md`: FOUND
- `.planning/phases/08-polish-eval-suite-v2-0-0-release/08-02-SUMMARY.md`: FOUND (this file)

### Commits exist on the worktree branch

- `8916110`: FOUND — Task 1 `docs(08-02): rewrite README around v2 six-section structure`
- `c694fca`: FOUND — Task 2 `docs(08-02): validate README links + voice + diagram; log deferred lint`

## Self-Check: PASSED

---
*Phase: 08-polish-eval-suite-v2-0-0-release*
*Plan: 02*
*Tasks 1-2 completed: 2026-05-19; Task 3 (maintainer cold-read sign-off) pending*
