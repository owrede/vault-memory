/**
 * Unit tests for `trigger_reindex` MCP tool (PLG-03).
 *
 * Input: {scope: "this" | "all", vault?: string, progressToken?: string}
 * Output: {ok: true, vaults: string[]} after all triggered vaults finish.
 *
 * When `progressToken` is set, the handler emits `notifications/progress`
 * via the injected notifier. We exercise that path with a fake notifier
 * and assert progressToken propagation.
 */

import { describe, it, expect, vi } from "vitest";
import { triggerReindexTool } from "./trigger-reindex.js";

interface FakeVault {
  config: { name: string };
}

describe("trigger_reindex tool (PLG-03)", () => {
  it("declares the expected MCP tool surface", () => {
    expect(triggerReindexTool.name).toBe("trigger_reindex");
    expect(typeof triggerReindexTool.description).toBe("string");
    expect(triggerReindexTool.inputSchema).toBeDefined();
  });

  it("scope='this' + vault arg: reindexes ONE vault", async () => {
    const reindex = vi.fn().mockResolvedValue(undefined);
    const result = await triggerReindexTool.handler(
      { scope: "this", vault: "atlas" },
      {
        listVaults: () =>
          [
            { config: { name: "atlas" } } as FakeVault,
            { config: { name: "beta" } } as FakeVault,
          ] as never,
        reindexVault: reindex,
        notifier: vi.fn(),
      },
    );
    expect(result).toEqual({ ok: true, vaults: ["atlas"] });
    expect(reindex).toHaveBeenCalledTimes(1);
    // Without progressToken, onProgress is undefined (matches CLI behavior).
    expect(reindex).toHaveBeenCalledWith("atlas", undefined);
  });

  it("scope='all': reindexes EVERY vault", async () => {
    const reindex = vi.fn().mockResolvedValue(undefined);
    const result = await triggerReindexTool.handler(
      { scope: "all" },
      {
        listVaults: () =>
          [
            { config: { name: "atlas" } } as FakeVault,
            { config: { name: "beta" } } as FakeVault,
          ] as never,
        reindexVault: reindex,
        notifier: vi.fn(),
      },
    );
    expect(result).toEqual({ ok: true, vaults: ["atlas", "beta"] });
    expect(reindex).toHaveBeenCalledTimes(2);
  });

  it("unknown vault returns structured error", async () => {
    const result = await triggerReindexTool.handler(
      { scope: "this", vault: "ghost" },
      {
        listVaults: () => [],
        reindexVault: vi.fn(),
        notifier: vi.fn(),
      },
    );
    expect(result).toEqual({ ok: false, reason: "unknown_vault", vault: "ghost" });
  });

  it("scope='this' without vault, with only one vault: defaults to that vault", async () => {
    const reindex = vi.fn().mockResolvedValue(undefined);
    const result = await triggerReindexTool.handler(
      { scope: "this" },
      {
        listVaults: () => [{ config: { name: "atlas" } } as FakeVault] as never,
        reindexVault: reindex,
        notifier: vi.fn(),
      },
    );
    expect(result).toEqual({ ok: true, vaults: ["atlas"] });
  });

  it("scope='this' without vault, with multiple vaults: returns ambiguous_vault", async () => {
    const result = await triggerReindexTool.handler(
      { scope: "this" },
      {
        listVaults: () =>
          [
            { config: { name: "atlas" } } as FakeVault,
            { config: { name: "beta" } } as FakeVault,
          ] as never,
        reindexVault: vi.fn(),
        notifier: vi.fn(),
      },
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "ambiguous_vault",
      available_vaults: ["atlas", "beta"],
    });
  });

  it("progressToken: notifier receives notifications/progress with token", async () => {
    const notifier = vi.fn();
    await triggerReindexTool.handler(
      { scope: "this", vault: "atlas", progressToken: "tok-1" },
      {
        listVaults: () => [{ config: { name: "atlas" } } as FakeVault] as never,
        reindexVault: async (_name, onProgress) => {
          onProgress?.({ progress: 1, total: 10 });
          onProgress?.({ progress: 5, total: 10 });
        },
        notifier,
      },
    );
    // notifier called at least once per onProgress event
    expect(notifier).toHaveBeenCalledTimes(2);
    expect(notifier).toHaveBeenNthCalledWith(1, {
      method: "notifications/progress",
      params: { progressToken: "tok-1", progress: 1, total: 10 },
    });
  });

  it("Zod rejects invalid scope", () => {
    const parsed = triggerReindexTool.inputSchema.safeParse({ scope: "some" });
    expect(parsed.success).toBe(false);
  });

  it("Zod rejects missing scope", () => {
    const parsed = triggerReindexTool.inputSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });
});
