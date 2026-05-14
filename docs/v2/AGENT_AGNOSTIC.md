---
title: Agent-Agnostic Stance — v2
status: Accepted
phase: 0
tags: agent-agnostic, mcp, clients, skills
---

# Agent-Agnostic Stance — v2

**Status:** Accepted — Phase 0 foundation
**Date:** 2026-05-14
**Scope:** All public surface introduced from Phase 1 onward; spec for the
audit and CI enforcement work in Phase 1 (REQUIREMENTS.md ADP-10, ADP-11,
ADP-12).
**Companion:** This document is the **positive specification**. The matching
**verification** artifact is `docs/v2/AGENT_AGNOSTIC_AUDIT.md`, produced in
Phase 1 (ADP-11). Do not conflate the two.

## Stance

vault-memory exposes its capabilities over the **Model Context Protocol
(MCP)**. MCP is the canonical client interface. Any MCP-aware agent — Claude
(Desktop or Code), ChatGPT Custom Connectors, MCP Inspector, custom SDK
clients — is a first-class consumer. The contract is the MCP tool surface:
the JSON-RPC `tools/list` / `tools/call` shape exposed by `npx vault-memory
serve` over stdio, validated by the Zod schemas in `src/server.ts`. There is
exactly one boundary; everything an agent can do, it does through that
boundary.

Equally important — what vault-memory does **not** do. vault-memory does NOT
bundle a vendor-specific SDK in `src/`. vault-memory does NOT call out to
Anthropic-only APIs, ChatGPT-only APIs, or any other vendor-only surface.
vault-memory does NOT assume Claude (or any other agent) is in the loop.
vault-memory does NOT require Skills, projects, agent files, or any wrapper
artifact to function — those are convenience UX layered on top of MCP, not
preconditions for using MCP. The MCP server runs the same way whether the
caller is a stdio test harness with five lines of Node, a 1-million-token
agent, or `curl` piped through `jq`.

## Supported MCP-aware clients

vault-memory ships as one binary (`dist/cli.js`, registered as `vault-memory`)
that speaks MCP over stdio. Any client that speaks MCP can drive it. The
list below names the targets we explicitly validate against in Phase 1 and
beyond. It is not exhaustive — adding a new MCP-aware client is configuration,
not code.

- **Claude Desktop** — the reference deployment. The vault-memory README's
  install walkthrough configures Claude Desktop's `claude_desktop_config.json`
  to launch `vault-memory serve` as a stdio MCP server. Reference here means
  documented-first, not privileged: the wire protocol is identical for every
  client.
- **Claude Code** — the dev-loop client used by maintainers to operate
  vault-memory against their own vaults. Configured via per-vault `.mcp.json`
  written by `vault-memory add-vault --write`. Same MCP server, different
  client configuration file.
- **MCP Inspector** — the official client-agnostic MCP test harness
  (`@modelcontextprotocol/inspector`). Phase 1's `scripts/smoketest-non-claude.mjs`
  (ADP-10) exercises every tool through MCP Inspector — and only through
  MCP Inspector — to prove that no MCP feature in vault-memory depends on
  client-side affordances that only one agent vendor implements.
- **ChatGPT Custom Connectors** — consume the flat-shape `search`/`fetch`
  adapter contract documented in `src/server.ts` (the OB1-compatible
  `{id, title, url, snippet}` shape, with the same hybrid pipeline behind
  it). The `id` format `<vault>:<vault-relative-path>` is a presentation
  choice of this adapter; the underlying document identity remains the
  URI-style `DocId` from ADR-001.
- **Generic MCP SDK clients** — any future agent or tool that links the
  `@modelcontextprotocol/sdk` (TypeScript, Python, or other). The server's
  contract is the JSON-RPC surface; SDK choice is the caller's concern.

Bullets list the named targets for v2. Adding a new MCP-aware client (a CLI
runner, an editor plugin, a server-side automation) requires no change to
`src/`; the JSON-RPC surface is the integration point.

## Skills are one client

Obsidian "Skills" (the `.claude/skills/` pattern installed by
`scripts/install-skills.sh`) are a Claude-Code-specific UX wrapper. A Skill
is a prompt-and-instruction bundle that teaches Claude Code how to call a
set of MCP tools well: it discovers the tools, names them in natural-language
form, and tells Claude Code which to reach for given a user intent. It is
**convenience**, not API.

The distinction matters because reviewers and contributors regularly conflate
the two:

- **Skills depend on MCP.** A Skill cannot function without an MCP server
  exposing the tools it references; the MCP server is the substrate.
- **MCP does not depend on Skills.** Every vault-memory tool is fully usable
  by any MCP-aware client without any Skill installed. Removing
  `scripts/install-skills.sh` from the repo would break the Claude Code
  UX, not the contract.
- **Skills live outside `src/`.** `scripts/install-skills.sh` is a user-facing
  utility. There is no code path in the MCP server that looks at, requires,
  or executes a Skill; the server cannot tell whether a caller used a Skill
  to construct its request.
- **The canonical API is the MCP tool surface.** When this document, the
  ADRs, or the architecture doc say "the contract," they mean the tools
  enumerated by `tools/list` and called via `tools/call`. Skills are one
  way to invoke that contract from one client. They are equivalent in role
  to a custom function call from a Python script, a manual JSON-RPC ping
  from `curl`, or a future ChatGPT prompt template.

If a future client family ships its own equivalent — ChatGPT Custom
Instructions, a hypothetical "Inspector recipes", an editor-plugin
quick-action library — those wrappers are siblings of Skills, not
replacements. None of them changes the MCP surface; all of them are
optional UX.

