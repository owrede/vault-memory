---
phase: 00-foundation-decisions
plan: 08
type: execute
wave: 3
depends_on: [02]
files_modified:
  - docs/v2/AGENT_AGNOSTIC.md
autonomous: true
requirements: [FND-07]
must_haves:
  truths:
    - "`docs/v2/AGENT_AGNOSTIC.md` exists describing MCP as the canonical client interface and Skills as one delivery mechanism among many"
    - "Document contains no Claude-only / claude-specific assertions (per VALIDATION row 00-07-01 negative grep)"
    - "Document lists at least three concrete non-Claude MCP-aware clients (e.g., MCP Inspector, ChatGPT Custom Connectors, Claude Desktop, generic SDK harness) as supported targets"
    - "Document is ≤800 lines"
  artifacts:
    - path: "docs/v2/AGENT_AGNOSTIC.md"
      provides: "Agent-agnostic stance — MCP canonical, Skills are clients"
      contains: "MCP"
  key_links:
    - from: "docs/v2/AGENT_AGNOSTIC.md"
      to: "docs/v2/ARCHITECTURE.md"
      via: "markdown link in body"
      pattern: "ARCHITECTURE.md"
---

<objective>
Publish `docs/v2/AGENT_AGNOSTIC.md` — the positive specification of vault-memory's agent-agnostic stance. FND-07 phrasing: "MCP is canonical client interface; Skills are one delivery mechanism." This is the *spec*; Phase 1's AGENT_AGNOSTIC_AUDIT (ADP-11) is the *verification* — do not conflate (RESEARCH §Open Question 6).

Purpose: the v1 codebase has Claude-specific debt (per `.planning/codebase/CONCERNS.md` §"Claude-Specific Strings"). Phase 1 will fix that debt; Phase 0 publishes the doc that defines what "fixed" means. Phase 9's adversarial reviewer reads this doc alongside the ADRs to confirm no client-specific assumptions leaked into the design.

