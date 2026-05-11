---
name: install-vault-memory
description: One-call entry point to enable vault-memory for this Obsidian vault. Detects what is missing (system install vs. vault registration vs. index vs. MCP attach), then runs the minimal set of steps to reach a working state — system install via /setup-memory-system, per-vault registration via /add-vault, end-to-end smoketest. Runs autonomously with status updates; only asks the user when a step is destructive or ambiguous. Use when the user says "set up memory", "/install-vault-memory", "enable vault-memory", "Vault soll Memory-System werden", or when the mcp__vault-memory__* tools are missing in this session.
---

# /install-vault-memory — One-Call Vault Memory Setup

The single entry point a new user needs. After invocation, the vault is indexed,
the MCP server attaches on next Claude Code restart, and the agent can use
`mcp__vault-memory__*` tools against this vault.

## Why this skill exists

Setting up `vault-memory` for a fresh vault requires three orthogonal phases:

1. **System install** (Homebrew, Node 22+, Ollama, embedding model, `vault-memory` binary) — done once per machine.
2. **Vault registration** (entry in `~/.vault-memory/config.toml` + `.mcp.json` in vault root + initial index) — done once per vault.
3. **Smoketest** (does the MCP server actually start? does the index contain notes? is the model reachable?) — confirms the chain works.

The existing `/setup-memory-system` and `/add-vault` skills cover phases 1 and 2 in isolation. `/install-vault-memory` is the orchestrator a first-time user actually invokes — it inspects the current state, decides which phases are missing, runs them in order, and verifies the result.

## When to invoke

- User runs `/install-vault-memory` (primary trigger)
- User says "set up memory", "enable memory for this vault", "vault soll Memory-System werden", "Memory aktivieren"
- The `mcp__vault-memory__*` tool family is not available in the current session and the user wants to use it
- A `.mcp.json` references `vault-memory` but the tools are unavailable (broken state to repair)

## Behavior (autonomous mode)

The skill defaults to **autonomous execution**: it runs all non-destructive steps without asking, printing one short status line per phase. The user is only asked in three cases:

| Situation | Why ask |
|---|---|
| `~/.vault-memory/config.toml` exists but does **not** reference this vault | Overwriting a multi-vault config is destructive; confirm intent. |
| Initial index would touch >2,000 notes | Long-running operation (>5 min); offer to run in background. |
| `VAULT_MEMORY_INSTALL_MODE=source` is set AND `gh auth status` fails AND `vault-memory` is missing | Source-build mode needs git access. Tell the user to `gh auth login` or unset the variable to use the default npm install (no auth required). |

Everything else (Homebrew check, Node install, Ollama service start, model pull, npm link, vault registration, initial index, smoketest) proceeds without prompts.

## State detection — what to check before running anything

Before delegating to sub-skills, probe the current state in **parallel** (one Bash call per probe is fine):

```bash
# Phase 1 probes (system install)
command -v brew                      # → Homebrew present?
command -v node && node --version    # → Node 22+ in PATH?
command -v ollama                    # → Ollama binary?
curl -s --max-time 1 http://localhost:11434/api/tags    # → Ollama service up?
ollama list 2>/dev/null | grep -E '^(bge-m3|qwen3-embedding)'   # → embedding model pulled?
command -v vault-memory              # → vault-memory binary linked?

# Phase 2 probes (vault registration)
test -f ~/.vault-memory/config.toml
grep -q "path = \"$CLAUDE_PROJECT_DIR\"" ~/.vault-memory/config.toml 2>/dev/null
test -f "$CLAUDE_PROJECT_DIR/.mcp.json"
grep -q "vault-memory" "$CLAUDE_PROJECT_DIR/.mcp.json" 2>/dev/null

# Phase 3 probe (index health)
test -s ~/.vault-memory/$(slug).db    # non-empty SQLite file (.db, not -journal)

# Phase 0 probe (GitHub auth — only relevant in source-build mode)
[ "$VAULT_MEMORY_INSTALL_MODE" = "source" ] && gh auth status 2>&1 | grep -q "Logged in"
```

The skill writes a one-line **state report** based on these probes, then prints the **action plan** (which phases will run), then executes.

## Execution flow

```
┌─ State detection ──────────────┐
│ probe phase 1, 2, 3 in parallel│
└────────────┬───────────────────┘
             ▼
   ┌─ All green? ─┐
   │              │
  yes            no
   │              │
   ▼              ▼
 smoketest    Phase 1 needed? → run setup-memory-system (AUTO=1)
 only         Phase 2 needed? → run add-vault (AUTO=1)
              Phase 3 needed? → vault-memory index
              Smoketest       → spawn `vault-memory serve` <stdin EOF, expect MCP handshake
```

### Step-by-step

1. **Print intro** (one line): "Checking vault-memory state for `<vault-name>`…"

2. **Run state probes** (parallel Bash calls). Collect into a single status block:

   ```
   System:    brew ✓  node v24 ✓  ollama (service up) ✓  model bge-m3 ✓  vault-memory ✓
   Vault:     config.toml ✓  .mcp.json ✓  registered as "inim" ✓
   Index:     ~/.vault-memory/inim.db (1.2 MB, 847 notes)
   ```

   If everything is green, jump to step 6 (smoketest only).

