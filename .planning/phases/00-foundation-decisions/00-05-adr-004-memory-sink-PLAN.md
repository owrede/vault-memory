---
phase: 00-foundation-decisions
plan: 05
type: execute
wave: 3
depends_on: [02]
files_modified:
  - docs/dev/004-memory-sink-handles.md
  - docs/v2/adr/004-memory-sink-handles.md
  - docs/v2/adr/README.md
autonomous: true
requirements: [FND-01, FND-03, FND-04, FND-13]
must_haves:
  truths:
    - "ADR-004 lives at the public path `docs/v2/adr/004-memory-sink-handles.md` with full git history preserved"
    - "ADR-004 specifies that the folder-default `MemorySink` is the only code path; the separate-vault option is **config-only** in `config.toml` (no code branch — FND-03)"
    - "ADR-004 documents the `.memory-sink` sentinel file with both folder-default and separate-vault config examples (FND-03)"
    - "ADR-004 has `## Invariants` and `## Examples` sections (FND-04)"
    - "ADR index README has a row for `| 004 | … Memory Sink Handles … | Accepted | …`"
  artifacts:
    - path: "docs/v2/adr/004-memory-sink-handles.md"
      provides: "ADR-004 with folder-default amendment + Invariants + Examples"
      contains: "folder-default"
    - path: "docs/v2/adr/README.md"
      provides: "Index appended with ADR-004 row"
      contains: "| 004 |"
  key_links:
    - from: "docs/v2/adr/004-memory-sink-handles.md"
      to: "docs/v2/adr/003-document-shape.md"
      via: "depends_on link in frontmatter / body"
      pattern: "ADR-003"
---

<objective>
(FND-01) Relocate ADR-004 to public path. (FND-03) Amend it to specify the folder-default `MemorySink` as the only code path, with the separate-vault option moved entirely into TOML configuration. Document both the sentinel file (`.memory-sink`) and the `obsidian-fs://_memory/` handle syntax with config examples covering both folder-default and separate-vault variants. (FND-04) Add explicit Invariants + Examples per the global pattern.

Purpose: ADR-004 is the contract Phase 2's memory-namespace work is built against. Phase 2 success criterion #5 explicitly requires "ADR-004 amendment (folder-default vs separate-vault) committed before implementation." Phase 0 lands this.

Output: ADR-004 public, amended (FND-03), Invariants/Examples added (FND-04), index row.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/00-foundation-decisions/00-CONTEXT.md
@.planning/phases/00-foundation-decisions/00-RESEARCH.md
@.planning/phases/00-foundation-decisions/00-VALIDATION.md
@.planning/phases/00-foundation-decisions/00-02-SUMMARY.md
@docs/dev/004-memory-sink-handles.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Commit A — `git mv` ADR-004 to public path (no content edits)</name>
  <read_first>
    - docs/dev/004-memory-sink-handles.md (full file — 311 lines per RESEARCH; do NOT modify content in this task)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Pattern 1 + §Pitfall 1
  </read_first>
  <action>Run `git mv docs/dev/004-memory-sink-handles.md docs/v2/adr/004-memory-sink-handles.md`. Commit with message `docs(adr-004): relocate to public docs/v2/adr/`. Zero content edits. No `--amend`.</action>
  <acceptance_criteria>
    - `test -f docs/v2/adr/004-memory-sink-handles.md && ! test -e docs/dev/004-memory-sink-handles.md` exits 0.
    - `git log --follow --oneline docs/v2/adr/004-memory-sink-handles.md | wc -l` ≥ 2.
    - `diff <(git show HEAD:docs/v2/adr/004-memory-sink-handles.md) <(git show HEAD~1:docs/dev/004-memory-sink-handles.md)` is empty.
  </acceptance_criteria>
  <verify>
    <automated>test -f docs/v2/adr/004-memory-sink-handles.md && ! test -e docs/dev/004-memory-sink-handles.md && [ $(git log --follow --oneline docs/v2/adr/004-memory-sink-handles.md | wc -l) -ge 2 ]</automated>
  </verify>
  <done>ADR-004 at public path; history extends back.</done>
</task>

