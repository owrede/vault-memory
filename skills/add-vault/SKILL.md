---
name: add-vault
description: Onboard a new Obsidian vault to vault-memory end-to-end — registers it in ~/.vault-memory/config.toml, writes .mcp.json into the vault root, builds the initial index. Use when the user says "add this vault to vault-memory", "register a new vault", "this vault doesn't have memory yet", or "/add-vault". Idempotent — safe to re-run on an already-registered vault.
---

# Add Vault

One-shot onboarding for an additional Obsidian vault. After this skill runs, the user can open that vault in Claude Code and immediately have the `vault-memory` MCP tools available.

## Trigger

- User invokes `/add-vault`
- User says "add this vault to memory", "register this vault", "neuer vault einrichten"
- User opens Claude Code in a vault directory and the `mcp__vault-memory__*` tools are missing or returning empty

## Prerequisites

`vault-memory` must already be installed system-wide. If not, run `/install-vault-memory` first.

Check via:

```bash
which vault-memory
```

If missing: stop and tell the user to run `/install-vault-memory`. Do not try to install anything else from this skill.

## Behavior

Detect the vault path:
- If the user passed an explicit path argument (`/add-vault /path/to/vault`), use that.
- If they invoked the skill from inside a vault (working directory contains `.obsidian/`), default to the current directory.
- Otherwise, ask the user with `AskUserQuestion` which vault they want to add.

Confirm with the user before mutating anything:
- Show the detected path, the proposed `name` (slugified basename), and `write_enabled` (default false = read-only).
- Confirm via `AskUserQuestion` — give them the chance to override the name or enable writes.

Run the CLI:

```bash
vault-memory add-vault "<path>" [--name <name>] [--write] [--no-index]
```

The CLI does all three steps atomically (config.toml append, `.mcp.json` write/merge, initial index). It prints a per-step transcript — relay that verbatim to the user.

Default to running the index unless the user says they want to skip it (`--no-index` flag). For large vaults (>1000 notes), warn the user that initial indexing can take several minutes; they may want to run it in a separate terminal.

After completion, tell the user to **restart Claude Code** in the new vault for the MCP tools to attach.

## Edge Cases

- **Vault path doesn't exist**: surface the CLI error verbatim, suggest checking the path.
- **Vault already registered under the same path**: the CLI handles this idempotently (reports "already registered"), the skill just relays it.
- **Vault name collision with different path**: CLI rejects with a clear error. Ask the user for an override name via `AskUserQuestion`.
- **Vault is read-only mounted (e.g. iCloud not synced)**: the `.mcp.json` write will fail with EACCES. Surface the error and stop.

## Verification

After the CLI returns, run a quick sanity check:

```bash
ls -la "<path>/.mcp.json"     # exists and is readable
grep -A 2 "name = \"<name>\"" ~/.vault-memory/config.toml   # entry present
```

If both pass, the skill is done. If the index ran, the CLI also printed something like `✓ <name>: N new, ... chunks`.

## What to Tell the User at the End

A short report:
- Which vault was registered (`name` + path)
- What was changed (config block added / `.mcp.json` created or merged / index built)
- Next action: **restart Claude Code in the new vault** to load the MCP server

Do not invent further work. The skill is done.
