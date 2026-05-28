/**
 * Search-domain MCP handler factory.
 *
 * Tools: search_semantic, search_text, search_hybrid, search (compat),
 * fetch (compat).
 *
 * Extracted verbatim from the inline `handlers` literal + standalone
 * `handle*` functions in `src/server.ts`. Behavior-neutral.
 *
 * # Adapter-seam discipline
 *
 * No node:path / node:fs / chokidar / gray-matter imports. Display-URL
 * minting flows through the adapter registry seam (`displayUrl`); the
 * search pipeline reads via `vault.db` query namespaces.
 */

import type { VaultManager } from "../../vault/index.js";
import type { OllamaClient } from "../../ollama/index.js";
import type { Reranker } from "../../rerank/index.js";
import type { AdapterRegistry } from "../../adapters/registry.js";
import { parseSourceHandle } from "../../adapters/registry.js";
import { FtsQueries } from "../../db/index.js";
import { hybridSearch, matchesAnyGlob } from "../../search/index.js";
import type { ExpandDeps, ExpandDirection } from "../../graph/index.js";
import type { EdgeType } from "../../db/queries/edges.js";
import type { SearchHit } from "../../types.js";
import {
  resolveVaultTargets,
  encodeNoteId,
  decodeNoteId,
  displayUrl,
  truncateSnippet,
} from "../utils.js";
import type { ToolName } from "../../tool-registry.js";
import type { Handler, HandlerDeps } from "../deps.js";

async function handleSearchSemantic(
  manager: VaultManager,
  ollama: OllamaClient,
  defaultModel: string,
  activeVault: string | undefined,
  query: string,
  vaultFilter: string[] | undefined,
  topK: number,
  excludePaths: string[] | undefined,
): Promise<object> {
  const { targets, skipped } = resolveVaultTargets(manager, vaultFilter, activeVault);

  if (targets.length === 0) {
    return {
      hits: [],
      note:
        skipped.length > 0
          ? `All eligible vaults are indexing; skipped: ${skipped.join(", ")}.`
          : "No vaults configured.",
    };
  }

  // When excluding paths, fan out wider so the filtered topK is well-stocked.
  const hasExclude = excludePaths !== undefined && excludePaths.length > 0;
  const fanK = hasExclude ? topK * 3 : topK;

  // Cache query embedding by model name across vaults.
  const embedCache = new Map<string, number[]>();
  const allHits: SearchHit[] = [];

  for (const vault of targets) {
    // Phase 7c follow-up (v0.7.2): the active model in the DB is the source
    // of truth — switch_active_model may have promoted a shadow model
    // that doesn't match config.embedding_model. Fall back to the config
    // only when no active model is registered yet.
    const model = vault.db.models.getActive();
    if (!model) continue;
    const modelName = model.name;

    let queryVec = embedCache.get(modelName);
    if (!queryVec) {
      const embedResp = await ollama.embed({ model: modelName, texts: [query] });
      queryVec = embedResp.vectors[0];
      if (!queryVec) continue;
      embedCache.set(modelName, queryVec);
    }

    const semanticHits = vault.db.embeddings.searchSemantic(model.id, queryVec, fanK);

    for (const hit of semanticHits) {
      const chunk = vault.db.chunks.getById(hit.chunkId);
      if (!chunk) continue;
      const note = vault.db.notes.getById(chunk.note_id);
      if (!note) continue;
      if (hasExclude && matchesAnyGlob(note.path, excludePaths!)) continue;
      const score = 1 / (1 + hit.distance);

      allHits.push({
        vault: vault.config.name,
        notePath: note.path,
        noteTitle: note.title,
        chunkText: chunk.text,
        chunkIdx: chunk.idx,
        headingPath: chunk.heading_path,
        score,
        scoreBreakdown: { semantic: score },
      });
    }
  }

  allHits.sort((a, b) => b.score - a.score);
  const out: Record<string, unknown> = {
    hits: allHits.slice(0, topK),
    count: allHits.length,
  };
  if (skipped.length > 0) {
    out.note = `Skipped vault(s) currently indexing: ${skipped.join(", ")}.`;
  }
  return out;
}

