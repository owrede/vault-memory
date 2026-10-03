import { OllamaClient } from "../ollama/index.js";
import type { EmbedRequest, EmbedResponse, OllamaClientOptions } from "../types.js";
import type { EmbeddingProvider, EmbeddingIdentity } from "./types.js";
import { embeddingNamespace } from "./types.js";
/** Compatibility facade: existing indexing callers use the provider through embed(), chat remains Ollama. */
export class ProviderEmbeddingClient extends OllamaClient {
  readonly modelName: string;
  constructor(
    readonly provider: EmbeddingProvider,
    options: OllamaClientOptions = {},
  ) {
    super(options);
    this.modelName = embeddingNamespace(provider.identity);
  }
  owns(model: string): boolean {
    return model === this.modelName;
  }
  override async embed(request: EmbedRequest): Promise<EmbedResponse> {
    return this.embedPurpose(request, "passage");
  }
  async embedPurpose(request: EmbedRequest, purpose: "query" | "passage"): Promise<EmbedResponse> {
    if (!this.owns(request.model)) return super.embed(request);
    const vectors = await this.provider.embed(request.texts, purpose);
    if (
      vectors.length !== request.texts.length ||
      vectors.some(
        (v) => v.length !== this.provider.identity.dimensions || v.some((x) => !Number.isFinite(x)),
      )
    )
      throw new Error("Embedding shape/dimension mismatch");
    return { vectors, dim: this.provider.identity.dimensions, model: request.model };
  }
  override async healthCheck() {
    return { ok: true, models: [this.modelName, this.provider.identity.model] };
  }
  override async modelExists(model: string): Promise<boolean> {
    if (this.owns(model)) return true;
    const health = await super.healthCheck();
    return health.ok && (health.models?.includes(model) ?? false);
  }
  async close(): Promise<void> {
    await this.provider.close();
  }
}
export function providerModel(
  client: OllamaClient | undefined,
  model: string,
): { name: string; provider: string } {
  return client instanceof ProviderEmbeddingClient &&
    (client.owns(model) || model === client.provider.identity.model)
    ? { name: client.modelName, provider: client.provider.identity.provider }
    : { name: model, provider: "ollama" };
}
export function embedQuery(client: OllamaClient, request: EmbedRequest): Promise<EmbedResponse> {
  return client instanceof ProviderEmbeddingClient
    ? client.embedPurpose(request, "query")
    : client.embed(request);
}
