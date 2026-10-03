import type { OllamaClient } from "../ollama/index.js";
import type { EmbeddingProvider, EmbeddingIdentity } from "./types.js";
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  constructor(
    readonly identity: EmbeddingIdentity,
    private readonly client: OllamaClient,
  ) {}
  async embed(texts: string[]): Promise<number[][]> {
    const result = await this.client.embed({ model: this.identity.model, texts });
    if (result.dim !== this.identity.dimensions) throw new Error("Embedding dimension mismatch");
    return result.vectors;
  }
  async close(): Promise<void> {}
}
