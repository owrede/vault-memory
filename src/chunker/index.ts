/**
 * Chunker module — heading-aware Markdown chunking for embedding.
 *
 * Public surface:
 *   - `chunkNote(content, options?)` — split a note body into Chunk[]
 *   - `countTokens(text)` — approximate token counter (length/4 heuristic)
 *   - `extractHeadings(content)` — ATX heading extraction (ignores code fences)
 */

export { chunkNote } from "./chunker.js";
export { countTokens } from "./tokens.js";
export { extractHeadings, headingPathAtOffset } from "./headings.js";
export type { HeadingRef } from "./headings.js";
