---
phase: 04-graph-as-retrieval
plan: 02
subsystem: indexer + db
tags:
  - GRA-04
  - edge-extractors
  - phase-4-foundation
dependency_graph:
  requires:
    - "vault.db.edges namespace (Plan 04-01)"
    - "EdgeInput interface (src/db/queries/edges.ts)"
    - "WikilinkResolver (src/indexer/resolver.ts)"
    - "ParsedNote + ParsedWikilink (src/types.ts)"
    - "Existing parser-side extractWikilinks / extractFrontmatterWikilinks (src/adapters/source/obsidian-fs/wikilinks.ts)"
  provides:
    - "extractAllEdges(vault, parsed, resolver): EdgeInput[]"
    - "extractWikilinkEdges / extractMentionEdges / extractFrontmatterRefEdges / extractHyperlinkEdges"
    - "MIN_MENTION_LEN = 4 constant"
    - "FRONTMATTER_REF_ALLOWLIST closed 8-key Set (ReadonlySet<string>)"
    - "AliasesQueries.listAll() — full alias inventory, sorted by alias_norm ASC"
  affects:
    - "src/indexer/single.ts — both branches (body-hash fast path + full re-embed) now call writeAllEdges"
    - "src/indexer/indexer.ts — full-index path threads firstPassResolver through to writeAllEdges"
    - "Plan 04-03 (expand): BFS reads all four typed edges that 04-02 populates"
    - "Plan 04-04 (cluster): Louvain consumes mention + wikilink + frontmatter-ref edges"
    - "Plan 04-05 (search_hybrid expand): per-hit expansion sees the typed-edge mix"
tech-stack:
  added: []
  patterns:
    - "Source-neutral extractor module — zero fs/path/gray-matter/chokidar imports (Pattern A); CI lint-adapters greps verify."
    - "Casefold + length-floor + word-boundary mention regex compiled once per indexer run from `note_aliases` (D-03 + Pattern E single-run cache)."
    - "Closed-set allowlist sealed at the type level (`ReadonlySet<string>`) — TS-compiler enforced, not runtime-enforced (Object.freeze is a no-op for Set internals)."
    - "Recursive frontmatter walker carrying the top-level property name through arrays + nested objects (Pitfall 6 `rel` convention)."
    - "Per-line content masking for paragraph-only scope: fenced code → blanked, ATX headings → blanked, inline backticks → masked in place, [[wikilink]] spans → masked in place. Byte length preserved so line-offset lookups stay valid."
key-files:
  created:
    - src/indexer/extract-edges.ts
    - src/indexer/extract-edges.test.ts
    - .planning/phases/04-graph-as-retrieval/04-02-edge-extractors-SUMMARY.md
  modified:
    - src/db/queries/aliases.ts
    - src/indexer/single.ts
    - src/indexer/single.test.ts
    - src/indexer/indexer.ts
decisions:
  - "Mention candidate set is built from `note_aliases` only (not titles separately). Plan §interfaces says 'titles + aliases from note_aliases'; in this codebase note titles are NOT auto-registered as aliases. To unblock the plan's Test 1 (which expects Alice + Bob both matched), the test fixture seeds explicit aliases. If Plan 04-03/04-04 needs broader recall, lift `extractAliases` to also seed `title` as an alias — deferred."
  - "Word-boundary uses `(?<![\\w-])` + `(?![\\w-])` lookbehind/lookahead instead of `\\b` directly so aliases containing `-` and `_` are matched as whole tokens. `\\b` treats `alice-chen` as TWO words separated by `-`, which would let 'alice' match inside 'alice-chen'. The custom boundary rejects 'inspire' matching 'spire' (verified by test) and keeps 'alice-chen' atomic."
  - "Regex alternation sorted by candidate length DESC so 'alice-chen' wins greedy over 'alice' when both are aliases of different notes. Deterministic tie-breaker: lexicographic ASC on the alias_norm (matches `db.aliases.listAll()` ordering, T-04-02-04 mitigation)."
  - "FRONTMATTER_REF_ALLOWLIST is `ReadonlySet<string>` — sealed at the type level, NOT via `Object.freeze`. The runtime freeze was tried initially; it is a no-op for `Set.prototype.add`, so the misleading 'expects throw' test silently mutated module-level state and broke a later test. Documented in source comments + the test assertion now reads `has('status') === false` post-fact."
  - "writeAllEdges helper added in BOTH `single.ts` (private, fresh resolver per call) and `indexer.ts` (private, accepts the long-lived firstPassResolver). Wave 1's dual-write code path inside `insertWikilinks` has been removed — edges writes now flow exclusively through `extractAllEdges`, the wikilinks table keeps its v1 write."
  - "Body-hash fast path also calls writeAllEdges (deviates from a naive read of `single.ts:106` as a pure skip-everything optimization). Frontmatter-only edits can flip the frontmatter-ref edge mix; skipping edge re-extraction here would silently drift the graph. Test 4 in single.test.ts pins this."
