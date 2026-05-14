---
phase: 00-foundation-decisions
plan: 14
type: execute
wave: 5
depends_on: [02, 03, 04, 05, 06, 07, 08, 13]
files_modified:
  - docs/v2/adr/ADVERSARIAL-REVIEW.md
  - docs/v2/adr/001-document-identity.md
  - docs/v2/adr/002-adapter-seams.md
  - docs/v2/adr/003-document-shape.md
  - docs/v2/adr/004-memory-sink-handles.md
  - docs/v2/adr/README.md
autonomous: false
requirements: [FND-04]
user_setup:
  - service: separate-claude-session
    why: "Per D-15 + D-16, the adversarial review MUST run in a fresh Claude session with the `gsd-advisor-researcher` agent acting as a hostile Phase-10 implementer. The reviewer must NOT have seen this planning context — the whole point is unbiased review of whether the ADRs+arch-docs alone (no v2 brief, no source code) are sufficient for a Notion-adapter implementation plan."
must_haves:
  truths:
    - "`docs/v2/adr/ADVERSARIAL-REVIEW.md` exists with at least 4 numbered findings (≥1 per ADR is the floor; healthy outcome is 3–8 total per RESEARCH Pitfall 6)"
    - "Every finding has explicit `Status: Amended` (with a commit SHA reference) OR `Status: Deferred-v3` (with a one-line rationale and corresponding entry in `docs/v2/adr/README.md` Open ADRs)"
    - "No silent ignores — every finding terminates in one of the two states"
    - "ADR amendments resulting from `Amended` findings are committed into the appropriate ADR file"
  artifacts:
    - path: "docs/v2/adr/ADVERSARIAL-REVIEW.md"
      provides: "Adversarial findings ledger + disposition"
      contains: "Finding"
  key_links:
    - from: "docs/v2/adr/ADVERSARIAL-REVIEW.md"
      to: "docs/v2/adr/001..004 + Open ADRs section of README.md"
      via: "per-finding status pointer"
      pattern: "Amended.*[0-9a-f]{7,}|Deferred-v3"
---

<objective>
Execute the FND-04 adversarial review — the one non-formal gate in Phase 0 that confirms a Phase-10 Notion implementer could ship a working adapter from `docs/v2/adr/001..004` + the three architecture docs alone (no source code, no v2 brief). Per D-15, the review runs in a separate Claude session with the `gsd-advisor-researcher` agent given ONLY the seven canonical docs as input. Per D-16, the review is NOT a real spike (no Notion-skeleton code) — the gate is "are the ADRs unambiguous on what they DO cover", not "is v3 already designed".

Per RESEARCH §Pitfall 6, a healthy outcome is 3–8 findings, ~half amended into ADR text, ~half marked `Deferred-v3` with explicit rationale and matching entries in the ADR-index Open-ADRs section (plan 13). Rubber-stamp output ("ADRs are comprehensive") is a failure mode — the prompt template from RESEARCH §Pitfall 6 forces concrete numbered findings.

Plan is `autonomous: false` because Task 1 is run by the maintainer in a separate Claude session, NOT inside the execute-plan loop (the executor cannot spawn a fresh context with restricted document access from within its own context).

Output: `ADVERSARIAL-REVIEW.md` ledger + any ADR amendments resulting from findings.
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
@.planning/phases/00-foundation-decisions/00-13-SUMMARY.md
</context>

