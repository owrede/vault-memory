/**
 * Unit tests for canonicalize (Phase 7 / ADR-007 §D-CANON).
 */

import { describe, it, expect } from "vitest";
import {
  canonicalizeContract,
  CANONICAL_KEY_ORDER,
} from "./canonicalize.js";
import type { ContractFileShape } from "../shared-types.js";

function shape(partial: Partial<ContractFileShape>): ContractFileShape {
  return {
    version: 1,
    name: "test",
    description: "",
    inputs: {},
    required: [],
    sources: {},
    sinks: {},
    assembly: [{ as: "step", verb: "literal", value: 1 }],
    ...partial,
  } as ContractFileShape;
}

describe("CANONICAL_KEY_ORDER", () => {
  it("matches the ADR-006 §Decision 2 schema field order exactly", () => {
    expect([...CANONICAL_KEY_ORDER]).toEqual([
      "version",
      "name",
      "description",
      "inputs",
      "sources",
      "sinks",
      "assembly",
      "output_shape",
      "write_back",
      "required",
    ]);
  });
});

describe("canonicalizeContract (D-CANON)", () => {
  it("emits keys in canonical order regardless of input insertion order", () => {
    // Build a deliberately scrambled object.
    const scrambled: Record<string, unknown> = {
      write_back: undefined,
      assembly: [{ verb: "literal", as: "x", value: 1 }],
      name: "scrambled-input",
      required: ["x"],
      version: 1,
      description: "scrambled order on input",
      inputs: { x: { type: "string" } },
      sources: {},
      sinks: {},
    };
    // Remove undefined `write_back` so the canonicalize step doesn't carry it.
    delete scrambled.write_back;

    const out = canonicalizeContract(scrambled as ContractFileShape);
    const emittedKeys = Object.keys(out as object);
    // version must come first, required last among the keys actually present.
    expect(emittedKeys[0]).toBe("version");
    // The emitted order must be a subsequence of CANONICAL_KEY_ORDER.
    let cursor = -1;
    for (const k of emittedKeys) {
      const idx = (CANONICAL_KEY_ORDER as readonly string[]).indexOf(k);
      expect(idx).toBeGreaterThan(cursor);
      cursor = idx;
    }
  });

  it("omits `required: true` on handle declarations (Phase 6 Zod default)", () => {
    const input = shape({
      sources: {
        s1: { handle: "obsidian-fs://v", required: true },
      },
      sinks: {
        k1: { handle: "_memory/_briefs", required: true },
      },
    });
    const out = canonicalizeContract(input) as unknown as {
      sources: Record<string, Record<string, unknown>>;
      sinks: Record<string, Record<string, unknown>>;
    };
    expect("required" in (out.sources.s1 ?? {})).toBe(false);
    expect("required" in (out.sinks.k1 ?? {})).toBe(false);
    expect((out.sources.s1 ?? {}).handle).toBe("obsidian-fs://v");
  });

  it("preserves `required: false` on handle declarations (not the default)", () => {
    const input = shape({
      sources: {
        s1: { handle: "obsidian-fs://v", required: false },
      },
    });
    const out = canonicalizeContract(input) as unknown as {
      sources: Record<string, Record<string, unknown>>;
    };
    expect((out.sources.s1 ?? {}).required).toBe(false);
  });

  it("emits assembly step keys in canonical order (as, verb, args, value)", () => {
    const input = shape({
      assembly: [
        // Deliberately scrambled key order on input.
        {
          value: 42,
          args: { a: 1 },
          verb: "literal",
          as: "alpha",
        } as ContractFileShape["assembly"][number],
      ],
    });
    const out = canonicalizeContract(input);
    const step = (out.assembly as Array<Record<string, unknown>>)[0];
    expect(step).toBeDefined();
    expect(Object.keys(step ?? {})).toEqual(["as", "verb", "args", "value"]);
  });

  it("preserves nested inputs/args object key order (Phase 6 allows arbitrary)", () => {
    const input = shape({
      inputs: {
        // Build a record whose property iteration order is preserved.
        first: { type: "string" },
        second: { type: "integer" },
      },
    });
    const out = canonicalizeContract(input);
    expect(Object.keys(out.inputs as Record<string, unknown>)).toEqual([
      "first",
      "second",
    ]);
  });

  it("is idempotent: canonicalize(canonicalize(x)) deepEqual canonicalize(x)", () => {
    const input = shape({
      sources: { s1: { handle: "h", required: true } },
      assembly: [
        { value: 1, verb: "literal", as: "a" } as ContractFileShape["assembly"][number],
      ],
    });
    const once = canonicalizeContract(input);
    const twice = canonicalizeContract(once);
    expect(twice).toEqual(once);
  });

  it("does not mutate the input object", () => {
    const input = shape({
      sources: { s1: { handle: "h", required: true } },
    });
    const before = JSON.stringify(input);
    canonicalizeContract(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("preserves forward-compat handle keys after canonical ones", () => {
    const input = shape({
      sources: {
        s1: {
          handle: "h",
          required: false,
          // Future-compat key — must survive canonicalize unchanged.
          futureMeta: { extra: 1 },
        } as ContractFileShape["sources"][string],
      },
    });
    const out = canonicalizeContract(input) as unknown as {
      sources: Record<string, Record<string, unknown>>;
    };
    expect((out.sources.s1 ?? {}).futureMeta).toEqual({ extra: 1 });
    const keys = Object.keys(out.sources.s1 ?? {});
    expect(keys.indexOf("handle")).toBeLessThan(keys.indexOf("futureMeta"));
  });
});
