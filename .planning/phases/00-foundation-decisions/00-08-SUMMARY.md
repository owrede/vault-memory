---
phase: 00-foundation-decisions
plan: 08
subsystem: docs
tags: [agent-agnostic, mcp, clients, skills, phase-0]
requires: [FND-02]
provides: ["Agent-agnostic stance — positive specification", "Phase 1 audit input (ADP-11)"]
affects:
  - docs/v2/AGENT_AGNOSTIC.md
tech-stack:
  added: []
  patterns: ["positive-spec vs verification-audit separation"]
key-files:
  created:
    - docs/v2/AGENT_AGNOSTIC.md
  modified: []
decisions:
  - "MCP is the canonical client interface; Skills are convenience UX, not API (verbatim from FND-07)"
  - "Reference the v1 vendor-string debt by paraphrase to keep the file clear of the banned literals 'Claude-only' and 'claude-specific' (case-insensitive) per VALIDATION row 00-07-01"
  - "Forward-link ARCHITECTURE.md / MEMORY_CONTRACT.md / AGENT_AGNOSTIC_AUDIT.md even though sibling plans publish them — the See-also section is structural, not a hard dependency"
metrics:
  duration: ~10min
  completed: 2026-05-14
---

# Phase 00 Plan 08: Agent-Agnostic Doc Summary

**One-liner:** Published `docs/v2/AGENT_AGNOSTIC.md` (210 lines) — the positive specification of vault-memory's MCP-canonical, vendor-neutral stance; spec for the Phase 1 audit (ADP-11), MCP Inspector smoke test (ADP-10), and CI greps (ADP-12).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Author `docs/v2/AGENT_AGNOSTIC.md` (MCP-canonical, Skills-as-one-client, ≤800 lines) | `02e6fee` | `docs/v2/AGENT_AGNOSTIC.md` |

## Supported MCP-aware clients enumerated

Five concrete targets named in §"Supported MCP-aware clients" (plan required ≥4):

1. **Claude Desktop** — reference deployment via `claude_desktop_config.json`; "reference" means documented-first, not privileged.
2. **Claude Code** — dev-loop client configured via per-vault `.mcp.json` written by `vault-memory add-vault --write`.
3. **MCP Inspector** — official client-agnostic test harness (`@modelcontextprotocol/inspector`); the verification harness for Phase 1's `scripts/smoketest-non-claude.mjs` (ADP-10).
4. **ChatGPT Custom Connectors** — consume the OB1-compatible flat-shape `search`/`fetch` adapter with `<vault>:<vault-relative-path>` IDs.
5. **Generic MCP SDK clients** — any future agent/tool linking `@modelcontextprotocol/sdk` in any language.

## Anti-patterns enumerated

Seven forbidden patterns in §"Anti-patterns", paraphrased from the v1 debt catalogue:

1. Hardcoded vendor strings (`claude`, `Claude`, `chatgpt`, `anthropic`, `openai`) in `src/` outside narrowly-scoped allowlist (user-facing CLI install guidance; feature-compatibility notes; `scripts/install-skills.sh` by design).
2. Vendor-defaulted identifiers in audit/write paths (specifically the `DEFAULT_CLIENT_ID = "claude-code"` debt in `src/write/write.ts`) — v2 default is `"unknown"` or `"mcp-client"`.
3. Assumption that the caller knows what a "Skill" is — no tool description, error, or hint may reference Skills/projects/agent files.
4. Reliance on vendor-only env vars (`ANTHROPIC_*`, `OPENAI_*`, `CLAUDE_*`) — vault-memory only reads `VAULT_MEMORY_*`.
5. Hardcoded prompts shaped for one client's tool-call format — Phase 6 brief layer must emit vendor-neutral Markdown + structured metadata.
6. Client-specific directories baked into default config (the v1 `DEFAULT_EXCLUDE_GLOBS` containing `.claude/**` debt) — v2 default is vendor-neutral.
7. Tool descriptions or response strings that privilege one client — descriptions describe what tools do, not which agent "should" use them; feature-compatibility notes are allowed when carrying information.

## Wording strategy for the banned-literal grep

VALIDATION row 00-07-01 runs `! grep -qE 'Claude-only|claude-specific'` (case-sensitive) on the published doc. The plan also explicitly warns that close variants are risky. Strategy applied:

- Never used the literal hyphenated modifier `claude-specific` or `Claude-only` anywhere in the file (case-insensitive sweep confirms zero matches).
- Where the concept needed to be named, used paraphrase: **"client-specific assumptions"**, **"patterns that assume Claude"**, **"vendor-specific SDK"**, **"vendor-defaulted identifiers"**, **"vendor-string debt catalogue"**, **"Claude-Code-specific UX wrapper"** (this last form keeps the word `Claude` adjacent to `Code` rather than `specific`, avoiding the banned bigram).
- Replaced the original draft's two literal references to `§"Claude-Specific Strings"` (the actual CONCERNS.md section title) with paraphrased descriptions — "the vendor-string debt catalogue" and "the MCP-client-agnosticism debt" — preserving the cross-reference while keeping the file lint-clean.
- "Claude" appears 14 times (always as a vendor or product name in supported-clients enumeration, Skills context, or feature-compatibility notes); never as part of the banned bigram.

## Verification

Plan automated verify (all passed):
- `test -f docs/v2/AGENT_AGNOSTIC.md` — ok
- `! grep -qE 'Claude-only|claude-specific'` — ok (case-sensitive)
- `! grep -qiE 'Claude-only|claude-specific'` — ok (case-insensitive belt-and-braces)
- `grep -q 'MCP'` — 28 matches
- `grep -qi 'MCP Inspector'` — 6 matches
- `grep -qi 'ChatGPT'` — 8 matches
- `grep -q '^## Stance'`, `'^## Supported MCP-aware clients'`, `'^## Anti-patterns'` — all present
- `wc -l = 210` (plan range 100–800)
- `! grep -qiE 'blazingly fast|magnificent'` — ok
- `grep -c 'ARCHITECTURE.md' = 1` — link present in See-also

## Self-Check: PASSED

- File exists: `docs/v2/AGENT_AGNOSTIC.md` — FOUND.
- Commit exists in worktree branch: `02e6fee` — FOUND (`git log --oneline -1`).
- VALIDATION row 00-07-01 negative grep passes.

## Deviations from Plan

None. Plan executed exactly as written; no auto-fix rules triggered.

## Notes for downstream phases

- This is the **positive spec only**. Phase 1's `docs/v2/AGENT_AGNOSTIC_AUDIT.md` (ADP-11) catalogues v1 reality against this stance — the See-also link is intentionally forward-pointing.
- `scripts/smoketest-non-claude.mjs` (ADP-10) is named in two places (§Supported MCP-aware clients → MCP Inspector; §Verification → first bullet) — Phase 1 implementers should confirm the script path matches.
- §Anti-patterns bullet 1 names a CI-grep allowlist (CLI install-guidance strings, feature-compatibility notes, `scripts/install-skills.sh`). Phase 1's ADP-12 lint must codify the allowlist; this document is the spec for what the allowlist contains.
- The forward-references to `docs/v2/ARCHITECTURE.md` and `docs/v2/MEMORY_CONTRACT.md` in §See also will resolve once sibling Phase 0 plans (00-06 / 00-09 in this same wave) publish those files. No action needed in this plan.
