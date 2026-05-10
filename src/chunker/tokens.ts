/**
 * Token-count approximation for chunk sizing.
 *
 * This is intentionally NOT a real BPE tokenizer. We use a simple length/4
 * heuristic that is "good enough" to keep chunks in a ~400-token band, which
 * is all the chunker actually needs.
 *
 * Why this is fine:
 * - Chunk sizing is a band, not an exact budget. Embedding models tell us at
 *   call time if a chunk was too long, and we re-chunk then.
 * - A real tokenizer (tiktoken, transformers.js) would couple us to a model
 *   family. We embed via Ollama with model-agnostic input, so any model-
 *   specific count would be wrong for some models anyway.
 *
 * If we ever need accuracy, swap this for a real tokenizer here — the rest of
 * the chunker only depends on `countTokens`.
 */
export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}
