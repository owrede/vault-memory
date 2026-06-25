/**
 * Tests for `PeerMcpRegistry` — Plan 06-03 Task 2 (D-A2a peer-MCP,
 * Pitfall F4, RESEARCH §Pattern 3).
 *
 * Uses the `clientFactory` injection seam — tests do not spawn child
 * processes. The CON-09 smoketest in Plan 06-04 exercises the real
 * `defaultConnect` path end-to-end.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PeerMcpRegistry, type ClientFactory } from "./mcp-clients.js";

let stderrWrites: string[] = [];
let originalStderrWrite: typeof process.stderr.write;

beforeEach(() => {
  stderrWrites = [];
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    stderrWrites.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stderr.write = originalStderrWrite;
});

interface StubOpts {
  toolResult?: unknown;
  shouldFail?: boolean;
  /** tools/list payload; when omitted the stub client has no listTools. */
  toolsListResult?: { tools: Array<{ name: string; description?: string; inputSchema?: unknown }> };
  /** Make listTools reject, to exercise the "unreachable" path. */
  toolsListThrows?: boolean;
}

/** Build a stub Client + transport pair via the injection seam. */
function makeStubFactory(opts: StubOpts = {}): {
  factory: ClientFactory;
  closeSpy: ReturnType<typeof vi.fn>;
  callToolSpy: ReturnType<typeof vi.fn>;
  listToolsSpy: ReturnType<typeof vi.fn>;
} {
  const toolResult = opts.toolResult ?? {
    content: [{ type: "text", text: JSON.stringify({ hello: "world" }) }],
  };
  const closeSpy = vi.fn();
  const callToolSpy = vi.fn(async () => toolResult);
  const listToolsSpy = vi.fn(async () => {
    if (opts.toolsListThrows) throw new Error("simulated tools/list failure");
    return opts.toolsListResult ?? { tools: [] };
  });
  const factory: ClientFactory = async () => {
    if (opts.shouldFail) {
      throw new Error("simulated connect failure");
    }
    // The shape mirrors what `new Client(...)` exposes — only the
    // methods PeerMcpRegistry actually uses are required by the
    // structural contract. `listTools` is included only when the test
    // supplies a payload or asks it to throw, so the "no listTools"
    // branch stays exercised by default.
    const client: Record<string, unknown> = { callTool: callToolSpy };
    if (opts.toolsListResult !== undefined || opts.toolsListThrows) {
      client.listTools = listToolsSpy;
    }
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      transport: { close: closeSpy },
    };
  };
  return { factory, closeSpy, callToolSpy, listToolsSpy };
}

