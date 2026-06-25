/**
 * Phase 3 — section extraction.
 *
 * Walks `BlockNode[]` left-to-right and produces a flat array of
 * `SectionInfo` per ADR-003 H-7. Each section aggregates a heading
 * and all `BlockNode` descendants up to (but not including) the
 * next equal-or-shallower heading. Top-of-document content with no
 * preceding heading becomes a synthetic preamble section
 * (`level: 0, heading_path: [], heading_text: ""`).
 *
 * Also exports `markdownToSectionBlocks(content)` — a minimal markdown
 * → `BlockNode[]` lifter used by the indexer and the migration-time
 * backfill (since v1 storage only carries the raw markdown content,
 * not a parsed `BlockNode[]`). The lifter emits `heading` and
 * `paragraph` variants only, which is sufficient for section identity
 * (anchor + heading_path). Fenced code blocks are kept as paragraphs
 * so their body bytes participate in the anchor exactly as written.
 *
 * Pure module — no fs / gray-matter / chokidar / path imports.
 * Enforced by `scripts/lint-adapters.sh`.
 */

import type { BlockNode, SectionInfo } from "../types.js";
import { extractHeadings } from "../chunker/headings.js";
import { computeAnchor } from "./anchor.js";

/**
 * Walk `blocks` left-to-right and return the section list. The list
 * order is document order (preamble first if present, then sections
 * in source order). `parent_index` points into this array; `ord` is
 * the sibling index under the same parent (assigned in a second pass).
 *
 * Algorithm (per plan):
 *   - Maintain a stack of open sections, each at some level.
 *   - On each heading:
 *       pop while top.level >= heading.level
 *       new section parent_index = top-of-stack (or null)
 *       push it
 *   - On each non-heading block:
 *       if stack is empty, lazily open a synthetic preamble (level 0).
 *       append to the current top-of-stack section's plain-text body.
 *
 * `plain_text_body` is built by joining each contained block's plain
 * text with `"\n"`, identical to how `computeAnchor` consumes blocks.
 * This keeps the body bytes deterministic and lets the anchor be
 * computed directly from `(heading_text, blocks_in_section)` without
 * a second walk.
 */
export function extractSections(blocks: readonly BlockNode[]): SectionInfo[] {
  // Working representation: each section owns the BlockNode[] it
  // accumulates, plus its level + heading_text + heading_path +
  // parent_index. Anchors are computed at the end.
  interface Working {
    level: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    heading_text: string;
    heading_path: string[];
    parent_index: number | null;
    blocks: BlockNode[];
  }

  const out: Working[] = [];
  // Stack tracks indices into `out` (so we can update parent_index
  // and append blocks). Each entry is an index whose section is
  // currently "open".
  const stack: number[] = [];

  const stackTop = (): number | null =>
    stack.length === 0 ? null : (stack[stack.length - 1] ?? null);

  const ensurePreamble = (): number => {
    // The preamble exists iff there's a level-0 section at index 0.
    if (out.length > 0 && out[0]!.level === 0) return 0;
    // No preamble yet — open one. It must be the FIRST entry in `out`.
    if (out.length > 0) {
      // Defensive: if non-heading content appears after some headings
      // have been opened, this branch is unreachable (the heading
      // would be on the stack already). The check is here only to
      // guarantee preamble-at-index-0 if anyone calls ensurePreamble
      // mid-walk.
      throw new Error(
        "Internal invariant: ensurePreamble called after sections exist; section walker is buggy.",
      );
    }
    out.push({
      level: 0,
      heading_text: "",
      heading_path: [],
      parent_index: null,
      blocks: [],
    });
    stack.push(0);
    return 0;
  };

  for (const block of blocks) {
    if (block.kind === "heading") {
      // Pop open sections whose level >= this heading's level.
      // The synthetic preamble (level 0) is also popped on the first
      // heading we encounter — preambles live at the document root
      // alongside top-level headings, NOT as their parent. (Without
      // this special case, a `0 >= 1` check would be false and the
      // first H1 would be threaded under the preamble.)
      while (stack.length > 0) {
        const topIdx = stack[stack.length - 1]!;
        const top = out[topIdx]!;
        if (top.level >= block.level || top.level === 0) {
          stack.pop();
        } else {
          break;
        }
      }
      const parentIdx = stackTop();
      const parentPath = parentIdx === null ? [] : out[parentIdx]!.heading_path;
      const headingText = block.text;
      out.push({
        level: block.level,
        heading_text: headingText,
        heading_path: [...parentPath, headingText],
        parent_index: parentIdx,
        blocks: [],
      });
      stack.push(out.length - 1);
      continue;
    }
    // Non-heading block (paragraph / code / list / section / etc).
    // If nothing is open yet, lazily open the synthetic preamble.
    if (stack.length === 0) {
      ensurePreamble();
    }
    const topIdx = stackTop()!;
    out[topIdx]!.blocks.push(block);
  }

  // Second pass: assign `ord` per (parent_index) sibling group.
  // `ord` is the index in document order among sections sharing the
  // same `parent_index`.
  const ords: number[] = new Array(out.length).fill(0);
  const seenPerParent = new Map<number | null, number>();
  for (let i = 0; i < out.length; i++) {
    const parent = out[i]!.parent_index;
    const next = seenPerParent.get(parent) ?? 0;
    ords[i] = next;
    seenPerParent.set(parent, next + 1);
  }

  // Materialize SectionInfo[] with anchors + ord + plain_text_body.
  return out.map((w, i) => {
    const plainBody = w.blocks.map(blockToPlainTextLocal).join("\n");
    const anchor = computeAnchor(w.heading_text, w.blocks);
    return {
      anchor,
      heading_path: w.heading_path,
      heading_text: w.heading_text,
      level: w.level,
      parent_index: w.parent_index,
      ord: ords[i]!,
      plain_text_body: plainBody,
    };
  });
}

