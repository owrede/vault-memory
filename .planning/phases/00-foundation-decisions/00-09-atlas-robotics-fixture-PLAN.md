---
phase: 00-foundation-decisions
plan: 09
type: execute
wave: 2
depends_on: [01]
files_modified:
  - evals/fixtures/v2-test-vault/README.md
  - evals/fixtures/v2-test-vault/projects/
  - evals/fixtures/v2-test-vault/meetings/
  - evals/fixtures/v2-test-vault/people/
  - evals/fixtures/v2-test-vault/decisions/
  - evals/fixtures/v2-test-vault/references/
  - evals/fixtures/v2-test-vault/_memory/
  - evals/fixtures/v2-test-vault/_queries/search.yaml
  - evals/fixtures/v2-test-vault/_queries/bundle.yaml
  - evals/fixtures/v2-test-vault/_queries/dossier.yaml
  - evals/fixtures/v2-test-vault/_queries/brief.yaml
  - evals/fixtures/v2-test-vault/_queries/graph.yaml
  - evals/fixtures/v2-test-vault/_queries/memory.yaml
  - evals/fixtures/v2-test-vault/_queries/contract.yaml
autonomous: false
requirements: [FND-08]
user_setup:
  - service: maintainer-authored-fixture
    why: "Per D-08, notes are hand-authored by the maintainer (not LLM-drafted) so eval failures stay human-debuggable. Claude can scaffold structure and ~30 notes; the maintainer authors / reviews the rest in a `checkpoint:human-action` task."
must_haves:
  truths:
    - "`evals/fixtures/v2-test-vault/` contains 50–110 markdown notes across the five top-level folders (`projects/`, `meetings/`, `people/`, `decisions/`, `references/`)"
    - "`_memory/` subset contains ≥15 notes (target ~20) with provenance properties matching MEMORY_CONTRACT.md"
    - "`_queries/<category>.yaml` exists for 7 categories (search, bundle, dossier, brief, graph, memory, contract) with ≥3 queries each in the D-09 schema"
    - "Every `expected_doc_ids` value references a file that actually exists in the fixture (Pitfall 5 mitigation)"
  artifacts:
    - path: "evals/fixtures/v2-test-vault/README.md"
      provides: "Atlas Robotics narrative + folder map"
      contains: "Atlas Robotics"
    - path: "evals/fixtures/v2-test-vault/_queries/search.yaml"
      provides: "≥3 hand-labeled search queries"
      contains: "expected_doc_ids"
    - path: "evals/fixtures/v2-test-vault/_memory/"
      provides: "≥15 documents with diverse provenance labels"
  key_links:
    - from: "evals/fixtures/v2-test-vault/_queries/*.yaml"
      to: "evals/fixtures/v2-test-vault/{projects,meetings,people,decisions,references}/*.md"
      via: "expected_doc_ids as vault-relative paths"
      pattern: "expected_doc_ids:"
---

<objective>
Ship FND-08 — the Atlas Robotics fixture vault. Per D-07/D-08, this is the eval substrate for the entire v2 line (Phases 1–9), and notes are hand-authored by the maintainer rather than LLM-drafted so eval failures remain human-debuggable. Claude's role is to scaffold the directory structure, author the README + ~20–30 starter notes that demonstrate the narrative arc, define every `_queries/*.yaml` query fixture against those notes, and then explicitly hand off the remaining ~40–50 notes to the maintainer via a `checkpoint:human-action` task (per D-08).

