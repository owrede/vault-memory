---
name: reindex
description: Rebuild the vault-memory vector index for the current vault. Full re-index by default (rebuilds typed-edge graph + contract scaffold + chunks); pass --incremental for a fast incremental update that only re-embeds changed notes. Use when the user says "/vmem:reindex", "rebuild the index", "index this vault", "re-embed", "neu indexieren", or when search returns stale results after large note imports / model changes.
---

# /vmem:reindex — Rebuild the vector index

Wraps `vault-memory index [--full] [--vault NAME]` with a friendlier surface and progress reporting.

## When to use

- User says "/vmem:reindex", "rebuild the index", "re-embed the vault"
- After a large note import — incremental catches up but full rebuilds typed-edge graph
- After switching embedding models (different dim → fresh re-embed required)
- After a v1 → v2 upgrade — the new graph signal (typed edges, mentions, hyperlinks) is empty until a full re-index runs
- After `/vmem:health` reports notes-on-disk > notes-in-DB

## Modes

| Invocation | Effect |
|---|---|
| `/vmem:reindex` | Full re-index: every note re-parsed, every chunk re-embedded |
| `/vmem:reindex --incremental` | Only re-embed notes whose hash changed since last run |
| `/vmem:reindex --vault NAME` | Re-index a specific named vault instead of the current one |

## How to execute

```bash
bash "$CLAUDE_PROJECT_DIR/.claude/skills/reindex/reindex.sh" [--incremental] [--vault NAME]
```

The wrapper:
1. Resolves the vault name from `~/.vault-memory/config.toml` by matching `$CLAUDE_PROJECT_DIR` against canonical paths
2. Invokes `vault-memory index` with the right flags
3. Surfaces SQLITE_CONSTRAINT / migration crashes with the failing DB name (same crash-detection as `/vmem:install` checkpoint 6)
4. Reports notes-in-DB before and after

## What it does NOT do

- Does not install vault-memory if missing — run `/vmem:install` first
- Does not pull missing Ollama models — run `/vmem:health` to see what's missing
- Does not touch the Obsidian plugin
