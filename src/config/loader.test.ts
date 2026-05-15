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