<task type="auto">
  <name>Task 2: Commit B — amend ADR-004 with folder-default decision (FND-03) + `## Invariants` + `## Examples` + `Tags:` frontmatter</name>
  <read_first>
    - docs/v2/adr/004-memory-sink-handles.md (just-relocated file — read existing `## Decision`, `## Config`, and any open question that discusses folder-vs-separate-vault)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-06 — folder-default is the only code path; separate-vault is config-only)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Phase Requirements row FND-03 (amendment is a tightening, not a redesign)
    - .planning/phases/00-foundation-decisions/00-VALIDATION.md rows 00-03-01 + 00-03-02 (exact grep patterns)
  </read_first>
  <action>Edit `docs/v2/adr/004-memory-sink-handles.md` in place. (1) Add YAML frontmatter: `---\ntitle: Memory Sink Handles\nstatus: Accepted\nphase: 0\ntags: memory, memory-sink, provenance, sentinel-file, folder-default, separate-vault\n---\n` and update `**Status:** Proposed` → `**Status:** Accepted`. (2) Add a new H2 section `## Amendment — Folder-default is the only code path` AFTER the existing `## Decision` section. This section MUST contain prose that says verbatim or in close paraphrase: (a) "The folder-default `MemorySink` (a `_memory/` folder inside an Obsidian vault) is the ONLY code path in v2."; (b) "Routing a memory sink to a separate Obsidian vault is achieved purely through `config.toml` — **no code branch** distinguishes folder-inside-vault from separate-dedicated-vault. The handle parser resolves both forms uniformly."; (c) cite the `[memory]` and `[[memory_sinks]]` config blocks. (3) Add a `### Sentinel file` H3 subsection documenting the `.memory-sink` sentinel: any folder used as a memory sink MUST contain a `.memory-sink` file at its root; the handle parser refuses to resolve a memory sink against a folder lacking the sentinel; sentinel content is informational (timestamp + sink name) but presence is the gate. (4) Add a `### Config examples` H3 subsection with two complete TOML blocks: (a) folder-default — `[[vaults]] name = "my-vault" ... [[memory_sinks]] handle = "obsidian-fs://my-vault/_memory" default = true` plus a one-line `[memory]` block referring to the named sink; (b) separate-vault — `[[vaults]]` for `my-vault` AND a second `[[vaults]]` for `agent-memory`, plus a `[[memory_sinks]] handle = "obsidian-fs://agent-memory/" name = "default"` showing the handle parser sees the second vault as just another `obsidian-fs://<authority>/` resource. Each example MUST contain a `[memory]` section header AND a `sink = "@<name>"` or equivalent reference for VALIDATION row 00-03-02. (5) Add `## Invariants` section with at least 5 normative bullets in `**M-N**:` form: `**M-1**: A MemorySink handle MUST follow ADR-001 URI syntax. The handle parser is the ONLY resolver of sink-as-path.`; `**M-2**: The folder-default and separate-vault forms differ ONLY in config; no source code branches on which form is in use.`; `**M-3**: A `.memory-sink` sentinel file MUST be present at the sink-folder root. The handle parser MUST refuse to resolve against a folder lacking it.`; `**M-4**: All agent writes to a MemorySink MUST route through DeliveryAdapter.write() (per ADR-002 invariant). Bypass paths are FORBIDDEN.`; `**M-5**: User-facing write tools (write_note, update_frontmatter, delete_note) MUST refuse to target a path resolved to a configured MemorySink and MUST refuse source=agent writes outside any configured sink.` (6) Add `## Examples` section AFTER `## Consequences` containing: (a) worked folder-default example — TOML config, sink resolution, an observation record written into `obsidian-fs://my-vault/_memory/observations/2026-05-14-...md` with provenance properties; (b) parallel `notion-api://` worked example — TOML config sketching a v3 Notion sink (`notion-api://acme/databases/agent-memory`), showing the handle parser resolves the same URI shape and that no code change is needed for this v3 case (per the source-neutrality test). Commit with message `docs(adr-004): amend with folder-default + sentinel (FND-03); Invariants; status Accepted`.</action>
  <acceptance_criteria>
    - Match VALIDATION row 00-03-01: `grep -qi 'folder-default' docs/v2/adr/004-memory-sink-handles.md && grep -qi 'no code branch' docs/v2/adr/004-memory-sink-handles.md` exits 0.
    - Match VALIDATION row 00-03-02: `grep -q 'config.toml' docs/v2/adr/004-memory-sink-handles.md && grep -q '\\[memory\\]' docs/v2/adr/004-memory-sink-handles.md && grep -q 'sink *= *"@' docs/v2/adr/004-memory-sink-handles.md` exits 0.
    - `grep -q '\\.memory-sink' docs/v2/adr/004-memory-sink-handles.md` (sentinel file documented).
    - `grep -q '^## Invariants' docs/v2/adr/004-memory-sink-handles.md && grep -q '^## Examples' docs/v2/adr/004-memory-sink-handles.md`.
    - `grep -q 'obsidian-fs://' docs/v2/adr/004-memory-sink-handles.md && grep -q 'notion-api://' docs/v2/adr/004-memory-sink-handles.md`.
    - `grep -cE '^\\*\\*M-[1-5]\\*\\*:' docs/v2/adr/004-memory-sink-handles.md` ≥ 5.
    - `head -10 docs/v2/adr/004-memory-sink-handles.md | grep -q '^tags:' && grep -q '^status: Accepted$' docs/v2/adr/004-memory-sink-handles.md`.
  </acceptance_criteria>
  <verify>
    <automated>grep -qi 'folder-default' docs/v2/adr/004-memory-sink-handles.md && grep -qi 'no code branch' docs/v2/adr/004-memory-sink-handles.md && grep -q 'config.toml' docs/v2/adr/004-memory-sink-handles.md && grep -q '\[memory\]' docs/v2/adr/004-memory-sink-handles.md && grep -q '\.memory-sink' docs/v2/adr/004-memory-sink-handles.md && grep -q '^## Invariants' docs/v2/adr/004-memory-sink-handles.md && grep -q '^## Examples' docs/v2/adr/004-memory-sink-handles.md && grep -q 'notion-api://' docs/v2/adr/004-memory-sink-handles.md && [ $(grep -cE '^\*\*M-[1-5]\*\*:' docs/v2/adr/004-memory-sink-handles.md) -ge 5 ]</automated>
  </verify>
  <done>ADR-004 amended with folder-default + sentinel + dual config examples + Invariants + dual-scheme Examples.</done>
