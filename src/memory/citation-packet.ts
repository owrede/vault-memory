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
 * Attach the denormalized `status` / `superseded_by` extras to a base
 * `CitationPacket` (or any subtype). Reads from the packet's REQUIRED
 * `properties` bag (`Record<string, unknown>`, always populated) — no
 * null guards needed for `properties` itself, only for the inner keys.
 *
 * Generic so callers that pass a `CitationPacket` subtype (e.g. a packet
 * already carrying `relation`) keep their extra fields. Returns a fresh
 * object; does not mutate the input packet.
 *
 * Shared by `assembleDossier` (anchor + linked docs) and `assembleBundle`
 * (anchor) — both denormalize the same two property keys identically.
 */
export function withPropertyExtras<T extends CitationPacket>(
  packet: T,
): T & { status?: string; superseded_by?: string } {
  const out: T & { status?: string; superseded_by?: string } = { ...packet };
  const status = packet.properties.status;
  if (typeof status === "string") out.status = status;
  const supersededBy = packet.properties.superseded_by;
  if (typeof supersededBy === "string") out.superseded_by = supersededBy;
  return out;
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
 * Compute a display URL for a `DocId` via the adapter's
 * `formatDisplayUrl` seam (ADR-002 §SourceConnector).
 *
 * This thin wrapper preserves the seam: adapter-specific URL literals
 * live in the source adapter (the single licensed site per the I-5b
 * lint rule). A future Notion / Slack adapter publishes its own
 * deep-link convention; recall does not encode any URL scheme inline.
 *
 * Contract: `formatDisplayUrl` is OPTIONAL on the `SourceConnector`
 * interface (some adapters may not have deep links). When the adapter
 * omits the method or returns `null`, this helper falls back to the
 * DocId string itself so callers always get a non-null `display_url`
 * on the citation packet.
 */
export function displayUrlFor(
  docId: DocId,
  source: { formatDisplayUrl?: (id: DocId) => string | null },
): string {
  return source.formatDisplayUrl?.(docId) ?? docId;
}
