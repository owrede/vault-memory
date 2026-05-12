---
name: triage-inbox
description: Walks through recently created "inbox" notes (sparse frontmatter, few tags, short body, recent mtime) and helps the user file each one — move to a target folder, add tags, link to related notes, fill out frontmatter. Per-note confirm. Never moves/edits without explicit OK. Use when the user says "/triage-inbox", "triage", "process inbox", "Inbox aufräumen", "neue Notes durchgehen", "filing".
---

# /triage-inbox — Process Inbox-Stage Notes

A guided workflow that helps you take messy, freshly-captured notes and integrate them into your vault's structure. Identifies "inbox" notes via heuristics OR explicit folder, and for each one proposes a triage action with a default — you accept, modify, or skip.

## When to invoke

- User runs `/triage-inbox` (primary)
- User says "triage", "process inbox", "Inbox aufräumen", "neue Notes durchgehen", "file these new notes", "wo soll diese Note hin"
- After a capture-burst (e.g., importing voice memos, web clippings, meeting transcripts)

## Requirements

- `mcp__vault-memory__*` tools available
- Vault registered with `write_enabled: true` (the skill writes — refuses otherwise)
- Vault recently indexed (warn if `indexed_at` > 24h old)

## Inbox detection

The skill identifies "inbox" candidates by combining BOTH paths — the user can override at invocation:

### Path A — explicit folder (preferred when available)

If the user specifies `--folder=<path>` OR the vault config has an `inbox_folder` convention, use `query_frontmatter({where: {path: {$exists: true}}, limit: 1000})` and client-side-filter to notes whose `path` starts with that folder prefix.

### Path B — heuristic (fallback)

Pull `recent_notes({limit: 50, since: <now - 14 days>})` then keep notes that pass ALL of:

1. **Sparse frontmatter**: ≤1 frontmatter key (or none at all)
2. **Few tags**: 0 or 1 tag
3. **Short body**: word_count < 300
4. **No wikilinks out**: optional — `list_forward_links({vault, path}).length === 0`

This catches the typical "captured-quickly-never-developed" pattern.

### Filter mode

Default: **heuristic** if no folder specified. Show counts for both ("found 14 by heuristic, 22 in Inbox/") and let the user pick.

## Workflow

### Phase 1 — Detect

Show:

```markdown
## Inbox candidates: <N>

Heuristic (last 14 days, sparse frontmatter, <300 words): <n_h>
Folder `Inbox/`: <n_f>

Process: [h]euristic / [f]older / [b]oth / [c]ustom-folder / [n]o-thanks
```

### Phase 2 — Per-note triage

For EACH candidate, show:

```markdown
Note <i>/<N>: <path>
Created: <date> · Words: <count> · Tags: <list or "—">
Frontmatter keys: <list or "none">

<preview: first 20 lines>

--- Suggested filing ---
Target folder: <inferred>           ← see "Inference" below
Tags to add:   <inferred list>
Frontmatter:   <inferred fields>
Wikilinks:     <inferred related — top 3 semantic matches>

Action?
  [accept] Apply all suggestions as shown
  [edit]   Modify the suggestions before applying
  [tags]   Only add the suggested tags (skip move + frontmatter)
  [move]   Only move to the suggested folder (skip tags + frontmatter)
  [link]   Only add the suggested wikilinks
  [skip]   Leave the note where it is, move on
  [back]   Re-show the previous note's outcome
  [quit]   Stop the triage, print summary
```

### Inference rules (suggestions are heuristic — user always confirms)

**Target folder**:
- If the note title matches a known person name → `Personen/` (or `Netzwerk/Personen/` if such a folder exists)
- If the note title mentions a meeting/treffen/call → `<existing meetings folder>` (detect via top_frontmatter_keys having `participants` or `meeting_date`)
- If the note has "TODO" or "task" in body → `Tasks/` (or vault's task folder convention)
- Else: suggest the folder where the **best semantic match** lives (via `search_semantic({query: <note body summary>, top_k: 1})`)

**Tags**:
- Detect inline hashtags in body → suggest as frontmatter tags
- Run `search_semantic({query: <body summary>, top_k: 5})` and take the most-common tag across top-5 matches → suggest

**Frontmatter**:
- If the suggested target folder has notes with a consistent schema (top frontmatter keys), suggest those keys with placeholder values
- Pattern: `class: <folder-default>`, `created: <YYYY-MM-DD>`, `tags: [<suggested>]`

**Wikilinks**:
- Top 3 results from `search_semantic({query: <body summary>, top_k: 3, exclude_paths: [<current-path>]})` — show as candidates, user accepts/rejects each

### Phase 3 — Apply

When user picks `[accept]` or `[edit]`-then-confirms:

1. **Update frontmatter** (if any) via `update_frontmatter({vault, path, merge: {...}})`
2. **Add wikilinks** by re-writing the note's body via `write_note` — append a "Related" section if not present, list each new wikilink on its own line
3. **Move** by `write_note` to the new path + `delete_note` on the old (hash-protected). This is a two-step atomic-ish operation — if the write fails, abort and don't delete.

All operations are hash-protected: read the note's current `hash` before mutation, pass `expected_hash` to `update_frontmatter` / `write_note` / `delete_note`. Concurrent-edit errors halt the triage of this one note with a clear message; user can `[skip]` or re-fetch and retry.

### Phase 4 — Summary

```markdown
## Triage Summary
- Reviewed: <N>
- Moved: <n_m>
- Tagged-only: <n_t>
- Linked-only: <n_l>
- Fully filed: <n_f>
- Skipped: <n_s>

Vault state after triage:
- <inbox folder> went from <X> to <Y> notes
- <other folder> gained <delta> notes
```

## Safety & write rules

- **Never bulk-apply** without per-note confirmation. The `[accept]` action applies to ONE note, then moves on.
- **Hash-protect every mutation**. Stale hashes (concurrent edit) abort just that one note.
- **Move atomicity**: write new before delete old. If write fails, no destructive change.
- **`write_enabled: false` aborts the skill** with a clear message — read-only vaults can't be triaged.

## Bilingual

If the user opens in German, respond throughout in German. The action keywords stay ASCII for keystroke economy. Vault-internal labels (folder names, tag names) are NEVER translated.

## Out of scope

- Auto-classification training (this skill uses heuristics, not learned models)
- Bulk-tag-from-pattern (`/sync-tags` is a separate concern)
- Multi-vault triage in one run (one vault per invocation)
- Note splitting / merging (capture-stage decisions, not triage-stage)

## Hand-off to other skills

If during triage the user realizes a candidate is actually a meeting note: suggest `/clean-meetingnotes` and let the user re-invoke for that one note. The triage skill itself does not absorb specialized cleanup work — it routes.
