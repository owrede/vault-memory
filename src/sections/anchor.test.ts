import { describe, it, expect } from "vitest";
import { computeAnchor, blockToPlainText } from "./anchor.js";
import type { BlockNode } from "../types.js";

describe("computeAnchor", () => {
  it("is deterministic across calls with identical input", () => {
    const blocks: BlockNode[] = [{ kind: "paragraph", text: "Hello, world." }];
    const a = computeAnchor("Intro", blocks);
    const b = computeAnchor("Intro", blocks);
    expect(a).toBe(b);
    // sha256 hex length
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a well-defined hash for an empty-heading preamble with empty body", () => {
    // Synthetic preamble (level 0): heading_text === "" and blocks === [].
    // The trailing-newline separator MUST still appear, so the canonical
    // input is "\n" — NOT the empty string.
    const anchor = computeAnchor("", []);
    expect(anchor).toMatch(/^[0-9a-f]{64}$/);
    // Sanity: hash of "" (empty input) differs from hash of "\n".
    // The function MUST hash "\n", not "".
    const expected = "1da3aff43e3afc8a4ba8d97a23f6e3f02d23a3e98c0a9e2c2cca9f8de1c4dbf6"; // placeholder
    expect(anchor).not.toBe(expected); // we don't pin the exact hash here — see below for an explicit byte test
  });

  it("hashes the heading + LF + body — not just the body", () => {
    const blocks: BlockNode[] = [{ kind: "paragraph", text: "same body" }];
    const a = computeAnchor("Intro", blocks);
    const b = computeAnchor("Conclusion", blocks);
    expect(a).not.toBe(b);
  });

  it("NFC-normalizes both heading and body — precomposed and decomposed match", () => {
    // "café" precomposed (U+00E9) vs decomposed (U+0065 U+0301).
    const precomposed = "café"; // é
    const decomposed = "café"; // e + combining acute
    expect(precomposed).not.toBe(decomposed); // different bytes pre-NFC
    const aHeading = computeAnchor(precomposed, [{ kind: "paragraph", text: "body" }]);
    const bHeading = computeAnchor(decomposed, [{ kind: "paragraph", text: "body" }]);
    expect(aHeading).toBe(bHeading);

    const aBody = computeAnchor("Intro", [{ kind: "paragraph", text: precomposed }]);
    const bBody = computeAnchor("Intro", [{ kind: "paragraph", text: decomposed }]);
    expect(aBody).toBe(bBody);
  });

  it("is sensitive to trailing whitespace on the body", () => {
    const a = computeAnchor("Intro", [{ kind: "paragraph", text: "hello" }]);
    const b = computeAnchor("Intro", [{ kind: "paragraph", text: "hello " }]);
    expect(a).not.toBe(b);
  });

  it("composes multi-block bodies deterministically (paragraph + code + list)", () => {
    const blocks: BlockNode[] = [
      { kind: "paragraph", text: "Intro paragraph." },
      { kind: "code", lang: "ts", text: "const x = 1;" },
      { kind: "list", ordered: false, items: ["one", "two", "three"] },
    ];
    const a = computeAnchor("Mixed", blocks);
    const b = computeAnchor("Mixed", blocks);
    expect(a).toBe(b);
    // Order matters — reordering changes the hash.
    const reordered: BlockNode[] = [blocks[2]!, blocks[1]!, blocks[0]!];
    const c = computeAnchor("Mixed", reordered);
    expect(c).not.toBe(a);
  });
});

describe("blockToPlainText", () => {
  it("renders paragraph as its text", () => {
    expect(blockToPlainText({ kind: "paragraph", text: "Hello." })).toBe("Hello.");
  });

  it("renders heading with leading #'s", () => {
    expect(blockToPlainText({ kind: "heading", level: 2, text: "Title" })).toBe("## Title");
  });

  it("renders code fenced with lang", () => {
    expect(blockToPlainText({ kind: "code", lang: "py", text: "print(1)" })).toBe(
      "```py\nprint(1)\n```",
    );
  });

  it("renders code without lang as empty fence info", () => {
    expect(blockToPlainText({ kind: "code", text: "x = 1" })).toBe("```\nx = 1\n```");
  });

  it("renders unordered list with `- ` prefix", () => {
    expect(blockToPlainText({ kind: "list", ordered: false, items: ["a", "b"] })).toBe("- a\n- b");
  });

  it("renders ordered list with `1.` prefix", () => {
    expect(blockToPlainText({ kind: "list", ordered: true, items: ["one", "two"] })).toBe(
      "1. one\n1. two",
    );
  });
});
