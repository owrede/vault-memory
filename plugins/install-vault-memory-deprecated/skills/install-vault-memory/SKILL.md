---
name: install-vault-memory
description: DEPRECATED — this skill has been renamed and split. Install the `vmem` plugin from the same marketplace, then use `/vmem:install`, `/vmem:health`, or `/vmem:reindex`. Use this skill only if the user explicitly invokes the old `/install-vault-memory:install-vault-memory` path; otherwise route them to `/vmem:install`.
---

# /install-vault-memory:install-vault-memory — DEPRECATED

This plugin and skill have been renamed.

## What to do

1. Open the `inim-store` marketplace and install the **`vmem`** plugin.
2. Use the new verb-prefixed commands:
   - `/vmem:install` — set up vault-memory in this vault (replaces the old `/install-vault-memory:install-vault-memory`)
   - `/vmem:health` — read-only diagnostic across CLI, Ollama, DBs, MCP
   - `/vmem:reindex` — rebuild the vector index for this vault
3. Uninstall this `install-vault-memory` plugin once `vmem` is installed.

This plugin will be removed from the marketplace in 60 days. The actual install logic now lives in `vmem`.

## Why the rename

The old slug forced users to type `/install-vault-memory:install-vault-memory` — the plugin name duplicated as the skill name. Splitting into `/vmem:<verb>` gives a clean, discoverable, short command surface.

## How to execute (still works, prints redirect)

```bash
bash "$CLAUDE_PROJECT_DIR/.claude/skills/install-vault-memory/setup.sh"
```

The script prints a redirect notice and exits 0. It does NOT install or modify anything.
