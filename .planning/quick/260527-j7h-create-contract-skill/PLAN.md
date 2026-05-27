---
phase: quick-260527-j7h
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - skills/create-contract/SKILL.md
  - skills/use-contracts/SKILL.md
  - scripts/install-skills.sh
autonomous: true
requirements: [QUICK-create-contract-skill]

must_haves:
  truths:
    - "A user can describe a recurring search/assembly need in free language and the create-contract skill walks them to a validated YAML contract written to _contracts/."
    - "The skill has a discovery mode that reads the memory-sink gap log, clusters recurring unmet requests, and proposes contract candidates."
    - "The skill has an artifact-schema mode (ADR-030) for defining precomputed artifact shapes."
    - "use-contracts logs a structured gap entry to the memory sink whenever no contract matches a request."
    - "install-skills.sh installs the new create-contract skill."
    - "The 324-test suite stays green with zero regression (no src/ change)."
  artifacts:
    - path: "skills/create-contract/SKILL.md"
      provides: "Interactive intent→design authoring skill with discovery + artifact-schema modes"
      contains: "name: create-contract"
    - path: "skills/use-contracts/SKILL.md"
      provides: "Additive gap-logging instruction on no-match"
      contains: "_contract-gaps"
    - path: "scripts/install-skills.sh"
      provides: "create-contract added to the installable skill set"
      contains: "create-contract"
  key_links:
    - from: "skills/create-contract/SKILL.md"
      to: "docs/v2/plugin/AUTHORING-CONTRACTS.md"
      via: "reference (lean-on, not duplicate)"
      pattern: "AUTHORING-CONTRACTS"
    - from: "skills/create-contract/SKILL.md (discovery mode)"
      to: "_memory/_contract-gaps/"
      via: "reads the gap log written by use-contracts"
      pattern: "_contract-gaps"
---

<objective>
Build a `create-contract` agent skill (sibling to `skills/use-contracts/`) that turns a
free-language description of a recurring search/knowledge-assembly need into an
**optimal, validated YAML contract** written to the vault's `_contracts/` directory.
The skill additionally covers (a) an **artifact-schema mode** for precomputed artifacts
(ADR-030) and (b) a **discovery mode** that reads a memory-sink gap log of unmet contract
requests, clusters them, and proposes the most frequent as contract candidates.

To feed discovery, `use-contracts` is taught (additively) to log a structured gap entry
into the memory sink (`_memory/_contract-gaps/`) whenever it concludes "no contract
matches".

Purpose: Close the authoring loop entirely at the skill + memory-sink layer, with ZERO
server changes — keeping the 324-test suite green and the memory-namespace invariant
intact.

Output: New `skills/create-contract/SKILL.md`, an additive edit to
`skills/use-contracts/SKILL.md`, and a one-line addition to `scripts/install-skills.sh`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@skills/use-contracts/SKILL.md
@scripts/install-skills.sh
@docs/v2/plugin/AUTHORING-CONTRACTS.md
@docs/v2/adr/028-workflows-vs-contracts.md
@docs/v2/adr/029-learning-loops-quality-signals.md
@docs/v2/adr/030-precompiled-artifacts.md
@src/contracts/contract-file-schema.ts

<interfaces>
<!-- Grounding facts the executor must honor; do not re-derive. -->

- Existing skills (all skills/<name>/SKILL.md): add-vault, audit-vault-health,
  find-stale-notes, install-vault-memory, triage-inbox, use-contracts, vm-install,
  vm-update.
- Contract YAML DSL, the 11-verb closed assembly enum, the `doc_ids` chaining rule,
  memory-sink + brief-LLM gotchas, and a minimal runnable 2-step meeting-prep example
  are ALL documented in docs/v2/plugin/AUTHORING-CONTRACTS.md. LEAN ON / reference it;
  do NOT duplicate its full content. The skill is the interactive intent→design bridge.
