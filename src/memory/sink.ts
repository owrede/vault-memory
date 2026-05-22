/**
 * `MemorySinkHandle` parser + sentinel filename constant.
 *
 * Per ADR-004 §"MemorySink handle shape", a `MemorySinkHandle` is a
 * fully-formed URI of the shape `obsidian-fs://<vault>/<resource>/` —
 * lowercase scheme, non-empty authority, non-empty resource, **trailing
 * slash required** (per ADR-001 §I-6 canonical-serialization). The
 * trailing slash distinguishes a sink handle (a folder address) from a
 * `DocId` (a file address); a folder handle that did not require a
 * trailing slash could be confused with a parent-directory `DocId`.
 *
 * The brand-cast escape hatch lives ONLY inside the IIFE below; this
 * file is the SOLE module that performs it for `MemorySinkHandle`.
 * Only the validating `parseMemorySinkHandle` is exported. The IIFE
 * pattern is identical to `parseDocId` in `src/adapters/registry.ts`.
 *
 * `SENTINEL_FILENAME` is the single canonical name for the sink
 * sentinel file (`.memory-sink`). The sentinel mechanics live in
 * `src/adapters/delivery/obsidian-fs/sentinel.ts` (the only place
 * `node:fs` is licensed for sentinel work, per ADR-002 I-2); this
 * module just declares the filename so other modules don't have to
 * hard-code the string.
 *
 * Phase 2 scope: only `obsidian-fs://` handles are accepted. Future
 * adapters (notion-api, etc.) may add their own schemes; until then,
 * a non-obsidian-fs handle is a config error and the parser rejects.
 */

import type { MemorySinkHandle } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Handle pattern + IIFE-closed mint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical MemorySinkHandle shape: `obsidian-fs://<vault>/<resource>/`.
 *
 * - scheme: `obsidian-fs` (Phase 2 scope; future adapters add their own).
 * - authority: lowercase ASCII alphanumeric + dashes; starts alphanumeric.
 * - resource: at least one non-whitespace character segment;
 * - MUST end with a `/`.
 *
 * Examples that PASS: `obsidian-fs://atlas/_memory/`,
 *                     `obsidian-fs://atlas/_memory/inbox/`.
 * Examples that FAIL: `obsidian-fs://atlas/_memory` (no trailing slash),
 *                     `OBSIDIAN-FS://x/y/` (uppercase scheme),
 *                     `obsidian-fs:/atlas/_memory/` (single slash),
 *                     `notion-api://...` (non-obsidian-fs scheme, Phase 2).
 */
export const MEMORY_SINK_HANDLE_PATTERN = /^obsidian-fs:\/\/[a-z0-9][a-z0-9-]*\/[^\s]+\/$/;

/**
 * Allowed characters inside a single path segment of the resource portion
 * of a `MemorySinkHandle`. ASCII alphanumeric plus the three filename-safe
 * punctuation characters (`.`, `_`, `-`). Critically, the literal `.` is
 * permitted INSIDE a segment (so file extensions and dotfiles are fine),
 * but the per-segment whitelist used in `parseMemorySinkHandle` rejects
 * the bare-dot (`.`) and bare-dot-dot (`..`) segments that `path.normalize`
 * / `path.join` would otherwise collapse and let a sink escape its vault.
 *
 * The character class is intentionally narrower than the top-level
 * `MEMORY_SINK_HANDLE_PATTERN` (which only refuses whitespace) so that
 * the parser refuses anything `path.join` could reshape: backslashes,
 * leading-slash empties, control characters, and Unicode lookalikes.
 *
 * Per CR-01 (Plan 02-09): this is the substrate the memory-namespace
 * safety invariant rests on. Downstream `pathInSink` is safe-by-construction
 * precisely because the parser refuses any traversal-shaped input here.
 */
const SEGMENT_PATTERN = /^[A-Za-z0-9._\-]+$/;

const { parseMemorySinkHandle } = (() => {
  // `mint` is the unsafe brand cast; closed inside this IIFE so it
  // cannot escape. We export only the validating `parse`.
  const mint = (s: string): MemorySinkHandle => s as MemorySinkHandle;
  const parse = (rawInput: string): MemorySinkHandle => {
    // Normalize to NFC BEFORE the regex test. This forecloses Unicode
    // tricks where decomposed-vs-precomposed equivalents differ
    // byte-for-byte: an attacker cannot smuggle a `..` past the parser
    // by spelling it with a combining sequence that re-composes inside
    // the per-segment check. For ASCII inputs NFC is a fixed point, so
    // this is a no-op on the positive controls.
    const s = typeof rawInput === "string" ? rawInput.normalize("NFC") : rawInput;
    if (!MEMORY_SINK_HANDLE_PATTERN.test(s)) {
      throw new Error(
        `Invalid MemorySinkHandle: ${JSON.stringify(s)}. ` +
          `Expected obsidian-fs://<vault>/<path>/ (trailing slash required).`,
      );
    }
    // Extract the resource portion: everything after the authority's
    // trailing slash and before the handle's trailing slash. The regex
    // above guarantees the shape, so the slice math is safe.
    //
    //   obsidian-fs://<authority>/<resource>/
    //                  ^         ^         ^
    //                  authStart authEnd   trailing
    //
    // `authStart` is fixed at the length of "obsidian-fs://". `authEnd`
    // is the first `/` AT OR AFTER `authStart` (the regex guarantees
    // one exists). The resource is `[authEnd+1, length-1)` so the
    // trailing slash is excluded.
    const authStart = "obsidian-fs://".length;
    const authEnd = s.indexOf("/", authStart);
    const resource = s.slice(authEnd + 1, s.length - 1);
    for (const segment of resource.split("/")) {
      if (
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        !SEGMENT_PATTERN.test(segment)
      ) {
        throw new Error(
          `Invalid MemorySinkHandle: ${JSON.stringify(s)}. ` +
            `Resource path segment ${JSON.stringify(segment)} is not allowed: ` +
            `only [A-Za-z0-9._-]+ segments are permitted ` +
            `(no "..", no ".", no empty segments, no backslashes, no control characters).`,
        );
      }
    }
    return mint(s);
  };
  return { parseMemorySinkHandle: parse };
})();

export { parseMemorySinkHandle };

/**
 * Construct a `MemorySinkHandle` from its parts and validate via
 * `parseMemorySinkHandle`. Convenience helper so callers do not
 * concatenate by hand. The caller is responsible for ensuring
 * `resource` ends with a trailing slash; the parser rejects otherwise.
 */
export function formatMemorySinkHandle(
  scheme: string,
  authority: string,
  resource: string,
): MemorySinkHandle {
  return parseMemorySinkHandle(`${scheme}://${authority}/${resource}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sentinel filename — canonical declaration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The single canonical filename for the memory-sink sentinel. Per
 * ADR-004 §"Sentinel file — `.memory-sink`", every folder serving as a
 * memory sink MUST contain a file with this name; the registry refuses
 * to resolve a sink against a folder that lacks the sentinel.
 *
 * The sentinel's contents are informational only (timestamp + sink
 * name); the *presence* is the gate. The actual file write/read
 * mechanics live in `src/adapters/delivery/obsidian-fs/sentinel.ts`
 * (the only file licensed to call `node:fs` for sentinel work per
 * ADR-002 I-2).
 */
export const SENTINEL_FILENAME = ".memory-sink";