Per CONTEXT canonical_refs, queries use VAULT-RELATIVE PATHS (e.g., `projects/Atlas-1.md`) in `expected_doc_ids`, NOT `obsidian-fs://` URIs (Open Question 5 — Phase 1's adapter extraction is where URI translation lands).

Purpose: Phase 1 needs a fixture to index. Phase 2 needs `_memory/` documents to validate the memory namespace. Phase 5's brief eval needs `compiled_from` source documents. Hand-authoring once is the cost of buying all later phase evals.

Output: directory tree + README + ~20–30 Claude-authored seed notes + ≥15 `_memory/` notes + 7 query YAMLs with ≥3 entries each + a maintainer-hand-off checkpoint listing the remaining note authoring work.
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
@.planning/phases/00-foundation-decisions/00-01-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Scaffold directory structure + `README.md` (narrative overview)</name>
  <read_first>
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-07 — Atlas Robotics narrative; D-08 — hand-authored; D-09 — query schema; D-10 — YAML)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Pattern 3 — One Eval-Fixture-Vault Slice = Coherent Sub-Narrative (people/projects/meetings/decisions/references example list)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Recommended Project Structure (folder layout)
  </read_first>
  <action>Create the directory tree: `evals/fixtures/v2-test-vault/{projects,meetings,people,decisions,references,_memory,_queries}/`. The `_memory/` directory MUST contain a `.memory-sink` sentinel file (empty or with content `# memory sink — fixture; created 2026-05-14`) per ADR-004 amendment. Create `evals/fixtures/v2-test-vault/README.md` with: (1) `# Atlas Robotics — v2 Eval Fixture Vault` H1; (2) one-paragraph narrative: Atlas Robotics is a small fictional robotics startup with three founding people (Alice Chen, CEO; Bob Martinez, CTO; Carlos Yim, Lead Engineer), three product threads (Atlas-1 the flagship robot, Spire the warehouse-ops product, Beacon the R&D side bet), an active 2026-Q2 OKR cycle, and a recent pivot decision (2026-03-12 pivot from consumer to warehouse). The narrative is fictional to keep maintainer time on shape rather than research; realism over volume per RESEARCH Pattern 3; (3) `## Folder map` H2 table listing each top-level folder with one-line purpose; (4) `## Note count target` H2: total 50–100 (CONTEXT target ~75); `_memory/` target ~20; (5) `## Authoring conventions` H2: kebab-case filenames; YAML frontmatter required on every note (at minimum a `title` key; `_memory/` notes also require the MEMORY_CONTRACT seven keys per ADR-004); cross-references use `[[wikilink]]` form; no real PII or copyrighted text; (6) `## Status` H2 noting which subset is Claude-scaffolded vs maintainer-authored — start empty, Task 4 fills it in.</action>
  <acceptance_criteria>
    - All seven directories exist: `for d in projects meetings people decisions references _memory _queries; do test -d "evals/fixtures/v2-test-vault/$d" || exit 1; done` exits 0.
    - Sentinel file present: `test -f evals/fixtures/v2-test-vault/_memory/.memory-sink` exits 0.
    - README contains "Atlas Robotics": `grep -q 'Atlas Robotics' evals/fixtures/v2-test-vault/README.md`.
    - README has the four required H2 sections: `for h in '## Folder map' '## Note count target' '## Authoring conventions' '## Status'; do grep -qF "$h" evals/fixtures/v2-test-vault/README.md || exit 1; done`.
  </acceptance_criteria>
  <verify>
    <automated>for d in projects meetings people decisions references _memory _queries; do test -d "evals/fixtures/v2-test-vault/$d" || exit 1; done && test -f evals/fixtures/v2-test-vault/_memory/.memory-sink && grep -q 'Atlas Robotics' evals/fixtures/v2-test-vault/README.md</automated>
  </verify>
  <done>Directory tree + sentinel + README scaffold ready.</done>
</task>