/**
 * Local plain-text helper for body byte reconstruction inside
 * `extractSections`. Mirrors `blockToPlainText` from `./anchor.ts` but
 * keeps the function inline to avoid a circular-import path. The two
 * helpers MUST emit byte-identical output for the same `BlockNode` —
 * the `markdownToSectionBlocks` round-trip test in `extract.test.ts`
 * verifies this indirectly (anchor equivalence).
 *
 * `section` variant deliberately not handled here — the section walker
 * never emits a nested `section` block into `Working.blocks`; that
 * variant exists only as the canonical OUTPUT shape returned from
 * `get_outline` (Phase 3 slice 03-02), not as input to extraction.
 */
function blockToPlainTextLocal(block: BlockNode): string {
  switch (block.kind) {
    case "paragraph":
      return block.text;
    case "heading":
      return "#".repeat(block.level) + " " + block.text;
    case "code":
      return "```" + (block.lang ?? "") + "\n" + block.text + "\n```";
    case "list": {
      const marker = block.ordered ? "1." : "-";
      return block.items.map((item) => marker + " " + item).join("\n");
    }
    case "section":
      // See JSDoc — should not appear as input, but render defensively.
      return (
        "#".repeat(Math.max(1, block.level)) +
        " " +
        (block.heading_path[block.heading_path.length - 1] ?? "") +
        "\n" +
        block.blocks.map(blockToPlainTextLocal).join("\n")
      );
    default: {
      const _exhaustive: never = block;
      return _exhaustive;
    }
  }
}

/**
 * Lift raw markdown into a minimal `BlockNode[]` of `heading` +
 * `paragraph` variants — enough for section identity. Used by the
 * indexer and the migration-time backfill.
 *
 * Why this lifter exists: v1 storage holds `notes.content` (raw
 * markdown) but no parsed `BlockNode[]`. Phase 3 needs sections
 * extracted from that markdown. A full markdown→BlockNode parser is
 * out of scope for this slice (and would duplicate Phase 1 adapter
 * work). This minimal lifter is sufficient because anchors only
 * depend on heading_text + plain_text_body, and the body bytes are
 * preserved verbatim regardless of how they're labeled.
 *
 * Algorithm:
 *   1. Run `extractHeadings(content)` to get every ATX heading's
 *      level + text + startOffset (already fenced-code-aware).
 *   2. Slice the content between heading start offsets:
 *      - The slice from 0 to the first heading's start is the preamble
 *        body (emitted as a single `paragraph` block IF non-empty).
 *      - Each heading + the slice between its line and the next
 *        heading's line becomes a `heading` block followed by a
 *        `paragraph` block carrying the body bytes (verbatim,
 *        with the heading line itself stripped).
 *
 * Body slices are kept verbatim (including blank lines and code
 * fences). The indexer's anchor calculation depends on byte
 * stability — we do NOT trim trailing whitespace, normalize
 * line endings, or collapse blanks. NFC normalization happens
 * inside `computeAnchor`.
 *
 * Pure — no fs / gray-matter / chokidar imports.
 */
export function markdownToSectionBlocks(content: string): BlockNode[] {
  if (content.length === 0) return [];
  const headings = extractHeadings(content);

  const out: BlockNode[] = [];

  // Preamble: bytes from 0 to first heading's startOffset (or end of
  // content if no headings).
  const firstHeadingStart = headings.length === 0 ? content.length : headings[0]!.startOffset;
  if (firstHeadingStart > 0) {
    const preamble = content.slice(0, firstHeadingStart);
    if (preamble.length > 0) {
      // Strip a single trailing newline so the paragraph block doesn't
      // carry the separator into its body bytes. (Preserves stability
      // when the body is "intro text\n" before "# H1" — the heading's
      // own line begins exactly at firstHeadingStart, so the slice
      // includes the newline between intro and #.)
      out.push({ kind: "paragraph", text: stripTrailingNewline(preamble) });
    }
  }

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!;
    const next = headings[i + 1];
    const headingLineEnd = nextLineEnd(content, h.startOffset);
    const headingBodyStart = headingLineEnd;
    const headingBodyEnd = next ? next.startOffset : content.length;
    // Cast to the strict heading-level type — extractHeadings only
    // emits 1..6 per the ATX regex, so the runtime guarantee holds.
    const level = h.level as 1 | 2 | 3 | 4 | 5 | 6;
    out.push({ kind: "heading", level, text: h.text });
    if (headingBodyEnd > headingBodyStart) {
      const body = content.slice(headingBodyStart, headingBodyEnd);
      const trimmed = stripTrailingNewline(body);
      // Skip an empty body to keep the BlockNode list tight — sections
      // with no body still get a valid anchor (sha256 of "<heading>\n").
      if (trimmed.length > 0) {
        out.push({ kind: "paragraph", text: trimmed });
      }
    }
  }

  return out;
}

function nextLineEnd(content: string, start: number): number {
  // Find the first 0x0A at or after `start`. Returns the index AFTER
  // the newline (so the next line begins there), or content.length if
  // no newline is found.
  const idx = content.indexOf("\n", start);
  if (idx === -1) return content.length;
  return idx + 1;
}

function stripTrailingNewline(s: string): string {
  if (s.endsWith("\r\n")) return s.slice(0, -2);
  if (s.endsWith("\n")) return s.slice(0, -1);
  return s;
}
