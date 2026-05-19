# Migrating from vault-memory v1.x to v2.0.0

See [docs/v2/MIGRATION-V1-TO-V2.md](./docs/v2/MIGRATION-V1-TO-V2.md) for the full migration guide.

TL;DR: all 23 v1 MCP tool names and input schemas preserved byte-identical; 14 net-new tools added; 5 list-style tools deprecated (still callable through v2.x). Raw `tools/list` returns 37 entries in v2.0.0 (5 marked DEPRECATED); canonical surface = 32 tools + 10 MCP Resources.
