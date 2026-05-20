# CLI / MCP Server Changelog

Summary of user-visible changes to the `vault-memory` CLI and the
MCP server it ships. Full per-version detail lives at
[CHANGELOG.md in the repo](https://github.com/owrede/vault-memory/blob/main/CHANGELOG.md).

## [Unreleased]

### Fixed
- Migration 010: `UNIQUE constraint failed: sections.note_id, sections.anchor`
  crash that blocked v0.9.x/v1.0.0 → v2.0.0 upgrade when a vault contained
  heading-only sibling sections. `INSERT OR IGNORE` + collision lookup.

### Changed
- Obsidian plugin error messages reference `/vmem:install` (was: `/vm-install`).

## [2.0.0-rc.2] — 2026-05-19

Migration-010 fix. Skill rewrite (22 issues resolved). Auto-seeded plugin
data.json. New diagnostic mode (`VAULT_MEMORY_DIAGNOSE=1`).

## [2.0.0-rc.1] — 2026-05-19

First v2 prerelease. **Tool surface**: 23 v1 tools + 14 new = 37 total.
**New tools**: `expand` (typed-edge BFS), `cluster` (Louvain), `set_runtime_config`,
`set_mcp_client`, `get_runtime_stats`, `trigger_reindex`, `resolve_secret`,
`describe_contract`, `instantiate_contract`, `register_contracts_as_tools`,
`load_brief`, `record_brief_usage`. **New MCP Resources**: 10
(`vault-memory://contracts/{vault}`, `…/contract-verbs/{vault}`,
`…/brief/{vault}/{handle}`, `…/recent/{vault}`, `…/stats/{vault}`,
`…/backlinks/{vault}/{+docId}`, `…/vaults`, `…/models/{vault}`, others).
**v1 tools deprecated → MCP Resources** (still callable through v2.x):
`list_vaults`, `list_models`, `recent_notes`, `vault_stats`, `list_backlinks`.

### Major additions
- **Typed-edge graph** — 4 edge types (`wikilink`, `mention`,
  `frontmatter-ref`, `hyperlink`) backfilled from v1 wikilinks, used by
  `expand`, `cluster`, and `search_hybrid({expand})`.
- **Task Contract DSL** — declarative YAML contracts under
  `_contracts/<name>.yaml`, addressable by name, instantiable via MCP.
  Memory-sink invariant enforced at the `DeliveryAdapter` layer.
- **Compiled briefs** — addressable agent-prep documents, deduplicated
  across runs.
- **Source/Sink adapter seams** — Notion / Logseq connectors can drop in
  without touching `src/server.ts`.

### Backwards compatibility
All 23 v1 tool names + shapes preserved byte-identical. The five
deprecated tools remain callable; their MCP Resource counterparts are
the canonical replacement starting in v2.x. Removal scheduled for v3.0.0.

## [1.0.0] — 2026-05-12

Stability declaration. 23-tool surface. Hybrid search (semantic + BM25
+ RRF), ONNX cross-encoder reranker, live indexing, multi-vault,
hash-protected writes.

## [0.10.0] — 2026-05-12

`suggest_frontmatter` — three-layer schema inference.

## [0.9.2] — 2026-05-12

Vault-hygiene skill pack.

## [0.9.1] — 2026-05-11

Body-hash short-circuit for incremental re-indexing.

For all prior releases see the [full CHANGELOG.md](https://github.com/owrede/vault-memory/blob/main/CHANGELOG.md).
