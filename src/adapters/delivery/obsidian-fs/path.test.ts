/**
 * Unit tests for `src/adapters/delivery/obsidian-fs/path.ts`.
 *
 * Covers:
 *   - `joinVaultPath(vaultRoot, relPath)` — OS-native absolute path for FS calls.
 *   - `pathInSink(vaultAbsolutePath, sink, relativeSubpath?)` — OS-native
 *     absolute path inside a sink, for FS calls.
 *   - `joinVaultPathPosix(...segments)` — forward-slash join for vault-relative
 *     paths used in comparisons (DocId resource, SQL `LIKE` prefix).
 *   - `vaultRelativeInSink(sink, relativeSubpath?)` — forward-slash form of an
 *     in-sink resource, suitable for comparison against a DocId resource or a
 *     SQL `LIKE` prefix against `notes.path`.
 *
 * Per ADR-002 I-3 these helpers are the SOLE licensed `path` callers for
 * sink/vault path resolution in Phase 2. CR-03 (gap-closure plan 02-11)
 * splits FS-bound vs comparison-bound semantics: FS helpers stay OS-native;
 * comparison helpers always emit forward-slash regardless of `process.platform`.
 */

import { describe, it, expect } from "vitest";
import {
  joinVaultPath,
  joinVaultPathPosix,
  pathInSink,
  vaultRelativeInSink,
} from "./path.js";
import { formatDocId, decomposeDocId } from "../../registry.js";

describe("joinVaultPath (FS-bound, OS-native)", () => {
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

describe("pathInSink (FS-bound, OS-native absolute)", () => {
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

  it("works with nested sink folders", () => {
    const p = pathInSink(
      "/abs/vault",
      { resolveToRelativePath: "_memory/inbox/" },
      "note.md",
    );
    expect(p).toContain("inbox");
    expect(p).toContain("note.md");
  });
});

describe("joinVaultPathPosix (comparison-bound, forward-slash)", () => {
  it("joins segments with forward-slash regardless of OS", () => {
    const joined = joinVaultPathPosix("_memory", "observations", "foo.md");
    expect(joined).toBe("_memory/observations/foo.md");
    // Forward-slash invariant: no backslashes regardless of process.platform.
    expect(joined).not.toContain("\\");
  });

  it("normalizes backslash input segments to forward-slash on output", () => {
    const joined = joinVaultPathPosix("_memory\\sub", "foo.md");
    expect(joined).not.toContain("\\");
    expect(joined).toBe("_memory/sub/foo.md");
  });

  it("handles a single segment (path.posix.join preserves trailing slash)", () => {
    // `path.posix.join('_memory/')` returns `'_memory/'` — single-segment
    // join preserves the trailing slash (Node behavior; see
    // https://nodejs.org/api/path.html#pathposixjoinpaths). The trailing
    // slash matters for `findSinkContaining` prefix matching, so we keep it.
    expect(joinVaultPathPosix("_memory/")).toBe("_memory/");
  });

  it("collapses repeated slashes", () => {
    const joined = joinVaultPathPosix("_memory/", "/observations/", "foo.md");
    expect(joined).toBe("_memory/observations/foo.md");
  });
});

describe("vaultRelativeInSink (comparison-bound, forward-slash)", () => {
  it("returns the sink relative path when no subpath is given (trailing slash preserved)", () => {
    const rel = vaultRelativeInSink({ resolveToRelativePath: "_memory/" });
    expect(rel).toBe("_memory/");
  });

  it("returns the forward-slash form for a sink + subpath", () => {
    const rel = vaultRelativeInSink(
      { resolveToRelativePath: "_memory/" },
      "observations/foo.md",
    );
    expect(rel).toBe("_memory/observations/foo.md");
    expect(rel).not.toContain("\\");
  });

  it("handles nested sink folder", () => {
    const rel = vaultRelativeInSink(
      { resolveToRelativePath: "_memory/inbox/" },
      "note.md",
    );
    expect(rel).toBe("_memory/inbox/note.md");
  });

  it("normalizes caller-supplied backslashes in the subpath", () => {
    const rel = vaultRelativeInSink(
      { resolveToRelativePath: "_memory/" },
      "observations\\foo.md",
    );
    expect(rel).not.toContain("\\");
    expect(rel).toBe("_memory/observations/foo.md");
  });

  it("normalizes backslashes in sink.resolveToRelativePath defensively", () => {
    // The sink-handle parser refuses backslashes (Plan 02-09), but the
    // helper defends against future regression — output is forward-slash
    // regardless of input shape.
    const rel = vaultRelativeInSink(
      { resolveToRelativePath: "_memory\\" },
      "foo.md",
    );
    expect(rel).not.toContain("\\");
    expect(rel).toBe("_memory/foo.md");
  });

  it("round-trips byte-equal with DocId resource (the load-bearing property)", () => {
    // The Phase 2 safety chain relies on `findSinkContaining(docId)`
    // comparing the DocId resource against `sink.resolveToRelativePath`.
    // This property test locks the invariant: the forward-slash form
    // emitted by `vaultRelativeInSink` is byte-equal with the resource
    // portion of the canonical DocId built from the same components.
    const vaultName = "atlas";
    const sink = { resolveToRelativePath: "_memory/" };
    const subpath = "observations/foo.md";
    const rel = vaultRelativeInSink(sink, subpath);
    const docId = formatDocId("obsidian-fs", vaultName, rel);
    const { resource } = decomposeDocId(docId);
    expect(resource).toBe(rel);
    expect(resource).toBe("_memory/observations/foo.md");
  });

  it("preserves prefix-match invariant for findSinkContaining", () => {
    // findSinkContaining uses `resource.startsWith(sink.resolveToRelativePath)`.
    // vaultRelativeInSink's output must satisfy this when paired with the
    // same sink — otherwise Guard B silently no-ops on Windows.
    const sink = { resolveToRelativePath: "_memory/" };
    const rel = vaultRelativeInSink(sink, "observations/foo.md");
    expect(rel.startsWith(sink.resolveToRelativePath)).toBe(true);
  });
});
