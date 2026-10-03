export function meanPool(
  hidden: Float32Array,
  mask: bigint[],
  tokens: number,
  dimensions: number,
): number[] {
  if (
    !Number.isSafeInteger(tokens) ||
    tokens < 1 ||
    !Number.isSafeInteger(dimensions) ||
    dimensions < 1 ||
    hidden.length !== tokens * dimensions ||
    mask.length !== tokens
  )
    throw new Error("shape mismatch");
  if ([...hidden].some((v) => !Number.isFinite(v)) || mask.some((v) => v !== 0n && v !== 1n))
    throw new Error("nonfinite hidden or invalid mask");
  const pooled = Array<number>(dimensions).fill(0);
  let count = 0;
  for (let token = 0; token < tokens; token++)
    if (mask[token] !== 0n) {
      count++;
      for (let d = 0; d < dimensions; d++) pooled[d]! += hidden[token * dimensions + d]!;
    }
  if (count === 0) throw new Error("empty attention mask");
  return pooled.map((v) => v / count);
}
export function normalizeVector(vector: number[]): number[] {
  if (!vector.length || vector.some((v) => !Number.isFinite(v)))
    throw new Error("nonfinite or empty vector");
  const norm = Math.hypot(...vector);
  if (norm === 0 || !Number.isFinite(norm)) throw new Error("zero or nonfinite vector");
  return vector.map((v) => v / norm);
}
