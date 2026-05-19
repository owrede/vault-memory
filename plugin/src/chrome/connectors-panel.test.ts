/**
 * Tests for the Connectors chrome panel.
 *
 * Phase 7 / 07-10 / PLG-05 / D-CHROME-CONNECTORS.
 *
 * The Svelte view delegates to `ConnectorsController` so we can unit-test
 * behavior without a DOM (same Pattern F as reindex-panel.test.ts +
 * stats-panel.test.ts). The controller owns:
 *   - fetching the connector inventory via `set_mcp_client({list: true})`
 *   - calling `set_mcp_client({name, command, args, env_secrets})` to add
 *   - calling `set_mcp_client({name, remove: true})` to remove
 *   - calling `set_mcp_client({name, test: true})` to test
 *   - routing `${secret:name}` resolution through resolveConnectorSecrets
 *     BEFORE the add call so plaintext is registered server-side via the
 *     resolve_secret tool
 *   - surfacing a re-enter prompt on safe_storage_unavailable (no plugin-
 *     side plaintext-fallback path per CONTEXT D-CHROME-SECRETS)
 *
 * The Svelte source itself is checked via grep assertions over the file
 * contents (test cases at bottom of this file) — those assertions are the
 * static-source equivalent of the verify-step grep checks in PLAN.md.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createConnectorsController,
  type ConnectorsControllerDeps,
} from "./connectors-controller.js";

const here = fileURLToPath(new URL(".", import.meta.url));

function makeDeps(
  overrides: Partial<{
    listResp: unknown;
    setResp: unknown;
    testResp: unknown;
    callToolImpl: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<unknown>;
    ciphertexts: Record<string, string>;
    decrypt: (ct: string) => string;
  }> = {},
): {
  deps: ConnectorsControllerDeps;
  callTool: ReturnType<typeof vi.fn>;
} {
  const listResp = overrides.listResp ?? {
    ok: true,
    clients: [
      {
        name: "tavily",
        command: "tavily-mcp",
        args: ["--port", "9099"],
        env_secrets: ["api_key"],
        status: "untested" as const,
      },
    ],
  };
  const setResp = overrides.setResp ?? { ok: true, name: "x", action: "added" };
  const testResp = overrides.testResp ?? { ok: true };
  const ciphertexts = overrides.ciphertexts ?? { api_key: "ct-of-api_key" };
  const decrypt =
    overrides.decrypt ?? ((ct: string) => `plain-of-${ct}`);

  const callTool = vi.fn(
    overrides.callToolImpl ??
      (async (name: string, args: Record<string, unknown>) => {
        if (name === "set_mcp_client" && args["list"] === true) return listResp;
        if (name === "set_mcp_client" && args["test"] === true) return testResp;
        if (name === "set_mcp_client" && args["remove"] === true) {
          return { ok: true, name: args["name"], action: "removed" };
        }
        if (name === "set_mcp_client") return setResp;
        if (name === "resolve_secret") {
          return { ok: true, plaintext: args["ciphertext"] };
        }
        return {};
      }),
  );

  const deps: ConnectorsControllerDeps = {
    mcpClient: {
      callTool: callTool as unknown as ConnectorsControllerDeps["mcpClient"]["callTool"],
    },
    secretsStore: {
      getCiphertext: (name: string) => ciphertexts[name],
    },
    safeStorage: {
      decrypt,
    },
  };
  return { deps, callTool };
}

describe("ConnectorsController — inventory listing via set_mcp_client({list: true})", () => {
  it("refresh() reads the inventory via the 07-04 list-variant and populates entries", async () => {
    const { deps, callTool } = makeDeps();
    const controller = createConnectorsController(deps);
    await controller.refresh();

    // Inventory call shape — discriminated-union list variant.
    expect(callTool).toHaveBeenCalledWith("set_mcp_client", { list: true });
    const state = controller.getState();
    expect(state.loading).toBe(false);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({
      name: "tavily",
      command: "tavily-mcp",
      env_secrets: ["api_key"],
    });
  });

  it("refresh() surfaces loadError when the call rejects (no entries populated)", async () => {
    const { deps } = makeDeps({
      callToolImpl: async () => {
        throw new Error("EPIPE: server crashed");
      },
    });
    const controller = createConnectorsController(deps);
    await controller.refresh();

    const state = controller.getState();
    expect(state.loadError).toContain("EPIPE");
    expect(state.entries).toHaveLength(0);
  });
});

describe("ConnectorsController — addConnector wires set_mcp_client", () => {
  it("addConnector() resolves ${secret:name} refs via safeStorage + resolve_secret BEFORE issuing set_mcp_client", async () => {
    const { deps, callTool } = makeDeps();
    const controller = createConnectorsController(deps);

    await controller.addConnector({
      name: "tavily",
      command: "tavily-mcp",
      args: ["--port", "9099"],
      envSecrets: { TAVILY_API_KEY: "${secret:api_key}" },
    });

    // The resolve_secret call must happen with the plaintext-of-this-call.
    // (The resolver passes `plaintext` in the `ciphertext` field for
    // provenance — see 07-04 contract.)
    expect(callTool).toHaveBeenCalledWith("resolve_secret", {
      name: "api_key",
      ciphertext: "plain-of-ct-of-api_key",
    });

    // set_mcp_client (add/update variant) MUST be called with the
    // RESOLVED env_secrets map — no placeholder leaks through.
    const setCall = callTool.mock.calls.find(
      (c) =>
        c[0] === "set_mcp_client" &&
        typeof c[1] === "object" &&
        c[1] !== null &&
        !("list" in (c[1] as Record<string, unknown>)) &&
        !("remove" in (c[1] as Record<string, unknown>)) &&
        !("test" in (c[1] as Record<string, unknown>)),
    );
    expect(setCall).toBeDefined();
    expect(setCall![1]).toMatchObject({
      name: "tavily",
      command: "tavily-mcp",
      args: ["--port", "9099"],
      env_secrets: { TAVILY_API_KEY: "plain-of-ct-of-api_key" },
    });

    // Refresh fires automatically after add → list call count >= 1 with {list: true}.
    expect(
      callTool.mock.calls.filter(
        (c) => c[0] === "set_mcp_client" && (c[1] as Record<string, unknown>)?.["list"] === true,
      ).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("addConnector() routes safe_storage_unavailable to the re-enter prompt (no plaintext-fallback path)", async () => {
    const { deps, callTool } = makeDeps({
      decrypt: () => {
        // Simulates Electron safeStorage failure on a second sync'd device.
        throw new Error("DecryptFailedError: backend mismatch");
      },
    });
    const controller = createConnectorsController(deps);

    await controller.addConnector({
      name: "tavily",
      command: "tavily-mcp",
      args: [],
      envSecrets: { TAVILY_API_KEY: "${secret:api_key}" },
    });

    const state = controller.getState();
    expect(state.reEnterPrompt).toMatchObject({
      secretName: "api_key",
      reason: "safe_storage_unavailable",
    });
    // set_mcp_client add-variant must NOT have been called — the resolution
    // aborted, so no connector was written.
    const setAdds = callTool.mock.calls.filter(
      (c) =>
        c[0] === "set_mcp_client" &&
        typeof c[1] === "object" &&
        c[1] !== null &&
        "command" in (c[1] as Record<string, unknown>),
    );
    expect(setAdds).toHaveLength(0);
  });

  it("addConnector() routes secret_not_found to the re-enter prompt with the missing name", async () => {
    const { deps } = makeDeps({ ciphertexts: {} });
    const controller = createConnectorsController(deps);
    await controller.addConnector({
      name: "tavily",
      command: "tavily-mcp",
      args: [],
      envSecrets: { TAVILY_API_KEY: "${secret:missing}" },
    });

    const state = controller.getState();
    expect(state.reEnterPrompt).toMatchObject({
      secretName: "missing",
      reason: "secret_not_found",
    });
  });
});

describe("ConnectorsController — removeConnector + testConnector", () => {
  it("removeConnector() calls set_mcp_client with {name, remove: true}", async () => {
    const { deps, callTool } = makeDeps();
    const controller = createConnectorsController(deps);
    await controller.removeConnector("tavily");

    expect(callTool).toHaveBeenCalledWith("set_mcp_client", {
      name: "tavily",
      remove: true,
    });
  });

  it("testConnector() calls set_mcp_client with {name, test: true} and records green badge on ok:true", async () => {
    const { deps, callTool } = makeDeps();
    const controller = createConnectorsController(deps);
    await controller.testConnector("tavily");

    expect(callTool).toHaveBeenCalledWith("set_mcp_client", {
      name: "tavily",
      test: true,
    });
    const state = controller.getState();
    expect(state.testResults["tavily"]).toMatchObject({ ok: true });
  });

  it("testConnector() records red badge with error message on ok:false", async () => {
    const { deps } = makeDeps({
      testResp: { ok: false, error: "Connection refused" },
    });
    const controller = createConnectorsController(deps);
    await controller.testConnector("tavily");

    const state = controller.getState();
    expect(state.testResults["tavily"]).toMatchObject({
      ok: false,
      error: "Connection refused",
    });
  });
});

describe("ConnectorsController — re-enter prompt dismissal", () => {
  it("dismissReEnterPrompt() clears the prompt without re-invoking add", () => {
    const { deps, callTool } = makeDeps();
    const controller = createConnectorsController(deps);
    // Simulate prompt state via a failed add path first.
    return (async () => {
      // Make ciphertexts missing to force secret_not_found.
      controller.getState();
      callTool.mockClear();
      // Manually go through addConnector with a missing secret to flip state.
      // Switch deps under the hood is not needed — re-use a fresh controller.
      const dep2 = makeDeps({ ciphertexts: {} });
      const c2 = createConnectorsController(dep2.deps);
      await c2.addConnector({
        name: "x",
        command: "x",
        args: [],
        envSecrets: { K: "${secret:missing}" },
      });
      expect(c2.getState().reEnterPrompt).not.toBeNull();
      c2.dismissReEnterPrompt();
      expect(c2.getState().reEnterPrompt).toBeNull();
    })();
  });
});

/**
 * Static-source assertions over the Svelte view. These mirror the
 * `grep -n` checks in `<verification>` of 07-10-PLAN.md and the
 * Task 2 acceptance criteria — the test runner enforces them so a
 * future refactor cannot silently drop the required surface.
 */
describe("connectors-panel.svelte — required surface (static)", () => {
  const svelteSource = readFileSync(
    `${here}connectors-panel.svelte`,
    "utf-8",
  );

  it("contains the literal `set_mcp_client` tool name", () => {
    expect(svelteSource).toContain("set_mcp_client");
  });

  it("contains the `list: true` inventory-read variant call site", () => {
    // The panel delegates the call to the controller; the controller
    // file MUST also contain `list: true`. The Svelte view typically
    // mounts the controller and may reference list:true via the
    // controller's refresh() — so accept either source as the host.
    const controllerSource = readFileSync(
      `${here}connectors-controller.ts`,
      "utf-8",
    );
    const combined = svelteSource + controllerSource;
    expect(combined).toContain("list: true");
  });

  it("contains a `${secret:` literal reference (the env-secret placeholder helper)", () => {
    expect(svelteSource).toContain("${secret:");
  });
});
