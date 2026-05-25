# Sources Registry — first-class MCP sources in vault-memory

**Status:** Accepted (2026-05-25) — server-side Stage 1+2 ratified by [ADR-025](../../docs/v2/adr/025-sources-registry.md); plugin curation UI is Stage B
**Owner:** UX & contract editor track
**Depends on:** Phase 6 peer-MCP (`PeerMcpRegistry`), Phase 7 plugin MCP client + plugin-gated `set_mcp_client` tool, existing Chrome-view Connectors panel
**Supersedes:** the ad-hoc reliance on `[contracts.mcp_clients.<name>]` for palette population

## 0. Relationship to existing infrastructure

The plugin already has a **Connectors panel** in the Chrome view (`plugin/src/chrome/connectors-panel.svelte`, controller in `connectors-controller.ts`). It calls `set_mcp_client {list: true}` and supports add/remove/test/refresh against the server-side `PeerMcpRegistry`. The `set_mcp_client` tool is plugin-gated and already exists.

This spec **extends, does not replace**, that infrastructure:

- **Connectors panel (existing, Chrome view)** stays focused on connection lifecycle: list / add / remove / test live connections.
- **Sources panel (new, Settings tab)** is the curation surface: for each source, browse its `tools/list` and toggle which tools appear in the palette.
- **Shared data path:** both read the same `set_mcp_client {list:true}` inventory. The Sources panel additionally reads per-source `tools/list` (via a new resource).

We retain both because the audiences differ — "I need to add a connection" is a power-user occasional task in the Chrome view; "which of these 40 Notion tools do I want in my palette today?" is a frequent curation task that belongs next to the contract editor.

## 1. Problem

The contract editor palette today populates its SOURCES dropdown from a single resource (`vault-memory://contract-verbs`). That resource reports only verbs **already used** in audited contracts; servers configured in `[contracts.mcp_clients.*]` but not yet referenced from any contract never appear. There is no UI to:

