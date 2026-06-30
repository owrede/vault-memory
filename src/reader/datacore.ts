/**
 * Datacore / Dataview fenced-block handling for indexing (ADR-033).
 *
 * Obsidian notes embed dynamic views as fenced code blocks:
 *   ```datacorejsx … ```   (JavaScript/JSX — Datacore)
 *   ```datacore … ```
 *   ```dataview … ```      (DQL — Dataview)
 *   ```dataviewjs … ```
 *
 * These render a DIFFERENT structure (tables/lists) at view time INSIDE
 * Obsidian; the rendered output is never persisted to disk. A headless indexer
 * therefore only sees the block SOURCE — JavaScript / a query DSL — which is
 * noise for retrieval (see ADR-033 §Context).
 *
 * This module is the headless baseline of ADR-033: replace each dynamic-view
 * fence's BODY with a short neutral placeholder so the query source doesn't
 * pollute the index, while leaving surrounding prose + headings intact. The
 * Obsidian plugin (ADR-033 phase 3) later OVERRIDES this with the actually
 * rendered content when Datacore is active.
 *
 * Pure string transform — no fs / Obsidian / network. The transform is applied
 * to the INDEXED projection of a note's body only; the raw body (used for the
 * change-detection hash and for wikilink extraction) is untouched.
 */

/** Fence languages whose body is dynamic-view source, not prose. */
const DYNAMIC_VIEW_LANGS = new Set([
  "datacore",
  "datacorejsx",
  "datacorejs",
  "dataview",
  "dataviewjs",
]);

/** Placeholder substituted for a stripped dynamic-view block body. */
export const DATACORE_PLACEHOLDER = "[Datacore view]";

const FENCE_OPEN_RE = /^(\s*)(`{3,}|~{3,})\s*([A-Za-z0-9_-]*)\s*$/;

/**
 * Replace the body of every Datacore/Dataview fenced block with a neutral
 * placeholder line, preserving everything else byte-for-byte. The fence
 * delimiters are dropped along with the body — the placeholder stands in for
 * the whole block so chunking/sectioning see a short, meaningful token instead
 * of code.
 *
 * Matching rules (CommonMark-ish, sufficient for Obsidian):
 * - An opening fence is ``` or ~~~ (3+) followed by an info string; the block
 *   closes on the first line that is a fence of the SAME marker char and at
 *   least the same length, with no info string.
 * - Only blocks whose info string (lowercased) is a known dynamic-view lang are
 *   replaced. All other code blocks pass through unchanged.
 * - An unterminated dynamic-view fence (no closing fence to EOF) is replaced
 *   through end-of-input — defensive against malformed notes.
 *
 * Returns `{ content, replaced }` where `replaced` is the number of blocks
 * substituted (0 ⇒ the input is returned unchanged, so callers can cheaply
 * detect "no dynamic views").
 */
export function stripDynamicViewBlocks(body: string): { content: string; replaced: number } {
  if (!body.includes("```") && !body.includes("~~~")) {
    return { content: body, replaced: 0 };
  }
  const lines = body.split("\n");
  const out: string[] = [];
  let replaced = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const open = FENCE_OPEN_RE.exec(line);
    if (open) {
      const indent = open[1] ?? "";
      const marker = open[2] ?? "";
      const lang = (open[3] ?? "").toLowerCase();
      const markerChar = marker[0]!;
      const isDynamic = DYNAMIC_VIEW_LANGS.has(lang);

      // Find the closing fence (same char, length >= opening, empty info).
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        const close = FENCE_OPEN_RE.exec(lines[j]!);
        if (
          close &&
          (close[2] ?? "")[0] === markerChar &&
          (close[2] ?? "").length >= marker.length &&
          (close[3] ?? "") === ""
        ) {
          closed = true;
          break;
        }
        j++;
      }

      if (isDynamic) {
        // Replace the whole block (open..close) with one placeholder line,
        // preserving the opening indent so it reads naturally in context.
        out.push(`${indent}${DATACORE_PLACEHOLDER}`);
        replaced++;
        i = closed ? j + 1 : lines.length; // skip block (or to EOF if unterminated)
      } else {
        // Non-dynamic code block: emit verbatim, including delimiters.
        out.push(line);
        if (closed) {
          for (let k = i + 1; k <= j; k++) out.push(lines[k]!);
          i = j + 1;
        } else {
          for (let k = i + 1; k < lines.length; k++) out.push(lines[k]!);
          i = lines.length;
        }
      }
    } else {
      out.push(line);
      i++;
    }
  }

  if (replaced === 0) return { content: body, replaced: 0 };
  return { content: out.join("\n"), replaced };
}