<task type="auto">
  <name>Task 2: Author ~25 Claude-scaffolded seed notes across the five top-level folders</name>
  <read_first>
    - evals/fixtures/v2-test-vault/README.md (the narrative just authored)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Pattern 3 — Atlas Robotics example narrative outline
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-08 — hand-authored, but Claude scaffolding ~25 notes is acceptable as long as the maintainer reviews; document this in Task 4 checkpoint)
  </read_first>
  <action>Create ~25 markdown notes distributed across the five folders, each ~30–60 lines, each with YAML frontmatter (at minimum `title:`, `created:`, and category-specific keys). Distribution: ~3 people files (`people/alice-chen.md`, `people/bob-martinez.md`, `people/carlos-yim.md` — each with `role:`, `joined:`, `[[wikilink]]` references to projects they own), ~6 projects (`projects/atlas-1.md`, `projects/spire.md`, `projects/beacon.md`, `projects/atlas-1-q2-roadmap.md`, `projects/spire-pilot-warehouse-a.md`, `projects/beacon-sensor-evaluation.md`), ~6 meetings (`meetings/2026-04-15-q2-okr-review.md`, `meetings/2026-04-12-atlas-standup.md`, `meetings/2026-04-08-spire-pilot-readout.md`, `meetings/2026-03-12-strategy-offsite.md`, `meetings/2026-04-22-beacon-go-no-go.md`, `meetings/2026-05-06-allhands-q1-recap.md`), ~5 decisions (`decisions/2026-03-12-pivot-to-warehouse.md`, `decisions/2026-04-15-defer-beacon.md`, `decisions/2026-02-20-adopt-typescript.md`, `decisions/2026-03-05-hire-lead-engineer.md`, `decisions/2026-05-01-q2-okr-set.md`), ~5 references (`references/ieee-robotics-society-2025.md`, `references/warehouse-automation-market-report.md`, `references/atlas-1-component-spec.md`, `references/typescript-style-guide.md`, `references/customer-discovery-notes-2026.md`). Each note MUST: (a) have frontmatter with `title` matching the H1 heading; (b) contain at least one `[[wikilink]]` to another note that exists (sustains the graph eval queries); (c) be coherent narrative — no `lorem ipsum`; ~50% of content can be Claude-drafted as scaffolding per the task description with the explicit understanding that the maintainer revises in Task 4. Use kebab-case filenames. Do NOT use real names of real people or real companies beyond Atlas Robotics (fictional). The 25-note count is a lower bound on Claude's contribution; total fixture target (Task 4) is 50–100.</action>
  <acceptance_criteria>
    - At least 25 markdown notes total outside `_memory/` and `_queries/`: `[ $(find evals/fixtures/v2-test-vault -name '*.md' -not -path '*/_memory/*' -not -path '*/_queries/*' -not -name 'README.md' | wc -l) -ge 25 ]` exits 0.
    - Each top-level narrative folder has ≥3 notes: `for d in projects meetings people decisions references; do [ $(find evals/fixtures/v2-test-vault/$d -name '*.md' | wc -l) -ge 3 ] || exit 1; done`.
    - Every note has frontmatter (starts with `---`): `for f in $(find evals/fixtures/v2-test-vault -name '*.md' -not -path '*/_memory/*' -not -path '*/_queries/*' -not -name 'README.md'); do head -1 "$f" | grep -q '^---$' || { echo "Missing frontmatter: $f" >&2; exit 1; }; done`.
    - Each note contains at least one `[[wikilink]]`: `for f in $(find evals/fixtures/v2-test-vault -name '*.md' -not -path '*/_memory/*' -not -path '*/_queries/*' -not -name 'README.md'); do grep -q '\\[\\[' "$f" || { echo "Missing wikilink: $f" >&2; exit 1; }; done`.
  </acceptance_criteria>
  <verify>
    <automated>[ $(find evals/fixtures/v2-test-vault -name '*.md' -not -path '*/_memory/*' -not -path '*/_queries/*' -not -name 'README.md' | wc -l) -ge 25 ] && for d in projects meetings people decisions references; do [ $(find evals/fixtures/v2-test-vault/$d -name '*.md' | wc -l) -ge 3 ] || exit 1; done</automated>
  </verify>
  <done>~25 narrative notes scaffolded across the five folders; all have frontmatter; all have ≥1 wikilink.</done>
</task>

