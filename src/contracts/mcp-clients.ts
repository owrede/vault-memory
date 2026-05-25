/**
 * PeerMcpRegistry — Phase 6 / D-A2a peer-MCP / RESEARCH §Pattern 3 /
 * Pitfall F4.
 *
 * Lifecycle:
 *
 *   - At server boot: `new PeerMcpRegistry(); await reg.start(configs);`
 *     Each `[contracts.mcp_clients.<name>]` entry is spawned via
 *     `StdioClientTransport(...)` and an MCP SDK `Client` is connected
 *     over stdio. Connect failures DO NOT block boot — the registry
 *     records the failed name as unavailable and writes a WARN line to
 *     stderr (CONTEXT.md "Claude's Discretion": peer-MCP unreachable is
 *     not a server-fatal condition).
 *
 *   - At runtime: `verbDispatcher` consults the registry on every
 *     `mcp://<server>/<tool>` verb. The peer-MCP call is wrapped in
 *     `Promise.race([call, timeout(step_timeout_seconds * 1000)])` at
 *     `verbs/mcp-extension.ts` (Q-TIMEOUT — peer-MCP only).
 *
 *   - At shutdown: `process.on('SIGTERM' | 'SIGINT')` handlers in
 *     `src/server.ts` call `reg.shutdown()`, which iterates every
 *     PeerMcpClient and invokes `[Symbol.dispose]()` →
 *     `transport.close()` → child process killed. Mitigates Pitfall F4
 *     (orphaned child processes after parent crash).
 *
 * # Envelope peeling
 *
 * MCP `tools/call` returns `{content: [{type:'text', text: '...'}]}`.
 * The wrapper peels one layer: when the first content block is a
 * `text` and the text parses as JSON, return the parsed object; when
 * the text is not JSON, return the raw string; otherwise return the
 * full envelope. Callers see ergonomic data, not raw protocol shapes.
 *
 * # Testability
 *
 * `ClientFactory` is an optional constructor parameter — tests inject
 * a stub factory that returns a mock Client without spawning a real
 * child process. Plan 06-04's CON-09 smoketest exercises the real
 * `defaultConnect` path end-to-end.
 *
 * # Adapter-seam discipline
 *
 * Imports only `@modelcontextprotocol/sdk/client/*`. The
 * `StdioClientTransport` spawns a child via the SDK's own
 * `child_process.spawn` — encapsulated, not leaked into `src/contracts/`.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/** Single `[contracts.mcp_clients.<name>]` config entry. */
export interface PeerMcpClientConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * One tool a peer exposes, as returned by MCP `tools/list`. Mirrors the
 * subset of the SDK's `ListToolsResult.tools[]` that the Sources
 * registry surfaces (SOURCES-REGISTRY.md §5.2). `inputSchema` is opaque
 * here — the inspector consumes it to type step args.
 */
export interface PeerMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Connection state for a source (SOURCES-REGISTRY.md §5.1):
 *   - "connected"   — connect succeeded AND tools/list succeeded ≥ once.
 *   - "unavailable" — the (re)connect attempt failed.
 *   - "unreachable" — connected at some point but a later tools/list failed.
 */
export type PeerMcpStatus = "connected" | "unavailable" | "unreachable";

/** Read-only projection of a source's cached state for resource handlers. */
export interface PeerMcpClientInfo {
  status: PeerMcpStatus;
  tools: readonly PeerMcpTool[];
  /** Epoch-seconds of the last successful tools/list; null if never. */
  lastRefreshed: number | null;
  /** Captured error message when status is "unavailable"/"unreachable". */
  error?: string;
}

/** A live peer-MCP client managed by the registry. */
export interface PeerMcpClient {
  /** Forward a `tools/call` to the peer, peeling the MCP envelope. */
  callTool(name: string, args: unknown): Promise<unknown>;
  /** Fetch the peer's tools/list. Throws when the client is unavailable. */
  listTools(): Promise<PeerMcpTool[]>;
  /** False when the boot-time connect failed; calling `callTool` throws. */
  available: boolean;
  /** Kills the underlying child process. Idempotent (transport.close is). */
  [Symbol.dispose](): void;
}

