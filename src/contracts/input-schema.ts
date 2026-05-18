/**
 * buildInputSchema — Phase 6 / D-A3a, ADR-006 §Decision 6.
 *
 * Wraps the YAML author's flat `inputs:` form into the canonical
 * `{type:'object', properties, required, additionalProperties: false}`
 * envelope, resolves `$ref` against TYPES_CATALOG, then produces a
 * `ZodObject` via `z.fromJSONSchema`.
 *
 * Pitfall F1: SDK 1.29 `registerTool({inputSchema})` REJECTS raw JSON
 *   Schema literals — the inputSchema must be a real Zod schema.
 *   `z.fromJSONSchema` is the chokepoint that converts the JSON shape
 *   into a Zod schema the SDK accepts.
 *
 * Pitfall F2: `z.fromJSONSchema` honors `additionalProperties` from the
 *   input. WITHOUT explicit `additionalProperties: false`, typo'd input
 *   keys are silently dropped at runtime. The wrapper sets this
 *   explicitly — verified by Test 11.
 *
 * Assumption A3 (verified by Test 12): the `"x-validator": "memory-sink"`
 *   extension keyword passes through `z.fromJSONSchema` unchanged. The
 *   memory-sink validation happens at instantiation time (Plan 06-03)
 *   by inspecting the `jsonSchema.properties.*["x-validator"]` field —
 *   NOT the Zod schema.
 *
 * Adapter-seam discipline: only `zod` is imported. Zero `fs`/`path.join`/
 * `gray-matter`/`chokidar`/`yaml`.
 */

import { z } from "zod";
import { resolveRefs } from "./json-schema-ref.js";

export interface BuiltInputSchema {
  zodSchema: z.ZodObject<z.ZodRawShape>;
  jsonSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

export function buildInputSchema(
  yamlInputs: Record<string, unknown>,
  required: string[] = [],
): BuiltInputSchema {
  const resolvedProperties = resolveRefs(yamlInputs) as Record<string, unknown>;
  const jsonSchema = {
    type: "object" as const,
    properties: resolvedProperties,
    required,
    additionalProperties: false as const,
  };
  // Pitfall F1: fromJSONSchema produces a ZodObject the SDK accepts.
  // Cast is safe — we always pass an `object`-typed JSON Schema in.
  // Zod's `fromJSONSchema` accepts `JSONSchema` whose property bag is
  // typed as `Record<string, _JSONSchema>` — our `unknown` map is
  // structurally compatible at runtime (the contract YAML is JSON
  // Schema by construction), but TypeScript needs an explicit cast.
  const zodSchema = z.fromJSONSchema(
    jsonSchema as unknown as Parameters<typeof z.fromJSONSchema>[0],
  ) as z.ZodObject<z.ZodRawShape>;
  return { zodSchema, jsonSchema };
}
