/**
 * Zod schema for the `_contracts/memory/<name>.yaml` file format.
 *
 * The YAML on disk declares which property keys a `MemoryContract`
 * requires (with their allowed enum values, types, and defaults). The
 * loader (`./loader.ts`) reads the file, parses it via `yaml@^2.9.x`,
 * validates the parsed object against `MemoryContractYamlSchema`, then
 * walks the validated tree to BUILD a Zod `z.object(...)` schema for
 * validating `Document.properties` payloads at write time.
 *
 * The two-phase pipeline (validate-the-contract-shape, then
 * build-the-property-validator) keeps the contract grammar
 * declaratively validated by Zod itself — no hand-rolled walker.
 */

import { z } from "zod";

/**
 * A single property rule. `type` is the field's Zod-mapped value type;
 * `allowed` is an optional enum constraint; `default` is a literal
 * default; `items` is the per-element rule for arrays; `min_length`
 * applies to strings or arrays.
 */
export const PropertyRuleSchema = z.object({
  type: z.enum(["string", "datetime", "array", "doc_id", "number", "boolean", "reference", "date"]),
  allowed: z.array(z.string()).optional(),
  default: z.unknown().optional(),
  items: z.object({ type: z.string() }).optional(),
  min_length: z.number().optional(),
  /** When true, the property accepts `null` as a sentinel value (in
   *  addition to whatever `type` says). Used for required-but-null-by-
   *  default properties like `superseded_by` on active observations. */
  nullable: z.boolean().optional(),
});

export type PropertyRule = z.infer<typeof PropertyRuleSchema>;

/**
 * A cross-field rule. `when` is a simple boolean expression on
 * properties (e.g. `status == 'superseded'`); `require` is a
 * comma-separated or `&&`-joined list of keys that MUST be present and
 * non-empty when `when` evaluates true.
 *
 * Phase 2 ships a hardcoded interpretation for the only currently
 * required rule (status=superseded → superseded_by + superseded_reason
 * both non-empty); the schema accepts the declarative form so future
 * contracts (Phase 5+) can add their own without code changes.
 */
export const CrossFieldRuleSchema = z.object({
  when: z.string(),
  require: z.string(),
});

export type CrossFieldRule = z.infer<typeof CrossFieldRuleSchema>;

/**
 * Top-level contract shape. Mirrors the YAML in
 * `_contracts/memory/default-memory-v1.yaml`.
 */
export const MemoryContractYamlSchema = z.object({
  name: z.string().min(1),
  version: z.string().default("1.0"),
  required_properties: z.record(z.string(), PropertyRuleSchema),
  optional_properties: z.record(z.string(), PropertyRuleSchema).default({}),
  cross_field_rules: z.array(CrossFieldRuleSchema).default([]),
  naming: z.object({
    strategy: z.enum(["caller-provided", "date-slug", "adapter-assigned"]),
    pattern: z.string().optional(),
  }),
});

export type MemoryContractYaml = z.infer<typeof MemoryContractYamlSchema>;
