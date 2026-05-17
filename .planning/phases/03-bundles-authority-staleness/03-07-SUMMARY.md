---
phase: 03-bundles-authority-staleness
plan: 07
subsystem: adapters/source + adapters/stub + assembly + docs/v2 + .planning
tags: [conformance, asm-12, source-neutrality, stub-adapter, phase-sign-off]
requirements:
  - ASM-10
  - ASM-11
  - ASM-12
  - ASM-13
dependency_graph:
  requires:
    - 03-01 # sections substrate
    - 03-02 # get_outline
    - 03-03 # search_sections
    - 03-04 # get_document_bundle
    - 03-05 # search_hybrid rescore + recency.yaml
    - 03-06 # assemble_dossier + dossier.yaml expansion
  provides:
    - src/adapters/stub/assembly-fixture.ts
    - "src/adapters/source/conformance.test.ts: Assembly tools — $name describe.each (10 cases)"
    - docs/v2/PHASE-3-SIGN-OFF.md
  affects:
    - src/assembly/dossier.ts # source-neutrality scheme fix (Rule 1)
    - src/assembly/bundle.ts # source-neutrality scheme fix (Rule 1)
    - CHANGELOG.md # finalize Phase 3 entries
    - .planning/STATE.md # Phase 3 → complete
    - .planning/ROADMAP.md # checkbox flip + plans listing
tech_stack:
  added: []
  patterns:
    - parametric-describe-each-over-adapter-rows
    - in-memory-sqlite-harness-shared-across-adapters
    - stubbed-inner-hybrid-for-source-neutrality-without-ollama
    - source-derived-scheme-via-SourceConnector.handle.split
key_files:
  created:
    - src/adapters/stub/assembly-fixture.ts
    - src/adapters/stub/assembly-fixture.test.ts
    - docs/v2/PHASE-3-SIGN-OFF.md
    - .planning/phases/03-bundles-authority-staleness/03-07-SUMMARY.md
  modified:
    - src/adapters/source/conformance.test.ts
    - src/assembly/dossier.ts
    - src/assembly/bundle.ts
    - CHANGELOG.md
    - .planning/STATE.md
    - .planning/ROADMAP.md
decisions:
  - "Stub harness rebuilds DB state by hand (notes + chunks + sections + wikilinks) rather than running the full indexer. The full indexer requires Ollama embeddings; the conformance proof is about response *shape*, not embedding behavior — per RESEARCH §7 the precision/recall evals run on the obsidian-fs adapter only."
  - "search_sections conformance injects a stubbed inner searchHybrid closure (single deterministic hit pointing at a non-preamble section). This isolates the chunk-to-section promotion contract from the v1 hybrid pipeline. Production wiring is exercised by the existing 14 search_sections.test.ts cases (already green)."
  - "Discovered + fixed (Rule 1): assembleDossier and getDocumentBundle hardcoded formatDocId(\"obsidian-fs\", …) when minting linked-document DocIds — silently broke any non-Obsidian adapter. The conformance suite caught this as a hard failure on the stub-assembly row; the fix derives `scheme` from SourceConnector.handle. Two `formatDocId(...)` call sites updated (dossier x2 + bundle x2)."
  - "Dossier's `noteDocIdString` helper renamed to `noteSortKey` and pinned to a fixed `vault://` prefix. The value is a SORT key (used only for deterministic lex tiebreak), not an actual DocId — using the adapter's scheme would be correct but cosmetically inconsistent across adapter rows. The fixed prefix keeps sort order identical across adapters AND avoids the cognitive trap of conflating tiebreak strings with brand-validated DocIds."
  - "Citation-packet shape parity assertion does NOT exercise the full hybrid pipeline (no Ollama dependency). Instead, the assertion builds a recall-shape packet via `toCitationPacket(doc, displayUrlFor(doc.id, source))` and asserts the same key set as the dossier anchor packet. This proves the toCitationPacket mapper produces identical shape on both adapters — which is the actual ASM-12 invariant. The hybrid-pipeline integration is already pinned by the existing recall + search_hybrid unit tests."
  - "ASM-13 disposition: 'Investigated; no candidates found in MVP scope.' The four new assembly tools all have keyed/parameterized inputs (no clean stable-URI list shapes). Phase 5 (`list_briefs`) and Phase 6 (`list_contracts`) introduce natural Resources candidates — promotion is in their respective phase plans."
  - "Tool surface count at Phase 3 sign-off: 30 tools (23 v1 byte-identical + 3 Phase 2 memory + 4 Phase 3 assembly). Within the REL-08 ≤32-tool budget."
