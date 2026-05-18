import { describe, it, expect } from "vitest";
import { computeChunkHash, computeChunkIdFragment } from "./chunk-id.js";

describe("computeChunkIdFragment (Phase 5 / D-04 / ADR-005)", () => {
  it("Pitfall 8: trims trailing whitespace — `# Hello\\n\\n` ≡ `# Hello`", () => {
    expect(computeChunkIdFragment("# Hello\n\n")).toBe(computeChunkIdFragment("# Hello"));
    expect(computeChunkIdFragment("text   \n  ")).toBe(computeChunkIdFragment("text"));
  });

  it("ADR-003 H-3: NFC-normalizes — composed and decomposed café are equal", () => {
    // U+00E9 (composed) vs U+0065 U+0301 (decomposed e + combining acute accent).
    const composed = "café";
    const decomposed = "café";
    // Sanity: the inputs really do differ at the byte level.
    expect(composed).not.toBe(decomposed);
    expect(computeChunkIdFragment(composed)).toBe(computeChunkIdFragment(decomposed));
  });

  it("ADR-003 H-4: CRLF normalized to LF — `a\\r\\nb` ≡ `a\\nb`", () => {
    expect(computeChunkIdFragment("a\r\nb")).toBe(computeChunkIdFragment("a\nb"));
    expect(computeChunkIdFragment("first\r\nsecond\r\nthird")).toBe(
      computeChunkIdFragment("first\nsecond\nthird"),
    );
  });

  it("output is exactly 7 lowercase hex characters", () => {
    const samples = ["hello", "world", "x", "", "a longer string with spaces"];
    for (const s of samples) {
      const f = computeChunkIdFragment(s);
      expect(f).toMatch(/^[0-9a-f]{7}$/);
    }
  });

  it("content-only (D-04 worked example): identical canonical text → identical fragment", () => {
    // The same chunk content excerpted from two different documents
    // produces the same fragment. Disambiguation comes from the
    // <DocId> prefix in the public ChunkId, not from this function.
    const text = "## Quarterly status\n\nAtlas Robotics is on track for Q3 delivery.";
    expect(computeChunkIdFragment(text)).toBe(computeChunkIdFragment(text));
  });

  it("different content → different fragment (sanity)", () => {
    expect(computeChunkIdFragment("alpha")).not.toBe(computeChunkIdFragment("beta"));
  });

  it("computeChunkHash returns `sha256:<hex>` prefix (ADR-003 H-6 versioned-API hash)", () => {
    const h = computeChunkHash("hello");
    expect(h.startsWith("sha256:")).toBe(true);
    expect(h.length).toBe("sha256:".length + 64); // 64 hex chars in sha256
    expect(h.slice("sha256:".length)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("computeChunkIdFragment is the 7-char prefix of computeChunkHash hex", () => {
    const text = "foo bar baz";
    const fullHex = computeChunkHash(text).slice("sha256:".length);
    expect(computeChunkIdFragment(text)).toBe(fullHex.slice(0, 7));
  });
});