- inspect which peer MCP servers vault-memory currently holds a live connection to,
- see the full `tools/list` of each peer (so the palette can offer them as new cards),
- curate which tools are exposed in the palette (so a Notion server with 40 tools doesn't drown the palette),
- add a new peer server without hand-editing `~/.vault-memory/config.toml` and restarting.

The plugin is the user's UI surface for vault-memory; the registry of sources belongs in the plugin (settings tab) but the **state and connections** belong in the server (`PeerMcpRegistry`). The plugin should be a thin curated view over server state, plus a CRUD surface that mutates the server's runtime config.

## 2. Goals

1. **Server is authoritative.** vault-memory owns the live peer-MCP connections and exposes them via MCP resources. The plugin reads + curates; it does not maintain its own parallel registry.
2. **First-class source objects** — each known peer MCP server is `{name, transport, status, tools[], enabledTools[]}`. `tools[]` comes from `tools/list`; `enabledTools[]` is user curation.
3. **Settings tab is the curation UI.** A new "Sources" section lists known servers, shows live status, and lets the user toggle individual tools on/off for palette exposure.
4. **Palette consumes the registry.** SOURCES dropdown lists `vault-memory` plus every connected source with ≥1 enabled tool. Selecting a source filters the palette to that source's enabled tools.
5. **Curation persists across restarts.** Enabled-tool sets live in the plugin's `data.json` (not server config) because they're a UI preference, not a server capability.
6. **No new transport.** v2.x ships stdio-only peers, same as today's `[contracts.mcp_clients]`. HTTP/SSE peers are explicitly out of scope.
7. **Backwards-compatible.** Existing `[contracts.mcp_clients.*]` config keeps working unchanged; sources added through the new flow append to the same registry. The contract DSL's `mcp://server/tool` verb syntax is unchanged.

## 3. Non-goals

- A curated catalog of one-click sources (Notion / Linear / GitHub). That is a future onboarding feature; this spec keeps "Add source" a raw-transport form.
- HTTP / SSE / remote-MCP transports.
- Per-tool argument default UI (the inspector already handles that per step).
- Replacing the `[contracts.mcp_clients]` TOML block. New sources added via the UI are persisted by the plugin and pushed to the server at boot via `set_mcp_client` (existing plugin-tool). The TOML block remains the source of truth for users who prefer file-based config.

## 4. Architecture

```
┌─────────────────────────── Obsidian renderer ──────────────────────────┐
│  Settings tab > Sources section                                        │
│    ▸ reads:  vault-memory://sources                                    │
│    ▸ reads:  vault-memory://sources/{name}/tools                       │
│    ▸ writes: settings-store (enabledTools per source)                  │
│    ▸ calls:  set_mcp_client (add), unset_mcp_client (remove)           │
│              refresh_source (re-poll tools/list)                       │
│                                                                        │
│  Contract editor > palette pane                                        │
│    ▸ reads:  vault-memory://sources         (which sources exist)      │
│    ▸ reads:  vault-memory://sources/{name}/tools  (tool catalog)       │
│    ▸ reads:  settings-store.sourceEnabledTools (curation filter)       │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ MCP (stdio)
┌───────────────────────────────▼────────────────────────────────────────┐
│  vault-memory server                                                   │
│    PeerMcpRegistry  (existing — src/contracts/mcp-clients.ts)          │
│      ▸ map<name, PeerMcpClient> with .available flag                   │
│      ▸ NEW: per-client tools cache (tools/list result)                 │
│      ▸ NEW: refresh(name) → re-call tools/list                         │
│      ▸ NEW: add(name, cfg) → spawn + register (runtime)                │
│      ▸ NEW: remove(name) → dispose + unregister                        │
│                                                                        │
│    Resources                                                           │
│      vault-memory://sources                                            │
│      vault-memory://sources/{name}/tools                               │
│      vault-memory://sources/{name}/tools/{tool}                        │
│                                                                        │
│    Plugin-gated tools (existing `[plugin] enabled = true` gate)        │
│      set_mcp_client     — already exists; extend semantics             │
│      unset_mcp_client   — NEW                                          │
│      refresh_source     — NEW (calls registry.refresh(name))           │
└────────────────────────────────────────────────────────────────────────┘
```

The plugin and the server already share the lifecycle pattern (`PeerMcpRegistry` server-side ↔ `VaultMemoryMcpClient` plugin-side, both built on `@modelcontextprotocol/sdk`). This spec extends `PeerMcpRegistry` and adds three resources + two tools — no new architectural seams.

## 5. Resource contracts

### 5.1 `vault-memory://sources`

List of known peer-MCP sources.

**Response shape (JSON):**

```json
{
  "sources": [
    {
      "name": "github",
      "transport": "stdio",
      "command": "gh-mcp-server",
      "args": ["--config", "/path/to/config"],
      "status": "connected",
      "tool_count": 14,
      "last_refreshed": 1747918245
    },
    {
      "name": "notion",
      "transport": "stdio",
      "command": "notion-mcp",
      "args": [],
      "status": "unavailable",
      "tool_count": 0,
      "last_refreshed": null,
      "error": "ENOENT: notion-mcp not found on PATH"
    }
  ]
}
```

**Status values:**

- `"connected"` — `PeerMcpClient.available === true` and `tools/list` succeeded ≥ once.
- `"unavailable"` — boot-time spawn failed (existing `wrapUnavailable` path). `error` carries the captured message.
- `"unreachable"` — connected at boot but a subsequent `tools/list` failed (transient peer crash). Distinct from `unavailable` so the UI can offer a retry.

**Notes:**

- `env` is intentionally omitted from the response — secrets may live there. Tools that need to mutate env go through `set_mcp_client` which already accepts the secret-resolution path.
- `vault-memory` itself is **not** in this list. It is the host. The palette adds it as a synthetic first entry.

### 5.2 `vault-memory://sources/{name}/tools`

The cached `tools/list` for one source.

```json
{
  "name": "github",
  "status": "connected",
  "last_refreshed": 1747918245,
  "tools": [
    {
      "name": "list_issues",
      "title": "List issues",
      "description": "List issues in a GitHub repository ...",
      "inputSchema": { "type": "object", "properties": { ... } }
    }
  ]
}
```

`tools[]` is the raw MCP `tools/list` payload, unmodified, so the inspector can use `inputSchema` to type-check step args later. When `status !== "connected"`, `tools` is `[]`.

### 5.3 `vault-memory://sources/{name}/tools/{tool}`

A single tool's full schema. Identical shape to one element of `tools[]` above. Optimisation for the inspector, which only needs one tool's schema at a time. Implementations may inline this from the cached list (no extra peer call required).

## 6. Tool contracts (plugin-gated)

All three live behind the existing `[plugin] enabled = true` gate (same as `set_runtime_config` etc.).

### 6.1 `set_mcp_client` (extend existing)

Already accepts `{name, command, args, env}` and pushes the config into the running `PeerMcpRegistry`. **Extension:** after the spawn succeeds, call `tools/list` once and cache the result. After failure, leave the existing unavailable-wrapper in place AND return the captured error in the tool response so the UI can show it inline.

**Response (extended):**

```json
{
  "ok": true,
  "name": "github",
  "status": "connected",
  "tool_count": 14
}
```

or on failure:

```json
{
  "ok": false,
  "name": "github",
  "status": "unavailable",
  "error": "ENOENT: gh-mcp-server not found on PATH"
}
```

### 6.2 `unset_mcp_client` (new)

```ts
input: { name: string }
output: { ok: true, name: string } | { ok: false, error: string }
```

Calls `PeerMcpRegistry.remove(name)` which disposes the client and drops the entry from the map. Idempotent — removing an unknown name returns `{ok: true}` with no side effects.

### 6.3 `refresh_source` (new)

```ts
input: { name: string }
output: { ok: true, name: string, status: SourceStatus, tool_count: number }
      | { ok: false, name: string, error: string }
```

Re-issues `tools/list` against the live peer client. Updates the registry cache and `last_refreshed` timestamp. If the peer is `"unavailable"`, attempts a fresh spawn first.

## 7. Plugin curation model

The plugin owns `sourceEnabledTools: Record<sourceName, string[]>` in `data.json`:

```jsonc
{
  // ... existing settings ...
  "sourceEnabledTools": {
    "github": ["list_issues", "create_issue", "get_pr"],
    "notion": ["search", "get_page"]
  }
}
```

**Semantics:**

- A source missing from the map → **all** its tools are enabled (default-on). New sources start usable without curation.
- A source present with `[]` → all tools disabled. The source appears in the settings list (so the user can re-enable) but **not** in the palette dropdown.
- A source present with a non-empty array → only those tools appear in the palette.
- The palette filter is applied at the plugin layer (palette-pane.svelte). The server has no knowledge of enabledTools — it always returns the full set.

Curation is per-plugin-install (per Obsidian vault), so a user with two vaults that share `~/.vault-memory/config.toml` can curate the palette differently in each.

## 8. Settings tab — Sources section UI

New section appended to the existing settings tab (after Secrets, before Changelog). Pure Obsidian `Setting` rows + one Svelte mount for the live table.

### 8.1 Section header

```
Sources
Peer MCP servers vault-memory connects to. Each source exposes a set of
tools that appear in the contract editor palette.
```

### 8.2 Source list (Svelte panel `sources-panel.svelte`)

For each source from `vault-memory://sources`:

```
┌──────────────────────────────────────────────────────────────────────┐
│  ● github                                              [↻] [Remove]  │
│  stdio · gh-mcp-server --config /path/to/config                      │
│  Connected · 14 tools · last refreshed 2 minutes ago                 │
│                                                                      │
│  ▾ Tools (8 of 14 enabled)                                          │
│    ☑ list_issues          List issues in a repository                │
│    ☑ create_issue         Create a new issue                         │
│    ☐ delete_repo          Delete a repository                        │
│    ...                                                               │
└──────────────────────────────────────────────────────────────────────┘
```

**Elements:**

- **Status indicator** — green dot (connected), grey (unavailable), amber (unreachable). Title attribute carries the error message when present.
- **[↻] Refresh** — calls `refresh_source`. Spinner during call. Updates `last_refreshed`.
- **[Remove]** — calls `unset_mcp_client` after a confirm modal. Disabled if the source comes from `[contracts.mcp_clients]` TOML (those are file-managed; offer a tooltip pointing at config.toml).
- **Transport line** — `stdio · <command> <args>`. Read-only.
- **Status line** — combines status + tool count + relative time.
- **Tools accordion** — collapsed by default. Lists every tool; checkbox per row writes to `sourceEnabledTools[name]`. Plain-language `title` (falls back to `name`) + truncated `description` as helper text.

### 8.3 Add source form

```
┌──────────────────────────────────────────────────────────────────────┐
│  Add source                                                          │
│                                                                      │
│  Name        [github             ]  Used in mcp://NAME/tool verbs   │
│  Command     [gh-mcp-server      ]  Executable on PATH or absolute  │
│  Arguments   [--config /path     ]  Space-separated                 │
│                                                                      │
│                              [Cancel]  [Add and connect]            │
└──────────────────────────────────────────────────────────────────────┘
```

**Validation:**

- `name` — `/^[a-z][a-z0-9_-]*$/` (matches the verb regex's server segment).
- `command` — non-empty. No further validation; the spawn either works or returns ENOENT.
- `args` — split on whitespace, then trimmed. No shell quoting; users with complex args should edit config.toml.

**Behaviour:**

- Submit → `set_mcp_client({name, command, args})`.
- Success → fold the form, append a new card to the list with the response payload.
- Failure → keep the form open, show the error under the status line.

### 8.4 Empty state

If `sources` is `[]`:

```
No peer MCP servers configured yet.
Add one above, or edit ~/.vault-memory/config.toml under
[contracts.mcp_clients.<name>].
```

## 9. Palette wiring

The palette pane (`palette-pane.svelte`) currently calls `mcpClient.readResource("vault-memory://contract-verbs/<vault>")` and builds the SOURCES list from the resulting verb prefixes. New flow:

1. On mount, call `vault-memory://sources` → array of `{name, status, tool_count}`.
2. For each source with `status === "connected"` AND `(enabledTools[name] ?? all) is non-empty`, read `vault-memory://sources/{name}/tools`.
3. Build palette entries from each source's tools, filtered by `enabledTools`.
4. Prepend the vault-memory entry (built from the existing static verb catalog).
5. SOURCES dropdown lists vault-memory + every connected source with ≥1 enabled tool.

Refresh button on the palette stays — wired to call `refresh_source` per visible source in parallel, then re-issue step 2.

The existing `contract-verbs` resource keeps working (verbs already in use still show up via the audit-driven path). The new `sources` path is a strict superset.

## 10. Migration

No schema changes. `data.json` gains one optional key (`sourceEnabledTools`). Existing installations get `undefined` → default-on for everything → palette behaves identically to today (modulo the new sources that suddenly appear because we now poll `tools/list` proactively).

`PeerMcpRegistry` changes are additive: existing `start()` loop is unchanged; the new `add` / `remove` / `refresh` methods plus the per-client tools cache slot in alongside.

## 11. Open questions / deferred

- **Per-tool category override.** Today's palette categorises by verb-catalog heuristic. Should a user be able to set a category per tool in the settings UI? Defer — wait until we have ≥2 sources with ≥10 tools each and see whether default categorisation is good enough.
- **Hot-reload of `[contracts.mcp_clients]` config.toml edits.** Out of scope; restart Obsidian.
- **Server-side enabledTools.** Could enforce curation at `tools/list` time so the audit log doesn't grow with unused-tool registrations. Defer — current usage volume doesn't justify it.
- **HTTP / SSE transports.** Out of scope for v2.x.
- **Secrets in `env`.** The existing `resolve_secret` flow covers this; the Add-source form does not expose env in v1, so users with secret-bearing peers must use config.toml until a later spec.

## 12. Implementation order (suggested)

These are independent enough to land as separate PRs:

1. **Server: extend `PeerMcpRegistry`** with `refresh(name)`, `add(name, cfg)`, `remove(name)`, and a per-client tools cache. Unit tests + the three new resource handlers.
2. **Server: register resources + two new tools** in `src/server.ts` + `resource-registry.ts`. Wire under the existing `[plugin] enabled` gate.
3. **Plugin: settings store** — add `sourceEnabledTools` field + default-on semantics; tests.
4. **Plugin: Sources panel (Svelte)** — list + accordion + add form. Initially with **mocked data** (Phase B of this spec's rollout, per user request). Lets the UI shape be reviewed without server changes.
5. **Plugin: wire panel to live resources/tools** once 1+2 are merged.
6. **Plugin: palette pane** — switch SOURCES dropdown population from `contract-verbs` to `sources` + per-source `tools`. Keep `contract-verbs` fallback for offline mode.

Step 4 is what the user has asked to start with after this spec lands.
