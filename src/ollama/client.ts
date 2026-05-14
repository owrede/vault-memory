/**
 * Ollama HTTP client for embedding generation.
 *
 * Talks to a local (or remote) Ollama server's REST API:
 *   - POST /api/embed   — generate embeddings
 *   - GET  /api/tags    — list loaded models
 *
 * Splits large batches, retries transient failures with exponential backoff,
 * and enforces per-request timeouts via AbortController.
 */

import { z } from "zod";
import type { EmbedRequest, EmbedResponse, OllamaClientOptions } from "../types.js";
import { withRetry } from "./retry.js";

const DEFAULT_ENDPOINT = "http://localhost:11434";
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 3;

const EmbedResponseSchema = z.object({
  embeddings: z.array(z.array(z.number())),
  model: z.string().optional(),
});

const TagsResponseSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
    }),
  ),
});

/**
 * Error thrown for non-2xx HTTP responses. Retried automatically for 5xx.
 */
export class OllamaHttpError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "OllamaHttpError";
    this.status = status;
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof OllamaHttpError) {
    return err.status >= 500 && err.status < 600;
  }
  // AbortError (timeout) — retry
  if (err instanceof Error && err.name === "AbortError") return true;
  // Network errors (TypeError from fetch on connection failures)
  if (err instanceof TypeError) return true;
  return false;
}

function stripTag(name: string): string {
  const idx = name.indexOf(":");
  return idx === -1 ? name : name.slice(0, idx);
}

export class OllamaClient {
  private readonly endpoint: string;
  private readonly batchSize: number;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(options: OllamaClientOptions = {}) {
    this.endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, "");
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = options.retries ?? DEFAULT_RETRIES;
  }

  /**
   * Generate embeddings for the request's texts.
   *
   * If `texts.length > batchSize`, splits into multiple parallel HTTP requests
   * and concatenates the resulting vectors in order.
   */
  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    const { model, texts } = request;
    if (texts.length === 0) {
      return { vectors: [], dim: 0, model };
    }

    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      batches.push(texts.slice(i, i + this.batchSize));
    }

    const results = await Promise.all(batches.map((batch) => this.embedBatch(model, batch)));

    const vectors: number[][] = [];
    let confirmedModel = model;
    for (const res of results) {
      vectors.push(...res.embeddings);
      if (res.model !== undefined) confirmedModel = res.model;
    }

    const first = vectors[0];
    if (first === undefined) {
      // Shouldn't happen — texts was non-empty
      return { vectors, dim: 0, model: confirmedModel };
    }
    const dim = first.length;

    return { vectors, dim, model: confirmedModel };
  }

  private async embedBatch(
    model: string,
    texts: string[],
  ): Promise<{ embeddings: number[][]; model?: string }> {
    return withRetry(
      async () => {
        const body = JSON.stringify({ model, input: texts });
        const response = await this.fetchWithTimeout(`${this.endpoint}/api/embed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new OllamaHttpError(
            response.status,
            `Ollama /api/embed returned ${response.status}: ${text}`,
          );
        }

        const json: unknown = await response.json();
        const parsed = EmbedResponseSchema.parse(json);
        return { embeddings: parsed.embeddings, model: parsed.model };
      },
      { retries: this.retries, shouldRetry: isRetryable },
    );
  }

  /**
   * Check Ollama server liveness and return loaded model names.
   */
  async healthCheck(): Promise<{ ok: boolean; models?: string[]; error?: string }> {
    try {
      const response = await this.fetchWithTimeout(`${this.endpoint}/api/tags`, { method: "GET" });
      if (!response.ok) {
        return {
          ok: false,
          error: `HTTP ${response.status}`,
        };
      }
      const json: unknown = await response.json();
      const parsed = TagsResponseSchema.parse(json);
      return { ok: true, models: parsed.models.map((m) => m.name) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  /**
   * True iff `modelName` is loaded on the server.
   *
   * Matches both fully-qualified names ("qwen3-embedding:latest") and
   * tag-less names ("qwen3-embedding"): each is matched against the other
   * after stripping the `:tag` suffix.
   */
  async modelExists(modelName: string): Promise<boolean> {
    const health = await this.healthCheck();
    if (!health.ok || health.models === undefined) return false;
    const wantBase = stripTag(modelName);
    for (const name of health.models) {
      if (name === modelName) return true;
      if (stripTag(name) === wantBase) return true;
    }
    return false;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
