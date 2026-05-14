---
phase: 00-foundation-decisions
plan: 09
type: execute
wave: 3
depends_on: [02]
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
    why: "Per D-08, narrative notes (`projects/`, `meetings/`, `people/`, `decisions/`, `references/`) are hand-authored by the maintainer (not LLM-drafted) so eval failures stay human-debuggable. Claude scaffolds directory structure and 5 illustrative example notes (one per top-level folder) plus the `_memory/` subset (which simulates agent output and is allowed to be agent/LLM-drafted by its nature). The maintainer hand-authors the remaining 45+ narrative notes in a `checkpoint:human-action` task to reach the 50-note VALIDATION floor."
must_haves:
  truths:
    - "`evals/fixtures/v2-test-vault/` reaches 50–110 markdown notes across the five top-level folders (`projects/`, `meetings/`, `people/`, `decisions/`, `references/`) AT TASK 4 (maintainer-resolved checkpoint), not at Task 2"
    - "Claude's Task 2 contribution is 5 example notes (one per top-level folder) demonstrating the narrative voice, frontmatter shape, and wikilink usage"
    - "`_memory/` subset contains ≥15 notes (target ~20) with provenance properties matching MEMORY_CONTRACT.md"
    - "`_queries/<category>.yaml` exists for 7 categories (search, bundle, dossier, brief, graph, memory, contract) with ≥3 queries each in the D-09 schema"
    - "Every `expected_doc_ids` value references a file that actually exists in the fixture (Pitfall 5 mitigation) — verified at Task 4 after the maintainer has authored the rest of the narrative notes"
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
Ship FND-08 — the Atlas Robotics fixture vault. Per D-07/D-08, this is the eval substrate for the entire v2 line (Phases 1–9), and narrative notes are HAND-AUTHORED by the maintainer rather than LLM-drafted so eval failures remain human-debuggable. Claude's role is narrow: scaffold the directory structure, author the README, author exactly 5 illustrative example notes (one per top-level folder) demonstrating the desired voice and shape, author the `_memory/` subset (which simulates agent output and is allowed to be LLM-drafted by nature), and define the 7 `_queries/*.yaml` query fixtures. The maintainer then takes Task 4 (a `checkpoint:human-action`) to hand-author the remaining 45+ notes and reach the 50-note VALIDATION floor.

