/**
 * Test-only deep-import module for the contract cache. Production code
 * MUST NOT import from this path — the lack of a re-export from
 * `./index.ts` (the public barrel) is the access control.
 *
 * IN-02 closure: previously `__clearContractCache` was exported from
 * `./index.ts` and accessible to any consumer that imported the public
 * barrel. Moving it here makes the import path itself the marker:
 * a `from ".../contract/__testing__.js"` path appears in test files
 * only. Production callers that import from `./index.js` cannot
 * accidentally clear the cache at runtime.
 *
 * Behavior is unchanged from the previous `__clearContractCache` in
 * `./index.ts`: clear the loader cache, then re-seed `DEFAULT_MEMORY_V1`
 * so subsequent `getContract("default-memory-v1")` calls still resolve.
 *
 * @internal
 */

import { DEFAULT_MEMORY_V1 } from "./default-v1.js";
import {
  __cacheContract,
  __clearContractCache as __clearLoaderCache,
} from "./loader.js";

/**
 * Test-only: drop the cache and re-seed the baseline. Use the deep
 * import path `src/memory/contract/__testing__.js`; the public barrel
 * at `src/memory/contract/index.js` deliberately does NOT re-export
 * this symbol (IN-02 closure).
 *
 * @internal
 */
export function __clearContractCache(): void {
  __clearLoaderCache();
  __cacheContract("default-memory-v1", DEFAULT_MEMORY_V1);
}
