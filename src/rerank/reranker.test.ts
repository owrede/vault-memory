import { describe, it, expect, vi } from "vitest";
import { OllamaReranker, formatPair } from "./reranker.js";
import type { OllamaClient } from "../ollama/index.js";

describe("formatPair", () => {
  it("uses the documented Query/Document/Relevance template", () => {
    expect(formatPair("hi", "doc")).toBe("Query: hi\n\nDocument: doc\n\nRelevance:");
  });
});

describe("OllamaReranker.score", () => {
  it("returns one negated-L2-norm score per chunk, in input order", async () => {
    // Two unit vectors with magnitudes 1 and 2. Reranker contract:
    // higher = better, bge-reranker: lower magnitude = better, so the
    // emitted scores should be -1 and -2 respectively (i.e. v1 ranks
    // higher than v2).
    const ollama = {
      embed: vi.fn().mockResolvedValue({
        vectors: [
          [1, 0, 0],
          [2, 0, 0],
        ],
        dim: 3,
        model: "bge",
      }),
    } as unknown as OllamaClient;
    const r = new OllamaReranker({ ollama, model: "bge" });
    const scores = await r.score("q", ["d1", "d2"]);
    expect(scores).toEqual([-1, -2]);
    expect(scores[0]! > scores[1]!).toBe(true); // d1 ranks higher
  });

  it("formats inputs as Query/Document/Relevance pairs", async () => {
    const embed = vi.fn().mockResolvedValue({
      vectors: [[1]],
      dim: 1,
      model: "bge",
    });
    const ollama = { embed } as unknown as OllamaClient;
    const r = new OllamaReranker({ ollama, model: "bge" });
    await r.score("hi", ["doc"]);
    expect(embed).toHaveBeenCalledWith({
      model: "bge",
      texts: ["Query: hi\n\nDocument: doc\n\nRelevance:"],
    });
  });

  it("empty chunks → empty result with no embed call", async () => {
    const embed = vi.fn();
    const ollama = { embed } as unknown as OllamaClient;
    const r = new OllamaReranker({ ollama, model: "bge" });
    expect(await r.score("q", [])).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
  });

  it("throws when vector count mismatches chunk count", async () => {
    const ollama = {
      embed: vi.fn().mockResolvedValue({ vectors: [[1]], dim: 1, model: "bge" }),
    } as unknown as OllamaClient;
    const r = new OllamaReranker({ ollama, model: "bge" });
    await expect(r.score("q", ["a", "b"])).rejects.toThrow(/expected 2/);
  });
});
