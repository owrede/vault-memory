/**
 * Sink-aware path helpers for obsidian-fs.
 *
 * Per ADR-002 I-3 the `node:path` module is licensed only inside
 * `src/adapters/delivery/obsidian-fs/` (plus `src/cli.ts` and
 * `src/server.ts` for legacy bootstrap reasons). This file is the SOLE
 * licensed `path.join` site for sink/vault path resolution in Phase 2.
 *
 * Two helpers:
 *
 *   - `joinVaultPath(vaultRoot, relPath)` — thin wrapper over `path.join`
 *     so consumers (including `src/server.ts` bootstrap and the sentinel
 *     module) don't import `node:path` directly.
 *
 *   - `pathInSink(vaultAbsolutePath, sink, relativeSubpath?)` — computes
 *     an absolute path inside a memory sink. The caller supplies the
 *     vault-absolute path (typically resolved from `VaultManager`); the
 *     sink contributes its vault-relative folder; `relativeSubpath`
 *     (optional, defaults to "") is appended inside.
 *
 * Both helpers are pure synchronous string ops — no `fs` calls, no I/O.
 */

import path from "node:path";

/**
 * Join a vault-absolute path with a vault-relative subpath. Thin wrapper
 * over `path.join`. Use this instead of importing `node:path` so the
 * seam-preservation CI grep stays happy.
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
 */
export function pathInSink(
  vaultAbsolutePath: string,
  sink: SinkLike,
  relativeSubpath = "",
): string {
  return path.join(vaultAbsolutePath, sink.resolveToRelativePath, relativeSubpath);
}
