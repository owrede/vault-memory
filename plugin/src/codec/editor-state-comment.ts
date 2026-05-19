/**
 * editor-state-comment — Phase 7 / ADR-007 §D-FORMAT2.
 *
 * Encode + extract the `# vm-editor-state: <base64>` comment that
 * carries the editor's spatial state through the `.contract → .yaml`
 * round-trip. YAML parsers treat the line as a comment and ignore its
 * payload; the plugin importer reads it back to reconstruct the canvas
 * exactly. If the comment is absent (hand-authored YAML), the codec
 * falls back to a deterministic default layout — implemented in
 * `contract-codec.ts`.
 *
 * Format spec:
 *   - Header literal: `# vm-editor-state: ` (note the trailing space).
 *   - Payload: base64-encoded UTF-8 JSON of the editor state.
 *   - Single trailing newline (`\n`); MUST occupy YAML line 1 only.
 *
 * `vmFormatVersion` is embedded INSIDE the base64 payload as part of
 * the encoded object (ADR-007 §D-FORMAT2 resolved question 2) so future
 * format bumps survive `.yaml`-only round-trips. The wrapper here is
 * agnostic — it serializes whatever object the caller hands in.
 *
 * # Adapter-seam discipline
 *
 * Pure data transform using `Buffer` for base64. Zero `fs` / `obsidian`
 * / `yaml` / `chokidar`.
 */

import type { EditorStateShape } from "../shared-types.js";

/**
 * Literal prefix that prefixes the editor-state line. Exposed so tests
 * and downstream callers can grep without copying the string.
 */
export const EDITOR_COMMENT_PREFIX = "# vm-editor-state: ";

/**
 * Serialize editor state to the `# vm-editor-state: <base64>\n` header
 * line. Includes a trailing newline so callers can concatenate the body
 * unchanged.
 */
export function encodeEditorComment(editor: EditorStateShape): string {
  const json = JSON.stringify(editor);
  const base64 = Buffer.from(json, "utf8").toString("base64");
  return `${EDITOR_COMMENT_PREFIX}${base64}\n`;
}

/**
 * Extract the editor-state comment from a YAML text (if any). Strips a
 * single leading `# vm-editor-state: ...\n` line; returns the remaining
 * body unchanged.
 *
 *   - If the line is missing, `editor === null` and `body === yamlText`
 *     verbatim.
 *   - If the base64 payload fails to decode or parse, `editor === null`
 *     and `body` strips the (malformed) line — callers fall back to a
 *     default layout. We do not throw: a corrupt comment is recoverable
 *     by regenerating layout from `assembly` order.
 *   - Only ONE leading line is stripped — additional `# vm-editor-state`
 *     lines deeper in the file (if any) are left alone, matching the
 *     "first line only" invariant of D-FORMAT2.
 */
export function extractEditorComment(yamlText: string): {
  editor: EditorStateShape | null;
  body: string;
} {
  // The header MUST be on line 1. Anything else is "absent".
  const newlineIdx = yamlText.indexOf("\n");
  const firstLine = newlineIdx === -1 ? yamlText : yamlText.slice(0, newlineIdx);
  if (!firstLine.startsWith(EDITOR_COMMENT_PREFIX)) {
    return { editor: null, body: yamlText };
  }

  const remainder =
    newlineIdx === -1 ? "" : yamlText.slice(newlineIdx + 1);
  const base64 = firstLine.slice(EDITOR_COMMENT_PREFIX.length).trim();

  try {
    const json = Buffer.from(base64, "base64").toString("utf8");
    const parsed = JSON.parse(json) as EditorStateShape;
    return { editor: parsed, body: remainder };
  } catch {
    // Malformed payload — strip the (bad) line, fall back to no-editor.
    return { editor: null, body: remainder };
  }
}
