---
name: setup-memory-system
description: One-shot installer for the vault-memory MCP server. Detects what is missing (Homebrew, Node 22+, Ollama, bge-m3 embedding model, vault-memory package), installs it interactively (asks before each system change), writes ~/.vault-memory/config.toml, builds the initial index, verifies the MCP server starts. Idempotent — re-running on a complete setup reports "all good" and exits. Use when the user says "set up memory", "install vault-memory", "/setup-memory-system", or when MCP tools mcp__vault-memory__* are missing.
---

# Setup Memory System

Bootstraps the `vault-memory` MCP server on a fresh machine so Claude Code can perform semantic search, frontmatter queries, wikilink navigation, and atomic writes against this vault.

## Trigger

- User invokes `/setup-memory-system`
- User says "set up memory", "install memory", or "memory system fehlt"
- MCP tools `mcp__vault-memory__*` are unavailable in the session

## Behavior

The skill walks through 8 idempotent checkpoints (0–7). Each checkpoint either silently passes (when already met), or asks the user once for permission to apply the fix:

| # | Check | Fix on miss |
|---|---|---|
| 0 | Install source determined | Default `VAULT_MEMORY_INSTALL_MODE=npm` (public registry, no auth). `source` mode clones from GitHub — requires `gh auth login`. |
| 1 | Homebrew installed | Print install instructions (external URL — do not auto-install) |
| 2 | Node 22+ in `$PATH` | `brew install node@22` |
| 3 | Ollama installed + service running | `brew install ollama && brew services start ollama` |
| 4 | Embedding model `bge-m3` available | `ollama pull bge-m3` (1.1 GB) — recommended default since v0.7.3. Override via `VAULT_MEMORY_EMBED_MODEL=qwen3-embedding:0.6b` for low-RAM machines. |
| 5 | `vault-memory` binary in `$PATH` | **npm mode (default):** `npm install -g @owrede/vault-memory`. **source mode:** clone, `npm install && npm run build && npm link`. Existing installs are version-checked against npm's `latest` and offered an in-place upgrade. |
| 6 | `~/.vault-memory/config.toml` present and lists this vault | Generate config interactively (default vault name from folder, path from `$CLAUDE_PROJECT_DIR`) |
| 7 | MCP server smoketest passes | Send a JSON-RPC `initialize` request via `perl alarm` (portable timeout) and assert `result + serverInfo` in the response. |

Final action: run `vault-memory index` once to build the initial index. Print success summary.

## How to execute

1. Read this skill's script: `bash $CLAUDE_PROJECT_DIR/.claude/skills/setup-memory-system/setup.sh`
2. The script prints diagnostic lines on stderr and asks for confirmation via the standard shell prompt (yes/no) before any system change.
3. If the script fails at a checkpoint, the script prints the exact next step (manual command). Relay that to the user — do not retry blindly.

## Implementation files

- `setup.sh` — main bash script with all checkpoints
- `config-wizard.sh` — interactive prompt that writes `~/.vault-memory/config.toml`

## Idempotency contract

Running this skill twice in a row must:
- On first run: install/configure everything, build index, exit 0.
- On second run: detect everything is in place, report "all good", run `vault-memory index` (incremental — no-op when no notes changed), exit 0.

The script must never delete user data, never overwrite an existing `config.toml` without asking, never re-pull models that already exist.

## Install sources

- **npm registry (default):** https://www.npmjs.com/package/@owrede/vault-memory — public, no auth required, `latest` tag follows the most recent release.
- **GitHub source (developer mode):** https://github.com/owrede/vault-memory — set `VAULT_MEMORY_INSTALL_MODE=source` to clone + build locally. Requires `gh auth login` since the repo's release flow tags from local.
- **Default source-clone location:** `~/Documents/GitHub/vault-memory`
- **Global binary alias:** `vault-memory` (via `npm install -g` or `npm link`)

## Limits

- macOS only (relies on Homebrew). Linux support is on the roadmap.
- Does not run unattended unless `VAULT_MEMORY_AUTO=1` is set — every system change otherwise requires interactive confirmation.
