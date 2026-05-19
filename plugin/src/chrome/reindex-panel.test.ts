/**
 * Tests for the Reindex chrome panel controller.
 *
 * Phase 7 / 07-09 / PLG-03 / D-CHROME-REINDEX. The Svelte view
 * (`reindex-panel.svelte`) delegates to the `ReindexController` so we can
 * unit-test the behavior without a DOM. The controller owns:
 *   - generating a fresh progressToken per click
 *   - subscribing via `mcpClient.onProgress(token, handler)`
 *   - calling `mcpClient.callTool("trigger_reindex", {scope, progressToken})`
 *   - tracking `{progress, total, status, error}` state for the view
 *   - unsubscribing on completion or error
 */

import { describe, expect, it, vi } from "vitest";
import {
  createReindexController,
  type ReindexControllerDeps,
} from "./reindex-controller.js";

function makeDeps(overrides: Partial<ReindexControllerDeps> = {}): {
  deps: ReindexControllerDeps;
  callTool: ReturnType<typeof vi.fn>;
  onProgress: ReturnType<typeof vi.fn>;
  unsub: ReturnType<typeof vi.fn>;
} {
  const unsub = vi.fn();
  const onProgress = vi.fn((_token: string, _h: unknown) => unsub);
  const callTool = vi.fn(async (_name: string, _args: unknown) => ({
    ok: true,
    vaults: ["MyVault"],
  }));
  const deps: ReindexControllerDeps = {
    mcpClient: {
      callTool: callTool as unknown as ReindexControllerDeps["mcpClient"]["callTool"],
      onProgress:
        onProgress as unknown as ReindexControllerDeps["mcpClient"]["onProgress"],
    },
    newProgressToken: () => "tok-fixed-1",
    activeVault: "MyVault",
    ...overrides,
  };
  return { deps, callTool, onProgress, unsub };
}

describe("ReindexController — trigger_reindex + progress", () => {
  it("reindexThis() calls trigger_reindex with scope='this' + a fresh progressToken", async () => {
    const { deps, callTool } = makeDeps();
    const controller = createReindexController(deps);

    await controller.reindexThis();

    expect(callTool).toHaveBeenCalledTimes(1);
    const [name, args] = callTool.mock.calls[0]!;
    expect(name).toBe("trigger_reindex");
    expect(args).toMatchObject({
      scope: "this",
      progressToken: "tok-fixed-1",
      vault: "MyVault",
    });
  });

  it("reindexAll() calls trigger_reindex with scope='all'", async () => {
    const { deps, callTool } = makeDeps({ activeVault: null });
    const controller = createReindexController(deps);

    await controller.reindexAll();

    expect(callTool).toHaveBeenCalledTimes(1);
    const [name, args] = callTool.mock.calls[0]!;
    expect(name).toBe("trigger_reindex");
    expect(args).toMatchObject({ scope: "all", progressToken: "tok-fixed-1" });
    // `vault` must NOT be sent when activeVault is null.
    expect((args as Record<string, unknown>)["vault"]).toBeUndefined();
  });

  it("subscribes to onProgress with the same token used in the call args and updates state on each notification", async () => {
    const { deps, onProgress } = makeDeps();
    const controller = createReindexController(deps);

    // Fire reindexThis but capture progress handler before awaiting completion.
    let capturedHandler: ((p: number, t?: number) => void) | null = null;
    onProgress.mockImplementationOnce((token: string, h: (p: number, t?: number) => void) => {
      expect(token).toBe("tok-fixed-1");
      capturedHandler = h;
      return () => {};
    });

    const pending = controller.reindexThis();

    // Notifications arrive while the tool call is in flight.
    expect(capturedHandler).not.toBeNull();
    capturedHandler!(2, 10);
    expect(controller.getState().progress).toBe(2);
    expect(controller.getState().total).toBe(10);
    expect(controller.getState().status).toBe("running");

    capturedHandler!(7, 10);
    expect(controller.getState().progress).toBe(7);
    expect(controller.getState().total).toBe(10);

    await pending;
    expect(controller.getState().status).toBe("complete");
  });

  it("unsubscribes from onProgress when the tool call resolves", async () => {
    const { deps, unsub } = makeDeps();
    const controller = createReindexController(deps);
    await controller.reindexThis();
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe("complete");
  });

  it("surfaces an inline error message + unsubscribes when the tool call rejects", async () => {
    const { deps, unsub, callTool } = makeDeps();
    callTool.mockRejectedValueOnce(new Error("server busy"));
    const controller = createReindexController(deps);

    await controller.reindexThis();

    expect(controller.getState().status).toBe("error");
    expect(controller.getState().error).toBe("server busy");
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons while a reindex is in flight (busy=true)", async () => {
    const { deps } = makeDeps();
    let resolveCall: (v: unknown) => void = () => {};
    deps.mcpClient.callTool = vi.fn(
      () => new Promise((res) => (resolveCall = res)),
    ) as unknown as ReindexControllerDeps["mcpClient"]["callTool"];
    const controller = createReindexController(deps);

    expect(controller.getState().busy).toBe(false);
    const pending = controller.reindexThis();
    expect(controller.getState().busy).toBe(true);

    resolveCall({ ok: true, vaults: ["MyVault"] });
    await pending;
    expect(controller.getState().busy).toBe(false);
  });

  it("disables 'this vault' when activeVault is null (canReindexThis === false)", () => {
    const { deps } = makeDeps({ activeVault: null });
    const controller = createReindexController(deps);
    expect(controller.getState().canReindexThis).toBe(false);
  });
});
