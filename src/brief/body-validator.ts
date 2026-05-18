/**
 * Phase 5 / D-11 — Brief body validator.
 *
 * Every brief carries a body that the LLM ladder produced. The
 * Phase 4 D-02 indexer materializes typed `wikilink` edges by parsing
 * `[[Title]]` references during the next index pass. To guarantee the
 * brief participates in the graph layer (so `expand` / `cluster` /
 * `list_backlinks` surface it), every cited source must appear in the
 * body as a wikilink — `[[Title]]` (preferred), `[[Title|alias]]`,
 * `[[Title#heading]]`, or `[[<DocId>]]` (escape hatch).
 *
 * `validateAndPatchBody` is pure:
 *   - Parses every `[[...]]` reference using the SAME regex Phase 4's
 *     `src/indexer/extract-edges.ts` uses (any drift would break
 *     `back-edge materialization`).
 *   - Resolves each source DocId to a `Title` via `resolveTitle`.
 *   - Collects DocIds that are NOT referenced (neither as title nor
 *     as bare DocId).
 *   - Appends `\n\n## Sources\n- [[Title]]` per missing entry. The
 *     footer is deliberately a markdown section so it round-trips
 *     through gray-matter / js-yaml without semantic loss.
 *
 * Body validators that succeed return the body unchanged (byte-stable
 * — no whitespace insertion). Validators that patch return the
 * original body plus the footer; the LLM output is never mutated
 * mid-body.
 *
 * Pure module. No fs / gray-matter / chokidar / path imports.
 */

import type { DocId } from "../types.js";

/**
 * Wikilink regex matching `[[Title]]`, `[[Title|alias]]`,
 * `[[Title#heading]]`, `[[Title#heading|alias]]`. Mirrors the pattern
 * `src/indexer/extract-edges.ts` uses so Phase 4 indexer back-edges
 * stay consistent.
 *
 * Note: the capture group extracts the bare title (everything before
 * `|` or `#`); the validator compares this against `resolveTitle(id)`
 * AND against the raw `id` (DocId escape hatch).
 */
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

/**
 * Validate the brief body for D-11 compliance; if any source is
 * missing a wikilink, append a `## Sources` footer naming the missing
 * entries.
 *
 * `resolveTitle(id)` returns the canonical title for a DocId — used
 * both for matching and for the patched footer. The controller threads
 * this through `(id) => vault.db.notes.getByPath(resource)?.title ?? id`.
 */
export function validateAndPatchBody(
  body: string,
  sourceDocIds: readonly DocId[],
  resolveTitle: (id: DocId) => string,
): string {
  // Collect every wikilink target from the body (titles only — alias
  // and heading suffix are stripped by the regex group). Track BOTH
  // the raw match AND the trimmed match so callers can include
  // titles with trailing whitespace without surprise.
  const cited = new Set<string>();
  for (const m of body.matchAll(WIKILINK_RE)) {
    const target = m[1]?.trim();
    if (target !== undefined && target.length > 0) cited.add(target);
  }

  // For each source, accept any one of:
  //   - the resolved title (e.g. "Atlas-1")
  //   - the bare DocId (escape hatch — the LLM may emit
  //     `[[obsidian-fs://vault/notes/atlas-1.md]]` when it doesn't
  //     know the human title).
  const missing: DocId[] = [];
  for (const id of sourceDocIds) {
    const title = resolveTitle(id);
    if (cited.has(title) || cited.has(id)) continue;
    missing.push(id);
  }

  if (missing.length === 0) return body;

  const footerLines = missing.map((id) => `- [[${resolveTitle(id)}]]`);
  const footer = `\n\n## Sources\n${footerLines.join("\n")}\n`;
  return body + footer;
}
