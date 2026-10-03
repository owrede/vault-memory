export interface EmbeddingIdentity {
  provider: string;
  model: string;
  revision: string;
  dimensions: number;
}
export interface EmbeddingProvider {
  readonly identity: EmbeddingIdentity;
  embed(texts: string[], purpose?: "query" | "passage"): Promise<number[][]>;
  close(): Promise<void>;
}
export function embeddingNamespace(identity: EmbeddingIdentity): string {
  return JSON.stringify([
    identity.provider,
    identity.model,
    identity.revision,
    identity.dimensions,
  ]);
}
