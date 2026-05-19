/**
 * zod-to-form — Phase 7 / Plan 07-05 / D-FORMAT-SCHEMA.
 *
 * Walks a Zod 4 schema and emits a plain-data `FormDescriptor` the
 * Svelte inspector renders. Output is decoupled from any UI framework
 * so the generator is unit-testable without a DOM.
 *
 * # Why hand-rolled instead of `.toJSONSchema()`?
 *
 *   RESEARCH §5 ("Don't Hand-Roll" "Zod-to-form renderer") explicitly
 *   recommends a ~150 LOC hand-rolled traversal. `.toJSONSchema()` loses
 *   the `.describe()` annotations the inspector needs (e.g. the
 *   "alias-ref" marker for `{{alias.field}}` fields). Walking
 *   `schema.def` keeps the descriptions and lets us emit a domain-
 *   specific `FormDescriptor` rather than a generic JSON Schema.
 *
 * # Supported Zod 4 nodes
 *
 *   - `z.string()`         → `{ type: "string" }`
 *   - `z.number()`         → `{ type: "number" }`
 *   - `z.boolean()`        → `{ type: "boolean" }`
 *   - `z.enum([...])`      → `{ type: "enum", enum: [...] }`
 *   - `z.array(inner)`     → `{ type: "array" }` (inner walked but
 *                            not surfaced; the ArrayEditor renders rows)
 *   - `z.object(shape)`    → `{ type: "object", nested: <recur> }`
 *   - `z.optional(inner)`  → `required: false` + carries the inner type
 *
 * # alias-ref detection
 *
 *   A field's `.describe(...)` text that contains the literal substring
 *   `"alias-ref"` upgrades the emitted type from `string` to
 *   `alias-ref`. The inspector swaps the plain text input for an
 *   AliasPicker widget that autocompletes `{{alias.field}}` references.
 *
 * # Adapter-seam discipline
 *
 *   Imports `zod` only. No `obsidian` / `fs` / `yaml` / Svelte runtime.
 */

import type { z } from "zod";

export type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "alias-ref"
  | "object"
  | "array";

export interface FieldDescriptor {
  /** Object key in the parent shape (e.g. `query`, `seed_doc_ids`). */
  key: string;
  /** Widget kind the inspector should render. */
  type: FieldType;
  /** True unless the field is wrapped in `z.optional(...)`. */
  required: boolean;
  /** Free-text description sourced from `.describe(...)`. */
  description?: string;
  /** For `enum` types: the closed set of legal values. */
  enum?: readonly string[];
  /** For `object` types: the nested form descriptor. */
  nested?: FormDescriptor;
  /** UX hint surfaced as the input's HTML `placeholder`. */
  placeholder?: string;
}

export interface FormDescriptor {
  fields: FieldDescriptor[];
}

/** Internal projection of a Zod node into its descriptive parts. */
interface UnwrappedField {
  type: FieldType;
  required: boolean;
  enum?: readonly string[];
  nested?: FormDescriptor;
  description?: string;
}

/** Read `.describe(...)` text from any Zod node. Zod 4 stores it on the schema instance. */
function readDescription(schema: unknown): string | undefined {
  if (schema && typeof schema === "object" && "description" in schema) {
    const d = (schema as { description?: unknown }).description;
    if (typeof d === "string") return d;
  }
  return undefined;
}

/** Read the `.def.type` discriminator from a Zod 4 schema. */
function readDefType(schema: unknown): string | undefined {
  if (schema && typeof schema === "object" && "def" in schema) {
    const def = (schema as { def?: unknown }).def;
    if (def && typeof def === "object" && "type" in def) {
      const t = (def as { type?: unknown }).type;
      if (typeof t === "string") return t;
    }
  }
  return undefined;
}

/** Walk a single Zod node and return its `FieldType` + structural hints. */
function unwrap(schema: unknown): UnwrappedField {
  const description = readDescription(schema);
  const defType = readDefType(schema);

  // Optional wrapper — recurse into innerType, then mark required:false.
  if (defType === "optional" || defType === "nullable" || defType === "default") {
    const inner = (schema as { def: { innerType?: unknown } }).def.innerType;
    const innerUnwrapped = unwrap(inner);
    return {
      ...innerUnwrapped,
      required: false,
      description: description ?? innerUnwrapped.description,
    };
  }

  if (defType === "string") {
    // alias-ref upgrade — drive the AliasPicker widget when the field
    // explicitly marks itself as a template-expression slot.
    if (description && description.toLowerCase().includes("alias-ref")) {
      return { type: "alias-ref", required: true, description };
    }
    return { type: "string", required: true, description };
  }

  if (defType === "number" || defType === "int" || defType === "bigint") {
    return { type: "number", required: true, description };
  }

  if (defType === "boolean") {
    return { type: "boolean", required: true, description };
  }

  if (defType === "enum") {
    const entries = (schema as { def: { entries?: Record<string, unknown> } }).def
      .entries;
    const values = entries ? Object.values(entries).map(String) : [];
    return {
      type: "enum",
      required: true,
      enum: Object.freeze(values),
      description,
    };
  }

  if (defType === "array") {
    return { type: "array", required: true, description };
  }

  if (defType === "object") {
    const shape =
      ((schema as { def: { shape?: Record<string, unknown> } }).def.shape) ?? {};
    const nested: FormDescriptor = {
      fields: Object.entries(shape).map(([key, child]) => describeField(key, child)),
    };
    return { type: "object", required: true, nested, description };
  }

  // Unknown / unsupported Zod node — emit a string field so the user
  // still sees a text input. Logging is out of scope for the generator.
  return { type: "string", required: true, description };
}

/** Combine `unwrap` with the field key. */
function describeField(key: string, schema: unknown): FieldDescriptor {
  const u = unwrap(schema);
  const field: FieldDescriptor = {
    key,
    type: u.type,
    required: u.required,
  };
  if (u.description !== undefined) field.description = u.description;
  if (u.enum !== undefined) field.enum = u.enum;
  if (u.nested !== undefined) field.nested = u.nested;
  return field;
}

/**
 * Top-level entry point. Pass any `z.object({...})` schema and receive
 * the descriptor. Non-object schemas return a single-field descriptor
 * keyed `value`, which keeps the inspector's contract uniform.
 */
export function zodToForm(schema: z.ZodTypeAny): FormDescriptor {
  const defType = readDefType(schema);
  if (defType === "object") {
    const shape =
      ((schema as unknown as { def: { shape?: Record<string, unknown> } }).def
        .shape) ?? {};
    return {
      fields: Object.entries(shape).map(([key, child]) => describeField(key, child)),
    };
  }
  // Allow non-object top-level (e.g. z.union, z.string) — wrap as
  // single field. Production verb input schemas are all objects.
  return { fields: [describeField("value", schema)] };
}
