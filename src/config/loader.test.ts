/**
 * Unit tests for `src/config/loader.ts`.
 *
 * Phase 2 extends `AppConfigSchema` with optional `[memory]` and
 * `[[memory_sinks]]` blocks. Backwards-compat: configs without these
 * blocks still parse identically to Phase 1.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./loader.js";

describe("loadConfig — Phase 2 memory blocks", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vm-config-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function seed(toml: string): Promise<string> {
    const path = join(tmpDir, "config.toml");
    await writeFile(path, toml, "utf-8");
    return path;
  }

  it("parses a v1-style TOML without [memory] / [[memory_sinks]]", async () => {
    const path = await seed(
      [
        "[[vaults]]",
        "name = 'atlas'",
        "path = '/vaults/atlas'",
      ].join("\n"),
    );
    const config = await loadConfig(path);
    expect(config.vaults).toHaveLength(1);
    expect(config.memory_sinks).toEqual([]);
    expect(config.memory).toBeUndefined();
  });

  it("parses [memory] + [[memory_sinks]] blocks", async () => {
    const path = await seed(
      [
        "[[vaults]]",
        "name = 'atlas'",
        "path = '/vaults/atlas'",
        "",
        "[memory]",
        "default_sink = 'observations'",
        "",
        "[[memory_sinks]]",
        "name = 'observations'",
        "handle = 'obsidian-fs://atlas/_memory/'",
        "contract = 'default-memory-v1'",
      ].join("\n"),
    );
    const config = await loadConfig(path);
    expect(config.memory).toEqual({ default_sink: "observations" });
    expect(config.memory_sinks).toEqual([
      {
        name: "observations",
        handle: "obsidian-fs://atlas/_memory/",
        contract: "default-memory-v1",
      },
    ]);
  });

  it("defaults [[memory_sinks]] contract to 'default-memory-v1' when omitted", async () => {
    const path = await seed(
      [
        "[[vaults]]",
        "name = 'atlas'",
        "path = '/vaults/atlas'",
        "",
        "[[memory_sinks]]",
        "name = 'observations'",
        "handle = 'obsidian-fs://atlas/_memory/'",
      ].join("\n"),
    );
    const config = await loadConfig(path);
    expect(config.memory_sinks[0]?.contract).toBe("default-memory-v1");
  });

  it("treats [memory] as optional", async () => {
    const path = await seed(
      [
        "[[vaults]]",
        "name = 'atlas'",
        "path = '/vaults/atlas'",
        "",
        "[[memory_sinks]]",
        "name = 'observations'",
        "handle = 'obsidian-fs://atlas/_memory/'",
      ].join("\n"),
    );
    const config = await loadConfig(path);
    expect(config.memory).toBeUndefined();
    expect(config.memory_sinks).toHaveLength(1);
  });
});

describe("loadConfig — Phase 5 brief block + sub-folder sink ordering", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vm-config-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function seed(toml: string): Promise<string> {
    const path = join(tmpDir, "config.toml");
    await writeFile(path, toml, "utf-8");
    return path;
  }

  it("accepts [brief.ollama] model (D-10 ladder tier 2)", async () => {
    const path = await seed(
      [
        "[[vaults]]",
        "name = 'atlas'",
        "path = '/vaults/atlas'",
        "",
        "[brief.ollama]",
        "model = 'llama3:8b'",
      ].join("\n"),
    );
    const config = await loadConfig(path);
    expect(config.brief?.ollama?.model).toBe("llama3:8b");
  });

  it("backwards-compatible: configs without [brief] still parse", async () => {
    const path = await seed(
      [
        "[[vaults]]",
        "name = 'atlas'",
        "path = '/vaults/atlas'",
      ].join("\n"),
    );
    const config = await loadConfig(path);
    expect(config.brief).toBeUndefined();
  });

  it("ADR-005 sub-folder sink ordering: _memory/_briefs/ registers BEFORE _memory/", async () => {
    // Declaration order: parent _memory/ first, sub-folder _memory/_briefs/
    // second. The loader MUST reorder so the sub-folder lands first.
    const path = await seed(
      [
        "[[vaults]]",
        "name = 'atlas'",
        "path = '/vaults/atlas'",
        "",
        "[[memory_sinks]]",
        "name = 'observations'",
        "handle = 'obsidian-fs://atlas/_memory/'",
        "contract = 'default-memory-v1'",
        "",
        "[[memory_sinks]]",
        "name = 'briefs'",
        "handle = 'obsidian-fs://atlas/_memory/_briefs/'",
        "contract = 'default-brief-v1'",
      ].join("\n"),
    );
    const config = await loadConfig(path);
    expect(config.memory_sinks).toHaveLength(2);
    // Post-load order: _memory/_briefs/ (longer resource) → _memory/ (shorter).
    expect(config.memory_sinks[0]?.name).toBe("briefs");
    expect(config.memory_sinks[1]?.name).toBe("observations");
  });

  it("sink ordering preserves declaration order on equal-specificity ties (stable sort)", async () => {
    const path = await seed(
      [
        "[[vaults]]",
        "name = 'atlas'",
        "path = '/vaults/atlas'",
        "",
        "[[memory_sinks]]",
        "name = 'first'",
        "handle = 'obsidian-fs://atlas/_memory/a/'",
        "",
        "[[memory_sinks]]",
        "name = 'second'",
        "handle = 'obsidian-fs://atlas/_memory/b/'",
      ].join("\n"),
    );
    const config = await loadConfig(path);
    // Both `_memory/a/` and `_memory/b/` have identical resource
    // length; the stable sort preserves the TOML declaration order.
    expect(config.memory_sinks[0]?.name).toBe("first");
    expect(config.memory_sinks[1]?.name).toBe("second");
  });
});

/**
 * Phase 6 / ADR-006 §Decision 1: `[contracts]` block.
 *
 * Backwards-compat invariant: every v1.x config.toml parses identically
 * with `config.contracts` populated to the documented defaults.
 */
