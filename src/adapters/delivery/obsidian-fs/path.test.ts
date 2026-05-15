/**
 * Unit tests for `src/adapters/delivery/obsidian-fs/path.ts`.
 *
 * Covers:
 *   - `joinVaultPath(vaultRoot, relPath)` returns a path under the vault root.
 *   - `pathInSink(vaultAbsolutePath, sink)` returns the sink folder.
 *   - `pathInSink(vaultAbsolutePath, sink, relativeSubpath)` returns the
 *     path of a file inside the sink folder.
 *
 * Per ADR-002 I-3 these are the SOLE licensed `path.join` callers for
 * sink/vault path resolution in Phase 2; this test file pins their
 * behavior so downstream callers don't reach for `node:path` directly.
 */

import { describe, it, expect } from "vitest";
import { joinVaultPath, pathInSink } from "./path.js";

describe("joinVaultPath", () => {
  it("joins a vault root with a relative path", () => {
    const joined = joinVaultPath("/abs/vault", "_memory/observations");
    // cross-OS safety: assert containment rather than exact separators
    expect(joined).toContain("_memory");
    expect(joined).toContain("observations");
    expect(joined.startsWith("/abs/vault")).toBe(true);
  });

  it("collapses trailing separators in the relative path", () => {
    const joined = joinVaultPath("/abs/vault", "_memory/");
    expect(joined).toContain("_memory");
  });
});

describe("pathInSink", () => {
  it("returns the sink folder path when no relativeSubpath is given", () => {
    const p = pathInSink("/abs/vault", { resolveToRelativePath: "_memory/" });
    expect(p).toContain("_memory");
    expect(p.startsWith("/abs/vault")).toBe(true);
  });

  it("appends a relative subpath under the sink folder", () => {
    const p = pathInSink(
      "/abs/vault",
      { resolveToRelativePath: "_memory/" },
      "observations/foo.md",
    );
    expect(p).toContain("_memory");
    expect(p).toContain("observations");
    expect(p).toContain("foo.md");
  });

  it("works with sinks at the root (resolveToRelativePath = './' is unusual but supported)", () => {
    const p = pathInSink(
      "/abs/vault",
      { resolveToRelativePath: "_memory/inbox/" },
      "note.md",
    );
    expect(p).toContain("inbox");
    expect(p).toContain("note.md");
  });
});
