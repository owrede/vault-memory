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

/** A live peer-MCP client managed by the registry. */
export interface PeerMcpClient {
  /** Forward a `tools/call` to the peer, peeling the MCP envelope. */
  callTool(name: string, args: unknown): Promise<unknown>;
  /** False when the boot-time connect failed; calling `callTool` throws. */
  available: boolean;
  /** Kills the underlying child process. Idempotent (transport.close is). */
  [Symbol.dispose](): void;
}

/**
 * Optional injection point for tests. Production code uses
 * `defaultConnect` which spawns a real child via `StdioClientTransport`.
 */
export type ClientFactory = (
  cfg: PeerMcpClientConfig,
) => Promise<{ client: Pick<Client, "callTool">; transport: { close(): void } }>;

export class PeerMcpRegistry {
  private clients = new Map<string, PeerMcpClient>();
  private readonly clientFactory: ClientFactory | undefined;

  constructor(clientFactory?: ClientFactory) {
    this.clientFactory = clientFactory;
  }

  get size(): number {
    return this.clients.size;
  }

  /**
   * Boot every `[contracts.mcp_clients.<name>]` entry. Failures are
   * non-fatal: the name is recorded as unavailable and a WARN line is
   * written to stderr. Returns when all attempts have settled.
   */
  async start(configs: Record<string, PeerMcpClientConfig>): Promise<void> {
    for (const [name, cfg] of Object.entries(configs)) {
      try {
        const { client, transport } = this.clientFactory
          ? await this.clientFactory(cfg)
          : await this.defaultConnect(cfg);
        this.clients.set(name, wrapAvailable(client, transport));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[contracts] peer-MCP client '${name}' failed to start: ${msg}\n`);
        this.clients.set(name, wrapUnavailable());
      }
    }
  }

  get(name: string): PeerMcpClient | undefined {
    return this.clients.get(name);
  }

  /** Dispose every client and clear the internal map. Idempotent. */
  async shutdown(): Promise<void> {
    for (const c of this.clients.values()) {
      try {
        c[Symbol.dispose]();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[contracts] peer-MCP dispose error: ${msg}\n`);
      }
    }
    this.clients.clear();
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
  client: Pick<Client, "callTool">,
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
    [Symbol.dispose](): void {
      /* no-op */
    },
  };
}
