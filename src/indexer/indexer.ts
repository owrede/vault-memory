/**
 * Index Builder — orchestrates Reader → Chunker → Ollama → DB.
 *
 * Two modes:
 *   - full:        wipe chunks/embeddings/wikilinks, re-index everything
 *   - incremental: only re-index notes whose hash changed (default)
 *
 * Returns run statistics.
 */

import { randomUUID } from "node:crypto";
import { scanVault, parseNote } from "../reader/index.js";
import { chunkNote } from "../chunker/index.js";
import { OllamaClient } from "../ollama/index.js";
import type { Vault } from "../vault/index.js";
import type { ParsedNote, ParsedWikilink } from "../types.js";
import { WikilinkResolver } from "./resolver.js";

export interface IndexerOptions {
  mode?: "full" | "incremental";
  embeddingModel: string;
  /** Phase 7c: optional secondary (shadow) embedding model. When set, every
   *  chunk is embedded with BOTH the primary and the secondary model in
   *  parallel. Stored in separate `embeddings_<dim>` tables so search and
   *  the active model are unaffected. Used by `/setup-memory-system` and
   *  the watcher to keep a shadow index live for a future model switch. */
  secondaryEmbeddingModel?: string;
  ollama: OllamaClient;
  /** Called periodically with progress info. */
  onProgress?: (msg: string) => void;
}

export interface IndexRunResult {
  runId: string;
  status: "completed" | "failed";
  notesIndexed: number;
  notesUpdated: number;
  notesDeleted: number;
  notesSkipped: number;
  chunksCreated: number;
  durationMs: number;
  error?: string;
}

