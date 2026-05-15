/**
 * Citation Packet — the Phase 3 ASM-05 packet shape, pinned at the
 * Phase 2 floor.
 *
 * D-01 mandates an 8-field packet:
 *
 *   { doc_id, source_handle, title, heading_path, mtime, hash,
 *     display_url, properties }
 *
 * Two notes on field names:
 *
 *   - `source_handle` on the packet maps to `Document.source` on the
 *     canonical content type (`src/types.ts`). The mapper transcribes
 *     accordingly — the packet uses the more explicit name because
 *     consumers (recall callers, Phase 3 assembly tools) see the packet
 *     surface, not the internal `Document` shape.
 *
 *   - `hash` on the packet IS the read-side `Document.hash` (canonical
 *     content hash returned by `SourceConnector.readDocument`). This is
 *     DISTINCT from the write-side `WriteSuccess.newHash` returned by
 *     `record_observation` / `supersede`. Both are correct names in
 *     their respective domains; the packet uses the read-side name
 *     because citation packets are READ artifacts.
 *
 * `heading_path` is a packet-only D-01 field. The canonical `Document`
 * type does not carry one (Phase 3 may add it via the BlockNode tree);
 * the mapper accepts an optional `heading_path` on the input shape and
 * defaults to an empty array when not present. The mapper deep-copies
 * the array so caller mutations do not leak into the source `Document`.
 *
 * `properties` is shallow-copied for the same reason — a `{...obj}`
 * spread is sufficient because callers should never mutate the inner
 * property values, only add/remove keys at the top level.
 *
 * Phase 3 ASM-05 will import `CitationPacket` from this module to keep
 * the recall (Phase 2) and assembly (Phase 3) surfaces in lockstep.
 */

import { decomposeDocId } from "../adapters/registry.js";
import type { DocId, Document, SourceHandle } from "../types.js";

/**
 * D-01 packet shape — exactly 8 fields. Phase 3 may extend additively;
 * Phase 2 ships all 8 as the floor.
 */
export interface CitationPacket {
  /** Opaque, branded DocId — the document's identity. */
  doc_id: DocId;
  /** Adapter handle that produced this document. */
  source_handle: SourceHandle;
  /** Short human-readable title. */
  title: string;
  /** Heading-path array (root → leaf); empty when the doc has no heading. */
  heading_path: string[];
  /** Last-modified time, epoch ms. */
  mtime: number;
  /** Read-side content hash from `Document.hash`. */
  hash: string;
  /** Adapter-provided deep-link URL (`displayUrlFor(doc.id)` for obsidian-fs). */
  display_url: string;
  /** Untyped property bag (YAML frontmatter, typed properties, …). */
  properties: Record<string, unknown>;
}

/**
 * Map a `Document` (or its read-side fields) into a `CitationPacket`.
 *
 * Field transcription:
 *   - `doc.id` → `packet.doc_id`
 *   - `doc.source` → `packet.source_handle` (renamed for the packet surface)
 *   - `doc.title` → `packet.title`
 *   - `doc.heading_path` (optional) → `packet.heading_path` (defaults to `[]`)
 *   - `doc.mtime` → `packet.mtime`
 *   - `doc.hash` → `packet.hash` (read-side; not `newHash`)
 *   - `displayUrl` → `packet.display_url` (callers compute via `displayUrlFor`)
 *   - `doc.properties` → `packet.properties` (shallow-copied)
 *
 * Caller mutations on the returned packet's `heading_path` array or
 * `properties` object cannot leak back into the source `Document` — the
 * array is spread-copied and the property bag is spread-copied at the
 * top level.
 */
export function toCitationPacket(
  doc: Pick<Document, "id" | "source" | "title" | "mtime" | "hash" | "properties"> & {
    heading_path?: string[];
  },
  displayUrl: string,
): CitationPacket {
  return {
    doc_id: doc.id,
    source_handle: doc.source,
    title: doc.title,
    heading_path: doc.heading_path ? [...doc.heading_path] : [],
    mtime: doc.mtime,
    hash: doc.hash,
    display_url: displayUrl,
    properties: { ...doc.properties },
  };
}

/**
 * Construct an `obsidian://open?vault=…&file=…` display URL from a
 * DocId. For non-obsidian-fs schemes (future Notion / Slack adapters)
 * the function returns the DocId string itself — adapter-specific
 * deep-link logic ships with each adapter and recall does not encode
 * URL conventions inline.
 *
 * Encoding semantics:
 *   - Vault name (authority) and resource (vault-relative path) are
 *     both passed through `encodeURIComponent` so spaces become `%20`,
 *     Unicode is percent-encoded, and forward slashes in the resource
 *     are encoded too. This mirrors Obsidian's URI handler expectations
 *     and matches the v1 `obsidianUrl()` behavior (`displayUrl` chain
 *     in `src/server.ts`, deferred to `SourceConnector.formatDisplayUrl`).
 */
export function displayUrlFor(docId: DocId): string {
  const parts = decomposeDocId(docId);
  if (parts.scheme === "obsidian-fs") {
    const vaultParam = encodeURIComponent(parts.authority);
    const fileParam = encodeURIComponent(parts.resource);
    return `obsidian://open?vault=${vaultParam}&file=${fileParam}`;
  }
  return docId;
}
