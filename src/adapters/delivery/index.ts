/**
 * Barrel re-export for `src/adapters/delivery/`.
 *
 * Downstream consumers import from `./delivery/index.js` rather than
 * reaching into `./delivery/types.js` directly.
 */

export type * from "./types.js";
