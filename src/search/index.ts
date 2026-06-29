export { hybridSearch, rrfMerge } from "./hybrid.js";
export type { HybridSearchOptions, RankedList, RrfMergeResult } from "./hybrid.js";
// ADR-008: engine-dispatching search front-end. Drop-in for hybridSearch;
// routes contextfit-backed vaults to the CPU-only engine, ollama vaults to
// the embeddings+sqlite-vec hybrid, and merges.
export { searchVaults } from "./dispatch.js";
export { matchesAnyGlob } from "./glob.js";
