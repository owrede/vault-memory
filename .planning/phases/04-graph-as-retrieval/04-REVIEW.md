---
phase: 04-graph-as-retrieval
reviewed: 2026-05-17T00:00:00Z
depth: standard
files_reviewed: 38
files_reviewed_list:
  - docs/v2/PHASE-4-SIGN-OFF.md
  - evals/v1-baseline/baseline.test.ts
  - scripts/lint-adapters.sh
  - src/adapters/source/conformance.test.ts
  - src/adapters/stub/assembly-fixture.test.ts
  - src/adapters/stub/assembly-fixture.ts
  - src/assembly/bundle.test.ts
  - src/assembly/bundle.ts
  - src/assembly/dossier.integration.test.ts
  - src/assembly/dossier.test.ts
  - src/db/database.ts
  - src/db/queries/aliases.ts
  - src/db/queries/edges.test.ts
  - src/db/queries/edges.ts
  - src/db/schema.ts
  - src/graph/__test_helpers__/atlas-live-fixture.ts
  - src/graph/cluster.integration.test.ts
  - src/graph/cluster.test.ts
  - src/graph/cluster.ts
  - src/graph/expand.integration.test.ts
  - src/graph/expand.test.ts
  - src/graph/expand.ts
  - src/graph/graph.test.ts
  - src/graph/graph.ts
  - src/graph/index.ts
  - src/indexer/extract-edges.test.ts
  - src/indexer/extract-edges.ts
  - src/indexer/indexer.ts
  - src/indexer/single.test.ts
  - src/indexer/single.ts
  - src/search/hybrid-expand.integration.test.ts
  - src/search/hybrid.test.ts
  - src/search/hybrid.ts
  - src/server.test.ts
  - src/server.ts
  - src/tool-registry.test.ts
  - src/tool-registry.ts
  - src/types.ts
findings:
  critical: 2
  warning: 7
  info: 4
  total: 13
status: blockers_resolved
fixes:
  CR-01:
    status: resolved
    commit: 45659c5
    artifact: migration 012 + widened idx_edges_unique + 5 regression tests
  CR-02:
    status: resolved
    commit: 06d45a0
    artifact: cluster() query-path requires `vault` on multi-vault setups + 4 regression tests
remaining:
  warnings: 7
  info: 4
  recommendation: triage in a follow-up gap-closure phase or close out individually
---

# Phase 4: Code Review Report

**Reviewed:** 2026-05-17
**Depth:** standard
**Files Reviewed:** 38
**Status:** blockers_resolved (CR-01 fixed in 45659c5, CR-02 fixed in 06d45a0; 7 warnings + 4 info remain)

## Summary

Phase 4 ("graph-as-retrieval") lands an `edges` table substrate, four edge
extractors, a typed-edge BFS (`expand`), Louvain `cluster`, and an additive
`search_hybrid({expand})` parameter. The adapter-seam discipline is good
(no `fs`/`path`/`gray-matter`/`chokidar` imports in the new graph or edge
modules), the SQL parameterization is safe (closed Zod-validated unions
for `EdgeType`; integer-only `noteId` lists), and the v1 byte-identity
guard in `hybridSearch` is correctly gated.

However the review surfaces **two BLOCKER-level correctness bugs** in
the `edges` UNIQUE-index design and a number of WARNING-level issues
around `_memory` opacity in the backward-traversal direction, cluster()
multi-vault behavior, and the seed-skip logic in `expand()`.

## Critical Issues

### CR-01: `edges.idx_edges_unique` drops legitimate non-duplicate rows for unresolved targets, frontmatter-ref relations, and multi-line mentions

**File:** `src/db/schema.ts:676-677`, `src/db/queries/edges.ts:132-136`

**Issue:** The unique index is

```sql
CREATE UNIQUE INDEX idx_edges_unique
  ON edges(source_doc, COALESCE(target_doc, -1), type, COALESCE(anchor, ''));
```

