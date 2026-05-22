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

/** Build a stub Client + transport pair via the injection seam. */
function makeStubFactory(
  toolResult: unknown = { content: [{ type: "text", text: JSON.stringify({ hello: "world" }) }] },
  shouldFail = false,
): {
  factory: ClientFactory;
  closeSpy: ReturnType<typeof vi.fn>;
  callToolSpy: ReturnType<typeof vi.fn>;
} {
  const closeSpy = vi.fn();
  const callToolSpy = vi.fn(async () => toolResult);
  const factory: ClientFactory = async () => {
    if (shouldFail) {
      throw new Error("simulated connect failure");
    }
    return {
      // The shape mirrors what `new Client(...)` exposes — only the
      // methods PeerMcpRegistry actually uses are required by the
      // structural contract.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: { callTool: callToolSpy } as any,
      transport: { close: closeSpy },
    };
  };
  return { factory, closeSpy, callToolSpy };
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
    const { factory } = makeStubFactory(undefined, true);
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
      content: [{ type: "text", text: JSON.stringify({ hello: "world" }) }],
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
      content: [{ type: "text", text: "not-json-just-a-string" }],
    });
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "node" } });
    const result = await reg.get("gh")!.callTool("t", {});
    expect(result).toBe("not-json-just-a-string");
  });

  it("Test 7c: callTool returns the full envelope when no text content is present", async () => {
    const fullEnv = { content: [{ type: "image", data: "abc" }] };
    const { factory } = makeStubFactory(fullEnv);
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "node" } });
    const result = await reg.get("gh")!.callTool("t", {});
    expect(result).toEqual(fullEnv);
  });

  it("Test 8: unavailable client's callTool throws (defense in depth)", async () => {
    const { factory } = makeStubFactory(undefined, true);
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "echo" } });
    const client = reg.get("gh")!;
    await expect(client.callTool("x", {})).rejects.toThrow(/peer-MCP client unavailable/);
  });
});
