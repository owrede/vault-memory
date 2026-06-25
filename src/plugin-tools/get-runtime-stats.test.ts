/**
 * Unit tests for `get_runtime_stats` MCP tool (PLG-04).
 *
 * Returns per-vault stats aggregation for the chrome stats panel:
 *   - notes count
 *   - chunks count
 *   - last_index_at (epoch ms or null)
 *   - embedding model + dim
 *   - audit_log_by_kind (write op → count)
 *   - peer_mcp_status (array)
 *   - contract_count
 */

import { describe, it, expect } from "vitest";
import { getRuntimeStatsTool } from "./get-runtime-stats.js";

interface FakeAudit {
  listRuns: (limit: number) => Array<{
    run_id: string;
    started_at: number;
    finished_at: number | null;
  }>;
  listWrites: (filter: { limit?: number }) => Array<{ op: string }>;
}

interface FakeVault {
  config: { name: string; embedding_model?: string };
  db: {
    notes: { countAll: () => number };
    audit: FakeAudit;
    models: {
      getActive: () => { name: string; dim: number } | null;
    };
    handle: { prepare: <T>(sql: string) => { get: (...args: unknown[]) => T } };
  };
}

function makeFakeVault(overrides?: Partial<FakeVault>): FakeVault {
  const base: FakeVault = {
    config: { name: "atlas", embedding_model: "qwen3-embedding" },
    db: {
      notes: { countAll: () => 42 },
      audit: {
        listRuns: () => [{ run_id: "r1", started_at: 1700000000000, finished_at: 1700000060000 }],
        listWrites: () => [{ op: "create" }, { op: "create" }, { op: "update" }],
      },
      models: {
        getActive: () => ({ name: "qwen3-embedding", dim: 1024 }),
      },
      handle: {
        prepare: <T>(_sql: string) => ({
          // count(*) FROM chunks
          get: (..._args: unknown[]) => ({ c: 137 }) as unknown as T,
        }),
      },
    },
  };
  return { ...base, ...overrides };
}

describe("get_runtime_stats tool (PLG-04)", () => {
  it("declares the expected MCP tool surface", () => {
    expect(getRuntimeStatsTool.name).toBe("get_runtime_stats");
    expect(typeof getRuntimeStatsTool.description).toBe("string");
    expect(getRuntimeStatsTool.inputSchema).toBeDefined();
  });

  it("happy path: returns full stats for the active vault", async () => {
    const vault = makeFakeVault();
    const result = await getRuntimeStatsTool.handler(
      {},
      {
        listVaults: () => [
          vault as unknown as Parameters<
            typeof getRuntimeStatsTool.handler
          >[1]["listVaults"] extends () => infer R
            ? R[number]
            : never,
        ],
        peerMcpStatus: () => [{ name: "gh", available: true }],
        contractCountFor: (name: string) => (name === "atlas" ? 3 : 0),
      },
    );
    expect(result).toMatchObject({
      vault: "atlas",
      notes: 42,
      chunks: 137,
      last_index_at: 1700000060000,
      embedding_model: "qwen3-embedding",
      embedding_dim: 1024,
      audit_log_by_kind: { create: 2, update: 1 },
      peer_mcp_status: [{ name: "gh", available: true }],
      contract_count: 3,
    });
  });

  it("returns last_index_at = null when no run has finished", async () => {
    const vault = makeFakeVault();
    vault.db.audit.listRuns = () => [
      { run_id: "r1", started_at: 1700000000000, finished_at: null },
    ];
    const result = await getRuntimeStatsTool.handler(
      {},
      {
        listVaults: () => [vault as never],
        peerMcpStatus: () => [],
        contractCountFor: () => 0,
      },
    );
    expect(result).toMatchObject({ last_index_at: null });
  });

  it("vault arg overrides default — returns stats for the named vault", async () => {
    const atlas = makeFakeVault();
    const beta = makeFakeVault({
      config: { name: "beta", embedding_model: "qwen3-embedding" },
    });
    beta.db.notes.countAll = () => 7;
    const result = await getRuntimeStatsTool.handler(
      { vault: "beta" },
      {
        listVaults: () => [atlas as never, beta as never],
        peerMcpStatus: () => [],
        contractCountFor: () => 0,
      },
    );
    expect(result).toMatchObject({ vault: "beta", notes: 7 });
  });

  it("returns unknown_vault when the named vault is missing", async () => {
    const result = await getRuntimeStatsTool.handler(
      { vault: "ghost" },
      {
        listVaults: () => [],
        peerMcpStatus: () => [],
        contractCountFor: () => 0,
      },
    );
    expect(result).toEqual({ ok: false, reason: "unknown_vault", vault: "ghost" });
  });

  it("Zod accepts an empty input (vault is optional)", () => {
    const parsed = getRuntimeStatsTool.inputSchema.safeParse({});
    expect(parsed.success).toBe(true);
  });

  it("Zod rejects non-string vault", () => {
    const parsed = getRuntimeStatsTool.inputSchema.safeParse({ vault: 42 });
    expect(parsed.success).toBe(false);
  });
});