describe("PeerMcpRegistry (D-A2a peer-MCP, Pattern 3, Pitfall F4)", () => {
  it("Test 1: empty config — size 0; start({}) no-op", async () => {
    const { factory } = makeStubFactory();
    const reg = new PeerMcpRegistry(factory);
    expect(reg.size).toBe(0);
    await reg.start({});
    expect(reg.size).toBe(0);
  });

  it("Test 2: connect failure marks client as unavailable and writes WARN to stderr", async () => {
    const { factory } = makeStubFactory({ shouldFail: true });
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "echo", args: ["test"] } });
    const client = reg.get("gh");
    expect(client).toBeDefined();
    expect(client?.available).toBe(false);
    expect(stderrWrites.join("")).toContain("[contracts] peer-MCP client 'gh' failed to start");
    expect(stderrWrites.join("")).toContain("simulated connect failure");
  });

  it("Test 3: get('nonexistent') returns undefined", async () => {
    const reg = new PeerMcpRegistry();
    expect(reg.get("nonexistent")).toBeUndefined();
  });

  it("Test 4: Symbol.dispose on a PeerMcpClient invokes transport.close()", async () => {
    const { factory, closeSpy } = makeStubFactory();
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "node", args: ["stub.mjs"] } });
    const client = reg.get("gh");
    expect(client).toBeDefined();
    client![Symbol.dispose]();
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it("Test 5: shutdown disposes every client and clears the map", async () => {
    const { factory: f1, closeSpy: c1 } = makeStubFactory();
    const { factory: f2, closeSpy: c2 } = makeStubFactory();
    // The registry takes a single factory; for this test we use one
    // factory but verify shutdown clears all entries.
    const reg = new PeerMcpRegistry(f1);
    await reg.start({ a: { command: "x" }, b: { command: "y" } });
    expect(reg.size).toBe(2);
    await reg.shutdown();
    expect(reg.size).toBe(0);
    expect(c1).toHaveBeenCalled();
    // c2 is unused — single factory drives both clients in this stub.
    void c2;
  });

  it("Test 6: successful client connects + available === true", async () => {
    const { factory } = makeStubFactory();
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ test: { command: "node", args: ["stub.mjs"] } });
    const client = reg.get("test");
    expect(client).toBeDefined();
    expect(client?.available).toBe(true);
  });

  it("Test 7: callTool peels the MCP envelope and returns parsed JSON", async () => {
    const { factory, callToolSpy } = makeStubFactory({
      toolResult: { content: [{ type: "text", text: JSON.stringify({ hello: "world" }) }] },
    });
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "node" } });
    const client = reg.get("gh")!;
    const result = await client.callTool("some_tool", { x: 1 });
    expect(callToolSpy).toHaveBeenCalledWith({ name: "some_tool", arguments: { x: 1 } });
    expect(result).toEqual({ hello: "world" });
  });

  it("Test 7b: callTool returns the raw text when the text payload is not JSON", async () => {
    const { factory } = makeStubFactory({
      toolResult: { content: [{ type: "text", text: "not-json-just-a-string" }] },
    });
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "node" } });
    const result = await reg.get("gh")!.callTool("t", {});
    expect(result).toBe("not-json-just-a-string");
  });

  it("Test 7c: callTool returns the full envelope when no text content is present", async () => {
    const fullEnv = { content: [{ type: "image", data: "abc" }] };
    const { factory } = makeStubFactory({ toolResult: fullEnv });
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "node" } });
    const result = await reg.get("gh")!.callTool("t", {});
    expect(result).toEqual(fullEnv);
  });

  it("Test 8: unavailable client's callTool throws (defense in depth)", async () => {
    const { factory } = makeStubFactory({ shouldFail: true });
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "echo" } });
    const client = reg.get("gh")!;
    await expect(client.callTool("x", {})).rejects.toThrow(/peer-MCP client unavailable/);
  });

  // ─── Tools cache + lifecycle (SOURCES-REGISTRY.md Stage 1) ──────────────

  it("Test 9: start() primes the tools cache from tools/list", async () => {
    const { factory, listToolsSpy } = makeStubFactory({
      toolsListResult: {
        tools: [
          { name: "list_issues", description: "List issues", inputSchema: { type: "object" } },
          { name: "create_pr" },
        ],
      },
    });
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "node" } });
    expect(listToolsSpy).toHaveBeenCalledOnce();
    const info = reg.getInfo("gh");
    expect(info?.status).toBe("connected");
    expect(info?.tools.map((t) => t.name)).toEqual(["list_issues", "create_pr"]);
    expect(info?.tools[0]?.description).toBe("List issues");
    expect(info?.tools[0]?.inputSchema).toEqual({ type: "object" });
    expect(info?.lastRefreshed).toBeTypeOf("number");
  });

  it("Test 10: connected client with no listTools support → empty tools, still connected", async () => {
    const { factory } = makeStubFactory(); // no listTools on stub client
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "node" } });
    const info = reg.getInfo("gh");
    expect(info?.status).toBe("connected");
    expect(info?.tools).toEqual([]);
  });

  it("Test 11: tools/list failure marks the source unreachable but keeps the client", async () => {
    const { factory } = makeStubFactory({ toolsListThrows: true });
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "node" } });
    const info = reg.getInfo("gh");
    expect(info?.status).toBe("unreachable");
    expect(info?.error).toContain("simulated tools/list failure");
    // The client is still live — callTool works.
    expect(reg.get("gh")?.available).toBe(true);
  });

  it("Test 12: unavailable source reports status 'unavailable' with the connect error", async () => {
    const { factory } = makeStubFactory({ shouldFail: true });
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "echo" } });
    const info = reg.getInfo("gh");
    expect(info?.status).toBe("unavailable");
    expect(info?.error).toContain("simulated connect failure");
    expect(info?.tools).toEqual([]);
    expect(info?.lastRefreshed).toBeNull();
  });

  it("Test 13: getInfo('nonexistent') and refresh('nonexistent') return undefined", async () => {
    const reg = new PeerMcpRegistry();
    expect(reg.getInfo("nope")).toBeUndefined();
    await expect(reg.refresh("nope")).resolves.toBeUndefined();
  });

  it("Test 14: refresh() re-issues tools/list and updates the cache", async () => {
    let call = 0;
    const factory: ClientFactory = async () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: {
        callTool: vi.fn(),
        listTools: vi.fn(async () => {
          call += 1;
          return call === 1
            ? { tools: [{ name: "a" }] }
            : { tools: [{ name: "a" }, { name: "b" }] };
        }),
      } as any,
      transport: { close: vi.fn() },
    });
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "node" } });
    expect(reg.getInfo("gh")?.tools.map((t) => t.name)).toEqual(["a"]);
    const refreshed = await reg.refresh("gh");
    expect(refreshed?.tools.map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("Test 15: refresh() on an unavailable source reports unavailable, does not throw", async () => {
    const { factory } = makeStubFactory({ shouldFail: true });
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "echo" } });
    const info = await reg.refresh("gh");
    expect(info?.status).toBe("unavailable");
  });

  it("Test 16: add() registers a new source at runtime and primes its tools", async () => {
    const { factory } = makeStubFactory({
      toolsListResult: { tools: [{ name: "search" }] },
    });
    const reg = new PeerMcpRegistry(factory);
    const info = await reg.add("notion", { command: "notion-mcp" });
    expect(reg.size).toBe(1);
    expect(info.status).toBe("connected");
    expect(info.tools.map((t) => t.name)).toEqual(["search"]);
    expect(reg.names()).toContain("notion");
  });

  it("Test 17: add() replacing an existing name disposes the old client first", async () => {
    const firstClose = vi.fn();
    let spawn = 0;
    const factory: ClientFactory = async () => {
      spawn += 1;
      const close = spawn === 1 ? firstClose : vi.fn();
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client: { callTool: vi.fn(), listTools: vi.fn(async () => ({ tools: [] })) } as any,
        transport: { close },
      };
    };
    const reg = new PeerMcpRegistry(factory);
    await reg.add("gh", { command: "a" });
    await reg.add("gh", { command: "b" });
    expect(firstClose).toHaveBeenCalledOnce();
    expect(reg.size).toBe(1);
  });

  it("Test 18: remove() disposes the client and drops it; idempotent", async () => {
    const { factory, closeSpy } = makeStubFactory({
      toolsListResult: { tools: [] },
    });
    const reg = new PeerMcpRegistry(factory);
    await reg.add("gh", { command: "node" });
    expect(reg.remove("gh")).toBe(true);
    expect(closeSpy).toHaveBeenCalledOnce();
    expect(reg.size).toBe(0);
    expect(reg.get("gh")).toBeUndefined();
    // Idempotent — removing again is a no-op returning false.
    expect(reg.remove("gh")).toBe(false);
  });

  it("Test 19: names() lists registered sources in insertion order", async () => {
    const { factory } = makeStubFactory({ toolsListResult: { tools: [] } });
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ a: { command: "x" }, b: { command: "y" }, c: { command: "z" } });
    expect(reg.names()).toEqual(["a", "b", "c"]);
  });
});
