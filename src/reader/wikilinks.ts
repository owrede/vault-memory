import type { ParsedWikilink } from "../types.js";

/**
 * Wikilink extraction.
 *
 * Recognised forms:
 *   [[Target]]
 *   [[Target|Alias]]
 *   [[Target#Anchor]]
 *   [[Target#Anchor|Alias]]
 *   [[Folder/Sub/Target]]
 *   [[Target.md]]
 *
 * Embeds (`![[...]]`) and block-references (`[[Target^block-id]]`) are not
 * specially handled — embeds are skipped (the leading `!` prevents the regex
 * match below since we anchor on a non-`!` preceding char), and block-refs
 * are parsed as a normal link whose target ends up containing the `^`-suffix
 * inside `rawTarget`. This is intentional: keep parsing robust, defer
 * semantics to a later layer.
 *
 * Code-block handling:
 *   - Triple-backtick fenced blocks: contents are MASKED (replaced with
 *     spaces, newlines preserved) so wikilinks inside them are ignored
 *     but line numbers for following content remain correct.
 *   - Inline code (single backticks) is NOT masked. We consider this
 *     acceptable for now — wikilinks inside inline code are rare and the
 *     downstream cost of a false positive is low.
 */

const WIKILINK_RE = /(^|[^!])\[\[([^\[\]\n]+?)\]\]/g;

export function extractWikilinks(content: string): ParsedWikilink[] {
  const masked = maskFencedCodeBlocks(content);
  const results: ParsedWikilink[] = [];

  // Precompute newline offsets for fast line lookup.
  const lineStarts: number[] = [0];
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === "\n") lineStarts.push(i + 1);
  }

  WIKILINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_RE.exec(masked)) !== null) {
    const prefix = match[1] ?? "";
    const inner = match[2];
    if (inner === undefined) continue;
    // Position of the inner target in the masked string:
    const innerStart = match.index + prefix.length + 2; // skip prefix + "[["

    const parsed = parseInner(inner);
    if (parsed === null) continue;

    const line = lineOf(lineStarts, innerStart);
    results.push({ ...parsed, line });
  }

  return results;
}

interface InnerParsed {
  rawTarget: string;
  normalizedTarget: string;
  anchor: string | null;
  alias: string | null;
}

function parseInner(inner: string): InnerParsed | null {
  // Split alias first (everything after the first `|`).
  let target = inner;
  let alias: string | null = null;
  const pipeIdx = inner.indexOf("|");
  if (pipeIdx >= 0) {
    target = inner.slice(0, pipeIdx);
    alias = inner.slice(pipeIdx + 1).trim();
    if (alias.length === 0) alias = null;
  }

  // Split anchor (first `#` in target).
  let rawTarget = target;
  let anchor: string | null = null;
  const hashIdx = target.indexOf("#");
  if (hashIdx >= 0) {
    rawTarget = target.slice(0, hashIdx);
    anchor = target.slice(hashIdx + 1).trim();
    if (anchor.length === 0) anchor = null;
  }

  rawTarget = rawTarget.trim();
  if (rawTarget.length === 0) return null;

  const normalizedTarget = normalizeTarget(rawTarget);

  return { rawTarget, normalizedTarget, anchor, alias };
}

function normalizeTarget(raw: string): string {
  // Strip trailing .md (case-insensitive), normalize backslashes to forward.
  let t = raw.replace(/\\/g, "/");
  t = t.replace(/\.md$/i, "");
  return t;
}

function lineOf(lineStarts: number[], offset: number): number {
  // Binary search the largest lineStart <= offset.
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    const v = lineStarts[mid];
    if (v !== undefined && v <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1; // 1-based
}

/**
 * Replace contents inside triple-backtick fences with spaces, preserving
 * newlines and overall length. Handles fences like ```lang ... ```.
 */
function maskFencedCodeBlocks(content: string): string {
  const chars = content.split("");
  const fenceRe = /^([ \t]*)(`{3,}|~{3,})([^\n]*)$/gm;
  // We'll do a stateful scan line by line for correctness.
  const lines = content.split("\n");
  let inFence = false;
  let fenceMarker = "";
  let absOffset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trimStart();
    if (!inFence) {
      const m = /^(`{3,}|~{3,})/.exec(trimmed);
      if (m !== null && m[1] !== undefined) {
        inFence = true;
        fenceMarker = m[1][0] ?? "`";
        // Do NOT mask the fence line itself — only contents inside.
      }
    } else {
      const m = /^(`{3,}|~{3,})\s*$/.exec(trimmed);
      if (
        m !== null &&
        m[1] !== undefined &&
        m[1][0] === fenceMarker
      ) {
        inFence = false;
      } else {
        // Mask this content line: replace every char with space.
        for (let j = 0; j < line.length; j++) {
          chars[absOffset + j] = " ";
        }
      }
    }
    absOffset += line.length + 1; // +1 for the "\n"
  }
  // suppress unused fenceRe (kept for clarity)
  void fenceRe;
  return chars.join("");
}
