/**
 * Issue #14 / P2 — VERSION must track package.json (single source of truth).
 *
 * Guards against the regression where server.ts hardcoded a stale
 * `const VERSION = "1.0.0"` that drifted years behind the published package.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VERSION } from "./version.js";

describe("VERSION single source of truth", () => {
  it("matches package.json version exactly", () => {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  it("is a real semver, never the historical hardcoded 1.0.0 placeholder", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(VERSION).not.toBe("1.0.0");
  });
});