<tasks>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 1: Maintainer runs adversarial review in a fresh Claude session</name>
  <what-built>All four v2 ADRs are accepted at `docs/v2/adr/001..004-*.md` with Invariants + Examples. Three architecture docs are published at `docs/v2/{ARCHITECTURE,MEMORY_CONTRACT,AGENT_AGNOSTIC}.md`. ADR index `docs/v2/adr/README.md` is finalized with 4 Accepted + 14 Open rows. Phase 0 is ready for adversarial scrutiny.</what-built>
  <how-to-verify>
    Run the review as a Manual-Only task. Steps:

    **(1) Open a new Claude Code session in this repo.** Do NOT load this plan or any planning context — the whole point of the gate is review by a session that has NOT seen the v2 brief, the planning research, or `src/`.

    **(2) Spawn the `gsd-advisor-researcher` agent** (per D-15) with the following exact prompt (verbatim from RESEARCH §Pitfall 6 — adjust only the date if needed):

    ```
    You are a v3 Phase-10 contractor with funding to ship a Notion source-connector,
    delivery-adapter, and change-feed adapter for vault-memory. You have access ONLY
    to these documents:
      - docs/v2/adr/001-document-identity.md
      - docs/v2/adr/002-adapter-seams.md
      - docs/v2/adr/003-document-shape.md
      - docs/v2/adr/004-memory-sink-handles.md
      - docs/v2/ARCHITECTURE.md
      - docs/v2/MEMORY_CONTRACT.md
      - docs/v2/AGENT_AGNOSTIC.md

    You may NOT look at vault-memory's source code, the v2 brief
    (docs/dev/gsd-agent-knowledg-layer.md), or any other documents.
    Produce a Notion-adapter implementation plan (interface signatures,
    schema mapping, edge cases). At every point where the ADRs/architecture leave
    a decision unspecified, file a numbered Finding in ADVERSARIAL-REVIEW.md:

      ### Finding N
      **ADR / doc**: <which document, section>
      **Ambiguity**: <one-sentence description>
      **Impact on Notion adapter**: <concrete decision the implementer must invent>
      **Recommended resolution**: <one of: ADR amendment / index "Deferred-v3" row>
      **Status**: Open

    Findings should be specific enough that a maintainer can either (a) commit a
    text amendment to the ADR, or (b) mark the deferral in the index. Vague
    findings ("ADR-X is unclear") are useless — rewrite until specific.

    Stop when you have produced a complete plan OR you have ≥10 findings,
    whichever comes first.
    ```

    **(3) Save the agent's output verbatim to `docs/v2/adr/ADVERSARIAL-REVIEW.md`.** Header: `# Adversarial Review — Phase 0 ADRs + Architecture`. Include the prompt used (so future audits can re-run it) plus the agent's findings in numbered `### Finding N` form per the template.

    **(4) Verify health (per RESEARCH §Pitfall 6 warning signs):**
      - ZERO findings → rubber-stamp; reject and re-run with a stricter prompt (this would be Assumption A2 failing).
      - All findings `Deferred-v3` → ADRs are not being tightened; reject and ask the reviewer to identify which findings are amendable now.
      - Healthy: 3–8 findings, ~half `Recommended resolution: ADR amendment` (will become `Status: Amended` after Task 2) + ~half `Recommended resolution: index Deferred-v3` (will become `Status: Deferred-v3` after Task 2 cross-links to the Open ADRs in plan 13's output).

    **(5) Resume the original Claude session** (the one running this plan) and reply `approved`, attaching: the finding count, the amend-vs-defer split, and the path `docs/v2/adr/ADVERSARIAL-REVIEW.md`.
  </how-to-verify>
  <acceptance_criteria>
    - `docs/v2/adr/ADVERSARIAL-REVIEW.md` exists with at least 4 `### Finding N` headings (matches VALIDATION row 00-17-01 — ≥4 findings = ≥1 per ADR floor).
    - Maintainer confirms the prompt-template + agent identity (`gsd-advisor-researcher`) matches D-15.
    - Maintainer attests in the resume signal that the agent had access ONLY to the 7 canonical docs and not to the v2 brief or `src/`.
  </acceptance_criteria>
  <resume-signal>Reply `approved` with finding count + amend/defer split. If any health check failed (zero findings, all deferred), reply `re-run needed because <reason>` and re-execute Task 1 with a tightened prompt before proceeding.</resume-signal>
</task>

<task type="auto">
  <name>Task 2: Disposition each finding — amend ADRs in place OR add a `Deferred-v3` index entry; update every finding's Status field</name>
  <read_first>
    - docs/v2/adr/ADVERSARIAL-REVIEW.md (Task 1 output)
    - All four ADRs (any one might need an amendment)
    - docs/v2/adr/README.md (Open ADRs section — additions may go here)
    - .planning/phases/00-foundation-decisions/00-CONTEXT.md (D-15 — never silently ignored; each finding terminates in Amended or Deferred-v3)
    - .planning/phases/00-foundation-decisions/00-VALIDATION.md row 00-17-02 (`grep -cE '^Status: (Amended|Deferred-v3)'` must equal finding count)
  </read_first>
  <action>For each `### Finding N` in `ADVERSARIAL-REVIEW.md`: (1) Read the finding's `Recommended resolution`. (2) If `ADR amendment`: edit the named ADR section to tighten the ambiguous text (adding additional Invariants, expanding Examples, adding a missing edge-case clause). Commit per ADR with message `docs(adr-NNN): amend per ADVERSARIAL-REVIEW finding N — <one-line>`. Capture the commit SHA (`git rev-parse --short HEAD`). Update the finding's `**Status**:` field FROM `Open` TO `Amended in <SHA>` (literal substring `Status: Amended` must appear so VALIDATION grep matches). (3) If `index Deferred-v3`: open `docs/v2/adr/README.md`, add a row to the `## Open ADRs (v3 / Phase 10)` table (or the bullet list) capturing the finding's theme (if not already present from plan 13's 14-stub list — plan 13 enumerated the major themes; the adversarial review may surface a narrower v3 question that fits as a sub-bullet or additional row). Use `Status: Open` and `Phase: v3-Phase-10` per D-22. Then update the finding's `**Status**:` field FROM `Open` TO `Deferred-v3 (index row added)` or similar — literal substring `Status: Deferred-v3` must appear. (4) After all findings are dispositioned, commit the updated `ADVERSARIAL-REVIEW.md` + (if any) updated `docs/v2/adr/README.md`. Confirm: zero findings remain with `Status: Open`. Add an `## Audit` section at the bottom of `ADVERSARIAL-REVIEW.md` listing: prompt used (link or reference), agent identity (`gsd-advisor-researcher`), date, finding count, amend count, defer count, list of resulting commit SHAs.</action>
  <acceptance_criteria>
    - Match VALIDATION row 00-17-01: `test -f docs/v2/adr/ADVERSARIAL-REVIEW.md && [ $(grep -cE '^### Finding' docs/v2/adr/ADVERSARIAL-REVIEW.md) -ge 4 ]` exits 0.
    - Match VALIDATION row 00-17-02: `[ $(grep -cE '^### Finding' docs/v2/adr/ADVERSARIAL-REVIEW.md) -eq $(grep -cE '^\\*\\*Status\\*\\*: (Amended|Deferred-v3)|^Status: (Amended|Deferred-v3)' docs/v2/adr/ADVERSARIAL-REVIEW.md) ]` exits 0 (every finding has been dispositioned to one of the two terminal states).
    - No `Status: Open` findings remain: `! grep -qE '^\\*\\*Status\\*\\*: Open|^Status: Open' docs/v2/adr/ADVERSARIAL-REVIEW.md`.
    - `## Audit` section present at file bottom with date and SHAs: `grep -q '^## Audit' docs/v2/adr/ADVERSARIAL-REVIEW.md`.
  </acceptance_criteria>
  <verify>
    <automated>test -f docs/v2/adr/ADVERSARIAL-REVIEW.md && [ $(grep -cE '^### Finding' docs/v2/adr/ADVERSARIAL-REVIEW.md) -ge 4 ] && ! grep -qE '^\*\*Status\*\*: Open$|^Status: Open$' docs/v2/adr/ADVERSARIAL-REVIEW.md && [ $(grep -cE '^### Finding' docs/v2/adr/ADVERSARIAL-REVIEW.md) -eq $(grep -cE '^\*\*Status\*\*: (Amended|Deferred-v3)|^Status: (Amended|Deferred-v3)' docs/v2/adr/ADVERSARIAL-REVIEW.md) ] && grep -q '^## Audit' docs/v2/adr/ADVERSARIAL-REVIEW.md</automated>
  </verify>
  <done>Every finding has been amended into an ADR (commit SHA captured) or deferred to v3 with an index row; no silent ignores; audit trail in `ADVERSARIAL-REVIEW.md`.</done>
</task>

</tasks>

<verification>
- VALIDATION rows 00-17-01 (≥4 findings) + 00-17-02 (no silent ignores) pass.
- Spot-check: every `Amended` finding has a referenced commit SHA that exists in `git log`.
- Spot-check: every `Deferred-v3` finding has a matching entry visible in `docs/v2/adr/README.md` Open ADRs section.
</verification>

<success_criteria>
- Adversarial review ran in a fresh session per D-15.
- ≥4 findings, with health-check criteria met (not all `Deferred`, not zero).
- Each finding has a terminal status (Amended or Deferred-v3).
- Audit trail captured.
</success_criteria>

<output>
After completion, create `.planning/phases/00-foundation-decisions/00-14-SUMMARY.md` listing: total findings, amend/defer split, list of resulting commit SHAs (for the SIGN-OFF.md FND-04 row), and any maintainer notes from re-run cycles if Task 1 had to be repeated.
</output>
