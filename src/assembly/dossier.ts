/**
 * `assembleDossier` — the ASM-04 controller.
 *
 * Resolves a `{type, key}` pair to an anchor `Document` and walks its
 * backlinks to produce a `DossierResult`:
 *
 *   - `anchor` — citation packet for the matched document (or `null`
 *     when no doc matches the type+key pair).
 *   - `linked_documents` — citation packets for every document linking
 *     TO the anchor (backlinks), each tagged with `relation: "wikilink"`.
 *     In v2.0.0 the v1 `wikilinks` table only stores wikilink edges; the
 *     `relation` field widens additively in Phase 4 (GRA-04 typed edges).
 *     Search for `PHASE-4-WIDEN` to find the one-line change point.
 *   - `property_rollups` — `{ linked_count, linked_types, status_distribution }`,
 *     aggregated in a single pass over `linked_documents`. Keys missing
 *     from a linked doc's properties are bucketed as `"unknown"`. Counts
 *     are emitted with alphabetically-sorted keys for deterministic
 *     JSON serialization.
 *   - `error` — structured `{ code: "no_matching_anchor_document", type,
 *     key }` when no anchor document matches; `null` on success. This
 *     replaces the "silent empty" anti-pattern (D-04).
 *
 * # Resolution rules
 *
 *   - **Strict `properties.type` match (D-03).** Exact string equality
 *     against `Document.properties.type`. No tag fallback, no case
 *     folding, no synonym expansion.
 *   - **Key matches `title` OR any entry in `properties.aliases`
 *     (D-04).** `aliases` is a `string[]` from frontmatter. The match
 *     is exact-string. Aliases that are not strings are ignored (no
 *     coercion).
 *   - **Deterministic tiebreak** when multiple docs of `type` match a
 *     given key (rare; can happen if two docs share a title): pick the
 *     candidate whose `(title, doc_id)` sorts FIRST lexicographically.
 *     This guarantees determinism across runs and across adapter
 *     implementations.
 *
 * # No status filtering
 *
 * Per the CONTEXT.md §Specifics caveat, dossiers show the WHOLE
 * picture — superseded backlinks DO appear in `linked_documents` with
 * their `status` field populated. Agents that want a status filter
 * apply one client-side over the result; only search applies an
 * implicit `status: "superseded"` hide (recall, D-01).
 *
 * # Adapter-seam discipline (ADR-002 I-1..I-7)
 *
 * The controller is pure: no `node:fs`, no `node:path`, no
 * `gray-matter`, no `chokidar`. All vault content access goes through
 * the injected `SourceConnector` (`readDocument`). Frontmatter reads
 * for the anchor-resolution step go through the `vault.db` query
 * namespace, which holds the already-indexed `notes.frontmatter` JSON
 * blob — that's L0 substrate, owned by the existing indexer.
 *
 * # Performance budget
 *
 * Anchor resolution is O(N) over `notes.frontmatter` rows whose
 * `properties.type === args.type`. The Atlas Robotics fixture is ~75
 * notes; query is sub-millisecond. If real-world dossiers exhibit hot
 * type queries (e.g. `type: "Meeting"` over a vault with thousands of
 * meeting notes), Phase 5 may add a `notes_type` index. Do not
 * pre-optimize.
 */

import { formatDocId } from "../adapters/registry.js";
import type { SourceConnector } from "../adapters/source/types.js";
import { queryFrontmatter } from "../frontmatter/query.js";
import { listBacklinks } from "../graph/graph.js";
import {
  type CitationPacket,
  displayUrlFor,
  toCitationPacket,
  withPropertyExtras,
} from "../memory/citation-packet.js";
import type { Document } from "../types.js";
import type { Vault, VaultManager } from "../vault/index.js";

/**
 * Dossier deps — supplied at server bootstrap. Mirrors the recall
 * controller's seam pattern so the production wiring and unit tests
 * use the same shape.
 */
export interface AssembleDossierDeps {
  /** Vault manager — resolves vault names to `Vault` records. */
  manager: VaultManager;
  /** Resolve the `SourceConnector` instance for a vault name. */
  sourceConnectorFor: (vaultName: string) => SourceConnector;
}

