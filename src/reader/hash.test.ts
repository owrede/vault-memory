import { describe, expect, it } from "vitest";
import {
  canonicalJsonStringify,
  computeNoteHash,
  sha256,
} from "./hash.js";

describe("sha256", () => {
  it("produces stable hex digest", () => {
    expect(sha256("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});

describe("canonicalJsonStringify", () => {
  it("sorts object keys alphabetically", () => {
    expect(canonicalJsonStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalJsonStringify({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
  });

  it("yields identical output regardless of insertion order", () => {
    expect(canonicalJsonStringify({ a: 1, b: 2 })).toBe(
      canonicalJsonStringify({ b: 2, a: 1 }),
    );
  });

  it("recursively canonicalizes nested objects", () => {
    const a = { outer: { z: 1, a: 2 }, alpha: { y: 3, x: 4 } };
    const b = { alpha: { x: 4, y: 3 }, outer: { a: 2, z: 1 } };
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
    expect(canonicalJsonStringify(a)).toBe(
      '{"alpha":{"x":4,"y":3},"outer":{"a":2,"z":1}}',
    );
  });

  it("preserves array order (order is semantic)", () => {
    expect(canonicalJsonStringify([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJsonStringify([3, 1, 2])).not.toBe(
      canonicalJsonStringify([1, 2, 3]),
    );
  });

  it("canonicalizes objects inside arrays", () => {
    expect(canonicalJsonStringify([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it("serializes null and undefined as 'null'", () => {
    expect(canonicalJsonStringify(null)).toBe("null");
    expect(canonicalJsonStringify(undefined)).toBe("null");
    expect(canonicalJsonStringify({ a: null, b: undefined })).toBe(
      '{"a":null,"b":null}',
    );
  });

  it("serializes primitives via JSON.stringify", () => {
    expect(canonicalJsonStringify("hi")).toBe('"hi"');
    expect(canonicalJsonStringify(42)).toBe("42");
    expect(canonicalJsonStringify(true)).toBe("true");
    expect(canonicalJsonStringify(false)).toBe("false");
  });

  it("handles empty object and empty array", () => {
    expect(canonicalJsonStringify({})).toBe("{}");
    expect(canonicalJsonStringify([])).toBe("[]");
  });
});

describe("computeNoteHash", () => {
  it("produces identical hash for frontmatter with differing key order", () => {
    const content = "# Hello\n\nbody\n";
    const h1 = computeNoteHash(content, { a: 1, b: 2, c: 3 });
    const h2 = computeNoteHash(content, { c: 3, a: 1, b: 2 });
    const h3 = computeNoteHash(content, { b: 2, c: 3, a: 1 });
    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
  });

  it("produces identical hash for nested frontmatter with differing key order", () => {
    const content = "body";
    const a = { tags: ["x", "y"], meta: { z: 1, a: 2 } };
    const b = { meta: { a: 2, z: 1 }, tags: ["x", "y"] };
    expect(computeNoteHash(content, a)).toBe(computeNoteHash(content, b));
  });

  it("changes when array order changes (arrays are order-sensitive)", () => {
    const content = "body";
    expect(computeNoteHash(content, { tags: ["x", "y"] })).not.toBe(
      computeNoteHash(content, { tags: ["y", "x"] }),
    );
  });

  it("treats null and undefined frontmatter as empty object", () => {
    const content = "body";
    const empty = computeNoteHash(content, {});
    expect(computeNoteHash(content, null)).toBe(empty);
    expect(computeNoteHash(content, undefined)).toBe(empty);
  });

  it("changes when content changes", () => {
    expect(computeNoteHash("a", { x: 1 })).not.toBe(
      computeNoteHash("b", { x: 1 }),
    );
  });

  it("changes when frontmatter values change", () => {
    expect(computeNoteHash("a", { x: 1 })).not.toBe(
      computeNoteHash("a", { x: 2 }),
    );
  });
});
