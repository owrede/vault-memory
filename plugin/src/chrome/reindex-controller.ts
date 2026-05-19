/**
 * ReindexController — pure-logic state machine for the Reindex chrome panel.
 *
 * Phase 7 / 07-09 / PLG-03 / ADR-007 §D-CHROME-REINDEX.
 *
 * The Svelte view (`reindex-panel.svelte`) is a thin wrapper around this
 * controller — all behavior lives here so it can be unit-tested without
 * a DOM. The controller:
 *
 *   1. Mints a fresh `progressToken` per click (MCP SDK 1.x progress
 *      notification routing key, per 07-RESEARCH §"Open Question on
 *      progress streaming").
 *   2. Subscribes to `mcpClient.onProgress(token, handler)` BEFORE
 *      calling `callTool("trigger_reindex", ...)` so no early
 *      notification is lost.
 *   3. Calls `mcpClient.callTool("trigger_reindex", {scope,
 *      progressToken, vault?})`.
 *   4. Routes incoming notifications to `state.{progress, total}`.
 *   5. On resolve: status="complete"; unsubscribe.
 *      On reject:  status="error"; record `error`; unsubscribe.
 *
 * # Adapter-seam discipline
 *
 * The controller depends only on a duck-typed `mcpClient` (callTool +
 * onProgress) and an injectable `newProgressToken` factory — no Obsidian
 * imports, no global crypto reference at module level. Production
 * callers inject `() => crypto.randomUUID()`; tests inject a stub that
 * returns a deterministic token.
 */

export type ReindexStatus = "idle" | "running" | "complete" | "error";

export interface ReindexState {
  status: ReindexStatus;
  busy: boolean;
  progress: number;
  total: number | undefined;
  error: string | null;
  /** True when the "Reindex this vault" button should be enabled. */
  canReindexThis: boolean;
  /** Vaults reported by the most recent successful trigger_reindex result. */
  completedVaults: readonly string[];
}

export interface ReindexControllerDeps {
  mcpClient: {
    callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
    onProgress: (
      token: string,
      handler: (progress: number, total: number | undefined) => void,
    ) => () => void;
  };
  /** Returns a fresh progressToken per call. Production: `crypto.randomUUID`. */
  newProgressToken: () => string;
  /** Active vault name, or null when no vault is selected (single-vault N=0 or N=many ambiguity). */
  activeVault: string | null;
}

export interface ReindexController {
  /** Snapshot of current state. The Svelte view re-derives on each call. */
  getState(): ReindexState;
  /** Trigger reindex of the active vault. Resolves when the tool call settles. */
  reindexThis(): Promise<void>;
  /** Trigger reindex of all registered vaults. */
  reindexAll(): Promise<void>;
  /**
   * Subscribe to state changes. Returns an unsubscribe function. The
   * Svelte view wires this to a `$state`-flavoured re-render trigger.
   */
  subscribe(handler: (s: ReindexState) => void): () => void;
}

export function createReindexController(deps: ReindexControllerDeps): ReindexController {
  let state: ReindexState = {
    status: "idle",
    busy: false,
    progress: 0,
    total: undefined,
    error: null,
    canReindexThis: deps.activeVault !== null,
    completedVaults: [],
  };
  const listeners = new Set<(s: ReindexState) => void>();

  function commit(next: Partial<ReindexState>): void {
    state = { ...state, ...next };
    for (const l of listeners) l(state);
  }

  async function run(scope: "this" | "all"): Promise<void> {
    if (state.busy) return;
    const token = deps.newProgressToken();
    commit({
      status: "running",
      busy: true,
      progress: 0,
      total: undefined,
      error: null,
    });

    // Subscribe BEFORE invoking — early progress notifications must not race.
    const unsubscribe = deps.mcpClient.onProgress(token, (progress, total) => {
      commit({ progress, total });
    });

    const args: Record<string, unknown> = { scope, progressToken: token };
    if (scope === "this" && deps.activeVault !== null) {
      args["vault"] = deps.activeVault;
    }

    try {
      const result = (await deps.mcpClient.callTool("trigger_reindex", args)) as
        | { ok?: boolean; vaults?: string[] }
        | undefined;
      const vaults =
        result && Array.isArray(result.vaults) ? result.vaults.slice() : [];
      commit({ status: "complete", busy: false, completedVaults: vaults });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      commit({ status: "error", busy: false, error: message });
    } finally {
      try {
        unsubscribe();
      } catch {
        // Best-effort cleanup.
      }
    }
  }

  return {
    getState() {
      return state;
    },
    reindexThis() {
      return run("this");
    },
    reindexAll() {
      return run("all");
    },
    subscribe(handler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
  };
}
