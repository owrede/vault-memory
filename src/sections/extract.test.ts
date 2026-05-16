import { describe, it, expect } from "vitest";
import { extractSections, markdownToSectionBlocks } from "./extract.js";
import { computeAnchor } from "./anchor.js";
import type { BlockNode } from "../types.js";

describe("extractSections", () => {
  it("zero-heading doc → one preamble section", () => {
    const blocks: BlockNode[] = [{ kind: "paragraph", text: "Just text." }];
    const sections = extractSections(blocks);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.level).toBe(0);
    expect(sections[0]!.heading_text).toBe("");
    expect(sections[0]!.heading_path).toEqual([]);
    expect(sections[0]!.parent_index).toBeNull();
    expect(sections[0]!.ord).toBe(0);
    expect(sections[0]!.plain_text_body).toBe("Just text.");
  });

  it("empty input → zero sections", () => {
    expect(extractSections([])).toEqual([]);
  });

  it("single H1 + paragraph → one section (no preamble when content begins with heading)", () => {
    const blocks: BlockNode[] = [
      { kind: "heading", level: 1, text: "Intro" },
      { kind: "paragraph", text: "First paragraph." },
    ];
    const sections = extractSections(blocks);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.level).toBe(1);
    expect(sections[0]!.heading_text).toBe("Intro");
    expect(sections[0]!.heading_path).toEqual(["Intro"]);
    expect(sections[0]!.parent_index).toBeNull();
    expect(sections[0]!.plain_text_body).toBe("First paragraph.");
  });

  it("preamble + H1 — preamble gets level 0, H1 starts a new section", () => {
    const blocks: BlockNode[] = [
      { kind: "paragraph", text: "Pre-content." },
      { kind: "heading", level: 1, text: "Body" },
      { kind: "paragraph", text: "Body paragraph." },
    ];
    const sections = extractSections(blocks);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.level).toBe(0);
    expect(sections[0]!.plain_text_body).toBe("Pre-content.");
    expect(sections[1]!.level).toBe(1);
    expect(sections[1]!.heading_text).toBe("Body");
    expect(sections[1]!.parent_index).toBeNull(); // preamble is NOT the parent
    expect(sections[1]!.heading_path).toEqual(["Body"]);
  });

  it("H1 > H2 > H3 builds parent_index threading", () => {
    const blocks: BlockNode[] = [
      { kind: "heading", level: 1, text: "A" },
      { kind: "heading", level: 2, text: "B" },
      { kind: "heading", level: 3, text: "C" },
      { kind: "paragraph", text: "C body" },
    ];
    const sections = extractSections(blocks);
    expect(sections).toHaveLength(3);
    expect(sections[0]!.heading_path).toEqual(["A"]);
    expect(sections[0]!.parent_index).toBeNull();
    expect(sections[1]!.heading_path).toEqual(["A", "B"]);
    expect(sections[1]!.parent_index).toBe(0);
    expect(sections[2]!.heading_path).toEqual(["A", "B", "C"]);
    expect(sections[2]!.parent_index).toBe(1);
    expect(sections[2]!.plain_text_body).toBe("C body");
  });

  it("H1 > H2 > H1 closes the first H2 (sibling H1 starts a new tree)", () => {
    const blocks: BlockNode[] = [
      { kind: "heading", level: 1, text: "A" },
      { kind: "heading", level: 2, text: "Sub" },
      { kind: "paragraph", text: "sub body" },
      { kind: "heading", level: 1, text: "B" },
      { kind: "paragraph", text: "b body" },
    ];
    const sections = extractSections(blocks);
    expect(sections).toHaveLength(3);
    expect(sections[0]!.heading_text).toBe("A");
    expect(sections[1]!.heading_text).toBe("Sub");
    expect(sections[1]!.parent_index).toBe(0);
    expect(sections[2]!.heading_text).toBe("B");
    expect(sections[2]!.parent_index).toBeNull();
    expect(sections[2]!.heading_path).toEqual(["B"]);
  });

  it("H1 > H2 > H3 > H2 closes H3 at the second H2 (deep close-out)", () => {
    const blocks: BlockNode[] = [
      { kind: "heading", level: 1, text: "Top" },
      { kind: "heading", level: 2, text: "First" },
      { kind: "heading", level: 3, text: "Deep" },
      { kind: "paragraph", text: "deep body" },
      { kind: "heading", level: 2, text: "Second" },
      { kind: "paragraph", text: "second body" },
    ];
    const sections = extractSections(blocks);
    expect(sections).toHaveLength(4);
    expect(sections[3]!.heading_path).toEqual(["Top", "Second"]);
    expect(sections[3]!.parent_index).toBe(0); // parent is "Top" (level 1)
    // ord: First and Second share parent Top → ord 0 and ord 1.
    expect(sections[1]!.ord).toBe(0);
    expect(sections[3]!.ord).toBe(1);
    // Deep is the only child of First → ord 0.
    expect(sections[2]!.ord).toBe(0);
  });

  it("anchor matches the H-7 formula on the section's contents", () => {
    const blocks: BlockNode[] = [
      { kind: "heading", level: 1, text: "Intro" },
      { kind: "paragraph", text: "hello" },
    ];
    const sections = extractSections(blocks);
    expect(sections).toHaveLength(1);
    const expected = computeAnchor("Intro", [{ kind: "paragraph", text: "hello" }]);
    expect(sections[0]!.anchor).toBe(expected);
  });

  it("siblings under the same parent get sequential ord values", () => {
    const blocks: BlockNode[] = [
      { kind: "heading", level: 1, text: "Top" },
      { kind: "heading", level: 2, text: "A" },
      { kind: "heading", level: 2, text: "B" },
      { kind: "heading", level: 2, text: "C" },
    ];
    const sections = extractSections(blocks);
    expect(sections).toHaveLength(4);
    expect(sections[1]!.ord).toBe(0);
    expect(sections[2]!.ord).toBe(1);
    expect(sections[3]!.ord).toBe(2);
  });
});

