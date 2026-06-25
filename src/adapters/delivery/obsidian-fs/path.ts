/**
 * Sink-aware path helpers for obsidian-fs.
 *
 * Per ADR-002 I-3 the `node:path` module is licensed only inside
 * `src/adapters/delivery/obsidian-fs/` (plus `src/cli.ts` and
 * `src/server.ts` for legacy bootstrap reasons). This file is the SOLE
 * licensed `path.join` site for sink/vault path resolution in Phase 2.
 *
 * Helpers split by consumer category (CR-03 / Plan 02-11):
 *
 *   FS-bound (OS-native absolute) — for values that flow into `fs.*` calls:
 *     - `joinVaultPath(vaultRoot, relPath)` — thin wrapper over `path.join`.
 *     - `pathInSink(vaultAbsolutePath, sink, relativeSubpath?)` — absolute
 *       path inside a memory sink.
 *
 *   Comparison-bound (forward-slash, vault-relative) — for values that flow
 *   into DocId-resource comparisons, SQL `LIKE '<prefix>%'` lookups against
 *   `notes.path`, or `MemorySinkRegistry.findSinkContaining` matching:
 *     - `joinVaultPathPosix(...segments)` — `path.posix.join` with defensive
 *       backslash normalization.
 *     - `vaultRelativeInSink(sink, relativeSubpath?)` — forward-slash form of
 *       `<sink.resolveToRelativePath><relativeSubpath>`.
 *
 * Why split? `pathInSink`'s return value goes into `fs.access` / `fs.readFile`
 * / `fs.writeFile`, where OS-native separators are the convention. The
 * comparison-bound helpers must emit forward-slash on every OS, because the
 * DocId resource (governed by `DOC_ID_PATTERN` in `src/adapters/registry.ts`)
 * and `notes.path` storage (forward-slash by indexer convention) are both
 * forward-slash regardless of `process.platform`. On Windows, `path.join`
 * emits backslashes — silently breaking Guard B / `findSinkContaining` /
 * `lastMemoryWriteAtForPathPrefix` SQL lookups. The split is the seam-level
 * fix; FS-bound helpers retain OS-native semantics, comparison-bound helpers
 * lock forward-slash.
 *
 * All helpers are pure synchronous string ops — no `fs` calls, no I/O.
 */

import path from "node:path";

/**
 * Join a vault-absolute path with a vault-relative subpath. Thin wrapper
 * over `path.join` — OS-native separators. Use for paths that flow into
 * `fs.*` calls (read / write / stat / access). Use this instead of
 * importing `node:path` so the seam-preservation CI grep stays happy.
 *
 * FS-bound — DO NOT use the return value for comparison against a DocId
 * resource or for SQL `LIKE` prefix lookups; use `joinVaultPathPosix` or
 * `vaultRelativeInSink` for those callers.
 */
export function joinVaultPath(vaultRoot: string, relPath: string): string {
  return path.join(vaultRoot, relPath);
}

/**
 * Structural shape required from a sink — only the `resolveToRelativePath`
 * field is consulted. Declared as a local interface (not a `Pick<MemorySink, ...>`)
 * so Task 0 can land independently of the broader `MemorySink` widening
 * in Task 1; once both are in place the broader `MemorySink` interface
 * matches this shape structurally and callers pass the full sink record.
 */
interface SinkLike {
  resolveToRelativePath: string;
}

/**
 * Compute an absolute path inside a memory sink. The caller supplies the
 * vault-absolute path (resolved through `VaultManager`); the sink record
 * contributes its vault-relative folder; the optional `relativeSubpath`
 * is appended inside.
 *
 * Example:
 *   pathInSink("/v/atlas", { resolveToRelativePath: "_memory/" }, "obs/foo.md")
 *   → "/v/atlas/_memory/obs/foo.md"
 *
 * FS-bound — OS-native separators. Use the return value for `fs.*` calls
 * only. For DocId-resource comparisons or SQL `LIKE` prefix lookups, see
 * `vaultRelativeInSink`.
 */
export function pathInSink(
  vaultAbsolutePath: string,
  sink: SinkLike,
  relativeSubpath = "",
): string {
  return path.join(vaultAbsolutePath, sink.resolveToRelativePath, relativeSubpath);
}

/**
 * Defensive: convert any backslash to forward-slash. Inputs are normally
 * byte-clean (the sink-handle parser at `src/memory/sink.ts` refuses
 * backslashes inside segments), but `relativeSubpath` and other callsites
 * may originate from caller-controlled inputs — normalize so the
 * forward-slash invariant always holds on output.
 */
function normalizeToForwardSlash(s: string): string {
  return s.includes("\\") ? s.replace(/\\/g, "/") : s;
}

/**
 * Vault-relative POSIX join — emits forward-slash regardless of
 * `process.platform`. Use for ANY value that will be compared against a
 * DocId resource, used as a SQL `LIKE` prefix against `notes.path`, or
 * threaded into `MemorySinkRegistry.findSinkContaining` lookups.
 *
 * On POSIX this is functionally equivalent to `path.join` minus the
 * leading vault root; on Windows it differs because `path.join` would
 * have emitted backslashes that downstream forward-slash comparisons
 * miss (CR-03 — silent Guard B no-op on Windows).
 *
 * Caller-supplied backslashes in any segment are normalized to forward-
 * slash defensively, so the output invariant holds even if a future
 * caller smuggles a backslash in.
 *
 * Comparison-bound — DO NOT pass the return value to `fs.*` calls; use
 * `joinVaultPath` or `pathInSink` for FS callers.
 */
export function joinVaultPathPosix(...segments: string[]): string {
  return path.posix.join(...segments.map(normalizeToForwardSlash));
}

/**
 * Forward-slash form of a path INSIDE a sink, relative to the vault root.
 * Used for any caller that compares against a DocId resource (always
 * forward-slash by `DOC_ID_PATTERN` invariant in
 * `src/adapters/registry.ts`) or feeds a SQL `LIKE '<prefix>%'` lookup
 * against `notes.path` (forward-slash by indexer convention).
 *
 * Round-trip property: for any `(vault, sink, subpath)` triple,
 * `vaultRelativeInSink(sink, subpath)` is byte-equal with the `resource`
 * portion of `decomposeDocId(formatDocId("obsidian-fs", vault, rel))`.
 *
 * Edge cases:
 *   - `relativeSubpath = ""` (default) returns the sink folder with its
 *     trailing slash preserved (e.g. `"_memory/"`). This matches the
 *     `findSinkContaining` policy where `sink.resolveToRelativePath`
 *     includes its trailing slash so prefix matches respect folder
 *     boundaries (`_memory/` matches `_memory/foo.md` but NOT
 *     `_memory-staging/foo.md`).
 *   - Caller-supplied backslashes in `relativeSubpath` are normalized to
 *     forward-slash before joining.
 *
 * Comparison-bound — DO NOT pass the return value to `fs.*` calls; use
 * `pathInSink` for FS callers.
 */
export function vaultRelativeInSink(sink: SinkLike, relativeSubpath = ""): string {
  if (relativeSubpath === "") return normalizeToForwardSlash(sink.resolveToRelativePath);
  return joinVaultPathPosix(sink.resolveToRelativePath, relativeSubpath);
}
