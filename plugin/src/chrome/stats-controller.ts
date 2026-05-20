/**
 * StatsController — pure-logic state machine for the Stats chrome panel.
 *
 * Phase 7 / 07-09 / PLG-04 / D-CHROME-STATS.
 *
 * Wraps `mcpClient.callTool("get_runtime_stats", {vault?})` so the
 * Svelte view (`stats-panel.svelte`) stays a thin renderer. The
 * controller exposes:
 *   - state.{loading, stats, error}
 *   - refresh() — re-fetch on demand (called once on mount + on every
 *     click of the Refresh button)
 *
 * The error path is non-throwing: failures are caught, the message is
 * recorded on `state.error`, and `state.stats` is cleared. The view
 * renders an inline error banner — the panel never crashes.
 *
 * All reads go through MCP. There is NO `this.app.metadataCache` access
 * and NO direct DB access — this is the safety invariant for plugin
 * chrome panels (PLG-04 acceptance criterion).
 */

export interface PeerMcpStatus {
  name: string;
  available: boolean;
}

export interface RuntimeStats {
  vault: string;
  notes: number;
  chunks: number;
  last_index_at: number | null;
  embedding_model: string;
  embedding_dim: number;
  audit_log_by_kind: Record<string, number>;
  peer_mcp_status: ReadonlyArray<PeerMcpStatus>;
  contract_count: number;
}

export interface StatsState {
  loading: boolean;
  stats: RuntimeStats | null;
  error: string | null;
}

export interface StatsControllerDeps {
  mcpClient: {
    callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  };
  activeVault: string | null;
}

export interface StatsController {
  getState(): StatsState;
  refresh(): Promise<void>;
  subscribe(handler: (s: StatsState) => void): () => void;
}

export function createStatsController(deps: StatsControllerDeps): StatsController {
  let state: StatsState = { loading: false, stats: null, error: null };
  const listeners = new Set<(s: StatsState) => void>();

  function commit(next: Partial<StatsState>): void {
    state = { ...state, ...next };
    for (const l of listeners) l(state);
  }

  return {
    getState() {
      return state;
    },
    async refresh() {
      commit({ loading: true, error: null });
      const args: Record<string, unknown> = {};
      if (deps.activeVault !== null) args["vault"] = deps.activeVault;
      try {
        const result = (await deps.mcpClient.callTool(
          "get_runtime_stats",
          args,
        )) as RuntimeStats;
        commit({ loading: false, stats: result, error: null });
      } catch (err) {
        let message = err instanceof Error ? err.message : String(err);
        // Friendlier surface when the server doesn't expose the plugin
        // tool family (configurable [plugin] enabled = false). The JSON-RPC
        // error code -32601 (Method not found) or the SDK's "Tool not found"
        // text both indicate the same misconfiguration.
        if (/method not found|tool not found|-32601/i.test(message)) {
          message =
            "Plugin tools are not exposed by the server. Add `[plugin] enabled = true` " +
            "to ~/.vault-memory/config.toml, then restart Obsidian (or re-run /vmem:install).";
        }
        commit({ loading: false, stats: null, error: message });
      }
    },
    subscribe(handler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
  };
}
