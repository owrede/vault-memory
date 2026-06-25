# ADR-032 — Duplicate section anchors: collapse, do not suffix

**Status:** Accepted
**Date:** 2026-06-25
**Phase:** v2.x
**Supersedes:** —
**Superseded by:** —
**Related:** ADR-003 (Document shape — H-7 anchor contract), ADR-004 (Memory sink / D-05 source_hashes).
External: `ISSUE-indexer-duplicate-anchor.md`, `ISSUE-migration-010-duplicate-anchor.md` (both archived).

---

## Context

Two notes-with-repeated-headings issues (migration backfill + live indexer) were
fixed with a minimal `INSERT OR IGNORE` + `insertOneResolving()` approach: when a
note contains two sibling sections that produce the **same** `(note_id, anchor)`,
the first sibling wins the `UNIQUE` slot and later identical siblings collapse into
it for `parent_id` linkage.

Both issues flagged a "better fix": dedupe anchors at the source in
`extractSections()` by suffixing repeated slugs GitHub-style (`notes`, `notes-1`,
`notes-2`) so every sibling persists as a distinct row.

This ADR decides whether to pursue that suffixing fix.

## Decision

**We keep content-hash anchors and reject positional suffixing.** The
`INSERT OR IGNORE` collapse is the canonical, design-consistent behavior.

## Rationale

1. **Suffixing violates ADR-003 H-7.** H-7 defines `anchor` as exactly
   `sha256(NFC(heading_text) || "\n" || render_blocks_to_plain_text(blocks))` — a
   pure **content** hash. A positional `-1`/`-2` suffix makes the anchor depend on
   document *position*, not content, breaking the H-7 contract.

2. **H-7 anchors double as `source_hashes` (D-05).** Phase 5 briefs consume section
   anchors directly as content-addressable source hashes. Two byte-identical
   sections SHOULD share one hash — that is the point of content addressing. Forcing
   them apart with a positional suffix would mint two distinct "sources" for
   identical content.

3. **Collapse is semantically correct.** Two sibling sections with identical heading
   AND identical body are, for retrieval/citation purposes, the same content. A note
   that repeats `## Anti-Patterns\n- don't do X` twice has one piece of information,
   not two. Surfacing it once is the right answer; the first-sibling-wins rule is a
   stable, deterministic choice of which row carries it.

4. **The crash — the only real defect — is already fixed.** `INSERT OR IGNORE`
   removes the `SQLITE_CONSTRAINT_UNIQUE` abort. Suffixing buys only the (rarely
   useful) ability to address the second identical sibling separately, at the cost of
   the ripples below.

## Consequences

### Positive
- ADR-003 H-7 stays intact; no identity-scheme change; no eval/snapshot re-baseline.
- `search-sections.ts` dedup keyed on `(noteId, anchor)` remains correct.
- The `mentions` edge resolving `[[Note#anchor]]` keeps a stable content target.

### Negative / accepted
- A note with two byte-identical sibling sections exposes only the first via
  sections. Acceptable: identical content is one citation. (Note: sections that
  share a heading but differ in body already get distinct anchors and are
  unaffected — only byte-identical siblings collapse.)

### If this is ever revisited
Reopening suffixing requires amending H-7 (anchor = content-hash) and auditing the
`source_hashes`/brief consumers, `search-sections` dedup, and the `mentions` edge
resolver. That is a deliberate, breaking identity change and must be its own ADR.
