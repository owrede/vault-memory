/**
 * Assembly-domain MCP handler factory.
 *
 * Tools: get_outline, search_sections, assemble_dossier, get_document_bundle.
 *
 * Extracted verbatim from the inline `handlers` literal in `src/server.ts`.
 * Behavior-neutral — each arrow wires args to the same assembly-controller
 * call with the same injected seam closures.
 *
 * # Adapter-seam discipline
 *
 * No node:path / node:fs / chokidar / gray-matter imports. All document
 * reads + display-URL minting flow through the adapter registry seam.
 */

import { formatDocId, parseSourceHandle } from "../../adapters/registry.js";
import { getOutline } from "../../assembly/outline.js";
import { searchSections } from "../../assembly/search-sections.js";
import { assembleDossier, getDocumentBundle } from "../../assembly/index.js";
import { hybridSearch } from "../../search/index.js";
import type { Vault } from "../../vault/index.js";
import type { ToolName } from "../../tool-registry.js";
import type { Handler, HandlerDeps } from "../deps.js";

export function makeAssemblyHandlers(deps: HandlerDeps): Partial<Record<ToolName, Handler>> {
  const { manager, ollama, defaultModel, adapterRegistry } = deps;
  return {
    // ── Phase 3 assembly tools (Plan 03-02 / ASM-02) ───────────────────────
    get_outline: async (a) => {
      const p = a as { doc_id: string; vaults?: string[] };
      return getOutline(
        {
          manager,
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(parseSourceHandle(`obsidian-fs://${vaultName}`)),
        },
        p,
      );
    },

    // ── Phase 3 assembly tools (Plan 03-03) ──────────────────────────────────
    search_sections: async (a) => {
      const p = a as {
        query: string;
        limit?: number;
        vaults?: string[];
        recency_weight?: number;
        authority_weight?: number;
        include_superseded?: boolean;
      };
      // Resolve target vaults: callers may scope to a subset; default to
      // all configured vaults (mirrors search_hybrid's behavior).
      const allVaults = manager.list();
      const targetVaults: Vault[] = p.vaults
        ? p.vaults.map((name) => manager.require(name))
        : allVaults;

      const results = await searchSections(
        {
          searchHybrid: async (input) =>
            hybridSearch({
              query: input.query,
              embeddingModel: defaultModel,
              ollama,
              vaults: input.vaults
                ? input.vaults.map((name) => manager.require(name))
                : targetVaults,
              topK: input.topK,
              rrfK: 60,
              includeBreakdown: false,
            }),
          sectionForHit: (vaultName, notePath, chunkIdx) => {
            // Look up via the originating vault's DB. The mapping is
            // (notePath → noteId) → (noteId, chunkIdx → chunkId) →
            // findContainingChunk. Returns null on any miss (stale row
            // or pre-migration-010 chunk) so the controller drops it.
            let vault: Vault;
            try {
              vault = manager.require(vaultName);
            } catch {
              return null;
            }
            const note = vault.db.notes.getByPath(notePath);
            if (!note) return null;
            const chunks = vault.db.chunks.getByNote(note.id);
            const chunk = chunks.find((c) => c.idx === chunkIdx);
            if (!chunk) return null;
            const section = vault.db.sections.findContainingChunk(note.id, chunk.id);
            if (!section) return null;
            let headingPath: string[];
            try {
              const parsed = JSON.parse(section.heading_path);
              headingPath = Array.isArray(parsed) ? (parsed as string[]) : [];
            } catch {
              headingPath = [];
            }
            return {
              noteId: note.id,
              anchor: section.anchor,
              headingPath,
              // Sections with a NULL chunk_id_first have been filtered out
              // by findContainingChunk (it requires non-NULL bounds), so
              // chunk_id_first is guaranteed non-null here. Fall back to
              // MAX_SAFE_INTEGER defensively for the tie-break sort.
              chunkIdFirst: section.chunk_id_first ?? Number.MAX_SAFE_INTEGER,
            };
          },
          readDocument: async (vaultName, notePath) => {
            const docId = formatDocId("obsidian-fs", vaultName, notePath);
            return adapterRegistry
              .resolveSource(parseSourceHandle(`obsidian-fs://${vaultName}`))
              .readDocument(docId);
          },
          displayUrlFor: (docId, vaultName) => {
            const source = adapterRegistry.resolveSource(
              parseSourceHandle(`obsidian-fs://${vaultName}`),
            );
            return source.formatDisplayUrl?.(docId) ?? docId;
          },
        },
        {
          query: p.query,
          limit: p.limit ?? 10,
          ...(p.vaults !== undefined ? { vaults: p.vaults } : {}),
          ...(p.recency_weight !== undefined ? { recency_weight: p.recency_weight } : {}),
          ...(p.authority_weight !== undefined ? { authority_weight: p.authority_weight } : {}),
          ...(p.include_superseded !== undefined
            ? { include_superseded: p.include_superseded }
            : {}),
        },
      );
      return { results, count: results.length };
    },

    // ── Phase 3 assembly tools (Plan 03-06) ────────────────────────────────
    assemble_dossier: async (a) => {
      const p = a as { type: string; key: string; vaults?: string[] };
      return assembleDossier(
        {
          manager,
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(parseSourceHandle(`obsidian-fs://${vaultName}`)),
        },
        p,
      );
    },

    // ── Phase 3 assembly tools (Plan 03-04 / ASM-01) ───────────────────────
    get_document_bundle: async (a) => {
      const p = a as { doc_id: string; depth?: 1; vaults?: string[] };
      return getDocumentBundle(
        {
          manager,
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(parseSourceHandle(`obsidian-fs://${vaultName}`)),
        },
        p,
      );
    },
  };
}