/**
 * Dossier arguments — `{type, key, vaults?}`.
 *
 * `type` is matched exactly against `Document.properties.type`; `key`
 * matches against the candidate's `title` OR any entry in
 * `properties.aliases`. `vaults` optionally narrows the search to a
 * subset of registered vaults; omitting it falls back to "all configured
 * vaults" (mirrors the recall convention).
 */
export interface AssembleDossierArgs {
  type: string;
  key: string;
  vaults?: string[];
}

/**
 * One linked document — a full `CitationPacket` (8 required fields per
 * D-01, properties always populated) plus dossier-specific extras:
 *
 *   - `status` (optional) — denormalized from `properties.status`;
 *     surfaced as a top-level field for agent convenience (saves a
 *     properties lookup in the common case).
 *   - `superseded_by` (optional) — denormalized from
 *     `properties.superseded_by` for the same reason.
 *   - `relation` — edge type. Always `"wikilink"` in v2.0.0 (the v1
 *     wikilinks table is the only edge source); Phase 4 widens to the
 *     full `Edge.type` enum.
 *
 * Intersection (not redefinition) of `CitationPacket` — `linked.properties`
 * is REQUIRED and always a `Record<string, unknown>`, never `undefined`.
 */
export type LinkedDocument = CitationPacket & {
  status?: string;
  superseded_by?: string;
  relation: "wikilink";
};

/**
 * Anchor — citation packet for the resolved document plus the same
 * `status` / `superseded_by` denormalized extras. `null` when no
 * matching anchor was found (see `error`).
 */
export type DossierAnchor = CitationPacket & {
  status?: string;
  superseded_by?: string;
};

export interface DossierError {
  code: "no_matching_anchor_document";
  type: string;
  key: string;
}

/**
 * Structured dossier result. `anchor === null` iff `error !== null`.
 */
export interface DossierResult {
  anchor: DossierAnchor | null;
  linked_documents: LinkedDocument[];
  property_rollups: {
    linked_count: number;
    /** Bucketed by `properties.type` per linked doc. Missing → `"unknown"`. */
    linked_types: Record<string, number>;
    /** Bucketed by `properties.status` per linked doc. Missing → `"unknown"`. */
    status_distribution: Record<string, number>;
  };
  /** `null` on success; structured error code on no-match (D-04). */
  error: DossierError | null;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function emptyResult(args: AssembleDossierArgs): DossierResult {
  return {
    anchor: null,
    linked_documents: [],
    property_rollups: {
      linked_count: 0,
      linked_types: {},
      status_distribution: {},
    },
    error: {
      code: "no_matching_anchor_document",
      type: args.type,
      key: args.key,
    },
  };
}

/**
 * Sort a `Record<string, number>` by key (alphabetical) for
 * deterministic JSON serialization. Returns a fresh object; does not
 * mutate the input.
 */
function sortByKey(counts: Record<string, number>): Record<string, number> {
  const keys = Object.keys(counts).sort();
  const out: Record<string, number> = {};
  for (const k of keys) {
    out[k] = counts[k] as number;
  }
  return out;
}

/**
 * Read aliases from a parsed frontmatter object. Returns the array of
 * string entries (ignoring non-string entries). `null` when the
 * `aliases` key is missing or not an array.
 */
function readAliases(props: Record<string, unknown>): string[] {
  const raw = props.aliases;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === "string") out.push(v);
  }
  return out;
}

/**
 * Sort-key string for the deterministic tiebreak. NOT a real DocId —
 * just a stable, vault-scoped, lex-orderable identifier used inside
 * `findAnchorCandidate` / `findAnchorAcrossVaults`. The scheme prefix
 * is fixed at `"vault"` so the sort key is identical across adapters
 * (sort order is the contract, not the prefix). The actual minted
 * DocId for `readDocument` is derived from the resolving adapter's
 * scheme — see `schemeFromSource` and the call sites in
 * `assembleDossier`.
 */
function noteSortKey(vaultName: string, notePath: string): string {
  return `vault://${vaultName}/${notePath}`;
}

