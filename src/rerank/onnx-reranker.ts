/**
 * ONNX-runtime cross-encoder reranker (Phase 8).
 *
 * Replaces the L2-norm proxy from Phase 7d (`OllamaReranker`) with a real
 * cross-encoder forward pass over BAAI/bge-reranker-v2-m3 (ONNX-quantized).
 *
 * # Model files
 *
 * Expects two files in `modelDir`:
 *   - `model_quantized.onnx`  (≈570 MB, INT8)
 *   - `tokenizer.json`        (≈17 MB)
 *
 * Both are downloaded by `scripts/download-reranker.sh` (or the
 * `vault-memory download-reranker` CLI subcommand) from
 * https://huggingface.co/onnx-community/bge-reranker-v2-m3-ONNX.
 *
 * # Output semantics
 *
 * The model outputs a single logit per (query, document) pair. We apply
 * sigmoid to map to [0, 1]; higher = more relevant — matching the
 * `Reranker` contract directly (no negation hack).
 *
 * # Lazy loading
 *
 * `onnxruntime-node` and `@huggingface/tokenizers` are imported lazily on
 * the first `score()` call so users who never enable `rerank:true` don't
 * pay the load cost (and so test runs without the model files pass).
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Reranker } from "./reranker.js";

export interface OnnxRerankerOptions {
  /** Directory containing `model_quantized.onnx` + `tokenizer.json`. */
  modelDir: string;
  /** Max sequence length per (query, doc) pair. Default 512. */
  maxLength?: number;
}

interface LoadedSession {
  // Kept as `unknown` to avoid pulling the type at module load.
  session: any;
  tokenizer: any;
  ort: any;
}

export class OnnxReranker implements Reranker {
  private readonly modelDir: string;
  private readonly maxLength: number;
  private loaded: LoadedSession | null = null;
  private loading: Promise<LoadedSession> | null = null;

  constructor(opts: OnnxRerankerOptions) {
    this.modelDir = opts.modelDir;
    this.maxLength = opts.maxLength ?? 512;
  }

  /**
   * Score each chunk against the query. Returns sigmoid(logit) per pair.
   * Throws if the model files are missing (with a copy-pasteable curl
   * command in the error message).
   */
  async score(query: string, chunks: readonly string[]): Promise<number[]> {
    if (chunks.length === 0) return [];
    const { session, tokenizer, ort } = await this.load();

    // Tokenize each (query, chunk) pair separately so we can build the
    // batch with per-row truncation to maxLength, then pad to the longest
    // row in the batch (saves work over padding everything to 512).
    const encoded = chunks.map((chunk) => {
      const enc = tokenizer.encode(query, { text_pair: chunk });
      let ids: number[] = enc.ids;
      let mask: number[] = enc.attention_mask;
      if (ids.length > this.maxLength) {
        ids = ids.slice(0, this.maxLength);
        mask = mask.slice(0, this.maxLength);
      }
      return { ids, mask };
    });

    const seqLen = Math.max(...encoded.map((e) => e.ids.length));
    const batch = encoded.length;
    const inputIds = new BigInt64Array(batch * seqLen);
    const attentionMask = new BigInt64Array(batch * seqLen);
    for (let i = 0; i < batch; i++) {
      const row = encoded[i]!;
      for (let j = 0; j < row.ids.length; j++) {
        inputIds[i * seqLen + j] = BigInt(row.ids[j]!);
        attentionMask[i * seqLen + j] = BigInt(row.mask[j]!);
      }
      // Remaining positions stay 0n (pad token id 0 for XLM-R / bge-m3).
    }

    const feeds: Record<string, any> = {
      input_ids: new ort.Tensor("int64", inputIds, [batch, seqLen]),
      attention_mask: new ort.Tensor("int64", attentionMask, [batch, seqLen]),
    };
    const out = await session.run(feeds);
    // The model exports its output as `logits`. Fall back to first key
    // for robustness against minor export variants.
    const logitsTensor =
      out.logits ?? out[Object.keys(out)[0] as keyof typeof out];
    const data = logitsTensor.data as Float32Array;
    // logits shape: [batch, 1] — one score per pair. Sigmoid → [0, 1].
    const scores: number[] = new Array(batch);
    for (let i = 0; i < batch; i++) {
      scores[i] = sigmoid(data[i]!);
    }
    return scores;
  }

  private async load(): Promise<LoadedSession> {
    if (this.loaded) return this.loaded;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const modelPath = join(this.modelDir, "model_quantized.onnx");
      const tokenizerPath = join(this.modelDir, "tokenizer.json");
      if (!existsSync(modelPath)) {
        throw new Error(
          `OnnxReranker: model file not found at ${modelPath}. ` +
            `Run: curl -L https://huggingface.co/onnx-community/bge-reranker-v2-m3-ONNX/resolve/main/onnx/model_quantized.onnx -o ${modelPath}`,
        );
      }
      if (!existsSync(tokenizerPath)) {
        throw new Error(
          `OnnxReranker: tokenizer file not found at ${tokenizerPath}. ` +
            `Run: curl -L https://huggingface.co/onnx-community/bge-reranker-v2-m3-ONNX/resolve/main/tokenizer.json -o ${tokenizerPath}`,
        );
      }
      const [ort, tokMod, tokJson] = await Promise.all([
        import("onnxruntime-node"),
        import("@huggingface/tokenizers"),
        readFile(tokenizerPath, "utf-8"),
      ]);
      // @huggingface/tokenizers expects two args: the tokenizer.json object
      // *and* a separate config object with special-token strings (bos/eos/
      // pad/unk). HF distributions ship that as tokenizer_config.json, but
      // for bge-reranker-v2-m3 only tokenizer.json is published. We derive
      // the config from added_tokens — known stable: XLM-RoBERTa schema
      // (<s>=0, <pad>=1, </s>=2, <unk>=3).
      const tokenizerJson = JSON.parse(tokJson);
      const config = deriveTokenizerConfig(tokenizerJson);
      const tokenizer = new (tokMod as any).Tokenizer(tokenizerJson, config);
      const session = await (ort as any).InferenceSession.create(modelPath);
      const loaded: LoadedSession = { session, tokenizer, ort };
      this.loaded = loaded;
      return loaded;
    })();
    return this.loading;
  }
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Derive the tokenizer config (special-token strings) from added_tokens.
 * @huggingface/tokenizers needs this as a second constructor arg; HF
 * usually ships it as a separate tokenizer_config.json, but bge-reranker-
 * v2-m3 only publishes tokenizer.json — so we reconstruct from added_tokens.
 *
 * Falls back to XLM-RoBERTa defaults (the reranker's base architecture).
 */
function deriveTokenizerConfig(tokenizerJson: any): Record<string, string> {
  const added: Array<{ id: number; content: string; special?: boolean }> =
    tokenizerJson.added_tokens ?? [];
  const byContent = new Map(added.map((t) => [t.content, t]));
  const pick = (...candidates: string[]): string => {
    for (const c of candidates) if (byContent.has(c)) return c;
    return candidates[0]!;
  };
  return {
    bos_token: pick("<s>"),
    eos_token: pick("</s>"),
    pad_token: pick("<pad>"),
    unk_token: pick("<unk>"),
  };
}