function handleSearchText(
  manager: VaultManager,
  activeVault: string | undefined,
  query: string,
  vaultFilter: string[] | undefined,
  topK: number,
  excludePaths: string[] | undefined,
): object {
  const { targets, skipped } = resolveVaultTargets(manager, vaultFilter, activeVault);

  if (targets.length === 0) {
    return {
      hits: [],
      note:
        skipped.length > 0
          ? `All eligible vaults are indexing; skipped: ${skipped.join(", ")}.`
          : "No vaults configured.",
    };
  }

  const hasExclude = excludePaths !== undefined && excludePaths.length > 0;
  const fanK = hasExclude ? topK * 3 : topK;

  const sanitized = FtsQueries.sanitize(query);
  const allHits: SearchHit[] = [];

  for (const vault of targets) {
    const ftsHits = vault.db.fts.search(sanitized, fanK, true);
    for (const hit of ftsHits) {
      const chunk = vault.db.chunks.getById(hit.chunkId);
      if (!chunk) continue;
      const note = vault.db.notes.getById(chunk.note_id);
      if (!note) continue;
      if (hasExclude && matchesAnyGlob(note.path, excludePaths!)) continue;

      allHits.push({
        vault: vault.config.name,
        notePath: note.path,
        noteTitle: note.title,
        chunkText: hit.snippet ?? chunk.text,
        chunkIdx: chunk.idx,
        headingPath: chunk.heading_path,
        score: hit.score,
        scoreBreakdown: { text: hit.score },
      });
    }
  }

  allHits.sort((a, b) => b.score - a.score);
  const out: Record<string, unknown> = {
    hits: allHits.slice(0, topK),
    count: allHits.length,
  };
  if (skipped.length > 0) {
    out.note = `Skipped vault(s) currently indexing: ${skipped.join(", ")}.`;
  }
  return out;
}

export async function handleSearchHybrid(
  manager: VaultManager,
  ollama: OllamaClient,
  defaultModel: string,
  activeVault: string | undefined,
  query: string,
  vaultFilter: string[] | undefined,
  topK: number,
  rrfK: number,
  excludePaths: string[] | undefined,
  reranker: Reranker | undefined,
  // Phase 3 / 03-05 additive params — D-07/D-08/ASM-07/ASM-08.
  recencyWeight: number = 0,
  authorityWeight: number = 0,
  halfLifeDays: number = 30,
  includeSuperseded: boolean = false,
  // Phase 3 / 03-05: optional display-URL resolver (ADR-002 §I-5b
  // seam-preserving — the URL literal lives in the adapter, not here).
  displayUrlFor?: (vaultName: string, notePath: string) => string,
  // Phase 4 / 04-04 (D-15): optional auto-expansion + its injected deps.
  // When `expand` is undefined, hybridSearch's guard short-circuits;
  // `expandDeps` is forwarded unconditionally so future per-call wiring
  // stays trivial.
  expandOpts?: {
    hops: 1 | 2;
    direction?: ExpandDirection;
    edge_types?: EdgeType[];
  },
  expandDeps?: ExpandDeps,
): Promise<object> {
  const { targets, skipped } = resolveVaultTargets(manager, vaultFilter, activeVault);

  if (targets.length === 0) {
    return {
      hits: [],
      note:
        skipped.length > 0
          ? `All eligible vaults are indexing; skipped: ${skipped.join(", ")}.`
          : "No vaults configured.",
    };
  }

  const hasExclude = excludePaths !== undefined && excludePaths.length > 0;
  // Request 3× the final topK when filtering so the post-filter list is
  // well-stocked. hybridSearch internally fans 3× again per ranking, so
  // semantic/BM25 each retrieve ~9×topK chunks — plenty of headroom.
  const innerTopK = hasExclude ? topK * 3 : topK;

  const hits = await hybridSearch({
    query,
    embeddingModel: defaultModel,
    ollama,
    vaults: targets,
    topK: innerTopK,
    rrfK,
    includeBreakdown: true,
    reranker,
    recencyWeight,
    authorityWeight,
    halfLifeDays,
    includeSuperseded,
    ...(displayUrlFor ? { displayUrlFor } : {}),
    // Phase 4 / 04-04 (D-15): forward optional expand + deps. When
    // `expandOpts` is undefined, hybridSearch short-circuits the
    // expand block (zero new DB reads — v1-baseline byte-identical).
    ...(expandOpts ? { expand: expandOpts } : {}),
    ...(expandDeps ? { expandDeps } : {}),
  });

  const filtered = hasExclude
    ? hits.filter((h) => !matchesAnyGlob(h.notePath, excludePaths!))
    : hits;

  const out: Record<string, unknown> = {
    hits: filtered.slice(0, topK),
    count: filtered.length,
  };
  if (skipped.length > 0) {
    out.note = `Skipped vault(s) currently indexing: ${skipped.join(", ")}.`;
  }
  return out;
}

