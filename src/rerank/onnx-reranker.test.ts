/**
 * Tests for OnnxReranker.
 *
 * The ONNX model file is ~570 MB and downloaded out-of-band via
 * `scripts/download-reranker.sh`. We follow the skip-if-missing pattern:
 * if the model isn't present at the default location (or
 * VAULT_MEMORY_RERANKER_DIR override), the suite is skipped with a hint
 * — so `npm test` stays green in CI and on contributor machines that
 * haven't downloaded the model.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { OnnxReranker } from "./onnx-reranker.js";

const modelDir =
  process.env.VAULT_MEMORY_RERANKER_DIR ??
  join(homedir(), ".vault-memory", "models", "bge-reranker-v2-m3");

const hasModel =
  existsSync(join(modelDir, "model_quantized.onnx")) &&
  existsSync(join(modelDir, "tokenizer.json"));

const maybe = hasModel ? describe : describe.skip;

if (!hasModel) {
  // eslint-disable-next-line no-console
  console.warn(
    `[onnx-reranker.test] Skipping: model files not found in ${modelDir}. ` +
      `Run \`bash scripts/download-reranker.sh\` to enable.`,
  );
}

maybe("OnnxReranker", () => {
  it("constructor accepts modelDir", () => {
    const r = new OnnxReranker({ modelDir });
    expect(r).toBeInstanceOf(OnnxReranker);
  });

  it("returns one [0,1] score per chunk, in input order", async () => {
    const r = new OnnxReranker({ modelDir });
    const scores = await r.score("what is photosynthesis", [
      "Photosynthesis is how plants convert light into energy.",
      "I had pasta for dinner.",
      "The mitochondrion is the powerhouse of the cell.",
    ]);
    expect(scores).toHaveLength(3);
    for (const s of scores) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
      expect(Number.isFinite(s)).toBe(true);
    }
  }, 60_000);

  it("scores identical (query, chunk) pairs as highly relevant", async () => {
    const r = new OnnxReranker({ modelDir });
    const q = "BGE-M3 is a multilingual embedding model";
    const [s] = await r.score(q, [q]);
    expect(s).toBeGreaterThan(0.9);
  }, 60_000);

  it("scores wholly unrelated pairs as low-relevance", async () => {
    const r = new OnnxReranker({ modelDir });
    const [s] = await r.score("quantum chromodynamics", [
      "Recipe: chop onions, fry in butter, add garlic.",
    ]);
    expect(s).toBeLessThan(0.3);
  }, 60_000);

  it("ranks topically-relevant chunks above generic ones", async () => {
    const r = new OnnxReranker({ modelDir });
    const scores = await r.score("how do neural networks learn", [
      "Neural networks learn by backpropagating gradients of a loss function.",
      "The weather today is partly cloudy with a chance of rain.",
    ]);
    expect(scores[0]).toBeGreaterThan(scores[1]!);
  }, 60_000);
});
