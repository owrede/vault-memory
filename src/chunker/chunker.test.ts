import { describe, it, expect } from "vitest";
import { chunkNote } from "./chunker.js";

const MAX = 400;
const TOLERANCE = Math.ceil(MAX * 1.2);

function makeLongText(words: number, prefix = ""): string {
  // ~6 chars per "word" → predictable size.
  const word = "Lorem ";
  return prefix + word.repeat(words).trimEnd();
}

describe("chunkNote", () => {
  it("returns [] for empty content", () => {
    expect(chunkNote("")).toEqual([]);
  });

  it("returns a single chunk for short content (<= maxTokens)", () => {
    const content = "# Hello\n\nThis is a small note.";
    const chunks = chunkNote(content);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.idx).toBe(0);
    expect(chunks[0]?.text).toBe(content);
    expect(chunks[0]?.startOffset).toBe(0);
    expect(chunks[0]?.endOffset).toBe(content.length);
    expect(chunks[0]?.headingPath).toBe("# Hello");
  });

  it("produces multiple chunks for long content with ascending idx and bounded token counts", () => {
    // ~3000 chars → 750 tokens → multiple chunks at maxTokens=400.
    const content = makeLongText(500);
    const chunks = chunkNote(content);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => {
      expect(c.idx).toBe(i);
      expect(c.tokenCount).toBeLessThanOrEqual(TOLERANCE);
      expect(c.text.length).toBeGreaterThan(0);
    });
  });

  it("respects heading boundaries when possible", () => {
    // Three H2 sections, each ~250 tokens — together too big for one chunk
    // but each fits → expect 3 chunks, each starting at its heading.
    const section = (title: string) =>
      `## ${title}\n\n` + makeLongText(150) + "\n";
    const content =
      section("Section A") + "\n" + section("Section B") + "\n" + section("Section C");

    const chunks = chunkNote(content);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    // The first three chunks should map to A, B, C respectively (overlap may
    // pull earlier content but headingPath is computed at start offset).
    const headingPaths = chunks.slice(0, 3).map((c) => c.headingPath);
    expect(headingPaths).toContain("## Section A");
    expect(headingPaths).toContain("## Section B");
    expect(headingPaths).toContain("## Section C");
  });

  it("applies overlap on subsequent chunks", () => {
    const content = makeLongText(800);
    const chunks = chunkNote(content, { maxTokens: 200, overlapTokens: 30 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const first = chunks[0];
    const second = chunks[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) return;
    // Second chunk should start before first chunk ended (overlap is sticky).
    expect(second.startOffset).toBeLessThan(first.endOffset);
  });

  it("zero overlap means no backward shift", () => {
    const content = makeLongText(800);
    const chunks = chunkNote(content, { maxTokens: 200, overlapTokens: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1];
      const cur = chunks[i];
      if (!prev || !cur) continue;
      expect(cur.startOffset).toBeGreaterThanOrEqual(prev.endOffset);
    }
  });

  it("covers the original content (offsets are within bounds)", () => {
    const content = makeLongText(500);
    const chunks = chunkNote(content);
    for (const c of chunks) {
      expect(c.startOffset).toBeGreaterThanOrEqual(0);
      expect(c.endOffset).toBeLessThanOrEqual(content.length);
      expect(c.endOffset).toBeGreaterThan(c.startOffset);
      // text should match the offsets (modulo overlap prepending — overlap
      // prepends content BEFORE startOffset, so we only check that the chunk
      // text contains the [startOffset, endOffset) slice).
      const slice = content.slice(c.startOffset, c.endOffset);
      expect(c.text.endsWith(slice) || c.text.includes(slice)).toBe(true);
    }
  });

  it("hard-cuts a single huge run with no breaks", () => {
    // No spaces, no punctuation, no headings → must fall back to hard cut.
    const content = "x".repeat(5000);
    const chunks = chunkNote(content, { maxTokens: 100, overlapTokens: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(100 * 4);
    }
  });

  it("attaches headingPath based on chunk start offset in original content", () => {
    const content =
      "# Top\n\n" +
      makeLongText(150) +
      "\n\n## Deep\n\n" +
      makeLongText(150);
    const chunks = chunkNote(content);
    // At least one chunk should report the Deep heading.
    const paths = chunks.map((c) => c.headingPath);
    expect(paths).toContain("## Deep");
  });
});