Missing from the conflict key: `target_path`, `rel`, and `line_number`.
Because `INSERT OR IGNORE` consults this index, three legitimate
distinct-edge scenarios collapse to a single row and the rest are
silently dropped:

1. **Broken / unresolved wikilinks from the same source to different
   targets.** Two body wikilinks `[[ghost1]]` and `[[ghost2]]` from
   note A both produce rows with `target_doc IS NULL`, `anchor IS NULL`,
   `type='wikilink'`, `source_doc=A`. The unique key collapses both
   to one row — the second is silently dropped on `INSERT OR IGNORE`.
   The v1 `wikilinks` table avoided this by including `target_path` in
   its UNIQUE key (`wikilinks (source_note, target_path, anchor)`, see
   `src/db/schema.ts:126`). Migration 011 backfills v1 wikilinks into
   `edges` using the new (narrower) key, so **broken-link data from
   existing vaults is lost on backfill** (only one broken target per
   `(source, NULL anchor)` survives). This regresses
   `findBrokenLinks` / `find_broken_links` recall.

2. **Multiple hyperlinks from the same source.** Every hyperlink row
   has `target_doc IS NULL`, `anchor IS NULL`, `type='hyperlink'`, and
   the same `source_doc`. The conflict key is identical across every
   hyperlink row from a given note — all but one are dropped. The
   `extractHyperlinkEdges` in-memory test passes (it tests pre-insert
   ordering, not DB persistence), but the DB only stores **one
   hyperlink edge per source note** regardless of how many URLs the
   note contains.

3. **Multiple `frontmatter-ref` edges to the same target with
   different `rel`.** A note with `{owner: "[[alice]]", assignee:
   "[[alice]]"}` produces two edges with `type='frontmatter-ref'`,
   `target_doc=alice.id`, `anchor IS NULL`, and `rel` differing
   (`"owner"` vs `"assignee"`). The conflict key collides; one is
   dropped. Phase 4's `expand()` is documented as filterable by `rel`
   (see `extract-edges.ts:248-258`); the silent drop means a downstream
   `expand({edge_types: ['frontmatter-ref'], filter_by_rel:...})` (or a
   brief compiler that walks `rel`) misses real relationships.

4. **Multi-line mention edges to the same target.** The in-memory
   `extractMentionEdges` dedups by `${targetNoteId}:${lineNumber}` —
   distinct lines produce distinct rows. On `INSERT OR IGNORE` they
   collide on `(source, target, type='mention', NULL anchor)` and only
   the first survives, throwing away the line-number provenance for
   the other occurrences.

**Why this was not caught by tests:**
`edges.test.ts:318-364` ("accepts all four edge types in one batch")
varies `type` per row so the conflict key is distinct.
`edges.test.ts:550-571` (`resolveBrokenLinks`) inserts ONE broken
edge. There is no test that asserts (a) two broken edges from the
same source-note coexist, (b) two hyperlinks from the same source
coexist, or (c) two frontmatter-ref edges from the same source to
the same target with different `rel` coexist.

**Impact:** Phase 4 `find_broken_links`, `expand` over hyperlinks,
brief-compilation over `rel`-classified relations, and multi-line
mention provenance are all under-counting. The doc comment in
`edges.ts:31-33` ("UNIQUE INDEX on `(source_note_id, target_note_id,
type, anchor)`") and the sign-off doc both restate this narrower key;
the BUG is structural, not a typo.

**Fix:** Widen the unique index to include the disambiguators:

```sql
CREATE UNIQUE INDEX idx_edges_unique
  ON edges(
    source_doc,
    COALESCE(target_doc, -1),
    COALESCE(target_path, ''),
    type,
    COALESCE(rel, ''),
    COALESCE(anchor, ''),
    COALESCE(line_number, -1)
  );
