import { expect, it } from "vitest";
import { meanPool, normalizeVector } from "./onnx.js";
import { embeddingNamespace } from "./types.js";
it("ignores padding and normalizes pooled vectors", () => {
  expect(meanPool(new Float32Array([3, 4, 99, 99]), [1n, 0n], 2, 2)).toEqual([3, 4]);
  expect(normalizeVector([3, 4])).toEqual([0.6, 0.8]);
});
it("averages only attended tokens in order", () =>
  expect(meanPool(new Float32Array([2, 4, 8, 10]), [1n, 1n], 2, 2)).toEqual([5, 7]));
it.each([
  () => meanPool(new Float32Array([1]), [1n], 1, 2),
  () => meanPool(new Float32Array([1, 2]), [0n], 1, 2),
  () => meanPool(new Float32Array([Infinity, 2]), [1n], 1, 2),
  () => normalizeVector([0, 0]),
  () => normalizeVector([NaN]),
  () => normalizeVector([]),
])("rejects invalid output and shapes", (fn) => expect(fn).toThrow());
it("separates provider revision and dimensions namespaces", () => {
  const identity = { provider: "onnx", model: "m", revision: "r", dimensions: 2 };
  expect(
    new Set(
      [
        identity,
        { ...identity, provider: "ollama" },
        { ...identity, revision: "s" },
        { ...identity, dimensions: 3 },
      ].map(embeddingNamespace),
    ).size,
  ).toBe(4);
});
