/**
 * peer-mcp.test.ts — Phase 7 / Plan 07-05 / Task 1.
 *
 * Pattern F doc-block: D-PALETTE Section 5 (07-CONTEXT.md — Peer-MCP
 * section is dynamic, refreshed on plugin focus from MCP Resource
 * `vault-memory://contract-verbs`). The fetcher filters out baseline +
 * `literal` so only the dynamic peer-MCP verbs reach the palette.
 *
 * Test coverage per Plan 07-05 §Task 1 acceptance:
 *   1. Empty resource → `[]`.
 *   2. Valid peer-MCP envelope → parsed entries.
 *   3. Malformed envelope → `[]` (graceful — section is empty if no
 *      peer-MCP is configured or the resource is unreadable).
 */

import { describe, expect, it } from "vitest";
import { fetchPeerMcpVerbs } from "./peer-mcp.js";

interface StubResourceClient {
  readResource: (uri: string) => Promise<{
    contents: Array<{ text: string; mimeType?: string }>;
  }>;
}

function stubFromResource(value: unknown): StubResourceClient {
  return {
    readResource: async () => ({
      contents: [
        {
          text: JSON.stringify(value),
          mimeType: "application/json",
        },
      ],
    }),
  };
}

describe("fetchPeerMcpVerbs", () => {
  it("returns [] when the resource is empty (no custom entries)", async () => {
    const client = stubFromResource({ baseline: [], custom: [] });
    const result = await fetchPeerMcpVerbs(client);
    expect(result).toEqual([]);
  });

  it("returns peer-MCP entries parsed from a valid envelope", async () => {
    const client = stubFromResource({
      baseline: ["read_note", "search_hybrid"],
      custom: [
        {
          verb: "mcp://code-review/analyze_pr",
          declared_in: "[contracts.mcp_clients.code-review]",
          used_by_contracts: ["pr-summary"],
          invocation_count: 3,
          last_seen: 1000,
        },
        {
          verb: "mcp://docs/lookup",
          declared_in: "[contracts.mcp_clients.docs]",
          used_by_contracts: [],
          invocation_count: 0,
          last_seen: 0,
        },
      ],
    });
    const result = await fetchPeerMcpVerbs(client);
    expect(result).toHaveLength(2);
    expect(result[0]?.verb).toBe("mcp://code-review/analyze_pr");
    expect(result[0]?.server).toBe("code-review");
    expect(result[1]?.verb).toBe("mcp://docs/lookup");
    expect(result[1]?.server).toBe("docs");
  });

  it("returns [] on malformed envelope (graceful — no exception bubbles)", async () => {
    const malformed: StubResourceClient = {
      readResource: async () => ({
        contents: [{ text: "not json at all <<<>>>" }],
      }),
    };
    const result = await fetchPeerMcpVerbs(malformed);
    expect(result).toEqual([]);
  });

  it("returns [] when the readResource call throws (resource missing)", async () => {
    const throwing: StubResourceClient = {
      readResource: async () => {
        throw new Error("resource not found");
      },
    };
    const result = await fetchPeerMcpVerbs(throwing);
    expect(result).toEqual([]);
  });
});
