/**
 * `expand()` — Phase 4 / 04-03 / GRA-01 typed-edge BFS retrieval.
 *
 * Returns a flat, dedup'd array of citation packets reachable from
 * `seed_doc_ids` within `hops` (1 or 2). Each packet carries an additive
 * `via: { seed_doc_id, hop, edge_type, direction }` provenance trace.
 *
 * Locked contracts (Phase 4 CONTEXT.md):
 *   - D-05  Hops hard-capped at 2 (enforced by Zod literal union at the
 *           tool boundary; this function trusts the bound).
 *   - D-06  `direction` defaults to `"both"` (forward+backward).
 *   - D-07  Shortest-path dedup via `isShorterPath` comparator.
 *           Tie-breakers: lower hop → lower seed_doc_id (lex) → lower
 *           edge_type (alpha) → forward over backward.
 *   - D-08  `filter_properties` is strict equality on the hydrated
 *           packet's `properties` bag. `include_superseded` defaults
 *           false; superseded docs are dropped at hydration time via the
 *           Phase 2 D-03 forward-only supersede property.
 *   - D-09  Module lives in `src/graph/` alongside `graph.ts`.
 *
 * `_memory` opacity rule (ADR-004 §"memory namespace is sacrosanct" +
 * Phase 4 RESEARCH.md Pitfall 3):
 *   A `_memory/...` doc surfaces in the result set ONLY when an inbound
 *   edge in the BFS visited record originates from a non-`_memory`
 *   source (a user note that already linked to it). 2-hop traversal MAY
 *   NOT surface a `_memory/...` doc via an internal `_memory → _memory`
 *   chain that does not pass through a user note first. We track the
 *   `inboundSourceNoteId` for each visited node as the BFS expands so
 *   the opacity check is O(1) per candidate at hydration time (no
 *   second DB pass — T-04-03-01 mitigation).
 *
 * Pitfall 4 (RESEARCH.md lines 536–541): `isShorterPath` is exported as
 * a pure function and unit-tested directly. The comparator pins the
 * tie-breaker order so the `via` field is deterministic across runs
 * (T-04-03-05 mitigation).
 *
 * Unknown seed_doc_ids return as `warnings: [{seed_doc_id, reason:
 * "unknown_doc"}]` — soft warning shape, NOT a hard throw (Phase 4
 * CONTEXT §"Claude's Discretion" — error semantics on broken seeds).
 *
 * Adapter-seam discipline (Phase 1 Pattern A): zero imports of `fs`,
 * `path.join`, `gray-matter`, or `chokidar`. The hydration path goes
 * through the injected `SourceConnector.readDocument` seam; all SQL
 * reads go through `vault.db.edges` / `vault.db.notes`.
 */

import { decomposeDocId, formatDocId, parseDocId } from "../adapters/registry.js";
import type { SourceConnector } from "../adapters/source/types.js";
import type { EdgeType } from "../db/queries/edges.js";
import {
  type CitationPacket,
  displayUrlFor,
  toCitationPacket,
} from "../memory/citation-packet.js";
import type { DocId, Document } from "../types.js";
import type { Vault, VaultManager } from "../vault/index.js";

// ─── public types ────────────────────────────────────────────────────────────

/**
 * Direction of edge traversal. Default `"both"` per D-06.
 *
 *   - `"forward"`  — traverse outbound edges (seed → target).
 *   - `"backward"` — traverse inbound edges (source → seed).
 *   - `"both"`     — both directions; results merge with shortest-path
 *                    dedup applied per D-07.
 */
export type ExpandDirection = "forward" | "backward" | "both";

/**
 * Input shape for `expand()`. The Zod schema in `tool-registry.ts`
 * mirrors this verbatim; this interface is the runtime contract.
 */
