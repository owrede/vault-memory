/**
 * ConnectorsController — headless logic for the Connectors chrome panel.
 *
 * Phase 7 / 07-10 / PLG-05 / D-CHROME-CONNECTORS.
 *
 * The Svelte view (`connectors-panel.svelte`) is a thin presentation
 * layer. All state mutation, MCP calls, and `${secret:name}` resolution
 * routing happen here so the panel is unit-testable without a DOM (same
 * Pattern F as ReindexController + StatsController + SecretsPanelController).
 *
 * # CRUD path (all via the server-owned `set_mcp_client` tool)
 *
 *   - list:   `mcpClient.callTool("set_mcp_client", {list: true})`
 *     → `{ok:true, clients: [{name, command, args, env_secrets, status?}]}`
 *   - add:    `mcpClient.callTool("set_mcp_client", {name, command, args, env_secrets})`
 *   - remove: `mcpClient.callTool("set_mcp_client", {name, remove: true})`
 *   - test:   `mcpClient.callTool("set_mcp_client", {name, test: true})`
 *
 * The plugin NEVER reads or writes `~/.vault-memory/config.toml`
 * directly (CONTEXT D-CHROME-CONNECTORS: server owns the file).
 *
 * # ${secret:name} resolution (no plaintext-fallback path)
 *
 * On add, the controller routes each value through
 * `resolveConnectorSecrets(...)` to register plaintext server-side via
 * `resolve_secret` BEFORE issuing the `set_mcp_client` write. On
 * `safe_storage_unavailable` / `secret_not_found`, the controller
 * surfaces a typed error that the panel renders as a re-enter prompt
 * (CONTEXT D-CHROME-SECRETS).
 */

import {
  resolveConnectorSecrets,
  SecretResolveError,
  type ConnectorResolverDeps,
} from "../services/connector-resolver.js";

/** Inventory entry returned by `set_mcp_client({list: true})` (07-04). */
export interface ConnectorEntry {
  name: string;
  command: string;
  args: readonly string[];
  /** Key-list of env_secrets; values stay in plugin storage (07-04 §SECURITY). */
  env_secrets: readonly string[];
  status?: "connected" | "disconnected" | "untested";
}

/** Test-connection result rendered as a green/red badge per row. */
export interface TestResult {
  /** Last-tested ISO timestamp; absence means "untested in this session". */
  at?: string;
  ok: boolean;
  /** When ok=false, the server's error message; otherwise unset. */
  error?: string;
}

export interface ConnectorsState {
  loading: boolean;
  entries: readonly ConnectorEntry[];
  /** Per-name test results from the most recent "Test" button click. */
  testResults: Readonly<Record<string, TestResult>>;
  /** Top-level error (e.g. list call failed); inline form errors live on `formError`. */
  loadError: string | null;
  /** Inline form error from add / remove / secret-resolution failures. */
  formError: string | null;
  /** When a `secret_not_found` or `safe_storage_unavailable` triggers a re-enter prompt. */
  reEnterPrompt: { secretName: string; reason: "secret_not_found" | "safe_storage_unavailable" } | null;
}

export interface AddConnectorInput {
  name: string;
  command: string;
  args: string[];
  /** key → value-with-${secret:name}-placeholders. The controller resolves before calling set_mcp_client. */
  envSecrets: Record<string, string>;
}

export interface ConnectorsControllerDeps {
  mcpClient: {
    callTool: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<unknown>;
  };
  /** Used only for ${secret:name} resolution; never displayed in the UI. */
  secretsStore: ConnectorResolverDeps["secretsStore"];
  safeStorage: ConnectorResolverDeps["safeStorage"];
}

export interface ConnectorsController {
  getState(): ConnectorsState;
  /** Fetch the connector inventory via `set_mcp_client({list: true})`. */
  refresh(): Promise<void>;
  /** Resolve secrets + call set_mcp_client (variant A). Refreshes on success. */
  addConnector(input: AddConnectorInput): Promise<void>;
  /** Call set_mcp_client (variant B). Refreshes on success. */
  removeConnector(name: string): Promise<void>;
  /** Call the test path; record green/red badge per name. */
  testConnector(name: string): Promise<void>;
  /** Dismiss the inline re-enter prompt after the user navigates to Settings → Secrets. */
  dismissReEnterPrompt(): void;
  /** Subscribe to state changes. Returns unsubscribe. */
  subscribe(handler: (s: ConnectorsState) => void): () => void;
}

