/**
 * VaultMemoryMcpClient — Obsidian plugin → vault-memory server over stdio.
 *
 * Phase 7 / 07-03 / ADR-007 / D-MCP-SURFACE.
 * Analog: src/contracts/mcp-clients.ts (server-side peer-MCP client; same
 * SDK pattern at the opposite end of stdio).
 *
 * # Lifecycle
 *
 *   - On plugin onload(): construct the client from settings
 *     (command + args + env), then `await connect()` inside a try/catch.
 *     `CliNotFoundError` (code === "ENOENT") is the discoverable failure
 *     mode when `vault-memory` is not on PATH — the plugin catches it,
 *     surfaces a `Notice` banner, and continues loading so the user can
 *     still edit `.contract` files offline.
 *
 *   - At runtime: chrome plans (07-08..07-10) and the editor view call
 *     `callTool(name, args)`. Long-running tools (e.g. trigger_reindex)
 *     emit MCP progress notifications; `onProgress(token, handler)`
 *     subscribes to one specific token. The watcher plan (07-07) uses
 *     `onNotification("vault-memory://contracts/reloaded", …)`.
 *
 *   - On plugin onunload(): `await disconnect()` closes the SDK Client +
 *     stdio transport, which kills the child process.
 *
 * # Envelope peeling
 *
 * MCP `tools/call` returns `{content: [{type: "text", text: "<json>"}]}`.
 * `callTool` parses the JSON text into a JS value and returns it. A
 * malformed envelope (no content[], wrong type, non-JSON text) throws
 * a clear error rather than silently returning `undefined`.
 *
 * # Testability
 *
 * `ClientFactory` is an injectable constructor parameter — tests provide
 * a stub factory that returns a mock Client without spawning a real
 * child process. Production uses `defaultClientFactory` which spawns the
 * configured `command` via `StdioClientTransport`.
 *
 * # Pitfall 6 (RESEARCH §"Pitfalls"): plugin spawning competes with a
 * pre-running server. The v2.0.0 strategy (a) is to always spawn a
 * fresh server from the plugin so the plugin owns the server lifecycle.
 * Future versions may add a "connect to running server" mode; that is
 * out of scope here.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ProgressNotificationSchema,
  ResourceUpdatedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";

export interface VaultMemoryMcpClientConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Thrown when the underlying child-process spawn fails with ENOENT
 * (i.e. `vault-memory` is not on PATH and the configured
 * `serverCommand` does not resolve to an executable). Distinct error
 * type so the plugin's `onload` can pattern-match in its catch block
 * and surface the missing-CLI banner.
 */
export class CliNotFoundError extends Error {
  override readonly name = "CliNotFoundError";
  readonly code = "ENOENT" as const;
  constructor(message: string) {
    super(message);
  }
}

/** Minimal Client surface the wrapper depends on (subset of SDK `Client`). */
export interface McpClientLike {
  callTool(req: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<unknown>;
  readResource?(req: { uri: string }): Promise<{
    contents: Array<{ text?: string; mimeType?: string; uri?: string }>;
  }>;
  setNotificationHandler(
    schema: unknown,
    handler: (notif: { method: string; params: unknown }) => void | Promise<void>,
  ): void;
  close?(): Promise<void>;
}

export interface McpTransportLike {
  close(): void | Promise<void>;
}

/**
 * Injectable factory. Production uses `defaultClientFactory`; tests
 * supply a stub that returns a mock Client without spawning a child.
 */
export type ClientFactory = (
  cfg: VaultMemoryMcpClientConfig,
) => Promise<{ client: McpClientLike; transport: McpTransportLike }>;

/** Production factory: spawns `vault-memory serve` over stdio. */
export const defaultClientFactory: ClientFactory = async (cfg) => {
  const transport = new StdioClientTransport({
    command: cfg.command,
    args: cfg.args,
    env: cfg.env,
  });
  const client = new Client(
    { name: "vault-memory-plugin", version: "2.0.0" },
    { capabilities: {} },
  );
  try {
    await client.connect(transport);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      throw new CliNotFoundError(
        `vault-memory CLI not found on PATH (tried '${cfg.command}'). ` +
          `Install via the /vmem:install skill, or set the Server Command setting ` +
          `to the absolute path of the vault-memory binary.`,
      );
    }
    throw err;
  }
  return {
    client: client as unknown as McpClientLike,
    transport: transport as unknown as McpTransportLike,
  };
};

