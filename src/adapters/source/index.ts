/**
 * Barrel re-export for `src/adapters/source/`.
 *
 * Downstream consumers import from `./source/index.js` (or the bare
 * directory) rather than reaching into `./source/types.js` directly,
 * matching the project convention (`src/db/index.ts`, `src/ollama/index.ts`).
 */

export type * from "./types.js";