export async function indexVault(vault: Vault, options: IndexerOptions): Promise<IndexRunResult> {
  const startedAt = Date.now();
  const runId = randomUUID();
  const mode = options.mode ?? "incremental";
  const log = options.onProgress ?? (() => {});

  // 1. Resolve / upsert model in DB
  log(`Probing Ollama model: ${options.embeddingModel}`);
  const health = await options.ollama.healthCheck();
  if (!health.ok) {
    throw new Error(`Ollama unreachable: ${health.error ?? "unknown error"}`);
  }
  const modelExists = await options.ollama.modelExists(options.embeddingModel);
  if (!modelExists) {
    throw new Error(
      `Embedding model "${options.embeddingModel}" not found in Ollama. ` +
        `Available: ${health.models?.join(", ") ?? "(none)"}. ` +
        `Run: ollama pull ${options.embeddingModel}`,
    );
  }

  // Probe dim with a 1-text embed (cheap)
  const probe = await options.ollama.embed({
    model: options.embeddingModel,
    texts: ["probe"],
  });
  const dim = probe.dim;
  const modelRow = vault.db.models.upsert({
    name: options.embeddingModel,
    provider: "ollama",
    dim,
  });

  // Phase 7c: secondary (shadow) model registration. We probe + upsert with
  // active=false so the primary stays active. Probing also fails fast if the
  // model isn't pulled — better than discovering that mid-run on note 5000.
  let secondaryModelRow: { id: number; dim: number } | null = null;
  if (options.secondaryEmbeddingModel) {
    const secName = options.secondaryEmbeddingModel;
    log(`Probing secondary (shadow) model: ${secName}`);
    const secExists = await options.ollama.modelExists(secName);
    if (!secExists) {
      throw new Error(
        `Secondary embedding model "${secName}" not found in Ollama. ` +
          `Run: ollama pull ${secName}`,
      );
    }
    const secProbe = await options.ollama.embed({
      model: secName,
      texts: ["probe"],
    });
    const row = vault.db.models.upsert({
      name: secName,
      provider: "ollama",
      dim: secProbe.dim,
      active: false,
    });
    secondaryModelRow = { id: row.id, dim: row.dim };
  }

  vault.db.audit.startRun({
    runId,
    vaultName: vault.config.name,
    modelId: modelRow.id,
    trigger: mode === "full" ? "manual-full" : "manual-incremental",
  });

  let notesIndexed = 0;
  let notesUpdated = 0;
  let notesDeleted = 0;
  let notesSkipped = 0;
  let chunksCreated = 0;

  // Per-run resolver: prepared statements reused, results memoised.
  // First pass uses this. Second pass (after all notes are inserted) uses
  // a fresh instance so newly-visible notes aren't masked by stale "null"
  // cache entries from the first pass.
  const firstPassResolver = new WikilinkResolver(vault);

  try {
    // 2. Full mode: clear derived layer
    if (mode === "full") {
      log("Full mode: clearing existing chunks and embeddings");
      // Cascade via FK: deleting notes wipes chunks/embeddings/wikilinks.
      // But we want to keep notes (and re-upsert) — so we clear chunks only.
      vault.db.transaction(() => {
        const allNotes = vault.db.notes.listAll();
        for (const n of allNotes) {
          vault.db.chunks.deleteByNote(n.id);
          vault.db.wikilinks.deleteByNote(n.id);
        }
      });
    }

    // 3. Scan vault
    log(`Scanning ${vault.config.path}`);
    const files = await scanVault(vault.config.path, {
      excludeGlobs: vault.config.exclude_globs,
    });
    log(`Found ${files.length} markdown files`);

    // 4. Parse + decide per-note
    const parsedNotes: Array<{ parsed: ParsedNote; noteId: number; needsReindex: boolean }> = [];

    for (const file of files) {
      let parsed: ParsedNote;
      try {
        parsed = await parseNote(file, vault.config.path);
      } catch (err) {
        // Robustheit gegen invalides Frontmatter / kaputte Notes:
        // skip + log statt Vault-Abort. User-Notes sind nicht unser Vertrag.
        notesSkipped++;
        const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
        const rel = file.startsWith(vault.config.path)
          ? file.slice(vault.config.path.length + 1)
          : file;
        log(`  skipped (parse error): ${rel} — ${msg}`);
        continue;
      }
      const upsert = vault.db.notes.upsertByPath({
        path: parsed.relativePath,
        content: parsed.content,
        frontmatter: parsed.frontmatter ? JSON.stringify(parsed.frontmatter) : null,
        title: parsed.title,
        hash: parsed.hash,
        bodyHash: parsed.bodyHash,
        mtime: parsed.mtime,
        wordCount: parsed.wordCount,
      });

      // Persist aliases from frontmatter. We do this every run (not just on
      // reindex) so alias-only frontmatter edits propagate even when the body
      // is unchanged. The set is idempotent: setForNote does delete+insert.
      vault.db.aliases.setForNote(upsert.id, extractAliases(parsed.frontmatter));

      const noteExisted = !upsert.isNew;
      const existing = noteExisted ? vault.db.notes.getById(upsert.id) : null;
      // After upsert the DB row reflects the new state; we need to know if the hash
      // actually changed. The NotesQueries.upsertByPath returns isNew, but we also
      // need "isModified". Workaround: check chunks count — if a note has no chunks,
      // it needs (re-)indexing.
      const chunkCount = vault.db.chunks.getByNote(upsert.id).length;
      const needsReindex = mode === "full" || upsert.isNew || chunkCount === 0;

      if (upsert.isNew) notesIndexed++;
      else if (needsReindex) notesUpdated++;

      if (needsReindex) {
        parsedNotes.push({ parsed, noteId: upsert.id, needsReindex: true });
      }

      // Suppress unused-var warning for `existing` — kept for clarity above
      void existing;
    }

    log(`${parsedNotes.length} notes need (re-)indexing`);

    // 5. Chunk + embed + persist
    for (const { parsed, noteId } of parsedNotes) {
      // Clear old chunks (handles re-index)
      vault.db.chunks.deleteByNote(noteId);
      vault.db.wikilinks.deleteByNote(noteId);

      const chunks = chunkNote(parsed.content);

      if (chunks.length === 0) {
        // empty note — record wikilinks anyway, but no chunks/embeddings
        insertWikilinks(vault, noteId, parsed.wikilinks);
        continue;
      }

      // Insert chunks first to get IDs
      const chunkInputs = chunks.map((c) => ({
        idx: c.idx,
        text: c.text,
        headingPath: c.headingPath,
        startOffset: c.startOffset,
        endOffset: c.endOffset,
        tokenCount: c.tokenCount,
      }));
      const chunkIds = vault.db.chunks.insertBatch(noteId, chunkInputs);

      // Embed
      const embedResult = await options.ollama.embed({
        model: options.embeddingModel,
        texts: chunks.map((c) => c.text),
      });
      if (embedResult.dim !== dim) {
        throw new Error(`Embedding dimension mismatch: expected ${dim}, got ${embedResult.dim}`);
      }

      const embeddingInputs = chunkIds.map((chunkId, i) => ({
        chunkId,
        modelId: modelRow.id,
        vector: embedResult.vectors[i]!,
      }));
      vault.db.embeddings.insertBatch(embeddingInputs);

      // Phase 7c: shadow-index pass. Embed each chunk a second time with
      // the secondary model and persist into its dim-specific table.
      // Independent failure surface: if secondary embed throws, the primary
      // index for this run still completes — the secondary will be retried
      // on the next index run (idempotent: LEFT JOIN in start_shadow_index).
      if (secondaryModelRow) {
        const secEmbed = await options.ollama.embed({
          model: options.secondaryEmbeddingModel!,
          texts: chunks.map((c) => c.text),
        });
        if (secEmbed.dim !== secondaryModelRow.dim) {
          throw new Error(
            `Secondary embedding dimension mismatch: expected ` +
              `${secondaryModelRow.dim}, got ${secEmbed.dim}`,
          );
        }
        vault.db.embeddings.insertBatch(
          chunkIds.map((chunkId, i) => ({
            chunkId,
            modelId: secondaryModelRow!.id,
            vector: secEmbed.vectors[i]!,
          })),
        );
      }

      // Wikilinks
      insertWikilinks(vault, noteId, parsed.wikilinks, firstPassResolver);

      chunksCreated += chunks.length;
    }

    // 6. Detect deleted notes (in DB but not on disk)
    const knownPaths = new Set(files.map((f) => relativize(f, vault.config.path)));
    const dbNotes = vault.db.notes.listAll();
    for (const n of dbNotes) {
      if (!knownPaths.has(n.path)) {
        vault.db.notes.deleteByPath(n.path);
        notesDeleted++;
      }
    }

    // 7. Second-pass wikilink resolution.
    //
    // The first pass resolved wikilinks while notes were being inserted in
    // arbitrary order — so any link to a note that hadn't been inserted yet,
    // or any link via an alias whose owner hadn't been processed yet, was
    // marked unresolved. Now that the full notes + aliases tables exist, we
    // re-resolve broken links once. This converts "transient broken" links
    // (resolution-order artifact) into proper edges without re-parsing files.
    log("Resolving deferred wikilinks (second pass)");
    const broken = vault.db.wikilinks.resolveBrokenLinks();
    let resolved = 0;
    const updateStmt = vault.db.handle.prepare(
      `UPDATE wikilinks SET target_note = ?
       WHERE source_note = ? AND target_path = ? AND target_note IS NULL`,
    );
    // Fresh resolver for the second pass — the notes table is now complete,
    // so first-pass "null" cache entries would mask newly-resolvable links.
    const secondPassResolver = new WikilinkResolver(vault);
    for (const link of broken) {
      const hit = secondPassResolver.resolve(link.targetPath);
      if (hit) {
        updateStmt.run(hit.id, link.sourceNoteId, link.targetPath);
        resolved++;
      }
    }
    if (resolved > 0) log(`Second pass resolved ${resolved} wikilinks`);

    vault.db.audit.finishRun(runId, {
      notesIndexed,
      chunksCreated,
      notesUpdated,
      notesDeleted,
    });

    if (notesSkipped > 0) {
      log(`${notesSkipped} note(s) skipped due to parse errors`);
    }

    return {
      runId,
      status: "completed",
      notesIndexed,
      notesUpdated,
      notesDeleted,
      notesSkipped,
      chunksCreated,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vault.db.audit.finishRun(runId, {
      notesIndexed,
      chunksCreated,
      notesUpdated,
      notesDeleted,
      error: message,
    });
    return {
      runId,
      status: "failed",
      notesIndexed,
      notesUpdated,
      notesDeleted,
      notesSkipped,
      chunksCreated,
      durationMs: Date.now() - startedAt,
      error: message,
    };
  }
}

function insertWikilinks(
  vault: Vault,
  sourceNoteId: number,
  wikilinks: ParsedWikilink[],
  resolver?: WikilinkResolver,
): void {
  if (wikilinks.length === 0) return;

  const r = resolver ?? new WikilinkResolver(vault);
  const inputs = wikilinks.map((wl) => {
    const target = r.resolve(wl.normalizedTarget);
    return {
      targetPath: wl.normalizedTarget,
      targetNoteId: target?.id ?? null,
      linkText: wl.alias,
      anchor: wl.anchor,
      lineNumber: wl.line,
    };
  });
  vault.db.wikilinks.insertBatch(sourceNoteId, inputs);
}

/**
 * Resolve a wikilink target the way Obsidian does, in priority order:
 *   1) exact relative path match (with or without .md)
 *   2) filename-only match anywhere in the vault — shortest path wins
 *   3) alias match — looks up note_aliases (case-insensitive)
 *
 * Returns null if no candidate exists (true broken link).
 */
export function resolveWikilinkTarget(
  vault: Vault,
  normalizedTarget: string,
): { id: number; path: string } | null {
  // API-compat wrapper. Single-call sites (e.g. single-note re-index) pay
  // the prepared-statement cost per call. The hot path (indexVault) goes
  // through a long-lived WikilinkResolver instance instead.
  return new WikilinkResolver(vault).resolve(normalizedTarget);
}

/**
 * Extract aliases from a parsed frontmatter object. Accepts the two common
 * shapes Obsidian writes:
 *   aliases: ["OWR", "Oliver"]
 *   alias:   "OWR"          (singular form, sometimes used)
 *   aliases: "OWR"          (string fallback)
 *
 * Anything else (numbers, objects) is ignored.
 */
export function extractAliases(frontmatter: Record<string, unknown> | null): string[] {
  if (!frontmatter) return [];
  const raw = frontmatter["aliases"] ?? frontmatter["alias"];
  if (raw == null) return [];
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === "string");
  }
  return [];
}

function relativize(absPath: string, vaultRoot: string): string {
  // Reader produces forward-slash relative paths. We must do the same here
  // so deletion detection works on all platforms.
  let p = absPath;
  if (p.startsWith(vaultRoot)) {
    p = p.slice(vaultRoot.length);
  }
  if (p.startsWith("/") || p.startsWith("\\")) {
    p = p.slice(1);
  }
  return p.split("\\").join("/");
}
