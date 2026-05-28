/**
 * MCP response helpers — `ok` / `errorResponse` / `errorResponseJson`.
 *
 * Extracted verbatim from `src/server.ts` (the bootstrap god-file). These
 * shape the `{ content: [{ type: "text", text }] }` / `isError` envelopes
 * the MCP SDK expects. Zero closure dependencies, zero runtime imports.
 *
 * # Adapter-seam discipline
 *
 * Pure helpers. No node:path / node:fs / chokidar / gray-matter imports.
 */

export function ok(data: object): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

export function errorResponse(message: string): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

/**
 * Structured `isError: true` response — the JSON payload is stringified
 * into the single `text` content block. Used by Phase 3 assembly tools
 * for the `{error: "doc_not_found", doc_id}` contract (plan 03-02).
 * Distinct from `errorResponse` (free-text) so callers can pattern-match
 * `JSON.parse(content[0].text).error === "doc_not_found"`.
 */
export function errorResponseJson(payload: object): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}
