/**
 * syncPluginTools — Phase 7 / Plan 07-04 / D-MCP-SURFACE, ADR-007.
 *
 * Diff-based dynamic MCP Tool registration for the five plugin-control tools.
 * Mirrors `syncAutoRegistered` from Phase 6 (`src/contracts/auto-register.ts`)
 * line-for-line:
 *   1. computes the desired set from `PLUGIN_TOOL_NAMES` based on `opts.enabled`;
 *   2. removes tools no longer desired via `RegisteredTool.remove()`;
 *   3. adds new tools via `server.registerTool(name, config, callback)`;
 *   4. calls `server.sendToolListChanged()` exactly ONCE per mutation cycle.
 *
 * No-op (after removing any prior registrations) when `opts.enabled === false`.
 * Default-OFF gate is the structural mechanism that keeps the v1-baseline
 * tools-list snapshot byte-stable for non-plugin deployments (Phase 8 REL-08
 * ≤32-tool budget).
 *
 * # Adapter-seam discipline
 *
 * Imports only `@modelcontextprotocol/sdk` types + sibling tool modules.
 * Zero `fs` / `path` / `yaml` / `chokidar`.
 */

import type {
  McpServer,
  RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";

import { setRuntimeConfigTool } from "./set-runtime-config.js";
import type { SetRuntimeConfigInput } from "./set-runtime-config.js";
import { resolveSecretTool, ResolveSecretShape } from "./resolve-secret.js";
import type { ResolveSecretInput } from "./resolve-secret.js";
import { setMcpClientTool, SetMcpClientShape } from "./set-mcp-client.js";
import type { SetMcpClientInput } from "./set-mcp-client.js";
import { getRuntimeStatsTool } from "./get-runtime-stats.js";
import type { GetRuntimeStatsInput, StatsVault } from "./get-runtime-stats.js";
import { triggerReindexTool } from "./trigger-reindex.js";
import type {
  ReindexVault,
  TriggerReindexInput,
  TriggerReindexProgress,
} from "./trigger-reindex.js";
import { suppressContractWriteTool } from "./suppress-contract-write.js";
import type { SuppressContractWriteInput } from "./suppress-contract-write.js";
import {
  refreshSourceTool,
  unsetMcpClientTool,
  type RefreshSourceInput,
  type UnsetMcpClientInput,
  type SourceRegistryFacade,
} from "./source-tools.js";
import type { SuppressionSet } from "../adapters/change-feed/obsidian-fs/suppression.js";
import type { RuntimeConfigStore } from "./runtime-config.js";

// Re-exports — consumed by server.ts wiring + tests.
export { setRuntimeConfigTool } from "./set-runtime-config.js";
export { resolveSecretTool } from "./resolve-secret.js";
export { setMcpClientTool } from "./set-mcp-client.js";
export { getRuntimeStatsTool } from "./get-runtime-stats.js";
export { triggerReindexTool } from "./trigger-reindex.js";
export { suppressContractWriteTool } from "./suppress-contract-write.js";
export { refreshSourceTool, unsetMcpClientTool } from "./source-tools.js";
export type { SourceRegistryFacade } from "./source-tools.js";
export { RuntimeConfigStore } from "./runtime-config.js";

/**
 * Canonical list of plugin-control tool names. ORDER is significant only for
 * stable `tools/list` output — pinned here so the gating test can match
 * deterministically.
 *
 * Plan 07-07 added `suppress_contract_write` (CAN-08). The v1-baseline
 * tools-list snapshot stays byte-identical because the gate is default-OFF
 * — these names only land on the wire when `[plugin] enabled = true`.
 */
export const PLUGIN_TOOL_NAMES = [
  "set_runtime_config",
  "resolve_secret",
  "set_mcp_client",
  "get_runtime_stats",
  "trigger_reindex",
  "suppress_contract_write",
  // SOURCES-REGISTRY.md §6 (Stage 2) — live-registry source management.
  "refresh_source",
  "unset_mcp_client",
] as const;

export type PluginToolName = (typeof PLUGIN_TOOL_NAMES)[number];

export interface SyncPluginToolsOpts {
  /** D-MCP-SURFACE — default-OFF gate. No-op when false. */
  enabled: boolean;
  /** Runtime-config store consumed by set_runtime_config (PLG-01). */
  runtimeConfig: RuntimeConfigStore;
  /** Path to config.toml consumed by set_mcp_client (PLG-05). */
  configPath: string;
  /** Vault list provider consumed by get_runtime_stats + trigger_reindex. */
  listVaults: () => StatsVault[] & ReindexVault[];
  /** Peer-MCP status snapshot consumed by get_runtime_stats. */
  peerMcpStatus: () => Array<{ name: string; available: boolean }>;
  /** Contract count provider consumed by get_runtime_stats. */
  contractCountFor: (vault: string) => number;
  /** Reindex callback consumed by trigger_reindex (wraps indexVault). */
  reindexVault: (
    vaultName: string,
    onProgress?: (p: TriggerReindexProgress) => void,
  ) => Promise<void>;
  /** MCP SDK notifier consumed by trigger_reindex (for progressToken). */
  notifier: (notification: {
    method: "notifications/progress";
    params: { progressToken: string; progress: number; total?: number };
  }) => void;
  /**
   * Phase 7 / Plan 07-07 / CAN-08. Shared SuppressionSet consumed by
   * `suppress_contract_write`. Required when `enabled === true` — the
   * server bootstrap owns the singleton instance and threads it both
   * here and into `startContractRegistry` so a single set sees both
   * pathways.
   */
  suppression: SuppressionSet;
  /**
   * SOURCES-REGISTRY.md §6 (Stage 2). Live peer-MCP registry facade
   * consumed by `refresh_source` + `unset_mcp_client`. Required when
   * `enabled === true` — the server bootstrap owns the singleton
   * `PeerMcpRegistry` and threads it here.
   */
  sourceRegistry: SourceRegistryFacade;
}

/**
 * Wrap a handler result as an MCP `content[]` response. Mirrors `ok()` in
 * `src/server.ts`. We inline it rather than importing from server.ts to
 * preserve the adapter-seam discipline (no upward imports).
 */
function ok(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResponse(message: string): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/**
 * Sync the plugin-control MCP tools against the McpServer. Idempotent: a
 * second call with the same `enabled` state is a no-op (no register/remove
 * happens, `sendToolListChanged` does not fire).
 */
export function syncPluginTools(
  server: McpServer,
  registered: Map<string, RegisteredTool>,
  opts: SyncPluginToolsOpts,
): void {
  const desired = new Set<string>(opts.enabled ? PLUGIN_TOOL_NAMES : []);

  let mutated = false;

  // Remove tools no longer desired.
  for (const [toolName, regd] of Array.from(registered)) {
    if (!desired.has(toolName)) {
      regd.remove();
      registered.delete(toolName);
      mutated = true;
    }
  }

  if (!opts.enabled) {
    if (mutated) server.sendToolListChanged();
    return;
  }

  // Add missing tools. Each tool's Zod input schema is its raw object shape
  // (SDK 1.29 accepts a Zod schema OR a raw shape). We pass the schema's
  // `.shape` to satisfy the SDK type expectations (Pitfall F1 of Phase 6).
  const adds: Array<{ name: PluginToolName; reg: () => RegisteredTool }> = [
    {
      name: "set_runtime_config",
      reg: () =>
        server.registerTool(
          setRuntimeConfigTool.name,
          {
            description: setRuntimeConfigTool.description,
            inputSchema: setRuntimeConfigTool.inputSchema.shape,
          },
          async (args: unknown) => {
            try {
              const validated = setRuntimeConfigTool.inputSchema.parse(args) as SetRuntimeConfigInput;
              const result = await setRuntimeConfigTool.handler(validated, {
                store: opts.runtimeConfig,
              });
              return ok(result);
            } catch (err) {
              return errorResponse(err instanceof Error ? err.message : String(err));
            }
          },
        ) as RegisteredTool,
    },
    {
      name: "resolve_secret",
      reg: () =>
        server.registerTool(
          resolveSecretTool.name,
          {
            description: resolveSecretTool.description,
            // The exported raw shape (no .refine) is what SDK 1.29 accepts.
            // The handler re-validates with the refined schema for the
            // cross-field invariant (ciphertext OR error).
            inputSchema: ResolveSecretShape,
          },
          async (args: unknown) => {
            try {
              const validated = resolveSecretTool.inputSchema.parse(args) as ResolveSecretInput;
              const result = await resolveSecretTool.handler(validated);
              return ok(result);
            } catch (err) {
              return errorResponse(err instanceof Error ? err.message : String(err));
            }
          },
        ) as RegisteredTool,
    },
    {
      name: "set_mcp_client",
      reg: () =>
        server.registerTool(
          setMcpClientTool.name,
          {
            description: setMcpClientTool.description,
            // SDK 1.29 wants a ZodRawShapeCompat — the discriminator is
            // re-validated inside the handler via the refined union schema.
            inputSchema: SetMcpClientShape,
          },
          async (args: unknown) => {
            try {
              const validated = setMcpClientTool.inputSchema.parse(args) as SetMcpClientInput;
              const result = await setMcpClientTool.handler(validated, {
                configPath: opts.configPath,
              });
              return ok(result);
            } catch (err) {
              return errorResponse(err instanceof Error ? err.message : String(err));
            }
          },
        ) as RegisteredTool,
    },
    {
      name: "get_runtime_stats",
      reg: () =>
        server.registerTool(
          getRuntimeStatsTool.name,
          {
            description: getRuntimeStatsTool.description,
            inputSchema: getRuntimeStatsTool.inputSchema.shape,
          },
          async (args: unknown) => {
            try {
              const validated = getRuntimeStatsTool.inputSchema.parse(
                args,
              ) as GetRuntimeStatsInput;
              const result = await getRuntimeStatsTool.handler(validated, {
                listVaults: opts.listVaults,
                peerMcpStatus: opts.peerMcpStatus,
                contractCountFor: opts.contractCountFor,
              });
              return ok(result);
            } catch (err) {
              return errorResponse(err instanceof Error ? err.message : String(err));
            }
          },
        ) as RegisteredTool,
    },
    {
      name: "trigger_reindex",
      reg: () =>
        server.registerTool(
          triggerReindexTool.name,
          {
            description: triggerReindexTool.description,
            inputSchema: triggerReindexTool.inputSchema.shape,
          },
          async (args: unknown) => {
            try {
              const validated = triggerReindexTool.inputSchema.parse(
                args,
              ) as TriggerReindexInput;
              const result = await triggerReindexTool.handler(validated, {
                listVaults: opts.listVaults,
                reindexVault: opts.reindexVault,
                notifier: opts.notifier,
              });
              return ok(result);
            } catch (err) {
              return errorResponse(err instanceof Error ? err.message : String(err));
            }
          },
        ) as RegisteredTool,
    },
    {
      name: "suppress_contract_write",
      reg: () =>
        server.registerTool(
          suppressContractWriteTool.name,
          {
            description: suppressContractWriteTool.description,
            inputSchema: suppressContractWriteTool.inputSchema.shape,
          },
          async (args: unknown) => {
            try {
              const validated = suppressContractWriteTool.inputSchema.parse(
                args,
              ) as SuppressContractWriteInput;
              const result = await suppressContractWriteTool.handler(
                validated,
                { suppression: opts.suppression },
              );
              return ok(result);
            } catch (err) {
              return errorResponse(err instanceof Error ? err.message : String(err));
            }
          },
        ) as RegisteredTool,
    },
    {
      name: "refresh_source",
      reg: () =>
        server.registerTool(
          refreshSourceTool.name,
          {
            description: refreshSourceTool.description,
            inputSchema: refreshSourceTool.inputSchema.shape,
          },
          async (args: unknown) => {
            try {
              const validated = refreshSourceTool.inputSchema.parse(
                args,
              ) as RefreshSourceInput;
              const result = await refreshSourceTool.handler(
                validated,
                opts.sourceRegistry,
              );
              return ok(result);
            } catch (err) {
              return errorResponse(err instanceof Error ? err.message : String(err));
            }
          },
        ) as RegisteredTool,
    },
    {
      name: "unset_mcp_client",
      reg: () =>
        server.registerTool(
          unsetMcpClientTool.name,
          {
            description: unsetMcpClientTool.description,
            inputSchema: unsetMcpClientTool.inputSchema.shape,
          },
          async (args: unknown) => {
            try {
              const validated = unsetMcpClientTool.inputSchema.parse(
                args,
              ) as UnsetMcpClientInput;
              const result = await unsetMcpClientTool.handler(
                validated,
                opts.sourceRegistry,
              );
              return ok(result);
            } catch (err) {
              return errorResponse(err instanceof Error ? err.message : String(err));
            }
          },
        ) as RegisteredTool,
    },
  ];

  for (const { name, reg } of adds) {
    if (registered.has(name)) continue;
    registered.set(name, reg());
    mutated = true;
  }

  if (mutated) server.sendToolListChanged();
}
