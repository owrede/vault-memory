/**
 * Heading-aware Markdown chunker.
 *
 * Strategy (in order of preference for splits):
 *   1. Heading boundaries (level 1–3) — preferred.
 *   2. Paragraph boundaries (blank lines) — used when a heading section is
 *      itself too long.
 *   3. Sentence boundaries (`.!?` followed by whitespace + uppercase) —
 *      naive, no abbreviation handling in MVP.
 *   4. Hard cut at `maxTokens * 4` characters — last resort.
 *
 * Overlap is applied as a character window taken from the tail of the previous
 * chunk; if a sentence boundary is found within the overlap window, we start
 * at that boundary for cleaner reads.
 */

import type { Chunk, ChunkOptions } from "../types.js";
import { countTokens } from "./tokens.js";
import { extractHeadings, headingPathAtOffset } from "./headings.js";
import type { HeadingRef } from "./headings.js";

const DEFAULT_MAX_TOKENS = 400;
const DEFAULT_OVERLAP_TOKENS = 50;
/**
 * Minimum non-whitespace characters required for a chunk to be kept.
 * Notes that begin with a blank line before the first heading produce a
 * leading whitespace-only span; those would otherwise become a chunk_idx=0
 * "\n" chunk and pollute search top-k because their embedding is close to
 * the embedding of every other near-empty text (cosine ≈ 1.0). Trimming
 * here is the source of truth — search/rerank don't need a follow-up filter.
 */
const MIN_CHUNK_TRIM_CHARS = 3;

interface Span {
  start: number;
  end: number; // exclusive
}

export function chunkNote(content: string, options?: ChunkOptions): Chunk[] {
  if (content.length === 0) return [];

  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const overlapTokens = options?.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;
  const maxChars = maxTokens * 4;
  const overlapChars = overlapTokens * 4;

  const headings = extractHeadings(content);

  // Fast path: whole note fits.
  if (countTokens(content) <= maxTokens) {
    if (content.trim().length < MIN_CHUNK_TRIM_CHARS) return [];
    return [
      {
        idx: 0,
        text: content,
        headingPath: headingPathAtOffset(headings, 0),
        startOffset: 0,
        endOffset: content.length,
        tokenCount: countTokens(content),
      },
    ];
  }

  // 1. Build initial spans by splitting at level 1–3 headings.
  const headingSpans = splitAtHeadings(content, headings, maxChars);

  // 2. For each span still too large, recursively split: paragraphs → sentences → hard cut.
  const finalSpans: Span[] = [];
  for (const span of headingSpans) {
    if (span.end - span.start <= maxChars) {
      finalSpans.push(span);
    } else {
      finalSpans.push(...splitParagraphs(content, span, maxChars));
    }
  }

  // 3. Apply overlap and build Chunk objects.
  // headingPath is computed at the *primary* span start (pre-overlap) so the
  // heading describes the chunk's own content, not borrowed overlap text.
  const chunks: Chunk[] = [];
  for (let i = 0; i < finalSpans.length; i++) {
    const span = finalSpans[i];
    if (!span) continue;
    const primaryStart = span.start;
    let start = span.start;
    const end = span.end;

    if (i > 0 && overlapChars > 0) {
      const overlapStart = Math.max(0, start - overlapChars);
      // Try to align to a sentence boundary inside the overlap window.
      const window = content.slice(overlapStart, start);
      const sentenceIdx = findLastSentenceBoundary(window);
      start = sentenceIdx >= 0 ? overlapStart + sentenceIdx : overlapStart;
    }

    const text = content.slice(start, end);
    // Drop whitespace-only and tiny chunks: they produce near-identical
    // embeddings and pollute search top-k (see MIN_CHUNK_TRIM_CHARS doc).
    if (text.trim().length < MIN_CHUNK_TRIM_CHARS) continue;

    chunks.push({
      idx: chunks.length,
      text,
      headingPath: headingPathAtOffset(headings, primaryStart),
      startOffset: start,
      endOffset: end,
      tokenCount: countTokens(text),
    });
  }

  return chunks;
}

/**
 * Split content into spans bounded by level 1–3 ATX headings.
 * Each span starts at a heading (or the document start) and runs until just
 * before the next eligible heading.
 *
 * Headings deeper than level 3 do not break sections (they live inside).
 */