</task>

<task type="auto">
  <name>Task 3: Commit C — append ADR-004 row to `docs/v2/adr/README.md`</name>
  <read_first>
    - docs/v2/adr/README.md (with rows from plans 02, 03, 04)
    - docs/v2/adr/004-memory-sink-handles.md (read `tags:` frontmatter)
  </read_first>
  <action>Append a row to the `## Accepted v2 ADRs` table after the ADR-003 row: `| 004 | [Memory Sink Handles](004-memory-sink-handles.md) | Accepted | 0 | — | memory, memory-sink, provenance, sentinel-file, folder-default, separate-vault |`. Do NOT touch other rows or the `## Open ADRs` section. Commit with message `docs(adr-004): append ADR-004 row to index`.</action>
  <acceptance_criteria>
    - `grep -qE '^\\| 004 \\|' docs/v2/adr/README.md && grep -q '004-memory-sink-handles.md' docs/v2/adr/README.md` exits 0.
    - `[ $(grep -cE '^\\| 00[1-9] \\|' docs/v2/adr/README.md) -ge 4 ]` (rows for 001..004 all present after plans 02–05 land).
  </acceptance_criteria>
  <verify>
    <automated>grep -qE '^\| 004 \|' docs/v2/adr/README.md && grep -q '004-memory-sink-handles.md' docs/v2/adr/README.md && [ $(grep -cE '^\| 00[1-9] \|' docs/v2/adr/README.md) -ge 4 ]</automated>
  </verify>
  <done>ADR index lists ADR-004; all four v2 ADRs accounted for in the Accepted table.</done>
</task>

</tasks>

<verification>
- VALIDATION rows 00-03-01 + 00-03-02 (folder-default + config-only separate-vault) pass.
- VALIDATION rows 00-04-01 + 00-04-02 partial pass for ADR-004.
- After this plan, VALIDATION row 00-13-01 (rows for 001..004 in index) passes.
- Manual: `git log --follow --oneline docs/v2/adr/004-memory-sink-handles.md` shows pre-rename history.
</verification>

<success_criteria>
- ADR-004 publicly readable; amended; indexed.
- Folder-default-only code path stated explicitly with `no code branch` wording.
- Sentinel file (`.memory-sink`) documented; both config examples present.
- All four v2 ADRs (001–004) are now in `docs/v2/adr/` with Invariants + Examples.
</success_criteria>

<output>
After completion, create `.planning/phases/00-foundation-decisions/00-05-SUMMARY.md` documenting: the folder-default amendment text, sentinel-file behavior, the two config example shapes, M-1..M-5 invariants, history-preservation check.
</output>