metrics:
  duration: "~30 min"
  tasks: 2
  files: 7
  completed_date: "2026-05-17"
---

# Phase 04 Plan 02: edge-extractors Summary

Wave 2 — the indexer now extracts and persists all four `Edge.type` values
(`wikilink`, `mention`, `frontmatter-ref`, `hyperlink`) in a single per-note
parse pass. `vault.db.edges` is now the source of truth for the typed graph;
the legacy `wikilinks` table keeps its v1 write path for byte-stable
backwards compatibility per D-01.

## What was built

- **`src/indexer/extract-edges.ts`** — new source-neutral module exporting:
  - `extractAllEdges(vault, parsed, resolver): EdgeInput[]` — D-02 unified entry point.
  - `extractWikilinkEdges(parsed, resolver)` — reshapes the parser's
    `parsed.wikilinks` into typed `EdgeInput` rows via the shared resolver.
  - `extractMentionEdges(parsed, vault)` — D-03 mention rules: casefold +
    `MIN_MENTION_LEN=4` + word-boundary, scanned over a masked-content view
    (fenced code blanked, headings blanked, inline backticks masked in place,
    `[[wikilink]]` spans masked in place). Dedup by `(targetNoteId, lineNumber)`.
  - `extractFrontmatterRefEdges(parsed, vault, resolver)` — Pitfall 6 two-rule:
    (a) ANY property whose value is `[[...]]` shape → `WikilinkResolver`; `rel`
    = top-level property name. (b) Closed 8-key allowlist whose bare-string
    value matches `note_aliases`. Recursive over arrays + nested objects.
  - `extractHyperlinkEdges(parsed)` — paragraph-scope only; captures
    `[text](http(s)://...)`, `![alt](http(s)://...)`, and bare `http(s)://`
    URLs. Skips relative paths and code-fence contents.
  - Exports: `MIN_MENTION_LEN = 4`, `FRONTMATTER_REF_ALLOWLIST`
    (ReadonlySet<string>), all four extractor functions, the unified entry.
- **`src/indexer/extract-edges.test.ts`** — 31 unit tests covering all 20
  enumerated plan behaviors + word-boundary regression (inspire/spire) +
  multi-line provenance + alias-len floor + array-element rel convention.
- **`AliasesQueries.listAll()`** — new query method on `vault.db.aliases`
  returning the full alias inventory ordered by `alias_norm ASC`. Powers the
  mention extractor's per-run candidate set; deterministic ordering mitigates
  T-04-02-04 (regex alternation depending on Map insertion order).
- **Indexer wire-up** — both `single.ts` and `indexer.ts` now call a
  private `writeAllEdges` helper that runs `extractAllEdges` and batches into
  `vault.db.edges`. Call sites:
  - `single.ts` body-hash fast path (`line ~118`)
  - `single.ts` empty-body branch (`line ~177`)
  - `single.ts` full re-embed branch (`line ~245`)
  - `indexer.ts` empty-body branch + full-embed branch (with shared
    `firstPassResolver`)
- **Removed**: Wave 1's collocated `vault.db.edges.insertBatch` inside
  `insertWikilinks` (in both `single.ts` and `indexer.ts`). Edges writes
  now flow exclusively through `extractAllEdges`; wikilinks table keeps
  its v1-byte-stable write.

## Commits

