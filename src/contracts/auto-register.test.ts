/**
 * Tests for syncAutoRegistered — Plan 06-02 Task 2 / D-A1, Pattern 4.
 *
 * Uses a fake McpServer that records `registerTool` + `sendToolListChanged`
 * calls; each registered tool is a fake `RegisteredTool` with a spy-able
 * `remove()`. Tests exercise diff semantics + the "exactly once per
 * mutation cycle" invariant on the notification.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { ContractRegistry } from "./registry.js";
import { syncAutoRegistered } from "./auto-register.js";
import type { ParsedContract } from "./types.js";
import type {
  McpServer,
  RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";

// ─────────────────────────────────────────────────────────────────────────
// Fake McpServer + RegisteredTool
// ─────────────────────────────────────────────────────────────────────────

interface RegisterToolCall {
  name: string;
  config: { description?: string; inputSchema?: unknown };
  callback: (args: unknown) => Promise<unknown>;
}

class FakeRegisteredTool {
  removed = false;
  constructor(public readonly name: string) {}
  remove(): void {
    this.removed = true;
  }
}

class FakeMcpServer {
  readonly registerCalls: RegisterToolCall[] = [];
  toolListChangedCount = 0;
  /** Last RegisteredTool returned per name (the spy handle). */
  readonly handles = new Map<string, FakeRegisteredTool>();

  registerTool(
    name: string,
    config: { description?: string; inputSchema?: unknown },
    callback: (args: unknown) => Promise<unknown>,
  ): RegisteredTool {
    this.registerCalls.push({ name, config, callback });
    const handle = new FakeRegisteredTool(name);
    this.handles.set(name, handle);
    return handle as unknown as RegisteredTool;
  }

  sendToolListChanged(): void {
    this.toolListChangedCount++;
  }
}

