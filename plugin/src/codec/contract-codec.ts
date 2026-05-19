/**
 * contract-codec — Phase 7 / ADR-007 §D-FORMAT, D-FORMAT2, D-AUTH, D-CANON.
 *
 * Round-trip layer between the `.contract` JSON envelope (editor source
 * of truth per D-AUTH) and the Phase 6 `_contracts/*.yaml` build
 * artifact. Composes three pure modules:
 *
 *   - `canonicalize`   — stabilizes field order + applies default-
 *                        omission rules on emission (D-CANON).
 *   - `editor-state-comment` — encodes / extracts the
 *                        `# vm-editor-state: <base64>` header (D-FORMAT2).
 *   - `yaml ^2.9.0` `parseDocument` — comment-preserving YAML I/O.
 *
 * Public surface:
 *   - `emitYaml(file: ContractDocumentShape): string` — serialize.
 *   - `parseYaml(text: string): ContractDocumentShape` — parse + validate.
 *
 * Round-trip invariant: `parseYaml(emitYaml(f))` deepEquals `f` for any
 * `ContractDocumentSchema`-valid `f`.
 *
 * When the editor-state comment is absent (e.g., user hand-authored
 * the YAML directly), `parseYaml` falls back to a deterministic
 * default layout per ADR-007 §D-FORMAT2: a left-to-right grid of
 * 220×120 px slots, one per assembly step, ordered as the assembly
 * array appears in YAML. No data loss — only spatial layout
 * regenerates.
 *
 * Validation failures propagate verbatim: the underlying ZodError is
 * thrown so callers see the field path that failed.
 *
 * # Adapter-seam discipline
 *
 * Imports `yaml ^2.9.0` (the only YAML-specific code path in the
 * plugin) plus `zod` and the three sibling codec modules. Zero `fs` /
 * `obsidian` / `chokidar` / `gray-matter`. The codec is a pure data
 * transform; FS I/O is the caller's responsibility (the Obsidian view
 * goes through `app.vault.adapter.write`).
 */

import { parseDocument, stringify as yamlStringify } from "yaml";
import {
  ContractDocumentSchema,
  ContractFileSchema,
  type ContractDocumentShape,
  type ContractFileShape,
  type EditorStateShape,
} from "../shared-types.js";
import { canonicalizeContract } from "./canonicalize.js";
import {
  encodeEditorComment,
  extractEditorComment,
} from "./editor-state-comment.js";

/**
 * Default-layout grid constants (UI-SPEC §"Default node layout").
 * 220×120 px slots, single row left-to-right ordered by assembly index.
 */
const DEFAULT_NODE_DX = 220;
const DEFAULT_NODE_DY = 120;
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 } as const;

/**
 * Serialize a `.contract` document to canonical YAML. Output starts
 * with the `# vm-editor-state: <base64>` header (always present, per
 * D-FORMAT2), followed by the canonicalized Phase 6 contract YAML.
 */
export function emitYaml(file: ContractDocumentShape): string {
  // Canonicalize field order + apply default-omission rules.
  const canonical = canonicalizeContract(file.contract);

  // Serialize via `yaml.stringify` which produces canonical, key-order-
  // preserving YAML 1.2 output. `parseDocument` (used on the parse path)
  // is the comment-preservation chokepoint; emission goes through the
  // simpler `stringify` because the canonical form has no comments to
  // round-trip — the editor-state header is prepended as raw text below.
  //
  // Default styling matches Phase 6 fixtures: block style maps + flow
  // arrays inherit yaml package defaults. `lineWidth: 0` disables
  // automatic line wrapping so long strings (e.g., descriptions) stay
  // on one line for stable diffs.
  const yamlBody = yamlStringify(canonical, { lineWidth: 0 });

  // Prepend the editor-state header. The header line is always present
  // on emission so that even the very first save round-trips losslessly.
  const header = encodeEditorComment(file.editor);

  return header + yamlBody;
}

/**
 * Parse a `_contracts/*.yaml` text into a `.contract` document. Strips
 * the editor-state header (if any), runs the Phase 6 `ContractFileSchema`
 * over the body, and wraps the result in `ContractDocumentSchema`.
 *
 * @throws ZodError if the inner contract fails Phase 6 validation.
 */
export function parseYaml(yamlText: string): ContractDocumentShape {
  const { editor: parsedEditor, body } = extractEditorComment(yamlText);

  // Phase 6 path: parse YAML + validate ContractFileSchema.
  const doc = parseDocument(body);
  const rawContract = doc.toJS() as unknown;
  const contractResult = ContractFileSchema.safeParse(rawContract);
  if (!contractResult.success) {
    // Propagate the underlying Zod error with field path intact.
    throw contractResult.error;
  }
  const contract: ContractFileShape = contractResult.data;

  // Editor block: from comment if present, otherwise synthesize a
  // deterministic default layout per ADR-007 §D-FORMAT2.
  const editor: EditorStateShape =
    parsedEditor ?? buildDefaultEditorState(contract);

  // Final validation wraps everything via ContractDocumentSchema.
  const docResult = ContractDocumentSchema.safeParse({
    vmFormatVersion: 1,
    contract,
    editor,
  });
  if (!docResult.success) {
    throw docResult.error;
  }
  return docResult.data;
}

/**
 * Deterministic LTR layout: one node per assembly step at
 * `(i * 220, 0)`. Selection = null, viewport = origin, no preserved
 * comments. Stable for the same input contract — no Date / random.
 */
function buildDefaultEditorState(contract: ContractFileShape): EditorStateShape {
  const nodes = contract.assembly.map((step, i) => ({
    id: `step:${step.as}`,
    x: i * DEFAULT_NODE_DX,
    y: 0 * DEFAULT_NODE_DY,
  }));
  return {
    nodes,
    selection: null,
    viewport: { ...DEFAULT_VIEWPORT },
    yamlComments: {},
  };
}