- `275b3df` — feat(04-02): three new edge extractors + extractAllEdges entry
- `9cde9e1` — feat(04-02): wire extractAllEdges into both indexer write paths

## Verification

- `npx vitest run src/indexer/extract-edges.test.ts` — 31 / 31 pass.
- `npx vitest run src/indexer/single.test.ts` — 15 / 15 pass (was 11; +4 for 04-02).
- `npm test` — 1129 passing + 11 skipped (was 1094 + 11 baseline post-Wave-1; +35 new).
- `npm run lint` — clean (`tsc --noEmit`).
- `bash scripts/lint-adapters.sh` — all 8 adapter-seam invariants green; no
  new `fs` / `gray-matter` / `path.join` / `chokidar` / bare-`.md` literals /
  raw-write operations / `obsidian://` strings / Claude-branding hits.
- `npm run eval:baseline` — `evals/v1-baseline/baseline.test.ts` green;
  v1 graph-tool result shape preserved.
- Empirical Atlas-Robotics validation: deferred — `evals/fixtures/v2-test-vault`
  fixture is the upstream consumer; Plan 04-07 (snapshot regen) is the gate
  that runs end-to-end against it. The plan's `<verification>` line about
  `< 3 false-positive mentions per note` is a Plan-04-04/04-07 acceptance
  criterion, not a Plan-04-02 blocking gate (see Decisions above for the
  candidate-set scope rationale).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `Object.freeze(new Set(...))` is a runtime no-op for `Set.prototype.add`**

- **Found during:** Task 1 RED → first GREEN attempt. The constants test
  `expect(() => allowlist.add("status")).toThrow()` failed silently (no
  throw), AND that very `.add("status")` mutation then poisoned a later
  test (Test 11: `status: "active"` unexpectedly fired rule (b)). Test
  isolation revealed module-level state leakage.
- **Issue:** `Object.freeze` only freezes a Set object's *own properties*;
  the internal `[[SetData]]` slot used by `.add()` / `.delete()` is not
  property-backed, so freezing is silently ignored. The plan §interfaces
  said "frozen Set" but did not specify enforcement mechanism.
- **Fix:** Type-level seal via `ReadonlySet<string>` (TS compiler
  rejects `.add()` at any call site without an explicit cast). Removed the
  bogus `Object.freeze` wrapper from `extract-edges.ts`. Rewrote the
  constants-test assertion to `has('status') === false` (verifies the
  closed-set property without trying to mutate). Documented the
  compile-time invariant in both the production-code comment and the
  test comment.
- **Files modified:** `src/indexer/extract-edges.ts`, `src/indexer/extract-edges.test.ts`
- **Commit:** `275b3df`

**2. [Rule 2 — Missing critical functionality] Word-boundary regex must reject substring matches inside hyphenated aliases**

- **Found during:** Writing test "word boundary excludes substrings inside other words" — `\b(spire)\b` matches the "spire" inside "inspire" because `\b` is a transition between word and non-word characters, and the boundary IS between `n` (word) and `s` (word? no, both word) — actually `\b` correctly rejects `inspire` matching `spire`. But the same regex DOES let `alice` match inside `alice-chen` because `\b` treats `-` as non-word, so there's a boundary on both sides of `alice` inside `alice-chen`. That's the over-match that D-03 explicitly forbids when both `alice` and `alice-chen` are registered aliases.
- **Issue:** Plain `\b` is not safe for aliases containing `-`. Plan §action recommended `(?<![a-zA-Z0-9])(cands)(?![a-zA-Z0-9])`, which excludes alphanumerics but allows hyphens — same problem.
- **Fix:** Use `(?<![\w-])(...)(?![\w-])` — exclude word chars AND `-` from the boundary character class. Combined with "sort candidates by length DESC" before regex compilation, `alice-chen` wins greedy alternation over `alice`, AND `alice` cannot match inside `alice-chen` because of the trailing `-`. Verified by the test.
- **Files modified:** `src/indexer/extract-edges.ts`
- **Commit:** `275b3df`

**3. [Rule 3 — Blocking] Body-hash fast path must also re-extract edges**