type ProgressHandler = (progress: number, total: number | undefined) => void;

interface ProgressSub {
  token: string;
  handler: ProgressHandler;
}

interface GenericSub {
  method: string;
  handler: (params: unknown) => void;
}

export class VaultMemoryMcpClient {
  private readonly cfg: VaultMemoryMcpClientConfig;
  private readonly factory: ClientFactory;
  private client: McpClientLike | null = null;
  private transport: McpTransportLike | null = null;
  private progressSubs: ProgressSub[] = [];
  private genericSubs: GenericSub[] = [];
  private _available = false;

  constructor(cfg: VaultMemoryMcpClientConfig, factory: ClientFactory = defaultClientFactory) {
    this.cfg = cfg;
    this.factory = factory;
  }

  get available(): boolean {
    return this._available;
  }

  /**
   * Spawn the child process + connect the MCP Client. Throws
   * `CliNotFoundError` when the spawn fails with ENOENT; other errors
   * propagate unchanged. Safe to call only when not already connected
   * (the caller is responsible for lifecycle ordering).
   */
  async connect(): Promise<void> {
    try {
      const { client, transport } = await this.factory(this.cfg);
      this.client = client;
      this.transport = transport;
      this._available = true;

      // Wire one progress-notification handler that fans out to per-token
      // subscriptions. SDK 1.x uses the Zod schema as the dispatch key.
      client.setNotificationHandler(ProgressNotificationSchema, (notif) => {
        const params = (notif as { params?: Record<string, unknown> }).params ?? {};
        const token = params["progressToken"];
        const progress = params["progress"];
        const total = params["total"];
        if (typeof token !== "string" && typeof token !== "number") return;
        if (typeof progress !== "number") return;
        const tokenStr = String(token);
        const totalNum = typeof total === "number" ? total : undefined;
        for (const sub of this.progressSubs) {
          if (sub.token === tokenStr) {
            sub.handler(progress, totalNum);
          }
        }
      });

      // Phase 7 / Plan 07-07 / CAN-08 — wire `notifications/resources/updated`
      // so generic subscribers (e.g. ReloadNotifier subscribing to
      // `vault-memory://contracts/reloaded`) actually receive events.
      // The SDK dispatches by method literal in the Zod schema, so we
      // register one handler that fans out to every generic sub whose
      // method matches the resource-updated notification method.
      client.setNotificationHandler(
        ResourceUpdatedNotificationSchema,
        (notif) => {
          const params = (notif as { params?: Record<string, unknown> }).params ?? {};
          for (const sub of this.genericSubs) {
            if (sub.method === "notifications/resources/updated") {
              sub.handler(params);
            }
          }
        },
      );
    } catch (err) {
      // Promote ENOENT from the factory to CliNotFoundError if the
      // factory didn't already wrap it (test factories often throw raw
      // ErrnoExceptions; the production factory already wraps).
      if (err instanceof CliNotFoundError) {
        throw err;
      }
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT") {
        throw new CliNotFoundError(
          `vault-memory CLI not found on PATH (tried '${this.cfg.command}'). ` +
            `Install via the /vmem:install skill, or set the Server Command setting ` +
            `to the absolute path of the vault-memory binary.`,
        );
      }
      throw err;
    }
  }

  /**
   * Dispatch an MCP `tools/call` and return the parsed value.
   * Throws when the wrapper has not been connected and when the
   * envelope does not match the expected
   * `{content: [{type: "text", text: <json>}]}` shape.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client || !this._available) {
      throw new Error("VaultMemoryMcpClient not connected — call connect() first");
    }
    const res = await this.client.callTool({ name, arguments: args });
    return peelEnvelope(res);
  }

  /**
   * Read an MCP Resource by URI. Returns the raw envelope so callers can
   * inspect `contents[].text` and `mimeType`. Throws when not connected.
   *
   * Used by the contract editor's palette (Plan 07-05) to fetch
   * `vault-memory://contract-verbs` for the dynamic peer-MCP section.
   */
  async readResource(uri: string): Promise<{
    contents: Array<{ text?: string; mimeType?: string; uri?: string }>;
  }> {
    if (!this.client || !this._available) {
      throw new Error("VaultMemoryMcpClient not connected — call connect() first");
    }
    if (!this.client.readResource) {
      throw new Error("Underlying MCP client does not support readResource");
    }
    return this.client.readResource({ uri });
  }

  /**
   * Subscribe to `notifications/progress` filtered by `progressToken`.
   * Returns an unsubscribe function. Multiple subscriptions per token
   * are allowed and each receives every matching notification.
   */
  onProgress(token: string, handler: ProgressHandler): () => void {
    const sub: ProgressSub = { token, handler };
    this.progressSubs.push(sub);
    return () => {
      this.progressSubs = this.progressSubs.filter((s) => s !== sub);
    };
  }

  /**
   * Subscribe to a generic notification method. The handler receives
   * the raw `params` payload.
   *
   * Supported methods:
   *   - `notifications/resources/updated` — Phase 7 / 07-07 / CAN-08.
   *     Used by `ReloadNotifier` to subscribe to
   *     `vault-memory://contracts/reloaded` (the URI lives inside
   *     `params.uri`, so subscribers receive ALL resource-updated
   *     notifications and filter on `uri` themselves).
   *
   * Returns an unsubscribe function. The `connect()` path registers
   * one underlying `setNotificationHandler` per supported schema; the
   * subscription list here fans those out to multiple consumers.
   */
  onNotification(method: string, handler: (params: unknown) => void): () => void {
    const sub: GenericSub = { method, handler };
    this.genericSubs.push(sub);
    return () => {
      this.genericSubs = this.genericSubs.filter((s) => s !== sub);
    };
  }

  /** Close the MCP client + transport. Idempotent — safe to call repeatedly. */
  async disconnect(): Promise<void> {
    if (!this._available && this.client === null && this.transport === null) {
      return;
    }
    this._available = false;
    const c = this.client;
    const t = this.transport;
    this.client = null;
    this.transport = null;
    if (c?.close) {
      try {
        await c.close();
      } catch {
        // Best-effort close; child-process death is what matters.
      }
    }
    if (t) {
      try {
        await t.close();
      } catch {
        // ditto
      }
    }
    // Clear subscriptions on disconnect — chrome plans re-subscribe on
    // reconnect (out of scope for v2.0.0; documented for future).
    this.progressSubs = [];
    this.genericSubs = [];
  }
}

/**
 * Peel the MCP `tools/call` envelope. The success shape is:
 *
 *   {content: [{type: "text", text: "<json>"}]}
 *
 * — and our server (`src/server.ts` `ok()` helper) always wraps
 * responses this way. Anything else is a clear protocol error.
 */
function peelEnvelope(res: unknown): unknown {
  if (!res || typeof res !== "object") {
    throw new Error(
      `Malformed MCP envelope: response is not an object (got ${typeof res})`,
    );
  }
  const content = (res as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error(
      "Malformed MCP envelope: missing or empty `content` array — " +
        "expected `{content: [{type: 'text', text: <json>}]}`",
    );
  }
  const first = content[0] as { type?: string; text?: string };
  if (first?.type !== "text" || typeof first.text !== "string") {
    throw new Error(
      `Malformed MCP envelope: content[0] is not a text block ` +
        `(got type=${String(first?.type)})`,
    );
  }
  try {
    return JSON.parse(first.text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Malformed MCP envelope: content[0].text is not valid JSON — ${msg}`);
  }
}
