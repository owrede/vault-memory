/**
 * zod-to-form.test.ts — Phase 7 / Plan 07-05 / Task 1.
 *
 * Pattern F doc-block: D-FORMAT-SCHEMA (UI-SPEC §"Properties Inspector"
 * — typed forms generated from each verb's Zod schema). The generator
 * walks Zod 4 schemas and emits a plain `FormDescriptor` so the Svelte
 * inspector can be unit-tested without rendering.
 *
 * Test coverage per Plan 07-05 §Task 1 acceptance:
 *   1. `z.string()` → string field, required.
 *   2. `z.number().min(0)` → number field, required.
 *   3. `z.optional(z.string())` → string field, required: false.
 *   4. `z.enum(["a","b","c"])` → enum field with enum values.
 *   5. Nested `z.object({...})` → nested descriptor.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToForm } from "./zod-to-form.js";

describe("zodToForm", () => {
  it("emits a string field for z.string()", () => {
    const schema = z.object({ name: z.string() });
    const form = zodToForm(schema);
    expect(form.fields).toHaveLength(1);
    expect(form.fields[0]).toMatchObject({
      key: "name",
      type: "string",
      required: true,
    });
  });

  it("emits a number field for z.number().min(0), required", () => {
    const schema = z.object({ count: z.number().min(0) });
    const form = zodToForm(schema);
    expect(form.fields[0]).toMatchObject({
      key: "count",
      type: "number",
      required: true,
    });
  });

  it("treats z.optional(z.string()) as required:false", () => {
    const schema = z.object({ note: z.string().optional() });
    const form = zodToForm(schema);
    expect(form.fields[0]).toMatchObject({
      key: "note",
      type: "string",
      required: false,
    });
  });

  it("emits an enum field with enum values for z.enum([...])", () => {
    const schema = z.object({ direction: z.enum(["in", "out", "both"]) });
    const form = zodToForm(schema);
    expect(form.fields[0]?.type).toBe("enum");
    expect(form.fields[0]?.enum).toEqual(["in", "out", "both"]);
  });

  it("emits a nested descriptor for z.object(...)", () => {
    const schema = z.object({
      outer: z.object({ inner: z.string() }),
    });
    const form = zodToForm(schema);
    expect(form.fields[0]?.type).toBe("object");
    expect(form.fields[0]?.nested?.fields).toHaveLength(1);
    expect(form.fields[0]?.nested?.fields[0]?.key).toBe("inner");
    expect(form.fields[0]?.nested?.fields[0]?.type).toBe("string");
  });

  it("emits an array field for z.array(...)", () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const form = zodToForm(schema);
    expect(form.fields[0]?.type).toBe("array");
  });

  it("emits a boolean field for z.boolean()", () => {
    const schema = z.object({ flag: z.boolean() });
    const form = zodToForm(schema);
    expect(form.fields[0]?.type).toBe("boolean");
  });

  it("emits an alias-ref type when the field description includes 'alias-ref'", () => {
    const schema = z.object({
      seed_doc_ids: z.string().describe("alias-ref: {{step.field}}"),
    });
    const form = zodToForm(schema);
    expect(form.fields[0]?.type).toBe("alias-ref");
  });
});
