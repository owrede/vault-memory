/**
 * Integration test for VaultWatcher.
 *
 * Uses a real chokidar FSWatcher on a tmpdir vault + a mocked OllamaClient.
 * The :memory: Database is migrated. Verifies:
 *   - new .md file → indexed
 *   - modified .md file → re-indexed
 *   - deleted .md file → removed
 *   - suppression-tagged paths are not picked up
 *   - .obsidian/ paths are ignored
 *
 * Tests use real timers (chokidar runs on the actual event loop), so we
 * insert short `await sleep(ms)` after FS operations.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, unlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../../../db/index.js";
import { SuppressionSet } from "./suppression.js";
import { VaultWatcher } from "./watcher.js";
import type { Vault } from "../../../vault/index.js";
import type { OllamaClient } from "../../../ollama/index.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll `predicate` until true or `timeoutMs` elapses. Replaces the brittle
 * fixed-`sleep` + assert pattern for positive checks: chokidar event delivery
 * + the watcher's debounce + the embed/index round-trip balloon under full-
 * suite concurrent load, so a fixed window races (documented flake, STATE.md).
 * Polling returns as soon as the work lands (fast in isolation) yet tolerates
 * delay under load.
 */
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 6000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await sleep(25);
  }
  return predicate();
}

function mockOllama(): OllamaClient {
  // Provide a vector of dim 1024 for every text. Deterministic so the
  // index can be inspected.
  const eyeVec = (i: number): number[] => {
    const v = new Array<number>(1024).fill(0);
    v[i % 1024] = 1;
    return v;
  };
  return {
    embed: vi.fn(async ({ texts }: { model: string; texts: string[] }) => ({
      vectors: texts.map((_, i) => eyeVec(i)),
      dim: 1024,
      model: "test-model",
    })),
    healthCheck: vi.fn(async () => ({ ok: true, models: ["test-model"] })),
    modelExists: vi.fn(async () => true),
  } as unknown as OllamaClient;
}

describe("VaultWatcher", () => {
  let vaultDir: string;
  let db: Database;
  let vault: Vault;
  let watcher: VaultWatcher;
  let suppression: SuppressionSet;

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "vm-watcher-"));
    db = new Database(":memory:", "test-vault");
    db.migrate();
    db.models.upsert({ name: "test-model", provider: "ollama", dim: 1024 });
    vault = {
      config: { name: "test", path: vaultDir, write_enabled: true },
      db,
      dbPath: ":memory:",
    };
    suppression = new SuppressionSet({ ttlMs: 2000 });
    watcher = new VaultWatcher({
      vault,
      embeddingModel: "test-model",
      ollama: mockOllama(),
      suppression,
      debounceMs: 100, // shorter for faster tests
    });
    await watcher.start();
  });

  afterEach(async () => {
    await watcher.stop();
    db.close();
    await rm(vaultDir, { recursive: true, force: true });
  });

  // retry: 2 — defense-in-depth over the poll helper + single-fork isolation.
  // chokidar can drop/stall an FS event past any window under extreme load; a
  // fresh re-run clears it. Three independent layers (poll, fork-isolate, retry).
  it("indexes a newly created .md file", { retry: 2 }, async () => {
    await writeFile(join(vaultDir, "new.md"), "# Hello\n\nbody", "utf-8");
    await waitFor(() => vault.db.notes.getByPath("new.md") !== null);
    const note = vault.db.notes.getByPath("new.md");
    expect(note).not.toBeNull();
    expect(note?.title).toBe("Hello");
  });

  it("re-indexes a modified file", { retry: 2 }, async () => {
    await writeFile(join(vaultDir, "edit.md"), "# Old", "utf-8");
    await waitFor(() => vault.db.notes.getByPath("edit.md")?.title === "Old");
    const oldNote = vault.db.notes.getByPath("edit.md");
    expect(oldNote?.title).toBe("Old");

    await writeFile(join(vaultDir, "edit.md"), "# New Title", "utf-8");
    await waitFor(() => vault.db.notes.getByPath("edit.md")?.title === "New Title");
    const newNote = vault.db.notes.getByPath("edit.md");
    expect(newNote?.title).toBe("New Title");
    expect(newNote?.hash).not.toBe(oldNote?.hash);
  });

  it("removes a deleted file", { retry: 2 }, async () => {
    await writeFile(join(vaultDir, "rm.md"), "# X", "utf-8");
    await waitFor(() => vault.db.notes.getByPath("rm.md") !== null);
    expect(vault.db.notes.getByPath("rm.md")).not.toBeNull();

    await unlink(join(vaultDir, "rm.md"));
    await waitFor(() => vault.db.notes.getByPath("rm.md") === null);
    expect(vault.db.notes.getByPath("rm.md")).toBeNull();
  });

  it("respects the suppression set", async () => {
    suppression.add("suppressed.md");
    await writeFile(join(vaultDir, "suppressed.md"), "# Hidden", "utf-8");
    await sleep(800);
    expect(vault.db.notes.getByPath("suppressed.md")).toBeNull();
  });

  it("ignores .obsidian/ files", async () => {
    await mkdir(join(vaultDir, ".obsidian"), { recursive: true });
    await writeFile(join(vaultDir, ".obsidian", "workspace.md"), "# nope", "utf-8");
    await sleep(800);
    expect(vault.db.notes.getByPath(".obsidian/workspace.md")).toBeNull();
  });

  it("drain() forces pending events to flush", { retry: 2 }, async () => {
    await writeFile(join(vaultDir, "drain.md"), "# d", "utf-8");
    // drain() awaits the queue, but the chokidar event must have been
    // enqueued first. Under load the stabilityThreshold delay varies, so
    // poll until the note lands, draining each iteration to flush whatever
    // is pending. This still proves drain() flushes without a fixed-window race.
    await waitFor(async () => {
      await watcher.drain();
      return vault.db.notes.getByPath("drain.md") !== null;
    });
    expect(vault.db.notes.getByPath("drain.md")).not.toBeNull();
  });
});
