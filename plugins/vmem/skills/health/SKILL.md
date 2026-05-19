---
name: health
description: Read-only health check for vault-memory. Probes the CLI binary, Ollama reachability, config validity, every registered vault DB's integrity, uncommitted WAL state, and the MCP smoketest. Produces a PASS/WARN/FAIL line per dimension. Use when the user says "/vmem:health", "is vault-memory working", "diagnose vault-memory", "memory broke what's wrong", or when memory tools have disappeared after a system change.
---

# /vmem:health — Diagnose vault-memory

Read-only health check across every dimension the install touches. No state is mutated.

## What it checks

| Dimension | Probe |
|---|---|
| Binary | `vault-memory` in PATH + resolvable version |
| Ollama | `curl /api/tags` on configured endpoint |
| Config | `~/.vault-memory/config.toml` present + count registered vaults |
| Per-vault DB | `sqlite3 PRAGMA integrity_check` + note count |
| WAL leftovers | `.db-wal` file size — warns if >4KB (uncommitted state) |
| MCP server | JSON-RPC `initialize` smoketest |

Output: one `PASS`/`WARN`/`FAIL` line per dimension. Exits 0 on PASS (WARN non-blocking), 3 if any FAIL.

## How to execute

```bash
VAULT_MEMORY_DIAGNOSE=1 bash "$CLAUDE_PROJECT_DIR/.claude/skills/install/setup.sh"
```

Or via the bundled wrapper:

```bash
bash "$CLAUDE_PROJECT_DIR/.claude/skills/health/health.sh"
```

The wrapper exists so the user (or the agent) can run `/vmem:health` without remembering the diagnostic env var. It dispatches into `install/setup.sh --diagnose`.

## When to use

- User says "/vmem:health", "is vault-memory healthy", "diagnose memory"
- The `mcp__vault-memory__*` tools stop responding after a system update / OS upgrade
- Obsidian plugin reports an error and you need to know whether the CLI side is OK
- Before filing a bug — collect the diagnostic output

## Output is non-destructive

This skill never installs, never modifies config, never runs `vault-memory index`. To fix anything it finds, follow up with `/vmem:install` (for setup gaps) or `/vmem:reindex` (for stale indexes).
