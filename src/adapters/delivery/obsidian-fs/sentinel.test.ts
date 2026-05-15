/**
 * Unit tests for `src/adapters/delivery/obsidian-fs/sentinel.ts`.
 *
 * Covers the four sentinel scenarios required by ADR-004
 * §"Sentinel file — .memory-sink":
 *   - empty folder → sentinel is written.
 *   - folder containing only expected sink content → sentinel is written.
 *   - folder containing foreign user content → SinkProvisioningError.
 *   - repeated provisionSink → idempotent no-op (sentinel exists).
 * Plus:
 *   - non-existent folder → folder is created with recursive: true.
 *   - assertSentinelExists reads back the just-written sentinel.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemorySink } from "../../../types.js";
import { parseMemorySinkHandle } from "../../../memory/sink.js";
import {
  assertSentinelExists,
  provisionSink,
  SENTINEL_FILENAME,
  SinkProvisioningError,
} from "./sentinel.js";

function makeSink(name: string, vault: string, resolveTo: string): MemorySink {
  return {
    name,
    handle: parseMemorySinkHandle(`obsidian-fs://${vault}/${resolveTo}`),
    vault,
    resolveToRelativePath: resolveTo,
    contractName: "default-memory-v1",
    isDefault: true,
  };
}

describe("provisionSink", () => {
  let tmpVault: string;

  beforeEach(async () => {
    tmpVault = await mkdtemp(join(tmpdir(), "vm-sentinel-"));
  });

  afterEach(async () => {
    await rm(tmpVault, { recursive: true, force: true });
  });

  it("creates the folder and writes the sentinel when the folder does not exist", async () => {
    const sink = makeSink("default", "atlas", "_memory/");
    await provisionSink(sink, tmpVault, { version: "2.0.0" });
    const sentinelPath = join(tmpVault, "_memory", SENTINEL_FILENAME);
    const text = await readFile(sentinelPath, "utf-8");
    expect(text).toContain("sink_name: default");
    expect(text).toContain("vault_memory_version: 2.0.0");
  });

  it("writes the sentinel in an empty existing folder", async () => {
    const sink = makeSink("default", "atlas", "_memory/");
    await mkdir(join(tmpVault, "_memory"), { recursive: true });
    await provisionSink(sink, tmpVault, { version: "2.0.0" });
    expect(await assertSentinelExists(sink, tmpVault)).toBe(true);
  });

  it("writes the sentinel when the folder only contains expected sink content", async () => {
    const sink = makeSink("default", "atlas", "_memory/");
    const dir = join(tmpVault, "_memory");
    await mkdir(join(dir, "observations"), { recursive: true });
    await writeFile(join(dir, "2026-04-16-note.md"), "# note\n", "utf-8");
    await provisionSink(sink, tmpVault, { version: "2.0.0" });
    expect(await assertSentinelExists(sink, tmpVault)).toBe(true);
  });

  it("throws SinkProvisioningError when the folder contains foreign user content", async () => {
    const sink = makeSink("default", "atlas", "_memory/");
    const dir = join(tmpVault, "_memory");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "intruder.txt"), "user content", "utf-8");
    await expect(provisionSink(sink, tmpVault, { version: "2.0.0" })).rejects.toBeInstanceOf(
      SinkProvisioningError,
    );
  });

  it("is idempotent — calling twice does not throw", async () => {
    const sink = makeSink("default", "atlas", "_memory/");
    await provisionSink(sink, tmpVault, { version: "2.0.0" });
    await provisionSink(sink, tmpVault, { version: "2.0.0" });
    expect(await assertSentinelExists(sink, tmpVault)).toBe(true);
  });
});

describe("assertSentinelExists", () => {
  let tmpVault: string;

  beforeEach(async () => {
    tmpVault = await mkdtemp(join(tmpdir(), "vm-sentinel-"));
  });

  afterEach(async () => {
    await rm(tmpVault, { recursive: true, force: true });
  });

  it("returns false when the folder does not exist", async () => {
    const sink = makeSink("default", "atlas", "_memory/");
    expect(await assertSentinelExists(sink, tmpVault)).toBe(false);
  });

  it("returns false when the folder exists but the sentinel is missing", async () => {
    const sink = makeSink("default", "atlas", "_memory/");
    await mkdir(join(tmpVault, "_memory"), { recursive: true });
    expect(await assertSentinelExists(sink, tmpVault)).toBe(false);
  });
});

describe("SENTINEL_FILENAME re-export", () => {
  it("equals .memory-sink (consistent with src/memory/sink.ts)", () => {
    expect(SENTINEL_FILENAME).toBe(".memory-sink");
  });
});
