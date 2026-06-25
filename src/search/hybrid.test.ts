import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Database } from "../db/database.js";
import { hybridSearch, rrfMerge } from "./hybrid.js";
import type { Vault } from "../vault/manager.js";
import { VaultManager } from "../vault/manager.js";
import type { OllamaClient } from "../ollama/index.js";
import type { ExpandDeps } from "../graph/index.js";
import type { SourceConnector } from "../adapters/source/types.js";
import { parseSourceHandle } from "../adapters/registry.js";
import type { DocId, Document, SourceHandle } from "../types.js";

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
    db = new Database(":memory:", "test-vault");

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
    const db2 = new Database(":memory:", "test-vault");
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

  // ── Alias-aware query expansion (ISSUE-aliases-not-in-fulltext-retrieval) ──
  // Note `c` ("c.md", body "epsilon") has NO chunk whose text contains its
  // alias — exactly the issue scenario: a person note whose body never
  // mentions the alias token. Searching the alias must still surface it.
  it("surfaces the alias target note even when its body lacks the alias token", async () => {
    db.aliases.setForNote(db.notes.getByPath("c.md")!.id, ["JHE"]);
    const ollama = {
      embed: vi.fn().mockResolvedValue({ vectors: [queryVec], dim: DIM, model: "test-model" }),
    } as unknown as OllamaClient;

    const hits = await hybridSearch({
      query: "JHE",
      embeddingModel: "test-model",
      ollama,
      vaults: [vault],
      topK: 10,
    });
    // The alias target is the top hit and records the triggering alias.
    expect(hits[0]?.notePath).toBe("c.md");
    expect(hits[0]?.scoreBreakdown?.alias).toBe("JHE");
  });

  it("alias match is case-insensitive (normalize)", async () => {
    db.aliases.setForNote(db.notes.getByPath("c.md")!.id, ["JHE"]);
    const ollama = {
      embed: vi.fn().mockResolvedValue({ vectors: [queryVec], dim: DIM, model: "test-model" }),
    } as unknown as OllamaClient;
    const hits = await hybridSearch({
      query: "jhe",
      embeddingModel: "test-model",
      ollama,
      vaults: [vault],
      topK: 10,
    });
    expect(hits[0]?.notePath).toBe("c.md");
  });

  it("aliasExpansion:false restores pre-fix behavior (alias not injected)", async () => {
    db.aliases.setForNote(db.notes.getByPath("c.md")!.id, ["JHE"]);
    const ollama = {
      embed: vi.fn().mockResolvedValue({ vectors: [queryVec], dim: DIM, model: "test-model" }),
    } as unknown as OllamaClient;
    const hits = await hybridSearch({
      query: "JHE",
      embeddingModel: "test-model",
      ollama,
      vaults: [vault],
      topK: 10,
      aliasExpansion: false,
    });
    // c.md has no body token "JHE" and no chunk → it must NOT appear.
    expect(hits.find((h) => h.notePath === "c.md")).toBeUndefined();
  });

  it("promotes an organically-retrieved alias target to the top (no extra injection)", async () => {
    // Give note `a` (which IS retrievable for "alpha") an alias, then search
    // the alias. Its hit should be promoted to rank 0. Promotion reorders the
    // existing hit rather than injecting a synthetic duplicate, so the total
    // a.md hit count is unchanged from a no-alias baseline.
    const ollama = {
      embed: vi.fn().mockResolvedValue({ vectors: [queryVec], dim: DIM, model: "test-model" }),
    } as unknown as OllamaClient;
    const baseline = await hybridSearch({
      query: "alpha",
      embeddingModel: "test-model",
      ollama,
      vaults: [vault],
      topK: 10,
      aliasExpansion: false,
    });
    const baselineCount = baseline.filter((h) => h.notePath === "a.md").length;

    db.aliases.setForNote(db.notes.getByPath("a.md")!.id, ["alpha"]);
    const hits = await hybridSearch({
      query: "alpha",
      embeddingModel: "test-model",
      ollama,
      vaults: [vault],
      topK: 10,
    });
    expect(hits[0]?.notePath).toBe("a.md");
    // Promotion reordered an existing hit, did not add a synthetic one.
    expect(hits.filter((h) => h.notePath === "a.md")).toHaveLength(baselineCount);
  });

  it("non-alias query does no alias injection (unchanged behavior)", async () => {
    db.aliases.setForNote(db.notes.getByPath("c.md")!.id, ["JHE"]);
    const ollama = {
      embed: vi.fn().mockResolvedValue({ vectors: [queryVec], dim: DIM, model: "test-model" }),
    } as unknown as OllamaClient;
    const hits = await hybridSearch({
      query: "alpha",
      embeddingModel: "test-model",
      ollama,
      vaults: [vault],
      topK: 10,
    });
    // "alpha" is not an alias → c.md (the JHE note) must not be injected.
    expect(hits.find((h) => h.notePath === "c.md")).toBeUndefined();
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
    const tinyDb = new Database(":memory:", "test-vault");
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
    const tinyDb = new Database(":memory:", "test-vault");
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

// ─── Phase 4 / 04-04 (GRA-03 / D-15 / D-16) — search_hybrid({expand}) ─────────
//
// Composition layer: hybridSearch() optionally calls expand() AFTER the
// Phase 3 rescore block to attach per-hit typed-edge expansions. The
// guard `if (opts.expand && opts.expandDeps && hits.length > 0)`
// short-circuits when `expand` is omitted, preserving v1-baseline
// byte-identity.
describe("hybridSearch — Plan 04-04 ({expand}) auto-expansion", () => {
  const VAULT_NAME = "expand-vault";
  const DIM = 1024;
  const oneHot = (i: number): number[] => {
    const v = new Array<number>(DIM).fill(0);
    v[i] = 1;
    return v;
  };

  interface ExpandFixture {
    db: Database;
    vault: Vault;
    manager: VaultManager;
    deps: ExpandDeps;
    ollama: OllamaClient;
    queryVec: number[];
    cleanup: () => void;
    /** Map of note path → note id (for expectations). */
    idByPath: Map<string, number>;
  }

  /**
   * Build a fixture where SOME notes are "hits" (contain "atlas") and
   * SOME notes are "extras" (no "atlas" token — invisible to hybrid
   * search). Edges link hits to extras so expand surfaces neighbors
   * that are NOT already in the result list.
   *
   * Layout:
   *
   *   hit-a.md  ──wikilink──> ext-1.md  ──wikilink──> ext-2.md
   *   hit-a.md  ──mention───> ext-3.md
   *   ext-4.md  ──wikilink──> hit-b.md     (for backward direction test)
   *
   * `hit-a.md` chunk gets the freshest embedding so it ranks #1.
   *
   * The seed-suppression rule of `expand()` (Plan 04-03 decision:
   * "seeds are excluded from result documents in ALL cases") means a
   * hit can never appear in another hit's expansions. So the fixture
   * intentionally puts the interesting graph neighbors OUTSIDE the
   * hit set.
   */
  function buildExpandFixture(): ExpandFixture {
    const db = new Database(":memory:", VAULT_NAME);

    const model = db.models.upsert({
      name: "test-model",
      provider: "test",
      dim: DIM,
    });
    db.models.setActive(model.id);

    const hitA = db.notes.upsertByPath({
      path: "hit-a.md",
      content: "atlas seed content",
      frontmatter: null,
      title: "Hit A",
      hash: "h-hit-a",
      mtime: 1,
      wordCount: 3,
    });
    const hitB = db.notes.upsertByPath({
      path: "hit-b.md",
      content: "atlas other hit",
      frontmatter: null,
      title: "Hit B",
      hash: "h-hit-b",
      mtime: 1,
      wordCount: 3,
    });
    const ext1 = db.notes.upsertByPath({
      path: "ext-1.md",
      content: "first extra non-hit doc",
      frontmatter: null,
      title: "Ext 1",
      hash: "h-e1",
      mtime: 1,
      wordCount: 5,
    });
    const ext2 = db.notes.upsertByPath({
      path: "ext-2.md",
      content: "second extra non-hit doc",
      frontmatter: null,
      title: "Ext 2",
      hash: "h-e2",
      mtime: 1,
      wordCount: 5,
    });
    const ext3 = db.notes.upsertByPath({
      path: "ext-3.md",
      content: "third extra mentioned doc",
      frontmatter: null,
      title: "Ext 3",
      hash: "h-e3",
      mtime: 1,
      wordCount: 4,
    });
    const ext4 = db.notes.upsertByPath({
      path: "ext-4.md",
      content: "fourth extra backlink source",
      frontmatter: null,
      title: "Ext 4",
      hash: "h-e4",
      mtime: 1,
      wordCount: 4,
    });

    const hitAChunkIds = db.chunks.insertBatch(hitA.id, [
      {
        idx: 0,
        text: "atlas long chunk text content here for hybrid",
        headingPath: null,
        startOffset: 0,
        endOffset: 40,
        tokenCount: 7,
      },
    ]);
    const hitBChunkIds = db.chunks.insertBatch(hitB.id, [
      {
        idx: 0,
        text: "atlas other hit chunk text content here",
        headingPath: null,
        startOffset: 0,
        endOffset: 40,
        tokenCount: 7,
      },
    ]);
    // Extras get chunks too (so they're indexed) but their content has
    // no "atlas" token, so neither BM25 nor (with the chosen query
    // vector) the semantic path surfaces them as hits.
    const ext1ChunkIds = db.chunks.insertBatch(ext1.id, [
      {
        idx: 0,
        text: "first extra non-hit doc chunk text",
        headingPath: null,
        startOffset: 0,
        endOffset: 35,
        tokenCount: 6,
      },
    ]);
    const ext2ChunkIds = db.chunks.insertBatch(ext2.id, [
      {
        idx: 0,
        text: "second extra non-hit doc chunk text",
        headingPath: null,
        startOffset: 0,
        endOffset: 36,
        tokenCount: 6,
      },
    ]);
    const ext3ChunkIds = db.chunks.insertBatch(ext3.id, [
      {
        idx: 0,
        text: "third extra mentioned doc chunk text",
        headingPath: null,
        startOffset: 0,
        endOffset: 37,
        tokenCount: 6,
      },
    ]);
    const ext4ChunkIds = db.chunks.insertBatch(ext4.id, [
      {
        idx: 0,
        text: "fourth extra backlink source chunk text",
        headingPath: null,
        startOffset: 0,
        endOffset: 39,
        tokenCount: 6,
      },
    ]);

    db.embeddings.insertBatch([
      { chunkId: hitAChunkIds[0]!, modelId: model.id, vector: oneHot(0) },
      { chunkId: hitBChunkIds[0]!, modelId: model.id, vector: oneHot(1) },
      { chunkId: ext1ChunkIds[0]!, modelId: model.id, vector: oneHot(10) },
      { chunkId: ext2ChunkIds[0]!, modelId: model.id, vector: oneHot(11) },
      { chunkId: ext3ChunkIds[0]!, modelId: model.id, vector: oneHot(12) },
      { chunkId: ext4ChunkIds[0]!, modelId: model.id, vector: oneHot(13) },
    ]);

    // Edges (typed):
    //   hit-a → ext-1 (wikilink)
    //   hit-a → ext-3 (mention)
    //   ext-1 → ext-2 (wikilink) — for hops=2 forward expansion from hit-a
    //   ext-4 → hit-b (wikilink) — for backward expansion test
    db.edges.insertBatch(hitA.id, [
      {
        targetNoteId: ext1.id,
        targetPath: "ext-1.md",
        type: "wikilink",
        rel: null,
        anchor: null,
        lineNumber: 1,
        linkText: null,
      },
      {
        targetNoteId: ext3.id,
        targetPath: "ext-3.md",
        type: "mention",
        rel: null,
        anchor: null,
        lineNumber: 2,
        linkText: null,
      },
    ]);
    db.edges.insertBatch(ext1.id, [
      {
        targetNoteId: ext2.id,
        targetPath: "ext-2.md",
        type: "wikilink",
        rel: null,
        anchor: null,
        lineNumber: 1,
        linkText: null,
      },
    ]);
    db.edges.insertBatch(ext4.id, [
      {
        targetNoteId: hitB.id,
        targetPath: "hit-b.md",
        type: "wikilink",
        rel: null,
        anchor: null,
        lineNumber: 1,
        linkText: null,
      },
    ]);

    const vault: Vault = {
      config: { name: VAULT_NAME, path: "/dev/null" },
      db,
      dbPath: ":memory:",
    };

    const manager = new VaultManager();
    (manager as unknown as { vaults: Map<string, Vault> }).vaults.set(VAULT_NAME, vault);

    // Stub SourceConnector — synthesizes a Document from the seeded
    // note row. Mirrors the expand.test.ts / dossier.test.ts stub.
    const source: SourceHandle = parseSourceHandle(`obsidian-fs://${VAULT_NAME}`);
    const notesByPath = new Map<string, { title: string }>([
      ["hit-a.md", { title: "Hit A" }],
      ["hit-b.md", { title: "Hit B" }],
      ["ext-1.md", { title: "Ext 1" }],
      ["ext-2.md", { title: "Ext 2" }],
      ["ext-3.md", { title: "Ext 3" }],
      ["ext-4.md", { title: "Ext 4" }],
    ]);
    const sourceConnectorFor = (_vaultName: string): SourceConnector => ({
      handle: source,
      capabilities: {
        bodyShape: "flat-text",
        properties: "untyped",
        linkTypes: [],
        identityStable: true,
        permissions: false,
        contentHashStable: true,
        refHashKind: "content",
        watch: "push",
      },
      listDocuments: async function* () {
        // not used by expand
      },
      readDocument: async (id: DocId): Promise<Document> => {
        for (const [notePath, spec] of notesByPath) {
          if (id.endsWith(`/${notePath}`)) {
            return {
              id,
              source,
              title: spec.title,
              blocks: [{ kind: "paragraph", text: spec.title }],
              properties: {},
              links: [],
              mtime: 1,
              hash: `hash-${notePath}`,
            };
          }
        }
        throw new Error(`Doc not found: ${id}`);
      },
      hash: async (id: DocId) => {
        for (const notePath of notesByPath.keys()) {
          if (id.endsWith(`/${notePath}`)) return `hash-${notePath}`;
        }
        throw new Error(`Doc not found: ${id}`);
      },
      exists: async (id: DocId) => {
        for (const notePath of notesByPath.keys()) {
          if (id.endsWith(`/${notePath}`)) return true;
        }
        return false;
      },
      formatDisplayUrl: (id: DocId): string => `test://${id}`,
    });

    const queryVec = ((): number[] => {
      const v = new Array<number>(DIM).fill(0);
      // Tilt strongly toward hit-a (index 0), then hit-b (index 1).
      // The extras' one-hot indices (10..13) are far in vector space.
      v[0] = 0.9;
      v[1] = 0.5;
      return v;
    })();

    const ollama = {
      embed: vi.fn().mockResolvedValue({
        vectors: [queryVec],
        dim: DIM,
        model: "test-model",
      }),
    } as unknown as OllamaClient;

    return {
      db,
      vault,
      manager,
      deps: { manager, sourceConnectorFor },
      ollama,
      queryVec,
      cleanup: () => db.close(),
      idByPath: new Map([
        ["hit-a.md", hitA.id],
        ["hit-b.md", hitB.id],
        ["ext-1.md", ext1.id],
        ["ext-2.md", ext2.id],
        ["ext-3.md", ext3.id],
        ["ext-4.md", ext4.id],
      ]),
    };
  }

  let fx: ExpandFixture;

  beforeEach(() => {
    fx = buildExpandFixture();
  });

  afterEach(() => {
    fx.cleanup();
  });

  // ── Test 1 (additive happy path) ─────────────────────────────────────────
  it("Test 1: hits with expand:{hops:1} carry expansions[] whose via.seed_doc_id matches the parent hit and via.hop === 1", async () => {
    const hits = await hybridSearch({
      query: "atlas",
      embeddingModel: "test-model",
      ollama: fx.ollama,
      vaults: [fx.vault],
      topK: 4,
      expand: { hops: 1 },
      expandDeps: fx.deps,
    });

    expect(hits.length).toBeGreaterThan(0);
    // hit-a has outbound wikilink + mention to ext-1 and ext-3 (non-hits).
    const hitA = hits.find((h) => h.notePath === "hit-a.md");
    expect(hitA).toBeDefined();
    expect(hitA?.expansions).toBeDefined();
    expect(hitA?.expansions?.length).toBeGreaterThan(0);
    for (const exp of hitA?.expansions ?? []) {
      expect(exp.via.seed_doc_id).toBe(hitA?.doc_id);
      expect(exp.via.hop).toBe(1);
    }
  });

  // ── Test 2 (multi-seed grouping) ─────────────────────────────────────────
  it("Test 2: every hit's expansions contain ONLY docs whose via.seed_doc_id === hit.doc_id (no cross-hit pollution)", async () => {
    const hits = await hybridSearch({
      query: "atlas",
      embeddingModel: "test-model",
      ollama: fx.ollama,
      vaults: [fx.vault],
      topK: 4,
      expand: { hops: 1 },
      expandDeps: fx.deps,
    });

    expect(hits.length).toBeGreaterThan(1);
    for (const hit of hits) {
      for (const exp of hit.expansions ?? []) {
        expect(exp.via.seed_doc_id).toBe(hit.doc_id);
      }
    }
  });

  // ── Test 3 (default direction = both) ────────────────────────────────────
  it("Test 3: when direction is omitted, expand runs with direction='both' (backlinks surface)", async () => {
    // Use topK=2 so only the 2 "atlas" hits are in the result set —
    // ext-4 is NOT a hit and therefore not a seed, so the backward
    // edge `ext-4 → hit-b` can surface in hit-b's expansions.
    const hits = await hybridSearch({
      query: "atlas",
      embeddingModel: "test-model",
      ollama: fx.ollama,
      vaults: [fx.vault],
      topK: 2,
      expand: { hops: 1 },
      expandDeps: fx.deps,
    });
    // hit-b has ONLY an inbound wikilink from ext-4. With direction='both'
    // (the default), it should surface ext-4 via the backward edge.
    const hitB = hits.find((h) => h.notePath === "hit-b.md");
    expect(hitB).toBeDefined();
    const seenTitles = (hitB?.expansions ?? []).map((e) => e.title);
    expect(seenTitles).toContain("Ext 4");
    // The backward expansion must record direction='backward'.
    const ext4 = (hitB?.expansions ?? []).find((e) => e.title === "Ext 4");
    expect(ext4?.via.direction).toBe("backward");
  });

  // ── Test 4 (edge_types filter) ───────────────────────────────────────────
  it("Test 4: expand:{hops:1, edge_types:['wikilink']} excludes mention-typed expansions", async () => {
    const hits = await hybridSearch({
      query: "atlas",
      embeddingModel: "test-model",
      ollama: fx.ollama,
      vaults: [fx.vault],
      topK: 4,
      expand: { hops: 1, edge_types: ["wikilink"] },
      expandDeps: fx.deps,
    });
    const hitA = hits.find((h) => h.notePath === "hit-a.md");
    expect(hitA).toBeDefined();
    expect(hitA?.expansions?.length ?? 0).toBeGreaterThan(0);
    for (const exp of hitA?.expansions ?? []) {
      expect(exp.via.edge_type).toBe("wikilink");
    }
    // Mention-typed neighbor (ext-3) MUST NOT be attached under wikilink-only.
    const ext3 = (hitA?.expansions ?? []).find((e) => e.title === "Ext 3");
    expect(ext3).toBeUndefined();
    // But the wikilink-typed neighbor (ext-1) MUST appear.
    const ext1 = (hitA?.expansions ?? []).find((e) => e.title === "Ext 1");
    expect(ext1).toBeDefined();
  });

  // ── Test 5 (v1-invariance — CRITICAL) ────────────────────────────────────
  it("Test 5: when expand is omitted, no `expansions` field on any hit (v1 byte-identity)", async () => {
    const hits = await hybridSearch({
      query: "atlas",
      embeddingModel: "test-model",
      ollama: fx.ollama,
      vaults: [fx.vault],
      topK: 4,
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.expansions).toBeUndefined();
    }
  });

  // ── Test 6 (ranking preservation) ────────────────────────────────────────
  it("Test 6: top-K ranking (doc_id order) is identical with vs. without expand", async () => {
    const withoutExpand = await hybridSearch({
      query: "atlas",
      embeddingModel: "test-model",
      ollama: fx.ollama,
      vaults: [fx.vault],
      topK: 4,
    });
    const withExpand = await hybridSearch({
      query: "atlas",
      embeddingModel: "test-model",
      ollama: fx.ollama,
      vaults: [fx.vault],
      topK: 4,
      expand: { hops: 1 },
      expandDeps: fx.deps,
    });
    const baseOrder = withoutExpand.map((h) => h.doc_id);
    const expOrder = withExpand.map((h) => h.doc_id);
    expect(expOrder).toEqual(baseOrder);
    // Scores are also unchanged — expand never participates in ranking.
    expect(withExpand.map((h) => h.score)).toEqual(withoutExpand.map((h) => h.score));
  });

  // ── Test 7 (rescore order D-16) ──────────────────────────────────────────
  it("Test 7: Phase 3 rescore runs BEFORE expand — expansions attach to the rescored top-K", async () => {
    // Make hit-b fresher than hit-a so a large recency weight flips the
    // ranking. With both hits in the result list, hit-b must rise to #1
    // AND still receive its expansion (backward edge from ext-4).
    const dayMs = 24 * 60 * 60 * 1000;
    const now = 1700000000000;
    // upsertByPath short-circuits when the hash matches the existing row
    // (notes.ts:104), so we MUST pass a fresh hash to actually update mtime.
    fx.db.notes.upsertByPath({
      path: "hit-b.md",
      content: "atlas other hit",
      frontmatter: null,
      title: "Hit B",
      hash: "h-hit-b-v2",
      mtime: now,
      wordCount: 3,
    });
    fx.db.notes.upsertByPath({
      path: "hit-a.md",
      content: "atlas seed content",
      frontmatter: null,
      title: "Hit A",
      hash: "h-hit-a-v2",
      mtime: now - 365 * dayMs,
      wordCount: 3,
    });
    const hits = await hybridSearch({
      query: "atlas",
      embeddingModel: "test-model",
      ollama: fx.ollama,
      vaults: [fx.vault],
      // topK=2 keeps only the two "atlas" hits in the result set, so
      // ext-4 stays a non-hit (non-seed). Otherwise ext-4 would be a
      // seed and the backward edge `ext-4 → hit-b` would be suppressed
      // by expand's seed-to-seed rule.
      topK: 2,
      recencyWeight: 10,
      halfLifeDays: 30,
      clock: () => now,
      expand: { hops: 1 },
      expandDeps: fx.deps,
    });

    // hit-b should rank #1 due to rescore (fresher mtime).
    expect(hits[0]?.notePath).toBe("hit-b.md");
    // The newly-promoted top-K member still receives expansions —
    // ext-4 via the backward wikilink edge.
    expect(hits[0]?.expansions).toBeDefined();
    const titles = (hits[0]?.expansions ?? []).map((e) => e.title);
    expect(titles).toContain("Ext 4");
  });

  // ── Test 8 (hop=2) ───────────────────────────────────────────────────────
  it("Test 8: expand:{hops:2} surfaces 2-hop neighbors with via.hop === 2 (forward direction)", async () => {
    const hits = await hybridSearch({
      query: "atlas",
      embeddingModel: "test-model",
      ollama: fx.ollama,
      vaults: [fx.vault],
      topK: 4,
      expand: { hops: 2, direction: "forward", edge_types: ["wikilink"] },
      expandDeps: fx.deps,
    });
    const hitA = hits.find((h) => h.notePath === "hit-a.md");
    expect(hitA).toBeDefined();
    // hit-a → ext-1 (1-hop wikilink); ext-1 → ext-2 (2-hop wikilink chain).
    const ext2 = (hitA?.expansions ?? []).find((e) => e.title === "Ext 2");
    expect(ext2).toBeDefined();
    expect(ext2?.via.hop).toBe(2);
    const ext1 = (hitA?.expansions ?? []).find((e) => e.title === "Ext 1");
    expect(ext1).toBeDefined();
    expect(ext1?.via.hop).toBe(1);
  });

  // ── Test 9 (short-circuit when results empty) ────────────────────────────
  it("Test 9: when hits is empty, expand is NOT called (short-circuit, no DB reads beyond rescore)", async () => {
    // Spy on the sourceConnectorFor — expand() calls it for every
    // resolved seed at hydration time, so if expand fires, this spy
    // increments. With an empty hits list, the guard MUST short-circuit
    // BEFORE expand() is invoked.
    let connectorCalls = 0;
    const origCtor = fx.deps.sourceConnectorFor;
    const spiedDeps = {
      manager: fx.manager,
      sourceConnectorFor: (name: string) => {
        connectorCalls += 1;
        return origCtor(name);
      },
    };

    // Construct a fresh empty in-memory vault with NO chunks so the
    // hybrid candidate set is empty. We pass it as the sole vault.
    const emptyDb = new Database(":memory:", "empty-vault");
    const emptyModel = emptyDb.models.upsert({
      name: "test-model",
      provider: "test",
      dim: DIM,
    });
    emptyDb.models.setActive(emptyModel.id);
    const emptyVault: Vault = {
      config: { name: "empty-vault", path: "/dev/null" },
      db: emptyDb,
      dbPath: ":memory:",
    };

    const hits = await hybridSearch({
      query: "atlas",
      embeddingModel: "test-model",
      ollama: fx.ollama,
      vaults: [emptyVault],
      topK: 4,
      expand: { hops: 1 },
      expandDeps: spiedDeps,
    });

    expect(hits.length).toBe(0);
    // Empty-hits short-circuit must prevent expand() invocation.
    expect(connectorCalls).toBe(0);

    emptyDb.close();
  });
});
