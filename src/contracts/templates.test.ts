/**
 * Tests for `resolveTemplate` — Plan 06-03 Task 1 (D-A2c, ADR-006 §Decision 5,
 * Invariant C-7).
 *
 * Behavior cases mirror RESEARCH Example 2 and the plan's 13 enumerated cases.
 * Pure-function tests — no fixtures, no fs, no network.
 */

import { describe, it, expect } from "vitest";
import { resolveTemplate, type TemplateBindings } from "./templates.js";

describe("resolveTemplate (D-A2c, C-7)", () => {
  it("Test 1: whole-string {{x}} returns the raw STRING value", () => {
    const r = resolveTemplate("{{inputs.name}}", {
      inputs: { name: "Atlas" },
      steps: {},
    });
    expect(r).toEqual({ ok: true, value: "Atlas" });
  });

  it("Test 2: whole-string {{x}} preserves the raw NUMBER value (not stringified)", () => {
    const r = resolveTemplate("{{step1.count}}", {
      inputs: {},
      steps: { step1: { count: 42 } },
    });
    expect(r).toEqual({ ok: true, value: 42 });
  });

  it("Test 3: whole-string {{x}} preserves the raw ARRAY value", () => {
    const r = resolveTemplate("{{step1.doc_ids}}", {
      inputs: {},
      steps: { step1: { doc_ids: ["a", "b"] } },
    });
    expect(r).toEqual({ ok: true, value: ["a", "b"] });
  });

  it("Test 4: embedded {{x}} string-concats", () => {
    const r = resolveTemplate("Brief for {{inputs.target}}", {
      inputs: { target: "Atlas" },
      steps: {},
    });
    expect(r).toEqual({ ok: true, value: "Brief for Atlas" });
  });

  it("Test 5: multiple embedded substitutions; non-string values JSON-stringified", () => {
    const r = resolveTemplate("{{a.x}} {{b.y}}", {
      inputs: {},
      steps: { a: { x: 1 }, b: { y: 2 } },
    });
    expect(r).toEqual({ ok: true, value: "1 2" });
  });

  it("Test 6: undefined alias → unresolved_template", () => {
    const r = resolveTemplate("{{nope.x}}", { inputs: {}, steps: {} });
    expect(r).toEqual({
      ok: false,
      reason: "unresolved_template",
      expression: "{{nope.x}}",
    });
  });

  it("Test 7: undefined field on a known alias → unresolved_template", () => {
    const r = resolveTemplate("{{step1.missing}}", {
      inputs: {},
      steps: { step1: { x: 1 } },
    });
    expect(r).toEqual({
      ok: false,
      reason: "unresolved_template",
      expression: "{{step1.missing}}",
    });
  });

  it("Test 8: recurses into objects + arrays, resolving each leaf string", () => {
    const r = resolveTemplate(
      { foo: "{{inputs.x}}", bar: ["{{inputs.y}}"] },
      { inputs: { x: "X", y: "Y" }, steps: {} },
    );
    expect(r).toEqual({ ok: true, value: { foo: "X", bar: ["Y"] } });
  });

  it("Test 9: non-string leaves pass through unchanged", () => {
    const r = resolveTemplate(
      { foo: 42, bar: null, baz: true },
      { inputs: {}, steps: {} },
    );
    expect(r).toEqual({ ok: true, value: { foo: 42, bar: null, baz: true } });
  });

  it("Test 10: plain string without {{ returns unchanged", () => {
    const r = resolveTemplate("plain text", { inputs: {}, steps: {} });
    expect(r).toEqual({ ok: true, value: "plain text" });
  });

  it("Test 11: field-path traversal supports nested + array-index notation", () => {
    const r = resolveTemplate("{{step1.nested.field[0]}}", {
      inputs: {},
      steps: { step1: { nested: { field: ["a", "b"] } } },
    });
    expect(r).toEqual({ ok: true, value: "a" });
  });

  it("Test 12: first unresolved template in an object short-circuits", () => {
    const r = resolveTemplate(
      { a: "{{ok.x}}", b: "{{bad.y}}" },
      { inputs: {}, steps: { ok: { x: 1 } } },
    );
    expect(r).toEqual({
      ok: false,
      reason: "unresolved_template",
      expression: "{{bad.y}}",
    });
  });

  it("Test 13 [C-7 critical invariant]: user-supplied input strings are NOT re-evaluated as templates", () => {
    // The user passes `inputs.x = "{{inputs.y}}"`. The contract says
    // `value: "{{inputs.x}}"`. Resolving `{{inputs.x}}` returns the
    // RAW string `"{{inputs.y}}"`, not a recursive substitution to
    // `inputs.y`. This is the C-7 security invariant.
    const bindings: TemplateBindings = {
      inputs: { x: "{{inputs.y}}", y: "secret" },
      steps: {},
    };
    const r = resolveTemplate("{{inputs.x}}", bindings);
    expect(r).toEqual({ ok: true, value: "{{inputs.y}}" });
  });
});
