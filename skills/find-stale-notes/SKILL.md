---
name: find-stale-notes
description: Find notes that look abandoned — older than 6 months AND with 0 backlinks. Produces a sortable table and walks through each candidate with per-note action choices (Archive / Update / Delete / Skip / Done — leave-as-is). Never auto-acts — every change requires explicit user OK. Use when the user says "/find-stale-notes", "stale notes", "find unused notes", "veraltete Notes", "Notes aufräumen", "find orphans".
---

# /find-stale-notes — Discover Abandoned Notes

A vault-cleanup aid. Identifies notes that are old AND have nothing linking to them — the most likely candidates for archive/delete. Conservative by default (moderate criteria, see below); presents candidates as a table; never deletes without explicit per-note confirmation.

## When to invoke

- User runs `/find-stale-notes` (primary)
- User says "stale notes", "unused notes", "orphan notes", "veraltete Notes", "Notes aufräumen", "find orphans", "what can I delete?"
- After a vault-import to surface notes that didn't get re-linked

## Stale criteria (moderate by default)

A note is a stale candidate when **BOTH** hold:

1. `mtime` older than **6 months** (180 days) before now
2. `list_backlinks(path).length === 0` — no other note in any vault links to it

Optional tighten/loosen via the first user message:
- "konservativ" / "conservative" → require also `tags.length === 0` AND `frontmatter === null`
- "aggressiv" / "aggressive" → relax to 3 months + 0 backlinks (warn user about higher false-positive rate)

## Requirements

- `mcp__vault-memory__*` tools available
- Vault registered, recently indexed (suggest a save if indexed_at is >7d old)

## Workflow

### Phase 1 — Candidate gathering

1. Choose target vault. If multiple vaults are configured: ask "audit which vault?" (default: active vault from env, else all).
2. Fetch ALL notes via `query_frontmatter({where: {path: {$exists: true}}, limit: 2000})` — this returns every note in the vault since every note has a path. Sort the result by mtime ascending (oldest first).
3. Compute the cutoff: `cutoff = now - 180 * 24 * 60 * 60 * 1000` (ms epoch).
4. Filter to notes with `mtime < cutoff`. If 0 candidates: report "no notes older than 6 months — nothing to triage" and exit.
5. For each remaining candidate, call `mcp__vault-memory__list_backlinks({vault, path})`. Keep only those with `backlinks.length === 0`.
6. Produce the **candidate table**.

### Phase 2 — Present the table

```markdown
## Stale candidates: <N>

| # | Path | Last modified | Word count | Tags | Backlinks |
|---|------|---------------|------------|------|-----------|
| 1 | _archive/2024-Q1-notes.md | 2024-03-15 (14 months ago) | 247 | — | 0 |
| 2 | Inbox/old-todo.md | 2024-08-02 (9 months ago) | 18 | — | 0 |
| 3 | Personen/abandoned-contact.md | 2024-09-10 (8 months ago) | 92 | network | 0 |
| ...

Total: 12 candidates. Proceed with per-note review? [yes/no/limit-to-N]
```

If the list is long (>10), default to reviewing the **oldest 10** first. The user can ask for more after.

### Phase 3 — Per-note review

For EACH candidate in order, do:

1. Show the note's content preview via `mcp__vault-memory__read_note({vault, path})` — first 30 lines, plus the frontmatter block.
2. Present an action menu:

```
Note <i>/<N>: <path>
Modified: <date> · Words: <count> · Frontmatter: <key1, key2 or "none"> · Backlinks: 0

<preview snippet>
...

Action?
  [a] Archive   — move to _archive/<original-path>
  [u] Update    — open for editing (placeholder; the skill itself won't edit)
  [d] Delete    — permanent removal via delete_note (requires confirm again)
  [s] Skip      — leave as-is, exclude from this run
  [k] Keep      — leave as-is, mark as "still wanted" (touch mtime so next audit skips it for 6 more months)
  [q] Quit      — stop the review, summary will list remaining unreviewed candidates
```

3. Apply the chosen action:

- **Archive**: call `mcp__vault-memory__write_note` to a new path under `_archive/`, then `delete_note` on the original. Requires `vault.write_enabled = true` — check and abort if not.
- **Delete**: re-confirm ("really delete `<path>` permanently? y/N"). On yes, fetch the note's `hash` first (`read_note`), then `delete_note({vault, path, expected_hash})`.
- **Skip / Quit**: no DB or FS changes.
- **Keep**: call `mcp__vault-memory__update_frontmatter({vault, path, merge: {last_audited: "<ISO date>"}})` — touches mtime, marks the note as reviewed. Subsequent audits will treat it as fresh for 6 months. (This is also the **byte-cheapest** v0.9.1 path — body unchanged, body_hash short-circuit fires.)

### Phase 4 — Summary

After the loop (whether by completing all candidates or by `q`):

```markdown
## Audit Summary
- Reviewed: <N>
- Archived: <n_a>
- Deleted: <n_d>
- Marked-keep: <n_k>
- Skipped: <n_s>
- Unreviewed (left for next time): <remaining>

Total reduction: <archived + deleted> notes removed from active vault.
```

## Safety rules

- **Never auto-delete**. Every `[d]` requires a second confirmation ("really delete? y/N").
- **Hash-protected deletes**: always pass `expected_hash` to `delete_note` so concurrent edits raise an error instead of silently dropping a freshly-edited note.
- **Respect write_enabled**: if the target vault is read-only (`write_enabled: false` in config), refuse to offer Archive/Delete/Keep actions; only Skip + Quit are available.
- **Path safety**: archive paths must stay inside the vault. Reject any `..` traversal in the user's archive folder configuration.

## Bilingual

If the user opens in German, respond throughout in German. The action keys ([a/u/d/s/k/q]) stay ASCII because they're shortcuts, but the prompts and labels translate.

## Out of scope

- Bulk-delete-all (the per-note confirm is the safety contract — no `--yes-to-all` flag)
- Recommendations for re-linking (could be future work — pair-with-related semantic-search to suggest where to link a stale note)
- Cross-vault stale detection (one vault at a time keeps the workflow tight)
