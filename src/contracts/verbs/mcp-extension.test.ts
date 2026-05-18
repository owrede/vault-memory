/**
 * Focused tests for `callMcpVerb` — Plan 06-03 Task 3.
 *
 * The integration cases (timeout, malformed verb, peer dispatch) are
 * covered in `index.test.ts` via verbDispatcher. This file pins the
 * MCP_VERB_RE regex behavior and the structured error envelopes.
 */

import { describe, it, expect, vi } from "vitest";
import { callMcpVerb } from "./mcp-extension.js";
import { PeerMcpRegistry, type ClientFactory } from "../mcp-clients.js";

describe("callMcpVerb (Q-TIMEOUT, mcp:// extension)", () => {
  it("malformed verb (no second segment) → verb_not_available", async () => {
    const reg = new PeerMcpRegistry();
    const r = await callMcpVerb("mcp://no-tool", {}, reg, {
      stepAlias: "s",
      timeoutSeconds: 30,
    });
    expect(r).toEqual({
      ok: false,
      reason: "verb_not_available",
      verb: "mcp://no-tool",
    });
  });

  it("uppercase letters rejected by regex → verb_not_available", async () => {
    const reg = new PeerMcpRegistry();
    const r = await callMcpVerb("mcp://GH/list_issues", {}, reg, {
      stepAlias: "s",
      timeoutSeconds: 30,
    });
    expect(r).toEqual({
      ok: false,
      reason: "verb_not_available",
      verb: "mcp://GH/list_issues",
    });
  });

  it("client present + available → forwards args verbatim", async () => {
    const callToolSpy = vi.fn(async () => ({
      content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
    }));
    const factory: ClientFactory = async () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: { callTool: callToolSpy } as any,
      transport: { close: () => undefined },
    });
    const reg = new PeerMcpRegistry(factory);
    await reg.start({ gh: { command: "node" } });
    const r = await callMcpVerb("mcp://gh/list_issues", { x: 1 }, reg, {
      stepAlias: "s",
      timeoutSeconds: 30,
    });
    expect(callToolSpy).toHaveBeenCalledWith({
      name: "list_issues",
      arguments: { x: 1 },
    });
    expect(r).toEqual({ ok: true });
  });
});
