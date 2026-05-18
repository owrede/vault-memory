import { describe, it, expect } from "vitest";
import {
  buildSourceHashes,
  recomputeCurrentHash,
  computeChunkHash,
  computeChunkIdFragment,
  type ChunkSource,
} from "./source-hashes.js";
import { parseDocId } from "../adapters/registry.js";

describe("buildSourceHashes (Phase 5)", () => {
  const docA = parseDocId("obsidian-fs://v/notes/a.md");
  const docB = parseDocId("obsidian-fs://v/notes/b.md");

  it("emits one source_hashes entry per ChunkSource", () => {
    const fragA = computeChunkIdFragment("alpha content");
    const fragB = computeChunkIdFragment("beta content");
    const sources: ChunkSource[] = [
      { docId: docA, fragment: fragA, text: "alpha content" },
      { docId: docB, fragment: fragB, text: "beta content" },
    ];
    const hashes = buildSourceHashes(sources);
    expect(Object.keys(hashes)).toHaveLength(2);
    expect(hashes[`obsidian-fs://v/notes/a.md#chunk-${fragA}`]).toBe(
      computeChunkHash("alpha content"),
    );
    expect(hashes[`obsidian-fs://v/notes/b.md#chunk-${fragB}`]).toBe(
      computeChunkHash("beta content"),
    );
  });

  it("every value is a sha256:<hex> string per ADR-003 H-6", () => {
    const frag = computeChunkIdFragment("hello");
    const hashes = buildSourceHashes([{ docId: docA, fragment: frag, text: "hello" }]);
    const value = Object.values(hashes)[0]!;
    expect(value).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("handles an empty input — returns empty record", () => {
    expect(buildSourceHashes([])).toEqual({});
  });

  it("rejects malformed fragments via formatChunkId", () => {
    // formatChunkId throws when fragment isn't exactly 7 hex chars.
    expect(() =>
      buildSourceHashes([{ docId: docA, fragment: "bad", text: "x" }]),
    ).toThrow(/Invalid chunk fragment/);
  });

  it("recomputeCurrentHash matches buildSourceHashes value for the same text", () => {
    const text = "## Heading\n\nSome content.";
    const frag = computeChunkIdFragment(text);
    const built = buildSourceHashes([{ docId: docA, fragment: frag, text }]);
    const value = Object.values(built)[0]!;
    expect(recomputeCurrentHash(text)).toBe(value);
  });

  it("recomputeCurrentHash is canonical — Pitfall 8 + H-3 + H-4 invariants flow through", () => {
    // These three texts canonicalize identically per ADR-005.
    const a = "# Hello\n";
    const b = "# Hello\r\n";
    const c = "# Hello   ";
    expect(recomputeCurrentHash(a)).toBe(recomputeCurrentHash(b));
    expect(recomputeCurrentHash(a)).toBe(recomputeCurrentHash(c));
  });
});