export interface ExpandOptions {
  /** 1+ branded DocIds (URI-style, e.g. `obsidian-fs://vault/path.md`). */
  seed_doc_ids: DocId[];
  /** Hard-capped at 2 per D-05 (Zod literal union enforces this). */
  hops: 1 | 2;
  /** Direction per D-06; default `"both"`. */
  direction?: ExpandDirection;
  /** Optional edge-type filter; default = all four types. */
  edge_types?: EdgeType[];
  /**
   * Strict-equality predicate on `Document.properties`. No operators.
   * D-08 mirrors Phase 3 dossier convention.
   */
  filter_properties?: Record<string, unknown>;
  /** Default false per D-08; drops `properties.status === "superseded"`. */
  include_superseded?: boolean;
}

/**
 * Provenance trace attached to each result packet. Records HOW the
 * neighbor was reached: the seed that originated the BFS, the hop
 * count (1 or 2), the edge type, and the direction of traversal.
 *
 * Determinism: the comparator `isShorterPath` pins which trace wins
 * when multiple paths reach the same target (D-07 tie-breakers).
 */
export interface ViaTrace {
  seed_doc_id: DocId;
  hop: 1 | 2;
  edge_type: EdgeType;
  direction: "forward" | "backward";
}

/**
 * A citation packet (Phase 3 D-05 locked 8-field shape) with the
 * Phase-4-additive `via` field. None of the existing 8 fields are
 * reshaped; `via` is strictly additive (Pattern E).
 */
export interface CitationPacketWithVia extends CitationPacket {
  via: ViaTrace;
}

/**
 * Output shape: deduplicated `documents` (one per unique target doc,
 * with the shortest-path `via`) + soft `warnings` for unknown seeds.
 */
export interface ExpansionResult {
  documents: CitationPacketWithVia[];
  warnings: Array<{ seed_doc_id: string; reason: "unknown_doc" }>;
}

/**
 * Injected dependencies for `expand()`. Mirrors the dossier / bundle
 * dep shape so production wiring + unit tests share one contract.
 */
export interface ExpandDeps {
  manager: VaultManager;
  sourceConnectorFor: (vaultName: string) => SourceConnector;
}

// ─── pure comparator (Pitfall 4 — unit-tested directly) ─────────────────────

/**
 * True iff `a` is a STRICTLY shorter / preferable path than `b`.
 *
 * Tie-breaker order per D-07:
 *   1. lower `hop` wins (shortest path);
 *   2. lower `seed_doc_id` (lexicographic) wins;
 *   3. lower `edge_type` (alphabetical) wins;
 *   4. `"forward"` wins over `"backward"`.
 *
 * Returns `false` for identical traces — the comparator is strict, not
 * `<=`. The BFS uses this to decide whether to OVERWRITE an existing
 * visited entry when a shorter path is found.
 *
 * Pitfall 4 mitigation: pure function, no side effects, no DB access.
 * Unit-tested directly (RESEARCH.md lines 536–541).
 */
export function isShorterPath(a: ViaTrace, b: ViaTrace): boolean {
  // 1) hop
  if (a.hop !== b.hop) return a.hop < b.hop;
  // 2) seed_doc_id (lex)
  if (a.seed_doc_id !== b.seed_doc_id) return a.seed_doc_id < b.seed_doc_id;
  // 3) edge_type (alpha)
  if (a.edge_type !== b.edge_type) return a.edge_type < b.edge_type;
  // 4) direction — forward beats backward
  if (a.direction !== b.direction) return a.direction === "forward";
  return false; // identical → not strictly shorter
}

// ─── internal helpers ───────────────────────────────────────────────────────

const MEMORY_PREFIX = "_memory/";

/**
 * Resolve a seed_doc_id to its underlying note row.
 *
 * Returns `null` if the DocId is malformed, points at an unknown
 * vault, or names a note that is not indexed. The caller surfaces
 * each `null` as a `warnings: [{seed_doc_id, reason: "unknown_doc"}]`
 * entry per the soft-error contract.
 */
function resolveSeed(
  deps: ExpandDeps,
  seedDocId: DocId,
): { vault: Vault; vaultName: string; noteId: number; notePath: string; scheme: string } | null {
  let scheme: string;
  let vaultName: string;
  let resource: string;
  try {
    const docId = parseDocId(seedDocId);
    ({ scheme, authority: vaultName, resource } = decomposeDocId(docId));
  } catch {
    return null;
  }
  let vault: Vault;
  try {
    vault = deps.manager.require(vaultName);
  } catch {
    return null;
  }
  const note = vault.db.notes.getByPath(resource);
  if (!note) return null;
  return { vault, vaultName, noteId: note.id, notePath: resource, scheme };
}