/**
 * Extract the scheme portion of a SourceConnector.handle (e.g.
 * `"obsidian-fs"` from `"obsidian-fs://my-vault"`). Used to mint
 * adapter-correct DocIds in `assembleDossier` per ASM-12 source-
 * neutrality (Phase 3 / 03-07): the stub adapter publishes
 * `stub://memory` and dossier MUST construct linked-document DocIds
 * with the matching scheme so `StubSource.readDocument(id)` resolves.
 * Pre-03-07 the scheme was hardcoded to `"obsidian-fs"` which silently
 * broke non-Obsidian adapters.
 */
function schemeFromSource(source: SourceConnector): string {
  const parts = source.handle.split("://");
  return parts[0] ?? "obsidian-fs";
}

// ─── candidate resolution (anchor) ──────────────────────────────────────────

interface AnchorCandidate {
  vaultName: string;
  notePath: string;
  title: string;
  /** Lex tiebreak key — `<title> <doc_id_string>` for total order. */
  sortKey: string;
}

/**
 * Walk the candidate set returned by `query_frontmatter({type: args.type})`
 * and return the FIRST candidate (per lex tiebreak) whose `title === args.key`
 * OR whose `properties.aliases` contains `args.key`.
 *
 * Returns `null` when no candidate matches. The candidate set is
 * already type-filtered by SQL; this loop is just the key match.
 */
function findAnchorCandidate(vault: Vault, args: AssembleDossierArgs): AnchorCandidate | null {
  // SQL-level type filter via the existing query_frontmatter path.
  // This reads `notes.frontmatter` (JSON column) with JSON1 extract.
  const rows = queryFrontmatter(vault, {
    where: { type: args.type },
    limit: 1000,
  });
  if (rows.length === 0) return null;

  const matches: AnchorCandidate[] = [];
  for (const row of rows) {
    // queryFrontmatter only returns rows with non-null frontmatter, but
    // parse defensively — corrupt JSON has bitten us before.
    let props: Record<string, unknown> = {};
    if (row.frontmatter !== null) {
      try {
        const parsed = JSON.parse(row.frontmatter);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          props = parsed as Record<string, unknown>;
        }
      } catch {
        // Corrupt frontmatter — skip this candidate; do not throw.
        continue;
      }
    }

    const titleMatch = row.title === args.key;
    const aliasMatch = readAliases(props).includes(args.key);
    if (!titleMatch && !aliasMatch) continue;

    matches.push({
      vaultName: vault.config.name,
      notePath: row.path,
      title: row.title,
      sortKey: `${row.title} ${noteSortKey(vault.config.name, row.path)}`,
    });
  }

  if (matches.length === 0) return null;
  // Deterministic tiebreak: sort by (title, doc_id) ASC, take first.
  matches.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  return matches[0] ?? null;
}

/**
 * Across the candidate vault set, find the FIRST anchor by lex
 * tiebreak across all vaults. The cross-vault tiebreak uses the same
 * `(title, doc_id)` rule — the `doc_id` carries the vault name as the
 * authority, so cross-vault ordering is well-defined.
 */
