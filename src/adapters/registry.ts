/**
 * Adapter Registry — the single minting point for branded DocIds and
 * the lookup surface for `SourceConnector` / `DeliveryAdapter` /
 * `ChangeFeed` triples (ADR-002 §Registry).
 *
 * # Branded-DocId minting (ADP-05, RESEARCH §Pattern 2)
 *
 * `DocId` is a nominal type — `string & { readonly __brand: "DocId" }` —
 * so raw `string` values cannot be assigned to a `DocId` parameter at
 * compile time. The brand-cast escape hatch lives ONLY inside the
 * IIFE below; this file is the SOLE module that performs it, and the
 * unsafe `mint` closure cannot leak across module boundaries (RESEARCH
 * §Pattern 2 lines 336–352). Only the validating `parseDocId` is
 * exported. The negative test `tests/types/docid-brand.test-d.ts`
 * proves the brand at compile time.
 *
 * `SourceHandle` follows the same pattern (`<scheme>://<authority>`,
 * no resource path).
 *
 * # Registry shape (ADR-002 lines 256–267)
 *
 * Three independent maps — sources, deliveries, change-feeds — keyed
 * by `SourceHandle`. The registry does NOT enforce a one-to-one
 * relationship between the three roles for a given handle; an adapter
 * may register for only one or two roles. The conformance suite
 * (Plans 01-03..05) asserts the obsidian-fs adapter registers all
 * three roles under the same handle.
 *
 * # Resolver semantics
 *
 * `resolveSource(handle)` mirrors `VaultManager.require()` — throws
 * with a helpful message on miss. Use the predicate-style accessor
 * (none exposed in Phase 1; add `hasSource(handle): boolean` later if
 * a use case appears) to avoid the throw.
 *
 * # Lifecycle
 *
 * The registry is constructed once at server bootstrap and lives for
 * the process lifetime. Adapters self-register at construction time;
 * the registry does NOT own adapter lifetimes (no `close()` cascade) —
 * each adapter's owner closes it directly.
 */

import type { DocId, SourceHandle } from "../types.js";
import type { SourceConnector } from "./source/types.js";
import type { DeliveryAdapter } from "./delivery/types.js";
import type { ChangeFeed } from "./change-feed/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// DocId minting — IIFE-closed per RESEARCH §Pattern 2
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical DocId shape: `<scheme>://<authority>/<resource>`.
 *
 *   - scheme: lowercase ASCII, alphanumeric + dashes, starts with letter
 *   - authority: one or more non-slash chars
 *   - resource: one or more chars
 *
 * Examples that PASS: `obsidian-fs://my-vault/notes/foo.md`,
 *                     `notion-api://workspace-abc/page-123`.
 * Examples that FAIL: `not-a-uri` (no scheme), `OBSIDIAN://X/y`
 *                     (uppercase), `123://x/y` (digit-leading scheme),
 *                     `obsidian://` (empty authority + resource),
 *                     `obsidian-fs:/foo` (missing slash).
 */
const DOC_ID_PATTERN = /^[a-z][a-z0-9-]*:\/\/[^/]+\/.+$/;

/**
 * Bare `<scheme>://<authority>` — no resource path, no trailing slash.
 * Used to name an adapter triple in the registry. Same scheme rules as
 * `DOC_ID_PATTERN`; authority is one or more non-slash chars.
 */
const SOURCE_HANDLE_PATTERN = /^[a-z][a-z0-9-]*:\/\/[^/]+$/;

const { parseDocId } = (() => {
  // `mint` is the ONLY unsafe brand cast in the codebase; closed inside
  // this IIFE so it cannot escape. Per RESEARCH §Pattern 2. We do NOT
  // return it — only the validating `parse` is exported.
  const mint = (s: string): DocId => s as DocId;
  const parse = (s: string): DocId => {
    if (!DOC_ID_PATTERN.test(s)) {
      throw new Error(
        `Invalid DocId: ${JSON.stringify(s)}. ` +
          `Expected <scheme>://<authority>/<resource> ` +
          `(scheme: lowercase letter + alnum/dashes; authority: non-slash; resource: non-empty).`,
      );
    }
    return mint(s);
  };
  return { parseDocId: parse };
})();

export { parseDocId };

/**
 * Construct a DocId from its components and validate via `parseDocId`.
 * Convenience helper so callers do not concatenate by hand.
 */
export function formatDocId(scheme: string, authority: string, resource: string): DocId {
  return parseDocId(`${scheme}://${authority}/${resource}`);
}

