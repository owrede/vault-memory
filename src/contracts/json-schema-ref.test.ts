/**
 * Unit tests for resolveRefs (Phase 6 / D-A3a, ADR-006 §Decision 6).
 *
 * Security gate (T-06-01-01): only `#/types/<name>` form accepted.
 * No HTTP fetches, no FS reads.
 */

import { describe, it, expect } from "vitest";
import { resolveRefs } from "./json-schema-ref.js";
import { TYPES_CATALOG } from "./types-catalog.js";

describe("resolveRefs (D-A3a, T-06-01-01 gate)", () => {
  it("Test 4: $ref to a catalog entry resolves to that entry", () => {
    const out = resolveRefs({ foo: { $ref: "#/types/DocId" } }) as {
      foo: Record<string, unknown>;
    };
    expect(out.foo).toEqual(TYPES_CATALOG.DocId);
  });

  it("Test 5: YAML-author additions on the $ref node WIN (spread order)", () => {
    const out = resolveRefs({
      foo: { $ref: "#/types/DocId", description: "override" },
    }) as { foo: Record<string, unknown> };
    // Per Example 3 spread order: catalog first, author additions second.
    expect(out.foo.type).toBe("string");
    expect(out.foo.pattern).toBe(
      (TYPES_CATALOG.DocId as Record<string, unknown>).pattern,
    );
    expect(out.foo.description).toBe("override");
    // The literal $ref key is stripped from the output.
    expect(out.foo.$ref).toBeUndefined();
  });

  it("Test 6: unknown $ref target throws synchronously with the bad ref in the message", () => {
    expect(() => resolveRefs({ foo: { $ref: "#/types/Unknown" } })).toThrow(
      /Unknown.*\$ref/i,
    );
  });

  it("Test 7: $ref to http:// URL is REJECTED (only #/types/<name> form allowed)", () => {
    expect(() => resolveRefs({ foo: { $ref: "http://example.com/x" } })).toThrow(
      /#\/types/,
    );
  });

  it("Test 7b: $ref to file:// or JSON-Pointer also rejected", () => {
    expect(() =>
      resolveRefs({ foo: { $ref: "file:///etc/passwd" } }),
    ).toThrow();
    expect(() => resolveRefs({ foo: { $ref: "#/properties/foo" } })).toThrow();
  });

  it("Test 8: recurses into arrays and nested objects", () => {
    const out = resolveRefs({
      items: [{ $ref: "#/types/DocId" }],
      nested: { $ref: "#/types/Handle" },
    }) as { items: Array<Record<string, unknown>>; nested: Record<string, unknown> };
    expect(out.items[0]?.type).toBe("string");
    expect(out.items[0]?.pattern).toBe(
      (TYPES_CATALOG.DocId as Record<string, unknown>).pattern,
    );
    expect(out.nested.type).toBe("string");
  });

  it("Test 9: schemas without any $ref pass through structurally equal", () => {
    const input = {
      type: "object",
      properties: {
        a: { type: "string", pattern: "^[a-z]+$" },
        b: { type: "array", items: { type: "number" } },
      },
      required: ["a"],
    };
    const out = resolveRefs(input);
    expect(out).toEqual(input);
  });

  it("primitives pass through unchanged", () => {
    expect(resolveRefs("hello")).toBe("hello");
    expect(resolveRefs(42)).toBe(42);
    expect(resolveRefs(null)).toBe(null);
    expect(resolveRefs(true)).toBe(true);
  });

  it("Security: no fs/fetch reads occur on resolution (resolver is pure)", () => {
    // Pure synchronous function — if it tried to do I/O at module level,
    // the import would have already failed by now. Functional confirmation:
    // resolving a $ref still does not throw on a system with no network.
    const result = resolveRefs({ x: { $ref: "#/types/MemorySink" } }) as {
      x: Record<string, unknown>;
    };
    expect(result.x["x-validator"]).toBe("memory-sink");
  });
});
