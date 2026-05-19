/**
 * ReloadNotifier unit tests — Phase 7 / Plan 07-07 / CAN-08 / D-WATCH-SERVER-NOTIFY.
 *
 * Covers behaviors (a)–(d) from 07-07-PLAN.md Task 3:
 *   (a) start() subscribes via mcpClient.onNotification
 *   (b) a matching-path notification triggers the prompt
 *   (c) a non-matching path is silently dropped
 *   (d) stop() unsubscribes; subsequent notifications do not fire the prompt
 *
 * Stubs out the Obsidian `App` + `Modal` surface so the test runs in
 * pure-Node vitest. The real Modal class is replaced with a constructor
 * the notifier calls; we capture invocations.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReloadNotifier } from "./reload-notifier.js";

interface StubSub {
  method: string;
  handler: (params: unknown) => void;
}

class StubMcpClient {
  subs: StubSub[] = [];
  onNotification = vi.fn(
    (method: string, handler: (params: unknown) => void): (() => void) => {
      const sub: StubSub = { method, handler };
      this.subs.push(sub);
      return () => {
        this.subs = this.subs.filter((s) => s !== sub);
      };
    },
  );

  /** Drive a synthetic notification to all matching subs. */
  emit(method: string, params: unknown): void {
    for (const sub of this.subs) {
      if (sub.method === method) sub.handler(params);
    }
  }
}

/**
 * Notifier dependency: a function the notifier calls when it has
 * decided to surface an "External edit detected" prompt for a given
 * file path. Production wires this to an Obsidian Modal; tests
 * capture invocations directly.
 */
function makePromptStub() {
  return vi.fn(async (_path: string) => undefined);
}

/**
 * Source-of-truth predicate: which `.contract` paths are currently
 * open in editor views. Production walks `app.workspace`; tests
 * return a captured list.
 */
function makeOpenViewsStub(paths: string[]): () => string[] {
  return () => paths;
}

describe("ReloadNotifier (CAN-08)", () => {
  let mcp: StubMcpClient;

  beforeEach(() => {
    mcp = new StubMcpClient();
  });

  it("(a) start() subscribes to notifications/resources/updated exactly once", () => {
    const prompt = makePromptStub();
    const openViews = makeOpenViewsStub([]);
    const n = new ReloadNotifier({
      mcpClient: mcp as never,
      openContractPaths: openViews,
      promptReload: prompt,
    });
    n.start();
    expect(mcp.onNotification).toHaveBeenCalledTimes(1);
    expect(mcp.onNotification.mock.calls[0]?.[0]).toBe(
      "notifications/resources/updated",
    );
    n.stop();
  });

  it("(b) notification for an open .contract triggers the prompt with its path", () => {
    const prompt = makePromptStub();
    // The user has `meeting-prep.contract` open in a tab; its YAML
    // companion is `_contracts/meeting-prep.yaml`.
    const openViews = makeOpenViewsStub(["meeting-prep.contract"]);
    const n = new ReloadNotifier({
      mcpClient: mcp as never,
      openContractPaths: openViews,
      promptReload: prompt,
    });
    n.start();

    mcp.emit("notifications/resources/updated", {
      uri: "vault-memory://contracts/reloaded",
      _meta: { path: "_contracts/meeting-prep.yaml", reason: "external_edit" },
    });

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt.mock.calls[0]?.[0]).toBe("meeting-prep.contract");
    n.stop();
  });

  it("(c) notification for a non-open file is silently dropped", () => {
    const prompt = makePromptStub();
    const openViews = makeOpenViewsStub(["meeting-prep.contract"]);
    const n = new ReloadNotifier({
      mcpClient: mcp as never,
      openContractPaths: openViews,
      promptReload: prompt,
    });
    n.start();

    mcp.emit("notifications/resources/updated", {
      uri: "vault-memory://contracts/reloaded",
      _meta: { path: "_contracts/other-contract.yaml", reason: "external_edit" },
    });

    expect(prompt).not.toHaveBeenCalled();
    n.stop();
  });

  it("(c2) notification for an unrelated resource URI is silently dropped", () => {
    const prompt = makePromptStub();
    const openViews = makeOpenViewsStub(["meeting-prep.contract"]);
    const n = new ReloadNotifier({
      mcpClient: mcp as never,
      openContractPaths: openViews,
      promptReload: prompt,
    });
    n.start();

    // Some other resource (e.g. vault-memory://stats) updated — must
    // not fire the contract-reload prompt.
    mcp.emit("notifications/resources/updated", {
      uri: "vault-memory://stats",
      _meta: { path: "_contracts/meeting-prep.yaml" },
    });

    expect(prompt).not.toHaveBeenCalled();
    n.stop();
  });

  it("(d) stop() unsubscribes; subsequent notifications do not fire the prompt", () => {
    const prompt = makePromptStub();
    const openViews = makeOpenViewsStub(["meeting-prep.contract"]);
    const n = new ReloadNotifier({
      mcpClient: mcp as never,
      openContractPaths: openViews,
      promptReload: prompt,
    });
    n.start();
    n.stop();

    mcp.emit("notifications/resources/updated", {
      uri: "vault-memory://contracts/reloaded",
      _meta: { path: "_contracts/meeting-prep.yaml", reason: "external_edit" },
    });

    expect(prompt).not.toHaveBeenCalled();
    // No remaining subscriptions on the stub.
    expect(mcp.subs.length).toBe(0);
  });
});
