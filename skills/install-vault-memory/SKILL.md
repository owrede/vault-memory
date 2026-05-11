---
name: install-vault-memory
description: One-call installer for vault-memory in an Obsidian vault. Walks through 8 idempotent checkpoints (install source choice, Homebrew, Node 22+, Ollama, embedding model, vault-memory binary, vault registration, MCP smoketest). Defaults to autonomous mode — installs without asking for non-destructive steps, prints a one-line "why" for each install prompt. Re-running on a complete setup reports "all good" and exits in under 5 seconds. Use when the user says "/install-vault-memory", "install vault-memory", "set up memory", "Memory aktivieren", or when the mcp__vault-memory__* tools are missing in the current session.
---

# /install-vault-memory — One-Call Vault Memory Setup

The single entry point a new user needs. After invocation, vault-memory is
installed system-wide, this vault is registered, the initial index is built,
and on next Claude Code restart the `mcp__vault-memory__*` tools attach.

## When to invoke

- User runs `/install-vault-memory` (primary trigger)
- User says "install vault-memory", "set up memory", "enable memory for this vault", "Memory aktivieren", "Vault soll Memory-System werden"
- The `mcp__vault-memory__*` tool family is not available in the current session and the user wants to use it
- A `.mcp.json` references `vault-memory` but the tools are unavailable (broken state to repair)

## What this skill does

The skill walks through 8 idempotent checkpoints (0–7). Each one either silently
passes when already met, or asks once before applying a fix. Every install
prompt carries a `why:` line explaining what is being installed and why
vault-memory needs it — no black-box auto-installs.

| # | Check | Fix on miss |
|---|---|---|
| 0 | Install source determined | Default `VAULT_MEMORY_INSTALL_MODE=npm` (public registry, no auth). `source` mode clones from GitHub — requires `gh auth login`. |
| 1 | Homebrew installed | Print install command (external — do not auto-install) |
| 2 | Node 22+ in `$PATH` | `brew install node@22` |
| 3 | Ollama installed + service running | `brew install ollama && brew services start ollama` |
| 4 | Embedding model `bge-m3` available | `ollama pull bge-m3` (1.1 GB) — recommended default. Override via `VAULT_MEMORY_EMBED_MODEL=qwen3-embedding:0.6b` for low-RAM machines. |
| 5 | `vault-memory` binary in `$PATH` | **npm (default):** `npm install -g @owrede/vault-memory`. **source:** clone + `npm install && npm run build && npm link`. Existing installs are checked against npm's `latest` and offered an in-place upgrade. |
| 6 | `~/.vault-memory/config.toml` lists this vault | `vault-memory add-vault "$CLAUDE_PROJECT_DIR" --write` — atomic config-append + `.mcp.json` write + initial index. |
| 7 | MCP server smoketest passes | Send a JSON-RPC `initialize` request via `perl alarm` (portable timeout, no GNU coreutils needed) and assert `result + serverInfo` in the response. |

After checkpoint 7: print success summary, tell the user to restart Claude Code,
and suggest example queries the agent can now perform against the vault.

## Autonomous mode (default)

The skill runs autonomously — every non-destructive checkpoint auto-installs
with a status line like `auto: yes → Install Ollama via Homebrew?` followed by
the `why:` reason. The user is only prompted for genuinely destructive steps:

| Situation | Why ask |
|---|---|
| `~/.vault-memory/config.toml` exists but does not reference this vault | Modifying a multi-vault config requires explicit consent. |
| Existing source clone has uncommitted changes during rebuild | Could discard user work. |
| `VAULT_MEMORY_INSTALL_MODE=source` AND `gh auth status` fails AND `vault-memory` is missing | Source-build mode needs git access — tell the user to `gh auth login` or unset the variable to fall back to the default npm install (no auth required). |

Set `VAULT_MEMORY_AUTO=0` to switch to fully-interactive mode (asks before
every system change).