/** Minimal client surface the registry depends on (subset of SDK `Client`). */
export interface PeerClientLike {
  callTool: Client["callTool"];
  /** Present on the real SDK Client; optional so older stubs still satisfy the type. */
  listTools?: Client["listTools"];
}

/**
 * Optional injection point for tests. Production code uses
 * `defaultConnect` which spawns a real child via `StdioClientTransport`.
 */
export type ClientFactory = (
  cfg: PeerMcpClientConfig,
) => Promise<{ client: PeerClientLike; transport: { close(): void } }>;

/** Internal per-source record: the wrapped client + its cached metadata. */
interface RegistryEntry {
  client: PeerMcpClient;
  status: PeerMcpStatus;
  tools: PeerMcpTool[];
  lastRefreshed: number | null;
  error?: string;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export class PeerMcpRegistry {
  private entries = new Map<string, RegistryEntry>();
  private readonly clientFactory: ClientFactory | undefined;

  constructor(clientFactory?: ClientFactory) {
    this.clientFactory = clientFactory;
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Boot every `[contracts.mcp_clients.<name>]` entry. Failures are
   * non-fatal: the name is recorded as unavailable and a WARN line is
   * written to stderr. Returns when all attempts have settled.
   *
   * On a successful connect we prime the tools cache via tools/list. A
   * tools/list failure does NOT mark the source unavailable — the
   * connection is live and callTool may still work — but the status
   * becomes "unreachable" so the UI can prompt a retry.
   */
  async start(configs: Record<string, PeerMcpClientConfig>): Promise<void> {
    for (const [name, cfg] of Object.entries(configs)) {
      await this.connectAndStore(name, cfg);
    }
  }

  get(name: string): PeerMcpClient | undefined {
    return this.entries.get(name)?.client;
  }

  /** All registered source names, in insertion order. */
  names(): string[] {
    return Array.from(this.entries.keys());
  }

  /** Cached metadata projection for one source; undefined if unknown. */
  getInfo(name: string): PeerMcpClientInfo | undefined {
    const e = this.entries.get(name);
    if (e === undefined) return undefined;
    return {
      status: e.status,
      tools: e.tools,
      lastRefreshed: e.lastRefreshed,
      ...(e.error !== undefined ? { error: e.error } : {}),
    };
  }

  /**
   * Register a new source at runtime: spawn + connect, then prime the
   * tools cache. Replaces any existing entry of the same name (the old
   * client is disposed first). Returns the resulting info projection.
   */
  async add(name: string, cfg: PeerMcpClientConfig): Promise<PeerMcpClientInfo> {
    const existing = this.entries.get(name);
    if (existing !== undefined) {
      try {
        existing.client[Symbol.dispose]();
      } catch {
        // Best-effort — replacing the entry regardless.
      }
    }
    await this.connectAndStore(name, cfg);
    // connectAndStore always sets an entry, so getInfo is non-undefined.
    return this.getInfo(name)!;
  }

  /**
   * Dispose a source and drop it from the registry. Idempotent —
   * removing an unknown name is a no-op that returns false.
   */
  remove(name: string): boolean {
    const e = this.entries.get(name);
    if (e === undefined) return false;
    try {
      e.client[Symbol.dispose]();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[contracts] peer-MCP dispose error: ${msg}\n`);
    }
    this.entries.delete(name);
    return true;
  }

  /**
   * Re-issue tools/list against the live client and refresh the cache.
   * Returns the updated info, or undefined if the name is unknown.
   *
   * If the client is currently unavailable this only updates the error;
   * re-spawning a failed source requires `add(name, cfg)` with the
   * config (the registry does not retain configs).
   */
  async refresh(name: string): Promise<PeerMcpClientInfo | undefined> {
    const e = this.entries.get(name);
    if (e === undefined) return undefined;
    if (!e.client.available) {
      e.status = "unavailable";
      return this.getInfo(name);
    }
    await this.primeTools(e);
    return this.getInfo(name);
  }

  /** Dispose every client and clear the internal map. Idempotent. */
  async shutdown(): Promise<void> {
    for (const e of this.entries.values()) {
      try {
        e.client[Symbol.dispose]();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[contracts] peer-MCP dispose error: ${msg}\n`);
      }
    }
    this.entries.clear();
  }

