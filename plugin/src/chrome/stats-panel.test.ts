/**
 * Tests for the Stats chrome panel controller.
 *
 * Phase 7 / 07-09 / PLG-04 / D-CHROME-STATS. Like the reindex panel,
 * the Svelte view delegates to a pure-TS controller so we can unit-test
 * the get_runtime_stats fetch behavior without a DOM. The controller
 * owns:
 *   - on-mount fetch + state.{loading, stats, error}
 *   - refresh() that re-fetches
 *   - error path that does not throw and surfaces inline message
 *   - field-by-field stats payload exposed as `state.stats`
 *
 * Rendering of the stats grid (which fields, mono font, dot colors) is
 * verified by the svelte source acceptance grep; the controller-level
 * tests verify the wire shape.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createStatsController,
  type StatsControllerDeps,
  type RuntimeStats,
} from "./stats-controller.js";

const SAMPLE: RuntimeStats = {
  vault: "MyVault",
  notes: 1234,
  chunks: 5678,
  last_index_at: 1735000000000,
  embedding_model: "bge-m3",
  embedding_dim: 1024,
  audit_log_by_kind: { write: 12, delete: 1, contract_step: 4 },
  peer_mcp_status: [{ name: "code-review", available: true }],
  contract_count: 7,
};

function makeDeps(overrides: Partial<StatsControllerDeps> = {}): {
  deps: StatsControllerDeps;
  callTool: ReturnType<typeof vi.fn>;
} {
  const callTool = vi.fn(async (_name: string, _args: unknown) => SAMPLE);
  const deps: StatsControllerDeps = {
    mcpClient: {
      callTool: callTool as unknown as StatsControllerDeps["mcpClient"]["callTool"],
    },
    activeVault: "MyVault",
    ...overrides,
  };
  return { deps, callTool };
}

describe("StatsController — get_runtime_stats fetch", () => {
  it("calls get_runtime_stats with {vault: activeVault} on first load", async () => {
    const { deps, callTool } = makeDeps();
    const controller = createStatsController(deps);
    await controller.refresh();

    expect(callTool).toHaveBeenCalledTimes(1);
    const [name, args] = callTool.mock.calls[0]!;
    expect(name).toBe("get_runtime_stats");
    expect(args).toEqual({ vault: "MyVault" });
  });

  it("omits the `vault` arg when activeVault is null", async () => {
    const { deps, callTool } = makeDeps({ activeVault: null });
    const controller = createStatsController(deps);
    await controller.refresh();

    const [, args] = callTool.mock.calls[0]!;
    expect((args as Record<string, unknown>)["vault"]).toBeUndefined();
  });

  it("populates state.stats with every field from the payload", async () => {
    const { deps } = makeDeps();
    const controller = createStatsController(deps);
    await controller.refresh();

    const s = controller.getState();
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
    expect(s.stats).toEqual(SAMPLE);
  });

  it("refresh() re-invokes get_runtime_stats on every call", async () => {
    const { deps, callTool } = makeDeps();
    const controller = createStatsController(deps);
    await controller.refresh();
    await controller.refresh();
    await controller.refresh();
    expect(callTool).toHaveBeenCalledTimes(3);
  });

  it("error path does NOT throw — records the message in state.error and clears state.stats", async () => {
    const { deps, callTool } = makeDeps();
    callTool.mockRejectedValueOnce(new Error("server unreachable"));
    const controller = createStatsController(deps);

    await expect(controller.refresh()).resolves.toBeUndefined();
    const s = controller.getState();
    expect(s.loading).toBe(false);
    expect(s.error).toBe("server unreachable");
    expect(s.stats).toBeNull();
  });

  it("sets loading=true while a fetch is in flight, then loading=false on resolve", async () => {
    const { deps } = makeDeps();
    let resolveFn: (v: RuntimeStats) => void = () => {};
    deps.mcpClient.callTool = vi.fn(
      () => new Promise((res) => (resolveFn = res)),
    ) as unknown as StatsControllerDeps["mcpClient"]["callTool"];
    const controller = createStatsController(deps);
    expect(controller.getState().loading).toBe(false);
    const pending = controller.refresh();
    expect(controller.getState().loading).toBe(true);
    resolveFn(SAMPLE);
    await pending;
    expect(controller.getState().loading).toBe(false);
  });

  it("peer_mcp_status entries with available=true / false flow through verbatim (view renders green/red dot)", async () => {
    const payload: RuntimeStats = {
      ...SAMPLE,
      peer_mcp_status: [
        { name: "ok-client", available: true },
        { name: "fail-client", available: false },
      ],
    };
    const { deps, callTool } = makeDeps();
    callTool.mockResolvedValueOnce(payload);
    const controller = createStatsController(deps);
    await controller.refresh();
    const peers = controller.getState().stats?.peer_mcp_status ?? [];
    expect(peers).toHaveLength(2);
    expect(peers[0]?.available).toBe(true);
    expect(peers[1]?.available).toBe(false);
  });
});