describe("loadConfig — Phase 6 [contracts] block", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vm-config-contracts-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function seed(toml: string): Promise<string> {
    const path = join(tmpDir, "config.toml");
    await writeFile(path, toml, "utf-8");
    return path;
  }

  it("Test 1: config without [contracts] yields documented defaults", async () => {
    const path = await seed(
      [
        "[[vaults]]",
        "name = 'atlas'",
        "path = '/vaults/atlas'",
      ].join("\n"),
    );
    const config = await loadConfig(path);
    expect(config.contracts).toEqual({
      auto_register_tools: false,
      tool_prefix: "vm_",
      step_timeout_seconds: 30,
      defaults: {},
      mcp_clients: {},
    });
  });

  it("Test 2: [contracts] overrides specific fields", async () => {
    const path = await seed(
      [
        "[[vaults]]",
        "name = 'atlas'",
        "path = '/vaults/atlas'",
        "",
        "[contracts]",
        "auto_register_tools = true",
        "tool_prefix = 'x_'",
      ].join("\n"),
    );
    const config = await loadConfig(path);
    expect(config.contracts.auto_register_tools).toBe(true);
    expect(config.contracts.tool_prefix).toBe("x_");
    // Untouched fields keep defaults
    expect(config.contracts.step_timeout_seconds).toBe(30);
    expect(config.contracts.defaults).toEqual({});
    expect(config.contracts.mcp_clients).toEqual({});
  });

  it("Test 3: empty tool_prefix is REJECTED (A7 .min(1))", async () => {
    const path = await seed(
      [
        "[contracts]",
        "tool_prefix = ''",
      ].join("\n"),
    );
    await expect(loadConfig(path)).rejects.toThrow();
  });

  it("Test 4: tool_prefix '1bad' (leading digit) REJECTED", async () => {
    const path = await seed(
      [
        "[contracts]",
        "tool_prefix = '1bad'",
      ].join("\n"),
    );
    await expect(loadConfig(path)).rejects.toThrow();
  });

  it("Test 5: [contracts.defaults] populates the handle→URI map", async () => {
    const path = await seed(
      [
        "[contracts.defaults]",
        "default_source = 'obsidian-fs://my-vault'",
      ].join("\n"),
    );
    const config = await loadConfig(path);
    expect(config.contracts.defaults).toEqual({
      default_source: "obsidian-fs://my-vault",
    });
  });

  it("Test 6: [contracts.mcp_clients.<name>] populates command + args", async () => {
    const path = await seed(
      [
        "[contracts.mcp_clients.gh]",
        "command = 'gh-mcp-server'",
        "args = ['--config', '/p']",
      ].join("\n"),
    );
    const config = await loadConfig(path);
    expect(config.contracts.mcp_clients.gh).toBeDefined();
    expect(config.contracts.mcp_clients.gh?.command).toBe("gh-mcp-server");
    expect(config.contracts.mcp_clients.gh?.args).toEqual(["--config", "/p"]);
    expect(config.contracts.mcp_clients.gh?.env).toBeUndefined();
  });

  it("Test 7: step_timeout_seconds = 0 REJECTED (positive int)", async () => {
    const path = await seed(
      [
        "[contracts]",
        "step_timeout_seconds = 0",
      ].join("\n"),
    );
    await expect(loadConfig(path)).rejects.toThrow();
  });

  it("Test 8: step_timeout_seconds = -5 REJECTED", async () => {
    const path = await seed(
      [
        "[contracts]",
        "step_timeout_seconds = -5",
      ].join("\n"),
    );
    await expect(loadConfig(path)).rejects.toThrow();
  });

  it("Test 9: mcp_clients.<name>.command empty string REJECTED", async () => {
    const path = await seed(
      [
        "[contracts.mcp_clients.bad]",
        "command = ''",
      ].join("\n"),
    );
    await expect(loadConfig(path)).rejects.toThrow();
  });

  it("Test 10: a previously-stored v1 config (no [contracts]) backwards-compat regression", async () => {
    // Mirrors a v1.x config.toml shape verbatim — must parse with the
    // documented contracts defaults injected.
    const path = await seed(
      [
        "[server]",
        "log_level = 'info'",
        "ollama_endpoint = 'http://localhost:11434'",
        "",
        "[[vaults]]",
        "name = 'atlas'",
        "path = '/vaults/atlas'",
        "embedding_model = 'qwen3-embedding'",
      ].join("\n"),
    );
    const config = await loadConfig(path);
    // Existing v1 fields parse identically:
    expect(config.vaults).toHaveLength(1);
    expect(config.vaults[0]?.name).toBe("atlas");
    expect(config.server.log_level).toBe("info");
    // Phase 6 contracts defaults injected:
    expect(config.contracts.auto_register_tools).toBe(false);
    expect(config.contracts.tool_prefix).toBe("vm_");
    expect(config.contracts.step_timeout_seconds).toBe(30);
  });

  it("Test 11: missing config file (ENOENT) returns DEFAULT_CONFIG with contracts defaults", async () => {
    const path = join(tmpDir, "does-not-exist.toml");
    const config = await loadConfig(path);
    expect(config.contracts).toEqual({
      auto_register_tools: false,
      tool_prefix: "vm_",
      step_timeout_seconds: 30,
      defaults: {},
      mcp_clients: {},
    });
  });
});

