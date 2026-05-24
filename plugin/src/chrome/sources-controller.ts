/**
 * SourcesController — headless logic for the Settings-tab Sources section.
 *
 * Spec: .planning/specs/SOURCES-REGISTRY.md (Phase B scaffold).
 *
 * Pattern F: thin Svelte view, controller owns state mutation + MCP calls.
 *
 * # Data sources (Phase B — live)
 *
 *   - Sources inventory:  set_mcp_client {list: true}
 *       Returns: {ok, clients: [{name, command, args, env_secrets, status?}]}
 *   - Per-source tools:   vault-memory://contract-verbs/{vault}
 *       Returns the audit-driven `custom[]` list — only verbs USED in
 *       contracts today appear. The eventual vault-memory://sources/{name}/tools
 *       resource (spec §5.2) will replace this with the full tools/list.
 *
 * # Tool curation
 *
 *   The plugin owns `sourceEnabledTools: Record<sourceName, string[]>` in
 *   data.json (spec §7). Default-on semantics: a source missing from the
 *   map → all tools enabled. An empty array → all tools disabled. A
 *   non-empty array → only those tools enabled.
 *
 *   The controller reads from + writes to `SettingsStore.sourceEnabledTools`
 *   via the small port below (so tests can stub it without an Obsidian
 *   Plugin instance).
 */

/** One source in the inventory. Shape mirrors connectors-controller. */
export interface SourceEntry {
  name: string;
  command: string;
  args: readonly string[];
  status?: "connected" | "disconnected" | "untested";
  /** True if this source originated from config.toml (server tells us). */
  fromConfig?: boolean;
}

/** One tool exposed by a source. From contract-verbs for now; richer once §5.2 lands. */
export interface SourceTool {
  /** Tool name as exposed by the peer (e.g. "list_issues"). */
  name: string;
  /** Full verb form for contract DSL (`mcp://<source>/<name>`). */
  verb: string;
  /** Free-form description (often missing today). */
  description?: string;
  /** Invocation count from audit — useful for ordering. */
  invocationCount?: number;
}

export interface SourcesState {
  loading: boolean;
  sources: readonly SourceEntry[];
  /** Map source name → tools list. Populated lazily on accordion expand. */
  toolsBySource: Readonly<Record<string, readonly SourceTool[]>>;
  /** Map source name → "loading" | "ready" | { error: string }. */
  toolsStatusBySource: Readonly<Record<string, ToolsLoadStatus>>;
  /** Top-level error (list call failed). */
  loadError: string | null;
}

export type ToolsLoadStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; at: number }
  | { kind: "error"; message: string };

export interface EnabledToolsPort {
  /** Read the persisted enabled-tools map. */
  get(): Record<string, readonly string[]>;
  /** Write the enabled-tools map for one source. Pass `null` to clear (= default-on). */
  setForSource(source: string, tools: readonly string[] | null): Promise<void>;
}

export interface SourcesControllerDeps {
  mcpClient: {
    callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
    readResource: (uri: string) => Promise<{
      contents: Array<{ text?: string; mimeType?: string }>;
    }>;
  };
  enabledTools: EnabledToolsPort;
  /** Active vault for the contract-verbs resource URI. */
  vaultName: string;
}

export interface SourcesController {
  getState(): SourcesState;
  refresh(): Promise<void>;
  loadToolsFor(source: string): Promise<void>;
  /** Curation state for one tool: true=enabled, false=disabled. Default-on if no entry. */
  isToolEnabled(source: string, tool: string): boolean;
  /** Toggle enabled state and persist. */
  setToolEnabled(source: string, tool: string, enabled: boolean): Promise<void>;
  subscribe(handler: (s: SourcesState) => void): () => void;
}

interface ListResponse {
  ok?: boolean;
  clients?: SourceEntry[];
}

interface ContractVerbsResource {
  baseline?: readonly string[];
  custom?: Array<{
    verb?: string;
    description?: string;
    invocation_count?: number;
  }>;
}