// ─── v0.9.0 handlers — Agent-Compatibility & Self-Orientation ───────────────

/**
 * Encode an opaque id for the OB1-compatible `search`/`fetch` API.
 *
 * Format: `<vault>:<vault-relative-path>`
 *
 * Vault names cannot contain `:` per config schema, and Obsidian paths use
 * forward slashes — so the first `:` is an unambiguous separator. We pick
 * this over a base64-encoded blob because the id stays human-readable in
 * connector UIs (ChatGPT shows search results inline) and trivially
 * round-trips through copy/paste.
 */
async function handleSearchCompat(
  manager: VaultManager,
  registry: AdapterRegistry,
  ollama: OllamaClient,
  defaultModel: string,
  activeVault: string | undefined,
  query: string,
  limit: number,
  reranker: Reranker | undefined,
): Promise<object> {
  const { targets, skipped } = resolveVaultTargets(manager, undefined, activeVault);

  if (targets.length === 0) {
    return {
      results: [],
      note:
        skipped.length > 0
          ? `All eligible vaults are indexing; skipped: ${skipped.join(", ")}.`
          : "No vaults configured.",
    };
  }

  // We delegate to the hybrid pipeline so OB1-style search benefits from
  // both BM25 and vector retrieval — this is the differentiator vs. OB1's
  // pure-embedding implementation.
  const hits = await hybridSearch({
    query,
    embeddingModel: defaultModel,
    ollama,
    vaults: targets,
    topK: limit,
    rrfK: 60,
    includeBreakdown: false,
    reranker,
  });

  // De-duplicate to one result per note (OB1 spec: one entry per
  // document). Chunks of the same note collapse to the first/best chunk
  // and contribute their snippet.
  const seen = new Set<string>();
  const results: Array<{
    id: string;
    title: string;
    url: string;
    snippet: string;
  }> = [];
  for (const h of hits) {
    const noteKey = `${h.vault}:${h.notePath}`;
    if (seen.has(noteKey)) continue;
    seen.add(noteKey);
    results.push({
      id: encodeNoteId(h.vault, h.notePath),
      title: h.noteTitle ?? h.notePath,
      url: displayUrl(registry, h.vault, h.notePath),
      snippet: truncateSnippet(h.chunkText, 280),
    });
    if (results.length >= limit) break;
  }

  const out: Record<string, unknown> = { results };
  if (skipped.length > 0) {
    out.note = `Skipped vault(s) currently indexing: ${skipped.join(", ")}.`;
  }
  return out;
}

