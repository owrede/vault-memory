/**
 * Vitest config for the vault-memory plugin sub-package.
 *
 * Phase 7 / 07-RESEARCH §"Pitfalls" Pitfall 5: the `obsidian` npm package
 * is types-only. Alias it to a stub so pure-code unit tests can `import`
 * the surface they need without dragging in a live Obsidian runtime.
 */

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    // Plan 07-01 ships scaffolding only. The codec round-trip suite
    // (CAN-07) lands in plan 07-02. Empty test run is an acceptable pass
    // per plan 07-01 Task 2 acceptance criteria.
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      obsidian: `${here}tests/mocks/obsidian.ts`,
    },
  },
});
