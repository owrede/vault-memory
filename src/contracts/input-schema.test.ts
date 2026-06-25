/**
 * Unit tests for buildInputSchema (Phase 6 / D-A3a, Pitfall F1/F2, A3).
 *
 * Pitfall F1: z.fromJSONSchema must produce a real ZodObject;
 *             SDK 1.29 registerTool({inputSchema}) REJECTS raw JSON Schema.
 * Pitfall F2: additionalProperties:false must be set explicitly or typo'd
 *             keys are silently dropped at runtime.
 * Assumption A3: x-validator extension keyword survives fromJSONSchema
 *             unchanged.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildInputSchema } from "./input-schema.js";

describe("buildInputSchema (D-A3a, Pitfalls F1/F2, Assumption A3)", () => {
  it("Test 10: jsonSchema has additionalProperties:false (Pitfall F2 fix) and zodSchema is a ZodObject (Pitfall F1)", () => {
    const { zodSchema, jsonSchema } = buildInputSchema(
      { meeting_doc_id: { $ref: "#/types/DocId" } },
      ["meeting_doc_id"],
    );
    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.additionalProperties).toBe(false);
    expect(jsonSchema.required).toEqual(["meeting_doc_id"]);
    // Pitfall F1: zodSchema MUST be a ZodObject — SDK rejects plain JSON Schema.
    expect(zodSchema instanceof z.ZodObject).toBe(true);
  });

  it("Test 11: zod parse accepts a well-formed DocId, rejects malformed, rejects typo'd extra keys (Pitfall F2 regression)", () => {
    const { zodSchema } = buildInputSchema({ meeting_doc_id: { $ref: "#/types/DocId" } }, [
      "meeting_doc_id",
    ]);

    const okResult = zodSchema.safeParse({
      meeting_doc_id: "obsidian-fs://v/p.md",
    });
    expect(okResult.success).toBe(true);

    const badPatternResult = zodSchema.safeParse({
      meeting_doc_id: "no-scheme",
    });
    expect(badPatternResult.success).toBe(false);

    // Pitfall F2 regression — typo MUST be rejected, not silently dropped.
    const typoResult = zodSchema.safeParse({
      meeting_doc_id: "obsidian-fs://v/p.md",
      typo: 1,
    });
    expect(typoResult.success).toBe(false);
  });

  it("Test 12: x-validator extension keyword survives the round-trip (Assumption A3)", () => {
    const { jsonSchema } = buildInputSchema({ sink: { $ref: "#/types/MemorySink" } }, ["sink"]);
    const props = jsonSchema.properties as Record<string, Record<string, unknown>>;
    expect(props.sink?.["x-validator"]).toBe("memory-sink");
  });

  it("Test 13: jsonSchema is suitable for MCP tools/list pass-through (no Zod-only metadata leaks)", () => {
    const inputs = {
      query: { type: "string" as const, description: "a search query" },
    };
    const { jsonSchema } = buildInputSchema(inputs, ["query"]);
    // The returned jsonSchema MUST be plain object literals — no Symbols,
    // no Zod-only metadata. JSON-serialize/deserialize round-trip must be
    // structurally equal to the original.
    const roundTripped = JSON.parse(JSON.stringify(jsonSchema));
    expect(roundTripped).toEqual({
      type: "object",
      properties: { query: { type: "string", description: "a search query" } },
      required: ["query"],
      additionalProperties: false,
    });
  });

  it("required defaults to [] when omitted", () => {
    const { jsonSchema } = buildInputSchema({
      query: { type: "string" as const },
    });
    expect(jsonSchema.required).toEqual([]);
  });

  it("empty inputs produce a valid object schema (every-field-optional)", () => {
    const { zodSchema, jsonSchema } = buildInputSchema({});
    expect(jsonSchema.properties).toEqual({});
    expect(zodSchema.safeParse({}).success).toBe(true);
    // additionalProperties:false still applies — extra keys rejected.
    expect(zodSchema.safeParse({ extra: 1 }).success).toBe(false);
  });
});
