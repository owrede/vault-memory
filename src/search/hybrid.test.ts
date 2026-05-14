import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Database } from "../db/database.js";
import { hybridSearch, rrfMerge } from "./hybrid.js";
import type { Vault } from "../vault/manager.js";
import type { OllamaClient } from "../ollama/index.js";

describe("rrfMerge (pure)", () => {
  it("default k=60 produces canonical 1/(60+rank) contributions", () => {
    const out = rrfMerge([{ items: ["a", "b"] }]);
    expect(out[0]?.item).toBe("a");
    expect(out[0]?.rrf).toBeCloseTo(1 / 61, 12);
    expect(out[1]?.item).toBe("b");
    expect(out[1]?.rrf).toBeCloseTo(1 / 62, 12);
  });

  it("an item present in both lists outscores items in only one", () => {
    const A = { items: ["x", "y", "z"] };
    const B = { items: ["y", "w", "v"] };
    const out = rrfMerge([A, B], 60);

    const byItem = new Map(out.map((r) => [r.item, r.rrf] as const));
    // y: rank 2 in A + rank 1 in B
    expect(byItem.get("y")).toBeCloseTo(1 / 62 + 1 / 61, 12);
    // x: only in A at rank 1
    expect(byItem.get("x")).toBeCloseTo(1 / 61, 12);

    // y must rank above x because it appears in both lists.
    expect(out[0]?.item).toBe("y");
  });

  it("ranks are 1-based and recorded per list", () => {
    const out = rrfMerge([{ items: ["a", "b"] }, { items: ["b", "a"] }], 60);
    const a = out.find((r) => r.item === "a");
    const b = out.find((r) => r.item === "b");
    expect(a?.ranks).toEqual([1, 2]);
    expect(b?.ranks).toEqual([2, 1]);
    // Both have identical RRF: 1/61 + 1/62. Ties allowed.
    expect(a?.rrf).toBeCloseTo(b?.rrf ?? -1, 12);
  });

  it("k controls top-rank emphasis (smaller k → larger top contribution)", () => {
    const lo = rrfMerge([{ items: ["a"] }], 1);
    const hi = rrfMerge([{ items: ["a"] }], 1000);
    expect((lo[0]?.rrf ?? 0) > (hi[0]?.rrf ?? 0)).toBe(true);
  });

  it("empty input → empty output", () => {
    expect(rrfMerge<number>([])).toEqual([]);
    expect(rrfMerge([{ items: [] }])).toEqual([]);
  });
});

