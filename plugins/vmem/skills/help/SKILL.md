---
name: help
description: List every /vmem verb with a one-line description. Use when the user says "/vmem:help", "what commands does vmem have", "vmem help", "vault-memory commands", or when discovering the surface for the first time.
---

# /vmem:help — vmem command surface

vmem is the local-first agentic-memory layer for Obsidian. The marketplace plugin exposes the following verbs:

| Verb | What it does |
|---|---|
| `/vmem:install` | One-call install of vault-memory in this vault (CLI + Obsidian plugin + example contracts). Walks 9 idempotent checkpoints. |
| `/vmem:health` | Read-only diagnostic — checks CLI version, Ollama, configured models, every vault DB's integrity, uncommitted WAL state, and the MCP smoketest. PASS/WARN/FAIL per dimension. |
| `/vmem:reindex` | Rebuild the vector index for the current vault. Full re-index by default; pass `--incremental` for fast catch-up. |
| `/vmem:help` | (You are here.) |

## Common workflows

| User intent | Command |
|---|---|
| First time setting up vault-memory in a vault | `/vmem:install` |
| Obsidian plugin shows "CLI not found" or "Could not load stats" | `/vmem:install` (re-runs the seeder for `data.json` and `[plugin] enabled`) |
| Memory tools disappeared after a system update | `/vmem:health` to diagnose, then `/vmem:install` if needed |
| Search returns stale results after large note import | `/vmem:reindex --incremental` |
| Switching embedding models or recovering from corrupt DB | `/vmem:reindex` (full) |
| Upgrade from v1.0.0 → v2 | `/vmem:install` — detects the older version, offers backup + destructive-confirmed upgrade path |

## Related (in agent context, not slash surface)

After `/vmem:install` and a Claude Code restart, the agent has access to the `mcp__vault-memory__*` tool family:
- `mcp__vault-memory__search_hybrid` — semantic + BM25 + RRF
- `mcp__vault-memory__read_note` / `write_note` / `update_frontmatter`
- `mcp__vault-memory__list_backlinks` / `list_forward_links`
- v2-only: typed-edge graph (`expand`, `cluster`), briefs, task contracts

## How to execute

This is an informational skill — print the table above and stop. No script side-effects.

```bash
bash "$CLAUDE_PROJECT_DIR/.claude/skills/help/help.sh"
```

Or just render the markdown table inline.