function handleFetchCompat(manager: VaultManager, registry: AdapterRegistry, id: string): object {
  const { vault: vaultName, path } = decodeNoteId(id);
  const vault = manager.require(vaultName);
  const note = vault.db.notes.getByPath(path);
  if (!note) {
    throw new Error(`Note not found: ${vaultName}/${path}`);
  }
  const metadata: Record<string, unknown> = {
    vault: vaultName,
    path: note.path,
    mtime: note.mtime,
    hash: note.hash,
    word_count: note.word_count,
  };
  if (note.frontmatter) {
    try {
      metadata.frontmatter = JSON.parse(note.frontmatter);
    } catch {
      // Stored frontmatter should always be valid JSON; if it isn't, treat
      // as missing rather than failing the fetch.
    }
  }
  return {
    id,
    title: note.title ?? note.path,
    text: note.content,
    url: displayUrl(registry, vaultName, note.path),
    metadata,
  };
}

export function makeSearchHandlers(deps: HandlerDeps): Partial<Record<ToolName, Handler>> {
  const { manager, ollama, defaultModel, activeVault, reranker, adapterRegistry } = deps;
  return {
    search_semantic: async (a) => {
      const p = a as {
        query: string;
        vaults?: string[];
        top_k: number;
        exclude_paths?: string[];
      };
      return handleSearchSemantic(
        manager,
        ollama,
        defaultModel,
        activeVault,
        p.query,
        p.vaults,
        p.top_k,
        p.exclude_paths,
      );
    },
    search_text: async (a) => {
      const p = a as {
        query: string;
        vaults?: string[];
        top_k: number;
        exclude_paths?: string[];
      };
      return handleSearchText(manager, activeVault, p.query, p.vaults, p.top_k, p.exclude_paths);
    },
    search_hybrid: async (a) => {
      const p = a as {
        query: string;
        vaults?: string[];
        top_k: number;
        rrf_k: number;
        exclude_paths?: string[];
        rerank: boolean;
        // Phase 3 / 03-05 additive params — Zod fills defaults so these
        // are always present after validation. v1 callers omit them and
        // get the v1-identical default behavior.
        recency_weight: number;
        authority_weight: number;
        half_life_days: number;
        include_superseded: boolean;
        // Phase 4 / 04-04 (D-15): additive optional auto-expansion.
        // When omitted, the downstream hybridSearch guard short-circuits.
        expand?: {
          hops: 1 | 2;
          direction?: ExpandDirection;
          edge_types?: EdgeType[];
        };
      };
      return handleSearchHybrid(
        manager,
        ollama,
        defaultModel,
        activeVault,
        p.query,
        p.vaults,
        p.top_k,
        p.rrf_k,
        p.exclude_paths,
        p.rerank ? reranker : undefined,
        p.recency_weight,
        p.authority_weight,
        p.half_life_days,
        p.include_superseded,
        // 03-05: display-URL resolver — delegates to the obsidian-fs source
        // adapter (or whichever adapter owns the vault) so hybrid.ts never
        // mints adapter URL strings (ADR-002 §I-5b).
        (vaultName, notePath) => displayUrl(adapterRegistry, vaultName, notePath),
        // Phase 4 / 04-04 (D-15): pass the optional expand object + its
        // injected deps (manager + sourceConnectorFor) so hybridSearch
        // can compose Plan 04-03's `expand()` over the rescored top-K.
        p.expand,
        {
          manager,
          sourceConnectorFor: (vaultName) =>
            adapterRegistry.resolveSource(parseSourceHandle(`obsidian-fs://${vaultName}`)),
        },
      );
    },
    search: async (a) => {
      const p = a as { query: string; limit: number };
      return handleSearchCompat(
        manager,
        adapterRegistry,
        ollama,
        defaultModel,
        activeVault,
        p.query,
        p.limit,
        reranker,
      );
    },
    fetch: async (a) => {
      const p = a as { id: string };
      return handleFetchCompat(manager, adapterRegistry, p.id);
    },
  };
}
