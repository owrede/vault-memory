import { markdownLines } from "../markdown/list-items.js";
/**
 * Heading extraction for Markdown content.
 *
 * Recognizes ATX-style headings (`#`..`######`) outside fenced code blocks.
 * Setext-style headings (underlined with `===` / `---`) are not supported —
 * they are extremely rare in Obsidian vaults and skipping them keeps the
 * parser simple and predictable.
 */

export interface HeadingRef {
  /** Heading level, 1–6. */
  level: number;
  /** Heading text, without leading `#` markers or trimming whitespace. */
  text: string;
  /** 1-based line number in source content. */
  line: number;
  /** Character offset where the heading line starts in source content. */
  startOffset: number;
}

const ATX_HEADING_RE = /^ {0,3}(#{1,6})(?:[\t ]+(.*?))?[\t ]*\r?$/;

/**
 * Extract all ATX headings from the content, ignoring anything inside fenced
 * code blocks. Returns headings in document order.
 */
export function extractHeadings(content: string): HeadingRef[] {
  const headings: HeadingRef[] = [];
  if (content.length === 0) return headings;

  for (const row of markdownLines(content)) {
    if (row.code) continue;
    const m = ATX_HEADING_RE.exec(row.text);
    if (!m) continue;
    const hashes = m[1] ?? "";
    const text = (m[2] ?? "").replace(/(?:^|[\t ])#+[\t ]*$/, "");
    headings.push({
      level: hashes.length,
      text: text.trim(),
      line: row.line,
      startOffset: row.offset,
    });
  }

  return headings;
}

/**
 * Return the nearest preceding heading as a short path string,
 * e.g. `"## 5. Empfehlung"`. Returns `null` if no heading precedes the offset.
 *
 * This is an MVP-style path: only the immediate predecessor, not a full
 * `H1 > H2 > H3` breadcrumb.
 */
export function headingPathAtOffset(headings: HeadingRef[], offset: number): string | null {
  let last: HeadingRef | null = null;
  for (const h of headings) {
    if (h.startOffset <= offset) {
      last = h;
    } else {
      break;
    }
  }
  if (!last) return null;
  return `${"#".repeat(last.level)} ${last.text}`;
}
