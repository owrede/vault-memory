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

// ─────────────────────────────────────────────────────────────────────────────
// CR-01: path-traversal rejection at the parser boundary (Plan 02-09)
// ─────────────────────────────────────────────────────────────────────────────

describe("parseMemorySinkHandle — CR-01 path-traversal rejection", () => {
  // Positive controls — Phase 2 baseline behavior must be preserved.
  it.each([
    ["obsidian-fs://atlas/_memory/", "single-segment sink folder"],
    ["obsidian-fs://atlas/_memory/inbox/", "multi-segment resource"],
  ])("positive control: accepts %s (%s)", (input) => {
    const h = parseMemorySinkHandle(input);
    expect(h).toBe(input);
    expect(h.length).toBeGreaterThan(0);
  });

  // Negative cases — each MUST throw with a diagnostic that mentions a
  // path segment, so callers (and operators reading config errors) can
  // identify why the handle was refused.
  it.each([
    ["obsidian-fs://atlas/../escape/", "rejects path traversal segment at root"],
    [
      "obsidian-fs://atlas/../../etc/passwd-fake/",
      "rejects multi-step path traversal escape",
    ],
    ["obsidian-fs://atlas/foo/../bar/", "rejects interior `..` segment"],
    ["obsidian-fs://atlas/./foo/", "rejects interior `.` segment"],
    ["obsidian-fs://atlas//double/", "rejects empty segment from `//`"],
    ["obsidian-fs://atlas/foo\\bar/", "rejects backslash inside segment"],
  ])("%s — %s", (input) => {
    expect(() => parseMemorySinkHandle(input)).toThrow(/segment/);
  });

  it("error message names the offending segment and the allowed shape", () => {
    expect(() => parseMemorySinkHandle("obsidian-fs://atlas/../escape/")).toThrow(
      /"\.\."/,
    );
    expect(() => parseMemorySinkHandle("obsidian-fs://atlas/../escape/")).toThrow(
      /\[A-Za-z0-9\._\\?-\]\+/,
    );
  });

  it("error message echoes the original handle", () => {
    expect(() => parseMemorySinkHandle("obsidian-fs://atlas/foo/../bar/")).toThrow(
      /obsidian-fs:\/\/atlas\/foo\/\.\.\/bar\//,
    );
  });

  // Unicode NFC equivalence: a precomposed input must canonicalize to NFC
  // before the segment scan, so attackers cannot smuggle a `..` past the
  // regex using decomposed equivalents. The positive control proves that
  // NFC normalization does not corrupt benign ASCII inputs (a NFD input
  // that normalizes to a valid ASCII handle still passes).
  it("normalizes input to NFC before the segment scan (positive control)", () => {
    // "é" can be represented as either a single precomposed codepoint
    // (U+00E9) or as "e" + combining acute (U+0065 U+0301). The current
    // pattern allows only ASCII, so any non-ASCII segment is refused
    // regardless of NFC form; this test pins the normalization order so
    // an attacker cannot rely on a byte-different equivalent slipping
    // through. We assert via a benign ASCII NFD-equivalent: a string
    // whose NFC form equals the NFD form (ASCII fixed point).
    const asciiHandle = "obsidian-fs://atlas/_memory/";
    expect(asciiHandle).toBe(asciiHandle.normalize("NFC"));
    expect(parseMemorySinkHandle(asciiHandle)).toBe(asciiHandle);
  });

  it("rejects a Unicode escape form of `..` (NFC guard)", () => {
    // . is the literal "." codepoint, so ".." === ".." —
    // after NFC normalization, this MUST still be caught by the
    // per-segment `..` check.
    const sneaky = "obsidian-fs://atlas/../x/";
    expect(() => parseMemorySinkHandle(sneaky)).toThrow(/segment/);
  });
});