/** Response shape from `set_mcp_client` list variant. */
interface ListResponse {
  ok?: boolean;
  clients?: ConnectorEntry[];
}

export function createConnectorsController(
  deps: ConnectorsControllerDeps,
): ConnectorsController {
  let state: ConnectorsState = {
    loading: false,
    entries: [],
    testResults: {},
    loadError: null,
    formError: null,
    reEnterPrompt: null,
  };
  const listeners = new Set<(s: ConnectorsState) => void>();

  function commit(next: Partial<ConnectorsState>): void {
    state = { ...state, ...next };
    for (const l of listeners) l(state);
  }

  async function refresh(): Promise<void> {
    commit({ loading: true, loadError: null });
    try {
      const resp = (await deps.mcpClient.callTool("set_mcp_client", {
        list: true,
      })) as ListResponse | undefined;
      const entries = resp && Array.isArray(resp.clients) ? resp.clients : [];
      commit({ entries, loading: false });
    } catch (err) {
      let message = err instanceof Error ? err.message : String(err);
      if (/method not found|tool not found|-32601/i.test(message)) {
        message =
          "Plugin tools are not exposed by the server. Add `[plugin] enabled = true` " +
          "to ~/.vault-memory/config.toml, then restart Obsidian (or re-run /vmem:install).";
      }
      commit({ loading: false, loadError: message });
    }
  }

  async function addConnector(input: AddConnectorInput): Promise<void> {
    commit({ formError: null, reEnterPrompt: null });
    // Resolve ${secret:name} references before writing the connector
    // entry. The resolver decrypts ciphertext via safeStorage in the
    // plugin process and registers plaintext server-side via the
    // resolve_secret tool. The resolved map is NEVER stored or
    // displayed — we pass it directly to set_mcp_client.
    let resolvedEnv: Record<string, string>;
    try {
      resolvedEnv = await resolveConnectorSecrets(input.envSecrets, {
        secretsStore: deps.secretsStore,
        safeStorage: deps.safeStorage,
        mcpClient: deps.mcpClient,
      });
    } catch (err) {
      if (err instanceof SecretResolveError) {
        if (
          err.reason === "secret_not_found" ||
          err.reason === "safe_storage_unavailable"
        ) {
          commit({
            reEnterPrompt: {
              secretName: err.secretName,
              reason: err.reason,
            },
            formError: err.message,
          });
          return;
        }
        commit({ formError: err.message });
        return;
      }
      commit({
        formError: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    try {
      await deps.mcpClient.callTool("set_mcp_client", {
        name: input.name,
        command: input.command,
        args: input.args,
        env_secrets: resolvedEnv,
      });
      await refresh();
    } catch (err) {
      commit({
        formError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function removeConnector(name: string): Promise<void> {
    commit({ formError: null });
    try {
      await deps.mcpClient.callTool("set_mcp_client", {
        name,
        remove: true,
      });
      await refresh();
    } catch (err) {
      commit({
        formError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function testConnector(name: string): Promise<void> {
    try {
      const resp = (await deps.mcpClient.callTool("set_mcp_client", {
        name,
        test: true,
      })) as { ok?: boolean; error?: string } | undefined;
      const at = new Date().toISOString();
      const ok = resp?.ok === true;
      const next: TestResult = ok
        ? { ok: true, at }
        : { ok: false, at, error: resp?.error ?? "unknown error" };
      commit({
        testResults: { ...state.testResults, [name]: next },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      commit({
        testResults: {
          ...state.testResults,
          [name]: {
            ok: false,
            at: new Date().toISOString(),
            error: message,
          },
        },
      });
    }
  }

  function dismissReEnterPrompt(): void {
    commit({ reEnterPrompt: null });
  }

  return {
    getState() {
      return state;
    },
    refresh,
    addConnector,
    removeConnector,
    testConnector,
    dismissReEnterPrompt,
    subscribe(handler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
  };
}