metrics:
  duration_minutes: ~80
  tasks_completed: 5
  files_created: 4
  files_modified: 6
  tests_added: 24
  tests_total_after: 1076
  commits: 4
---

# Phase 3 Plan 07: Conformance + source-neutrality proof + phase sign-off — Summary

Close Phase 3 by (a) proving source-neutrality of the four new assembly
tools (ASM-12) via a parameterized conformance suite over the
obsidian-fs and stub adapters, (b) recording the ASM-13 disposition,
and (c) writing the Phase 3 sign-off doc + finalizing CHANGELOG,
STATE, and ROADMAP. Also discovers + fixes a hardcoded `"obsidian-fs"`
scheme in the dossier + bundle controllers — exactly the kind of
source-neutrality bug ASM-12 is designed to surface.

## Outcome

| Acceptance criterion | Status |
|---|---|
| `src/adapters/source/conformance.test.ts` has an "Assembly tools — $name" describe.each section with 5 `it()` cases | PASS — 10 test runs (5 × 2 adapters) |
| All 5 assertions pass for both `obsidian-fs` AND `stub-assembly` adapter rows | PASS |
| Citation-packet REQUIRED key list includes all 8 fields incl. `properties`; `typeof properties === "object"` | PASS — pinned by Test #2 + Test #5 |
| `src/adapters/stub/assembly-fixture.ts` exists with 8 hand-constructed `Document[]` covering contract surface | PASS — Person/aliases, Authoritative, Superseded, frontmatter-ref edge, wikilink, mention, hyperlink, multi-section Long doc |
| `npm run eval:baseline` green (v1 invariance) | PASS — 30 passed, 11 skipped |
| `bash scripts/lint-adapters.sh` clean | PASS — all 8 invariants green |
| `docs/v2/PHASE-3-SIGN-OFF.md` records requirements checklist + ASM-13 disposition + known limitations | PASS |
| `CHANGELOG.md [Unreleased]` has the full Phase 3 entries | PASS — 03-01 (sections), 03-02 (get_outline), 03-03 (search_sections), 03-04 (get_document_bundle), 03-05 (search_hybrid rescore), 03-06 (assemble_dossier), 03-07 (conformance + fix); migration 010 |
| `.planning/STATE.md` Phase 3 row → Complete | PASS |
| `.planning/ROADMAP.md` Phase 3 row → `[x]` + Plans listing | PASS |
| `evals/v1-baseline/tools-list.snapshot.json` final regen is additive-only | PASS — re-running `npm run eval:snapshot` produces zero diff |
| All existing tests + new Phase 3 tests pass | PASS — 1076 passed, 11 skipped (was 1052 pre-03-07; +24 net) |

## Files changed

### Created (4)

- `src/adapters/stub/assembly-fixture.ts` — 8-document `Document[]`
  fixture per RESEARCH §7. Exports named DocId constants
  (`ALICE_DOC_ID`, `ATLAS_1_DOC_ID`, `ATLAS_0_DOC_ID`, `LONG_DOC_ID`,
  `Q2_REVIEW_DOC_ID`, `SYNC_DOC_ID`); a `validateAssemblyStubDocs`
  sanity guard; and a `blocksToMarkdown` projection helper for the
  test harness's indexer-feed step.
- `src/adapters/stub/assembly-fixture.test.ts` — 14 sanity tests
  (validates clean, counts the 8 docs, asserts namespace, asserts
  named DocId constants, structural checks per role, edge counts,
  blocksToMarkdown round-trip, hash format, mtime monotonicity).
- `docs/v2/PHASE-3-SIGN-OFF.md` — Phase 3 sign-off doc. Mirrors the
  Phase 0 `docs/v2/SIGN-OFF.md` shape: Phase summary, success
  criteria disposition (5 criteria), ASM-13 narrative, known v2.0.0
  limitations, tool-surface impact, test counts, plan-checker M1–M5
  disposition, adapter-seam audit, next phase.