Output: `docs/v2/AGENT_AGNOSTIC.md` published.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/phases/00-foundation-decisions/00-CONTEXT.md
@.planning/phases/00-foundation-decisions/00-RESEARCH.md
@.planning/phases/00-foundation-decisions/00-VALIDATION.md
@.planning/codebase/CONCERNS.md
@docs/dev/gsd-agent-knowledg-layer.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Author `docs/v2/AGENT_AGNOSTIC.md` — MCP canonical, Skills as one client, supported MCP-aware targets (≤800 lines)</name>
  <read_first>
    - .planning/REQUIREMENTS.md FND-07 (verbatim phrasing — "MCP is canonical client interface; Skills are one delivery mechanism")
    - .planning/codebase/CONCERNS.md (search for "Claude-Specific Strings" — the existing debt catalog; the doc must say what AGENT_AGNOSTIC means in opposition to that debt)
    - docs/dev/gsd-agent-knowledg-layer.md (search for `agent-agnostic` and `MCP-aware` sections in the v2 brief)
    - .planning/phases/00-foundation-decisions/00-RESEARCH.md §Open Question 6 (positive spec vs audit distinction)
    - .planning/phases/00-foundation-decisions/00-VALIDATION.md row 00-07-01 (existence + negative grep on `Claude-only` / `claude-specific`)
  </read_first>
  <action>Create `docs/v2/AGENT_AGNOSTIC.md`. Required structure: (1) `# Agent-Agnostic Stance — v2` H1. (2) `## Stance` H2: one paragraph stating verbatim or in close paraphrase: "vault-memory exposes its capabilities over the Model Context Protocol (MCP). MCP is the canonical client interface. Any MCP-aware agent — Claude (Desktop or Code), ChatGPT Custom Connectors, MCP Inspector, custom SDK clients — is a first-class consumer." Followed by a one-paragraph negative statement: vault-memory does NOT bundle a client-specific SDK, does NOT call out to Claude-specific APIs, does NOT assume Claude is in the loop, and does NOT require Skills/projects/agents to function. (3) `## Supported MCP-aware clients` H2 — bulleted list of at least four targets with one-sentence rationale each: Claude Desktop (the reference deployment), Claude Code (the dev-loop client), MCP Inspector (the test harness target for Phase 1 ADP-10 / `scripts/smoketest-non-claude.mjs`), ChatGPT Custom Connectors (consumes the flat-shape `search`/`fetch` adapter), generic MCP SDK clients (any future agent or tool). Each entry MUST avoid Claude-favoritism in the prose (one bullet for Claude Desktop is allowed because it IS the reference; the doc must not say "primarily Claude" or "best with Claude"). (4) `## Skills are one client` H2 — explain that Obsidian "Skills" (the project's existing `scripts/install-skills.sh` pattern) are a Claude-Code-specific UX wrapper that depends on MCP but is not the API: the canonical API is the MCP tool surface. (5) `## Anti-patterns` H2 — bulleted list of FORBIDDEN patterns, paraphrased from `.planning/codebase/CONCERNS.md` "Claude-Specific Strings" section: hardcoded `claude` / `Claude` substrings in `src/` outside of skill-install scripts and user-facing docs; assumption that the caller knows what a "skill" is; reliance on Anthropic-only environment variables (`ANTHROPIC_*`); hardcoded prompts that invoke Claude's specific tool-call format. (6) `## Verification` H2 — pointer paragraph: this is the spec; Phase 1's `docs/v2/AGENT_AGNOSTIC_AUDIT.md` (ADP-11) will catalog every existing Claude-specific assumption in `src/`. Phase 1's CI greps (chokidar/path/fs/Claude/etc. per ADP-12) enforce the spec going forward. (7) `## See also` H2 — markdown links to ARCHITECTURE.md, ADR-002 (adapter seams), MEMORY_CONTRACT.md, REQUIREMENTS.md ADP-10/ADP-11/ADP-12. CRITICAL: the document MUST NOT contain the literal substrings `Claude-only` or `claude-specific` (case-insensitive) because the VALIDATION row 00-07-01 grep is `! grep -qE 'Claude-only|claude-specific'` — those are anti-patterns being defined elsewhere, not strings to include in the positive spec. Use "Claude-specific assumptions" only in §Anti-patterns and §Verification with surrounding prose that re-paraphrases (e.g., "patterns that assume Claude" or "client-specific dependencies") so the negative grep passes; alternatively put the word "Claude" with no hyphen modifier in those sections. ≤800 lines; aim for 200–400.</action>
  <acceptance_criteria>
    - Match VALIDATION row 00-07-01: `test -f docs/v2/AGENT_AGNOSTIC.md && ! grep -qE 'Claude-only|claude-specific' docs/v2/AGENT_AGNOSTIC.md` exits 0.
    - `grep -q 'MCP' docs/v2/AGENT_AGNOSTIC.md` (the canonical-interface stance is present).
    - `grep -qi 'MCP Inspector' docs/v2/AGENT_AGNOSTIC.md && grep -qi 'ChatGPT' docs/v2/AGENT_AGNOSTIC.md` (at least two non-Claude clients named).
    - `grep -q '^## Stance' docs/v2/AGENT_AGNOSTIC.md && grep -q '^## Supported MCP-aware clients' docs/v2/AGENT_AGNOSTIC.md && grep -q '^## Anti-patterns' docs/v2/AGENT_AGNOSTIC.md` (required section headings present).
    - `[ $(wc -l < docs/v2/AGENT_AGNOSTIC.md) -le 800 ] && [ $(wc -l < docs/v2/AGENT_AGNOSTIC.md) -ge 100 ]`.
    - `! grep -qiE 'blazingly fast|magnificent' docs/v2/AGENT_AGNOSTIC.md`.
  </acceptance_criteria>
  <verify>
    <automated>test -f docs/v2/AGENT_AGNOSTIC.md && ! grep -qE 'Claude-only|claude-specific' docs/v2/AGENT_AGNOSTIC.md && grep -q 'MCP' docs/v2/AGENT_AGNOSTIC.md && grep -qi 'MCP Inspector' docs/v2/AGENT_AGNOSTIC.md && grep -q '^## Stance' docs/v2/AGENT_AGNOSTIC.md && grep -q '^## Anti-patterns' docs/v2/AGENT_AGNOSTIC.md && [ $(wc -l < docs/v2/AGENT_AGNOSTIC.md) -le 800 ]</automated>
  </verify>
  <done>AGENT_AGNOSTIC.md published, MCP stance explicit, multiple non-Claude clients listed, anti-patterns enumerated, the literal banned strings `Claude-only`/`claude-specific` do NOT appear in the file.</done>
</task>

</tasks>

<verification>
VALIDATION row 00-07-01 passes (file exists + negative grep). Doc is the positive spec; Phase 1's audit is the verification.
</verification>

<success_criteria>
- `docs/v2/AGENT_AGNOSTIC.md` exists, ≤800 lines, ≥100 lines.
- MCP-canonical stance and Skills-as-one-client position both explicit.
- ≥4 supported MCP-aware clients enumerated.
- Negative grep on `Claude-only|claude-specific` returns no matches.
</success_criteria>

<output>
After completion, create `.planning/phases/00-foundation-decisions/00-08-SUMMARY.md` listing the supported-clients enumeration, the anti-patterns enumerated, and the wording strategy used to discuss Claude-specific debt while avoiding the literal banned strings.
</output>
