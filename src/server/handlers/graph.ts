/**
 * Graph-domain MCP handler factory.
 *
 * Tools: list_backlinks, list_forward_links, find_broken_links, expand,
 * cluster.
 *
 * Extracted verbatim from the inline `handlers` literal in `src/server.ts`.
 * Behavior-neutral — each arrow wires args to the same graph-layer call.
 *
 * # Adapter-seam discipline
 *
 * No node:path / node:fs / chokidar / gray-matter imports. Source
 * resolution flows through the adapter registry seam.
 */

import { parseDocId, parseSourceHandle } from "../../adapters/registry.js";
import {
  cluster,
  expand,
  listBacklinks,
  listForwardLinks,
  findBrokenLinks,
} from "../../graph/index.js";
import type { ClusterOptions, ExpandDirection, ExpandOptions } from "../../graph/index.js";
import type { EdgeType } from "../../db/queries/edges.js";
import { hybridSearch } from "../../search/index.js";
import { displayUrl } from "../utils.js";
import type { ToolName } from "../../tool-registry.js";
import type { Handler, HandlerDeps } from "../deps.js";

export function makeGraphHandlers(deps: HandlerDeps): Partial<Record<ToolName, Handler>> {
  const { manager, ollama, defaultModel, reranker, adapterRegistry } = deps;
  return {
    list_backlinks: async (a) => {
      const p = a as { vault: string; path: string };
      const vault = manager.require(p.vault);
      return { backlinks: listBacklinks(vault, p.path) };
    },
    list_forward_links: async (a) => {
      const p = a as { vault: string; path: string; include_broken: boolean };
      const vault = manager.require(p.vault);
      return { links: listForwardLinks(vault, p.path, p.include_broken) };
    },
    find_broken_links: async (a) => {
      const p = a as { vault: string };
      const vault = manager.require(p.vault);
      return { broken: findBrokenLinks(vault) };
    },

    // ── Phase 4 graph tools (Plan 04-03 / GRA-01) ─────────────────────────
    expand: async (a) => {
      const p = a as {
        seed_doc_ids: string[];
        hops: 1 | 2;
        direction: ExpandDirection;
        edge_types?: EdgeType[];
        filter_properties?: Record<string, unknown>;
        include_superseded: boolean;
      };
      // Cast incoming validated DocId strings to the branded DocId
      // type via parseDocId; Zod already enforced DOC_ID_PATTERN at
      // the boundary so this is a no-op brand cast at runtime.
      const seeds = p.seed_doc_ids.map((s) => parseDocId(s));
      return expand(
        {
          manager,
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(parseSourceHandle(`obsidian-fs://${vaultName}`)),
        },
        {
          seed_doc_ids: seeds,
          hops: p.hops,
          direction: p.direction,
          ...(p.edge_types !== undefined ? { edge_types: p.edge_types } : {}),
          ...(p.filter_properties !== undefined
            ? { filter_properties: p.filter_properties }
            : {}),
          include_superseded: p.include_superseded,
        } satisfies ExpandOptions,
      );
    },

    // ── Phase 4 graph tools (Plan 04-05 / GRA-02) ─────────────────────────
    cluster: async (a) => {
      const p = a as {
        query?: string;
        seed_doc_ids?: string[];
        vault?: string;
        method: "edge-community";
        query_top_k?: number;
        force?: boolean;
      };
      // Build a ClusterOptions discriminated value. Zod's mutual-
      // exclusion refinement has already rejected both-present /
      // neither-present inputs by the time we reach this handler, but
      // the runtime cluster() function performs the same validation as
      // a defense-in-depth check for direct (non-MCP) callers.
      let opts: ClusterOptions;
      if (p.query !== undefined) {
        // CR-02: propagate `vault` so cluster()'s query path can scope
        // search_hybrid deterministically on multi-vault setups.
        opts = {
          query: p.query,
          method: "edge-community",
          ...(p.vault !== undefined ? { vault: p.vault } : {}),
          ...(p.query_top_k !== undefined ? { query_top_k: p.query_top_k } : {}),
          ...(p.force !== undefined ? { force: p.force } : {}),
        };
      } else {
        const seeds = (p.seed_doc_ids ?? []).map((s) => parseDocId(s));
        opts = {
          seed_doc_ids: seeds,
          method: "edge-community",
          ...(p.force !== undefined ? { force: p.force } : {}),
        };
      }
      return cluster(
        {
          manager,
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(parseSourceHandle(`obsidian-fs://${vaultName}`)),
          // Bind hybridSearch at call time — avoids the
          // src/graph/cluster.ts → src/search/hybrid.ts circular
          // import. The injected callback returns SearchHit[]; the
          // dispatcher already has `ollama` + `defaultModel` in scope.
          hybridSearch: async (vault, query, limit) =>
            hybridSearch({
              query,
              embeddingModel: defaultModel,
              ollama,
              vaults: [vault],
              topK: limit,
              includeBreakdown: false,
              ...(reranker ? { reranker } : {}),
              displayUrlFor: (vaultName, notePath) =>
                displayUrl(adapterRegistry, vaultName, notePath),
            }),
        },
        opts,
      );
    },
  };
}