- `.planning/phases/03-bundles-authority-staleness/03-07-SUMMARY.md`
  — this file.

### Modified (6)

- `src/adapters/source/conformance.test.ts` — extended with the
  "Assembly tools — $name" `describe.each` section (10 new test
  runs: 5 cases × 2 adapter rows). New imports: `parseNote`,
  `chunkNote`, `Database`, `WikilinkResolver`, `buildSectionsForNote`,
  `VaultManager`, `assembleDossier`, `getOutline`, `searchSections`,
  `getDocumentBundle`, `CitationPacket`, `displayUrlFor`,
  `toCitationPacket`, plus the stub-fixture exports. Two harness
  builders (`buildObsidianFsAssemblyHarness` async + `buildStubAssemblyHarness`)
  populate equivalent in-memory SQLite state from the two different
  adapter sources. ~600 lines added.
- `src/assembly/dossier.ts` — Rule 1 source-neutrality fix.
  Introduced `schemeFromSource(SourceConnector): string`. Derived
  `anchorScheme` from `anchorSource.handle` and used it for both the
  anchor `formatDocId(...)` and every backlink `formatDocId(...)`.
  Renamed sort-key helper `noteDocIdString → noteSortKey` and pinned
  it to a fixed `vault://` prefix.
- `src/assembly/bundle.ts` — Rule 1 source-neutrality fix. Pulled
  `scheme` (named `anchorScheme`) out of `decomposeDocId(parsed)` —
  already exposed by the existing destructure — and used it for the
  backlink + forward-link `formatDocId(...)` call sites.
- `CHANGELOG.md` — finalized Phase 3 `[Unreleased]` entries: section
  identity substrate (03-01), get_outline (03-02), search_sections
  (03-03), get_document_bundle (03-04), search_hybrid rescore
  (03-05), assemble_dossier (03-06; already present), source-
  neutrality conformance (03-07), source-neutrality scheme fix
  (Changed section), tool-count delta 26 → 30, migration 010.
- `.planning/STATE.md` — Phase 3 row flipped to complete; current
  focus updated to Phase 4 (planning not yet started); progress bar
  recalculated (was 30%, now 40%).
- `.planning/ROADMAP.md` — Phase 3 checkbox `[ ]` → `[x]`; Phase 3
  detail section heading appended with `— COMPLETE (2026-05-17)`;
  five success criteria each annotated with `**MET**` + evidence;
  `**Plans**: TBD` replaced with 7-entry plan listing (all `[x]`).

## Tests added

| File | Cases |
|---|---|
| `src/adapters/stub/assembly-fixture.test.ts` | 14 |
| `src/adapters/source/conformance.test.ts` (new "Assembly tools" describe.each) | 10 (5 × 2 adapter rows) |
| **Total** | **24** |

The 24 new tests bring the suite from 1052 to 1076 passing.

## Commits (4)

| # | Hash | Message |
|---|---|---|
| 1 | `b3da241` | `feat(03-07): src/adapters/stub/assembly-fixture.ts — purpose-built Document[] for ASM-12` |
| 2 | `83757fe` | `fix(03-07): assembly DocId minting derives scheme from SourceConnector.handle` |
| 3 | `c741003` | `test(03-07): conformance suite — Assembly tools source-neutrality (ASM-12)` |
| 4 | _to land_ | `docs(03-07): Phase 3 sign-off + CHANGELOG + STATE/ROADMAP` |

## Gates

| Gate | Result |
|---|---|
| `npx vitest run --exclude '**/.claude/**'` | **1076 passed, 11 skipped** (was 1052; +24 net) |
| `npx tsc --noEmit` | clean |
| `bash scripts/lint-adapters.sh` | all 8 invariants green |
| `npm run eval:baseline` | 30 passed, 11 skipped |
| `npm run eval:snapshot` re-run | byte-identical to committed snapshot |

## Deviations from plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Assembly DocId minting hardcoded "obsidian-fs" scheme**

- **Found during:** Task 3 (conformance test extension).
- **Issue:** Both `assembleDossier` (`src/assembly/dossier.ts`) and
  `getDocumentBundle` (`src/assembly/bundle.ts`) called
  `formatDocId("obsidian-fs", vaultName, path)` to mint linked-
  document DocIds. The stub-assembly conformance row failed dossier
  Test #2 with `no_matching_anchor_document`, and bundle Test #4 with
  `Document not found` — the constructed `obsidian-fs://memory/...`
  DocId had no chance of resolving against `StubSource` whose handle
  is `stub://memory`.
