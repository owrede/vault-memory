/**
 * `getDocumentBundle` — the ASM-01 controller (Phase 3, Plan 03-04).
 *
 * Returns the document-tree retrieval surface that composes every other
 * Phase 3 read into one response:
 *
 *   - `anchor`        — citation packet (8 required D-01 fields) for the
 *                       anchor document, plus optional `status` /
 *                       `superseded_by` denormalized extras (ASM-06) read
 *                       from `properties` via the same hydration path
 *                       extended by Plan 03-05.
 *   - `outline`       — the section tree from `buildOutlineTree`
 *                       (re-used from 03-02 — NOT duplicated).
 *   - `backlinks`     — citation packets + `property_snippet` (≤200 chars
 *                       of plain-text body from the linking doc) +
 *                       `relation: "wikilink"`. In v2.0.0 the v1
 *                       `wikilinks` table is the only edge source; Phase
 *                       4 widens `relation` additively.
 *   - `forward_links` — citation packets + `property_snippet` +
 *                       `relation: "wikilink"`.
 *   - `recent_edits`  — up to 10 most recent `audit_log` entries for the
 *                       anchor's CURRENT note path, mapped to
 *                       `BundleRecentEdit`.
 *
 * # Citation packet contract (M1 fix — single source of truth)
 *
 * Every packet (anchor, backlinks, forward_links) is built via
 * `toCitationPacket()` from `src/memory/citation-packet.ts`. The bundle
 * does NOT redefine the 8-field shape. Bundle-specific extras
 * (`property_snippet`, `relation`, `status?`, `superseded_by?`) are
 * intersected onto `CitationPacket` (`CitationPacket & { ...extras }`).
 *
 * `CitationPacket.properties` is REQUIRED (`Record<string, unknown>`,
 * always populated by the mapper; `{}` when the doc has no frontmatter).
 * Bundle entries therefore never carry `properties: undefined`.
 *
 * # `depth: 1` semantics (only value accepted in v2.0.0)
 *
 * One-hop backlinks / forward links. The Zod schema in `tool-registry.ts`
 * pins `depth` to `z.literal(1).optional().default(1)` — higher values
 * are not accepted today. Phase 4 may widen additively.
 *
 * # Recent-edits rename-history limitation (M3 — documented, no fix)
 *
 * `getAuditLog({notePath})` (see `src/audit/audit.ts:93-97`) looks up
 * entries by CURRENT note path. Pre-rename audit_log rows are keyed on
 * `note_id` internally, so the path-keyed lookup misses them. If a doc
 * was renamed from `foo.md` → `bar.md`, asking
 * `get_document_bundle({doc_id: "obsidian-fs://vault/bar.md"})`
 * surfaces only the post-rename edits.
 *
 * Why this is acceptable for v2.0.0:
 *   - Phase 3 is read-side; no new write path widens the rename problem.
 *   - The audit_log retains pre-rename rows for forensic purposes;
 *     they're queryable directly via `audit_log({note_path})` for the
 *     OLD path until the note row is purged.
 *   - The collaborative-vault domain ("tolerating collaborators
 *     renaming notes") names this as a design pressure but does not
 *     require Phase 3 to surface pre-rename history in `recent_edits`.
 *
 * Phase 4 widens this — the graph layer will centralize
 * `doc_id → note_id` resolution and the bundle can switch to the
 * `note_id`-keyed audit_log lookup.
 *
 * # Adapter-seam discipline (ADR-002 I-1..I-7)
 *
 * The controller is pure: no `node:fs`, no `node:path`, no
 * `gray-matter`, no `chokidar`. All `Document` reads route through the
 * injected `SourceConnector` (`readDocument`). SQLite namespace access
 * (`vault.db.notes`, `vault.db.sections`, `vault.db.chunks`,
 * `vault.db.audit`, `vault.db.wikilinks`) is L0 substrate, owned by the
 * existing query layer — fine.
 */

import { decomposeDocId, formatDocId, parseDocId } from "../adapters/registry.js";
import type { SourceConnector } from "../adapters/source/types.js";
import { getAuditLog } from "../audit/audit.js";
import { listBacklinks, listForwardLinks } from "../graph/graph.js";
import { type CitationPacket, displayUrlFor, toCitationPacket } from "../memory/citation-packet.js";
import { DocNotFoundError } from "./outline.js";
import { buildOutlineTree } from "./outline.js";
import type { OutlineNode } from "./types.js";
import type { BlockNode, ChunkRow, Document, SectionRow } from "../types.js";
import type { Vault, VaultManager } from "../vault/index.js";

