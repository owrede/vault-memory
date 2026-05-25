/**
 * unset_mcp_client + refresh_source — SOURCES-REGISTRY.md §6 (Stage 2).
 *
 * Two plugin-gated tools that operate on the LIVE PeerMcpRegistry (not
 * config.toml). They complement `set_mcp_client`, which mutates the
 * persisted config:
 *
 *   - refresh_source({name}) — re-issue tools/list against the live peer
 *     and refresh the cache. Returns the updated status + tool_count.
 *
 *   - unset_mcp_client({name}) — dispose the live client and drop it from
 *     the registry. Idempotent. NOTE: this affects the running process
 *     only; to also remove the persisted entry, the caller pairs this
 *     with `set_mcp_client({name, remove:true})`.
 *
 * # Adapter-seam discipline
 *
 * Imports `zod` only. The registry is threaded via a minimal facade so
 * the tools are unit-testable without spawning peers.
 */

import { z } from "zod";
import type { PeerMcpStatus } from "../contracts/mcp-clients.js";

/**
 * Minimal live-registry facade the tools depend on. The real caller
 * passes the singleton `PeerMcpRegistry`; tests pass a fake.
 */
export interface SourceRegistryFacade {
  refresh(
    name: string,
  ): Promise<{ status: PeerMcpStatus; tools: readonly unknown[]; error?: string } | undefined>;
  remove(name: string): boolean;
}

// ─── refresh_source ─────────────────────────────────────────────────────

const RefreshSourceArgs = z.object({
  name: z.string().min(1).describe("Peer-MCP source name to refresh (re-poll tools/list)."),
});

export type RefreshSourceInput = z.infer<typeof RefreshSourceArgs>;

export type RefreshSourceResult =
  | { ok: true; name: string; status: PeerMcpStatus; tool_count: number; error?: string }
  | { ok: false; name: string; error: string };

async function refreshHandler(
  args: RefreshSourceInput,
  deps: SourceRegistryFacade,
): Promise<RefreshSourceResult> {
  const info = await deps.refresh(args.name);
  if (info === undefined) {
    return { ok: false, name: args.name, error: `unknown source: ${args.name}` };
  }
  const result: RefreshSourceResult = {
    ok: true,
    name: args.name,
    status: info.status,
    tool_count: info.tools.length,
  };
  if (info.error !== undefined) result.error = info.error;
  return result;
}

export const refreshSourceTool = {
  name: "refresh_source" as const,
  description:
    "Re-poll tools/list against a live peer-MCP source and refresh its cached " +
    "tool list. Returns the updated status (connected/unavailable/unreachable) " +
    "and tool_count. SOURCES-REGISTRY §6.3.",
  inputSchema: RefreshSourceArgs,
  handler: refreshHandler,
};

// ─── unset_mcp_client ─────────────────────────────────────────────────────

const UnsetMcpClientArgs = z.object({
  name: z.string().min(1).describe("Peer-MCP source name to disconnect + drop from the registry."),
});

export type UnsetMcpClientInput = z.infer<typeof UnsetMcpClientArgs>;

export type UnsetMcpClientResult = {
  ok: true;
  name: string;
  /** True when a live client was disposed; false when the name was unknown. */
  removed: boolean;
};

async function unsetHandler(
  args: UnsetMcpClientInput,
  deps: SourceRegistryFacade,
): Promise<UnsetMcpClientResult> {
  const removed = deps.remove(args.name);
  return { ok: true, name: args.name, removed };
}

export const unsetMcpClientTool = {
  name: "unset_mcp_client" as const,
  description:
    "Disconnect a live peer-MCP source and drop it from the running registry. " +
    "Idempotent (removed:false when the name is unknown). Affects the running " +
    "process only — pair with set_mcp_client({name, remove:true}) to also " +
    "delete the persisted config entry. SOURCES-REGISTRY §6.2.",
  inputSchema: UnsetMcpClientArgs,
  handler: unsetHandler,
};