- **Fix:** Introduced `schemeFromSource(source: SourceConnector): string`
  helper in `dossier.ts` (splits `source.handle` on `://`). Derived
  `anchorScheme` from `anchorSource.handle` in the dossier; pulled
  the scheme out of `decomposeDocId(parsed)` (already exposed) in
  `bundle.ts`. Renamed dossier's sort-key helper
  `noteDocIdString → noteSortKey` and pinned it to a fixed `vault://`
  prefix (the value is a deterministic-tiebreak key, not a real
  DocId; fixing the prefix avoids the cognitive trap of conflating
  the two).
- **Files modified:** `src/assembly/dossier.ts`,
  `src/assembly/bundle.ts`.
- **Commit:** `83757fe`.

**2. [Rule 3 - Blocking] Wrong superseded fixture path**

- **Found during:** Task 3 (conformance test).
- **Issue:** I initially referenced
  `obsidian-fs://atlas/_memory/observations/2026-04-23-spire-budget-low.md`
  as the obsidian-fs superseded fixture. That file does not exist —
  the canonical Spire budget supersede chain uses
  `2026-04-23-spire-budget-uncertain.md` (per Phase 2 plan 02-07).
- **Fix:** Updated the harness's `supersededDocId` to the correct
  path.
- **Files modified:** `src/adapters/source/conformance.test.ts`.
- **Commit:** `c741003`.

**3. [Rule 3 - Blocking] SectionResolution shape + section method signature**

- **Found during:** Task 3 (conformance test — search_sections case).
- **Issue:** Initial `sectionForHit` stub returned an
  `{sectionAnchor, sectionHeadingPath, chunkIdLast}` shape and
  called `vault.db.sections.findContainingChunk(c.id)` (single
  arg). The actual `SectionResolution` type is
  `{noteId, anchor, headingPath, chunkIdFirst}` per
  `src/assembly/search-sections.ts:71-80`, and the SQL helper
  signature is `findContainingChunk(noteId, chunkId)` per
  `src/db/queries/sections.ts:118-119`. The mismatch silently
  produced zero section hits.
- **Fix:** Corrected the stub return shape AND added a chunk-walk
  loop that skips preamble (level-0, empty heading_path) sections —
  `searchSections` drops these by contract.
- **Files modified:** `src/adapters/source/conformance.test.ts`.
- **Commit:** `c741003`.

### Other deviations

**Stray write to main repo (cwd-drift #3099)** — initial `Write` call
landed `src/adapters/stub/assembly-fixture.ts` in the main repo
checkout rather than the worktree (cwd captured from an earlier
`pwd`). Removed the stray file and re-wrote under the worktree
absolute path. Identical pattern to plan 03-02's deviation log §2.

## Known stubs

None. Phase 3's `linked_documents[].relation === "wikilink"` hardcode
is intentional v2.0.0 behavior — documented in CHANGELOG, the sign-off
doc, AND `PHASE-4-WIDEN` source-comment markers. v1's wikilinks table
genuinely has no other edge types to emit until Phase 4 GRA-04.

## Threat flags

None. 03-07 adds test-only code paths plus a contained
source-neutrality fix to two existing controllers. No new trust
boundaries, no new network calls, no new write paths.

## Self-Check: PASSED

Verified after writing this SUMMARY:

- `src/adapters/stub/assembly-fixture.ts` — FOUND
- `src/adapters/stub/assembly-fixture.test.ts` — FOUND (14 tests)
- `docs/v2/PHASE-3-SIGN-OFF.md` — FOUND
- `src/adapters/source/conformance.test.ts` — extended (35 tests, was 25)
- Commits `b3da241`, `83757fe`, `c741003` — all present in `git log`
- `npx vitest run` — 1076 passed, 11 skipped, 0 failed
- `bash scripts/lint-adapters.sh` — all 8 invariants green
- `npm run eval:baseline` — 30 passed, 11 skipped
- CHANGELOG.md updated with Phase 3 entries
- STATE.md and ROADMAP.md flipped to Phase 3 complete
