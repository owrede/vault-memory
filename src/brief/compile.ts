/**
 * `handleCompileBrief` — the BRF-03 controller.
 *
 * Compiles a brief from caller-supplied source DocIds and writes it
 * through `DeliveryAdapter.write` into `_memory/_briefs/`. The full
 * pipeline (per ADR-005 §"compile_brief"):
 *
 *   1. Resolve target vault + brief sink (defaults to `_memory/_briefs`).
 *   2. Validate input: dedupe `source_doc_ids`, enforce ≤50 cap (D-03),
 *      gate cross-vault sources (Open Q3 RESOLVED — every source
 *      DocId's `authority` MUST equal the target vault).
 *   3. Resolve sources to chunks via the notes+chunks DB join and build
 *      `source_hashes` via `buildSourceHashes` (slice 1).
 *   4. Resolve the LLM strategy (D-10 ladder): MCP Sampling → Ollama →
 *      `prepared_text` → structured error.
 *   5. Build prompt; dispatch to the resolved tier; capture
 *      `BriefLlmSamplingRefusedError` → `{ok:false, reason:
 *      "sampling_refused"}`.
 *   6. Validate body wikilinks (D-11): append `## Sources` footer for
 *      any cited DocId missing a `[[Title]]` reference. Phase 4 D-02
 *      indexer materializes back-edges on the next pass.
 *   7. Mint timestamped slug `{target}--YYYYMMDDTHHmm.md`; check for
 *      existing brief with the same `target` (status !== "superseded")
 *      → capture `oldDocId` for D-12 supersede chain.
 *   8. Build the brief Document with the `default-brief-v1` property
 *      bag (slice 1's contract).
 *   9. `delivery.write(newDocId, briefDoc, {sink: briefSink.handle})`
 *      — the validator at the chokepoint runs schema + sentinel checks.
 *  10. Populate `brief_sources` reverse-index (one row per chunk in
 *      every source doc).
 *  11. If `oldDocId` was captured, call `handleSupersede` to mark the
 *      prior brief superseded (forward-only D-03 invariant).
 *
 * The controller is pure: no `node:fs`, no `node:path`, no
 * `gray-matter`, no `chokidar`. All file access goes through the
 * `SourceConnector` + `DeliveryAdapter` seams.
 */

import type { DeliveryAdapter } from "../adapters/delivery/types.js";
import { decomposeDocId, formatDocId, parseDocId } from "../adapters/registry.js";
import type { SourceConnector } from "../adapters/source/types.js";
import type { OllamaClient } from "../ollama/client.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BriefConfig, DocId, Document } from "../types.js";
import type { Vault, VaultManager } from "../vault/index.js";
import type { MemorySinkRegistry } from "../memory/registry.js";
import { handleSupersede } from "../memory/tools/supersede.js";
import { buildSourceHashes, type ChunkSource } from "./source-hashes.js";
import {
  BriefLlmSamplingRefusedError,
  BriefLlmUnavailableError,
  compileWithLlm,
  resolveLlmStrategy,
} from "./llm-ladder.js";
import { validateAndPatchBody } from "./body-validator.js";

/** ADR-005 D-03 hard cap; lifted only at planner discretion. */
const MAX_SOURCES = 50;

/** Default sink name for briefs; the user may override via `args.sink`. */
const DEFAULT_BRIEF_SINK_NAME = "_memory/_briefs";

/**
 * Dependencies — supplied by the server bootstrap. Pure interface so
 * tests can wire fakes without touching the file system seam.
 */
export interface CompileBriefDeps {
  memorySinkRegistry: MemorySinkRegistry;
  manager: VaultManager;
  deliveryAdapterFor: (vaultName: string) => DeliveryAdapter;
  sourceConnectorFor: (vaultName: string) => SourceConnector;
  /**
   * The high-level `McpServer` — the ladder reads
   * `.server.getClientCapabilities()` + `.server.createMessage()`
   * through this handle (Tier 1).
   */
  server: McpServer;
  /** OllamaClient instance (Tier 2 of the D-10 ladder). */
  ollama: OllamaClient;
  /**
   * Server-level `[brief]` block from `AppConfig`. The ladder reads
   * `briefConfig.ollama.model` to decide if Tier 2 is reachable;
   * undefined means tier 2 skips.
   */
  briefConfig: BriefConfig | undefined;
}