describe("hybridSearch (integration)", () => {
  let db: Database;
  let vault: Vault;
  // The chunk we want the semantic search to favor.
  let targetChunkId: number;
  // Schema fixes embedding dim at 1024. Build sparse one-hot toy vectors so
  // L2 nearest-neighbor on the index is fully deterministic.
  const DIM = 1024;
  const oneHot = (i: number): number[] => {
    const v = new Array<number>(DIM).fill(0);
    v[i] = 1;
    return v;
  };
  const targetVec = oneHot(0);
  const otherVec1 = oneHot(1);
  const otherVec2 = oneHot(2);
  const queryVec = ((): number[] => {
    const v = new Array<number>(DIM).fill(0);
    v[0] = 0.99;
    v[1] = 0.01;
    return v;
  })();

  beforeEach(() => {
    db = new Database(":memory:");

    const model = db.models.upsert({
      name: "test-model",
      provider: "test",
      dim: DIM,
    });
    db.models.setActive(model.id);

    const a = db.notes.upsertByPath({
      path: "a.md",
      content: "alpha beta gamma",
      frontmatter: null,
      title: "A",
      hash: "ha",
      mtime: 1,
      wordCount: 3,
    });
    const b = db.notes.upsertByPath({
      path: "b.md",
      content: "delta",
      frontmatter: null,
      title: "B",
      hash: "hb",
      mtime: 1,
      wordCount: 1,
    });
    const c = db.notes.upsertByPath({
      path: "c.md",
      content: "epsilon",
      frontmatter: null,
      title: "C",
      hash: "hc",
      mtime: 1,
      wordCount: 1,
    });

    const aIds = db.chunks.insertBatch(a.id, [
      {
        idx: 0,
        text: "alpha is the target chunk we want to retrieve",
        headingPath: null,
        startOffset: 0,
        endOffset: 40,
        tokenCount: 7,
      },
      {
        idx: 1,
        text: "beta filler text for noise",
        headingPath: null,
        startOffset: 40,
        endOffset: 70,
        tokenCount: 5,
      },
    ]);
    targetChunkId = aIds[0]!;
    const otherChunkId1 = aIds[1]!;

    const bIds = db.chunks.insertBatch(b.id, [
      {
        idx: 0,
        text: "delta unrelated content",
        headingPath: null,
        startOffset: 0,
        endOffset: 25,
        tokenCount: 3,
      },
    ]);
    const otherChunkId2 = bIds[0]!;
    void c;

    db.embeddings.insertBatch([
      { chunkId: targetChunkId, modelId: model.id, vector: targetVec },
      { chunkId: otherChunkId1, modelId: model.id, vector: otherVec1 },
      { chunkId: otherChunkId2, modelId: model.id, vector: otherVec2 },
    ]);

    vault = {
      config: { name: "test-vault", path: "/dev/null" },
      db,
      dbPath: ":memory:",
    };
  });

  afterEach(() => {
    db.close();
  });

  it("returns top-hit favoring semantically matching chunk", async () => {
    const ollama = {
      embed: vi.fn().mockResolvedValue({
        vectors: [queryVec],
        dim: DIM,
        model: "test-model",
      }),
    } as unknown as OllamaClient;

    const hits = await hybridSearch({
      query: "alpha",
      embeddingModel: "test-model",
      ollama,
      vaults: [vault],
      topK: 3,
    });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.chunkText).toContain("alpha");
    expect(hits[0]?.score).toBeGreaterThan(0);
    expect(hits[0]?.scoreBreakdown?.rrf).toBeGreaterThan(0);
    // Semantic hit should be present (vector matches), and so should BM25
    // (the literal token "alpha" appears in the same chunk).
    expect(hits[0]?.scoreBreakdown?.semantic).toBeDefined();
    expect(hits[0]?.scoreBreakdown?.text).toBeDefined();
    expect(ollama.embed).toHaveBeenCalledTimes(1);
  });

  it("BM25-only path works when active model is missing", async () => {
    // No model registered → semantic skipped.
    const db2 = new Database(":memory:");
    const n = db2.notes.upsertByPath({
      path: "x.md",
      content: "hello",
      frontmatter: null,
      title: "X",
      hash: "hx",
      mtime: 1,
      wordCount: 1,
    });
    db2.chunks.insertBatch(n.id, [
      {
        idx: 0,
        text: "hello world from BM25",
        headingPath: null,
        startOffset: 0,
        endOffset: 22,
        tokenCount: 4,
      },
    ]);
    const v2: Vault = {
      config: { name: "v2", path: "/dev/null" },
      db: db2,
      dbPath: ":memory:",
    };

    const ollama = {
      embed: vi.fn(),
    } as unknown as OllamaClient;

    const hits = await hybridSearch({
      query: "hello",
      embeddingModel: "test-model",
      ollama,
      vaults: [v2],
      topK: 5,
    });
    expect(hits.length).toBe(1);
    expect(hits[0]?.scoreBreakdown?.semantic).toBeUndefined();
    expect(hits[0]?.scoreBreakdown?.text).toBeDefined();
    // No vault used the embedding model, so we should not have called embed.
    expect(ollama.embed).not.toHaveBeenCalled();
    db2.close();
  });

  it("topK ≤ 0, empty query, or empty vaults → empty result", async () => {
    const ollama = { embed: vi.fn() } as unknown as OllamaClient;
    expect(
      await hybridSearch({
        query: "alpha",
        embeddingModel: "test-model",
        ollama,
        vaults: [vault],
        topK: 0,
      }),
    ).toEqual([]);
    expect(
      await hybridSearch({
        query: "   ",
        embeddingModel: "test-model",
        ollama,
        vaults: [vault],
      }),
    ).toEqual([]);
    expect(
      await hybridSearch({
        query: "alpha",
        embeddingModel: "test-model",
        ollama,
        vaults: [],
      }),
    ).toEqual([]);
  });

  it("reranker reorders results and surfaces rerank score in breakdown", async () => {
    const ollama = {
      embed: vi.fn().mockResolvedValue({
        vectors: [queryVec],
        dim: DIM,
        model: "test-model",
      }),
    } as unknown as OllamaClient;

    // Without rerank: "alpha…target" wins (both semantic + BM25).
    const baseline = await hybridSearch({
      query: "alpha",
      embeddingModel: "test-model",
      ollama,
      vaults: [vault],
      topK: 3,
    });
    expect(baseline[0]?.chunkText).toContain("alpha");

    // Mock reranker that *inverts* the order: assigns higher score to
    // chunks NOT containing "alpha". This forces a reorder we can detect.
    const reranker = {
      score: vi.fn(async (_q: string, chunks: readonly string[]) =>
        chunks.map((c) => (c.includes("alpha") ? 0 : 1)),
      ),
    };

    const reranked = await hybridSearch({
      query: "alpha",
      embeddingModel: "test-model",
      ollama,
      vaults: [vault],
      topK: 3,
      reranker,
    });

    expect(reranked.length).toBeGreaterThan(0);
    // Top hit is now a non-alpha chunk.
    expect(reranked[0]?.chunkText).not.toContain("alpha");
    // Rerank score surfaces in the breakdown and as the primary score.
    expect(reranked[0]?.scoreBreakdown?.rerank).toBe(1);
    expect(reranked[0]?.score).toBe(1);
    // RRF breakdown is preserved.
    expect(reranked[0]?.scoreBreakdown?.rrf).toBeGreaterThan(0);
    expect(reranker.score).toHaveBeenCalledTimes(1);
  });

  it("skips near-empty chunks (< 20 trim chars) from the rerank pool", async () => {
    // Add a near-empty chunk that would otherwise get reranked. The
    // reranker mock asserts it never sees chunks shorter than the
    // threshold — they keep their RRF position but bypass the cross-
    // encoder pass entirely.
    const tinyDb = new Database(":memory:");
    const model = tinyDb.models.upsert({
      name: "test-model",
      provider: "test",
      dim: DIM,
    });
    tinyDb.models.setActive(model.id);

    const big = tinyDb.notes.upsertByPath({
      path: "big.md",
      content: "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda",
      frontmatter: null,
      title: "Big",
      hash: "hbig",
      mtime: 1,
      wordCount: 11,
    });
    const tiny = tinyDb.notes.upsertByPath({
      path: "tiny.md",
      content: "x",
      frontmatter: null,
      title: "Tiny",
      hash: "htiny",
      mtime: 1,
      wordCount: 1,
    });
    const bigIds = tinyDb.chunks.insertBatch(big.id, [
      {
        idx: 0,
        text: "alpha and many other useful words for a long enough chunk to survive the filter",
        headingPath: null,
        startOffset: 0,
        endOffset: 80,
        tokenCount: 15,
      },
    ]);
    const tinyIds = tinyDb.chunks.insertBatch(tiny.id, [
      {
        idx: 0,
        text: "alpha", // 5 chars trim — below MIN_RERANK_TRIM_CHARS (20)
        headingPath: null,
        startOffset: 0,
        endOffset: 5,
        tokenCount: 1,
      },
    ]);
    tinyDb.embeddings.insertBatch([
      { chunkId: bigIds[0]!, modelId: model.id, vector: targetVec },
      { chunkId: tinyIds[0]!, modelId: model.id, vector: otherVec1 },
    ]);
    const v: Vault = {
      config: { name: "tiny-vault", path: "/dev/null" },
      db: tinyDb,
      dbPath: ":memory:",
    };

    const ollama = {
      embed: vi.fn().mockResolvedValue({
        vectors: [queryVec],
        dim: DIM,
        model: "test-model",
      }),
    } as unknown as OllamaClient;

    let seenByReranker: string[] = [];
    const reranker = {
      score: vi.fn(async (_q: string, chunks: readonly string[]) => {
        seenByReranker = [...chunks];
        return chunks.map(() => 0.5);
      }),
    };

    await hybridSearch({
      query: "alpha",
      embeddingModel: "test-model",
      ollama,
      vaults: [v],
      topK: 5,
      reranker,
    });

    // Reranker was called, but only with the long chunk.
    expect(reranker.score).toHaveBeenCalledTimes(1);
    expect(seenByReranker).toHaveLength(1);
    expect(seenByReranker[0]).toContain("alpha and many other useful");

    tinyDb.close();
  });

  it("falls back to RRF when ALL pool candidates are too short to rerank", async () => {
    const tinyDb = new Database(":memory:");
    const model = tinyDb.models.upsert({
      name: "test-model",
      provider: "test",
      dim: DIM,
    });
    tinyDb.models.setActive(model.id);

    const n = tinyDb.notes.upsertByPath({
      path: "n.md",
      content: "shorty",
      frontmatter: null,
      title: "N",
      hash: "hn",
      mtime: 1,
      wordCount: 1,
    });
    const ids = tinyDb.chunks.insertBatch(n.id, [
      {
        idx: 0,
        text: "alpha",
        headingPath: null,
        startOffset: 0,
        endOffset: 5,
        tokenCount: 1,
      },
    ]);
    tinyDb.embeddings.insertBatch([{ chunkId: ids[0]!, modelId: model.id, vector: targetVec }]);
    const v: Vault = {
      config: { name: "all-tiny", path: "/dev/null" },
      db: tinyDb,
      dbPath: ":memory:",
    };

    const ollama = {
      embed: vi.fn().mockResolvedValue({
        vectors: [queryVec],
        dim: DIM,
        model: "test-model",
      }),
    } as unknown as OllamaClient;

    const reranker = {
      score: vi.fn(async () => [0.99]),
    };

    const hits = await hybridSearch({
      query: "alpha",
      embeddingModel: "test-model",
      ollama,
      vaults: [v],
      topK: 5,
      reranker,
    });

    // Reranker never called — pool was empty after filter.
    expect(reranker.score).not.toHaveBeenCalled();
    // Still get a result from the RRF fallback.
    expect(hits.length).toBe(1);
    expect(hits[0]?.chunkText).toBe("alpha");
    expect(hits[0]?.scoreBreakdown?.rerank).toBeUndefined();

    tinyDb.close();
  });

  it("reranker failure falls back silently to RRF order", async () => {
    const ollama = {
      embed: vi.fn().mockResolvedValue({
        vectors: [queryVec],
        dim: DIM,
        model: "test-model",
      }),
    } as unknown as OllamaClient;

    const reranker = {
      score: vi.fn(async () => {
        throw new Error("ollama down");
      }),
    };

    const hits = await hybridSearch({
      query: "alpha",
      embeddingModel: "test-model",
      ollama,
      vaults: [vault],
      topK: 3,
      reranker,
    });

    // Same shape as the un-reranked result.
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.chunkText).toContain("alpha");
    expect(hits[0]?.scoreBreakdown?.rerank).toBeUndefined();
    expect(hits[0]?.score).toBe(hits[0]?.scoreBreakdown?.rrf);
  });
});