## Anti-patterns

This section enumerates patterns that the v2 spec **forbids** in source code
under `src/`. The v1 codebase has historical debt of this kind catalogued
in `.planning/codebase/CONCERNS.md`; Phase 1's audit (ADP-11) inventories
it, Phase 1's CI greps (ADP-12) prevent regression. The forbidden patterns:

- **Hardcoded vendor strings in `src/` outside narrowly-scoped escape
  hatches.** No literal `claude`, `Claude`, `chatgpt`, `ChatGPT`, `anthropic`,
  `openai`, or similar vendor name in `src/` source code, except (a) user-
  facing strings in CLI helpers that mention a specific client by name as
  installation guidance (these are documentation, not code paths), (b)
  feature descriptions that name a known compatible client family (e.g.,
  the OB1-compatible `search`/`fetch` adapter mentioning "ChatGPT Custom
  Connectors, Claude.ai, Deep-Research" as a feature-compatibility note),
  and (c) within `scripts/install-skills.sh`, which is a Claude Code UX
  wrapper by design. CI greps in Phase 1 codify this allowlist.

- **Vendor-defaulted identifiers in audit and write paths.** The v1 codebase
  hardcodes a default `client_id` to a vendor name in `src/write/write.ts`
  (per the vendor-string debt catalogue in `.planning/codebase/CONCERNS.md`).
  The v2 default is `"unknown"` or `"mcp-client"` — never a vendor name.
  Audit trails attribute writes to the actual caller, not to a guess.

- **Assumption that the caller knows what a "Skill" is.** No MCP tool
  description, error message, or returned hint may reference Skills,
  projects, agent files, or any other client-side wrapper concept. Those
  concepts do not exist at the protocol layer.

- **Reliance on vendor-only environment variables.** No `ANTHROPIC_*`,
  `OPENAI_*`, `CLAUDE_*`, or similarly vendor-prefixed environment variable
  in `src/`. The only env vars vault-memory reads are `VAULT_MEMORY_*`
  (its own namespace) and well-known Node defaults. New env vars introduced
  in v2 are `VAULT_MEMORY_*` exclusively.

- **Hardcoded prompts shaped for one client's tool-call format.** vault-memory
  does not synthesize prompts for downstream LLMs; it returns structured
  data (`Document`, `SearchHit`, citation packets). Any future code path
  that does generate text for an LLM (the Phase 6 brief layer is the first
  candidate) must do so in a vendor-neutral form — Markdown plus structured
  metadata, not chat-formatted tool-call instructions.

- **Client-specific directories baked into the default config.** The v1
  default exclude-globs list contains `.claude/**` (per the CONCERNS.md
  catalog). The v2 default exclude-globs list is vendor-neutral; the
  `.claude/**` entry is added by the Claude Code Skill installer, not by
  `vault-memory add-vault`.

- **Tool descriptions or response strings that privilege one client.**
  Tool descriptions are part of the MCP `tools/list` payload and are read
  by every client. They must describe what the tool does, not how
  "Claude should use it" or "ChatGPT should call it." Mentioning a known
  compatible client family as a feature description is allowed when it
  carries information (e.g., flat-shape compatibility); marketing-style
  privileging is not.

These prohibitions are the spec; the audit (Phase 1, ADP-11) measures the
v1 codebase against them, and CI lints (Phase 1, ADP-12) prevent
regression.

## Verification

This document is the **spec** — a positive statement of what agent-agnostic
means for vault-memory. Verification is a separate concern, performed in
Phase 1 and enforced on every PR thereafter:

- **`docs/v2/AGENT_AGNOSTIC_AUDIT.md` (Phase 1, ADP-11)** — catalogues every
  existing assumption in `src/` that presumes Claude (or any other single
  client) is in the loop. The catalogue is the diff between the v1 reality
  and this document's stance.
- **`scripts/smoketest-non-claude.mjs` (Phase 1, ADP-10)** — runs the full
  v1 + v2 tool surface through MCP Inspector. If any tool requires
  Claude-side affordances to function, the smoke test catches it.
- **CI greps (Phase 1, ADP-12)** — `.github/workflows/ci.yml` runs grep
  lints over `src/` that fail the build if forbidden vendor strings or
  vendor-prefixed env-var references appear in non-allowlisted files.
- **Phase 9 adversarial review** — a separate review session reads this
  document alongside the ADRs and architecture doc to confirm that no
  client-specific assumption leaked into the Phase 1–8 design surface.

A claim in this document that lacks a verification mechanism listed above
is a defect of the spec, not of the codebase, and should be raised as a
revision to this file.

## See also

- `docs/v2/ARCHITECTURE.md` — system-level overview that names the MCP
  boundary as the only public surface.
- `docs/v2/adr/002-adapter-seams.md` — the `SourceConnector` /
  `DeliveryAdapter` / `ChangeFeed` interfaces; agent-agnosticism at the
  client boundary mirrors source-agnosticism at the source boundary.
- `docs/v2/MEMORY_CONTRACT.md` — the agent-write safety invariant; the
  memory namespace is the one rule that all clients must obey regardless
  of identity.
- `.planning/REQUIREMENTS.md` ADP-10 (MCP Inspector smoke test), ADP-11
  (agent-agnostic audit), ADP-12 (CI greps for vendor strings) — the
  Phase 1 work items that verify and enforce this stance.
- `.planning/codebase/CONCERNS.md` — the vendor-string debt catalogue
  (specifically, the section titled for the MCP-client-agnosticism debt)
  that this document defines "fixed" against.
