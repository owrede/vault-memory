/**
 * Issue #14 / P4 — release version consistency check.
 *
 * The CLI package, the Obsidian plugin package, and the plugin manifest MUST
 * all declare the same version. Before this check they drifted (2.2.0 / 2.0.0 /
 * 2.3.0) and the README claimed a stale "Latest v2.0.0". This test fails the
 * build if any of them fall out of sync again.
 *
 * If CLI and plugin are ever INTENTIONALLY allowed to diverge, encode that
 * policy here explicitly (e.g. assert a documented relationship) rather than
 * deleting the check.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readJson(relFromSrc: string): { version?: string } {
  const p = fileURLToPath(new URL(relFromSrc, import.meta.url));
  return JSON.parse(readFileSync(p, "utf8")) as { version?: string };
}

function readText(relFromSrc: string): string {
  const p = fileURLToPath(new URL(relFromSrc, import.meta.url));
  return readFileSync(p, "utf8");
}

describe("release version consistency (Issue #14 / P4)", () => {
  const cliVersion = readJson("../package.json").version;

  it("CLI, plugin package, and plugin manifest declare the same version", () => {
    const pluginPkg = readJson("../plugin/package.json").version;
    const pluginManifest = readJson("../plugin/manifest.json").version;
    expect(pluginPkg).toBe(cliVersion);
    expect(pluginManifest).toBe(cliVersion);
  });

  it("README 'Latest' badge matches the CLI version", () => {
    const readme = readText("../README.md");
    const m = readme.match(/Latest:\s*\*\*v([0-9]+\.[0-9]+\.[0-9]+)\*\*/);
    expect(m, "README must contain a 'Latest: **vX.Y.Z**' marker").not.toBeNull();
    expect(m?.[1]).toBe(cliVersion);
  });

  it("CHANGELOG has a section for the current version", () => {
    const changelog = readText("../CHANGELOG.md");
    expect(changelog).toContain(`## [${cliVersion}]`);
  });
});
