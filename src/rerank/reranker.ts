/**
 * Cross-encoder reranker (Phase 7d, optional).
 *
 * `Reranker.score(query, chunks)` returns a relevance score per chunk —
 * higher = more relevant. Scores are NOT necessarily normalized between
 * runs; only their relative order matters within a single call.
 *
 * # Strategy
 *
 * Ollama hosts cross-encoder rerankers like `bge-reranker-v2-m3` (BAAI,
 * MIT-licensed, multilingual), but the server only exposes the embedding
 * layer — not the classification head that produces the actual relevance
 * logit. The community workaround
 * (https://github.com/overcuriousity/ollama-utils/tree/main/plugins/reranking-endpoint)
 * is:
 *
 *   1. Feed the model `"Query: {q}\n\nDocument: {d}\n\nRelevance:"` as
 *      a single text input via /api/embed.
 *   2. Compute the L2 norm of the returned embedding vector.
 *   3. For bge-reranker models, *lower magnitude = more relevant*, so we
 *      negate the magnitude to produce a "higher = better" score.
 *
 * This is a proxy, not the true classification logit, but it correlates
 * well enough in practice to be useful as a rerank signal on top of
 * hybrid retrieval. When/if Ollama exposes the classification head, or
 * when we ship an ONNX runtime, the `OllamaReranker` class can be
 * swapped out behind the same interface without API churn.
 *
 * # Failure semantics
 *
 * Reranking is strictly best-effort: any error from Ollama (network,
 * model not loaded, parse failure) causes `score()` to throw, and
 * callers MUST treat the failure as "no rerank available" and fall back
 * to the upstream ranking. See `hybridSearch` for the integration.
 */

import type { OllamaClient } from "../ollama/index.js";

export interface Reranker {
  /**
   * Score each chunk against the query. Returns one score per chunk,
   * in the same order as the input. Higher = more relevant.
   *
   * Throws on transport / parse failure. Callers should catch and fall
   * back to the un-reranked order.
   */
  score(query: string, chunks: readonly string[]): Promise<number[]>;
}

export interface OllamaRerankerOptions {
  ollama: OllamaClient;
  model: string;
}

/**
 * Reranker backed by Ollama's /api/embed endpoint.
 *
 * Expects a cross-encoder model like `qllama/bge-reranker-v2-m3`. See
 * file header for the magnitude-as-proxy caveat.
 */
export class OllamaReranker implements Reranker {
  private readonly ollama: OllamaClient;
  private readonly model: string;

  constructor(opts: OllamaRerankerOptions) {
    this.ollama = opts.ollama;
    this.model = opts.model;
  }

  async score(query: string, chunks: readonly string[]): Promise<number[]> {
    if (chunks.length === 0) return [];
    const inputs = chunks.map((c) => formatPair(query, c));
    const res = await this.ollama.embed({ model: this.model, texts: inputs });
    if (res.vectors.length !== chunks.length) {
      throw new Error(`Reranker: expected ${chunks.length} vectors, got ${res.vectors.length}`);
    }
    // For bge-reranker: lower L2 magnitude ⇒ more relevant. Negate so
    // "higher score = more relevant" matches the Reranker contract.
    return res.vectors.map((v) => -l2Norm(v));
  }
}

/**
 * Format a query/document pair as a single string. Matches the prompt
 * shape used by overcuriousity/ollama-utils — keep stable so scores are
 * comparable across runs.
 */
export function formatPair(query: string, doc: string): string {
  return `Query: ${query}\n\nDocument: ${doc}\n\nRelevance:`;
}

function l2Norm(v: readonly number[]): number {
  let sum = 0;
  for (const x of v) sum += x * x;
  return Math.sqrt(sum);
}
