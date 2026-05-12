---
name: audit-vault-health
description: Read-only Vault-Health-Audit. Aggregates vault_stats, scans broken wikilinks, detects tag-inconsistencies (case/separator drift), and surfaces frontmatter schema drift (same key with different value types). Produces a structured Markdown report inline. Pure read — never writes notes. Use when the user says "/audit-vault-health", "vault health", "audit my vault", "check vault consistency", "Vault-Gesundheit", "Vault auditieren".
---

# /audit-vault-health — Vault Health Audit

A read-only diagnostic that produces a structured report on five dimensions of vault hygiene. Useful before major migrations, on a quarterly cadence, or when something feels "off" but isn't pinpointable.

## When to invoke

- User runs `/audit-vault-health` (primary trigger)
- User says "audit my vault", "check vault consistency", "vault health", "Vault-Gesundheit prüfen", "Was ist im Vault kaputt?"
- After a bulk import or migration, before relying on vault-memory search

## Requirements

- `mcp__vault-memory__*` tools available in the session
- At least one vault registered

## What the audit reports

The audit produces **five sections**, each derived from one or two MCP tool calls. Every finding is presented with a count and the top 3-5 examples so the user can decide whether to act.

### 1. Overview (from `vault_stats`)

- Vault name, path, total notes, total words, embedding model
- Last index run timestamp + "freshness" classification:
  - **Fresh**: indexed_at within last 24h
  - **Stale**: 1–7 days
  - **Cold**: >7 days (recommend `vault-memory index` or trigger a save)
- Top 5 tags + count
- Top 10 frontmatter keys + count (used as schema reference in section 5)

### 2. Broken wikilinks (from `find_broken_links`)

- Total broken count
- Top 5 broken targets (paths) with backlink count for each (indicating impact)
- Categorize:
  - **Likely typos** — broken target has a near-match in the vault (Levenshtein distance ≤ 2). Show the suggested fix.
  - **Likely deletions** — broken target has no near-match; the target was probably moved/deleted.
  - **Possibly new** — broken target looks like a forward-reference (e.g., a TODO note that hasn't been created yet).

### 3. Tag drift (from `vault_stats.top_tags` + custom)

Surfaces tags that are *semantically the same* but written differently. Heuristic: normalize each top-tag via:

```
norm(t) = t.toLowerCase().replace(/^#/, "").replace(/[-_\s]/g, "")
```

Group tags by their normalized form. Any group with >1 distinct raw form is a drift candidate.

Report each drift cluster: `{raw forms} → recommended canonical (highest-count variant)`.

Note: `vault_stats.top_tags` only returns the top 10. If the user wants exhaustive coverage, suggest re-running with a higher limit (this skill stays within the default for speed).

### 4. Frontmatter schema drift (from `query_frontmatter`)

For each of the top 5 frontmatter keys reported by `vault_stats.top_frontmatter_keys`:

1. Run `query_frontmatter({where: {<key>: {$exists: true}}, limit: 200})`
2. Inspect each note's value for that key; collect the **value-type** (`string`, `number`, `boolean`, `array`, `object`).
3. If >1 type appears for the same key across notes → schema drift.

Report: `<key>: 142 string + 4 array + 1 number → suggests review`.

### 5. Indexing health (from `list_vaults` + `index_runs`)

- Last index run status (success/error) per vault
- Note count delta vs. file count on disk (if observable through `list_vaults`)
- Any vault with `error != null` on its last run → highlight prominently

## Output format

The skill produces inline Markdown (no file written by default). Structure:

```markdown
# Vault Health Audit — <vault name> — <ISO date>

## Overview
- 200 notes, 102k words
- Indexed 2h ago — **fresh** ✓
- Embedding model: bge-m3

## Broken Wikilinks: 4
| Target | Backlinks | Suspected cause |
|--------|-----------|-----------------|
| Personen/Jorg | 3 | typo (→ Personen/Jörg, distance 1) |
| INIM-PROJEKTE/2024-Frühling | 1 | deleted (no near-match) |

## Tag Drift: 2 clusters
- `ki-cluster` (9) + `KI-Cluster` (1) + `#ki-cluster` (1) → recommend `ki-cluster`
- `network` (10) + `Network` (2) → recommend `network`

## Frontmatter Schema Drift: 1 finding
- `status`: 84 string + 2 array → review the 2 array-typed notes

## Indexing
- All vaults indexed cleanly. Last run 2h ago.

## Suggested next steps
1. Fix typos in 2 broken wikilinks
2. Normalize 2 tag clusters with /sync-tags (if available) or manual edit
3. Decide whether `status` should always be string

End of audit.
```

## Behavioral rules

- **Never write** — this skill is read-only. No `write_note`, no `update_frontmatter`, no `delete_note`.
- **Never suggest destructive actions without user prompt** — the report ends with "suggested next steps" but does NOT execute them.
- **Be honest about coverage limits** — top_tags is limited to 10 by `vault_stats`; broken-link near-match is Levenshtein-only (won't catch semantic equivalents).
- **Bilingual support** — if the user invokes in German, respond in German. Match the user's language throughout.

## Concrete invocation flow

```
1. Call mcp__vault-memory__vault_stats({}) — get overview + top tags/keys per vault
2. For each vault in the response:
   a. Call mcp__vault-memory__find_broken_links({vault}) — get broken links
   b. For each top frontmatter key, call mcp__vault-memory__query_frontmatter({vault, where: {<key>: {$exists: true}}, limit: 200})
3. Compute tag drift via the normalization heuristic
4. Compute frontmatter type-drift by inspecting query_frontmatter results
5. Emit the structured Markdown report inline
```

Total tool calls: 1 (`vault_stats`) + N × (1 `find_broken_links` + 5 `query_frontmatter`) for N vaults. For 1 vault, that's 7 calls — fast (<5s typical).

## Out of scope (deliberately)

- Note-content-level audits (broken markdown, malformed code blocks, etc.)
- Embedding-quality audits (covered by `_research/vault-memory-eval-*.md` workflow, not by this skill)
- Cross-vault duplicate detection (could be future v0.10+ work)
- Auto-fix mode (would require `--write` mode + a confirm flow per fix)
