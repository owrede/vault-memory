/**
 * Memory-domain MCP handler factory.
 *
 * Tools: record_observation, supersede, recall.
 *
 * Extracted verbatim from the inline `handlers` literal in `src/server.ts`.
 * Behavior-neutral — each arrow wires args to the same memory-tool call and
 * applies the same post-write suppression bookkeeping.
 *
 * # Adapter-seam discipline
 *
 * No node:path / node:fs / chokidar / gray-matter imports. Memory writes
 * route through the delivery adapter seam; the `obsidian-fs://` handle
 * literals are adapter handle strings (not display URLs), used to resolve
 * the delivery/source connectors via the registry.
 */

import { parseSourceHandle } from "../../adapters/registry.js";
import { handleRecall, handleRecordObservation, handleSupersede } from "../../memory/tools/index.js";
import { hybridSearch } from "../../search/index.js";
import type { ToolName } from "../../tool-registry.js";
import type { Handler, HandlerDeps } from "../deps.js";

export function makeMemoryHandlers(deps: HandlerDeps): Partial<Record<ToolName, Handler>> {
  const { manager, ollama, defaultModel, adapterRegistry, suppression, memorySinkRegistry } = deps;
  return {
    // ── Phase 2 memory tools (Plan 02-04) ──────────────────────────────────
    record_observation: async (a) => {
      const p = a as {
        vault: string;
        claim: string;
        evidence: string[];
        confidence: "direct" | "inferred" | "uncertain";
        type: string;
        sink?: string;
        properties?: Record<string, unknown>;
      };
      // Suppress the watcher event for the soon-to-be-written file.
      // We don't know the exact filename yet (controller mints it), so
      // suppress the observations/ folder path prefix; the watcher's
      // suppression set tolerates fuzzy matches via the TTL.
      const result = await handleRecordObservation(
        {
          memorySinkRegistry,
          manager,
          deliveryAdapterFor: (vaultName) =>
            adapterRegistry.resolveDelivery(parseSourceHandle(`obsidian-fs://${vaultName}`)),
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(parseSourceHandle(`obsidian-fs://${vaultName}`)),
        },
        p,
      );
      // After the write, suppress the watcher event using the minted
      // DocId so live-indexing doesn't re-fire on our own write.
      if (result.ok) {
        const resource = result.doc_id.replace(`obsidian-fs://${p.vault}/`, "");
        suppression.add(resource);
      }
      return result;
    },
    supersede: async (a) => {
      const p = a as {
        doc_id: string;
        replacement_doc_id: string;
        reason: string;
      };
      const result = await handleSupersede(
        {
          memorySinkRegistry,
          manager,
          deliveryAdapterFor: (vaultName) =>
            adapterRegistry.resolveDelivery(parseSourceHandle(`obsidian-fs://${vaultName}`)),
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(parseSourceHandle(`obsidian-fs://${vaultName}`)),
        },
        p,
      );
      if (result.ok) {
        const resource = result.doc_id.replace(/^obsidian-fs:\/\/[^/]+\//, "");
        suppression.add(resource);
      }
      return result;
    },

    // ── Phase 2 memory tools (Plan 02-05) ──────────────────────────────────
    recall: async (a) => {
      const p = a as {
        query: string;
        min_confidence?: "direct" | "inferred" | "uncertain";
        types?: string[];
        max_age_days?: number;
        sink?: string;
        limit?: number;
        vaults?: string[];
      };
      const packets = await handleRecall(
        {
          memorySinkRegistry,
          manager,
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(parseSourceHandle(`obsidian-fs://${vaultName}`)),
          searchHybrid: async (input) =>
            hybridSearch({
              query: input.query,
              embeddingModel: defaultModel,
              ollama,
              vaults: input.vaults,
              topK: input.topK,
              rrfK: 60,
              includeBreakdown: false,
            }),
        },
        p,
      );
      return { packets, count: packets.length };
    },
  };
}
