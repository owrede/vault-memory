---
title: Sources Registry — peer-MCP sources as first-class MCP Resources
status: Accepted
phase: 8
date: 2026-05-25
tags: sources, peer-mcp, mcp-resources, plugin-gated-tools, palette, curation, PeerMcpRegistry
depends-on: ADR-006, ADR-023
---

# ADR-025 — Sources Registry: peer-MCP sources as first-class MCP Resources

**Status:** Accepted
**Date:** 2026-05-25
**Phase:** 8 (v2.0.0 — server-side Stage 1+2 ships; plugin curation UI is Stage B)
**Supersedes:** the ad-hoc reliance on `vault-memory://contract-verbs` for palette population
**Superseded by:** —
**Related:** ADR-006 (Task Contract DSL — `PeerMcpRegistry`, `mcp://server/tool` verb syntax), ADR-023 (Contracts as MCP Resources — the "expose discovery as Resources, not tool roundtrips" precedent this ADR follows), `.planning/specs/SOURCES-REGISTRY.md` (the full design spec this ADR ratifies).

---

## Context

Phase 6 introduced `PeerMcpRegistry` — vault-memory can spawn and call peer MCP
servers (`mcp://server/tool` verbs in contracts). Phase 7 added a plugin
Connectors panel that lists/adds/removes live connections via the plugin-gated
`set_mcp_client` tool.

What was missing: a way for the contract-editor palette to **discover** what a
peer source offers *before* any contract references it. The palette populated
its SOURCES dropdown from `vault-memory://contract-verbs`, which only reports
verbs **already used** in audited contracts. A peer configured in
`[contracts.mcp_clients.*]` but not yet referenced never appeared. There was no
way to:

- inspect which peers vault-memory holds a live connection to,
- read a peer's full `tools/list` so the palette can offer them as new cards,
- curate which of a peer's tools surface in the palette (a Notion server with
  40 tools would drown it),
- add a peer without hand-editing `config.toml` and restarting.

The design principle, consistent with ADR-023: **discovery is a Resource, not a
tool roundtrip.** The server owns the live connections and authoritative state;
the plugin is a thin curated *view* over Resources plus a CRUD surface that
mutates server runtime config. The full design is `SOURCES-REGISTRY.md`; this
ADR ratifies the parts that ship server-side in v2.0.0.

---

## Decision

Expose peer-MCP sources through **three MCP Resources** (read/discovery) and
**two new plugin-gated tools** (mutation), backed by an extended
`PeerMcpRegistry`. No new architectural seam — this slots into the existing
Phase-6 registry and the Phase-7 plugin gate.

### Three Resources (always available; vault-independent)

| URI | Purpose | Spec |
|---|---|---|
| `vault-memory://sources` | List known peers: `{name, transport, command, args, status, tool_count, last_refreshed, error?}` | §5.1 |
| `vault-memory://sources/{name}/tools` | Cached `tools/list` for one peer (raw MCP payload, unmodified) | §5.2 |
| `vault-memory://sources/{name}/tools/{tool}` | A single tool's schema, inlined from the cache (no extra peer call) | §5.3 |

**Status enum** (three values, deliberately distinct):

- `connected` — `PeerMcpClient.available === true` and `tools/list` succeeded ≥ once.
- `unavailable` — boot-time spawn failed (existing `wrapUnavailable` path); `error` carries the message.
- `unreachable` — connected at boot but a later `tools/list` failed (transient peer crash) — distinct so the UI can offer retry.

`vault-memory` itself is **not** in the list — it is the host; the palette adds
it as a synthetic first entry. `env` is **never** in any response (secrets may
live there).

### Two plugin-gated tools (behind `[plugin] enabled = true`)

| Tool | Status | Contract |
|---|---|---|
| `set_mcp_client` | extended (Phase 7) | after a successful spawn, call `tools/list` once and cache it; on failure return the captured error inline |
| `unset_mcp_client` | NEW | `PeerMcpRegistry.remove(name)` — dispose client, drop entry; idempotent (unknown name → `{ok:true}`) |
| `refresh_source` | NEW | re-issue `tools/list`, update cache + `last_refreshed`; respawn first if `unavailable` |

### PeerMcpRegistry extension (additive)

The existing `start()` boot loop is unchanged. Added: a per-client tools cache
slot, and `refresh(name)` / `add(name, cfg)` / `remove(name)` methods.

### Curation lives in the plugin, not the server

`sourceEnabledTools: Record<sourceName, string[]>` lives in the plugin's
`data.json` — it is a UI preference, not a server capability. The server always
returns the full tool set; the palette filters at the plugin layer.
Default-on: a source absent from the map has all tools enabled. This is the
Stage-B plugin work; the server side (this ADR) is curation-agnostic.

---

## Invariants

