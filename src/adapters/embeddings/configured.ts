import { OllamaClient } from "../../ollama/index.js";
import { ProviderEmbeddingClient } from "../../embeddings/client.js";
import { loadOnnxProvider } from "./onnx-runtime.js";
import type { ServerConfig } from "../../types.js";
export async function configuredEmbeddingClient(
  config: ServerConfig,
  enabled = true,
): Promise<{ client: OllamaClient; model: string; close: () => Promise<void> }> {
  if (!enabled || config.embedding_provider !== "onnx")
    return {
      client: new OllamaClient({ endpoint: config.ollama_endpoint }),
      model: config.default_embedding_model ?? "qwen3-embedding:0.6b",
      close: async () => {},
    };
  if (!config.model_path) throw new Error("ONNX embedding_provider requires model_path");
  const client = new ProviderEmbeddingClient(await loadOnnxProvider(config.model_path), {
    endpoint: config.ollama_endpoint,
  });
  return { client, model: client.modelName, close: () => client.close() };
}
