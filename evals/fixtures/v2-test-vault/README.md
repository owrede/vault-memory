# Atlas Robotics — v2 Eval Fixture Vault

Atlas Robotics is a small fictional robotics startup that serves as the narrative
substrate for the v2 eval suite. The cast: three founders — **Alice Chen** (CEO),
**Bob Martinez** (CTO), **Carlos Yim** (Lead Engineer) — and three product threads:
**Atlas-1** (the flagship general-purpose robot), **Spire** (a warehouse-ops
product line), and **Beacon** (an R&D side bet). The team runs a 2026-Q2 OKR
cycle and recently executed a **pivot decision on 2026-03-12** from consumer to
warehouse focus. The narrative is fictional on purpose — it keeps maintainer
time on note *shape* rather than fact research, and per RESEARCH Pattern 3 we
prioritize realism of structure over volume of content.

## Folder map

| Folder | Purpose |
| --- | --- |
| `projects/` | Active product threads — Atlas-1, Spire, Beacon and sub-projects. Frontmatter: `title`, `status`, `owner`, `created`. |
| `meetings/` | Meeting notes dated `YYYY-MM-DD-<slug>.md` with agenda, decisions, action items. Frontmatter: `title`, `date`, `attendees`, `created`. |
| `people/` | One note per person — bio, role, ownership. Frontmatter: `title`, `role`, `joined`, `created`. |
| `decisions/` | Decision records dated `YYYY-MM-DD-<slug>.md`. Frontmatter: `title`, `date`, `status`, `created`. |
| `references/` | Specs, BOMs, external links, glossaries. Frontmatter: `title`, `kind`, `created`. |
| `_memory/` | Agent-authored memory namespace per ADR-004. Every note carries the seven MEMORY_CONTRACT properties. Sentinel: `.memory-sink`. |
| `_queries/` | Hand-labeled query fixtures (one YAML per eval surface). NOT indexed as content; consumed by the eval harness. |

## Note count target

- **Total target:** 50–110 markdown notes across the five top-level narrative folders (CONTEXT target ~75).
- **`_memory/` target:** ~20 notes (Claude scaffolds ~15; maintainer may add).
- **`_queries/` target:** 7 YAML files (one per eval category) with ≥3 entries each at Phase 0 baseline; maintainer extends in Task 4.

The 50-note floor is enforced at Task 4 of the fixture plan — Claude scaffolds 5
example notes and the maintainer hand-authors the rest per D-08.

## Authoring conventions

- **Filenames:** kebab-case (`alice-chen.md`, `2026-04-15-q2-okr-review.md`). Date
  prefix `YYYY-MM-DD-` for time-bound notes (meetings, decisions, status updates).
- **Frontmatter:** YAML, required on every note. Minimum key is `title:` matching
  the H1 heading. `_memory/` notes additionally require all seven MEMORY_CONTRACT
  keys: `source`, `confidence`, `evidence`, `status`, `observed_at`,
  `superseded_by`, `type`.
- **Wikilinks:** cross-references use `[[wikilink]]` form. Target paths are
  vault-relative without the `.md` extension (Obsidian convention). It is fine for
  a wikilink to point at a note that does not yet exist — the maintainer fills
  in dangling links in Task 4.
- **PII / copyright:** no real personal names, no real company names beyond Atlas
  Robotics (fictional), no copyrighted text. The CI privacy lint at plan 00-12
  enforces this.
- **No LLM artifacts:** no "as a large language model", no "I cannot…"
  disclaimers, no over-cautious hedging. Notes should read as written by a
  human team-member.

## Status

| Subset | Authored by | Count | Notes |
| --- | --- | --- | --- |
| `README.md` | Claude (00-09 Task 1) | 1 | This file. |
| 5 narrative example notes (one per top-level folder) | Claude (00-09 Task 2) | 5 | Templates for the maintainer. |
| `_memory/` subset | Claude (00-09 Task 3) | ~15 | Agent-output simulation; allowed to be LLM-drafted by nature. |
| 7 `_queries/*.yaml` files | Claude (00-09 Task 3) | 7 × ≥3 entries | Baseline; maintainer extends in Task 4. |
| Remaining 45+ narrative notes | Maintainer (00-09 Task 4) | 30+ to hit floor; 55+ to hit target | Hand-authored per D-08. |

The maintainer updates this `## Status` table at Task 4 with the final accounting
(Claude-scaffolded vs maintainer-authored vs revised-by-maintainer).