export interface CompileBriefArgs {
  vault: string;
  /** Stable, vault-relative target slug (e.g. `"atlas-q3"`). */
  target: string;
  /** Source DocIds the brief is compiled from; deduped, capped at 50. */
  source_doc_ids: string[];
  /** Free-form purpose; 1..500 chars (validated at Zod gate). */
  purpose: string;
  /** Hint for the LLM ladder; default 2000 tokens. */
  max_tokens?: number;
  /** D-10 tier 3 fallback: verbatim body when no LLM is reachable. */
  prepared_text?: string;
  /** Override the default `_memory/_briefs` sink. */
  sink?: string;
  /** Optional override for the slug timestamp (test-only determinism). */
  _now?: Date;
}

export type CompileBriefResult =
  | { ok: true; doc_id: string; supersededPrior?: string; model?: string }
  | {
      ok: false;
      reason: "no_llm_strategy_available";
      attempted: string[];
      hint: string;
    }
  | { ok: false; reason: "too_many_sources"; limit: number; hint: string }
  | { ok: false; reason: "cross_vault_sources"; offending: string[] }
  | { ok: false; reason: "sampling_refused"; message?: string }
  | { ok: false; reason: "write_failed"; message?: string };

/**
 * Compact ISO slug `YYYYMMDDTHHmm` for the `{target}--<slug>.md` mint
 * (D-12). Stable, sortable, file-system-safe.
 */
function compactIso(date: Date): string {
  // YYYY-MM-DDTHH:mm:ss.sssZ → YYYYMMDDTHHmm
  return date.toISOString().replace(/[-:.]/g, "").slice(0, 13);
}

/**
 * Resolve the brief sink: caller-supplied `args.sink` wins, otherwise
 * default sink-name `_memory/_briefs`. Throws (via registry) if the
 * sink is unknown — surfaced to the MCP caller as an error response.
 */
function resolveBriefSink(deps: CompileBriefDeps, sinkArg: string | undefined) {
  const name = sinkArg ?? DEFAULT_BRIEF_SINK_NAME;
  return deps.memorySinkRegistry.resolveMemorySink(name);
}

/**
 * Build the `ChunkSource[]` array for `buildSourceHashes` by joining
 * the notes + chunks tables. Source DocIds that resolve to no row are
 * silently dropped — the LLM still cites them by DocId/title; the
 * `brief_sources` reverse-index just has nothing to track. Production
 * call sites compile against indexed docs so this branch only matters
 * for unit-test fakes.
 */
function resolveSourcesToChunks(vault: Vault, docIds: readonly DocId[]): ChunkSource[] {
  const out: ChunkSource[] = [];
  for (const docId of docIds) {
    const { resource } = decomposeDocId(docId);
    const note = vault.db.notes.getByPath(resource);
    if (!note) continue;
    const chunks = vault.db.chunks.getByNote(note.id);
    for (const chunk of chunks) {
      out.push({
        docId,
        fragment: chunk.chunk_id_fragment,
        text: chunk.text,
      });
    }
  }
  return out;
}

/**
 * Lookup an existing brief for `target` via SourceConnector enumeration.
 * Returns the FIRST non-superseded match by listing order; if multiple
 * non-superseded briefs share the same `target`, the forward-only
 * supersede invariant has been violated upstream and we log a structured
 * warning (via audit). For Slice 2 we proceed with the newest by
 * `compiled_at` and document the WARN in the SUMMARY.
 */
