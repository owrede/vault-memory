export function meanPool(
  hidden: Float32Array,
  mask: bigint[],
  tokens: number,
  dimensions: number,
): number[] {
  if (
    !Number.isSafeInteger(tokens) ||
    tokens < 1 ||
    !Number.isSafeInteger(dimensions) ||
    dimensions < 1 ||
    hidden.length !== tokens * dimensions ||
    mask.length !== tokens
  )
    throw new Error("shape mismatch");
  if ([...hidden].some((v) => !Number.isFinite(v)) || mask.some((v) => v !== 0n && v !== 1n))
    throw new Error("nonfinite hidden or invalid mask");
  const pooled = Array<number>(dimensions).fill(0);
  let count = 0;
  for (let token = 0; token < tokens; token++)
    if (mask[token] !== 0n) {
      count++;
      for (let d = 0; d < dimensions; d++) pooled[d]! += hidden[token * dimensions + d]!;
    }
  if (count === 0) throw new Error("empty attention mask");
  return pooled.map((v) => v / count);
}
export function normalizeVector(vector: number[]): number[] {
  if (!vector.length || vector.some((v) => !Number.isFinite(v)))
    throw new Error("nonfinite or empty vector");
  const norm = Math.hypot(...vector);
  if (norm === 0 || !Number.isFinite(norm)) throw new Error("zero or nonfinite vector");
  return vector.map((v) => v / norm);
}
import type { EmbeddingProvider, EmbeddingIdentity } from "./types.js";
export interface OnnxRuntime {
  identity: EmbeddingIdentity;
  maxTokens: number;
  queryPrefix: string;
  passagePrefix: string;
  encode(text: string): { ids: number[]; mask: number[] };
  run(ids: bigint[], mask: bigint[]): Promise<{ hidden: Float32Array; shape: readonly number[] }>;
  close(): Promise<void>;
}
export class OnnxEmbeddingProvider implements EmbeddingProvider {
  readonly identity: EmbeddingIdentity;
  private closed = false;
  constructor(private readonly runtime: OnnxRuntime) {
    this.identity = runtime.identity;
  }
  async embed(texts: string[], purpose: "query" | "passage" = "passage"): Promise<number[][]> {
    if (this.closed) throw new Error("Embedding provider is closed");
    const vectors: number[][] = [];
    for (const text of texts) {
      const encoded = this.runtime.encode(
        (purpose === "query" ? this.runtime.queryPrefix : this.runtime.passagePrefix) + text,
      );
      const ids = encoded.ids.slice(0, this.runtime.maxTokens).map(BigInt),
        mask = encoded.mask.slice(0, this.runtime.maxTokens).map(BigInt);
      const result = await this.runtime.run(ids, mask);
      if (
        result.shape.length !== 3 ||
        result.shape[0] !== 1 ||
        result.shape[1] !== ids.length ||
        result.shape[2] !== this.identity.dimensions
      )
        throw new Error("ONNX output shape mismatch");
      vectors.push(
        normalizeVector(meanPool(result.hidden, mask, ids.length, this.identity.dimensions)),
      );
    }
    return vectors;
  }
  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      await this.runtime.close();
    }
  }
}