3. **Phase 1 — system install** (only if any system probe failed):
   - If `VAULT_MEMORY_INSTALL_MODE=source` AND `gh auth status` fails AND `vault-memory` is missing: STOP, ask the user to `gh auth login` OR unset the variable (npm install needs no auth). Do not attempt to clone.
   - Otherwise: invoke the existing setup script with autonomous mode:
     ```bash
     VAULT_MEMORY_AUTO=1 bash "$CLAUDE_PROJECT_DIR/.claude/skills/setup-memory-system/setup.sh"
     ```
   - Stream the output to the user, prefixing each line if helpful. Do not re-implement the checks.

4. **Phase 2 — vault registration** (only if `config.toml` doesn't reference this vault OR `.mcp.json` is missing):
   - If `config.toml` exists but is missing this vault: ask first (destructive).
   - Otherwise: run
     ```bash
     vault-memory add-vault "$CLAUDE_PROJECT_DIR" --write
     ```
     The CLI handles the atomic config write + `.mcp.json` write. The `--no-index` flag is **not** used — the CLI's built-in initial index is faster than running it as a separate step.

5. **Phase 3 — index health** (only if Phase 2 was skipped but the index file is empty/missing):
   ```bash
   vault-memory index
   ```

6. **Smoketest** — verify the MCP server actually responds. macOS has no `timeout` binary, so use Perl's `alarm`:
   ```bash
   printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"memory-skill","version":"1"}}}' \
     | perl -e 'alarm 10; exec @ARGV' vault-memory serve 2>/dev/null | head -5
   ```
   Success = the response contains `"result"` and `"serverInfo"`. Failure = print stderr verbatim, do not pretend it's fine.

7. **Final report** — what was changed, what to do next:
   - "✓ Memory system is live."
   - List the vault name, index size, and number of notes indexed.
   - "Next: restart Claude Code in this vault so the MCP tools attach."
   - Mention that the user can now ask things like *"search the vault for notes about X"* or *"what are the backlinks to Y"*.

## Autonomous-mode contract for sub-skills

When `VAULT_MEMORY_AUTO=1` is set in the environment, `setup.sh` must:

- **Default all confirm() prompts to YES** for non-destructive steps (install Node, install Ollama, pull model, clone repo, npm link, run initial index).
- **Still prompt** for destructive steps (overwriting an existing config.toml that has other vaults; rebuilding an existing clone with uncommitted changes).
- Print one progress line per checkpoint instead of an interactive prompt.

The setup script supports this flag — see `setup-memory-system/setup.sh` for the contract.

## What this gives the user after success

The agent (in future sessions) can:

- **Semantic search**: `mcp__vault-memory__search_semantic("notes about <topic>")`
- **Hybrid search** (semantic + lexical, recommended default): `mcp__vault-memory__search_hybrid(...)`
- **Read notes by path**: `mcp__vault-memory__read_note("Projekte/X.md")`
- **Write/update notes atomically**: `mcp__vault-memory__write_note(...)` and `mcp__vault-memory__update_frontmatter(...)`
- **Navigate the graph**: `mcp__vault-memory__list_backlinks`, `mcp__vault-memory__list_forward_links`
- **Query frontmatter**: `mcp__vault-memory__query_frontmatter(...)` — structured filtering across the vault
- **Find broken links / audit log** for vault hygiene

These become the agent's "memory" of this specific vault — durable across sessions, grounded in the user's own notes, no cloud calls.

## Failure modes & recovery

| Symptom | Likely cause | Action |
|---|---|---|
| `vault-memory` not in PATH after Phase 1 | npm link silently failed (perm or PATH) | Tell user to run `npm link` manually in the install dir; suggest `nvm` if root npm is the issue |
| Ollama service won't start | Port 11434 already bound, or LaunchAgent denied | `lsof -iTCP:11434` to find the conflict; `brew services info ollama` for status |
| Initial index = 0 notes | `exclude_globs` too broad, or wrong vault path | Inspect the generated `~/.vault-memory/config.toml`, narrow excludes, re-run `vault-memory index --full` |
| Smoketest returns parse error | Old `vault-memory` build, MCP protocol version mismatch | `npm install -g @owrede/vault-memory@latest` (or in source mode: `cd ~/Documents/GitHub/vault-memory && git pull && npm install && npm run build`) |
| `npm install -g` fails with EACCES | Default npm prefix is not user-writable | Check `npm config get prefix` — either fix permissions or use a user-local prefix like `~/.npm-global`. Don't use `sudo npm install -g` on a system Node. |
| Source-mode `gh repo clone` fails | User not authenticated to GitHub | Run `gh auth login`, or simpler: unset `VAULT_MEMORY_INSTALL_MODE` to fall back to npm install. |

## What this skill does NOT do

- Install Claude Code itself — assumes it is already running.
- Migrate notes between vaults.
- Configure cross-vault search (multi-vault is set up by running `/install-vault-memory` in each vault separately).
- Touch the user's notes in any way during setup (only reads them for indexing).

## Idempotency

Running `/install-vault-memory` on a fully-set-up vault should:

- Take <5 seconds (just probes + smoketest).
- Report "all good".
- Not change a single file on disk.
- Not re-pull models, re-clone the repo, or re-run the initial index.