async function findBriefByTarget(
  source: SourceConnector,
  briefSinkPrefix: string,
  vaultName: string,
  target: string,
): Promise<Document | null> {
  // listDocuments yields refs; we readDocument each one and inspect
  // properties. Limit is broad because brief sinks are small; the
  // listing is filtered by path prefix to skip unrelated _memory/ docs.
  const candidates: Document[] = [];
  for await (const ref of source.listDocuments()) {
    const { resource } = decomposeDocId(ref.id);
    if (!resource.startsWith(briefSinkPrefix)) continue;
    let doc: Document;
    try {
      doc = await source.readDocument(ref.id);
    } catch {
      continue;
    }
    const props = doc.properties as Record<string, unknown>;
    if (props.target !== target) continue;
    if (props.status === "superseded") continue;
    candidates.push(doc);
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  // Pick the newest by compiled_at. This branch should not happen
  // under the forward-only invariant.
  candidates.sort((a, b) => {
    const ai = a.properties.compiled_at as string | undefined;
    const bi = b.properties.compiled_at as string | undefined;
    return (bi ?? "").localeCompare(ai ?? "");
  });
  // Suppress unused-variable lint; vaultName parameter reserved for
  // future audit logging when the duplicate-active-briefs branch fires.
  void vaultName;
  return candidates[0]!;
}

/**
 * Resolve a DocId to a human title for the body validator + footer.
 * Falls back to the bare DocId when the notes table has no row.
 */
function makeTitleResolver(vault: Vault): (id: DocId) => string {
  return (id: DocId): string => {
    try {
      const { resource } = decomposeDocId(id);
      const row = vault.db.notes.getByPath(resource);
      if (row?.title) return row.title;
    } catch {
      // fall through
    }
    return id;
  };
}

/**
 * Compile a brief. Returns the success / failure discriminated union;
 * `WriteConflict` from the delivery adapter surfaces as `write_failed`
 * (with the original message preserved) — the underlying conflict is
 * recoverable at the caller layer if needed.
 */
export async function handleCompileBrief(
  deps: CompileBriefDeps,
  args: CompileBriefArgs,
): Promise<CompileBriefResult> {
  const vault = deps.manager.require(args.vault);
  const vaultName = vault.config.name;

  // ── 1. Resolve brief sink ─────────────────────────────────────────
  const briefSink = resolveBriefSink(deps, args.sink);
  if (briefSink.vault !== vaultName) {
    throw new Error(
      `Brief sink "${briefSink.name}" belongs to vault "${briefSink.vault}", not "${vaultName}"`,
    );
  }

  // ── 2. Validate args: dedupe + cap + cross-vault gate ─────────────
  const dedupedRaw = Array.from(new Set(args.source_doc_ids));
  if (dedupedRaw.length > MAX_SOURCES) {
    return {
      ok: false,
      reason: "too_many_sources",
      limit: MAX_SOURCES,
      hint: `Pass at most ${MAX_SOURCES} source_doc_ids. Use cluster() or expand() to narrow the corpus.`,
    };
  }

  const parsedSourceDocIds: DocId[] = [];
  const offending: string[] = [];
  for (const raw of dedupedRaw) {
    let parsed: DocId;
    try {
      parsed = parseDocId(raw);
    } catch {
      offending.push(raw);
      continue;
    }
    const { authority } = decomposeDocId(parsed);
    if (authority !== vaultName) {
      offending.push(raw);
      continue;
    }
    parsedSourceDocIds.push(parsed);
  }
  if (offending.length > 0) {
    return { ok: false, reason: "cross_vault_sources", offending };
  }

  // ── 3. Build source_hashes via slice-1 helper ─────────────────────
  const chunkSources = resolveSourcesToChunks(vault, parsedSourceDocIds);
  const sourceHashes = buildSourceHashes(chunkSources);

  // ── 4. Resolve LLM strategy ───────────────────────────────────────
  const strategy = resolveLlmStrategy(deps.server, deps.briefConfig, args.prepared_text);
  if (strategy.kind === "unavailable") {
    return {
      ok: false,
      reason: "no_llm_strategy_available",
      attempted: strategy.attempted,
      hint: "Configure [brief.ollama] in config.toml, use a sampling-capable MCP client, or pass prepared_text.",
    };
  }

  // ── 5. Build prompt + dispatch ────────────────────────────────────
  const titleOf = makeTitleResolver(vault);
  const citations = parsedSourceDocIds.map((id) => `- [[${titleOf(id)}]] (${id})`).join("\n");
  const systemText =
    "You are compiling a concise, evidence-grounded brief from the source documents below. " +
    "Emit `[[Title]]` wikilinks for each cited source so the knowledge graph indexes the brief. " +
    "Do not invent attendees, dates, decisions, or numbers — ground every claim in the sources.";
  const userText =
    `Purpose: ${args.purpose}\n\n` +
    `Sources:\n${citations}\n\n` +
    `Compile the brief now. Cite every source as a [[wikilink]] at least once.`;

  let rawBody: string;
  let model: string;
  try {
    const compiled = await compileWithLlm(
      strategy,
      deps.server,
      deps.ollama,
      { systemText, userText },
      args.max_tokens ?? 2000,
      args.prepared_text,
    );
    rawBody = compiled.body;
    model = compiled.model;
  } catch (err) {
    if (err instanceof BriefLlmSamplingRefusedError) {
      return {
        ok: false,
        reason: "sampling_refused",
        message: err.message,
      };
    }
    if (err instanceof BriefLlmUnavailableError) {
      // resolveLlmStrategy already short-circuited the unavailable
      // case; this branch fires only on programmer error (e.g. a stub
      // strategy threading through). Surface it as the same structured
      // error so the caller has one branch to handle.
      return {
        ok: false,
        reason: "no_llm_strategy_available",
        attempted: err.attempted,
        hint: "Configure [brief.ollama] in config.toml, use a sampling-capable MCP client, or pass prepared_text.",
      };
    }
    throw err;
  }

  // ── 6. Validate body wikilinks (D-11) ─────────────────────────────
  const body = validateAndPatchBody(rawBody, parsedSourceDocIds, titleOf);

  // ── 7. Mint new DocId + check for existing brief on target ────────
  const now = args._now ?? new Date();
  const slug = compactIso(now);
  const briefRelative = `${briefSink.resolveToRelativePath}${args.target}--${slug}.md`;
  const newDocId = formatDocId("obsidian-fs", vaultName, briefRelative);

  const source = deps.sourceConnectorFor(vaultName);
  const existing = await findBriefByTarget(
    source,
    briefSink.resolveToRelativePath,
    vaultName,
    args.target,
  );
  const oldDocId = existing?.id ?? null;

  // ── 8. Build the brief Document ───────────────────────────────────
  const nowIso = now.toISOString();
  const properties: Record<string, unknown> = {
    source: "agent",
    confidence: "inferred",
    evidence: parsedSourceDocIds.slice(),
    status: "active",
    observed_at: nowIso,
    superseded_by: null,
    type: "brief",
    target: args.target,
    purpose: args.purpose,
    compiled_from: parsedSourceDocIds.slice(),
    compiled_at: nowIso,
    source_hashes: sourceHashes,
    // Audit-trail attribution — which LLM tier produced the body.
    // The value is whatever the LLM tier returned verbatim (the host
    // MCP client's model identifier, the Ollama model name, or the
    // sentinel string "prepared_text"). Per ADR-005 §"Provenance" the
    // audit log carries the model name.
    model,
  };
  const title = `${args.target} brief`;
  const briefDoc: Partial<Document> = {
    id: newDocId,
    title,
    properties,
    blocks: [{ kind: "paragraph", text: body }],
  };

  // ── 9. Write through DeliveryAdapter ──────────────────────────────
  const delivery = deps.deliveryAdapterFor(vaultName);
  const writeRes = await delivery.write(newDocId, briefDoc, {
    sink: briefSink.handle,
  });
  if (!writeRes.ok) {
    return {
      ok: false,
      reason: "write_failed",
      message: writeRes.message ?? `Delivery refused brief write: reason=${writeRes.reason}`,
    };
  }

  // ── 10. Populate brief_sources reverse-index ──────────────────────
  const sourceRows = chunkSources.map((cs) => ({
    chunkIdFragment: cs.fragment,
    chunkDocId: cs.docId,
    recordedHash: sourceHashes[
      `${cs.docId}#chunk-${cs.fragment}` as keyof typeof sourceHashes
    ] as string,
  }));
  if (sourceRows.length > 0) {
    vault.db.briefSources.insertBatch(newDocId, sourceRows);
  }

  // ── 11. D-12 supersede chain on target collision ──────────────────
  if (oldDocId !== null) {
    await handleSupersede(
      {
        memorySinkRegistry: deps.memorySinkRegistry,
        manager: deps.manager,
        deliveryAdapterFor: deps.deliveryAdapterFor,
        sourceConnectorFor: deps.sourceConnectorFor,
      },
      {
        doc_id: oldDocId,
        replacement_doc_id: newDocId,
        reason: "recompiled",
      },
    );
    return {
      ok: true,
      doc_id: newDocId,
      supersededPrior: oldDocId,
      model,
    };
  }

  return { ok: true, doc_id: newDocId, model };
}
