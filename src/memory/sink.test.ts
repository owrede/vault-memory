/**
 * Unit tests for `src/memory/sink.ts`.
 *
 * Covers:
 *   - parseMemorySinkHandle positive case (valid `obsidian-fs://<vault>/<path>/`).
 *   - parseMemorySinkHandle negative cases (each MUST throw with the
 *     input value visible in the error message).
 *   - formatMemorySinkHandle composes + round-trips with parse.
 *   - SENTINEL_FILENAME constant equals ".memory-sink".
 *   - MEMORY_SINK_HANDLE_PATTERN exported for downstream reuse.
 *
 * Mirrors the IIFE-closed-mint pattern test layout in
 * `src/adapters/registry.test.ts:21–80`.
 */

import { describe, it, expect } from "vitest";
import {
  formatMemorySinkHandle,
  MEMORY_SINK_HANDLE_PATTERN,
  parseMemorySinkHandle,
  SENTINEL_FILENAME,
} from "./sink.js";

describe("parseMemorySinkHandle", () => {
  it("accepts a well-formed obsidian-fs handle with trailing slash", () => {
    const h = parseMemorySinkHandle("obsidian-fs://atlas-fixture/_memory/");
    expect(h).toBe("obsidian-fs://atlas-fixture/_memory/");
  });

  it("accepts a deeper resource path", () => {
    const h = parseMemorySinkHandle("obsidian-fs://atlas/_memory/observations/");
    expect(h).toBe("obsidian-fs://atlas/_memory/observations/");
  });

  it.each([
    ["OBSIDIAN-FS://atlas/_memory/", "uppercase scheme"],
    ["obsidian-fs:/atlas/_memory/", "missing slash"],
    ["obsidian-fs://atlas/_memory", "no trailing slash"],
    ["obsidian-fs:///_memory/", "empty authority"],
    ["obsidian-fs://atlas/", "empty resource"],
    ["", "empty string"],
    ["notion-api://workspace/page/", "non-obsidian-fs scheme (Phase 2 scope)"],
  ])("rejects %s (%s)", (input) => {
    expect(() => parseMemorySinkHandle(input)).toThrow(/Invalid MemorySinkHandle/);
  });

  it("includes the input value in the error message", () => {
    expect(() => parseMemorySinkHandle("garbage")).toThrow(/garbage/);
  });

  it("error message lists the expected shape", () => {
    expect(() => parseMemorySinkHandle("")).toThrow(/trailing slash required/);
  });
});

describe("formatMemorySinkHandle", () => {
  it("composes and validates a handle from its parts", () => {
    const h = formatMemorySinkHandle("obsidian-fs", "atlas-fixture", "_memory/");
    expect(h).toBe("obsidian-fs://atlas-fixture/_memory/");
  });

  it("round-trips with parseMemorySinkHandle", () => {
    const composed = formatMemorySinkHandle("obsidian-fs", "atlas", "_memory/inbox/");
    const reparsed = parseMemorySinkHandle(composed);
    expect(reparsed).toBe(composed);
  });

  it("rejects malformed compositions", () => {
    expect(() => formatMemorySinkHandle("OBSIDIAN", "x", "y/")).toThrow(
      /Invalid MemorySinkHandle/,
    );
  });
});

describe("MEMORY_SINK_HANDLE_PATTERN", () => {
  it("matches a valid handle", () => {
    expect(MEMORY_SINK_HANDLE_PATTERN.test("obsidian-fs://atlas/_memory/")).toBe(true);
  });

  it("does not match a handle missing the trailing slash", () => {
    expect(MEMORY_SINK_HANDLE_PATTERN.test("obsidian-fs://atlas/_memory")).toBe(false);
  });
});

describe("SENTINEL_FILENAME", () => {
  it('equals ".memory-sink"', () => {
    expect(SENTINEL_FILENAME).toBe(".memory-sink");
  });
});
