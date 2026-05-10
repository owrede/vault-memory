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

const ATX_HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^(\s*)(`{3,}|~{3,})/;

/**
 * Extract all ATX headings from the content, ignoring anything inside fenced
 * code blocks. Returns headings in document order.
 */
export function extractHeadings(content: string): HeadingRef[] {
  const headings: HeadingRef[] = [];
  if (content.length === 0) return headings;

  const lines = content.split("\n");
  let offset = 0;
  let inFence = false;
  let fenceMarker: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[2] ?? "";
      if (!inFence) {
        inFence = true;
        fenceMarker = marker[0] ?? null; // remember whether it was ` or ~
      } else if (fenceMarker && marker.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = null;
      }
    } else if (!inFence) {
      const m = ATX_HEADING_RE.exec(line);
      if (m) {
        const hashes = m[1] ?? "";
        const text = m[2] ?? "";
        headings.push({
          level: hashes.length,
          text: text.trim(),
          line: i + 1,
          startOffset: offset,
        });
      }
    }
    // +1 for the newline character (the last line may have no trailing newline,
    // but we never read past the end of the lines array).
    offset += line.length + 1;
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
export function headingPathAtOffset(
  headings: HeadingRef[],
  offset: number,
): string | null {
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
