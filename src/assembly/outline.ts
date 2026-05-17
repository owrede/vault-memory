/**
 * Phase 3 (ASM-02) — `get_outline` controller.
 *
 * Resolves a DocId into a nested outline tree of `OutlineNode`s built
 * from the `sections` table (landed in 03-01, migration 010) plus the
 * document-level citation packet (title/mtime/hash/display_url) read
 * through the `SourceConnector` seam.
 *
 * Pipeline:
 *
 *   1. Decompose the DocId into `{vaultName, path}`. The DocId scheme
 *      portion (e.g. `obsidian-fs`) is preserved on the response via
 *      `source_handle`. Optional `vaults` filter — when set, the
 *      decomposed vault MUST appear in it (otherwise `doc_not_found`).
 *   2. Resolve the `Vault` from the manager (throws `doc_not_found`
 *      shaped error on unknown vault).
 *   3. Load the note row by path (`notes.getByPath`). Missing row →
 *      `doc_not_found` (the indexer hasn't seen this doc yet, OR it
 *      was deleted between the catch-up scan and this call).
 *   4. Read the canonical `Document` via the SourceConnector. The
 *      adapter's `formatDisplayUrl(id)` mints the deep-link URL.
 *   5. Query `sections.getByNote(noteId)` — returns rows in
 *      parent-id-NULL-first, then parent-id ASC, then ord ASC order
 *      (one DFS-friendly pass).
 *   6. Build the tree by parent-pointer reconstruction.
 *   7. Resolve each section's `chunk_ids` from a single
 *      `chunks.getByNote(noteId)` lookup, filtered per-section by the
 *      stored `[chunk_id_first, chunk_id_last]` range. Sections with
 *      NULL ranges produce `chunk_ids: []`.
 *
 * Adapter-seam discipline (per `scripts/lint-adapters.sh`): NO `fs`,
 * `gray-matter`, `chokidar`, or `path.*` imports. Document reads route
 * through the injected `SourceConnector`. SQLite access (the `sections`,
 * `notes`, `chunks` query namespaces) is permitted — that is the L0
 * substrate, not the adapter tier.
 *
 * Error contract (per plan §"Empty / unknown doc_id"): an unknown
 * `doc_id` is an exceptional case — callers asked about a specific doc
 * by ID. Throw a tagged error; the server dispatch wraps it into
 * `{ isError: true, content: [...JSON.stringify({error: "doc_not_found", doc_id})...] }`.
 */

import { decomposeDocId, parseDocId, parseSourceHandle } from "../adapters/registry.js";
import type { SourceConnector } from "../adapters/source/types.js";
import { toCitationPacket, displayUrlFor } from "../memory/citation-packet.js";
import type { ChunkRow, SectionRow } from "../types.js";
import type { Vault, VaultManager } from "../vault/index.js";
import type { GetOutlineArgs, OutlineNode, OutlineResult } from "./types.js";

/**
 * Dedicated error class for the "unknown doc_id" case. The server
 * handler catches this and emits the structured `{error: "doc_not_found",
 * doc_id}` payload required by the plan's error contract — distinct
 * from generic exception messages (validation errors, etc).
 */
export class DocNotFoundError extends Error {
  override readonly name = "DocNotFoundError";
  readonly doc_id: string;
  constructor(docId: string) {
    super(`Document not found: ${docId}`);
    this.doc_id = docId;
  }
}

/**
 * Injected dependencies for `getOutline`. Mirrors `RecallDeps` in
 * `src/memory/tools/recall.ts` — the server bootstrap supplies the
 * production wiring, tests inject in-memory stubs.
 */
export interface GetOutlineDeps {
  manager: VaultManager;
  /** Resolve the `SourceConnector` for a vault name. */
  sourceConnectorFor: (vaultName: string) => SourceConnector;
}

/**
 * Public entry point. See file header for the full pipeline.
 */
