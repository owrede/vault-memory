/**
 * Unit tests for `syncPluginTools` — Phase 7 / Plan 07-04 / D-MCP-SURFACE.
 *
 * Mirrors the gating semantics of `syncAutoRegistered` (Phase 6 auto-register
 * pattern). When `enabled: false`, every plugin tool currently in `registered`
 * is removed; when `enabled: true`, all five tools are registered. Calls
 * `sendToolListChanged()` exactly once per mutation transition (idempotent
 * re-calls are no-ops).
 */

import { describe, it, expect, vi } from "vitest";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { syncPluginTools, PLUGIN_TOOL_NAMES } from "./index.js";
import { RuntimeConfigStore } from "./runtime-config.js";

function makeFakeServer() {
  const sendToolListChanged = vi.fn();
  const tools = new Map<string, { remove: () => void }>();
  const registerTool = vi.fn((name: string) => {
    const handle: RegisteredTool = {
      enabled: true,
      enable: () => {},
      disable: () => {},
      update: () => {},
      remove: () => {
        tools.delete(name);
      },
    } as unknown as RegisteredTool;
    tools.set(name, handle as unknown as { remove: () => void });
    return handle;
  });
  return {
    sendToolListChanged,
    registerTool,
    tools,
    // Mimic McpServer shape used by syncPluginTools
    server: {
      registerTool,
      sendToolListChanged,
    },
  };
}

function makeDeps() {
  return {
    runtimeConfig: new RuntimeConfigStore({}),
    configPath: "/tmp/vault-memory-test.toml",
    listVaults: () => [],
    peerMcpStatus: () => [],
    contractCountFor: () => 0,
    reindexVault: async () => {},
    notifier: () => {},
  };
}

describe("syncPluginTools", () => {
  it("(a) enabled=false: registers zero plugin tools", () => {
    const f = makeFakeServer();
    const registered = new Map<string, RegisteredTool>();
    syncPluginTools(f.server as never, registered, {
      enabled: false,
      ...makeDeps(),
    });
    expect(registered.size).toBe(0);
    expect(f.registerTool).not.toHaveBeenCalled();
    expect(f.sendToolListChanged).not.toHaveBeenCalled();
  });

  it("(b) enabled=true: registers all five with their declared names", () => {
    const f = makeFakeServer();
    const registered = new Map<string, RegisteredTool>();
    syncPluginTools(f.server as never, registered, {
      enabled: true,
      ...makeDeps(),
    });
    expect(registered.size).toBe(5);
    const names = Array.from(registered.keys()).sort();
    expect(names).toEqual([...PLUGIN_TOOL_NAMES].sort());
    expect(f.sendToolListChanged).toHaveBeenCalledTimes(1);
  });

  it("(c) flipping from enabled=true to enabled=false removes all five (idempotent)", () => {
    const f = makeFakeServer();
    const registered = new Map<string, RegisteredTool>();
    syncPluginTools(f.server as never, registered, {
      enabled: true,
      ...makeDeps(),
    });
    expect(registered.size).toBe(5);

    syncPluginTools(f.server as never, registered, {
      enabled: false,
      ...makeDeps(),
    });
    expect(registered.size).toBe(0);
    // Second disable should be a no-op (idempotent)
    const callsBefore = f.sendToolListChanged.mock.calls.length;
    syncPluginTools(f.server as never, registered, {
      enabled: false,
      ...makeDeps(),
    });
    expect(f.sendToolListChanged.mock.calls.length).toBe(callsBefore);
  });

  it("(d) sendToolListChanged fires exactly once per mutation transition", () => {
    const f = makeFakeServer();
    const registered = new Map<string, RegisteredTool>();
    // First enable: 1 mutation transition
    syncPluginTools(f.server as never, registered, {
      enabled: true,
      ...makeDeps(),
    });
    expect(f.sendToolListChanged).toHaveBeenCalledTimes(1);
    // Idempotent re-call with same enabled=true: NO new mutation
    syncPluginTools(f.server as never, registered, {
      enabled: true,
      ...makeDeps(),
    });
    expect(f.sendToolListChanged).toHaveBeenCalledTimes(1);
    // Disable: 2nd mutation transition
    syncPluginTools(f.server as never, registered, {
      enabled: false,
      ...makeDeps(),
    });
    expect(f.sendToolListChanged).toHaveBeenCalledTimes(2);
  });
});