function splitAtHeadings(content: string, headings: HeadingRef[], _maxChars: number): Span[] {
  const boundaries: number[] = [0];
  for (const h of headings) {
    if (h.level <= 3 && h.startOffset > 0) {
      boundaries.push(h.startOffset);
    }
  }
  boundaries.push(content.length);

  // Deduplicate / sort defensively.
  const uniq = [...new Set(boundaries)].sort((a, b) => a - b);

  const spans: Span[] = [];
  for (let i = 0; i < uniq.length - 1; i++) {
    const start = uniq[i];
    const end = uniq[i + 1];
    if (start === undefined || end === undefined) continue;
    if (end > start) spans.push({ start, end });
  }
  return spans;
}

/**
 * Split a single span by paragraph boundaries (blank lines / `\n\n+`), packing
 * paragraphs greedily up to `maxChars`. Falls back to sentence-splitting for
 * any paragraph that is itself too long.
 */
function splitParagraphs(content: string, span: Span, maxChars: number): Span[] {
  const text = content.slice(span.start, span.end);
  const paragraphs: Span[] = [];
  const re = /\n{2,}/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const paraEnd = m.index;
    if (paraEnd > cursor) {
      paragraphs.push({ start: span.start + cursor, end: span.start + paraEnd });
    }
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) {
    paragraphs.push({ start: span.start + cursor, end: span.end });
  }
  if (paragraphs.length === 0) {
    paragraphs.push({ start: span.start, end: span.end });
  }

  const out: Span[] = [];
  let current: Span | null = null;

  const flush = () => {
    if (!current) return;
    if (current.end - current.start <= maxChars) {
      out.push(current);
    } else {
      out.push(...splitSentences(content, current, maxChars));
    }
    current = null;
  };

  for (const p of paragraphs) {
    if (!current) {
      current = { start: p.start, end: p.end };
      continue;
    }
    if (p.end - current.start <= maxChars) {
      current = { start: current.start, end: p.end };
    } else {
      flush();
      current = { start: p.start, end: p.end };
    }
  }
  flush();

  return out;
}

/**
 * Sentence-aware split. Detects `.!?` followed by whitespace + an uppercase
 * letter as a sentence boundary. No abbreviation handling in MVP.
 *
 * Packs sentences greedily up to `maxChars`. Falls back to hard cut for any
 * sentence that is itself too long.
 */
function splitSentences(content: string, span: Span, maxChars: number): Span[] {
  const text = content.slice(span.start, span.end);
  const boundaries: number[] = [];
  const re = /[.!?]\s+(?=[A-ZÄÖÜ])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    boundaries.push(m.index + m[0].length);
  }

  const sentences: Span[] = [];
  let cursor = 0;
  for (const b of boundaries) {
    if (b > cursor) {
      sentences.push({ start: span.start + cursor, end: span.start + b });
      cursor = b;
    }
  }
  if (cursor < text.length) {
    sentences.push({ start: span.start + cursor, end: span.end });
  }
  if (sentences.length === 0) {
    sentences.push({ start: span.start, end: span.end });
  }

  const out: Span[] = [];
  let current: Span | null = null;

  const flush = () => {
    if (!current) return;
    if (current.end - current.start <= maxChars) {
      out.push(current);
    } else {
      out.push(...hardCut(current, maxChars));
    }
    current = null;
  };

  for (const s of sentences) {
    if (!current) {
      current = { start: s.start, end: s.end };
      continue;
    }
    if (s.end - current.start <= maxChars) {
      current = { start: current.start, end: s.end };
    } else {
      flush();
      current = { start: s.start, end: s.end };
    }
  }
  flush();

  return out;
}

/**
 * Last-resort: cut into fixed-size character windows.
 */
function hardCut(span: Span, maxChars: number): Span[] {
  const out: Span[] = [];
  for (let s = span.start; s < span.end; s += maxChars) {
    out.push({ start: s, end: Math.min(span.end, s + maxChars) });
  }
  return out;
}

/**
 * Find the offset within `window` just after the last sentence boundary,
 * or -1 if none found.
 */
function findLastSentenceBoundary(window: string): number {
  const re = /[.!?]\s+(?=[A-ZÄÖÜ])/g;
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(window)) !== null) {
    last = m.index + m[0].length;
  }
  return last;
}