describe("markdownToSectionBlocks", () => {
  it("empty content → empty array", () => {
    expect(markdownToSectionBlocks("")).toEqual([]);
  });

  it("zero-heading content → single paragraph block", () => {
    const out = markdownToSectionBlocks("Just text, no heading.");
    expect(out).toEqual([{ kind: "paragraph", text: "Just text, no heading." }]);
  });

  it("single H1 + body → heading block + paragraph block", () => {
    const md = "# Title\nBody line 1.\nBody line 2.\n";
    const out = markdownToSectionBlocks(md);
    expect(out).toEqual([
      { kind: "heading", level: 1, text: "Title" },
      { kind: "paragraph", text: "Body line 1.\nBody line 2." },
    ]);
  });

  it("preamble + H1 + body produces a preamble paragraph then heading + paragraph", () => {
    const md = "preamble line.\n\n# H1\nbody.\n";
    const out = markdownToSectionBlocks(md);
    expect(out).toEqual([
      { kind: "paragraph", text: "preamble line.\n" }, // includes intervening blank line
      { kind: "heading", level: 1, text: "H1" },
      { kind: "paragraph", text: "body." },
    ]);
  });

  it("H1 + H2 + body → 3 blocks (no body between H1 and H2)", () => {
    const md = "# A\n## B\nbody.\n";
    const out = markdownToSectionBlocks(md);
    expect(out).toEqual([
      { kind: "heading", level: 1, text: "A" },
      { kind: "heading", level: 2, text: "B" },
      { kind: "paragraph", text: "body." },
    ]);
  });

  it("extractSections(markdownToSectionBlocks(md)) preserves heading_path threading", () => {
    const md = "# Top\n## Sub\nsub body.\n# Sibling\nsib body.\n";
    const sections = extractSections(markdownToSectionBlocks(md));
    expect(sections).toHaveLength(3);
    expect(sections[0]!.heading_path).toEqual(["Top"]);
    expect(sections[1]!.heading_path).toEqual(["Top", "Sub"]);
    expect(sections[2]!.heading_path).toEqual(["Sibling"]);
    expect(sections[1]!.plain_text_body).toBe("sub body.");
    expect(sections[2]!.plain_text_body).toBe("sib body.");
  });
});