export async function getOutline(
  deps: GetOutlineDeps,
  args: GetOutlineArgs,
): Promise<OutlineResult> {
  // 1) Validate-decompose the DocId. `parseDocId` throws on malformed
  //    input — surface as `doc_not_found` (callers gave us a bad id).
  let parsed: { scheme: string; authority: string; resource: string };
  try {
    const docId = parseDocId(args.doc_id);
    parsed = decomposeDocId(docId);
  } catch {
    throw new DocNotFoundError(args.doc_id);
  }
  const { scheme, authority: vaultName, resource: path } = parsed;

  // Optional vault-filter narrowing. The DocId already names a vault;
  // the filter exists for callers that want to assert they're talking
  // to a known set (e.g. a multi-vault agent guarding a tenant boundary).
  if (args.vaults && args.vaults.length > 0 && !args.vaults.includes(vaultName)) {
    throw new DocNotFoundError(args.doc_id);
  }

  // 2) Resolve the Vault. `manager.require` throws on unknown — map to
  //    DocNotFoundError so the wire response is consistent.
  let vault: Vault;
  try {
    vault = deps.manager.require(vaultName);
  } catch {
    throw new DocNotFoundError(args.doc_id);
  }

  // 3) Look up the note row by path. Missing row → doc_not_found.
  const noteRow = vault.db.notes.getByPath(path);
  if (!noteRow) {
    throw new DocNotFoundError(args.doc_id);
  }

  // 4) Read the canonical Document via the source seam. We use this
  //    for the doc-level citation-packet fields (title/mtime/hash/
  //    display_url) — staying off the DB-cached row keeps us aligned
  //    with `read_note` (which also reads fresh through the seam per
  //    Plan 01-03 Task 06).
  const source = deps.sourceConnectorFor(vaultName);
  const docId = parseDocId(args.doc_id);
  let docFields: { title: string; mtime: number; hash: string };
  let displayUrl: string;
  try {
    const doc = await source.readDocument(docId);
    docFields = { title: doc.title, mtime: doc.mtime, hash: doc.hash };
    // Use the canonical packet helpers so display-URL resolution
    // matches recall + Phase 3 conformance assertions byte-for-byte.
    const packet = toCitationPacket(doc, displayUrlFor(doc.id, source));
    displayUrl = packet.display_url;
  } catch {
    throw new DocNotFoundError(args.doc_id);
  }

  // 5) Read all sections for the note. `getByNote` returns rows in
  //    parent-NULL-first, then by parent_id ASC, then ord ASC — exactly
  //    the order needed to populate `byId` before any child references
  //    its parent in step 6.
  const sectionRows = vault.db.sections.getByNote(noteRow.id);

  // 7-prep) Load all chunks for the note once. Sections will filter
  //    this list by their stored [chunk_id_first, chunk_id_last] range.
  //    For a note with N chunks and S sections, this is one O(N) read
  //    + S × O(N) filters — totally fine for v2 doc sizes (N≤low
  //    thousands; S≤low hundreds). Could be optimized later with a
  //    range-keyed SQL helper, but kept simple here.
  const allChunks: ChunkRow[] = vault.db.chunks.getByNote(noteRow.id);

  // 6) Build the tree. Parent-pointer reconstruction in one pass.
  const root = buildOutlineTree(sectionRows, allChunks);

  // Compose the response. `source_handle` is derived from the DocId's
  // scheme + vault — minted via `parseSourceHandle` so the brand is
  // valid at the type level.
  const sourceHandle = parseSourceHandle(`${scheme}://${vaultName}`);

  return {
    doc_id: docId,
    source_handle: sourceHandle,
    title: docFields.title,
    root,
    mtime: docFields.mtime,
    hash: docFields.hash,
    display_url: displayUrl,
  };
}

/**
 * Build the outline tree from a flat `SectionRow[]` (in
 * `getByNote` order — NULL parents first) plus the note's chunks
 * (for `chunk_ids` resolution).
 *
 * Exported only for unit tests; production callers use `getOutline`.
 */
export function buildOutlineTree(rows: SectionRow[], allChunks: ChunkRow[]): OutlineNode[] {
  const byId = new Map<number, OutlineNode>();
  const roots: OutlineNode[] = [];
  for (const r of rows) {
    const node: OutlineNode = {
      anchor: r.anchor,
      heading_path: parseHeadingPath(r.heading_path),
      heading_text: r.heading_text,
      level: r.level,
      chunk_ids: collectChunkIdsInRange(allChunks, r.chunk_id_first, r.chunk_id_last),
      children: [],
    };
    byId.set(r.id, node);
    if (r.parent_id == null) {
      roots.push(node);
    } else {
      const parent = byId.get(r.parent_id);
      // Defensive: a row whose `parent_id` has not yet been seen would
      // indicate a getByNote ordering regression. The 03-01 contract
      // guarantees NULL-first ordering, so this branch is unreachable
      // in production. Tests that violate the contract will surface
      // the bug as a visibly-orphan node rather than a silent drop.
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }
  return roots;
}

/**
 * Parse the stringified-JSON `heading_path` column with one defensive
 * fallback: a `null` / malformed payload yields `[]` (no crash). The
 * 03-01 indexer always writes a valid JSON array; this defense is
 * cheap and prevents one bad row from poisoning the whole tree.
 */
function parseHeadingPath(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return parsed as string[];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Resolve a section's chunk-id range into the actual chunk IDs (as
 * strings — opaque tokens for downstream consumers). Returns `[]`
 * when either bound is `null` (a heading with no body content).
 *
 * Chunks are filtered from the pre-loaded `allChunks` list rather
 * than re-queried per-section, which keeps the overall outline build
 * at O(N + S × N) — fine for v2 doc sizes.
 */
function collectChunkIdsInRange(
  allChunks: ChunkRow[],
  first: number | null,
  last: number | null,
): string[] {
  if (first === null || last === null) return [];
  const ids: string[] = [];
  for (const c of allChunks) {
    if (c.id >= first && c.id <= last) {
      ids.push(String(c.id));
    }
  }
  return ids;
}