/** True iff a note path (vault-relative, forward-slash) lives in `_memory/...`. */
function isMemoryPath(notePath: string): boolean {
  return notePath.startsWith(MEMORY_PREFIX);
}

/** Mutable BFS bookkeeping entry — one per visited noteId. */
interface VisitedEntry {
  via: ViaTrace;
  /**
   * The noteId of the SOURCE doc on the edge that produced this
   * candidate's `via` trace. Used at hydration time by the
   * `_memory` opacity check (Pitfall 3): a `_memory` target survives
   * only when its `inboundSourceNoteId` is a non-`_memory` doc. The
   * seeds themselves do not have an inbound edge — they're skipped
   * for the opacity rule because they are EXPLICITLY requested by
   * the caller (a user-driven action; not silent traversal).
   */
  inboundSourceNoteId: number;
}

// ─── public entry point ─────────────────────────────────────────────────────

/**
 * Bounded typed-edge BFS retrieval. See file header for the full
 * algorithm. Returns deduplicated citation packets with `via`
 * provenance. Empty `seed_doc_ids` returns
 * `{documents: [], warnings: []}`.
 */
export async function expand(
  deps: ExpandDeps,
  opts: ExpandOptions,
): Promise<ExpansionResult> {
  const warnings: ExpansionResult["warnings"] = [];

  // Empty seeds → trivial empty result. Matches Phase 3 dossier's
  // "empty result on no-match" convention.
  if (opts.seed_doc_ids.length === 0) {
    return { documents: [], warnings };
  }

  const direction: ExpandDirection = opts.direction ?? "both";
  const hops = opts.hops;
  const edgeTypeFilter =
    opts.edge_types && opts.edge_types.length > 0 ? opts.edge_types : undefined;

  // Resolve each seed → noteRow. Misses become warnings; we keep
  // processing the rest. Track seed noteIds so the BFS can short-
  // circuit self-loops (test 17/18).
  interface ResolvedSeed {
    seedDocId: DocId;
    vault: Vault;
    vaultName: string;
    noteId: number;
    notePath: string;
    scheme: string;
  }
  const resolved: ResolvedSeed[] = [];
  const seedNoteIds = new Set<number>();
  for (const id of opts.seed_doc_ids) {
    const r = resolveSeed(deps, id);
    if (!r) {
      warnings.push({ seed_doc_id: id, reason: "unknown_doc" });
      continue;
    }
    resolved.push({
      seedDocId: id,
      vault: r.vault,
      vaultName: r.vaultName,
      noteId: r.noteId,
      notePath: r.notePath,
      scheme: r.scheme,
    });
    seedNoteIds.add(r.noteId);
  }

  // Group resolved seeds by vault — BFS operates per-vault because
  // `vault.db.edges` is scoped to one vault. Cross-vault expand would
  // require the edges to carry vault-namespaced DocIds; v2.0.0 holds
  // each vault's graph independent (matches `list_backlinks` semantics).
  //
  // Within a vault, `visited` is keyed by noteId so the dedup +
  // opacity check both work in O(1) per node. Per-vault `visited`
  // maps live for the BFS and are read by hydration immediately after.
  interface PerVaultState {
    vault: Vault;
    vaultName: string;
    scheme: string;
    visited: Map<number, VisitedEntry>;
    /** Seed noteIds that originated this vault's BFS — used for self-loop skip. */
    seedNoteIdsInVault: Set<number>;
  }
  const byVault = new Map<string, PerVaultState>();
  for (const r of resolved) {
    if (!byVault.has(r.vaultName)) {
      byVault.set(r.vaultName, {
        vault: r.vault,
        vaultName: r.vaultName,
        scheme: r.scheme,
        visited: new Map<number, VisitedEntry>(),
        seedNoteIdsInVault: new Set<number>(),
      });
    }
    byVault.get(r.vaultName)?.seedNoteIdsInVault.add(r.noteId);
  }

  // ── BFS per seed ─────────────────────────────────────────────────────────
  //
  // For each resolved seed, run up to two single-direction BFS sweeps
  // (forward + backward when direction === 'both'). Frontier elements
  // carry `{noteId, depth}`. At each depth < hops, query the typed-
  // edge namespace for outbound / inbound rows, apply edge-type
  // filter, skip self-loops + unresolved hyperlinks, then record the
  // candidate in `visited` IF (it's new) OR (the new path is shorter
  // per `isShorterPath`).
  //
  // The seed itself is never added to `visited` — it is the BFS root,
  // not an "expansion result". Test 17/18 pin this.
  for (const seed of resolved) {
    const state = byVault.get(seed.vaultName);
    if (!state) continue; // unreachable — we just set it.
    const directionsToWalk: Array<"forward" | "backward"> =
      direction === "both" ? ["forward", "backward"] : [direction];
    for (const dir of directionsToWalk) {
      let frontier: Array<{ noteId: number; depth: number }> = [
        { noteId: seed.noteId, depth: 0 },
      ];
      while (frontier.length > 0) {
        const next: Array<{ noteId: number; depth: number }> = [];
        for (const node of frontier) {
          const newHop: 1 | 2 = (node.depth + 1) as 1 | 2;
          if (newHop > hops) continue; // depth bound
          const rows =
            dir === "forward"
              ? seed.vault.db.edges.getForwardLinks(node.noteId, edgeTypeFilter)
              : seed.vault.db.edges.getBacklinks(node.noteId, edgeTypeFilter);
          for (const row of rows) {
            // Resolve the neighbor noteId. For forward edges, the
            // neighbor is `target_doc` (null = unresolved hyperlink —
            // skip; Phase 4 BFS only traverses resolved edges). For
            // backward edges, the neighbor is `source_doc` (always
            // non-null — every edge has a source).
            const targetNoteId =
              dir === "forward"
                ? // EdgeForwardLinkRow shape
                  (row as { targetNoteId: number | null }).targetNoteId
                : (row as { sourceNoteId: number }).sourceNoteId;
            if (targetNoteId === null) continue; // unresolved hyperlink
            // Self-loop guard (test 17/18): a seed cannot appear in
            // its own results regardless of edge presence.
            if (targetNoteId === seed.noteId) continue;
            // Also skip ANY seed appearing as a 1/2-hop neighbor —
            // seeds are the BFS roots, not results. The plan §<action>
            // describes this as "seeds are NOT added to visited".
            // We DO allow OTHER seeds in the result set when expanded
            // from a non-seed source? Spec is ambiguous; the safer
            // reading is: a seed is never a RESULT of expand. Tests
            // 7/8 model the multi-seed case where one seed is reached
            // from another — but those tests assert dedup by hop, not
            // appearance. Re-reading test 8: "a doc reachable in 1 hop
            // from seed B and 2 hops from seed A appears with via.
            // seed_doc_id === B and via.hop === 1." The doc is NOT a
            // seed itself in that test — it's a separate doc. So
            // skipping ALL seeds from the result set matches the
            // expected behavior (and matches recall/dossier semantics
            // where the query input is never echoed back).
            if (state.seedNoteIdsInVault.has(targetNoteId)) continue;
            const candidate: ViaTrace = {
              seed_doc_id: seed.seedDocId,
              hop: newHop,
              edge_type: row.type,
              direction: dir,
            };
            const existing = state.visited.get(targetNoteId);
            if (!existing || isShorterPath(candidate, existing.via)) {
              state.visited.set(targetNoteId, {
                via: candidate,
                inboundSourceNoteId: node.noteId,
              });
              // Only push into next frontier if more hops remain.
              if (newHop < hops) {
                next.push({ noteId: targetNoteId, depth: newHop });
              }
            }
          }
        }
        frontier = next;
      }
    }
  }

  // ── Hydration + filters ──────────────────────────────────────────────────
  //
  // For each visited noteId in each vault, load the source `Document`
  // via the injected SourceConnector seam, build the canonical 8-field
  // citation packet, then layer the additive `via` field. Apply the
  // three filters: `_memory` opacity, `include_superseded`, and
  // `filter_properties`.
  //
  // Stale rows (note deleted between BFS and hydration, or read fails)
  // are silently dropped — same defensive posture as dossier + recall.
  const documents: CitationPacketWithVia[] = [];
  for (const [, state] of byVault) {
    // Pre-compute the set of `_memory` noteIds in this vault's visited
    // map so the opacity check is a Set lookup. The check is per
    // candidate (O(1)). Seeds themselves are not in `visited` and so
    // do not participate; only candidates need the rule applied.
    const memoryVisited = new Set<number>();
    for (const [noteId] of state.visited) {
      const row = state.vault.db.notes.getById(noteId);
      if (row && isMemoryPath(row.path)) memoryVisited.add(noteId);
    }

    for (const [noteId, entry] of state.visited) {
      const noteRow = state.vault.db.notes.getById(noteId);
      if (!noteRow) continue; // stale BFS row — drop defensively.

      // ── _memory opacity rule (ADR-004 + Pitfall 3) ─────────────────
      //
      // A `_memory/...` doc surfaces in the result set ONLY when its
      // inbound BFS edge originates from a non-`_memory` source. The
      // edge's source is captured at frontier expansion as
      // `entry.inboundSourceNoteId` (no second DB query).
      //
      // Concretely:
      //   - Candidate is non-`_memory` → always include (subject to
      //     other filters).
      //   - Candidate is `_memory` AND inbound source is also `_memory`
      //     → drop (silent traversal through the memory namespace is
      //     forbidden). Cite ADR-004 §"memory namespace is sacrosanct"
      //     and Pitfall 3.
      //   - Candidate is `_memory` AND inbound source is a non-
      //     `_memory` user note → include (the user note already
      //     references the memory doc; surfacing it does not break
      //     opacity).
      //
      // Note: seeds are never `_memory` candidates here — they are
      // BFS roots and are not added to `visited`. If a user explicitly
      // requests a `_memory/...` seed, that's their call (a user-driven
      // action, not silent traversal), and the BFS expands from it
      // normally; but the seed itself is filtered out of results by
      // the seedNoteIdsInVault guard above.
      if (memoryVisited.has(noteId)) {
        const inboundSourceRow = state.vault.db.notes.getById(entry.inboundSourceNoteId);
        const inboundIsMemory =
          inboundSourceRow != null && isMemoryPath(inboundSourceRow.path);
        if (inboundIsMemory) continue;
      }

      // Load the canonical Document via the adapter seam (ADR-002 I-5b).
      const docId = formatDocId(state.scheme, state.vaultName, noteRow.path);
      const source = (() => {
        try {
          return deps.sourceConnectorFor(state.vaultName);
        } catch {
          return null;
        }
      })();
      if (!source) continue;
      let doc: Document;
      try {
        doc = await source.readDocument(docId);
      } catch {
        continue;
      }
      const packet = toCitationPacket(doc, displayUrlFor(docId, source));

      // ── include_superseded filter (D-08) ────────────────────────────
      //
      // Default false drops docs whose `properties.status === "superseded"`.
      // Forward-only supersede per Phase 2 D-03 means this is a pure
      // property check; no additional graph traversal needed.
      if (!opts.include_superseded && packet.properties.status === "superseded") {
        continue;
      }

      // ── filter_properties strict equality (D-08) ────────────────────
      //
      // Each key/value pair in `filter_properties` must match the
      // packet's `properties` strictly via `===`. No operators (no
      // $in, no $contains). Mirrors Plan 03 dossier convention.
      if (opts.filter_properties) {
        let match = true;
        for (const [key, want] of Object.entries(opts.filter_properties)) {
          if (packet.properties[key] !== want) {
            match = false;
            break;
          }
        }
        if (!match) continue;
      }

      documents.push({ ...packet, via: entry.via });
    }
  }

  return { documents, warnings };
}