export function createSourcesController(
  deps: SourcesControllerDeps,
): SourcesController {
  let state: SourcesState = {
    loading: false,
    sources: [],
    toolsBySource: {},
    toolsStatusBySource: {},
    loadError: null,
  };
  const listeners = new Set<(s: SourcesState) => void>();

  function commit(next: Partial<SourcesState>): void {
    state = { ...state, ...next };
    for (const l of listeners) l(state);
  }

  async function refresh(): Promise<void> {
    commit({ loading: true, loadError: null });
    try {
      const resp = (await deps.mcpClient.callTool("set_mcp_client", {
        list: true,
      })) as ListResponse | undefined;
      const sources = resp && Array.isArray(resp.clients) ? resp.clients : [];
      commit({ sources, loading: false });
    } catch (err) {
      let message = err instanceof Error ? err.message : String(err);
      if (/method not found|tool not found|-32601/i.test(message)) {
        message =
          "Plugin tools are not exposed by the server. Add `[plugin] enabled = true` " +
          "to ~/.vault-memory/config.toml, then restart Obsidian.";
      }
      commit({ loading: false, loadError: message });
    }
  }

  async function loadToolsFor(source: string): Promise<void> {
    const current = state.toolsStatusBySource[source];
    if (current?.kind === "loading" || current?.kind === "ready") return;

    commit({
      toolsStatusBySource: {
        ...state.toolsStatusBySource,
        [source]: { kind: "loading" },
      },
    });

    try {
      // Phase B: read from contract-verbs (audit-driven). Phase 6 of the
      // spec rollout swaps this URI for vault-memory://sources/{name}/tools.
      const envelope = await deps.mcpClient.readResource(
        `vault-memory://contract-verbs/${deps.vaultName}`,
      );
      const text = envelope?.contents?.[0]?.text ?? "";
      const parsed = JSON.parse(text) as ContractVerbsResource;
      const custom = Array.isArray(parsed.custom) ? parsed.custom : [];

      const tools: SourceTool[] = [];
      for (const entry of custom) {
        if (!entry?.verb) continue;
        const m = entry.verb.match(/^mcp:\/\/([a-z][a-z0-9_-]*)\/(.+)$/);
        if (!m || m[1] !== source || !m[2]) continue;
        const tool: SourceTool = { name: m[2], verb: entry.verb };
        if (typeof entry.description === "string" && entry.description.length > 0) {
          tool.description = entry.description;
        }
        if (typeof entry.invocation_count === "number") {
          tool.invocationCount = entry.invocation_count;
        }
        tools.push(tool);
      }

      tools.sort((a, b) => {
        const ca = a.invocationCount ?? 0;
        const cb = b.invocationCount ?? 0;
        if (ca !== cb) return cb - ca;
        return a.name.localeCompare(b.name);
      });

      commit({
        toolsBySource: { ...state.toolsBySource, [source]: tools },
        toolsStatusBySource: {
          ...state.toolsStatusBySource,
          [source]: { kind: "ready", at: Date.now() },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      commit({
        toolsStatusBySource: {
          ...state.toolsStatusBySource,
          [source]: { kind: "error", message },
        },
      });
    }
  }

  function isToolEnabled(source: string, tool: string): boolean {
    const map = deps.enabledTools.get();
    const entry = map[source];
    if (entry === undefined) return true; // default-on
    return entry.includes(tool);
  }

  async function setToolEnabled(
    source: string,
    tool: string,
    enabled: boolean,
  ): Promise<void> {
    const map = deps.enabledTools.get();
    const existing = map[source];

    let nextForSource: readonly string[] | null;
    if (existing === undefined) {
      // First curation for this source — materialise the full set from
      // toolsBySource, then drop/keep the toggled tool.
      const all = state.toolsBySource[source] ?? [];
      const allNames = all.map((t) => t.name);
      nextForSource = enabled
        ? allNames
        : allNames.filter((n) => n !== tool);
    } else {
      const set = new Set(existing);
      if (enabled) set.add(tool);
      else set.delete(tool);
      nextForSource = Array.from(set).sort();
    }

    await deps.enabledTools.setForSource(source, nextForSource);
    // Force a re-emit so subscribers re-render with the new isToolEnabled().
    commit({});
  }

  return {
    getState() {
      return state;
    },
    refresh,
    loadToolsFor,
    isToolEnabled,
    setToolEnabled,
    subscribe(handler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
  };
}