| ID | Statement | Enforced by |
|---|---|---|
| SRC-1 | The three `vault-memory://sources*` Resources MUST be registered unconditionally (not behind the plugin gate) — discovery is read-only and safe. The default-off tool surface snapshot stays byte-identical; only the Resources list grows. | `evals/v1-baseline/resources-list.snapshot.json`; `server.plugin-gating.test.ts`. |
| SRC-2 | `unset_mcp_client` and `refresh_source` MUST be gated behind `[plugin] enabled = true`, identical to the other Phase-7 plugin tools. With `plugin.enabled` false (default) they MUST NOT appear in `tools/list`. | Plugin-gating test asserts default-off tool count unchanged. |
| SRC-3 | No source Resource response MAY include the peer's `env`. Secrets only flow through the existing `set_mcp_client` secret-resolution path. | `sources-resources.ts` constructs responses from `{command, args, status, ...}` only; unit test asserts `env` absent. |
| SRC-4 | `vault-memory` MUST NOT appear in `vault-memory://sources`. | Resource builder excludes the host; unit test asserts. |
| SRC-5 | `unset_mcp_client` MUST be idempotent — removing an unknown name returns `{ok:true}` with no side effects. | `source-tools.ts` `remove()` returns boolean; tool maps miss → `{ok:true}`. |
| SRC-6 | The `status` field MUST be one of `connected` / `unavailable` / `unreachable`. No other value is emitted. | `PeerMcpStatus` union type; exhaustive switch. |
| SRC-7 | Existing `[contracts.mcp_clients.*]` config and the `mcp://server/tool` verb syntax MUST keep working unchanged — this ADR is strictly additive (backwards-compat goal §2.7). | Phase-6 contract tests remain green (1692 passing). |

---

## Examples

### Listing sources

```jsonc
// readResource("vault-memory://sources")
{
  "sources": [
    { "name": "github", "transport": "stdio", "command": "gh-mcp-server",
      "args": ["--config", "/path"], "status": "connected",
      "tool_count": 14, "last_refreshed": 1747918245 },
    { "name": "notion", "transport": "stdio", "command": "notion-mcp",
      "args": [], "status": "unavailable", "tool_count": 0,
      "last_refreshed": null, "error": "ENOENT: notion-mcp not found on PATH" }
  ]
}
```

`env` is absent from both entries (SRC-3); `vault-memory` is not listed (SRC-4).

### Reading one source's tools

```jsonc
// readResource("vault-memory://sources/github/tools")
{
  "name": "github", "status": "connected", "last_refreshed": 1747918245,
  "tools": [
    { "name": "list_issues", "title": "List issues",
      "description": "List issues in a GitHub repository ...",
      "inputSchema": { "type": "object", "properties": { /* … */ } } }
  ]
}
// When status !== "connected", `tools` is [].
```

### Removing a source (plugin-gated, idempotent)

```jsonc
// unset_mcp_client({ name: "notion" })       → { "ok": true, "name": "notion" }
// unset_mcp_client({ name: "never-existed" }) → { "ok": true }   // SRC-5
```

With `[plugin] enabled` false (default), this tool is not in `tools/list` at all
(SRC-2).

---

## Consequences

**Positive.**

- The palette can offer a peer's tools before any contract references them —
  the core gap this closes. The `contract-verbs` path stays as a strict subset
  (offline / audit-driven fallback).
- Discovery is Resources, not tool calls — a host can embed the source catalog
  in context without a tool roundtrip (ADR-023 principle).
- Strictly additive: +3 Resources, +2 plugin-gated tools, +0 default-off tools.
  The v1-baseline tool snapshot is unaffected; only the Resources snapshot grows.

**Negative / costs.**

- The Resources list grows from 10 to 13. Hosts that pinned the full Resources
  list need a snapshot refresh (done: `resources-list.snapshot.json`).
- `PeerMcpRegistry` gains a per-client cache and three methods — a small surface
  increase on a Phase-6 component.
- Curation (`sourceEnabledTools`) is per-plugin-install, so two vaults sharing
  one `config.toml` curate independently. Intended (§7), but a support-FAQ item.

**Neutral.**

- Default-off MCP surface is byte-identical to v1; the plugin-gated surface
  grows by two tools only when `[plugin] enabled = true`.

---

## Open follow-ups (from SOURCES-REGISTRY §11)

- **Per-tool category override** in the settings UI — deferred until ≥2 sources
  with ≥10 tools each show whether default categorisation suffices.
- **Hot-reload of `config.toml` `[contracts.mcp_clients]` edits** — out of
  scope; restart Obsidian.
- **Server-side `enabledTools` enforcement** at `tools/list` time — deferred;
  current usage volume does not justify it.
- **HTTP / SSE peer transports** — out of scope for v2.x (stdio only, §2.6).
- **`env` secrets in the Add-source form** — covered by the existing
  `resolve_secret` flow; the form does not expose `env` in v1.

---

## References

- `.planning/specs/SOURCES-REGISTRY.md` — full design spec (§5 Resource
  contracts, §6 tool contracts, §7 curation model, §8 settings UI, §12
  implementation order).
- ADR-006 — `PeerMcpRegistry`, `mcp://server/tool` verb syntax.
- ADR-023 — Contracts as MCP Resources (discovery-as-Resource precedent).
- `src/contracts/sources-resources.ts`, `src/plugin-tools/source-tools.ts` —
  the server-side implementation (Stage 1+2).
