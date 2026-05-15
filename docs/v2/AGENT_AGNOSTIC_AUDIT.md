# Agent-Agnostic Audit — Phase 1 close-out

**Status:** Complete (Phase 1) — maintainer sign-off in PR description.
**Authored:** 2026-05-15
**Phase:** 01 (adapter-extraction-tech-debt-up) — closing artifact.

This audit enumerates every assumption in `src/` that previously tied
vault-memory to a specific MCP client (Claude Code, Claude Desktop,
Claude.ai) OR to a specific source backend (Obsidian's filesystem
layout, frontmatter parser, deep-link URL scheme). Each leak is either
**fixed-v2** (closed in Phase 1 — plans 01-01 through 01-06), **mixed**
(carve-out shape established in v2; full hardening deferred), or
**deferred-v3** (explicitly scoped to a later phase — Phase 2 memory
namespace, Phase 4 graph-as-retrieval, Phase 8 release-engineering, or
Phase 10 first non-Obsidian connector).

The companion catalogue [`.planning/codebase/CONCERNS.md`][concerns] is
the Phase-0 leak inventory; every row there must appear here with a
disposition. Cross-references inline.

[concerns]: ../../.planning/codebase/CONCERNS.md
[adr-002]: ./adr/002-adapter-seams.md
[context]: ../../.planning/phases/01-adapter-extraction-tech-debt-up/01-CONTEXT.md
[research]: ../../.planning/phases/01-adapter-extraction-tech-debt-up/01-RESEARCH.md

## Inventory

