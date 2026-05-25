/**
 * Tests for the sources MCP resource projections — SOURCES-REGISTRY.md §5.
 *
 * Drives a real PeerMcpRegistry through the test client-factory seam so
 * the cached tools + status flow through exactly as in production.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PeerMcpRegistry, type ClientFactory } from "./mcp-clients.js";
import {
  readListSources,
  readSourceTools,
  readSourceTool,
  type SourceConfigMeta,
} from "./sources-resources.js";

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

function factoryWithTools(
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>,
  opts: { fail?: boolean; toolsThrow?: boolean } = {},
): ClientFactory {
  return async () => {
    if (opts.fail) throw new Error("connect boom");
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: {
        callTool: vi.fn(),
        listTools: vi.fn(async () => {
          if (opts.toolsThrow) throw new Error("tools/list boom");
          return { tools };
        }),
      } as any,
      transport: { close: vi.fn() },
    };
  };
}

const META: Record<string, SourceConfigMeta> = {
  gh: { command: "gh-mcp", args: ["--config", "/p"] },
};

describe("readListSources", () => {
  it("projects a connected source with tool_count + transport", async () => {
    const reg = new PeerMcpRegistry(
      factoryWithTools([{ name: "list_issues" }, { name: "create_pr" }]),
    );
    await reg.start({ gh: { command: "gh-mcp", args: ["--config", "/p"] } });
    const out = readListSources(reg, META);
    expect(out.sources).toHaveLength(1);
    const e = out.sources[0]!;
    expect(e.name).toBe("gh");
    expect(e.transport).toBe("stdio");
    expect(e.command).toBe("gh-mcp");
    expect(e.args).toEqual(["--config", "/p"]);
    expect(e.status).toBe("connected");
    expect(e.tool_count).toBe(2);
    expect(e.last_refreshed).toBeTypeOf("number");
    expect(e.error).toBeUndefined();
  });

  it("includes an unavailable source with its connect error and zero tools", async () => {
    const reg = new PeerMcpRegistry(factoryWithTools([], { fail: true }));
    await reg.start({ gh: { command: "gh-mcp" } });
    const out = readListSources(reg, {});
    const e = out.sources[0]!;
    expect(e.status).toBe("unavailable");
    expect(e.tool_count).toBe(0);
    expect(e.error).toContain("connect boom");
    // No config meta supplied → empty command/args, still listed.
    expect(e.command).toBe("");
    expect(e.args).toEqual([]);
  });

  it("marks a source unreachable when tools/list fails but keeps it listed", async () => {
    const reg = new PeerMcpRegistry(factoryWithTools([], { toolsThrow: true }));
    await reg.start({ gh: { command: "gh-mcp" } });
    const e = readListSources(reg, META).sources[0]!;
    expect(e.status).toBe("unreachable");
    expect(e.error).toContain("tools/list boom");
  });

  it("lists multiple sources in registry insertion order", async () => {
    const reg = new PeerMcpRegistry(factoryWithTools([{ name: "x" }]));
    await reg.start({ a: { command: "a" }, b: { command: "b" } });
    expect(readListSources(reg, {}).sources.map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("returns empty when the registry has no sources", () => {
    const reg = new PeerMcpRegistry();
    expect(readListSources(reg, {}).sources).toEqual([]);
  });
});

describe("readSourceTools", () => {
  it("returns the cached tools for a connected source", async () => {
    const reg = new PeerMcpRegistry(
      factoryWithTools([
        { name: "list_issues", description: "List", inputSchema: { type: "object" } },
      ]),
    );
    await reg.start({ gh: { command: "gh-mcp" } });
    const out = readSourceTools(reg, "gh");
    expect("tools" in out).toBe(true);
    if ("tools" in out) {
      expect(out.name).toBe("gh");
      expect(out.status).toBe("connected");
      expect(out.tools).toHaveLength(1);
      expect(out.tools[0]?.name).toBe("list_issues");
      expect(out.tools[0]?.inputSchema).toEqual({ type: "object" });
    }
  });

  it("returns an error object for an unknown source", () => {
    const reg = new PeerMcpRegistry();
    const out = readSourceTools(reg, "nope");
    expect(out).toEqual({ error: "unknown source: nope" });
  });

  it("returns empty tools for an unreachable source", async () => {
    const reg = new PeerMcpRegistry(factoryWithTools([], { toolsThrow: true }));
    await reg.start({ gh: { command: "gh-mcp" } });
    const out = readSourceTools(reg, "gh");
    if ("tools" in out) {
      expect(out.status).toBe("unreachable");
      expect(out.tools).toEqual([]);
    } else {
      throw new Error("expected tools resource, got error");
    }
  });
});

describe("readSourceTool", () => {
  it("returns a single tool's schema by name", async () => {
    const reg = new PeerMcpRegistry(
      factoryWithTools([
        { name: "list_issues", description: "List issues" },
        { name: "create_pr" },
      ]),
    );
    await reg.start({ gh: { command: "gh-mcp" } });
    const out = readSourceTool(reg, "gh", "create_pr");
    expect(out.found).toBe(true);
    if (out.found) {
      expect(out.tool.name).toBe("create_pr");
    }
  });

  it("returns found:false for an unknown source", () => {
    const reg = new PeerMcpRegistry();
    const out = readSourceTool(reg, "nope", "x");
    expect(out).toEqual({ found: false, error: "unknown source: nope" });
  });

  it("returns found:false for a known source but unknown tool", async () => {
    const reg = new PeerMcpRegistry(factoryWithTools([{ name: "a" }]));
    await reg.start({ gh: { command: "gh-mcp" } });
    const out = readSourceTool(reg, "gh", "missing");
    expect(out).toEqual({ found: false, error: "unknown tool: gh/missing" });
  });
});