  // ─── internals ─────────────────────────────────────────────────────────

  /** Connect (factory or default), store the entry, prime tools cache. */
  private async connectAndStore(
    name: string,
    cfg: PeerMcpClientConfig,
  ): Promise<void> {
    try {
      const { client, transport } = this.clientFactory
        ? await this.clientFactory(cfg)
        : await this.defaultConnect(cfg);
      const entry: RegistryEntry = {
        client: wrapAvailable(client, transport),
        status: "connected",
        tools: [],
        lastRefreshed: null,
      };
      this.entries.set(name, entry);
      await this.primeTools(entry);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[contracts] peer-MCP client '${name}' failed to start: ${msg}\n`,
      );
      this.entries.set(name, {
        client: wrapUnavailable(),
        status: "unavailable",
        tools: [],
        lastRefreshed: null,
        error: msg,
      });
    }
  }

  /**
   * Call tools/list and update the entry's cache + status. A failure
   * keeps the connection (status → "unreachable") rather than tearing it
   * down — the source is reachable for callTool even if discovery failed.
   */
  private async primeTools(entry: RegistryEntry): Promise<void> {
    try {
      const tools = await entry.client.listTools();
      entry.tools = tools;
      entry.lastRefreshed = nowSeconds();
      entry.status = "connected";
      delete entry.error;
    } catch (err) {
      entry.status = "unreachable";
      entry.error = err instanceof Error ? err.message : String(err);
    }
  }

  private async defaultConnect(
    cfg: PeerMcpClientConfig,
  ): Promise<{ client: Client; transport: StdioClientTransport }> {
    const transport = new StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: cfg.env,
    });
    const client = new Client({ name: "vault-memory-peer", version: "2.0.0" });
    await client.connect(transport);
    return { client, transport };
  }
}

function wrapAvailable(
  client: PeerClientLike,
  transport: { close(): void },
): PeerMcpClient {
  return {
    available: true,
    async callTool(name: string, args: unknown): Promise<unknown> {
      const res = await client.callTool({
        name,
        arguments: args as Record<string, unknown>,
      });
      // Peel MCP envelope: result.content[0] is typically
      // {type:'text', text: '...'}. Return parsed JSON when applicable.
      const content = (res as { content?: unknown }).content;
      if (Array.isArray(content) && content.length > 0) {
        const first = content[0] as { type?: string; text?: string };
        if (first.type === "text" && typeof first.text === "string") {
          try {
            return JSON.parse(first.text);
          } catch {
            return first.text;
          }
        }
      }
      return res;
    },
    async listTools(): Promise<PeerMcpTool[]> {
      // A peer without listTools support (older stub or a server that
      // doesn't advertise the tools capability) yields an empty set
      // rather than throwing — an empty palette is fine; a crash is not.
      if (typeof client.listTools !== "function") return [];
      const res = await client.listTools();
      const tools = (res as { tools?: unknown }).tools;
      if (!Array.isArray(tools)) return [];
      const out: PeerMcpTool[] = [];
      for (const t of tools) {
        if (!t || typeof t !== "object") continue;
        const name = (t as { name?: unknown }).name;
        if (typeof name !== "string") continue;
        const tool: PeerMcpTool = { name };
        const description = (t as { description?: unknown }).description;
        if (typeof description === "string") tool.description = description;
        const inputSchema = (t as { inputSchema?: unknown }).inputSchema;
        if (inputSchema && typeof inputSchema === "object") {
          tool.inputSchema = inputSchema as Record<string, unknown>;
        }
        out.push(tool);
      }
      return out;
    },
    [Symbol.dispose](): void {
      transport.close();
    },
  };
}

function wrapUnavailable(): PeerMcpClient {
  return {
    available: false,
    async callTool(): Promise<unknown> {
      throw new Error("peer-MCP client unavailable");
    },
    async listTools(): Promise<PeerMcpTool[]> {
      throw new Error("peer-MCP client unavailable");
    },
    [Symbol.dispose](): void {
      /* no-op */
    },
  };
}
