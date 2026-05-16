/**
 * Phase 3 — `src/assembly/` canonical types.
 *
 * This module hosts the type-level surface that the assembly layer
 * (`get_outline`, `get_bundle`, `dossier`, …) exposes to the rest of
 * the codebase. Adapter-seam discipline (enforced by
 * `scripts/lint-adapters.sh`) applies: nothing under `src/assembly/`
 * imports `fs`, `gray-matter`, `chokidar`, or `path.*`.
 *
 * Locked shapes (per 03-CONTEXT.md):
 *   - D-02: `OutlineNode` carries `anchor`, `heading_path`,
 *     `heading_text`, `level`, `chunk_ids`, and recursive `children`.
 *   - ASM-02: the `get_outline` tool returns the nested tree.
 *   - ASM-05 (section half): `anchor` + `heading_path` form the
 *     section-level citation token consumed by downstream tools.
 *
 * `OutlineResult` is the wire shape of the `get_outline` MCP tool —
 * the document-level citation packet (subset of D-01) plus the
 * `root: OutlineNode[]` tree. Field names mirror the citation packet
 * (`source_handle`, `display_url`) so callers can interleave outline
 * nodes and recall packets without translation glue.
 */

import type { DocId, SourceHandle } from "../types.js";

/**
 * One node in the outline tree. Recursive shape — `children` carries
 * deeper sections in DFS-order. A leaf section has `children: []`.
 *
 *   - `anchor`        — content-hash anchor (ADR-003 H-7); section identity.
 *   - `heading_path`  — root → leaf heading texts, inclusive of this section.
 *   - `heading_text`  — the leaf heading (or `""` for the level-0 preamble).
 *   - `level`         — 0 = preamble; 1..6 = heading level.
 *   - `chunk_ids`     — v1 chunk-table IDs inclusively in this section
 *                        (empty array when the section has no body).
 *                        Strings, not numbers, because callers treat them
 *                        as opaque tokens (consistent with the v1
 *                        connector ecosystem's `id` conventions).
 */
export interface OutlineNode {
  anchor: string;
  heading_path: string[];
  heading_text: string;
  level: number;
  chunk_ids: string[];
  children: OutlineNode[];
}

/**
 * Wire shape of the `get_outline({doc_id})` MCP tool response.
 *
 *   - `doc_id`        — opaque DocId (echoed back for caller correlation).
 *   - `source_handle` — adapter handle that minted the doc (e.g.
 *                       `obsidian-fs://my-vault`).
 *   - `title`         — document title (from `Document.title`).
 *   - `root`          — top-level outline nodes; nested via `children`.
 *   - `mtime`         — document mtime (epoch ms; from `Document.mtime`).
 *   - `hash`          — document content hash (from `Document.hash`).
 *   - `display_url`   — adapter-provided deep-link URL (D-01).
 */
export interface OutlineResult {
  doc_id: DocId;
  source_handle: SourceHandle;
  title: string;
  root: OutlineNode[];
  mtime: number;
  hash: string;
  display_url: string;
}

/**
 * Validated input shape for `get_outline`. Matches the Zod
 * `GetOutlineArgs` schema in `src/tool-registry.ts`.
 */
export interface GetOutlineArgs {
  /** Opaque DocId — `<scheme>://<authority>/<resource>`. */
  doc_id: string;
  /** Optional vault filter; usually omitted (the DocId already names a vault). */
  vaults?: string[];
}
