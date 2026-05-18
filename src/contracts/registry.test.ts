/**
 * Unit tests for ContractRegistry (Phase 6 / D-A1c, C-4).
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ContractRegistry } from "./registry.js";
import type { ParsedContract } from "./types.js";

function fakeContract(name: string, description = "fake"): ParsedContract {
  return {
    version: 1,
    name,
    description,
    inputs: {},
    required: [],
    sources: {},
    sinks: {},
    assembly: [{ as: "literal_step", verb: "literal", value: "x" }],
    inputZodSchema: z.object({}),
    inputJsonSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  };
}

describe("ContractRegistry (D-A1c, Invariant C-4)", () => {
  it("Test 4: empty registry has size 0", () => {
    const r = new ContractRegistry();
    expect(r.size).toBe(0);
  });

  it("Test 5: set + get round-trip", () => {
    const r = new ContractRegistry();
    const c = fakeContract("meeting-prep");
    expect(r.set("meeting-prep", c)).toEqual({ ok: true });
    expect(r.get("meeting-prep")).toBe(c);
    expect(r.size).toBe(1);
  });

  it("Test 6: duplicate set returns {ok:false, reason:'duplicate_name'} and does NOT replace", () => {
    const r = new ContractRegistry();
    const c1 = fakeContract("meeting-prep", "first");
    const c2 = fakeContract("meeting-prep", "second");
    expect(r.set("meeting-prep", c1)).toEqual({ ok: true });
    const result = r.set("meeting-prep", c2);
    expect(result).toEqual({ ok: false, reason: "duplicate_name" });
    // Original is still there — first-wins.
    expect(r.get("meeting-prep")).toBe(c1);
    expect(r.get("meeting-prep")?.description).toBe("first");
    expect(r.size).toBe(1);
  });

  it("Test 7: delete clears the first-wins lock", () => {
    const r = new ContractRegistry();
    const c1 = fakeContract("meeting-prep", "v1");
    const c2 = fakeContract("meeting-prep", "v2");
    r.set("meeting-prep", c1);
    expect(r.delete("meeting-prep")).toBe(true);
    expect(r.size).toBe(0);
    expect(r.set("meeting-prep", c2)).toEqual({ ok: true });
    expect(r.get("meeting-prep")?.description).toBe("v2");
  });

  it("delete returns false when name is not present", () => {
    const r = new ContractRegistry();
    expect(r.delete("nope")).toBe(false);
  });

  it("Test 8: entries() yields insertion order", () => {
    const r = new ContractRegistry();
    r.set("a", fakeContract("a"));
    r.set("b", fakeContract("b"));
    r.set("c", fakeContract("c"));
    const names = Array.from(r.entries()).map(([k]) => k);
    expect(names).toEqual(["a", "b", "c"]);
  });

  it("names() returns all registered contract names", () => {
    const r = new ContractRegistry();
    r.set("a", fakeContract("a"));
    r.set("b", fakeContract("b"));
    expect(r.names().sort()).toEqual(["a", "b"]);
  });
});
