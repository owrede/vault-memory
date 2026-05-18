/**
 * ContractFileSchema — Phase 6 / CON-01, ADR-006 §Decision 2.
 *
 * Zod schema for the YAML contract file shape. Plan 06-02's loader will
 * call `parseDocument(yamlText).toJS()` and feed the result here.
 *
 * Invariants enforced structurally:
 *   - C-1: closed `assembly[].verb` set (11 baseline + literal + mcp://).
 *           No write verbs in the enum — writes happen exclusively via
 *           the structurally-separate `write_back:` block.
 *   - Step aliases are unique across the assembly array (superRefine).
 *   - `version: 1` is the only supported version in v2.0.0 (additive
 *     evolution lands as `z.union([z.literal(1), z.literal(2)])` later).
 *
 * Authoring style mirrors `src/memory/contract/default-v1.ts`:
 * `.describe()` on every public field, `.superRefine` for cross-field
 * invariants.
 *
 * Adapter-seam discipline: only `zod`. Zero `fs`/`path.join`/`gray-matter`/
 * `chokidar`/`yaml`.
 */

import { z } from "zod";

const BASELINE_VERBS = [
  "search_hybrid",
  "expand",
  "cluster",
  "recall",
  "compile_brief",
  "get_brief",
  "query_frontmatter",
  "list_backlinks",
  "get_outline",
  "search_sections",
  "read_note",
] as const;

const MCP_VERB_RE = /^mcp:\/\/[a-z][a-z0-9_-]*\/[a-z][a-z0-9_-]*$/;

/**
 * Verb schema = closed enum (baseline + literal) OR mcp:// peer pattern.
 * Anything else — including any v1 write tool name — fails validation.
 */
const VerbSchema = z.union([
  z.enum([...BASELINE_VERBS, "literal"]),
  z.string().regex(MCP_VERB_RE),
]);

const StepSchema = z
  .object({
    as: z
      .string()
      .min(1)
      .regex(/^[a-z_][a-z0-9_]*$/, "alias must be snake_case")
      .describe("D-A2c — unique snake_case alias for this step's output"),
    verb: VerbSchema.describe(
      "Closed enum + literal + mcp:// extension (D-A2a / C-1)",
    ),
    args: z.record(z.string(), z.unknown()).optional(),
    value: z.unknown().optional(),
  })
  .describe("One step in an assembly: array");

const HandleDeclSchema = z
  .object({
    handle: z.string().min(1),
    required: z.boolean().default(true),
  })
  .describe("Source or sink handle declaration (D-A4a)");

const WriteBackSchema = z
  .object({
    sink: z
      .string()
      .min(1)
      .describe("Template expression OR literal sink handle"),
    document_kind: z.enum(["brief", "observation", "custom"]),
    properties: z.record(z.string(), z.unknown()).default({}),
    body_from: z
      .string()
      .min(1)
      .describe("Template expression that resolves to the body string"),
  })
  .describe(
    "DeliveryAdapter.write chokepoint — only ground-truth DocId source (C-3)",
  );

export const ContractFileSchema = z
  .object({
    version: z
      .literal(1)
      .describe("v2.0.0 supports version 1 only; v2.x may extend additively"),
    name: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9-]*$/, "name must be kebab-case")
      .describe("Contract name — used by instantiate_contract and slugify"),
    description: z.string().default(""),
    inputs: z.record(z.string(), z.unknown()).default({}),
    required: z.array(z.string()).default([]),
    sources: z.record(z.string(), HandleDeclSchema).default({}),
    sinks: z.record(z.string(), HandleDeclSchema).default({}),
    assembly: z.array(StepSchema).min(1, "assembly must contain at least one step"),
    output_shape: z.unknown().optional(),
    write_back: WriteBackSchema.optional(),
  })
  .superRefine((data, ctx) => {
    // D-A2c: every step alias is unique across the assembly array.
    const aliases = new Set<string>();
    for (const step of data.assembly) {
      if (aliases.has(step.as)) {
        ctx.addIssue({
          code: "custom",
          path: ["assembly"],
          message: `duplicate step alias '${step.as}'`,
        });
      }
      aliases.add(step.as);
    }
  });

export type ContractFileShape = z.infer<typeof ContractFileSchema>;
