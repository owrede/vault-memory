import { describe, it, expect } from "vitest";
import { resolveCli, probedPaths, type ResolverDeps } from "./cli-resolver.js";

/** Build a deps stub whose `exists` returns true only for the given paths. */
function depsWith(existing: string[], versions: Record<string, string[]> = {}): ResolverDeps {
  const set = new Set(existing);
  return {
    home: "/Users/test",
    exists: (p) => set.has(p),
    listVersions: (parent) => versions[parent] ?? [],
  };
}

describe("resolveCli (ISSUE §23 self-healing PATH probe)", () => {
  it("prefers `node <script>` when both are found on homebrew path", () => {
    const deps = depsWith(["/opt/homebrew/bin/vault-memory", "/opt/homebrew/bin/node"]);
    const r = resolveCli(["serve"], deps);
    expect(r).not.toBeNull();
    expect(r!.command).toBe("/opt/homebrew/bin/node");
    expect(r!.args).toEqual(["/opt/homebrew/bin/vault-memory", "serve"]);
  });

  it("finds the binary under an nvm versioned dir and picks the highest version", () => {
    const nvmRoot = "/Users/test/.nvm/versions/node";
    const deps = depsWith(
      [
        "/Users/test/.nvm/versions/node/v22.0.0/bin/vault-memory",
        "/Users/test/.nvm/versions/node/v22.0.0/bin/node",
        "/Users/test/.nvm/versions/node/v24.11.1/bin/vault-memory",
        "/Users/test/.nvm/versions/node/v24.11.1/bin/node",
      ],
      {
        [nvmRoot]: [
          "/Users/test/.nvm/versions/node/v22.0.0",
          "/Users/test/.nvm/versions/node/v24.11.1",
        ],
      },
    );
    const r = resolveCli(["serve"], deps);
    expect(r!.command).toBe("/Users/test/.nvm/versions/node/v24.11.1/bin/node");
    expect(r!.args[0]).toBe("/Users/test/.nvm/versions/node/v24.11.1/bin/vault-memory");
  });

  it("falls back to the absolute binary when the script is found but no node is", () => {
    const deps = depsWith(["/usr/local/bin/vault-memory"]);
    const r = resolveCli(["serve"], deps);
    expect(r!.command).toBe("/usr/local/bin/vault-memory");
    expect(r!.args).toEqual(["serve"]);
  });

  it("returns null when the binary is nowhere to be found", () => {
    const deps = depsWith([]);
    expect(resolveCli(["serve"], deps)).toBeNull();
  });

  it("probedPaths lists the diagnostic locations including the nvm glob", () => {
    const paths = probedPaths("/Users/test");
    expect(paths).toContain("/opt/homebrew/bin/vault-memory");
    expect(paths).toContain("/usr/local/bin/vault-memory");
    expect(paths).toContain("/Users/test/.volta/bin/vault-memory");
    expect(paths).toContain("/Users/test/.nvm/versions/node/*/bin/vault-memory");
  });
});