<task type="auto">
  <name>Task 3: Author ~15 `_memory/` notes with MEMORY_CONTRACT properties + 7 query YAMLs (≥3 entries each)</name>
  <read_first>
    - docs/v2/MEMORY_CONTRACT.md (the seven required properties from plan 07 — `source`, `confidence`, `evidence`, `status`, `observed_at`, `superseded_by`, `type`)
    - docs/v2/adr/004-memory-sink-handles.md (sentinel, sink structure)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-09 query schema: `{id, query, expected_doc_ids, expected_must_contain?, rationale}`)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Recommended Project Structure (7 query files: search, bundle, dossier, brief, graph, memory, contract)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Pitfall 5 (every `expected_doc_ids` must reference a file that exists)
    - All files created in Task 2 (must reference them in `expected_doc_ids`)
  </read_first>
  <action>(A) Create ≥15 markdown files under `evals/fixtures/v2-test-vault/_memory/`. Distribute across subfolders: `_memory/observations/` (~8 — agent-recorded micro-observations about the Atlas Robotics team and project state, each with `source: agent`, varied `confidence: direct|inferred|uncertain`, varied `type: observation`), `_memory/_briefs/` (~3 — sample compiled briefs with `type: brief`, `compiled_from: [<doc-uri-list>]`, `compiled_at: <iso>`, populated `evidence` array referencing real Task-2 notes), `_memory/status-updates/` (~4 — `type: status-update` entries with `confidence: direct` for status updates the agent has logged about projects). EVERY `_memory/` note MUST have all seven MEMORY_CONTRACT properties in its frontmatter (some, like `superseded_by`, can be `null` for active notes). At least one observation in `_memory/observations/` MUST be `status: superseded` with `superseded_by:` pointing to another note in `_memory/observations/` to give the `supersede`-tool eval a target. Use kebab-case filenames with date prefixes (e.g., `2026-04-16-alice-prefers-async-standups.md`). (B) Create the seven query YAMLs in `evals/fixtures/v2-test-vault/_queries/`: `search.yaml`, `bundle.yaml`, `dossier.yaml`, `brief.yaml`, `graph.yaml`, `memory.yaml`, `contract.yaml`. Each MUST be a valid YAML document with a top-level `queries:` list of ≥3 entries. Each entry has keys per D-09: `id` (kebab-case unique within file), `query` (free-text user question), `expected_doc_ids` (list of vault-relative paths — e.g., `projects/atlas-1.md`), optional `expected_must_contain` (list of substrings), `rationale` (short prose explaining why these are the expected hits). Every `expected_doc_ids` entry MUST be a vault-relative path that resolves to an existing file in the fixture (Task 2 or Task 3 output). For categories whose tools don't yet exist in v1 (bundle, dossier, brief, graph, memory, contract) the queries describe expected behavior for the Phase-3+ tools; for `search.yaml`, queries describe expected behavior for v1's `search_hybrid` / `search_semantic` / `search_text`. Vault-relative paths (not `obsidian-fs://` URIs) per RESEARCH Open Question 5.</action>
  <acceptance_criteria>
    - Match VALIDATION row 00-08-02: `[ $(find evals/fixtures/v2-test-vault/_memory -name '*.md' | wc -l) -ge 15 ]` exits 0.
    - Match VALIDATION row 00-08-03: every query yaml has ≥3 entries. `for f in evals/fixtures/v2-test-vault/_queries/*.yaml; do [ $(grep -c '^- id:' "$f") -ge 3 ] || { echo "Need 3+ in $f" >&2; exit 1; }; done`.
    - All seven category yamls exist: `for c in search bundle dossier brief graph memory contract; do test -f "evals/fixtures/v2-test-vault/_queries/${c}.yaml" || exit 1; done`.
    - Every `_memory/` note has the seven required keys in frontmatter: `for f in $(find evals/fixtures/v2-test-vault/_memory -name '*.md'); do for k in source confidence evidence status observed_at superseded_by type; do grep -q "^${k}:" "$f" || { echo "$f missing $k" >&2; exit 1; }; done; done`.
    - At least one `_memory/` note has `status: superseded`: `grep -rEq '^status: superseded' evals/fixtures/v2-test-vault/_memory/`.
    - Referential integrity (Pitfall 5): every `expected_doc_ids` resolves to a real file. Loadable parse — for each query file, every listed path under `expected_doc_ids:` followed by a `- ` line must exist as a file at `evals/fixtures/v2-test-vault/<path>`. Shell script: `for f in evals/fixtures/v2-test-vault/_queries/*.yaml; do node -e 'const y=require("yaml");const fs=require("fs");const d=y.parse(fs.readFileSync(process.argv[1],"utf-8"));for (const q of (d.queries||[])) for (const p of (q.expected_doc_ids||[])) if (!fs.existsSync("evals/fixtures/v2-test-vault/"+p)) { console.error("missing: "+p+" in "+process.argv[1]); process.exit(1) }' "$f"; done` exits 0.
  </acceptance_criteria>
  <verify>
    <automated>[ $(find evals/fixtures/v2-test-vault/_memory -name '*.md' | wc -l) -ge 15 ] && for c in search bundle dossier brief graph memory contract; do test -f "evals/fixtures/v2-test-vault/_queries/${c}.yaml" && [ $(grep -c '^- id:' "evals/fixtures/v2-test-vault/_queries/${c}.yaml") -ge 3 ] || exit 1; done && grep -rEq '^status: superseded' evals/fixtures/v2-test-vault/_memory/</automated>
  </verify>
  <done>≥15 `_memory/` notes with seven MEMORY_CONTRACT keys each, one superseded, plus seven query YAMLs each ≥3 entries with referential integrity.</done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 4: Maintainer hand-off — author additional notes to reach 50–100 total + review Claude-scaffolded notes</name>
  <what-built>Claude has scaffolded the fixture directory, the README, ~25 narrative notes across five folders, ~15 `_memory/` notes with full MEMORY_CONTRACT properties, and 7 query YAML files with ≥3 entries each referencing real notes. Total Claude-authored markdown count is ~40 notes.</what-built>
  <how-to-verify>
    (1) Open `evals/fixtures/v2-test-vault/` and read the README — confirm the Atlas Robotics narrative makes sense and is one you can extend.
    (2) Spot-check 3–4 Claude-scaffolded notes per folder — confirm they are legible, accurate to the narrative, free of LLM-flavor artifacts (per D-08).
    (3) Decide how many additional notes you want to author personally. CONTEXT target is ~75 total; Claude has shipped ~40; you may either accept that floor (passes the 50-note VALIDATION threshold) or hand-author up to 35 more to reach the ~75 target. Per RESEARCH §Pattern 3 each note is ~10 minutes; reaching 75 from 40 is ~6 maintainer-hours, optional.
    (4) Optionally adjust query YAMLs in `_queries/` to add 1–2 more queries per category against the notes you authored.
    (5) Run the referential-integrity check: `node -e 'const y=require("yaml");const fs=require("fs");for (const f of require("fs").readdirSync("evals/fixtures/v2-test-vault/_queries").filter(x=>x.endsWith(".yaml"))) { const d=y.parse(fs.readFileSync("evals/fixtures/v2-test-vault/_queries/"+f,"utf-8")); for (const q of (d.queries||[])) for (const p of (q.expected_doc_ids||[])) if (!fs.existsSync("evals/fixtures/v2-test-vault/"+p)) { console.error("MISSING: "+p+" in "+f); process.exit(1) } } console.log("OK")'` — if it prints `OK`, every query references a real file. If it prints `MISSING:`, fix the reference (rename the file, fix the query, or delete the query) before resuming.
    (6) Update `evals/fixtures/v2-test-vault/README.md` `## Status` section listing what Claude scaffolded vs what you authored/revised.
  </how-to-verify>
  <acceptance_criteria>
    - Total fixture note count is in the documented bound. Match VALIDATION row 00-08-01: `[ $(find evals/fixtures/v2-test-vault -name '*.md' -not -path '*/_queries/*' | wc -l) -ge 50 ] && [ $(find evals/fixtures/v2-test-vault -name '*.md' -not -path '*/_queries/*' | wc -l) -le 110 ]` exits 0.
    - README `## Status` section updated with the maintainer's accounting.
  </acceptance_criteria>
  <resume-signal>Reply `approved` once the maintainer is satisfied with note coverage and the referential-integrity check passes. Optionally reply `approved with adjustments: <list>` describing additions.</resume-signal>
</task>

</tasks>

<verification>
- VALIDATION rows 00-08-01 (50–110 note count), 00-08-02 (`_memory/` ≥15), 00-08-03 (each query yaml has ≥3 entries) all pass.
- Referential integrity (Pitfall 5) verified by the node one-liner in Task 4 instructions.
- Sentinel file (`_memory/.memory-sink`) present per ADR-004.
</verification>

<success_criteria>
- Fixture vault exists with 50–110 total notes.
- All five top-level narrative folders populated with ≥3 notes each.
- `_memory/` has ≥15 notes with full MEMORY_CONTRACT property coverage + at least one superseded entry.
- 7 query YAMLs (search, bundle, dossier, brief, graph, memory, contract) each with ≥3 D-09-schema entries.
- Every `expected_doc_ids` references an existing file.
</success_criteria>

<output>
After completion, create `.planning/phases/00-foundation-decisions/00-09-SUMMARY.md` listing: total note count, per-folder counts, `_memory/` provenance-label diversity (which `confidence` values appear, which `type` values appear), how many queries per category, and the maintainer-vs-Claude authorship split.
</output>
