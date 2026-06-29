# ADR-032 — Section identity is content + context (note_id, heading_path, anchor)

**Status:** Accepted (revised 2026-06-28)
**Date:** 2026-06-25 (original), 2026-06-28 (revised)
**Phase:** v2.x
**Supersedes:** —
**Superseded by:** —
**Related:** ADR-003 (Document shape — H-7 anchor contract), ADR-004 (Memory sink / D-05 source_hashes).
External: `ISSUE-indexer-duplicate-anchor.md`, `ISSUE-migration-010-duplicate-anchor.md` (both archived). Implemented by migration 015.

---

## Context

Two notes-with-repeated-headings issues (migration backfill + live indexer) were
first fixed with `INSERT OR IGNORE` against a `UNIQUE(note_id, anchor)` index:
when two sibling sections produced the same content-hash anchor, the first won and
later ones collapsed into it.

**The original version of this ADR ratified that collapse.** That was wrong. The
anchor is `sha256(heading_text + "\n" + body)` and deliberately **excludes the
`heading_path`** (the ancestor chain). So two sections collapsed even when their
context differed entirely:

```
# Q1 Planning  →  ## Risks  →  "TBD"
# Q2 Planning  →  ## Risks  →  "TBD"
```

Same heading + same body → same anchor → **the Q2 risk was silently dropped**,
even though it is a different risk in a different quarter. Identity was being
computed from *less context than the data actually carries* (`heading_path` is
stored on every row but was not part of the key).

## Decision

**A section's identity is its content AND its location/context.** The unique key
becomes `(note_id, heading_path, anchor)` (migration 015). `anchor` stays a pure
content hash — ADR-003 H-7 and the D-05 `source_hashes` contract are unchanged.

Two byte-identical sections in **different contexts** (different `heading_path`)
now persist as **distinct rows**. Two byte-identical sections in the **same
context** (same `heading_path` — a verbatim block repeated under the same parent)
still collapse; that is genuinely duplicated content in one place.

## Rationale

1. **Different context = different section.** A repeated heading under a different
   parent is a different thing. Treating `Q1 > Risks` and `Q2 > Risks` as one
   citation loses real information. This is the user-facing correctness fix.

2. **H-7 stays intact.** We did NOT change `anchor` (rejected the
   `notes-1`/`notes-2` positional-suffix idea, which *would* have broken H-7 by
   making the anchor position-dependent). `anchor` remains the content hash that
   briefs consume as `source_hashes`; we only widened the DB row's UNIQUE key.

3. **`heading_path` over `ord`.** Context is captured by the ancestor chain
   (semantic) rather than positional ordinal. This is stable under section
   reordering/insertion, whereas `ord` would churn identity on edits.

4. **The crash is still fixed.** `INSERT OR IGNORE` + `insertOneResolving()`
   (now keyed on the full identity) keeps the index run from aborting on a true
   same-context collision.

## Consequences

### Positive
- Differently-placed identical sections are retained and separately citable.
- `anchor` unchanged → no eval/snapshot re-baseline for content hashing; briefs’ `source_hashes` unaffected.
- `search-sections.ts` dedup key widened to `(note_id, heading_path, anchor)` so identical-but-differently-placed sections don't merge in search results either.

### Negative / accepted
- A verbatim block repeated under the *same* parent still collapses to one row. Acceptable — that is duplicated content in one context.
- Existing DBs migrated before a full re-index may still carry rows collapsed under the old key; migration 015 swaps the index but cannot resurrect siblings dropped earlier. The next `index --full` regenerates them correctly.

### Implementation
- Migration 015: drop `sections_note_anchor`, create unique `sections_note_headingpath_anchor` on `(note_id, heading_path, anchor)`.
- `SectionsQueries.insertOneResolving` + `backfill.ts` resolve collisions by the full identity.
- `search-sections.ts` dedup key includes `heading_path`.
- The `mentions` edge resolving `[[Note#anchor]]` does NOT look sections up by anchor (`extract-edges.ts` only strips the `#anchor` text suffix), so it is unaffected.