```

A new migration (012) is needed to:
1. drop `idx_edges_unique`,
2. de-duplicate any rows that were silently collapsed under the old
   key (or accept the data loss as v2.0.0 fait accompli and re-run
   the indexer in a follow-up),
3. recreate the wider index,
4. re-run the wikilink backfill to recover broken-link rows that were
   lost during migration 011.

Add the three regression tests above to `edges.test.ts` to pin the
fix.

---

### CR-02: `cluster()` query-path silently scopes to the first configured vault

**File:** `src/graph/cluster.ts:204-218`

**Issue:** When a caller passes `query` (rather than `seed_doc_ids`),
`cluster()` resolves seeds via `hybridSearch`. The vault scope passed
to `hybridSearch` is hard-coded to `deps.manager.list()[0]`:

```ts
const allVaults = deps.manager.list();
if (allVaults.length === 0) { ... }
const firstVault = allVaults[0];
...
const hits = await deps.hybridSearch(firstVault, opts.query, limit);
```

When the user has multiple vaults configured, this silently restricts
the clustering corpus to whichever vault happens to sort first in the
`VaultManager.list()` enumeration (insertion order). No warning, no
documentation, no Zod-level `vaults?: string[]` parameter to override.
The `query` path is therefore **non-deterministic across users with
different vault registration order** and silently incomplete on
multi-vault setups — the surface most likely to be hit in production.

The `seed_doc_ids` path correctly resolves vault from the first DocId
(`src/graph/cluster.ts:259-275`). The `query` path needs the same
explicit vault selection contract.

**Why this was not caught by tests:** all `cluster.test.ts` fixtures
use a single vault. Test 6 (`query` path composition) only asserts
that `hybridSearch` was called; it doesn't assert anything about
multi-vault scope.

**Fix:** Either (a) accept a required `vault: string` parameter on the
`query` path schema and reject when ambiguous, (b) fan out across all
configured vaults and aggregate hits before passing to `expand()`, or
(c) explicitly document the "first vault wins" semantics in
`cluster()` and the tool-registry description, and have the schema
reject the `query` path when multiple vaults are configured without a
`vault:` filter. The first option is preferred — it matches how
`recall` and `search_sections` handle the same constraint.

---

## Warnings

### WR-01: `expand()` self-loop guard skips ALL seeds, including unrelated seeds reachable as legitimate neighbors

**File:** `src/graph/expand.ts:349-365`

**Issue:** The BFS skips any candidate whose noteId is in
`state.seedNoteIdsInVault`. The rationale in the comment (lines 349-364)
acknowledges this conflicts with the multi-seed test 8 reading and
relies on a specific interpretation: "a seed is never a RESULT of
expand". This means if a caller passes seeds `[A, B]` and `A → B` is a
1-hop edge, B will NOT appear in `documents` even though it is a real
neighbor of A. This is a behavioral choice but not documented in the
tool surface (`tool-registry.ts:749-812` does not mention it). A user
seeding "give me everything around A and B" reasonably expects B in
the result when A→B exists. The current behavior silently elides it.

**Fix:** Either document the skip in the `expand` tool description
explicitly, or skip ONLY when `candidate.noteId === seed.noteId`
(direct self-loop) and let other-seed-as-neighbor surface naturally
with `via.seed_doc_id` recording the originating seed.

---

### WR-02: `_memory` opacity rule is asymmetric — backward traversal surfaces memory docs that CITE user notes

**File:** `src/graph/expand.ts:441-446`

**Issue:** The opacity check looks at the `inboundSourceNoteId` of the
edge in the BFS direction. With `direction: "backward"` (or `"both"`),
seed = user note `atlas-1`, and a memory doc `_memory/note-x` with a
wikilink `_memory/note-x → atlas-1`:

- The backward BFS step at `atlas-1` looks at backlinks (sources of
  edges TO atlas-1) and finds `_memory/note-x` as a candidate
  (`targetNoteId = row.sourceNoteId = _memory/note-x.id`).
- `inboundSourceNoteId` is set to `node.noteId = atlas-1` (line 376) —
  i.e., the user note.
- At hydration, the opacity check sees a `_memory` candidate with a
  non-memory `inboundSourceRow` → INCLUDED.

The semantic outcome: memory docs that cite user notes are
discoverable by backward traversal from those user notes. ADR-004's
intent — silent traversal through the memory namespace is forbidden —
arguably forbids this too (the user never voluntarily linked TO the
memory doc; it's the memory doc that reached out). Test 16 only
exercises forward direction; the asymmetry is untested.

**Fix:** Either tighten the rule so that opacity applies to memory
candidates regardless of edge direction (drop unless the EDGE
ORIGINATES in user space, i.e., for backward edges check the target
side, not the source side) — or document the asymmetry explicitly and
add a test.

---

### WR-03: `_memory` opacity precomputation does N+1 redundant DB lookups

**File:** `src/graph/expand.ts:405-410, 412-413`

**Issue:** The hydration loop pre-computes a `memoryVisited` set by
calling `state.vault.db.notes.getById(noteId)` on every visited node
(line 408). The same lookup is then repeated inside the main
hydration loop (line 413). This is O(2 × |visited|) DB calls when one
pass over `visited` could collect both the memory flag and the
`noteRow` simultaneously.

**Fix:** Combine into a single pass:

```ts
for (const [noteId, entry] of state.visited) {
  const noteRow = state.vault.db.notes.getById(noteId);
  if (!noteRow) continue;
  if (isMemoryPath(noteRow.path)) {
    const inboundSourceRow = state.vault.db.notes.getById(entry.inboundSourceNoteId);
    if (inboundSourceRow != null && isMemoryPath(inboundSourceRow.path)) continue;
  }
  // ... rest of hydration
}
```

Functionally identical, half the DB calls.

---

### WR-04: `expand()` re-resolves `sourceConnectorFor(vaultName)` and rebuilds `docId` once per visited node

**File:** `src/graph/expand.ts:449-456`

**Issue:** Inside the inner `for ... of state.visited` loop the code
calls `deps.sourceConnectorFor(state.vaultName)` and
`formatDocId(state.scheme, state.vaultName, noteRow.path)` for every
candidate. Both are vault-scoped invariants — they should be hoisted
above the inner loop. The `try/catch` IIFE wrapping
`sourceConnectorFor` is also re-evaluating exception handling on each
candidate.

**Fix:** Hoist the `source` resolution to once per vault outside the
candidate loop. If `source` is null/throws, skip all candidates in
that vault without per-candidate retries.

---

### WR-05: `cluster.ts` ClusterOptions type allows the `force` field to bypass the seed-cap check via the `query` path

**File:** `src/graph/cluster.ts:87-100, 301-310`

**Issue:** The `ClusterOptions` discriminated union allows `force` on
both branches. The hard-cap check at lines 302-310 fires AFTER both
the `expand()` call and the seed→note resolution. For the `query`
path, the `force` flag does NOT short-circuit the expansion: a
caller passes `query` + a huge `query_top_k`, the search returns
hits, `expand({hops:1, both})` runs over them and may produce a
large neighborhood, only THEN does the 5000-cap fire. The cap is
intended as a DoS guard for Louvain — but the work-amplifying
`expand()` call has already happened.

For the `seed_doc_ids` path, the cap also runs only AFTER `expand()`
has returned, so the same problem exists there.

**Fix:** Apply a quick pre-flight check on `seedDocIds.length` (and
on `query_top_k`) before invoking `expand()`. If `seeds + estimated
1-hop fan-out > NODE_CAP` and `!force`, return early without doing
the work. Alternatively, pass a `maxNodes` hint into `expand()` so it
can bail when the candidate set grows past the cap.

---

### WR-06: `extractMentionEdges` regex is rebuilt on every note instead of cached per indexer run

**File:** `src/indexer/extract-edges.ts:178-198`

**Issue:** `buildMentionCandidateSet` and the alternation regex
(`new RegExp(...)`, line 198) are constructed once **per note** in
the indexer hot path. The alias inventory (`vault.db.aliases.listAll()`)
is queried once per note, and the regex compile cost (sorting +
escaping + alternation building) is paid per note. For a vault with N
notes and A aliases, this is O(N × A) repeated work — significant on
full-vault indexing of a 60+-note Atlas fixture, much worse on real
vaults with thousands of notes.

**Fix:** Hoist the candidate set + regex construction up one level
into `extractAllEdges` callers (`indexer.ts`'s per-vault loop), or
add a per-indexer-run cache. The doc comment at line 31-33 of
`extract-edges.ts` claims "Candidate set built once per indexer run"
— the implementation doesn't match.

---

### WR-07: `Database.migrateInternal` swallows post-commit FK violations into a throw, but the migration is already committed

**File:** `src/db/database.ts:138-143`

**Issue:** After running migrations inside `db.transaction(...)`, the
code runs `PRAGMA foreign_key_check` and throws if violations exist.
The comment acknowledges the migration is already committed; throwing
here leaves the DB in a half-migrated state (schema applied, FKs
known-broken) and a subsequent open() may NOT re-run the migration
because `user_version` was bumped. This is a pre-existing v1 pattern
but Phase 4's migration 011 widens the FK surface (`source_doc
REFERENCES notes(id) ON DELETE CASCADE`, `target_doc REFERENCES
notes(id) ON DELETE SET NULL`) so the failure mode is now reachable
by 04-01 backfill if the source `wikilinks` rows reference a
deleted-but-not-cascaded `note_id`.

**Fix:** Run `PRAGMA foreign_key_check` inside the transaction and
rollback on violation. Or accept that the migrations are append-only
and explicitly document the half-migrated recovery path (e.g., a
`vault-memory repair-db` CLI subcommand).

---

## Info

### IN-01: Doc/code drift on unique-index columns

**File:** `src/db/queries/edges.ts:31-33`, `docs/v2/PHASE-4-SIGN-OFF.md:121`

The class-level JSDoc on `EdgesQueries` and the Phase 4 sign-off
document both state `UNIQUE INDEX on (source_note_id, target_note_id,
type, anchor, line_number)`. The actual index (schema.ts:676-677) is
`(source_doc, COALESCE(target_doc, -1), type, COALESCE(anchor, ''))`.
Even setting aside the BLOCKER above, the docs and code disagree on
what the unique key IS. Update both to the chosen real key once
CR-01 is resolved.

---

### IN-02: `expand` self-loop logic has an in-source TODO-style hedge

**File:** `src/graph/expand.ts:355-365`

The comment block reads like the author wasn't fully decided on the
behavior ("Spec is ambiguous; the safer reading is..."). This kind
of in-source design-decision narrative is fine in plans but should
not survive into production source. Either lock the behavior with a
clear one-line invariant in the code + a unit test, or escalate the
ambiguity into the tool description.

---

### IN-03: Hyperlink regex lookbehind `(?<![\(\[a-zA-Z0-9])` rejects legitimate URL contexts

**File:** `src/indexer/extract-edges.ts:363`

`BARE_URL_RE = /(?<![\(\[a-zA-Z0-9])https?:\/\/[^\s)\]]+/g` excludes
URLs preceded by any alphanumeric character. While this prevents
matching the URL embedded inside a markdown link's text (e.g.
`[https://x](https://y)`), it also rejects unusual but legal prose
patterns like `seehttps://example.com` (no space — rare but seen in
diff output and chat-transcript dumps). Acceptable trade-off, but
worth a one-line code comment.

---

### IN-04: `expand()` is async, but its only async surface is `source.readDocument` per candidate (N round-trips serialized)

**File:** `src/graph/expand.ts:458-463`

For each visited candidate, `expand()` awaits `source.readDocument`
serially. For a 50-document expansion, that's 50 sequential awaits.
The reads can be parallelized with `Promise.all` over the visited
batch (the source connector for `obsidian-fs` is local file I/O,
which benefits modestly from parallelism; future remote-source
connectors will benefit enormously). Out of v1 perf scope per review
guidelines but flagged for Phase 5+ awareness.

---

_Reviewed: 2026-05-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