| # | Leak | Location (Phase-0 ref) | Severity | Status | Phase | Resolved-in / Rationale |
|---|------|------------------------|----------|--------|-------|-------------------------|
| 1 | `obsidianUrl()` helper minting `obsidian://open?vault=…&file=…` directly from the MCP server layer | `src/server.ts:1333` (pre-Phase-1) — also returned in `handleSearchCompat()` connector responses | Medium | **fixed-v2** | 1 | Plan 01-04: deleted; replaced by `SourceConnector.formatDisplayUrl(id)` per D-01. Now lives in `src/adapters/source/obsidian-fs/index.ts:formatDisplayUrl`. Future adapters publish their own URL scheme through the same contract. I-5b lint gate enforces. |
| 2 | Hardcoded `DEFAULT_CLIENT_ID = "claude-code"` falsely identifying every write as Claude even when called from another MCP client | `src/write/write.ts:76` (pre-Phase-1) — flowed into `audit_log` rows | High | **fixed-v2** | 1 | Plan 01-04: removed; replaced by MCP `InitializeRequest.params.clientInfo.name` capture (lazy closure pattern in `src/server.ts:79`). Fallback to `"unknown"` per RESEARCH Pitfall 4 (clientInfo is optional in the MCP spec). Audit-log entries now observably truthful. |
| 3 | Obsidian-specific globs in `DEFAULT_EXCLUDES` (`.obsidian/**`, `.trash/**`) hardcoded in the core scanner | `src/reader/scanner.ts:8` (pre-Phase-1) | Low | **fixed-v2** | 1 | Plan 01-03: relocated to `src/adapters/source/obsidian-fs/scanner.ts` per D-03. Core code carries no Obsidian-specific exclude defaults. Future non-Obsidian adapters define their own defaults via `SourceConnector` capabilities. |
| 4 | `gray-matter` (YAML frontmatter parser) imported directly outside the source adapter | `src/write/write.ts:13` + `src/frontmatter/update.ts:24` (pre-Phase-1) | Medium | **fixed-v2** | 1 | Plan 01-04: both relocated/refactored. `gray-matter` now confined to `src/adapters/{source,delivery}/obsidian-fs/` (source PARSES frontmatter; delivery MUTATES it via `update.ts` re-routed through the delivery facade). I-4 lint gate enforces. |
| 5 | `chokidar` (filesystem watcher) imported outside any adapter boundary | `src/watcher/watcher.ts:15-16` (pre-Phase-1) | Low | **fixed-v2** | 1 | Plan 01-05: relocated to `src/adapters/change-feed/obsidian-fs/{change-feed.ts,watcher.ts}`. The `ChangeFeed` interface is now the seam; future non-Obsidian adapters supply their own event source. I-1 lint gate enforces. |
| 6 | Bare `".md"` literals (file-extension assumptions) scattered through 7 sites outside any adapter | `.planning/codebase/CONCERNS.md` §"Bare `.md` literals" (7 sites listed) | Low | **fixed-v2** | 1 | Plans 01-03..05: every site relocated into the appropriate adapter (source for read paths, delivery for write paths, change-feed for filtering). I-5 lint gate enforces. |
| 7 | Raw `node:path` / `node:fs` imports in vault-content code paths outside the obsidian-fs adapter | `src/reader/`, `src/write/`, `src/watcher/` (pre-Phase-1) | Medium | **fixed-v2** | 1 | Plans 01-03..05: all three legacy directories deleted; replacements live under `src/adapters/{source,delivery,change-feed}/obsidian-fs/`. I-2 + I-3 lint gates enforce. Allow-list scoped to infrastructure-only callers: `src/config/` (config-file I/O), `src/vault/` (SQLite DB-dir mgmt), `src/rerank/` (ONNX model loader), `src/server.ts` (ONNX model dir default), `src/indexer/single.ts` (vault-boundary check). |
| 8 | `src/config/add-vault.ts` performs `fs.writeFile` to `.mcp.json` + `config.toml` without `safeJoinInsideVault` traversal guard | `src/config/add-vault.ts:189, 232, 250` | Low | **mixed** | 1 / 8 | v2: scope unchanged — these are config-file writes (NOT vault content), and the path is user-supplied at the CLI. The v2 lint allow-list (I-6) intentionally includes `src/config/` for this reason; vault-content writes still gate through `src/adapters/delivery/`. v3 hardening (path-canonicalization + traversal-guard) deferred to Phase 8 release-engineering per CONCERNS §"Path Traversal on Write Operations" (CLI is run by vault owner; severity Low). |
| 9 | `src/rerank/onnx-reranker.ts` reads ONNX model + tokenizer files via `existsSync` + `readFile` against caller-supplied `modelDir` | `src/rerank/onnx-reranker.ts:30-32, 41-44` | Low | **mixed** | 1 / 10 | v2: scope unchanged — ONNX model dir is an infrastructure path (`~/.vault-memory/models/...`), not vault content. The v2 lint allow-list (I-2 + I-3) intentionally includes `src/rerank/` for this reason. Plan 01-06 chose **option (ii)** from CONTEXT.md Claude's Discretion #5 (allow-list edit) over option (i) (introduce a `ModelLoader` interface). Rationale: a ModelLoader carve-out is a refactor of an unrelated subsystem; the allow-list captures the architectural fact that the reranker is an infrastructure dependency, not vault content. v3+ may revisit if a non-ONNX reranker shape lands. |
| 10 | `src/server.ts` retains `joinPath` (node:path) for ONNX model dir default; `src/vault/manager.ts` retains `join` + `mkdir` for DB dir | `src/server.ts:27, 137`; `src/vault/manager.ts:12-13, 27, 31, 39` | Low | **fixed-v2 (allow-listed)** | 1 | Same as #9. Both are infrastructure paths (~/.vault-memory model dir + SQLite DB dir); the lint allow-lists `src/server.ts` for I-3 and `src/vault/` for I-2 + I-3. The architectural invariant is satisfied: NO raw filesystem operations touch vault content outside the obsidian-fs adapter. |
| 11 | `src/cli.ts` user-facing strings referencing "Claude Code" by name (D-02 follow-through site) | `src/cli.ts:102, 179` (post-Phase-0) | Low | **fixed-v2** | 1 | Plan 01-06 Task 03: both replaced with neutral framing ("an MCP-aware client" / "your MCP-aware client"). `grep -ic claude src/cli.ts → 0`. C-1 lint gate enforces. |
| 12 | Comments + JSDoc in `src/server.ts` + `src/adapters/delivery/obsidian-fs/write.ts` documenting the removed `"claude-code"` hardcode | `src/server.ts:71-72`; `src/adapters/delivery/obsidian-fs/write.ts:58-59, 90` | Low | **fixed-v2** | 1 | Plan 01-06 Task 03: rewrites to generalized framing ("hardcoded client name" / "the previous hardcode lied for any client that wasn't the assumed one"). No escape marker needed. |
| 13 | Tool description for `search` (OB1 connector adapter) names real product names "Claude.ai" + "Deep-Research" | `src/tool-registry.ts:367` | Low | **fixed-v2 (escape-marked)** | 1 | Plan 01-06 Task 03: kept verbatim (v1-baseline snapshot byte-for-byte preservation requirement) but annotated with `// vault-memory:claude-ok` escape marker. The mention names real OB1-connector-ecosystem product names; it does NOT couple the server to a specific client. The escape marker is the documented C-1 lint-bypass for legitimate ecosystem references. |
| 14 | `src/config/add-vault.ts` JSDoc references "Claude Code" + `".claude/**"` default exclude glob | `src/config/add-vault.ts:5, 9, 61` | Low | **fixed-v2 (escape-marked)** | 1 | Plan 01-06 Task 03: JSDoc rewritten to list MCP-host examples (ChatGPT Custom Connectors, Claude Desktop) — escape-marked because the rewrite intentionally names real product names as ecosystem references. The `.claude/**` glob escape-marked because it's the Obsidian-side directory name used by any MCP-host integration, not Claude-only. |
| 15 | Wikilinks table + `WikilinkResolver` tied to Obsidian semantics (`[[…]]` syntax + alias resolution) | `src/db/schema.ts:103` (wikilinks table); `src/indexer/resolver.ts` (resolver) — kept in place by D-04 | Medium | **deferred-v3** | 4 | Per CONTEXT §D-04: graph-edge abstraction deferred entirely to Phase 4 (GRA-04 typed-edge schema). Phase 1 CI greps do NOT flag the token `wikilink`. Phase 4 will promote the wikilinks table to a typed `edges` table with `type: "wikilink" \| "block-ref" \| "transclude"`. |
| 16 | `Document.properties.wikilinks` PropertyBag shape (Phase 1 intermediate form for graph edges) | `src/adapters/source/obsidian-fs/index.ts:readDocument()` — surface lives in `Document.properties.wikilinks: WikilinkRef[]` | Low | **fixed-v2 (intermediate)** | 1 / 4 | Per CONTEXT §D-05: wikilinks surface as `Document.properties.wikilinks: WikilinkRef[]` in Phase 1. Phase 4 will promote to `Document.edges: Edge[]` with `type: "wikilink"` per the GRA-04 ADR. The PropertyBag shape is the intentional intermediate form preserving v1 tool surface during Phase 1; Phase 4 introduces the new graph shape additively without breaking v1 callers. |
| 17 | Memory-sink write guard (Guard A "is the target inside a labeled MemorySink?" + Guard B "is the agent's clientInfo authorized?") | `src/adapters/delivery/obsidian-fs/index.ts:write()` — seam signature only in v2 | Medium | **deferred-v3** | 2 | Per CONTEXT and ADR-004: Phase 1 ships the seam SHAPE (TSDoc note documenting the contract); Phase 2 (MEM-01..12) injects Guard A + Guard B INSIDE `write()`. Public method signature unchanged across the boundary, so guard injection is non-breaking. The memory-sink invariant is THE non-negotiable safety constraint for v2 → v3; Phase 1 only had to preserve the seam shape, which it does. |
| 18 | `src/config/add-vault.ts` path-safety hardening (canonicalization + traversal guards on user-supplied vault paths) | `src/config/add-vault.ts` — see CONCERNS §"Path Traversal on Write Operations" | Low | **deferred-v3** | 8 | Local CLI; vault owner runs it; severity Low. Not in ADP scope (ADP-01..15 cover adapter-seam extraction, not CLI hardening). Tracked for Phase 8 release-engineering. |
| 19 | Pre-migration DB backup before SQLite schema migrations | `src/db/database.ts:99` (`migrateInternal()`) — see CONCERNS §"No Pre-Migration DB Backup" | Low | **deferred-v3** | 8 | SQLite transaction rollback is sufficient safety for the additive doc_uri migration (Strategy A) shipped in plan 01-02. Tracked for Phase 8 release-engineering when bigger migrations land. |
| 20 | Adapter-private SQLite tables (per-connector cache namespace, `__adapter_<scheme>_*` permission gating) | not yet present in v2 — registry contract only | Low | **deferred-v3** | 10 | obsidian-fs needs no cache (sha256(body) is cheap). The `__adapter_<scheme>_*` permission lives in `src/adapters/registry.ts` contract; no table created until Phase 10 / first connector that needs caching (e.g., a Notion connector caching page lists). |
| 21 | `VAULT_MEMORY_<SCHEME>_*` env-var convention for per-adapter secrets | not yet present — convention from Phase-0 Adversarial Finding 1 | Low | **deferred-v3** | 10 | obsidian-fs needs no secrets (local FS, no auth). Convention lands when first adapter needs them (Notion API key, Slack token, etc.). Phase 10 deliverable. |
| 22 | Per-connector network egress (no outbound calls beyond `localhost:11434` Ollama in v2) | enforced in `src/ollama/client.ts` (only HTTP target) | High (constraint) | **fixed-v2 (constraint preserved)** | 1 | Per CLAUDE.md "Local-only network — `localhost:11434` (Ollama) only in v2". Phase 10 may add per-connector outbound calls behind a gated capability (`SourceConnector.requiresNetwork: boolean` + per-connector allow-list). Not in Phase 1 scope. |

