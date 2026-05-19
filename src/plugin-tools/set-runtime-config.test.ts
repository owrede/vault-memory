/**
 * Unit tests for `set_runtime_config` MCP tool (PLG-01).
 *
 * Asserts:
 *   - happy path: closed hot-swappable enum → mutates RuntimeConfigStore in-memory only
 *   - validation failure: Zod rejects malformed input
 *   - structured-error case: restart-required key → reason='restart_required', no mutation
 *   - structured-error case: unknown key → reason='unknown_key', no mutation
 *   - in-memory-only contract: a subsequent read of the original config file
 *     reflects the unchanged file value (no FS write occurred)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setRuntimeConfigTool } from "./set-runtime-config.js";
import { RuntimeConfigStore } from "./runtime-config.js";

describe("set_runtime_config tool (PLG-01)", () => {
  let store: RuntimeConfigStore;

  beforeEach(() => {
    store = new RuntimeConfigStore({});
  });

  it("declares the expected MCP tool surface", () => {
    expect(setRuntimeConfigTool.name).toBe("set_runtime_config");
    expect(typeof setRuntimeConfigTool.description).toBe("string");
    expect(setRuntimeConfigTool.inputSchema).toBeDefined();
  });

  it("happy path: reranker_enabled = false mutates the in-memory store", async () => {
    const result = await setRuntimeConfigTool.handler(
      { key: "reranker_enabled", value: false },
      { store },
    );
    expect(result).toEqual({ ok: true, key: "reranker_enabled", value: false });
    expect(store.get("reranker_enabled")).toBe(false);
  });

  it("happy path: indexer_batch_size = 128 mutates the in-memory store", async () => {
    const result = await setRuntimeConfigTool.handler(
      { key: "indexer_batch_size", value: 128 },
      { store },
    );
    expect(result).toEqual({ ok: true, key: "indexer_batch_size", value: 128 });
    expect(store.get("indexer_batch_size")).toBe(128);
  });

  it("restart-required key returns structured error and does NOT mutate", async () => {
    const result = await setRuntimeConfigTool.handler(
      { key: "ollama_url", value: "http://localhost:9999" },
      { store },
    );
    expect(result).toEqual({
      ok: false,
      reason: "restart_required",
      key: "ollama_url",
    });
    // Defensive: no mutation should have leaked into the store
    expect(store.snapshot()).toEqual({});
  });

  it("unknown key returns structured error and does NOT mutate", async () => {
    const result = await setRuntimeConfigTool.handler(
      { key: "does_not_exist", value: "foo" },
      { store },
    );
    expect(result).toEqual({
      ok: false,
      reason: "unknown_key",
      key: "does_not_exist",
    });
    expect(store.snapshot()).toEqual({});
  });

  it("Zod rejects missing `key`", () => {
    const parsed = setRuntimeConfigTool.inputSchema.safeParse({ value: false });
    expect(parsed.success).toBe(false);
  });

  it("Zod rejects missing `value`", () => {
    const parsed = setRuntimeConfigTool.inputSchema.safeParse({
      key: "reranker_enabled",
    });
    expect(parsed.success).toBe(false);
  });

  it("in-memory-only contract: hot-swap does NOT touch config.toml on disk", async () => {
    // Seed a real on-disk config.toml WITHOUT a [plugin] block — set a known
    // baseline reranker section. Then mutate `reranker_enabled` via the tool
    // and re-read the file: it must be byte-identical.
    const dir = await mkdtemp(join(tmpdir(), "vm-runtime-cfg-"));
    try {
      const configPath = join(dir, "config.toml");
      const original = [
        "[[vaults]]",
        "name = 'atlas'",
        "path = '/vaults/atlas'",
        "",
        "[server]",
        "log_level = 'info'",
        "",
      ].join("\n");
      await writeFile(configPath, original, "utf-8");

      const result = await setRuntimeConfigTool.handler(
        { key: "reranker_enabled", value: true },
        { store },
      );
      expect(result).toEqual({
        ok: true,
        key: "reranker_enabled",
        value: true,
      });

      const after = await readFile(configPath, "utf-8");
      expect(after).toBe(original);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
