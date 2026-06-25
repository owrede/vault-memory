/**
 * ContractDocumentSchema — Phase 7 / ADR-007 §D-FORMAT-SCHEMA.
 *
 * Zod schema for the `.contract` JSON document — the editor source of
 * truth the Obsidian plugin writes (D-AUTH). Wraps the Phase 6
 * `ContractFileSchema` BYREF: the `contract` block re-runs the exact
 * Phase 6 validation, so any contract that survives this schema is
 * automatically Phase-6 valid.
 *
 * Top-level invariants (D-FORMAT-SCHEMA):
 *   - `vmFormatVersion: 1` is the only accepted format version in
 *     v2.0.0. Future breaking format changes bump this literal; older
 *     readers reject the document explicitly.
 *   - `contract` re-validates via Phase 6 `ContractFileSchema`. Errors
 *     surface with the underlying Zod path intact.
 *   - `editor` carries plugin-only spatial state. Forward-compat:
 *     unknown editor keys are passed through (`passthrough`) so older
 *     plugins round-trip newer documents without dropping fields
 *     (ADR-007 §C-7-6).
 *   - `$schema` URI is optional metadata, accepted but not enforced
 *     verbatim — round-trip preserves it via the codec's JSON layer.
 *
 * # Adapter-seam discipline
 *
 * Imports only `zod` and the Phase 6 `./schema.js`. Zero `fs` / `path` /
 * `yaml` / `chokidar` / `gray-matter`. The codec (plugin/src/codec/) is
 * the only place YAML-specific code lives.
 */

import { z } from "zod";
import { ContractFileSchema } from "./schema.js";

/**
 * Editor-state block — plugin-only spatial layout that survives the
 * `.contract → .yaml → .contract` cycle as a base64-encoded comment
 * (see D-FORMAT2). Unknown keys pass through so future plugin versions
 * can extend additively without breaking older readers (ADR-007 C-7-6).
 */
const NodePositionSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .describe(
        "Node identity — assembly nodes use `step:<alias>` (matching `assembly[].as`); other prefixes reserved for forward compatibility",
      ),
    x: z.number().describe("Canvas X coordinate in CSS pixels"),
    y: z.number().describe("Canvas Y coordinate in CSS pixels"),
  })
  .passthrough()
  .describe("Spatial position for a single editor node");

const ViewportSchema = z
  .object({
    x: z.number().describe("Canvas viewport X offset"),
    y: z.number().describe("Canvas viewport Y offset"),
    zoom: z.number().describe("Canvas zoom factor (1.0 = 100%)"),
  })
  .passthrough()
  .describe("Editor viewport state");

const EditorStateSchema = z
  .object({
    nodes: z
      .array(NodePositionSchema)
      .describe(
        "One entry per editor node. Assembly steps appear as `step:<alias>` — additional non-step nodes (sources, sinks, etc.) are reserved for forward compatibility",
      ),
    selection: z
      .union([z.string(), z.array(z.string()), z.null()])
      .describe("Currently selected node id (single), array (multi), or null"),
    viewport: ViewportSchema,
    yamlComments: z
      .record(z.string(), z.unknown())
      .default({})
      .describe(
        "Preserved YAML comment payload — opaque map serialized into the emitted YAML by the codec (D-CANON)",
      ),
  })
  .passthrough()
  .describe(
    "Editor-only state block — plugins extend additively per ADR-007 §C-7-6 (unknown keys round-trip unchanged)",
  );

export const ContractDocumentSchema = z
  .object({
    $schema: z
      .literal("https://vault-memory.dev/schemas/contract-v1.json")
      .optional()
      .describe(
        "Optional JSON Schema reference URI per D-FORMAT-SCHEMA; preserved by the codec but not normative",
      ),
    vmFormatVersion: z
      .literal(1)
      .describe(
        "D-FORMAT-SCHEMA — v2.0.0 supports format version 1 only; bumps are reserved for breaking changes",
      ),
    contract: ContractFileSchema.describe(
      "Phase 6 contract block — re-validates via the verbatim ContractFileSchema (D-AUTH source of truth)",
    ),
    editor: EditorStateSchema.describe(
      "Plugin-only spatial state — survives YAML round-trip via the # vm-editor-state: base64 comment (D-FORMAT2)",
    ),
  })
  .describe("The `.contract` JSON document — editor source of truth per ADR-007 D-FORMAT-SCHEMA");

export type ContractDocumentShape = z.infer<typeof ContractDocumentSchema>;
export type EditorStateShape = z.infer<typeof EditorStateSchema>;