/**
 * Split a canonical `DocId` into its three components. Pure split —
 * defensively re-validates via `parseDocId` so a stale brand-cast cannot
 * leak malformed input through. Re-uses the SAME `DOC_ID_PATTERN` as
 * `parseDocId`; there is no second regex (single source of truth per
 * ADR-001 §I-6 canonical-serialization).
 *
 * The split is intentionally a pure string operation (`indexOf("://")` +
 * `indexOf("/")`) rather than a regex capture-group, because the
 * resource portion can contain `/`-separated segments that a single
 * capture group would have to greedy-match — the explicit split keeps
 * the behavior obviously correct and avoids regex-engine surprises with
 * unicode or extreme inputs.
 *
 * Used by Phase 2's `MemorySinkRegistry.findSinkContaining(docId)` and
 * by any downstream tool that needs the scheme/authority/resource parts
 * without re-validating the DocId from scratch.
 */
export function decomposeDocId(docId: DocId): {
  scheme: string;
  authority: string;
  resource: string;
} {
  // Defensive: assert canonical shape via the existing parser. Cheap
  // (one regex test) and means a stale brand-cast cannot smuggle a
  // malformed value through this helper.
  parseDocId(docId);
  const schemeEnd = docId.indexOf("://");
  const scheme = docId.slice(0, schemeEnd);
  const rest = docId.slice(schemeEnd + 3);
  const authoritySlash = rest.indexOf("/");
  const authority = rest.slice(0, authoritySlash);
  const resource = rest.slice(authoritySlash + 1);
  return { scheme, authority, resource };
}

/**
 * Validate and brand a `SourceHandle` — bare `<scheme>://<authority>`,
 * no resource path. Throws on malformed input.
 */
export function parseSourceHandle(s: string): SourceHandle {
  if (!SOURCE_HANDLE_PATTERN.test(s)) {
    throw new Error(
      `Invalid SourceHandle: ${JSON.stringify(s)}. ` +
        `Expected <scheme>://<authority> with no resource path or trailing slash.`,
    );
  }
  return s as SourceHandle;
}

// ─────────────────────────────────────────────────────────────────────────────
// AdapterRegistry — handle → adapter resolver triad
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registry of adapter triples, keyed by `SourceHandle`. Mirrors
 * `VaultManager` shape (`src/vault/manager.ts:23–78`).
 *
 * Adapters self-register at construction time; the registry does not
 * own adapter lifetimes. Lookups throw with a helpful message on miss.
 */
export class AdapterRegistry {
  private readonly sources = new Map<SourceHandle, SourceConnector>();
  private readonly deliveries = new Map<SourceHandle, DeliveryAdapter>();
  private readonly changeFeeds = new Map<SourceHandle, ChangeFeed>();

  // ── source ────────────────────────────────────────────────────────────────

  /** Register a source. Overwrites any prior registration under the same handle. */
  registerSource(handle: SourceHandle, adapter: SourceConnector): void {
    this.sources.set(handle, adapter);
  }

  /** Resolve a source. Throws with a helpful message on miss. */
  resolveSource(handle: SourceHandle): SourceConnector {
    const a = this.sources.get(handle);
    if (!a) {
      const known = [...this.sources.keys()].join(", ") || "(none)";
      throw new Error(`Unknown source handle: "${handle}". Registered sources: ${known}`);
    }
    return a;
  }

  /** List registered source handles. */
  listSources(): SourceHandle[] {
    return [...this.sources.keys()];
  }

  // ── delivery ──────────────────────────────────────────────────────────────

  registerDelivery(handle: SourceHandle, adapter: DeliveryAdapter): void {
    this.deliveries.set(handle, adapter);
  }

  resolveDelivery(handle: SourceHandle): DeliveryAdapter {
    const a = this.deliveries.get(handle);
    if (!a) {
      const known = [...this.deliveries.keys()].join(", ") || "(none)";
      throw new Error(`Unknown delivery handle: "${handle}". Registered deliveries: ${known}`);
    }
    return a;
  }

  listDeliveries(): SourceHandle[] {
    return [...this.deliveries.keys()];
  }

  // ── change-feed ───────────────────────────────────────────────────────────

  registerChangeFeed(handle: SourceHandle, feed: ChangeFeed): void {
    this.changeFeeds.set(handle, feed);
  }

  resolveChangeFeed(handle: SourceHandle): ChangeFeed {
    const f = this.changeFeeds.get(handle);
    if (!f) {
      const known = [...this.changeFeeds.keys()].join(", ") || "(none)";
      throw new Error(`Unknown change-feed handle: "${handle}". Registered feeds: ${known}`);
    }
    return f;
  }

  listChangeFeeds(): SourceHandle[] {
    return [...this.changeFeeds.keys()];
  }
}
