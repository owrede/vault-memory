/**
 * Tests for `verbDispatcher` — Plan 06-03 Task 3 (D-A2a, RESEARCH §A9).
 *
 * Stub deps mock each baseline verb's handler. Tests verify dispatch
 * shape, literal handling, mcp:// delegation, Q-TIMEOUT scoping, and
 * structured error envelopes.
 */

import { describe, it, expect, vi } from "vitest";
import { verbDispatcher, type VerbDeps } from "./index.js";
import { PeerMcpRegistry, type ClientFactory } from "../mcp-clients.js";

function buildDeps(overrides: Partial<VerbDeps> = {}): VerbDeps {
  const noop = vi.fn(async () => ({ ok: true }));
  return {
    hybridSearch: noop,
    handleExpand: noop,
    handleCluster: noop,
    handleRecall: noop,
    handleCompileBrief: noop,
    handleGetBrief: noop,
    handleQueryFrontmatter: noop,
    handleListBacklinks: noop,
    handleGetOutline: noop,
    handleSearchSections: noop,
    handleReadNote: noop,
    peerMcpRegistry: new PeerMcpRegistry(),
    ...overrides,
  };
}

describe("verbDispatcher (D-A2a baseline)", () => {
  it("Test 1: literal verb returns step.value (peeled, not args)", async () => {
    const deps = buildDeps();
    const r = await verbDispatcher("literal", {}, { value: "hello" }, deps, {
      stepAlias: "x",
      timeoutSeconds: 30,
    });
    expect(r).toBe("hello");
  });

  it("Test 2: literal preserves typed values (arrays, objects)", async () => {
    const deps = buildDeps();
    const r = await verbDispatcher("literal", {}, { value: [1, 2, 3] }, deps, {
      stepAlias: "x",
      timeoutSeconds: 30,
    });
    expect(r).toEqual([1, 2, 3]);
  });

  it("Test 3: search_hybrid routes to deps.hybridSearch with args", async () => {
    const fake = vi.fn(async () => ({ hits: [{ doc_id: "x" }] }));
    const deps = buildDeps({ hybridSearch: fake });
    const args = { query: "test", vault: "my-vault", top_k: 5 };
    const r = await verbDispatcher("search_hybrid", args, undefined, deps, {
      stepAlias: "s",
      timeoutSeconds: 30,
    });
    expect(fake).toHaveBeenCalledWith(args);
    expect(r).toEqual({ hits: [{ doc_id: "x" }] });
  });

  it("Test 4: compile_brief routes to deps.handleCompileBrief", async () => {
    const fake = vi.fn(async () => ({ ok: true, doc_id: "obsidian-fs://v/b.md" }));
    const deps = buildDeps({ handleCompileBrief: fake });
    const args = { vault: "v", target: "atlas", source_doc_ids: ["a"], purpose: "p" };
    await verbDispatcher("compile_brief", args, undefined, deps, {
      stepAlias: "c",
      timeoutSeconds: 30,
    });
    expect(fake).toHaveBeenCalledWith(args);
  });

  it("Test 5: each baseline verb routes to its declared handler", async () => {
    const calls: Record<string, unknown> = {};
    const make =
      (key: string) =>
      async (args: unknown): Promise<unknown> => {
        calls[key] = args;
        return { ok: true };
      };
    const deps = buildDeps({
      handleExpand: make("expand"),
      handleCluster: make("cluster"),
      handleRecall: make("recall"),
      handleGetBrief: make("get_brief"),
      handleQueryFrontmatter: make("query_frontmatter"),
      handleListBacklinks: make("list_backlinks"),
      handleGetOutline: make("get_outline"),
      handleSearchSections: make("search_sections"),
      handleReadNote: make("read_note"),
    });
    const opts = { stepAlias: "s", timeoutSeconds: 30 };
    await verbDispatcher("expand", { a: 1 }, undefined, deps, opts);
    await verbDispatcher("cluster", { a: 2 }, undefined, deps, opts);
    await verbDispatcher("recall", { a: 3 }, undefined, deps, opts);
    await verbDispatcher("get_brief", { a: 4 }, undefined, deps, opts);
    await verbDispatcher("query_frontmatter", { a: 5 }, undefined, deps, opts);
    await verbDispatcher("list_backlinks", { a: 6 }, undefined, deps, opts);
    await verbDispatcher("get_outline", { a: 7 }, undefined, deps, opts);
    await verbDispatcher("search_sections", { a: 8 }, undefined, deps, opts);
    await verbDispatcher("read_note", { a: 9 }, undefined, deps, opts);
    expect(calls).toEqual({
      expand: { a: 1 },
      cluster: { a: 2 },
      recall: { a: 3 },
      get_brief: { a: 4 },
      query_frontmatter: { a: 5 },
      list_backlinks: { a: 6 },
      get_outline: { a: 7 },
      search_sections: { a: 8 },
      read_note: { a: 9 },
    });
  });

  it("Test 6: unknown verb returns verb_not_available envelope (defense-in-depth)", async () => {
    const deps = buildDeps();
    // The TS type rejects this; cast to bypass for runtime test.
    const r = await verbDispatcher("write_note" as never, {}, undefined, deps, {
      stepAlias: "x",
      timeoutSeconds: 30,
    });
    expect(r).toEqual({ ok: false, reason: "verb_not_available", verb: "write_note" });
  });

  it("Test 7: mcp:// — peer client available routes through callTool", async () => {
    const callToolSpy = vi.fn(async () => ({
      content: [{ type: "text", text: JSON.stringify({ issues: [] }) }],
    }));
    const factory: ClientFactory = async () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: { callTool: callToolSpy } as any,
      transport: { close: () => undefined },
    });
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "node" } });
    const deps = buildDeps({ peerMcpRegistry: reg });
    const r = await verbDispatcher("mcp://gh/list_issues", { repo: "x" }, undefined, deps, {
      stepAlias: "i",
      timeoutSeconds: 30,
    });
    expect(callToolSpy).toHaveBeenCalledWith({
      name: "list_issues",
      arguments: { repo: "x" },
    });
    expect(r).toEqual({ issues: [] });
  });

  it("Test 8: mcp:// — unknown peer client → mcp_client_unavailable", async () => {
    const deps = buildDeps();
    const r = await verbDispatcher("mcp://ghost/x", {}, undefined, deps, {
      stepAlias: "s",
      timeoutSeconds: 30,
    });
    expect(r).toEqual({
      ok: false,
      reason: "mcp_client_unavailable",
      verb: "mcp://ghost/x",
      client_name: "ghost",
    });
  });

  it("Test 9: mcp:// — client present but unavailable", async () => {
    const factory: ClientFactory = async () => {
      throw new Error("boot failed");
    };
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "echo" } });
    const deps = buildDeps({ peerMcpRegistry: reg });
    const r = await verbDispatcher("mcp://gh/x", {}, undefined, deps, {
      stepAlias: "s",
      timeoutSeconds: 30,
    });
    expect(r).toEqual({
      ok: false,
      reason: "mcp_client_unavailable",
      verb: "mcp://gh/x",
      client_name: "gh",
    });
  });

  it("Test 10: Q-TIMEOUT — peer-MCP verb wrapped in timeout", async () => {
    // Hang forever; the timeout must fire.
    const callToolSpy = vi.fn(() => new Promise(() => undefined));
    const factory: ClientFactory = async () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: { callTool: callToolSpy } as any,
      transport: { close: () => undefined },
    });
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "node" } });
    const deps = buildDeps({ peerMcpRegistry: reg });
    const r = await verbDispatcher("mcp://gh/slow", {}, undefined, deps, {
      stepAlias: "s",
      timeoutSeconds: 0.05,
    });
    expect(r).toEqual({
      ok: false,
      reason: "assembly_step_failed",
      step_alias: "s",
      cause: "timeout",
    });
  });

  it("Test 11: Q-TIMEOUT — baseline verbs NOT wrapped", async () => {
    // The handler completes immediately; even an absurdly small
    // timeoutSeconds must not affect the result.
    const fake = vi.fn(async () => ({ hits: [] }));
    const deps = buildDeps({ hybridSearch: fake });
    const r = await verbDispatcher("search_hybrid", { query: "x" }, undefined, deps, {
      stepAlias: "s",
      timeoutSeconds: 0.001,
    });
    expect(r).toEqual({ hits: [] });
  });

  it("Test 12: mcp:// malformed → verb_not_available (defense-in-depth)", async () => {
    const deps = buildDeps();
    const r = await verbDispatcher("mcp://onlyslashbad" as never, {}, undefined, deps, {
      stepAlias: "s",
      timeoutSeconds: 30,
    });
    expect(r).toEqual({
      ok: false,
      reason: "verb_not_available",
      verb: "mcp://onlyslashbad",
    });
  });

  it("Test 13: callMcpVerb captures non-timeout errors with the error message", async () => {
    const callToolSpy = vi.fn(async () => {
      throw new Error("upstream fail");
    });
    const factory: ClientFactory = async () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: { callTool: callToolSpy } as any,
      transport: { close: () => undefined },
    });
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "node" } });
    const deps = buildDeps({ peerMcpRegistry: reg });
    const r = await verbDispatcher("mcp://gh/x", {}, undefined, deps, {
      stepAlias: "step1",
      timeoutSeconds: 30,
    });
    expect(r).toEqual({
      ok: false,
      reason: "assembly_step_failed",
      step_alias: "step1",
      cause: "upstream fail",
    });
  });
});
