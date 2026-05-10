import { describe, it, expect } from "vitest";
import { extractHeadings, headingPathAtOffset } from "./headings.js";

describe("extractHeadings", () => {
  it("returns [] for empty input", () => {
    expect(extractHeadings("")).toEqual([]);
  });

  it("extracts mixed-level ATX headings", () => {
    const md = "# Top\n\nSome text.\n\n## Sub\n\nMore.\n\n### Sub-sub\n\nEnd.";
    const h = extractHeadings(md);
    expect(h.map((x) => ({ level: x.level, text: x.text, line: x.line }))).toEqual([
      { level: 1, text: "Top", line: 1 },
      { level: 2, text: "Sub", line: 5 },
      { level: 3, text: "Sub-sub", line: 9 },
    ]);
  });

  it("ignores ATX-like lines inside fenced code blocks", () => {
    const md = [
      "# Real",
      "",
      "```",
      "# fake heading",
      "## also fake",
      "```",
      "",
      "## Real Sub",
    ].join("\n");
    const h = extractHeadings(md);
    expect(h.map((x) => x.text)).toEqual(["Real", "Real Sub"]);
  });

  it("handles tilde-fenced code blocks", () => {
    const md = "# Real\n\n~~~\n# fake\n~~~\n\n## Sub";
    const h = extractHeadings(md);
    expect(h.map((x) => x.text)).toEqual(["Real", "Sub"]);
  });

  it("records startOffset that points at the heading line", () => {
    const md = "# A\n\n## B\n";
    const h = extractHeadings(md);
    expect(h[0]?.startOffset).toBe(0);
    expect(md.slice(h[1]?.startOffset ?? 0, (h[1]?.startOffset ?? 0) + 4)).toBe("## B");
  });
});

describe("headingPathAtOffset", () => {
  it("returns null when no heading precedes the offset", () => {
    const md = "intro text\n\n# First\n";
    const h = extractHeadings(md);
    expect(headingPathAtOffset(h, 0)).toBe(null);
    expect(headingPathAtOffset(h, 5)).toBe(null);
  });

  it("returns the most recent preceding heading", () => {
    const md = "# Top\n\ntext1\n\n## Sub A\n\ntext2\n\n## Sub B\n\ntext3";
    const h = extractHeadings(md);
    const idxA = md.indexOf("text2");
    const idxB = md.indexOf("text3");
    expect(headingPathAtOffset(h, idxA)).toBe("## Sub A");
    expect(headingPathAtOffset(h, idxB)).toBe("## Sub B");
  });

  it("returns null for empty heading list", () => {
    expect(headingPathAtOffset([], 100)).toBe(null);
  });
});
