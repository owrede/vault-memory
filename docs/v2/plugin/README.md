# vault-memory Obsidian plugin — docs

> Phase 7 / v2.0.0 — vault-memory Obsidian plugin / Last verified: 2026-05-19

The vault-memory plugin is the L5 user surface for the v2 agentic knowledge
layer. It registers an Obsidian view for `.contract` files (the visual
task-contract editor) and adds plugin chrome — settings, secrets, manual
reindex, stats, peer-MCP connectors — so vault-memory is operable from inside
Obsidian without dropping to a terminal.

Architectural decisions and rationale live in
[ADR-007](../adr/007-contract-editor.md). The five docs below cover the
user-facing surface — one user task per file.

## Contents

| Doc | Covers |
|---|---|
| [INSTALL.md](INSTALL.md) | Installing the plugin via the `vm-install` skill or manual sideload; prerequisites; verification; uninstall. |
| [SETTINGS.md](SETTINGS.md) | Every settings key; restart-required vs hot-swappable behavior; persistence path. |
| [SECRETS.md](SECRETS.md) | OS-keyring integration via Electron `safeStorage`; `${secret:name}` references; per-device ciphertext implications; Linux `basic_text` fallback. |
| [CONTRACT-EDITOR.md](CONTRACT-EDITOR.md) | Authoring a `.contract` end-to-end; palette/canvas/inspector workflow; save cycle; external-edit reload prompt. |
| [CONNECTORS.md](CONNECTORS.md) | Adding peer-MCP clients; secret references in connector env; test-connection; remove. |

## Order to read

A new user installing for the first time:

1. [INSTALL.md](INSTALL.md) — install the plugin.
2. [SETTINGS.md](SETTINGS.md) — verify the server endpoint and embedding
   model match your environment.
3. [CONTRACT-EDITOR.md](CONTRACT-EDITOR.md) — author a first contract from
   one of the `examples/contracts/*.contract` fixtures.
4. [SECRETS.md](SECRETS.md) — only if you plan to use peer-MCP connectors
   that need credentials.
5. [CONNECTORS.md](CONNECTORS.md) — only if you plan to spawn external MCP
   servers from contracts.

## Related references

- [ADR-007 — Contract Editor](../adr/007-contract-editor.md) — design
  decisions, rejected alternatives, canonicalization rules.
- [ADR-006 — Task Contract DSL](../adr/006-task-contract-dsl.md) — the
  contract YAML shape the plugin emits.
- [docs/v2/AGENT_AGNOSTIC.md](../AGENT_AGNOSTIC.md) — why the plugin is one
  delivery mechanism, not the canonical one (the MCP server is).
- [docs/v2/ARCHITECTURE.md](../ARCHITECTURE.md) — layer model (plugin is
  L5).
- [skills/vm-install/SKILL.md](../../../skills/vm-install/SKILL.md) /
  [skills/vm-update/SKILL.md](../../../skills/vm-update/SKILL.md) — install
  and update skills.