/**
 * Maximum number of audit-log rows surfaced in `recent_edits`.
 * Plan §"Acceptance criteria" — `recent_edits` length ≤ 10 even when
 * the audit log has more entries.
 */
const RECENT_EDITS_LIMIT = 10;

/**
 * Maximum length (in chars) of the body plain-text snippet attached to
 * each backlink / forward-link entry. Plan §"Property snippet":
 * "first 200 chars of plain-text-rendered body."
 */
const PROPERTY_SNIPPET_MAX = 200;

/**
 * Injected dependencies for `getDocumentBundle`. Mirrors `GetOutlineDeps`
 * / `AssembleDossierDeps` so production wiring + unit tests share one
 * shape.
 */
export interface GetDocumentBundleDeps {
  manager: VaultManager;
  sourceConnectorFor: (vaultName: string) => SourceConnector;
}

/**
 * Validated input shape for `get_document_bundle`. Matches the Zod
 * `GetDocumentBundleArgs` schema in `src/tool-registry.ts`.
 */
export interface GetDocumentBundleArgs {
  /** Opaque DocId — `<scheme>://<authority>/<resource>`. */
  doc_id: string;
  /**
   * Depth of the link walk. v2.0.0 accepts ONLY `1`. The Zod schema
   * pins the literal; this field is here for forward compatibility.
   */
  depth?: 1;
  /** Optional vault filter; usually omitted (the DocId names a vault). */
  vaults?: string[];
}

/**
 * Anchor citation packet — full 8-field `CitationPacket` plus the
 * optional ASM-06 denormalized extras (`status`, `superseded_by`).
 * Read from `Document.properties` via the same hydration path Plan
 * 03-05 extends in `search_hybrid` and `recall`.
 */
export type BundleAnchor = CitationPacket & {
  status?: string;
  superseded_by?: string;
};

/**
 * One backlink entry — full citation packet + bundle-specific extras.
 *
 *   - `property_snippet` — first ≤200 chars of the linking doc's
 *                          plain-text body (frontmatter stripped — the
 *                          `Document` shape already separates
 *                          `properties` from `blocks`, so no manual
 *                          frontmatter strip is needed).
 *   - `relation`         — v2.0.0 ships `"wikilink"` only (the v1
 *                          wikilinks table is the only edge source).
 *                          Phase 4 widens to typed edges; the literal
 *                          becomes the actual `Edge.type`.
 *
 * `heading_path` is inherited from `CitationPacket` and is `[]` for
 * document-level links per `<specifics>` (only outline nodes carry a
 * non-empty heading_path).
 */
export type BacklinkEntry = CitationPacket & {
  property_snippet: string;
  relation: "wikilink";
};

/**
 * One forward-link entry — same shape as `BacklinkEntry`. Distinct type
 * alias for clarity at call sites.
 */
export type ForwardLinkEntry = CitationPacket & {
  property_snippet: string;
  relation: "wikilink";
};

/**
 * One row from `recent_edits`. Mapped from `AuditLogEntry`:
 *
 *   - `at`         — epoch ms.
 *   - `op`         — create | update | delete.
 *   - `client_id`  — `null` for user-originated writes, real string
 *                    for agent writes (a sink-route caller plus a
 *                    `client_id` argument to write tools).
 *   - `is_memory_sink_write` — Plan 02-06 (MEM-08) discriminator.
 *                    Surfaced ONLY when `true` (optional field) so the
 *                    bundle wire shape stays compact for the common
 *                    non-memory case.
 *
 * `recent_edits` is keyed by the anchor's CURRENT note path; pre-rename
 * history is not surfaced. See the file header §"Recent-edits
 * rename-history limitation".
 */
export interface BundleRecentEdit {
  at: number;
  op: "create" | "update" | "delete";
  client_id: string | null;
  is_memory_sink_write?: boolean;
}

/**
 * Wire shape of the `get_document_bundle({doc_id})` MCP tool response.
 */
export interface BundleResult {
  anchor: BundleAnchor;
  outline: OutlineNode[];
  backlinks: BacklinkEntry[];
  forward_links: ForwardLinkEntry[];
  recent_edits: BundleRecentEdit[];
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Attach the denormalized `status` / `superseded_by` extras to a base
 * `CitationPacket`. Mirrors the dossier helper (`withDossierExtras`) —
 * same hydration codepath, same result shape on the wire. Reads from
 * the packet's REQUIRED `properties` bag (always populated by
 * `toCitationPacket`).
 *
 * Returns a fresh object; does not mutate the input packet.
 */
