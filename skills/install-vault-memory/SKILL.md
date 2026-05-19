---
name: install-vault-memory
description: One-call installer for vault-memory in an Obsidian vault. Installs the CLI/MCP server AND the Obsidian plugin (with the plugin's serverCommand pre-seeded to the absolute CLI path, so it works on first open). Walks through 9 idempotent checkpoints (version, package manager, Node 22+, Ollama, embedding model, vault-memory binary, vault registration + initial index, Obsidian plugin, MCP smoketest). Defaults to autonomous mode. Supports a read-only health check via VAULT_MEMORY_DIAGNOSE=1. Use when the user says "/install-vault-memory", "install vault-memory", "set up memory", "Memory aktivieren", or when the mcp__vault-memory__* tools are missing.
---

# /install-vault-memory — One-Call Vault Memory Setup

The single entry point a new user needs. After invocation:

- The vault-memory CLI / MCP server is installed system-wide
- This vault is registered in `~/.vault-memory/config.toml`
- The initial vector index is built
- The Obsidian plugin is installed into `.obsidian/plugins/vault-memory/`
- The plugin's `data.json` is seeded with the **absolute path** of the
  `vault-memory` binary, so the in-Obsidian plugin works on first open
  (no "CLI not found" banner)

On next Claude Code restart the `mcp__vault-memory__*` MCP tools attach.

## When to invoke

- User runs `/install-vault-memory` (primary trigger)
- User says "install vault-memory", "set up memory", "enable memory for this vault", "Memory aktivieren", "Vault soll Memory-System werden"
- The `mcp__vault-memory__*` tool family is not available in the current session and the user wants to use it
- A `.mcp.json` references `vault-memory` but the tools are unavailable (broken state to repair)
- User reports the Obsidian plugin showing "vault-memory CLI not found" — re-running the skill seeds `data.json` with the correct absolute path

## What this skill does

9 idempotent checkpoints. Each one either silently passes when already met, or asks once before applying a fix.

| # | Check | Fix on miss |
|---|---|---|
| 0 | Version chosen | Prompt for v2.0.0-rc.2 (default, recommended) or v1.0.0 (legacy stable). Skipped when `VAULT_MEMORY_VERSION` is set or no TTY. |
| 1 | Package manager (Homebrew on macOS; apt/dnf/pacman on Linux) | Print install command (Homebrew) or use the detected pkg manager (Linux) |
| 2 | Node 22+ in `$PATH` | `brew install node@22` / `nodesource` / `dnf` / `pacman` |
| 3 | Ollama installed + service running at the configured endpoint | `brew install ollama && brew services start ollama` (or platform equivalent). Honors `VAULT_MEMORY_OLLAMA_ENDPOINT` + `ollama_endpoint` in existing config. |
| 4 | Embedding model available + every model referenced in config.toml is pulled | `ollama pull <model>` per missing model |
| 5 | `vault-memory` binary in `$PATH` matches the chosen version | `npm install -g @owrede/vault-memory@<version>`. Existing installs are detected by version + origin and offered an in-place upgrade with a destructive-confirm warning. |
| 6 | This vault registered in `~/.vault-memory/config.toml` (path-canonical match) and initial index built | `vault-memory add-vault "$VAULT_ROOT" --write --no-index` then `vault-memory index [--full]`. Detects `SQLITE_CONSTRAINT` crashes from sibling vaults and points at the failing DB. |
| 6.5 | Obsidian plugin installed at `.obsidian/plugins/vault-memory/`, enabled in `community-plugins.json`, and `data.json` has `serverCommand` set to the absolute path of the `vault-memory` binary | Download `vault-memory-plugin-v<version>.tar.gz` from the GitHub Release, extract to plugin dir, append to `community-plugins.json`, write `data.json` with absolute CLI path |
| 7 | MCP server smoketest passes — `initialize` returns `serverInfo` AND this vault appears in `list_vaults` | Surface stderr + the exact `VAULT_MEMORY_SMOKETEST_TIMEOUT=30` recovery command if Ollama is cold-starting |

After checkpoint 7: print success summary, tell the user to restart Claude Code AND Obsidian, suggest example queries.

## Autonomous mode (default — used by the skill)

The skill runs autonomously — every non-destructive checkpoint auto-installs with `auto: yes → …` followed by a `why:` reason on the next line. The user is only prompted for genuinely destructive steps (the destructive v1 → v2 upgrade).

### Headless-agent contract (when called from Claude / CI / non-TTY)

Set these env vars BEFORE invoking `setup.sh` to make the script work without a TTY:

| Env var | Effect |
|---|---|
| `VAULT_MEMORY_AUTO=1` | Auto-yes for every non-destructive prompt |
| `VAULT_MEMORY_VERSION=2.0.0-rc.2` (or `1.0.0`) | Skips the Checkpoint-0 version prompt |
| `VAULT_MEMORY_DESTRUCTIVE_CONFIRMED=1` | Pre-confirms the v1 → v2 destructive upgrade (the agent has already asked the human via `AskUserQuestion`) |
| `VAULT_MEMORY_OLLAMA_ENDPOINT=http://host:port` | Skips the default `:11434` probe |
| `VAULT_MEMORY_EMBED_MODEL=<model>` | Overrides the auto-detected embedding model |
| `VAULT_MEMORY_SMOKETEST_TIMEOUT=30` | Bumps the MCP smoketest timeout if Ollama is cold-starting |
| `VAULT_MEMORY_ALLOW_UNSUPPORTED_PLATFORM=1` | Allows Linux (experimental) |

When no TTY is available, the script defaults to v2.0.0-rc.2 and refuses any destructive op that isn't pre-confirmed.

## How to execute

For headless invocation from Claude (the normal `/install-vault-memory` path):

```bash
VAULT_MEMORY_AUTO=1 \
VAULT_MEMORY_VERSION=2.0.0-rc.2 \
VAULT_MEMORY_DESTRUCTIVE_CONFIRMED=1 \
  bash "$CLAUDE_PROJECT_DIR/.claude/skills/install-vault-memory/setup.sh"
```

`VAULT_MEMORY_DESTRUCTIVE_CONFIRMED=1` should be passed only AFTER the agent has explicitly asked the user via `AskUserQuestion` whether to proceed with the v1 → v2 upgrade (when the script detects an existing older install).

For a read-only health check on an existing install:

```bash
VAULT_MEMORY_DIAGNOSE=1 bash "$CLAUDE_PROJECT_DIR/.claude/skills/install-vault-memory/setup.sh"
# or
bash "$CLAUDE_PROJECT_DIR/.claude/skills/install-vault-memory/setup.sh" --diagnose
```

Exits 0 on PASS, 3 on FAIL (one or more dimensions broken).

## Idempotency contract

- **First run on fresh machine:** install everything (CLI + plugin), register this vault, build initial index, exit 0.
- **Second run:** detect all checkpoints green, run smoketest only, report "all good" in under 5 seconds, exit 0.
- **Plugin re-seed:** if the plugin is already installed but `data.json` has the default placeholder `"vault-memory"`, the script overwrites it with the absolute CLI path. User-set absolute paths are NEVER overwritten.
- **Never** delete user data, never overwrite `config.toml` without confirmation, never re-pull models that already exist.

## Install sources

- **npm registry (default):** https://www.npmjs.com/package/@owrede/vault-memory — public, no auth required. `latest` = v1.0.0 stable; `next` = v2.0.0-rc.* prereleases.
- **GitHub source (developer mode):** https://github.com/owrede/vault-memory — set `VAULT_MEMORY_INSTALL_MODE=source` to clone + build locally.
- **Obsidian plugin tarball:** `vault-memory-plugin-v<X.Y.Z>.tar.gz` attached to each GitHub Release. The skill downloads via `gh release download` (preferred) or `curl` fallback.

## What this gives the user after success

Two complementary surfaces:

### A) MCP tools available to the agent (after Claude Code restart)

- `mcp__vault-memory__search_hybrid(...)` — semantic + BM25 + RRF, recommended default
- `mcp__vault-memory__search_semantic(...)` / `search_text(...)` — single-axis search
- `mcp__vault-memory__read_note("Projekte/X.md")` / `write_note(...)` / `update_frontmatter(...)`
- `mcp__vault-memory__list_backlinks` / `list_forward_links`
- `mcp__vault-memory__query_frontmatter` — structured filter across the vault
- v2-only: typed-edge graph, briefs, task contracts, MCP Resources

### B) Obsidian plugin (visible to the user)

- Brief panels, contract editor, search UI inside Obsidian itself
- `serverCommand` pre-configured to the absolute CLI path so spawn works from Obsidian's GUI PATH (which does NOT include npm global bin)
- `ollamaUrl` / `embeddingModel` / `defaultVault` pre-seeded from the install context

## Failure modes & recovery

| Symptom | Cause | Action |
|---|---|---|
| Plugin shows "vault-memory CLI not found" banner | Obsidian's GUI PATH ≠ shell PATH; plugin's `serverCommand` is still the default `"vault-memory"` | Re-run `/install-vault-memory` — the skill re-seeds `data.json` with the absolute path. Restart Obsidian. |
| `vault-memory` not in shell PATH after install | npm global prefix not in shell PATH | Skill prints the exact `~/.zshrc` edit needed (don't say "open a new shell") |
| Ollama service won't start | Port 11434 collision or remote/non-default endpoint | Skill honors `VAULT_MEMORY_OLLAMA_ENDPOINT` and `ollama_endpoint` from config — set to the real URL |
| Multi-vault migration crash on `vault-memory index` | One sibling DB has incompatible schema state | Skill runs `sqlite3 PRAGMA quick_check` per DB, offers to move the failing one aside |
| Smoketest times out | Ollama cold-starting | `VAULT_MEMORY_SMOKETEST_TIMEOUT=30 bash setup.sh` |
| Initial index = 0 notes | `exclude_globs` too broad, or wrong vault path | Inspect `~/.vault-memory/config.toml`, narrow excludes, re-run `vault-memory index --full` |
| Source-mode `gh repo clone` fails | User not authenticated to GitHub | `gh auth login` OR unset `VAULT_MEMORY_INSTALL_MODE` for the public npm install |

## Diagnostic mode

```bash
VAULT_MEMORY_DIAGNOSE=1 bash setup.sh
```

Read-only health check across every dimension. Produces a `PASS/WARN/FAIL` line per dimension:

- vault-memory binary version
- Ollama reachability at configured endpoint
- Config file presence and registered vault count
- Per-vault DB integrity (`PRAGMA integrity_check`)
- Uncommitted WAL warnings
- MCP smoketest

Exits 0 if all PASS (WARN is non-blocking), 3 if any FAIL.

## Limits

- macOS is primary; Linux is experimental (requires `VAULT_MEMORY_ALLOW_UNSUPPORTED_PLATFORM=1`)
- Single `~/.vault-memory/` install — all registered vaults share one binary version
- Re-running the skill in a NEW vault appends to the same global config
- Does not migrate notes between vaults
