import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OllamaClient } from "./client.js";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(text: string, status: number): Response {
  return new Response(text, { status });
}

function makeEmbeddings(count: number, dim = 3): number[][] {
  return Array.from({ length: count }, (_, i) => Array.from({ length: dim }, (_, j) => i + j / 10));
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("OllamaClient.embed", () => {
  it("makes a single request for a small batch", async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse({
        embeddings: makeEmbeddings(2, 4),
        model: "test-model",
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new OllamaClient({ batchSize: 10, retries: 0 });
    const res = await client.embed({
      model: "test-model",
      texts: ["hello", "world"],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/embed");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as {
      model: string;
      input: string[];
    };
    expect(body).toEqual({ model: "test-model", input: ["hello", "world"] });

    expect(res.vectors).toHaveLength(2);
    expect(res.dim).toBe(4);
    expect(res.model).toBe("test-model");
  });

  it("splits large input into multiple parallel batches", async () => {
    const fetchMock: FetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as {
        input: string[];
      };
      return jsonResponse({
        embeddings: makeEmbeddings(body.input.length, 3),
        model: "m",
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new OllamaClient({ batchSize: 10, retries: 0 });
    const texts = Array.from({ length: 25 }, (_, i) => `t${i}`);
    const res = await client.embed({ model: "m", texts });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.vectors).toHaveLength(25);
    expect(res.dim).toBe(3);

    // Verify batch sizes 10, 10, 5
    const sizes = fetchMock.mock.calls.map(
      (c) => (JSON.parse((c[1] as RequestInit).body as string) as { input: string[] }).input.length,
    );
    expect(sizes).toEqual([10, 10, 5]);
  });

  it("retries on 500 and eventually succeeds", async () => {
    let attempts = 0;
    const fetchMock: FetchMock = vi.fn(async () => {
      attempts++;
      if (attempts < 3) return textResponse("server fail", 500);
      return jsonResponse({
        embeddings: makeEmbeddings(1, 2),
        model: "m",
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new OllamaClient({ batchSize: 10, retries: 3 });
    const res = await client.embed({ model: "m", texts: ["x"] });
    expect(attempts).toBe(3);
    expect(res.vectors).toHaveLength(1);
    expect(res.dim).toBe(2);
  });

  it("propagates AbortError when request times out", async () => {
    const fetchMock: FetchMock = vi.fn((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = (init as RequestInit).signal as AbortSignal | undefined;
        if (signal) {
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new OllamaClient({
      batchSize: 10,
      retries: 1,
      timeoutMs: 10,
    });

    await expect(client.embed({ model: "m", texts: ["x"] })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("returns empty result when texts is empty", async () => {
    const fetchMock: FetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new OllamaClient();
    const res = await client.embed({ model: "m", texts: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res).toEqual({ vectors: [], dim: 0, model: "m" });
  });
});

describe("OllamaClient.healthCheck", () => {
  it("returns ok with model list on 200", async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse({
        models: [{ name: "qwen3-embedding:latest" }, { name: "llama3:8b" }],
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new OllamaClient();
    const res = await client.healthCheck();
    expect(res.ok).toBe(true);
    expect(res.models).toEqual(["qwen3-embedding:latest", "llama3:8b"]);
    const url = (fetchMock.mock.calls[0] as [string])[0];
    expect(url).toBe("http://localhost:11434/api/tags");
  });

  it("returns not-ok on non-2xx", async () => {
    const fetchMock: FetchMock = vi.fn(async () => textResponse("nope", 503));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new OllamaClient();
    const res = await client.healthCheck();
    expect(res.ok).toBe(false);
    expect(res.error).toContain("503");
  });

  it("returns not-ok on network error", async () => {
    const fetchMock: FetchMock = vi.fn(async () => {
      throw new TypeError("connection refused");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new OllamaClient();
    const res = await client.healthCheck();
    expect(res.ok).toBe(false);
    expect(res.error).toContain("connection refused");
  });
});

describe("OllamaClient.modelExists", () => {
  function mockTags(names: string[]): FetchMock {
    return vi.fn(async () => jsonResponse({ models: names.map((name) => ({ name })) }));
  }

  it("matches exact name", async () => {
    globalThis.fetch = mockTags(["qwen3-embedding:latest"]) as unknown as typeof fetch;
    const client = new OllamaClient();
    expect(await client.modelExists("qwen3-embedding:latest")).toBe(true);
  });

  it("matches name without tag against tagged loaded model", async () => {
    globalThis.fetch = mockTags(["qwen3-embedding:latest"]) as unknown as typeof fetch;
    const client = new OllamaClient();
    expect(await client.modelExists("qwen3-embedding")).toBe(true);
  });

  it("matches tagged name against tagless loaded model", async () => {
    globalThis.fetch = mockTags(["qwen3-embedding"]) as unknown as typeof fetch;
    const client = new OllamaClient();
    expect(await client.modelExists("qwen3-embedding:latest")).toBe(true);
  });

  it("returns false when not present", async () => {
    globalThis.fetch = mockTags(["llama3:8b"]) as unknown as typeof fetch;
    const client = new OllamaClient();
    expect(await client.modelExists("qwen3-embedding")).toBe(false);
  });

  it("returns false when health check fails", async () => {
    globalThis.fetch = vi.fn(async () => textResponse("err", 500)) as unknown as typeof fetch;
    const client = new OllamaClient();
    expect(await client.modelExists("anything")).toBe(false);
  });
});