function withBundleAnchorExtras(packet: CitationPacket): BundleAnchor {
  const out: BundleAnchor = { ...packet };
  const status = packet.properties.status;
  if (typeof status === "string") out.status = status;
  const supersededBy = packet.properties.superseded_by;
  if (typeof supersededBy === "string") out.superseded_by = supersededBy;
  return out;
}

/**
 * Render a `BlockNode[]` to plain text and truncate to
 * `PROPERTY_SNIPPET_MAX` chars. The `Document` block tree already
 * separates `properties` (frontmatter) from `blocks` (body), so no
 * frontmatter strip is needed — we just project block text.
 *
 * Adapter contract (`bodyShape: "flat-text"`, see
 * `src/adapters/capabilities.ts`): the obsidian-fs adapter emits a
 * single `{kind: "paragraph", text: body}` block, so the common case is
 * trivial. Other block kinds project their `text` / `items` content;
 * `section` blocks recurse into their nested `blocks`. Unknown kinds
 * project as `""` (defensive — the closed union narrows this away at
 * the type level today).
 */
function bodyPlainText(blocks: BlockNode[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case "paragraph":
      case "code":
        parts.push(b.text);
        break;
      case "heading":
        parts.push(b.text);
        break;
      case "list":
        parts.push(b.items.join(" "));
        break;
      case "section":
        // Recurse into the section's nested blocks. The section's own
        // heading is NOT projected here — it lives in `heading_path`,
        // which is presentation metadata, not body content.
        parts.push(bodyPlainText(b.blocks));
        break;
      default:
        // TypeScript narrows away the `default` for the closed union;
        // this is dead-code defense for future widenings.
        break;
    }
  }
  const text = parts.join(" ").trim();
  if (text.length <= PROPERTY_SNIPPET_MAX) return text;
  return text.slice(0, PROPERTY_SNIPPET_MAX);
}

// ─── public entry point ─────────────────────────────────────────────────────

/**
 * Assemble the document bundle for a `doc_id`. See file header for the
 * full algorithm.
 *
 * Throws `DocNotFoundError` (caught by the server dispatch and wrapped
 * into the `{error: "doc_not_found", doc_id}` payload) on:
 *   - Malformed `doc_id`.
 *   - Unknown vault.
 *   - `vaults` filter that excludes the DocId's vault.
 *   - Missing note row (note not indexed, OR deleted between catch-up
 *     and this call).
 *   - SourceConnector read failure on the anchor doc.
 */