/**
 * Phase 7 / Plan 07-04 / D-MCP-SURFACE: `[plugin]` block.
 *
 * Backwards-compat invariant: every pre-Phase-7 config.toml parses identically
 * with `config.plugin.enabled === false` injected. The default-OFF gate is the
 * structural mechanism that keeps `evals/v1-baseline/tools-list.snapshot.json`
 * byte-stable for non-plugin deployments (Phase 8 REL-08 ≤32-tool budget).
 */
describe("loadConfig — Phase 7 [plugin] block", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vm-config-plugin-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function seed(toml: string): Promise<string> {
    const path = join(tmpDir, "config.toml");
    await writeFile(path, toml, "utf-8");
    return path;
  }

  it("configs without [plugin] parse identically with plugin.enabled = false", async () => {
    const path = await seed(
      [
        "[[vaults]]",
        "name = 'atlas'",
        "path = '/vaults/atlas'",
      ].join("\n"),
    );
    const config = await loadConfig(path);
    expect(config.plugin).toEqual({ enabled: false });
  });

  it("[plugin] enabled = true parses with plugin.enabled === true", async () => {
    const path = await seed(
      [
        "[[vaults]]",
        "name = 'atlas'",
        "path = '/vaults/atlas'",
        "",
        "[plugin]",
        "enabled = true",
      ].join("\n"),
    );
    const config = await loadConfig(path);
    expect(config.plugin.enabled).toBe(true);
  });

  it("[plugin] enabled = 'not-a-bool' is REJECTED by Zod validation", async () => {
    const path = await seed(
      [
        "[plugin]",
        "enabled = 'not-a-bool'",
      ].join("\n"),
    );
    await expect(loadConfig(path)).rejects.toThrow();
  });

  it("missing config file (ENOENT) returns DEFAULT_CONFIG with plugin.enabled = false", async () => {
    const path = join(tmpDir, "does-not-exist.toml");
    const config = await loadConfig(path);
    expect(config.plugin).toEqual({ enabled: false });
  });
});
