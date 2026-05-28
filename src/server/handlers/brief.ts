/**
 * Brief-domain MCP handler factory.
 *
 * Tools: compile_brief, get_brief.
 *
 * Extracted verbatim from the inline `handlers` literal in `src/server.ts`.
 * Behavior-neutral — same brief-controller calls, same post-write
 * suppression bookkeeping.
 *
 * # Adapter-seam discipline
 *
 * No node:path / node:fs / chokidar / gray-matter imports. Brief writes
 * route through the delivery adapter seam; `obsidian-fs://` literals are
 * adapter handle strings, not display URLs.
 */

import { parseSourceHandle } from "../../adapters/registry.js";
import { handleCompileBrief, handleGetBrief } from "../../brief/index.js";
import type { ToolName } from "../../tool-registry.js";
import type { Handler, HandlerDeps } from "../deps.js";

export function makeBriefHandlers(deps: HandlerDeps): Partial<Record<ToolName, Handler>> {
  const { manager, ollama, adapterRegistry, suppression, memorySinkRegistry, server, config } = deps;
  return {
    // ── Phase 5 brief tools (Plan 05-02 / BRF-03, BRF-04) ──────────────────
    compile_brief: async (a) => {
      const p = a as {
        vault: string;
        target: string;
        source_doc_ids: string[];
        purpose: string;
        max_tokens?: number;
        prepared_text?: string;
        sink?: string;
      };
      const result = await handleCompileBrief(
        {
          memorySinkRegistry,
          manager,
          deliveryAdapterFor: (vaultName) =>
            adapterRegistry.resolveDelivery(parseSourceHandle(`obsidian-fs://${vaultName}`)),
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(parseSourceHandle(`obsidian-fs://${vaultName}`)),
          server,
          ollama,
          briefConfig: config.brief,
        },
        p,
      );
      // Suppress watcher events for the soon-to-be-indexed brief +
      // (when D-12 chain fires) the just-updated prior brief.
      if (result.ok) {
        const resource = result.doc_id.replace(`obsidian-fs://${p.vault}/`, "");
        suppression.add(resource);
        if (result.supersededPrior) {
          const oldResource = result.supersededPrior.replace(/^obsidian-fs:\/\/[^/]+\//, "");
          suppression.add(oldResource);
        }
      }
      return result;
    },
    get_brief: async (a) => {
      const p = a as {
        vault: string;
        target: string;
        max_age_days?: number;
        allow_stale?: boolean;
      };
      return handleGetBrief(
        {
          memorySinkRegistry,
          manager,
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(parseSourceHandle(`obsidian-fs://${vaultName}`)),
        },
        p,
      );
    },
  };
}