function makeParsedContract(name: string, description = `desc-${name}`): ParsedContract {
  const inputZodSchema = z.object({ q: z.string() });
  return {
    version: 1,
    name,
    description,
    inputs: { q: { type: "string" } },
    required: ["q"],
    sources: {},
    sinks: {},
    assembly: [{ as: "step", verb: "literal", value: 1 }],
    inputZodSchema,
    inputJsonSchema: {
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
      additionalProperties: false,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Behavior cases
// ─────────────────────────────────────────────────────────────────────────

describe("syncAutoRegistered (D-A1, Pattern 4)", () => {
  let server: FakeMcpServer;
  let registry: ContractRegistry;
  let registered: Map<string, RegisteredTool>;
  const instantiateHandler = async (
    _name: string,
    _args: unknown,
  ): Promise<unknown> => ({ ok: false, reason: "not_yet_implemented" });

  beforeEach(() => {
    server = new FakeMcpServer();
    registry = new ContractRegistry();
    registered = new Map();
  });

  it("Test 1 (no-op when disabled): does not call registerTool or sendToolListChanged", () => {
    registry.set("meeting-prep", makeParsedContract("meeting-prep"));
    syncAutoRegistered(server as unknown as McpServer, registry, "vm_", registered, {
      enabled: false,
      instantiateHandler,
    });
    expect(server.registerCalls).toEqual([]);
    expect(server.toolListChangedCount).toBe(0);
    expect(registered.size).toBe(0);
  });

  it("Test 2 (initial add): registers all desired tools + fires sendToolListChanged exactly once", () => {
    registry.set("meeting-prep", makeParsedContract("meeting-prep"));
    registry.set("project-status", makeParsedContract("project-status"));
    syncAutoRegistered(server as unknown as McpServer, registry, "vm_", registered, {
      enabled: true,
      instantiateHandler,
    });
    expect(server.registerCalls.map((c) => c.name).sort()).toEqual([
      "vm_meeting_prep",
      "vm_project_status",
    ]);
    expect(server.toolListChangedCount).toBe(1);
    expect(registered.size).toBe(2);
    expect(registered.get("vm_meeting_prep")).toBeDefined();
  });

  it("Test 3 (idempotent on no-op): a second sync with the same registry does NOT call sendToolListChanged again", () => {
    registry.set("meeting-prep", makeParsedContract("meeting-prep"));
    syncAutoRegistered(server as unknown as McpServer, registry, "vm_", registered, {
      enabled: true,
      instantiateHandler,
    });
    expect(server.toolListChangedCount).toBe(1);
    syncAutoRegistered(server as unknown as McpServer, registry, "vm_", registered, {
      enabled: true,
      instantiateHandler,
    });
    expect(server.toolListChangedCount).toBe(1); // not 2
    expect(server.registerCalls.length).toBe(1); // not 2
  });

  it("Test 4 (additive): adds a new tool without re-registering existing ones", () => {
    registry.set("meeting-prep", makeParsedContract("meeting-prep"));
    syncAutoRegistered(server as unknown as McpServer, registry, "vm_", registered, {
      enabled: true,
      instantiateHandler,
    });
    expect(server.registerCalls.length).toBe(1);

    registry.set("project-status", makeParsedContract("project-status"));
    syncAutoRegistered(server as unknown as McpServer, registry, "vm_", registered, {
      enabled: true,
      instantiateHandler,
    });
    expect(server.registerCalls.length).toBe(2);
    expect(server.registerCalls[1]!.name).toBe("vm_project_status");
    expect(server.toolListChangedCount).toBe(2);
  });

  it("Test 5 (removal): drops a tool no longer in the registry; calls .remove() on the handle", () => {
    registry.set("meeting-prep", makeParsedContract("meeting-prep"));
    registry.set("project-status", makeParsedContract("project-status"));
    syncAutoRegistered(server as unknown as McpServer, registry, "vm_", registered, {
      enabled: true,
      instantiateHandler,
    });
    const psHandle = server.handles.get("vm_project_status");
    expect(psHandle).toBeDefined();

    registry.delete("project-status");
    syncAutoRegistered(server as unknown as McpServer, registry, "vm_", registered, {
      enabled: true,
      instantiateHandler,
    });
    expect(psHandle!.removed).toBe(true);
    expect(registered.has("vm_project_status")).toBe(false);
    expect(registered.has("vm_meeting_prep")).toBe(true);
    expect(server.toolListChangedCount).toBe(2);
  });

  it("Test 6 (mixed add + remove): performs both, preserves untouched handle", () => {
    registry.set("a", makeParsedContract("a"));
    registry.set("b", makeParsedContract("b"));
    syncAutoRegistered(server as unknown as McpServer, registry, "vm_", registered, {
      enabled: true,
      instantiateHandler,
    });
    const bHandle = server.handles.get("vm_b");

    // Swap: remove "a", add "meeting-prep"; keep "b".
    registry.delete("a");
    registry.set("meeting-prep", makeParsedContract("meeting-prep"));
    syncAutoRegistered(server as unknown as McpServer, registry, "vm_", registered, {
      enabled: true,
      instantiateHandler,
    });

    expect(server.handles.get("vm_a")!.removed).toBe(true);
    expect(server.handles.get("vm_meeting_prep")!.removed).toBe(false);
    // bHandle was NEVER touched after the initial registration.
    expect(bHandle!.removed).toBe(false);
    expect(registered.has("vm_b")).toBe(true);
  });

  it("Test 7 (prefix override): respects a custom tool_prefix", () => {
    registry.set("meeting-prep", makeParsedContract("meeting-prep"));
    registry.set("project-status", makeParsedContract("project-status"));
    syncAutoRegistered(server as unknown as McpServer, registry, "x_", registered, {
      enabled: true,
      instantiateHandler,
    });
    expect(server.registerCalls.map((c) => c.name).sort()).toEqual([
      "x_meeting_prep",
      "x_project_status",
    ]);
  });

  it("Test 8 (callback shim): forwards args to instantiateHandler with the contract name", async () => {
    let captured: { name?: string; args?: unknown } = {};
    const captureHandler = async (name: string, args: unknown): Promise<unknown> => {
      captured = { name, args };
      return { ok: true, echo: args };
    };
    registry.set("meeting-prep", makeParsedContract("meeting-prep"));
    syncAutoRegistered(server as unknown as McpServer, registry, "vm_", registered, {
      enabled: true,
      instantiateHandler: captureHandler,
    });
    const call = server.registerCalls[0]!;
    const result = (await call.callback({ q: "hello" })) as {
      content: { type: string; text: string }[];
    };
    expect(captured.name).toBe("meeting-prep");
    expect(captured.args).toEqual({ q: "hello" });
    expect(result.content[0]!.text).toContain("hello");
  });

  it("Test 9 (RegisteredTool handle): server.registerTool returns a handle whose remove() is called on removal", () => {
    registry.set("foo", makeParsedContract("foo"));
    syncAutoRegistered(server as unknown as McpServer, registry, "vm_", registered, {
      enabled: true,
      instantiateHandler,
    });
    const handle = server.handles.get("vm_foo");
    expect(handle).toBeDefined();
    expect(handle!.removed).toBe(false);
    registry.delete("foo");
    syncAutoRegistered(server as unknown as McpServer, registry, "vm_", registered, {
      enabled: true,
      instantiateHandler,
    });
    expect(handle!.removed).toBe(true);
  });
});
