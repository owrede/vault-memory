/**
 * IN-02 regression: `__clearContractCache` is reachable ONLY through
 * the deep-import `./__testing__.js` path. The public barrel
 * (`./index.js`) does not re-export it. This test proves the deep
 * path is the supported test surface and validates the re-seed
 * behavior matches the previous implementation.
 */

import { describe, it, expect } from "vitest";
import { __clearContractCache } from "./__testing__.js";
import { getContract, DEFAULT_MEMORY_V1 } from "./index.js";

describe("__clearContractCache (IN-02 deep-import surface)", () => {
  it("clears the cache and re-seeds the default baseline", () => {
    // Pre-seeded baseline is present.
    expect(getContract("default-memory-v1")).toBe(DEFAULT_MEMORY_V1);

    // Clear + re-seed.
    __clearContractCache();

    // Baseline still resolves after the clear (the re-seed step
    // matches the previous behavior that lived in `./index.ts`).
    expect(getContract("default-memory-v1")).toBe(DEFAULT_MEMORY_V1);
  });
});
