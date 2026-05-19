/**
 * VaultMemoryMcpClient unit tests — Phase 7 / 07-03 / D-MCP-SURFACE.
 *
 * Tests inject a stub `ClientFactory` so no real child process is
 * spawned. The factory shape mirrors `src/contracts/mcp-clients.ts`
 * `PeerMcpRegistry.ClientFactory` (07-PATTERNS analog).
 *
 * Covers behaviors a–f from 07-03-PLAN.md Task 2.
 */

import { describe, it, expect, vi } from "vitest";
import {
  VaultMemoryMcpClient,
  CliNotFoundError,
  type ClientFactory,
} from "./mcp-client.js";

interface NotificationHandler {
  schema: unknown;
  handler: (notif: { method: string; params: unknown }) => void;
}

class StubClient {
  callTool = vi.fn();
  close = vi.fn(async () => {});
  notificationHandlers: NotificationHandler[] = [];
  setNotificationHandler = vi.fn(
    (schema: unknown, handler: NotificationHandler["handler"]) => {
      this.notificationHandlers.push({ schema, handler });
    },
  );

  /**
   * Drive a synthetic notification. The real `Client` matches by the
   * Zod schema's `method` literal; in the test we accept any method
   * string and dispatch to every registered handler, then let the
   * handler itself filter (matches our wrapper's behavior — the wrapper
   * registers one ProgressNotificationSchema handler and routes by
   * params.progressToken).
   */
  emit(method: string, params: unknown): void {
    for (const h of this.notificationHandlers) {
      h.handler({ method, params });
    }
  }
}

function makeFactory(stub: StubClient): ClientFactory {
  return async () => ({
    client: stub as unknown as Parameters<ClientFactory>[0] extends never
      ? never
      : Awaited<ReturnType<ClientFactory>>["client"],
    transport: { close: vi.fn() },
  });
}

describe("VaultMemoryMcpClient", () => {
  it("(a) connect then callTool returns parsed JS value (envelope peeled)", async () => {
    const stub = new StubClient();
    stub.callTool.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ ok: true, count: 7 }) }],
    });
    const client = new VaultMemoryMcpClient(
      { command: "vault-memory", args: ["serve"] },
      makeFactory(stub),
    );
    await client.connect();
    const result = await client.callTool("search_hybrid", { query: "x" });
    expect(result).toEqual({ ok: true, count: 7 });
    expect(stub.callTool).toHaveBeenCalledWith({
      name: "search_hybrid",
      arguments: { query: "x" },
    });
  });

  it("(b) malformed envelope rejects with a clear error", async () => {
    const stub = new StubClient();
    // No `content` array at all.
    stub.callTool.mockResolvedValue({ unexpected: "shape" });
    const client = new VaultMemoryMcpClient(
      { command: "vault-memory", args: ["serve"] },
      makeFactory(stub),
    );
    await client.connect();
    await expect(client.callTool("anything", {})).rejects.toThrow(/envelope/i);
  });

  it("(c) disconnect is idempotent", async () => {
    const stub = new StubClient();
    const transport = { close: vi.fn() };
    const factory: ClientFactory = async () => ({
      client: stub as unknown as Awaited<ReturnType<ClientFactory>>["client"],
      transport,
    });
    const client = new VaultMemoryMcpClient(
      { command: "vault-memory", args: ["serve"] },
      factory,
    );
    await client.connect();
    expect(client.available).toBe(true);
    await client.disconnect();
    expect(client.available).toBe(false);
    // Second disconnect must not throw.
    await client.disconnect();
    expect(client.available).toBe(false);
  });

  it("(d) connect propagates CliNotFoundError when factory throws ENOENT", async () => {
    const factory: ClientFactory = async () => {
      const err: NodeJS.ErrnoException = Object.assign(
        new Error("spawn vault-memory ENOENT"),
        { code: "ENOENT" },
      );
      throw err;
    };
    const client = new VaultMemoryMcpClient(
      { command: "vault-memory", args: ["serve"] },
      factory,
    );
    await expect(client.connect()).rejects.toBeInstanceOf(CliNotFoundError);
    expect(client.available).toBe(false);
  });

  it("(e) onProgress filters notifications by token", async () => {
    const stub = new StubClient();
    const client = new VaultMemoryMcpClient(
      { command: "vault-memory", args: ["serve"] },
      makeFactory(stub),
    );
    await client.connect();

    const received: Array<{ p: number; t?: number }> = [];
    const unsub = client.onProgress("token-A", (progress, total) => {
      received.push({ p: progress, t: total });
    });

    // Notification for the wrong token must be dropped.
    stub.emit("notifications/progress", {
      progressToken: "token-B",
      progress: 0.5,
      total: 1,
    });
    // Notification for token-A must be delivered.
    stub.emit("notifications/progress", {
      progressToken: "token-A",
      progress: 0.5,
      total: 1,
    });
    stub.emit("notifications/progress", {
      progressToken: "token-A",
      progress: 1,
      total: 1,
    });

    expect(received).toEqual([
      { p: 0.5, t: 1 },
      { p: 1, t: 1 },
    ]);

    unsub();
    stub.emit("notifications/progress", {
      progressToken: "token-A",
      progress: 0,
      total: 1,
    });
    expect(received).toHaveLength(2);
  });

  it("(f) available toggles correctly across connect/disconnect", async () => {
    const stub = new StubClient();
    const client = new VaultMemoryMcpClient(
      { command: "vault-memory", args: ["serve"] },
      makeFactory(stub),
    );
    expect(client.available).toBe(false);
    await client.connect();
    expect(client.available).toBe(true);
    await client.disconnect();
    expect(client.available).toBe(false);
  });
});

describe("CliNotFoundError", () => {
  it('has code === "ENOENT" and name === "CliNotFoundError"', () => {
    const err = new CliNotFoundError("vault-memory not found on PATH");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CliNotFoundError");
    expect(err.code).toBe("ENOENT");
  });
});