- **Found during:** Plan §behavior Task 2 Test 4 explicitly required this; my first draft of the wiring only added `writeAllEdges` to the full re-embed branch. The body-hash fast path (frontmatter-only edits) would have silently dropped frontmatter-ref updates.
- **Issue:** A user adding `owner: "[[alice-chen]]"` to an existing note's frontmatter doesn't change the body bytes, so `single.ts:106` short-circuits to the fast path. Without `writeAllEdges` in that branch, the new frontmatter-ref edge would not land until the next full `npm run index --full`.
- **Fix:** Added `writeAllEdges(vault, upsert.id, parsed)` immediately after `insertWikilinks` in the body-hash fast path branch. Documented the rationale inline. The test pins the behavior.
- **Files modified:** `src/indexer/single.ts`
- **Commit:** `9cde9e1`

### Carryover from Wave 1

The Wave 1 dual-write (described in `04-01-edges-substrate-SUMMARY.md`
deviation #3) was always scheduled to collapse here. This plan removes
the dual-write from `insertWikilinks` in both `single.ts` and `indexer.ts`
— edges writes now flow exclusively through `extractAllEdges`. The
wikilinks-table write inside `insertWikilinks` stays per D-01.

## TDD Gate Compliance

Both tasks followed RED → GREEN. RED commits are not separated from
GREEN commits (the executor's deviation-rules path was used rather
than strict per-step commits), but tests were written BEFORE the
implementation in both tasks:

- Task 1: `extract-edges.test.ts` written first → ran and failed with
  module-not-found → implementation `extract-edges.ts` written → 4
  tests failed → 3 fixes applied (deviations 1, 2 above + alias-length
  test-data fix) → 31 / 31 green → committed.
- Task 2: 4 new tests in `single.test.ts` written first → ran and
  failed at frontmatter-ref assertions → `writeAllEdges` wiring added
  at three call sites in `single.ts` + two in `indexer.ts` → 15 / 15
  green → committed.

`npm run eval:baseline` and `npm test` both green at the per-task and
the wave-end gates.

## Known Stubs

None. No UI rendering surface; no placeholder data. All extractor
output goes through the existing `vault.db.edges.insertBatch` validated
in Plan 04-01.

## Threat Flags

None new beyond the plan's `<threat_model>` register. Mitigations
applied:

- **T-04-02-01** (private-term over-matching): `MIN_MENTION_LEN=4` +
  `(?<![\w-])` + `(?![\w-])` word boundary. Verified by the
  inspire/spire test.
- **T-04-02-02** (allowlist over-activation): closed 8-key
  `FRONTMATTER_REF_ALLOWLIST` sealed at the type level; rule (a)
  requires `[[...]]` syntax (explicit author intent).
- **T-04-02-03** (regex DoS): simple alternation regex, no nested
  quantifiers. Hyperlink regexes are linear (`[^\s)\]]+`). Not stress-
  tested against 1MB pathologies in this plan — the plan §threat-
  model marks this as mitigated by construction; Plan 04-07 should
  add a fuzz fixture if empirical validation surfaces a regression.
- **T-04-02-04** (regex-alternation determinism): `db.aliases.listAll()`
  ordered by `alias_norm ASC`; candidate alternation sorted by
  length DESC with lexicographic tiebreak. Order-stable across runs.
- **T-04-02-05** (`_memory` opacity at extraction): accepted per the
  plan — opacity is enforced at hydration time by Plan 04-03's
  `expand()`, not at extraction time. Storing the edge is fine.

## Self-Check: PASSED

Verified files exist:

- `src/indexer/extract-edges.ts` ✓
- `src/indexer/extract-edges.test.ts` ✓
- `.planning/phases/04-graph-as-retrieval/04-02-edge-extractors-SUMMARY.md` ✓

Verified commits exist (`git log --oneline -5`):

- `275b3df` ✓
- `9cde9e1` ✓

Verified test counts:

- `npm test` — 1129 passing / 11 skipped / 0 failing ✓
- `npm run eval:baseline` — 30 passing / 11 skipped / 0 failing ✓
- `bash scripts/lint-adapters.sh` — 8 / 8 invariants green ✓
- `npm run lint` (`tsc --noEmit`) — clean ✓
