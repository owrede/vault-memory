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
 *
 * CR-02 closure (gap-closure Plan 02-10):
 *   - Plain `.md` files at the sink root are NOT expected — they are
 *     almost certainly user notes. `provisionSink` refuses to absorb
 *     such folders.
 *
 * WR-06 closure (gap-closure Plan 02-10):
 *   - `assertSentinelExists` returns `false` ONLY for ENOENT;
 *     non-ENOENT errno codes (EACCES, EIO, ENAMETOOLONG, EPERM) are
 *     surfaced as `SinkSentinelCheckError` so callers can distinguish
 *     "sentinel does not exist" from "FS check failed".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fsp } from "node:fs";
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
  SinkSentinelCheckError,
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

  it("writes the sentinel when the folder only contains the three known sink subfolders", async () => {
    // CR-02: the known-subfolder-only case is still a positive control.
    // Plain `.md` files at the sink root are NO LONGER expected — see the
    // dedicated negative tests below.
    const sink = makeSink("default", "atlas", "_memory/");
    const dir = join(tmpVault, "_memory");
    await mkdir(join(dir, "observations"), { recursive: true });
    await mkdir(join(dir, "_briefs"), { recursive: true });
    await mkdir(join(dir, "status-updates"), { recursive: true });
    await provisionSink(sink, tmpVault, { version: "2.0.0" });
    expect(await assertSentinelExists(sink, tmpVault)).toBe(true);
  });

  it("refuses to absorb folder with plain .md files (CR-02)", async () => {
    // A `[[memory_sinks]]` handle pointed at a folder full of user notes
    // must NOT silently absorb them. CR-02 closure: plain `.md` at the
    // sink root trips `SinkProvisioningError(SINK_PROVISION_UNSAFE)`.
    const sink = makeSink("default", "atlas", "_memory/");
    const dir = join(tmpVault, "_memory");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "daily-note.md"), "# my daily note\n", "utf-8");
    await expect(provisionSink(sink, tmpVault, { version: "2.0.0" })).rejects.toBeInstanceOf(
      SinkProvisioningError,
    );
    try {
      await provisionSink(sink, tmpVault, { version: "2.0.0" });
    } catch (err) {
      expect(err).toBeInstanceOf(SinkProvisioningError);
      const e = err as SinkProvisioningError;
      expect(e.code).toBe("SINK_PROVISION_UNSAFE");
      expect(e.offendingEntries).toContain("daily-note.md");
    }
  });

  it("refuses to absorb folder with README.md (CR-02 — multiple plain .md files)", async () => {
    const sink = makeSink("default", "atlas", "_memory/");
    const dir = join(tmpVault, "_memory");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "README.md"), "# readme\n", "utf-8");
    await expect(provisionSink(sink, tmpVault, { version: "2.0.0" })).rejects.toBeInstanceOf(
      SinkProvisioningError,
    );
  });

  it("refuses to absorb folder with a mix of plain .md and known subfolders (CR-02)", async () => {
    const sink = makeSink("default", "atlas", "_memory/");
    const dir = join(tmpVault, "_memory");
    await mkdir(join(dir, "observations"), { recursive: true });
    await writeFile(join(dir, "intruder.md"), "# intruder\n", "utf-8");
    await expect(provisionSink(sink, tmpVault, { version: "2.0.0" })).rejects.toBeInstanceOf(
      SinkProvisioningError,
    );
    try {
      await provisionSink(sink, tmpVault, { version: "2.0.0" });
    } catch (err) {
      const e = err as SinkProvisioningError;
      expect(e.offendingEntries).toContain("intruder.md");
      expect(e.offendingEntries).not.toContain("observations");
    }
  });

  it("is a no-op when only the sentinel file is present (idempotent — positive control)", async () => {
    // Folder containing ONLY `.memory-sink` is the post-provision steady
    // state. `provisionSink` must not throw, and the sentinel must remain.
    const sink = makeSink("default", "atlas", "_memory/");
    const dir = join(tmpVault, "_memory");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, SENTINEL_FILENAME), "sink_name: default\n", "utf-8");
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

describe("assertSentinelExists — errno discrimination (WR-06)", () => {
  let tmpVault: string;
  let accessSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpVault = await mkdtemp(join(tmpdir(), "vm-sentinel-errno-"));
  });

  afterEach(async () => {
    accessSpy?.mockRestore();
    await rm(tmpVault, { recursive: true, force: true });
  });

  it("returns false when fs.access throws ENOENT (sentinel literally absent)", async () => {
    const sink = makeSink("default", "atlas", "_memory/");
    const err = Object.assign(new Error("no such file or directory"), {
      code: "ENOENT",
    }) as NodeJS.ErrnoException;
    accessSpy = vi.spyOn(fsp, "access").mockRejectedValueOnce(err);
    await expect(assertSentinelExists(sink, tmpVault)).resolves.toBe(false);
  });

  it("rejects with SinkSentinelCheckError when fs.access throws EACCES (permission denied)", async () => {
    const sink = makeSink("default", "atlas", "_memory/");
    const err = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    }) as NodeJS.ErrnoException;
    accessSpy = vi.spyOn(fsp, "access").mockRejectedValueOnce(err);
    await expect(assertSentinelExists(sink, tmpVault)).rejects.toBeInstanceOf(
      SinkSentinelCheckError,
    );
    accessSpy.mockRestore();
    accessSpy = vi.spyOn(fsp, "access").mockRejectedValueOnce(err);
    try {
      await assertSentinelExists(sink, tmpVault);
    } catch (e) {
      expect(e).toBeInstanceOf(SinkSentinelCheckError);
      const sce = e as SinkSentinelCheckError;
      expect(sce.underlyingCode).toBe("EACCES");
      expect(sce.sinkName).toBe("default");
      expect(sce.code).toBe("SINK_SENTINEL_CHECK_FAILED");
    }
  });

  it("rejects with SinkSentinelCheckError when fs.access throws EIO (disk error)", async () => {
    const sink = makeSink("default", "atlas", "_memory/");
    const err = Object.assign(new Error("i/o error"), {
      code: "EIO",
    }) as NodeJS.ErrnoException;
    accessSpy = vi.spyOn(fsp, "access").mockRejectedValueOnce(err);
    try {
      await assertSentinelExists(sink, tmpVault);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(SinkSentinelCheckError);
      expect((e as SinkSentinelCheckError).underlyingCode).toBe("EIO");
    }
  });
});

describe("SENTINEL_FILENAME re-export", () => {
  it("equals .memory-sink (consistent with src/memory/sink.ts)", () => {
    expect(SENTINEL_FILENAME).toBe(".memory-sink");
  });
});