## Sign-off note

Every row above is either:
- **fixed-v2** — closed in Phase 1, with an explicit resolution commit and an enforcing
  lint gate where applicable, **OR**
- **mixed** — architectural shape established (lint-allow-listed for infrastructure
  paths that don't touch vault content), with hardening deferred to a named later phase, **OR**
- **deferred-v3** — explicitly scoped to a named later phase (2, 4, 8, or 10) with the
  rationale recorded above.

Maintainer signs off on the audit's completeness in the PR description per VALIDATION
manual-only row 1.

## Cross-references

- [`docs/v2/adr/002-adapter-seams.md`][adr-002] — the ADR these invariants enforce.
- [`docs/v2/AGENT_AGNOSTIC.md`](./AGENT_AGNOSTIC.md) — the architectural framing.
- [`.planning/codebase/CONCERNS.md`][concerns] — the Phase-0 leak inventory this audit closes.
- [`.planning/phases/01-adapter-extraction-tech-debt-up/01-CONTEXT.md`][context] — the
  phase-level decisions D-01..D-05 + Claude's Discretion #1..#5.
- [`.planning/phases/01-adapter-extraction-tech-debt-up/01-RESEARCH.md`][research] — the
  research findings backing the lint patterns and smoketest design.
- `scripts/lint-adapters.sh` — the mechanical enforcement of rows 1–14.
- `scripts/smoketest-non-claude.mjs` — the runtime proof of agent-agnosticism.
