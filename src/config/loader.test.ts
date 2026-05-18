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
