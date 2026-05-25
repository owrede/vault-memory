/**
 * Tests for refresh_source + unset_mcp_client — SOURCES-REGISTRY.md §6.
 *
 * The handlers take a minimal SourceRegistryFacade; we stub it directly
 * (no real PeerMcpRegistry, no spawned peers).
 */

import { describe, it, expect, vi } from "vitest";
import {
  refreshSourceTool,
  unsetMcpClientTool,
  type SourceRegistryFacade,
} from "./source-tools.js";

describe("refresh_source", () => {
  it("returns updated status + tool_count for a known source", async () => {
    const facade: SourceRegistryFacade = {
      refresh: vi.fn(async () => ({
        status: "connected" as const,
        tools: [{ name: "a" }, { name: "b" }],
      })),
      remove: vi.fn(() => false),
    };
    const out = await refreshSourceTool.handler({ name: "gh" }, facade);
    expect(out).toEqual({ ok: true, name: "gh", status: "connected", tool_count: 2 });
    expect(facade.refresh).toHaveBeenCalledWith("gh");
  });

  it("propagates the error field for an unreachable source", async () => {
    const facade: SourceRegistryFacade = {
      refresh: async () => ({
        status: "unreachable" as const,
        tools: [],
        error: "tools/list boom",
      }),
      remove: () => false,
    };
    const out = await refreshSourceTool.handler({ name: "gh" }, facade);
    expect(out).toEqual({
      ok: true,
      name: "gh",
      status: "unreachable",
      tool_count: 0,
      error: "tools/list boom",
    });
  });

  it("returns ok:false for an unknown source", async () => {
    const facade: SourceRegistryFacade = {
      refresh: async () => undefined,
      remove: () => false,
    };
    const out = await refreshSourceTool.handler({ name: "nope" }, facade);
    expect(out).toEqual({ ok: false, name: "nope", error: "unknown source: nope" });
  });

  it("rejects empty name at the schema level", () => {
    expect(() => refreshSourceTool.inputSchema.parse({ name: "" })).toThrow();
  });
});

describe("unset_mcp_client", () => {
  it("reports removed:true when the registry disposed a live client", async () => {
    const remove = vi.fn(() => true);
    const facade: SourceRegistryFacade = { refresh: async () => undefined, remove };
    const out = await unsetMcpClientTool.handler({ name: "gh" }, facade);
    expect(out).toEqual({ ok: true, name: "gh", removed: true });
    expect(remove).toHaveBeenCalledWith("gh");
  });

  it("reports removed:false (idempotent) when the name was unknown", async () => {
    const facade: SourceRegistryFacade = {
      refresh: async () => undefined,
      remove: () => false,
    };
    const out = await unsetMcpClientTool.handler({ name: "ghost" }, facade);
    expect(out).toEqual({ ok: true, name: "ghost", removed: false });
  });

  it("rejects empty name at the schema level", () => {
    expect(() => unsetMcpClientTool.inputSchema.parse({ name: "" })).toThrow();
  });
});
