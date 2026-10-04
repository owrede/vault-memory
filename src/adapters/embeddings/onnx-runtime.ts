import { readFile, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { OnnxEmbeddingProvider } from "../../embeddings/onnx.js";
const fileSchema = z
  .object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
const manifestSchema = z
  .object({
    schema_version: z.literal(1),
    provider: z.literal("onnx"),
    model: z.string().min(1),
    revision: z.string().min(1),
    dimensions: z.number().int().min(1).max(8192),
    pooling: z.literal("mean"),
    normalize: z.literal(true),
    max_tokens: z.number().int().min(1).max(8192),
    pad_token_id: z.number().int().min(0),
    query_prefix: z.string(),
    passage_prefix: z.string(),
    output: z.string().min(1),
    license: z.string().min(1),
    files: z
      .object({
        "model.onnx": fileSchema,
        "tokenizer.json": fileSchema,
        "tokenizer_config.json": fileSchema,
      })
      .strict(),
  })
  .strict();
export async function loadOnnxProvider(modelPath: string): Promise<OnnxEmbeddingProvider> {
  const root = await realpath(modelPath);
  const raw = await readFile(join(root, "manifest.json"), "utf8");
  const manifest = manifestSchema.parse(JSON.parse(raw));
  const assets: Record<string, Uint8Array> = {};
  for (const [key, file] of Object.entries(manifest.files)) {
    const path = await realpath(join(root, file.path));
    const resource = relative(root, path);
    if (
      isAbsolute(file.path) ||
      resource === ".." ||
      resource.startsWith("../") ||
      isAbsolute(resource)
    )
      throw new Error("Model asset outside model_path");
    const bytes = await readFile(path);
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
      throw new Error(`Model checksum mismatch: ${key}`);
    assets[key] = bytes;
  }
  const [{ Tokenizer }, ort] = await Promise.all([
    import("@huggingface/tokenizers"),
    import("onnxruntime-node"),
  ]);
  const tokenizer = new Tokenizer(
    JSON.parse(Buffer.from(assets["tokenizer.json"]!).toString("utf8")),
    JSON.parse(Buffer.from(assets["tokenizer_config.json"]!).toString("utf8")),
  );
  const session = await ort.InferenceSession.create(assets["model.onnx"]!, {
    executionProviders: ["cpu"],
    intraOpNumThreads: 1,
  });
  try {
    if (
      !session.inputNames.includes("input_ids") ||
      !session.inputNames.includes("attention_mask") ||
      !session.outputNames.includes(manifest.output)
    )
      throw new Error("Unsupported embedding model inputs/outputs");
    return new OnnxEmbeddingProvider({
      identity: {
        provider: "onnx",
        model: manifest.model,
        revision: `${manifest.revision}#${createHash("sha256").update(raw).digest("hex")}`,
        dimensions: manifest.dimensions,
      },
      maxTokens: manifest.max_tokens,
      queryPrefix: manifest.query_prefix,
      passagePrefix: manifest.passage_prefix,
      encode: (text) => {
        const encoded = tokenizer.encode(text);
        return { ids: encoded.ids, mask: encoded.attention_mask };
      },
      run: async (ids, mask) => {
        const feeds: Record<string, import("onnxruntime-node").Tensor> = {
          input_ids: new ort.Tensor("int64", BigInt64Array.from(ids), [1, ids.length]),
          attention_mask: new ort.Tensor("int64", BigInt64Array.from(mask), [1, mask.length]),
        };
        if (session.inputNames.includes("token_type_ids"))
          feeds.token_type_ids = new ort.Tensor("int64", new BigInt64Array(ids.length), [
            1,
            ids.length,
          ]);
        const result = (await session.run(feeds))[manifest.output]!;
        if (!(result.data instanceof Float32Array))
          throw new Error("ONNX expected float32 hidden output");
        return { hidden: result.data, shape: result.dims };
      },
      close: () => session.release(),
    });
  } catch (error) {
    await session.release();
    throw error;
  }
}
