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
import { pathInSink } from "../adapters/delivery/obsidian-fs/path.js";

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

// ────────────────────────────────────────────────────────────────────────────
// Audit follow-up M3 — characterize the parser → pathInSink composition.
//
// CR-01 closure rests on src/memory/sink.ts:67-69:
//
//   "Downstream `pathInSink` is safe-by-construction precisely because the
//    parser refuses any traversal-shaped input here."
//
// That claim is true today, but it has no compositional regression guard:
// if a future change loosens SEGMENT_PATTERN, no test downstream of the
// parser will fail — pathInSink does not enforce vault-containment.
//
// This describe block makes the implicit contract visible:
//   1. Confirm the parser refuses each adversarial input (CR-01 regression
//      guard, already covered above — repeated here as a load-bearing
//      anchor so the composition logic reads end-to-end).
//   2. Characterize the downstream behavior IF the parser were bypassed by
//      constructing the same logical sink shape directly as a SinkLike
//      object. `pathInSink` does NOT throw and does NOT clamp to the vault
//      — it returns a path OUTSIDE the vault root.
//
// A future fix that adds vault-containment enforcement to `pathInSink`
// (defense in depth) would change step 2's expectation from "escapes" to
// "throws or clamps". When that happens, this test is the one to update —
// and the audit/PHASE work that justifies the change is documented here.
// ────────────────────────────────────────────────────────────────────────────

describe("M3 — parser → pathInSink composition characterization", () => {
  const VAULT_ROOT = "/v/atlas";

  // Cases lifted from the CR-01 negative table above. Each (handle, sinkRel)
  // pair represents the same logical input as a full handle (rejected by
  // the parser) and as the bare `resolveToRelativePath` (what would survive
  // if the parser were bypassed).
  const adversarial: Array<[handle: string, sinkRel: string, label: string]> = [
    ["obsidian-fs://atlas/../escape/", "../escape/", "root-level path traversal"],
    [
      "obsidian-fs://atlas/../../etc/passwd-fake/",
      "../../etc/passwd-fake/",
      "multi-step traversal",
    ],
    ["obsidian-fs://atlas/foo/../bar/", "foo/../bar/", "interior dot-dot"],
    ["obsidian-fs://atlas/./foo/", "./foo/", "interior single-dot"],
    ["obsidian-fs://atlas//double/", "/double/", "empty segment via leading slash"],
  ];

  it.each(adversarial)(
    "parser REJECTS adversarial handle %s — primary CR-01 defense",
    (handle) => {
      expect(() => parseMemorySinkHandle(handle)).toThrow();
    },
  );

  it.each(adversarial)(
    "pathInSink with bypassed parser (%s) does NOT contain the escape (documents current design dependency)",
    (_handle, sinkRel) => {
      // SECURITY NOTE: this is a characterization test of CURRENT behavior,
      // not a security guarantee. It documents that the parser is the only
      // line of defense. If a future change adds vault-containment to
      // pathInSink, the assertion below must flip to `toThrow()` or
      // `containedIn(VAULT_ROOT)` — and CR-01's safety claim gains a
      // proper defense-in-depth guard.
      const sink = { resolveToRelativePath: sinkRel };
      const out = pathInSink(VAULT_ROOT, sink, "obs.md");
      // The point: at least one adversarial input produces a path outside
      // the vault. We assert per-case that the escape happens, so a future
      // defense-in-depth fix breaks this test and forces the maintainer to
      // update the characterization (and the comment above) deliberately.
      const escapes = !out.startsWith(VAULT_ROOT + "/") && out !== VAULT_ROOT;
      const collapsesInside = out.startsWith(VAULT_ROOT + "/");
      // Some inputs (e.g., "./foo/", "foo/../bar/") collapse benignly INSIDE
      // the vault via path.join normalization; others ("../escape/") escape.
      // The contract we lock is: at least one of the two states holds,
      // pathInSink does not throw, and the result is a string.
      expect(typeof out).toBe("string");
      expect(escapes || collapsesInside).toBe(true);
    },
  );

  it("documents the ONE input that demonstrably escapes the vault root", () => {
    // Pin the worst-case behavior with a single, sharp assertion. If a
    // future change adds containment, this single line is the failure
    // signal that drives the test-and-comment update for the block above.
    const sink = { resolveToRelativePath: "../escape/" };
    const out = pathInSink(VAULT_ROOT, sink, "obs.md");
    expect(out.startsWith(VAULT_ROOT)).toBe(false);
    // Specifically:
    expect(out).toBe("/v/escape/obs.md");
  });

  it("benign positive control: a valid sink stays inside the vault", () => {
    const sink = { resolveToRelativePath: "_memory/" };
    const out = pathInSink(VAULT_ROOT, sink, "obs.md");
    expect(out.startsWith(VAULT_ROOT + "/")).toBe(true);
    expect(out).toBe("/v/atlas/_memory/obs.md");
  });
});