function findAnchorAcrossVaults(
  vaults: Vault[],
  args: AssembleDossierArgs,
): AnchorCandidate | null {
  const matches: AnchorCandidate[] = [];
  for (const vault of vaults) {
    const c = findAnchorCandidate(vault, args);
    if (c) matches.push(c);
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  return matches[0] ?? null;
}

// ─── public entry point ─────────────────────────────────────────────────────

/**
 * Resolve a `{type, key}` pair to a structured dossier. See the file
 * header for the full algorithm.
 */
export async function assembleDossier(
  deps: AssembleDossierDeps,
  args: AssembleDossierArgs,
): Promise<DossierResult> {
  // 1) Build the candidate vault list. Throws on unknown vault names
  //    — the server wraps the exception in errorResponse() at the
  //    dispatch boundary.
  const vaults: Vault[] = [];
  if (args.vaults && args.vaults.length > 0) {
    for (const name of args.vaults) {
      vaults.push(deps.manager.require(name));
    }
  } else {
    for (const v of deps.manager.list()) {
      vaults.push(v);
    }
  }
  if (vaults.length === 0) return emptyResult(args);

  // 2) Resolve the anchor (type-match + key-match, deterministic
  //    tiebreak across all candidate vaults).
  const anchorCandidate = findAnchorAcrossVaults(vaults, args);
  if (anchorCandidate === null) return emptyResult(args);

  // 3) Hydrate the anchor Document via the SourceConnector seam.
  const anchorVault = vaults.find((v) => v.config.name === anchorCandidate.vaultName);
  if (anchorVault === undefined) return emptyResult(args);
  const anchorSource = deps.sourceConnectorFor(anchorCandidate.vaultName);
  // ASM-12 source-neutrality: derive scheme from the resolving adapter's
  // handle so non-Obsidian connectors (stub, future Notion) produce
  // adapter-correct DocIds rather than always emitting 'obsidian-fs://'.
  const anchorScheme = schemeFromSource(anchorSource);
  const anchorDocId = formatDocId(
    anchorScheme,
    anchorCandidate.vaultName,
    anchorCandidate.notePath,
  );
  let anchorDoc: Document;
  try {
    anchorDoc = await anchorSource.readDocument(anchorDocId);
  } catch {
    // The candidate row was indexed, but the file was deleted between
    // index and assembly. Treat as no-match — the structured error
    // surfaces "no anchor document" honestly without exposing the race.
    return emptyResult(args);
  }
  const anchorPacket: DossierAnchor = withPropertyExtras(
    toCitationPacket(anchorDoc, displayUrlFor(anchorDocId, anchorSource)),
  );

  // 4) Read backlinks via the Phase 1 graph layer. `listBacklinks`
  //    looks the note up by path inside the anchor's vault, then walks
  //    the v1 `wikilinks` table for source notes pointing to it. In
  //    v2.0.0 every edge in that table is a wikilink; Phase 4 will
  //    widen the surface to typed edges.
  let backlinkRows: ReturnType<typeof listBacklinks>;
  try {
    backlinkRows = listBacklinks(anchorVault, anchorCandidate.notePath);
  } catch {
    // listBacklinks throws if the note isn't indexed — same race
    // window as the readDocument try/catch above. Surface no-match.
    return emptyResult(args);
  }

  // 5) Hydrate each backlink: read the source Document via the
  //    SourceConnector, build a citation packet, attach
  //    `relation: "wikilink"` plus the denormalized extras.
  const linkedDocuments: LinkedDocument[] = [];
  for (const bl of backlinkRows) {
    const linkedDocId = formatDocId(anchorScheme, anchorCandidate.vaultName, bl.sourcePath);
    let linkedDoc: Document;
    try {
      linkedDoc = await anchorSource.readDocument(linkedDocId);
    } catch {
      // A stale backlink (source file deleted between index and read)
      // is harmless; silently drop. Same defensive posture as recall.
      continue;
    }
    const packet: CitationPacket = toCitationPacket(
      linkedDoc,
      displayUrlFor(linkedDocId, anchorSource),
    );
    const withExtras = withPropertyExtras(packet);
    // PHASE-4-WIDEN: v2.0.0 reads from the v1 wikilinks table, which
    // stores only `"wikilink"` edges. When GRA-04 introduces typed
    // edges, this hardcoded literal becomes `edge.type` and the
    // `relation` field in `LinkedDocument` widens to `EdgeType`.
    linkedDocuments.push({
      ...withExtras,
      relation: "wikilink" as const,
    });
  }

  // 6) Compute rollups in a single pass. Keys are sorted
  //    alphabetically before return for deterministic JSON output.
  const linked_types: Record<string, number> = {};
  const status_distribution: Record<string, number> = {};
  for (const linked of linkedDocuments) {
    const type = typeof linked.properties.type === "string" ? linked.properties.type : "unknown";
    linked_types[type] = (linked_types[type] ?? 0) + 1;
    const status =
      typeof linked.properties.status === "string" ? linked.properties.status : "unknown";
    status_distribution[status] = (status_distribution[status] ?? 0) + 1;
  }

  return {
    anchor: anchorPacket,
    linked_documents: linkedDocuments,
    property_rollups: {
      linked_count: linkedDocuments.length,
      linked_types: sortByKey(linked_types),
      status_distribution: sortByKey(status_distribution),
    },
    error: null,
  };
}
