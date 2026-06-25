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
import { joinVaultPath, joinVaultPathPosix, pathInSink, vaultRelativeInSink } from "./path.js";
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
    const p = pathInSink("/abs/vault", { resolveToRelativePath: "_memory/inbox/" }, "note.md");
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
    const rel = vaultRelativeInSink({ resolveToRelativePath: "_memory/" }, "observations/foo.md");
    expect(rel).toBe("_memory/observations/foo.md");
    expect(rel).not.toContain("\\");
  });

  it("handles nested sink folder", () => {
    const rel = vaultRelativeInSink({ resolveToRelativePath: "_memory/inbox/" }, "note.md");
    expect(rel).toBe("_memory/inbox/note.md");
  });

  it("normalizes caller-supplied backslashes in the subpath", () => {
    const rel = vaultRelativeInSink({ resolveToRelativePath: "_memory/" }, "observations\\foo.md");
    expect(rel).not.toContain("\\");
    expect(rel).toBe("_memory/observations/foo.md");
  });

  it("normalizes backslashes in sink.resolveToRelativePath defensively", () => {
    // The sink-handle parser refuses backslashes (Plan 02-09), but the
    // helper defends against future regression — output is forward-slash
    // regardless of input shape.
    const rel = vaultRelativeInSink({ resolveToRelativePath: "_memory\\" }, "foo.md");
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

// ────────────────────────────────────────────────────────────────────────────
// CR-03 cross-platform simulation (audit follow-up H2)
//
// The existing tests above inject literal backslash STRINGS and assert
// `joinVaultPathPosix` normalizes them away. They do NOT verify the actual
// scenario that motivates CR-03: on Windows, `joinVaultPath` (the FS-bound
// helper backed by `path.join`) produces backslash output, and the
// comparison-bound helpers must then translate that to forward-slash before
// SQL `LIKE` lookups or `findSinkContaining` startsWith checks.
//
// We can't run the suite on Windows here, but `node:path` exposes platform-
// specific implementations (`path.win32`, `path.posix`). The Windows
// behavior of `path.join` IS `path.win32.join` — they are the same function
// object on Windows hosts. Asserting against `path.win32.join` therefore
// simulates the Windows code path on a POSIX test runner with no mocking.
// ────────────────────────────────────────────────────────────────────────────

import { win32 as pathWin32 } from "node:path";

describe("CR-03 cross-platform simulation (Windows path semantics)", () => {
  it("path.win32.join produces backslashes (sanity check the simulation premise)", () => {
    // If this assertion ever fails, the simulation premise is broken and
    // the rest of the block becomes meaningless. Lock it explicitly.
    const winJoined = pathWin32.join("C:\\Users\\dev\\vault", "_memory", "observations");
    expect(winJoined).toContain("\\");
    expect(winJoined).toBe("C:\\Users\\dev\\vault\\_memory\\observations");
  });

  it("joinVaultPathPosix produces forward-slash even when fed Windows-shape segments", () => {
    // Caller-side shape: a Windows host where a future caller smuggles a
    // backslash-bearing segment through. The Posix helper MUST normalize.
    const winLikeInput = pathWin32.join("_memory", "observations");
    expect(winLikeInput).toContain("\\");
    const posixOut = joinVaultPathPosix(winLikeInput, "foo.md");
    expect(posixOut).not.toContain("\\");
    expect(posixOut).toBe("_memory/observations/foo.md");
  });

  it("vaultRelativeInSink emits forward-slash for the audit/recall prefix path", () => {
    // This is the path that the audit-log SQL prefix lookup and recall's
    // notePath.startsWith comparison consume. On Windows, if the caller
    // accidentally hands in a backslash-segmented subpath, the comparison
    // must still produce a forward-slash string — otherwise Guard B
    // silently no-ops because notes.path uses forward-slash by indexer
    // convention.
    const sink = { resolveToRelativePath: "_memory/" };
    const winSubpath = pathWin32.join("observations", "2026-04-23.md");
    expect(winSubpath).toContain("\\");
    const rel = vaultRelativeInSink(sink, winSubpath);
    expect(rel).not.toContain("\\");
    expect(rel).toBe("_memory/observations/2026-04-23.md");
    // Most importantly: the prefix invariant findSinkContaining depends on
    // still holds against forward-slash-canonical notes.path values.
    expect(rel.startsWith(sink.resolveToRelativePath)).toBe(true);
  });

  it("findSinkContaining-equivalent prefix match holds on Windows-shape inputs", () => {
    // Simulate the full flow: on a Windows host, the indexer stores
    // notes.path in forward-slash form (per ObsidianFsChangeFeed
    // normalization). The Guards must produce a comparison key that
    // matches that convention regardless of where the input came from.
    const sink = { resolveToRelativePath: "_memory/" };
    const winShapedSubpath = pathWin32.join("observations", "spire.md");
    expect(winShapedSubpath).toContain("\\"); // confirm Windows shape
    const guardKey = vaultRelativeInSink(sink, winShapedSubpath);
    const notesPathRow = "_memory/observations/spire.md"; // forward-slash by indexer convention
    // Byte-equality is the contract: Guards must produce exactly what audit/recall sees.
    expect(guardKey).toBe(notesPathRow);
    // And the prefix invariant findSinkContaining depends on holds:
    expect(notesPathRow.startsWith(sink.resolveToRelativePath)).toBe(true);
  });

  it("joinVaultPath stays OS-native on the host platform (no forced normalization)", () => {
    // The FS-bound helper is intentionally OS-native. On POSIX hosts this
    // test asserts forward-slash output (current platform). On a Windows
    // host the same call would produce backslashes — which is correct,
    // because fs.* APIs on Windows accept either separator and the OS-
    // native form is what `path.join` documents. We do NOT normalize here.
    const joined = joinVaultPath("/abs/vault", "_memory/foo.md");
    // The presence/absence of backslash is platform-dependent on the FS
    // helper; assert only that the FS helper preserves the input segments
    // (the comparison-bound helpers carry the normalization invariant).
    expect(joined).toContain("_memory");
    expect(joined).toContain("foo.md");
  });
});
