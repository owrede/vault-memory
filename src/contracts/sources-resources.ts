/**
 * Sources MCP Resources — SOURCES-REGISTRY.md §5 (Stage 2).
 *
 * Three pure read-only projections over the live `PeerMcpRegistry`.
 * Registered in `src/server.ts` via `server.registerResource(...)`.
 * Resources do NOT count toward the REL-08 tool budget (Phase 5 BRF-09
 * precedent, same as the contracts/contract-verbs resources).
 *
 *   - `readListSources(reg)` — `{sources: [{name, transport, command,
 *     args, status, tool_count, last_refreshed, error?}]}`. The host
 *     (vault-memory itself) is NOT included — the plugin prepends it as
 *     a synthetic entry. `env` is intentionally omitted (may hold
 *     secrets; SOURCES-REGISTRY.md §5.1).
 *
 *   - `readSourceTools(reg, name)` — `{name, status, last_refreshed,
 *     tools: [...]}`. `tools` is the cached tools/list payload; `[]` when
 *     the source is not connected.
 *
 *   - `readSourceTool(reg, name, tool)` — a single tool's schema, inlined
 *     from the cached list (no extra peer call). `{found:false}` when the
 *     source or tool is unknown.
 *
 * The registry does not retain per-source config beyond what it was
 * started/added with, so `command`/`args`/`transport` are accepted as a
 * lookup map passed alongside the registry (server threads the live
 * `config.contracts.mcp_clients` plus any runtime-added entries).
 *
 * # Adapter-seam discipline
 *
 * Zero fs/path/yaml/chokidar imports — pure data projection over the
 * registry interface + a plain config map.
 */

import type { PeerMcpRegistry, PeerMcpStatus, PeerMcpTool } from "./mcp-clients.js";

/** Connection/transport metadata for one source (config-derived). */
export interface SourceConfigMeta {
  command: string;
  args: readonly string[];
}

export interface ListSourcesEntry {
  name: string;
  transport: "stdio";
  command: string;
  args: readonly string[];
  status: PeerMcpStatus;
  tool_count: number;
  last_refreshed: number | null;
  error?: string;
}

export interface ListSourcesResource {
  sources: ListSourcesEntry[];
}

/**
 * Project every registered source into the list shape. `configMeta`
 * supplies command/args per source name; sources missing from the map
 * fall back to empty command/args (still listed — the registry is
 * authoritative for existence).
 */
export function readListSources(
  reg: PeerMcpRegistry,
  configMeta: Record<string, SourceConfigMeta>,
): ListSourcesResource {
  const sources: ListSourcesEntry[] = [];
  for (const name of reg.names()) {
    const info = reg.getInfo(name);
    if (info === undefined) continue;
    const meta = configMeta[name];
    const entry: ListSourcesEntry = {
      name,
      transport: "stdio",
      command: meta?.command ?? "",
      args: meta?.args ?? [],
      status: info.status,
      tool_count: info.tools.length,
      last_refreshed: info.lastRefreshed,
    };
    if (info.error !== undefined) entry.error = info.error;
    sources.push(entry);
  }
  return { sources };
}

export interface SourceToolsResource {
  name: string;
  status: PeerMcpStatus;
  last_refreshed: number | null;
  tools: readonly PeerMcpTool[];
  error?: string;
}

/** Per-source cached tools/list. `{error}` carries the unknown-source case. */
export function readSourceTools(
  reg: PeerMcpRegistry,
  name: string,
): SourceToolsResource | { error: string } {
  const info = reg.getInfo(name);
  if (info === undefined) {
    return { error: `unknown source: ${name}` };
  }
  const out: SourceToolsResource = {
    name,
    status: info.status,
    last_refreshed: info.lastRefreshed,
    tools: info.tools,
  };
  if (info.error !== undefined) out.error = info.error;
  return out;
}

export interface SourceToolResource {
  found: true;
  name: string;
  tool: PeerMcpTool;
}

/** A single tool's schema, inlined from the cache. */
export function readSourceTool(
  reg: PeerMcpRegistry,
  name: string,
  toolName: string,
): SourceToolResource | { found: false; error: string } {
  const info = reg.getInfo(name);
  if (info === undefined) {
    return { found: false, error: `unknown source: ${name}` };
  }
  const tool = info.tools.find((t) => t.name === toolName);
  if (tool === undefined) {
    return { found: false, error: `unknown tool: ${name}/${toolName}` };
  }
  return { found: true, name, tool };
}
