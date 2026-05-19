---
name: install
description: One-call installer for vault-memory in an Obsidian vault. Installs the CLI/MCP server AND the Obsidian plugin (with the plugin's serverCommand pre-seeded to the absolute CLI path, so it works on first open). Walks through 9 idempotent checkpoints. Defaults to autonomous mode. Use when the user says "/vmem:install", "install vault-memory", "set up memory", "Memory aktivieren", or when the mcp__vault-memory__* tools are missing.
---

# /vmem:install — Install vault-memory in this vault

After invocation:

- vault-memory CLI / MCP server installed system-wide
- This vault registered in `~/.vault-memory/config.toml`
- Initial vector index built
- Obsidian plugin installed into `.obsidian/plugins/vault-memory/`
- Plugin's `data.json` seeded with the **absolute path** of the `vault-memory` binary (no "CLI not found" banner on first open)

On next Claude Code restart the `mcp__vault-memory__*` MCP tools attach.

## When to invoke

- User runs `/vmem:install`
- User says "install vault-memory", "set up memory", "enable memory for this vault", "Memory aktivieren"
- The `mcp__vault-memory__*` tool family is missing in the current session and the user wants it
- Obsidian plugin shows "vault-memory CLI not found" — re-running this skill seeds `data.json` with the correct absolute path

## What this skill does

9 idempotent checkpoints. Each silently passes when already met, or asks once before applying a fix.

| # | Check |
|---|---|
| 0 | Version chosen (v2.0.0-rc.3 default, v1.0.0 legacy stable) |
| 1 | Package manager (Homebrew on macOS; apt/dnf/pacman on Linux) |
| 2 | Node 22+ |
| 3 | Ollama running at the configured endpoint |
| 4 | Embedding model + cross-vault model dependencies pulled |
| 5 | `vault-memory` binary at the chosen version |
| 6 | This vault registered + initial index built |
| 6.5 | Obsidian plugin installed + `data.json` seeded |
| 7 | MCP smoketest passes |

## How to execute

For the standard `/vmem:install` invocation:

```bash
VAULT_MEMORY_AUTO=1 \
VAULT_MEMORY_VERSION=2.0.0-rc.3 \
VAULT_MEMORY_DESTRUCTIVE_CONFIRMED=1 \
  bash "$CLAUDE_PROJECT_DIR/.claude/skills/install/setup.sh"
```

Pass `VAULT_MEMORY_DESTRUCTIVE_CONFIRMED=1` only AFTER the agent has asked the user via `AskUserQuestion` whether to proceed with a v1 → v2 upgrade (the script will surface a destructive prompt when it detects an older install).

## Headless contract

| Env var | Effect |
|---|---|
| `VAULT_MEMORY_AUTO=1` | Auto-yes for every non-destructive prompt |
| `VAULT_MEMORY_VERSION=2.0.0-rc.3` (or `1.0.0`) | Skip version prompt |
| `VAULT_MEMORY_DESTRUCTIVE_CONFIRMED=1` | Pre-approve v1 → v2 upgrade |
| `VAULT_MEMORY_OLLAMA_ENDPOINT=http://host:port` | Non-default Ollama endpoint |
| `VAULT_MEMORY_EMBED_MODEL=<model>` | Override embedding model |
| `VAULT_MEMORY_SMOKETEST_TIMEOUT=30` | Bump smoketest timeout for cold Ollama |
| `VAULT_MEMORY_ALLOW_UNSUPPORTED_PLATFORM=1` | Allow Linux (experimental) |

## Idempotency

- **First run on fresh machine:** install everything, register this vault, build index, install plugin, exit 0
- **Second run:** all checkpoints green, smoketest only, exit 0 in under 5 seconds
- **Plugin re-seed:** existing plugin's `data.json` with default `"vault-memory"` placeholder gets overwritten with absolute path; user-set absolute paths are NEVER touched

## Related skills

- `/vmem:health` — read-only diagnostic; run this if something stops working
- `/vmem:reindex` — rebuild the vector index (full or incremental)
