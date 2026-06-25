/**
 * trigger_reindex — Phase 7 / Plan 07-04 / PLG-03, ADR-007 §D-CHROME-REINDEX.
 *
 * Triggers a full or per-vault reindex via the injected `reindexVault`
 * callback (which wraps the existing `indexVault` entry point). When the
 * caller supplies a `progressToken`, the handler emits
 * `notifications/progress` updates via the injected `notifier` so the plugin
 * UI can render progress.
 *
 * Input:  {scope: "this" | "all", vault?: string, progressToken?: string}
 * Output: {ok: true, vaults: string[]} after all triggered vaults finish.
 *
 * # Adapter-seam discipline
 *
 * Imports `zod` only. The `indexVault` call is threaded via dependency
 * injection so this tool is unit-testable without booting a real Ollama
 * client or VaultManager.
 */

import { z } from "zod";

const TriggerReindexArgs = z.object({
  scope: z
    .enum(["this", "all"])
    .describe("'this' reindexes the named vault; 'all' reindexes every registered vault."),
  vault: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Required when scope='this' AND more than one vault is registered; " +
        "defaults to the single registered vault otherwise.",
    ),
  progressToken: z
    .string()
    .min(1)
    .optional()
    .describe("MCP SDK 1.29 progressToken — when set, emits notifications/progress."),
});

export type TriggerReindexInput = z.infer<typeof TriggerReindexArgs>;

export interface ReindexVault {
  config: { name: string };
}

export interface TriggerReindexProgress {
  progress: number;
  total?: number;
}

export interface TriggerReindexDeps {
  listVaults: () => ReindexVault[];
  /**
   * Reindex one vault. The `onProgress` callback receives raw counts; the
   * tool layer translates those into MCP notifications/progress when a
   * progressToken is set.
   */
  reindexVault: (
    vaultName: string,
    onProgress?: (p: TriggerReindexProgress) => void,
  ) => Promise<void>;
  /**
   * MCP SDK notification injector. Real callers pass
   * `server.server.notification.bind(server.server)`; tests pass a vi.fn().
   */
  notifier: (notification: {
    method: "notifications/progress";
    params: { progressToken: string; progress: number; total?: number };
  }) => void;
}

export type TriggerReindexResult =
  | { ok: true; vaults: string[] }
  | { ok: false; reason: "unknown_vault"; vault: string }
  | { ok: false; reason: "ambiguous_vault"; available_vaults: string[] };

async function handler(
  args: TriggerReindexInput,
  deps: TriggerReindexDeps,
): Promise<TriggerReindexResult> {
  const allVaults = deps.listVaults().map((v) => v.config.name);

  // Resolve target vaults
  let targets: string[];
  if (args.scope === "all") {
    targets = allVaults;
  } else {
    // scope === "this"
    if (args.vault !== undefined) {
      if (!allVaults.includes(args.vault)) {
        return { ok: false, reason: "unknown_vault", vault: args.vault };
      }
      targets = [args.vault];
    } else if (allVaults.length === 1) {
      targets = [allVaults[0]!];
    } else if (allVaults.length === 0) {
      return { ok: false, reason: "unknown_vault", vault: "(none)" };
    } else {
      return { ok: false, reason: "ambiguous_vault", available_vaults: allVaults };
    }
  }

  // Run reindex per-target. Progress notifications are emitted only when a
  // progressToken was supplied; otherwise onProgress is undefined and the
  // indexer runs silently (matching the existing CLI behavior).
  const token = args.progressToken;
  for (const vname of targets) {
    const onProgress =
      token !== undefined
        ? (p: TriggerReindexProgress) => {
            deps.notifier({
              method: "notifications/progress",
              params:
                token !== undefined && p.total !== undefined
                  ? { progressToken: token, progress: p.progress, total: p.total }
                  : { progressToken: token!, progress: p.progress },
            });
          }
        : undefined;
    await deps.reindexVault(vname, onProgress);
  }

  return { ok: true, vaults: targets };
}

export const triggerReindexTool = {
  name: "trigger_reindex" as const,
  description:
    "Trigger a full vault reindex with optional progress notifications. " +
    "scope='this' reindexes one vault; scope='all' reindexes every registered vault. " +
    "Supply a progressToken to receive notifications/progress updates. " +
    "ADR-007 §D-CHROME-REINDEX.",
  inputSchema: TriggerReindexArgs,
  handler,
};