## How to execute

The script does all the work — Claude reads this SKILL.md and invokes:

```bash
VAULT_MEMORY_AUTO=1 bash "$CLAUDE_PROJECT_DIR/.claude/skills/install-vault-memory/setup.sh"
```

The script:

1. Probes current state (binary present? config valid? index built? MCP responding?)
2. Runs only the checkpoints that are needed
3. Streams progress to the user via colored stderr lines
4. Exits 0 on success, prints exact remediation instructions on failure

If a checkpoint fails non-recoverably, the script prints the manual next step
verbatim. Claude should relay that to the user without retrying blindly.

## Implementation files

- `setup.sh` — the 8-checkpoint installer with autonomous + interactive modes
- `config-wizard.sh` — interactive prompt that writes `~/.vault-memory/config.toml` for first-time users

## Idempotency contract

Running this skill twice in a row must:

- **First run on fresh machine:** install everything, register this vault, build initial index, exit 0.
- **Second run:** detect all checkpoints green, run smoketest only, report "all good" in under 5 seconds, exit 0.
- **Never** delete user data, never overwrite an existing `config.toml` without asking, never re-pull models that already exist.

## Install sources

- **npm registry (default):** https://www.npmjs.com/package/@owrede/vault-memory — public, no auth required, `latest` dist-tag follows the most recent release.
- **GitHub source (developer mode):** https://github.com/owrede/vault-memory — set `VAULT_MEMORY_INSTALL_MODE=source` to clone + build locally.
- **Default source-clone location:** `~/Documents/GitHub/vault-memory`
- **Global binary alias:** `vault-memory` (via `npm install -g` or `npm link`)

## What this gives the user after success

The agent (in future sessions, after Claude Code restart) can:

- **Semantic search:** `mcp__vault-memory__search_semantic("notes about <topic>")`
- **Hybrid search** (semantic + BM25, recommended default): `mcp__vault-memory__search_hybrid(...)`
- **Read notes by path:** `mcp__vault-memory__read_note("Projekte/X.md")`
- **Write/update notes atomically:** `mcp__vault-memory__write_note(...)` + `mcp__vault-memory__update_frontmatter(...)`
- **Navigate the graph:** `mcp__vault-memory__list_backlinks`, `mcp__vault-memory__list_forward_links`
- **Query frontmatter:** structured filtering across the vault
- **Find broken links / audit log** for vault hygiene

These become the agent's "memory" of this specific vault — durable across
sessions, grounded in the user's own notes, no cloud calls.

## Failure modes & recovery

| Symptom | Likely cause | Action |
|---|---|---|
| `vault-memory` not in `$PATH` after install | npm global prefix not in shell PATH | Tell the user to add `$(npm bin -g)` to PATH, or check `npm config get prefix`. Don't use `sudo npm install -g`. |
| Ollama service won't start | Port 11434 already bound | `lsof -iTCP:11434` to find the conflict; `brew services info ollama` for status |
| Initial index = 0 notes | `exclude_globs` too broad, or wrong vault path | Inspect `~/.vault-memory/config.toml`, narrow excludes, re-run `vault-memory index --full` |
| Smoketest returns empty response | Old `vault-memory` build, MCP protocol version mismatch | `npm install -g @owrede/vault-memory@latest` |
| Source-mode `gh repo clone` fails | User not authenticated to GitHub | Run `gh auth login`, OR simpler: unset `VAULT_MEMORY_INSTALL_MODE` to fall back to the public npm install. |

## Limits

- macOS only (relies on Homebrew). Linux support is on the roadmap.
- Does not run unattended unless `VAULT_MEMORY_AUTO=1` is set (which is the default when invoked via the skill — direct script invocation defaults to interactive).
- Does not migrate notes between vaults.
- Does not configure cross-vault search (run `/install-vault-memory` in each vault separately, or use `vault-memory add-vault` CLI directly).
