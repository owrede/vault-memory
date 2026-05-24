/**
 * sources-controller.test.ts — unit tests for the Sources curation logic.
 *
 * Spec: .planning/specs/SOURCES-REGISTRY.md §7 (default-on semantics).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createSourcesController,
  type EnabledToolsPort,
  type SourcesController,
} from "./sources-controller.js";

function makeStubClient(opts: {
  list?: { ok: boolean; clients?: unknown[] };
  listThrows?: unknown;
  resource?: unknown;
  resourceThrows?: unknown;
}): {
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  readResource: (uri: string) => Promise<{ contents: Array<{ text?: string }> }>;
  callCount: number;
  readCount: number;
} {
  let callCount = 0;
  let readCount = 0;
  return {
    async callTool(name: string, _args: Record<string, unknown>) {
      callCount++;
      if (opts.listThrows !== undefined) throw opts.listThrows;
      if (name === "set_mcp_client") return opts.list ?? { ok: true, clients: [] };
      return {};
    },
    async readResource(_uri: string) {
      readCount++;
      if (opts.resourceThrows !== undefined) throw opts.resourceThrows;
      return {
        contents: [{ text: JSON.stringify(opts.resource ?? { custom: [] }) }],
      };
    },
    get callCount() {
      return callCount;
    },
    get readCount() {
      return readCount;
    },
  };
}

function makeStubEnabledTools(initial: Record<string, string[]> = {}): EnabledToolsPort & {
  snapshot(): Record<string, readonly string[]>;
} {
  let map: Record<string, string[]> = { ...initial };
  return {
    get() {
      return map;
    },
    async setForSource(source, tools) {
      if (tools === null) {
        const next = { ...map };
        delete next[source];
        map = next;
      } else {
        map = { ...map, [source]: [...tools] };
      }
    },
    snapshot() {
      return map;
    },
  };
}

describe("createSourcesController", () => {
  let ctrl: SourcesController;
  let enabled: ReturnType<typeof makeStubEnabledTools>;

  beforeEach(() => {
    enabled = makeStubEnabledTools();
  });

  it("refresh() populates state.sources from set_mcp_client list response", async () => {
    const client = makeStubClient({
      list: {
        ok: true,
        clients: [
          { name: "github", command: "gh-mcp", args: [], status: "connected" },
          { name: "notion", command: "notion-mcp", args: ["--root", "/"], status: "untested" },
        ],
      },
    });
    ctrl = createSourcesController({ mcpClient: client, enabledTools: enabled, vaultName: "v" });
    await ctrl.refresh();
    expect(ctrl.getState().sources).toHaveLength(2);
    expect(ctrl.getState().sources[0]?.name).toBe("github");
    expect(ctrl.getState().loading).toBe(false);
    expect(ctrl.getState().loadError).toBeNull();
  });

  it("refresh() surfaces friendly error when plugin tools gate is closed", async () => {
    const client = makeStubClient({
      listThrows: new Error("MCP error -32601: Method not found"),
    });
    ctrl = createSourcesController({ mcpClient: client, enabledTools: enabled, vaultName: "v" });
    await ctrl.refresh();
    expect(ctrl.getState().sources).toEqual([]);
    expect(ctrl.getState().loadError).toContain("[plugin] enabled = true");
  });

  it("loadToolsFor() parses contract-verbs custom[] and filters by source", async () => {
    const client = makeStubClient({
      resource: {
        baseline: ["search_hybrid"],
        custom: [
          { verb: "mcp://github/list_issues", description: "List issues", invocation_count: 5 },
          { verb: "mcp://github/create_pr", invocation_count: 1 },
          { verb: "mcp://notion/search", invocation_count: 10 },
        ],
      },
    });
    ctrl = createSourcesController({ mcpClient: client, enabledTools: enabled, vaultName: "v" });
    await ctrl.loadToolsFor("github");
    const tools = ctrl.getState().toolsBySource["github"];
    expect(tools).toBeDefined();
    expect(tools).toHaveLength(2);
    expect(tools?.[0]?.name).toBe("list_issues");
    expect(tools?.[0]?.invocationCount).toBe(5);
    expect(tools?.[1]?.name).toBe("create_pr");
  });

  it("loadToolsFor() sorts tools by invocation count desc, then name asc", async () => {
    const client = makeStubClient({
      resource: {
        custom: [
          { verb: "mcp://gh/zebra", invocation_count: 1 },
          { verb: "mcp://gh/alpha", invocation_count: 1 },
          { verb: "mcp://gh/beta", invocation_count: 10 },
        ],
      },
    });
    ctrl = createSourcesController({ mcpClient: client, enabledTools: enabled, vaultName: "v" });
    await ctrl.loadToolsFor("gh");
    const tools = ctrl.getState().toolsBySource["gh"];
    expect(tools?.map((t) => t.name)).toEqual(["beta", "alpha", "zebra"]);
  });

  it("loadToolsFor() records error state on parse failure", async () => {
    const client = {
      callTool: async () => ({}),
      readResource: async () => ({ contents: [{ text: "not-json" }] }),
    };
    ctrl = createSourcesController({ mcpClient: client, enabledTools: enabled, vaultName: "v" });
    await ctrl.loadToolsFor("gh");
    const status = ctrl.getState().toolsStatusBySource["gh"];
    expect(status?.kind).toBe("error");
  });

  it("loadToolsFor() is idempotent — skips loaded sources", async () => {
    const client = makeStubClient({
      resource: { custom: [{ verb: "mcp://gh/foo", invocation_count: 1 }] },
    });
    ctrl = createSourcesController({ mcpClient: client, enabledTools: enabled, vaultName: "v" });
    await ctrl.loadToolsFor("gh");
    await ctrl.loadToolsFor("gh");
    expect(client.readCount).toBe(1);
  });

  describe("curation (default-on semantics)", () => {
    it("isToolEnabled() returns true for a source with no curation entry", () => {
      ctrl = createSourcesController({
        mcpClient: makeStubClient({}),
        enabledTools: enabled,
        vaultName: "v",
      });
      expect(ctrl.isToolEnabled("anywhere", "anything")).toBe(true);
    });

    it("isToolEnabled() returns false when source entry exists and tool is absent", () => {
      enabled = makeStubEnabledTools({ github: ["list_issues"] });
      ctrl = createSourcesController({
        mcpClient: makeStubClient({}),
        enabledTools: enabled,
        vaultName: "v",
      });
      expect(ctrl.isToolEnabled("github", "list_issues")).toBe(true);
      expect(ctrl.isToolEnabled("github", "delete_repo")).toBe(false);
    });

    it("setToolEnabled(false) materialises the full set then drops the tool", async () => {
      // First curation for a fresh source — controller needs to know the
      // full tool set so the post-state means "everything except this one".
      const client = makeStubClient({
        resource: {
          custom: [
            { verb: "mcp://gh/a", invocation_count: 1 },
            { verb: "mcp://gh/b", invocation_count: 1 },
            { verb: "mcp://gh/c", invocation_count: 1 },
          ],
        },
      });
      ctrl = createSourcesController({ mcpClient: client, enabledTools: enabled, vaultName: "v" });
      await ctrl.loadToolsFor("gh");
      await ctrl.setToolEnabled("gh", "b", false);
      const persisted = enabled.snapshot()["gh"];
      expect(persisted).toBeDefined();
      expect([...(persisted ?? [])].sort()).toEqual(["a", "c"]);
      expect(ctrl.isToolEnabled("gh", "a")).toBe(true);
      expect(ctrl.isToolEnabled("gh", "b")).toBe(false);
    });

    it("setToolEnabled(true) on an already-curated source re-adds the tool", async () => {
      enabled = makeStubEnabledTools({ gh: ["a"] });
      ctrl = createSourcesController({
        mcpClient: makeStubClient({}),
        enabledTools: enabled,
        vaultName: "v",
      });
      await ctrl.setToolEnabled("gh", "b", true);
      const persisted = enabled.snapshot()["gh"];
      expect([...(persisted ?? [])].sort()).toEqual(["a", "b"]);
    });

    it("setToolEnabled(false) on an already-curated source removes only that tool", async () => {
      enabled = makeStubEnabledTools({ gh: ["a", "b", "c"] });
      ctrl = createSourcesController({
        mcpClient: makeStubClient({}),
        enabledTools: enabled,
        vaultName: "v",
      });
      await ctrl.setToolEnabled("gh", "b", false);
      const persisted = enabled.snapshot()["gh"];
      expect([...(persisted ?? [])].sort()).toEqual(["a", "c"]);
    });

    it("subscribe() re-emits after curation change so views re-render", async () => {
      enabled = makeStubEnabledTools({ gh: ["a"] });
      ctrl = createSourcesController({
        mcpClient: makeStubClient({}),
        enabledTools: enabled,
        vaultName: "v",
      });
      let emitCount = 0;
      ctrl.subscribe(() => {
        emitCount++;
      });
      await ctrl.setToolEnabled("gh", "b", true);
      expect(emitCount).toBeGreaterThan(0);
    });
  });
});