export async function getDocumentBundle(
  deps: GetDocumentBundleDeps,
  args: GetDocumentBundleArgs,
): Promise<BundleResult> {
  // 1) Validate-decompose the DocId. `parseDocId` throws on malformed
  //    input — surface as `doc_not_found` (callers gave us a bad id).
  let parsed: { scheme: string; authority: string; resource: string };
  try {
    const docId = parseDocId(args.doc_id);
    parsed = decomposeDocId(docId);
  } catch {
    throw new DocNotFoundError(args.doc_id);
  }
  const { scheme: anchorScheme, authority: vaultName, resource: path } = parsed;

  // Optional vault-filter narrowing. The DocId already names a vault;
  // the filter exists for callers asserting a known tenant boundary.
  if (args.vaults && args.vaults.length > 0 && !args.vaults.includes(vaultName)) {
    throw new DocNotFoundError(args.doc_id);
  }

  // 2) Resolve the Vault. `manager.require` throws on unknown — map to
  //    DocNotFoundError so the wire response is consistent with
  //    get_outline.
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

  // 4) Read the anchor Document via the SourceConnector seam. We use
  //    the canonical packet helper so display-URL resolution matches
  //    recall + the rest of Phase 3 byte-for-byte.
  const source = deps.sourceConnectorFor(vaultName);
  const docId = parseDocId(args.doc_id);
  let anchorDoc: Document;
  try {
    anchorDoc = await source.readDocument(docId);
  } catch {
    throw new DocNotFoundError(args.doc_id);
  }
  const anchorPacket: BundleAnchor = withBundleAnchorExtras(
    toCitationPacket(anchorDoc, displayUrlFor(docId, source)),
  );

  // 5) Build the outline tree via 03-02's helper. Re-use, do NOT
  //    duplicate. Sections are returned in parent-NULL-first order,
  //    and chunks are pre-loaded once for all sections (see
  //    outline.ts §"7-prep" note).
  const sectionRows: SectionRow[] = vault.db.sections.getByNote(noteRow.id);
  const allChunks: ChunkRow[] = vault.db.chunks.getByNote(noteRow.id);
  const outline = buildOutlineTree(sectionRows, allChunks);

  // 6) Read backlinks via the Phase 1 graph layer. In v2.0.0 every
  //    edge in the v1 `wikilinks` table is a wikilink; Phase 4 widens
  //    to typed edges. `listBacklinks` throws if the anchor note is
  //    unindexed — we already verified its existence in step 3, so
  //    any throw here is a genuine race we map to `doc_not_found`.
  let backlinkRows: ReturnType<typeof listBacklinks>;
  try {
    backlinkRows = listBacklinks(vault, path);
  } catch {
    throw new DocNotFoundError(args.doc_id);
  }

  // Hydrate each backlink — read the source `Document` via the
  // SourceConnector (single adapter-seam read), build a citation
  // packet, attach `property_snippet` (first 200 chars of plain-text
  // body) and `relation: "wikilink"`. Stale backlink rows (source
  // file deleted between index and read) are silently dropped — same
  // defensive posture as dossier + recall.
  const backlinks: BacklinkEntry[] = [];
  for (const bl of backlinkRows) {
    const sourceDocId = formatDocId(anchorScheme, vaultName, bl.sourcePath);
    let linkedDoc: Document;
    try {
      linkedDoc = await source.readDocument(sourceDocId);
    } catch {
      continue;
    }
    const packet = toCitationPacket(linkedDoc, displayUrlFor(sourceDocId, source));
    // PHASE-4-WIDEN: v2.0.0 reads from the v1 wikilinks table, which
    // stores only `"wikilink"` edges. When GRA-04 introduces typed
    // edges, this hardcoded literal becomes `edge.type` and the
    // `relation` field on `BacklinkEntry` widens to `EdgeType`.
    backlinks.push({
      ...packet,
      property_snippet: bodyPlainText(linkedDoc.blocks),
      relation: "wikilink" as const,
    });
  }

  // 7) Read forward links via the symmetric graph helper. We pass
  //    `includeBroken: false` because broken links (`resolved: false`)
  //    carry no target note row and cannot be hydrated via the
  //    SourceConnector — there's no document to cite. The user can
  //    still discover broken outbound links via `find_broken_links` /
  //    `list_forward_links`. Phase 4 may surface them as a separate
  //    `broken_forward_links` array if the use case emerges.
  let forwardLinkRows: ReturnType<typeof listForwardLinks>;
  try {
    forwardLinkRows = listForwardLinks(vault, path, /* includeBroken */ false);
  } catch {
    throw new DocNotFoundError(args.doc_id);
  }

  const forward_links: ForwardLinkEntry[] = [];
  for (const fl of forwardLinkRows) {
    const targetDocId = formatDocId(anchorScheme, vaultName, fl.targetPath);
    let linkedDoc: Document;
    try {
      linkedDoc = await source.readDocument(targetDocId);
    } catch {
      continue;
    }
    const packet = toCitationPacket(linkedDoc, displayUrlFor(targetDocId, source));
    forward_links.push({
      ...packet,
      property_snippet: bodyPlainText(linkedDoc.blocks),
      relation: "wikilink" as const,
    });
  }

  // 8) Recent edits — capped at RECENT_EDITS_LIMIT (10). `getAuditLog`
  //    returns entries in DB-default order (newest first by id DESC;
  //    see `src/db/queries/audit.ts` listWrites SQL). Map each entry
  //    onto `BundleRecentEdit`, surfacing only the fields the bundle
  //    documents — keeps the wire shape stable as the underlying
  //    `AuditLogEntry` grows.
  //
  //    Rename-history caveat: `getAuditLog({notePath})` is keyed on
  //    the current note row; pre-rename entries are not surfaced. See
  //    the file header §"Recent-edits rename-history limitation".
  const auditEntries = getAuditLog({
    vault,
    notePath: path,
    limit: RECENT_EDITS_LIMIT,
  });
  const recent_edits: BundleRecentEdit[] = auditEntries.map((e) => {
    const out: BundleRecentEdit = {
      at: e.at,
      op: e.op,
      client_id: e.clientId,
    };
    // Only surface the flag when truthy — keeps the bundle wire
    // shape compact for the common non-memory write case.
    if (e.is_memory_sink_write) out.is_memory_sink_write = true;
    return out;
  });

  // 9) Assemble. The bundle response does NOT carry a top-level
  //    `source_handle` — the anchor citation packet already exposes
  //    it as part of its 8-field shape, and every backlink /
  //    forward-link entry carries its own (same vault in v2.0.0, but
  //    Phase 4 cross-adapter graph walks may surface heterogeneous
  //    source handles).
  return {
    anchor: anchorPacket,
    outline,
    backlinks,
    forward_links,
    recent_edits,
  };
}
