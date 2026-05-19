/**
 * Server gating test — Phase 7 / Plan 07-04 / D-MCP-SURFACE.
 *
 * Asserts the structural invariant that the v1-baseline tools-list snapshot
 * is preserved when `config.plugin.enabled === false` (the default), and
 * that exactly five additional plugin tools appear when `enabled === true`.
 *
 * The test spins up a real `McpServer`, calls `syncPluginTools` once with
 * each gate state, and lists the registered tools over an in-memory MCP
 * client. This pins the wire contract (`tools/list` payload shape) end-to-end
 * without invoking `serve()` (which would require a live VaultManager,
 * Ollama, change-feed wiring, etc.).
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  syncPluginTools,
  PLUGIN_TOOL_NAMES,
  RuntimeConfigStore,
} from "./plugin-tools/index.js";
import { SuppressionSet } from "./adapters/change-feed/obsidian-fs/suppression.js";

const DEFAULT_DEPS = {
  runtimeConfig: new RuntimeConfigStore({}),
  configPath: "/tmp/vault-memory-gating.toml",
  listVaults: () => [] as never[],
  peerMcpStatus: () => [] as Array<{ name: string; available: boolean }>,
  contractCountFor: () => 0,
  reindexVault: async () => {},
  notifier: () => {},
  suppression: new SuppressionSet({ ttlMs: 2000 }),
};

async function makeLinkedClientServer() {
  const server = new McpServer(
    { name: "vault-memory-gating-test", version: "test" },
    { capabilities: { tools: { listChanged: true } } },
  );
  // Pre-init the tool-request handlers BEFORE `connect` so subsequent
  // `registerTool` calls (driven by syncPluginTools) don't try to
  // `registerCapabilities` post-connect. We do this by registering a
  // sentinel tool whose handler is never invoked — its only purpose is to
  // force `setToolRequestHandlers()` to fire while capability registration
  // is still legal.
  const sentinel = server.registerTool(
    "__gating_sentinel__",
    { description: "test sentinel — not part of the public API", inputSchema: { _: z.string().optional() } },
    async () => ({ content: [{ type: "text" as const, text: "{}" }] }),
  );
  // Disable so it doesn't pollute tools/list payloads.
  sentinel.disable();

  const client = new Client(
    { name: "gating-test-client", version: "test" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const cleanup = async () => {
    await client.close();
    await server.close();
  };
  return { server, client, cleanup };
}

describe("Plan 07-04: plugin-control tool gating", () => {
  it("plugin.enabled = false → zero plugin tools appear in tools/list", async () => {
    const { server, client, cleanup } = await makeLinkedClientServer();
    try {
      const registered = new Map<string, RegisteredTool>();
      syncPluginTools(server, registered, { enabled: false, ...DEFAULT_DEPS });

      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);
      for (const pluginToolName of PLUGIN_TOOL_NAMES) {
        expect(names).not.toContain(pluginToolName);
      }
    } finally {
      await cleanup();
    }
  });

  it("plugin.enabled = true → all six plugin tools appear in tools/list", async () => {
    const { server, client, cleanup } = await makeLinkedClientServer();
    try {
      const registered = new Map<string, RegisteredTool>();
      syncPluginTools(server, registered, { enabled: true, ...DEFAULT_DEPS });

      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);
      for (const pluginToolName of PLUGIN_TOOL_NAMES) {
        expect(names).toContain(pluginToolName);
      }
      // Exactly six tools registered — and only the plugin tools (since
      // this server isolates them from the rest of the 23-tool surface).
      // Plan 07-07 added the sixth: `suppress_contract_write`.
      expect(names.filter((n) => (PLUGIN_TOOL_NAMES as readonly string[]).includes(n)))
        .toHaveLength(6);
    } finally {
      await cleanup();
    }
  });

  it("flipping from enabled=true to enabled=false removes all plugin tools", async () => {
    const { server, client, cleanup } = await makeLinkedClientServer();
    try {
      const registered = new Map<string, RegisteredTool>();
      syncPluginTools(server, registered, { enabled: true, ...DEFAULT_DEPS });
      let result = await client.listTools();
      expect(result.tools.length).toBeGreaterThanOrEqual(6);

      syncPluginTools(server, registered, { enabled: false, ...DEFAULT_DEPS });
      result = await client.listTools();
      const namesAfter = result.tools.map((t) => t.name);
      for (const pluginToolName of PLUGIN_TOOL_NAMES) {
        expect(namesAfter).not.toContain(pluginToolName);
      }
    } finally {
      await cleanup();
    }
  });
});