Per CONTEXT canonical_refs, queries use VAULT-RELATIVE PATHS (e.g., `projects/Atlas-1.md`) in `expected_doc_ids`, NOT `obsidian-fs://` URIs (Open Question 5 — Phase 1's adapter extraction is where URI translation lands).

The 50-note floor is enforced AT TASK 4 (maintainer-resolved checkpoint), NOT at Task 2 (Claude's 5-example scaffold). This honors D-08's "hand-authored" requirement while still letting Claude do the cheap structural work upfront.

Output: directory tree + README + 5 Claude-authored example notes + ≥15 `_memory/` notes (LLM-allowed simulating agent output) + 7 query YAMLs with ≥3 entries each + maintainer-hand-off checkpoint that reaches the 50-note floor.
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
  <name>Task 2: Author 5 illustrative example notes — one per top-level folder (Claude-scaffolded; bulk hand-authoring happens in Task 4)</name>
  <read_first>
    - evals/fixtures/v2-test-vault/README.md (the narrative just authored)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Pattern 3 — Atlas Robotics example narrative outline
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-08 — narrative notes are hand-authored by maintainer; Claude's contribution is limited to 5 example notes that demonstrate voice and shape)
  </read_first>
  <action>Create exactly 5 example markdown notes — one per top-level narrative folder — each ~30–60 lines, each with YAML frontmatter (at minimum `title:`, `created:`, and category-specific keys). The 5 notes are illustrative templates: they show the maintainer the desired note voice, frontmatter shape, and wikilink usage. The maintainer extends from this base in Task 4.

  Required 5 notes (use these exact filenames):
  - `people/alice-chen.md` — Alice Chen, CEO. Frontmatter keys: `title:`, `role:`, `joined:`, `created:`. Body: one-paragraph bio + bullets summarizing what she owns. Includes `[[wikilink]]` to `projects/atlas-1.md`.
  - `projects/atlas-1.md` — Atlas-1 flagship robot. Frontmatter keys: `title:`, `status:`, `owner:`, `created:`. Body: 2–3 paragraphs covering goal, current state, recent decisions. Includes `[[wikilink]]` to `people/alice-chen.md` and at least one other wikilink (can be to a note that doesn't exist yet — maintainer will create it in Task 4).
  - `meetings/2026-04-15-q2-okr-review.md` — Q2 OKR review meeting note. Frontmatter keys: `title:`, `date:`, `attendees:`, `created:`. Body: agenda + decisions + action items in standard meeting-note shape. Includes `[[wikilink]]` to `people/alice-chen.md` and `projects/atlas-1.md`.
  - `decisions/2026-03-12-pivot-to-warehouse.md` — the pivot decision. Frontmatter keys: `title:`, `date:`, `status:`, `created:`. Body: decision statement + context + alternatives considered + consequences. Includes `[[wikilink]]` to `projects/atlas-1.md`.
  - `references/atlas-1-component-spec.md` — a reference document for Atlas-1's BOM. Frontmatter keys: `title:`, `kind:`, `created:`. Body: a small markdown table listing 5–10 components with vendor + part number (fictional). Includes `[[wikilink]]` to `projects/atlas-1.md`.

  Each note MUST: (a) have frontmatter with `title` matching the H1 heading; (b) contain at least one `[[wikilink]]` to another note (some may target notes the maintainer will author in Task 4 — that's expected); (c) be coherent narrative — no `lorem ipsum`; (d) explicitly NOT include LLM-flavor artifacts (no "as a large language model", no "I cannot…" disclaimers, no over-cautious hedging). Use kebab-case filenames. Do NOT use real names of real people or real companies beyond Atlas Robotics (fictional). Do NOT exceed 5 notes — the rest is the maintainer's work in Task 4.</action>
  <acceptance_criteria>
    - Exactly 5 example notes exist at the documented paths: `for p in people/alice-chen.md projects/atlas-1.md meetings/2026-04-15-q2-okr-review.md decisions/2026-03-12-pivot-to-warehouse.md references/atlas-1-component-spec.md; do test -f "evals/fixtures/v2-test-vault/$p" || { echo "Missing: $p" >&2; exit 1; }; done`.
    - Each example has frontmatter (first line is `---`): `for p in people/alice-chen.md projects/atlas-1.md meetings/2026-04-15-q2-okr-review.md decisions/2026-03-12-pivot-to-warehouse.md references/atlas-1-component-spec.md; do head -1 "evals/fixtures/v2-test-vault/$p" | grep -q '^---$' || exit 1; done`.
    - Each example contains at least one `[[wikilink]]`: `for p in people/alice-chen.md projects/atlas-1.md meetings/2026-04-15-q2-okr-review.md decisions/2026-03-12-pivot-to-warehouse.md references/atlas-1-component-spec.md; do grep -q '\\[\\[' "evals/fixtures/v2-test-vault/$p" || exit 1; done`.
    - Each top-level narrative folder has at least 1 note (the example) — note that the 50-note floor is NOT enforced at this task: `for d in projects meetings people decisions references; do [ $(find evals/fixtures/v2-test-vault/$d -name '*.md' | wc -l) -ge 1 ] || exit 1; done`.
  </acceptance_criteria>
  <verify>
    <automated>for p in people/alice-chen.md projects/atlas-1.md meetings/2026-04-15-q2-okr-review.md decisions/2026-03-12-pivot-to-warehouse.md references/atlas-1-component-spec.md; do test -f "evals/fixtures/v2-test-vault/$p" || exit 1; done && for d in projects meetings people decisions references; do [ $(find evals/fixtures/v2-test-vault/$d -name '*.md' | wc -l) -ge 1 ] || exit 1; done</automated>
  </verify>
  <done>5 example narrative notes authored as templates; each has frontmatter + ≥1 wikilink; the rest of the 50-note floor is the maintainer's work in Task 4.</done>
</task>

<task type="auto">
  <name>Task 3: Author ~15 `_memory/` notes with MEMORY_CONTRACT properties + 7 query YAMLs (≥3 entries each)</name>
  <read_first>
    - docs/v2/MEMORY_CONTRACT.md (the seven required properties from plan 07 — `source`, `confidence`, `evidence`, `status`, `observed_at`, `superseded_by`, `type`)
    - docs/v2/adr/004-memory-sink-handles.md (sentinel, sink structure)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-09 query schema: `{id, query, expected_doc_ids, expected_must_contain?, rationale}`)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Recommended Project Structure (7 query files: search, bundle, dossier, brief, graph, memory, contract)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Pitfall 5 (every `expected_doc_ids` must reference a file that exists)
    - The 5 example files from Task 2 (queries here can reference these, plus the `_memory/` notes being authored here; queries that need to point at notes the maintainer will author in Task 4 should use placeholders documented in the query's `rationale` field — see action below)
  </read_first>
  <action>(A) Create ≥15 markdown files under `evals/fixtures/v2-test-vault/_memory/`. _memory/ notes simulate agent output, so Claude-drafting them is allowed (and is the point — they represent what the agent would have written). Distribute across subfolders: `_memory/observations/` (~8 — agent-recorded micro-observations about the Atlas Robotics team and project state, each with `source: agent`, varied `confidence: direct|inferred|uncertain`, varied `type: observation`), `_memory/_briefs/` (~3 — sample compiled briefs with `type: brief`, `compiled_from: [<doc-uri-list>]`, `compiled_at: <iso>`, populated `evidence` array referencing the 5 Task-2 example notes), `_memory/status-updates/` (~4 — `type: status-update` entries with `confidence: direct` for status updates the agent has logged about projects). EVERY `_memory/` note MUST have all seven MEMORY_CONTRACT properties in its frontmatter (some, like `superseded_by`, can be `null` for active notes). At least one observation in `_memory/observations/` MUST be `status: superseded` with `superseded_by:` pointing to another note in `_memory/observations/` to give the `supersede`-tool eval a target. Use kebab-case filenames with date prefixes (e.g., `2026-04-16-alice-prefers-async-standups.md`). (B) Create the seven query YAMLs in `evals/fixtures/v2-test-vault/_queries/`: `search.yaml`, `bundle.yaml`, `dossier.yaml`, `brief.yaml`, `graph.yaml`, `memory.yaml`, `contract.yaml`. Each MUST be a valid YAML document with a top-level `queries:` list of ≥3 entries. Each entry has keys per D-09: `id` (kebab-case unique within file), `query` (free-text user question), `expected_doc_ids` (list of vault-relative paths — e.g., `projects/atlas-1.md`), optional `expected_must_contain` (list of substrings), `rationale` (short prose explaining why these are the expected hits). For Phase 0, ground every `expected_doc_ids` in files that EXIST AT TASK 3 TIME (the 5 example narrative notes from Task 2 + the `_memory/` notes from Task 3 (A)). The maintainer extends both the corpus AND the query coverage in Task 4. Vault-relative paths (not `obsidian-fs://` URIs) per RESEARCH Open Question 5.</action>
  <acceptance_criteria>
    - Match VALIDATION row 00-08-02: `[ $(find evals/fixtures/v2-test-vault/_memory -name '*.md' | wc -l) -ge 15 ]` exits 0.
    - Match VALIDATION row 00-08-03: every query yaml has ≥3 entries. `for f in evals/fixtures/v2-test-vault/_queries/*.yaml; do [ $(grep -c '^- id:' "$f") -ge 3 ] || { echo "Need 3+ in $f" >&2; exit 1; }; done`.
    - All seven category yamls exist: `for c in search bundle dossier brief graph memory contract; do test -f "evals/fixtures/v2-test-vault/_queries/${c}.yaml" || exit 1; done`.
    - Every `_memory/` note has the seven required keys in frontmatter: `for f in $(find evals/fixtures/v2-test-vault/_memory -name '*.md'); do for k in source confidence evidence status observed_at superseded_by type; do grep -q "^${k}:" "$f" || { echo "$f missing $k" >&2; exit 1; }; done; done`.
    - At least one `_memory/` note has `status: superseded`: `grep -rEq '^status: superseded' evals/fixtures/v2-test-vault/_memory/`.
    - Referential integrity (Pitfall 5) at Task-3 time: every `expected_doc_ids` resolves to a real file (either the 5 Task-2 examples or the Task-3 `_memory/` notes). Shell: `for f in evals/fixtures/v2-test-vault/_queries/*.yaml; do node -e 'const y=require("yaml");const fs=require("fs");const d=y.parse(fs.readFileSync(process.argv[1],"utf-8"));for (const q of (d.queries||[])) for (const p of (q.expected_doc_ids||[])) if (!fs.existsSync("evals/fixtures/v2-test-vault/"+p)) { console.error("missing: "+p+" in "+process.argv[1]); process.exit(1) }' "$f"; done` exits 0.
  </acceptance_criteria>
  <verify>
    <automated>[ $(find evals/fixtures/v2-test-vault/_memory -name '*.md' | wc -l) -ge 15 ] && for c in search bundle dossier brief graph memory contract; do test -f "evals/fixtures/v2-test-vault/_queries/${c}.yaml" && [ $(grep -c '^- id:' "evals/fixtures/v2-test-vault/_queries/${c}.yaml") -ge 3 ] || exit 1; done && grep -rEq '^status: superseded' evals/fixtures/v2-test-vault/_memory/</automated>
  </verify>
  <done>≥15 `_memory/` notes with seven MEMORY_CONTRACT keys each, one superseded, plus seven query YAMLs each ≥3 entries with referential integrity at Task-3 time.</done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 4: Maintainer hand-authors the remaining 45+ narrative notes (50-note floor enforced HERE) + reviews Claude's scaffold</name>
  <what-built>Claude has scaffolded the fixture directory, the README, 5 illustrative example notes (one per top-level folder) demonstrating voice + shape, ~15 `_memory/` notes simulating agent output with full MEMORY_CONTRACT properties, and 7 query YAML files with ≥3 entries each referencing the Task-2/Task-3 outputs. Total Claude-authored markdown count is ~20 notes (5 examples + ~15 _memory/). The 50-note VALIDATION floor is NOT yet met — that is this task's responsibility per D-08 ("notes are hand-authored").</what-built>
  <how-to-verify>
    (1) Open `evals/fixtures/v2-test-vault/` and read the README — confirm the Atlas Robotics narrative makes sense and is one you can extend.
    (2) Read the 5 Claude-scaffolded example notes (one per top-level folder). Confirm they demonstrate the voice and shape you want. Revise them if not. These are templates, not final content.
    (3) **Hand-author the remaining narrative notes.** CONTEXT target is ~75 total; current count is ~20 (5 narrative examples + ~15 _memory/). To reach the 50-note VALIDATION floor you need at least 30 more narrative notes; to reach the 75-note target, 50–55 more. Per RESEARCH §Pattern 3 each note is ~10 minutes; reaching 50 from 20 is ~5 maintainer-hours, reaching 75 is ~9. Suggested distribution to reach floor: 5 more `people/`, 8 more `projects/`, 10 more `meetings/`, 5 more `decisions/`, 5 more `references/`.
    (4) **Extend the query YAMLs in `_queries/`** to point at the notes you authored in step 3 (the Phase-0 query set Claude shipped only references the 5 example notes + `_memory/`). For each of the 7 `_queries/*.yaml` files, add 1–3 more queries grounded in the newly-authored notes so the Phase-1 eval surface has real coverage.
    (5) Run the referential-integrity check: `node -e 'const y=require("yaml");const fs=require("fs");for (const f of require("fs").readdirSync("evals/fixtures/v2-test-vault/_queries").filter(x=>x.endsWith(".yaml"))) { const d=y.parse(fs.readFileSync("evals/fixtures/v2-test-vault/_queries/"+f,"utf-8")); for (const q of (d.queries||[])) for (const p of (q.expected_doc_ids||[])) if (!fs.existsSync("evals/fixtures/v2-test-vault/"+p)) { console.error("MISSING: "+p+" in "+f); process.exit(1) } } console.log("OK")'` — if it prints `OK`, every query references a real file. If it prints `MISSING:`, fix the reference (rename the file, fix the query, or delete the query) before resuming.
    (6) Update `evals/fixtures/v2-test-vault/README.md` `## Status` section listing what Claude scaffolded (the 5 examples + `_memory/`) vs what you authored/revised.
  </how-to-verify>
  <acceptance_criteria>
    - **50-note floor enforced HERE (NOT in Task 2).** Match VALIDATION row 00-08-01: `[ $(find evals/fixtures/v2-test-vault -name '*.md' -not -path '*/_queries/*' | wc -l) -ge 50 ] && [ $(find evals/fixtures/v2-test-vault -name '*.md' -not -path '*/_queries/*' | wc -l) -le 110 ]` exits 0.
    - Each top-level narrative folder has ≥3 notes after Task 4: `for d in projects meetings people decisions references; do [ $(find evals/fixtures/v2-test-vault/$d -name '*.md' | wc -l) -ge 3 ] || exit 1; done`.
    - Every narrative note (outside `_memory/` and `_queries/`, excluding README) has frontmatter starting with `---`: `for f in $(find evals/fixtures/v2-test-vault -name '*.md' -not -path '*/_memory/*' -not -path '*/_queries/*' -not -name 'README.md'); do head -1 "$f" | grep -q '^---$' || { echo "Missing frontmatter: $f" >&2; exit 1; }; done`.
    - Every narrative note contains at least one `[[wikilink]]`: `for f in $(find evals/fixtures/v2-test-vault -name '*.md' -not -path '*/_memory/*' -not -path '*/_queries/*' -not -name 'README.md'); do grep -q '\\[\\[' "$f" || { echo "Missing wikilink: $f" >&2; exit 1; }; done`.
    - Referential integrity passes post-extension: re-run the node one-liner from step (5) above — exits 0.
    - README `## Status` section updated with the maintainer's accounting (Claude-scaffolded vs maintainer-authored).
  </acceptance_criteria>
  <resume-signal>Reply `approved` once the 50-note floor is reached, all narrative notes have frontmatter + wikilinks, the referential-integrity check passes, and the README `## Status` is updated. Optionally reply `approved with adjustments: <list>` describing additions or revisions to Claude's scaffold.</resume-signal>
</task>

</tasks>

<verification>
- VALIDATION row 00-08-01 (50–110 note count) is enforced at Task 4 (maintainer-resolved checkpoint), satisfying D-08's "hand-authored" requirement.
- VALIDATION rows 00-08-02 (`_memory/` ≥15) and 00-08-03 (each query yaml has ≥3 entries) pass at Task 3.
- Referential integrity (Pitfall 5) verified twice: at Task 3 (against the 5 examples + `_memory/`) and at Task 4 (against the full extended fixture).
- Sentinel file (`_memory/.memory-sink`) present per ADR-004.
</verification>

<success_criteria>
- Fixture vault reaches 50–110 total notes at Task 4 (maintainer-resolved).
- All five top-level narrative folders populated with ≥3 notes each at Task 4.
- Claude's Task-2 contribution is exactly 5 example notes (one per folder); the rest is maintainer-authored per D-08.
- `_memory/` has ≥15 notes with full MEMORY_CONTRACT property coverage + at least one superseded entry.
- 7 query YAMLs (search, bundle, dossier, brief, graph, memory, contract) each with ≥3 D-09-schema entries.
- Every `expected_doc_ids` references an existing file at both Task 3 and Task 4 checkpoint times.
</success_criteria>

<output>
After completion, create `.planning/phases/00-foundation-decisions/00-09-SUMMARY.md` listing: total note count, per-folder counts, the 5 example notes Claude authored vs the rest maintainer-authored, `_memory/` provenance-label diversity (which `confidence` values appear, which `type` values appear), how many queries per category (Task-3 baseline vs Task-4 extension), and the maintainer-vs-Claude authorship split.
</output>