- Contract file schema lives in src/contracts/contract-file-schema.ts
  (ContractDocumentSchema). Contracts load from _contracts/*.yaml, hot-reloaded by
  startContractRegistry (src/contracts/loader.ts).
- Existing contracts are discoverable via the resource vault-memory://contracts/{vault}
  (same one use-contracts reads). create-contract must read it too, to avoid proposing
  duplicates.
- ADR-027 (verb-output normalization / doc_ids invariant) is NOT yet implemented →
  the skill MUST be honest that the reference-field picker is a Phase-8.5-not-yet-real
  item.
- ADR-028: contract = research, NOT action. The skill must enforce this boundary when
  helping users (anything that writes outside the sink or acts on the world = workflow,
  reject it).
- ADR-029: quality signals / learning loops are NOT implemented server-side. The
  gap-discovery loop is a precursor signal source realized at the skill layer; reference
  ADR-029 as the conceptual home.
- ADR-030: Artifact = typed/materialized/self-invalidating contract flavor; basis for
  the artifact-schema mode.

frontmatter shape (match use-contracts):
  ---
  name: <skill-name>
  description: <one paragraph with English + German trigger phrases>
  ---
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Author skills/create-contract/SKILL.md</name>
  <files>skills/create-contract/SKILL.md</files>
  <action>
Create the interactive authoring skill, mirroring the frontmatter shape of
skills/use-contracts/SKILL.md (a `name:` + a `description:` paragraph carrying English
AND German trigger phrases, e.g. "create a contract", "design a contract", "I keep asking
the same thing", "/create-contract", "neuen Contract erstellen", "Contract entwerfen",
"wir suchen immer wieder nach …").

Structure the body with these sections:

1. **When to invoke** — proactively when the user describes a recurring search/assembly
   need ("I keep pulling the same notes together for X"); explicitly on /create-contract.
   Contrast with use-contracts (which RUNS existing contracts).

2. **Default authoring mode (intent → validated YAML)**, an ordered workflow:
   - Read vault-memory://contracts/{vault} first to avoid proposing a duplicate of an
     existing contract.
   - The four design questions (inputs / seed / context / purpose) — reference
     AUTHORING-CONTRACTS.md Step 1 rather than restating its table in full.
   - Verb selection from the 11-verb closed assembly enum — point at the AUTHORING-CONTRACTS
     verb map; do NOT recopy the whole table.
   - doc_ids chaining rule — reference the AUTHORING-CONTRACTS chaining section.
   - memory-sink + brief-LLM setup, citing the gotchas doc.
   - Write the validated YAML to _contracts/<name>.yaml. FLAG clearly before any write:
     _contracts/ is the user's explicit contract directory, not the memory sink — confirm
     with the user before writing there.
   - "Test it before you trust it" handoff: instruct the user to run the new contract via
     use-contracts and verify the brief before relying on it.

3. **Discovery mode** — when invoked for discovery (or proactively when no contract
   matched recently): read the gap log at _memory/_contract-gaps/ in the memory sink,
   cluster recurring requests by intent shape, surface the most frequent as contract
   candidates, then flow the chosen candidate into the default authoring mode. Reference
   ADR-029 as the conceptual learning-loop home.

4. **Artifact-schema mode (ADR-030)** — help the user define a typed artifact schema
   (the precomputed, self-invalidating contract flavor). Reference ADR-030; be explicit
   that materialization/invalidation is a forward-looking concept, the skill here only
   helps shape the schema.

5. **Safety & boundaries** — contracts are RESEARCH not ACTION (ADR-028): reject any
   requested step that writes outside the memory sink or acts on the world, and redirect
   to "that's a workflow". Memory namespace is sacrosanct: skill-authored writes go ONLY
   to the labeled MemorySink (the gap log) or to _contracts/ (explicit, confirmed).

6. **Honesty about not-yet-real** — explicitly state the reference-field picker
   (verb-output normalization, ADR-027) is Phase 8.5 and not yet implemented; do not
   promise it.

7. **Bilingual** note and an **Out of scope** section (running contracts → use-contracts;
   any src/ server change; implementing ADR-029 signals server-side).

Lean on AUTHORING-CONTRACTS.md throughout — link to it, do not duplicate the DSL reference.
  </action>
  <verify>
    <automated>test -f skills/create-contract/SKILL.md && head -1 skills/create-contract/SKILL.md | grep -qx -- '---' && grep -q '^name: create-contract' skills/create-contract/SKILL.md && grep -q '_contract-gaps' skills/create-contract/SKILL.md && grep -q 'AUTHORING-CONTRACTS' skills/create-contract/SKILL.md && grep -qi 'phase 8.5\|8\.5' skills/create-contract/SKILL.md</automated>
  </verify>
  <done>SKILL.md exists with well-formed frontmatter (name: create-contract), covers default authoring + discovery + artifact-schema modes, references AUTHORING-CONTRACTS.md, names the gap log path, enforces the ADR-028 research-not-action boundary, and is honest about the Phase-8.5 reference-field picker.</done>
</task>

<task type="auto">
  <name>Task 2: Add additive gap-logging to use-contracts and register the skill in install-skills.sh</name>
  <files>skills/use-contracts/SKILL.md, scripts/install-skills.sh</files>
  <action>
In skills/use-contracts/SKILL.md: extend the existing "no contract matches" guidance
(currently in Phase 1, around lines 57-59) ADDITIVELY. When the skill concludes no
contract matches the user's intent, in addition to offering the alternatives, append a
structured gap entry to the memory sink at _memory/_contract-gaps/ (a plain MemorySink
write — falls under the existing safety invariant, never into user notes). The entry
should capture: the user's request (verbatim/paraphrased), the inferred intent shape, the
vault, and a timestamp. Note that these accumulated gaps feed the create-contract skill's
discovery mode. Keep this strictly additive — do not change any tool call or contract
behavior; it is guidance only. Add a cross-reference to the create-contract skill in the
Out of scope / authoring note (authoring now has a skill, not only the plugin editor).

In scripts/install-skills.sh: add `create-contract` to the SKILLS array (line ~20) and a
`create-contract) echo "SKILL.md" ;;` case to the files_for() function (around line
24-31). Note: use-contracts itself is not currently listed in this script's SKILLS array;
do not change that scope here beyond adding create-contract.
  </action>
  <verify>
    <automated>grep -q '_contract-gaps' skills/use-contracts/SKILL.md && grep -q 'create-contract' skills/use-contracts/SKILL.md && grep -q 'create-contract' scripts/install-skills.sh && bash -n scripts/install-skills.sh</automated>
  </verify>
  <done>use-contracts logs a structured gap entry to _memory/_contract-gaps/ on no-match (additive guidance, tool behavior unchanged) and cross-references create-contract; install-skills.sh lists create-contract in SKILLS and files_for, and still parses (bash -n).</done>
</task>

<task type="auto">
  <name>Task 3: Prove zero regression — full test suite + skill-parity guards</name>
  <files></files>
  <action>
Run the full test suite as a regression guard even though no src/ changed, to PROVE the
324-test count holds. Then confirm skill frontmatter parity with use-contracts. No code
edits in this task unless a guard fails (if a guard fails, return to Task 1/2 to fix the
authored Markdown — do NOT touch src/).
  </action>
  <verify>
    <automated>npm test 2>&1 | tail -20 | grep -Eq 'Tests +(324|3[2-9][0-9]|[4-9][0-9]{2})'</automated>
  </verify>
  <done>npm test reports 324 or more passing tests (zero regression), and both SKILL.md files have well-formed `name:`/`description:` frontmatter matching the use-contracts pattern.</done>
</task>

</tasks>

<verification>
- `test -f skills/create-contract/SKILL.md` — new skill exists with valid frontmatter.
- `grep _contract-gaps skills/use-contracts/SKILL.md` — gap-logging step added.
- `grep create-contract scripts/install-skills.sh` && `bash -n scripts/install-skills.sh` — installer updated and parses.
- `npm test` — 324+ tests pass; zero regression (the load-bearing proof that the
  skill-only change touched nothing in src/).
</verification>

<success_criteria>
- create-contract skill delivers all three modes (authoring, discovery, artifact-schema),
  leans on AUTHORING-CONTRACTS.md, enforces ADR-028 research-not-action, and is honest
  about Phase-8.5 not-yet-real items.
- use-contracts gap-logging is additive (no tool/behavior change) and writes only to the
  memory sink.
- installer registers the new skill.
- Full test suite stays at 324+ passing — proven, not assumed.
</success_criteria>

<out_of_scope>
Stated explicitly:
- ANY `src/` server change, new MCP tool, new DB table, new server Zod schema, or
  server-side LLM call.
- Implementing ADR-029 quality signals in the server.
- Implementing verb-output normalization (ADR-027 / Phase 8.5) itself — the skill only
  acknowledges it as not-yet-real.
- New unit tests for skill prose (none exist for Markdown skills); the test run is a
  regression guard, not new coverage.
- A separate docs/v2 ADR pointer for the gap-discovery loop is judged NOT warranted for
  this quick task; the ADR-029 reference inside the skill suffices.
</out_of_scope>

<commit_messages>
Task 1:
  feat(skills): add create-contract authoring skill (intent→YAML + discovery + artifact modes)

  Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

Task 2:
  feat(skills): log unmet-request gaps from use-contracts; install create-contract

  Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

Task 3 (only if any guard required a fix; otherwise fold verification into the above):
  test(skills): verify zero regression for create-contract skill addition

  Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
</commit_messages>

<output>
Create `.planning/quick/260527-j7h-create-contract-skill/SUMMARY.md` when done.
</output>
