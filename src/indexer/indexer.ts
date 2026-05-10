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

export interface IndexerOptions {
  mode?: "full" | "incremental";
  embeddingModel: string;
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
  chunksCreated: number;
  durationMs: number;
  error?: string;
}

export async function indexVault(
  vault: Vault,
  options: IndexerOptions,
): Promise<IndexRunResult> {
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

  vault.db.audit.startRun({
    runId,
    vaultName: vault.config.name,
    modelId: modelRow.id,
    trigger: mode === "full" ? "manual-full" : "manual-incremental",
  });

  let notesIndexed = 0;
  let notesUpdated = 0;
  let notesDeleted = 0;
  let chunksCreated = 0;

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
      const parsed = await parseNote(file, vault.config.path);
      const upsert = vault.db.notes.upsertByPath({
        path: parsed.relativePath,
        content: parsed.content,
        frontmatter: parsed.frontmatter ? JSON.stringify(parsed.frontmatter) : null,
        title: parsed.title,
        hash: parsed.hash,
        mtime: parsed.mtime,
        wordCount: parsed.wordCount,
      });

      const noteExisted = !upsert.isNew;
      const existing = noteExisted ? vault.db.notes.getById(upsert.id) : null;
      // After upsert the DB row reflects the new state; we need to know if the hash
      // actually changed. The NotesQueries.upsertByPath returns isNew, but we also
      // need "isModified". Workaround: check chunks count — if a note has no chunks,
      // it needs (re-)indexing.
      const chunkCount = vault.db.chunks.getByNote(upsert.id).length;
      const needsReindex =
        mode === "full" || upsert.isNew || chunkCount === 0;

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
        throw new Error(
          `Embedding dimension mismatch: expected ${dim}, got ${embedResult.dim}`,
        );
      }

      const embeddingInputs = chunkIds.map((chunkId, i) => ({
        chunkId,
        modelId: modelRow.id,
        vector: embedResult.vectors[i]!,
      }));
      vault.db.embeddings.insertBatch(embeddingInputs);

      // Wikilinks
      insertWikilinks(vault, noteId, parsed.wikilinks);

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

    vault.db.audit.finishRun(runId, {
      notesIndexed,
      chunksCreated,
      notesUpdated,
      notesDeleted,
    });

    return {
      runId,
      status: "completed",
      notesIndexed,
      notesUpdated,
      notesDeleted,
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
): void {
  if (wikilinks.length === 0) return;

  const inputs = wikilinks.map((wl) => {
    const target = resolveWikilinkTarget(vault, wl.normalizedTarget);
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
 * Resolve a wikilink target the way Obsidian does:
 * 1) exact relative path match (with or without .md)
 * 2) filename-only match anywhere in the vault — shortest path wins
 *
 * Returns null if no candidate exists (broken link).
 */
function resolveWikilinkTarget(
  vault: Vault,
  normalizedTarget: string,
): { id: number; path: string } | null {
  // Try exact relative path (with .md, then without)
  const exact =
    vault.db.notes.getByPath(`${normalizedTarget}.md`) ??
    vault.db.notes.getByPath(normalizedTarget);
  if (exact) return exact;

  // If target has no slash, it's a filename-only reference — search all notes.
  if (!normalizedTarget.includes("/")) {
    const stmt = vault.db.handle.prepare<[string, string], { id: number; path: string }>(
      `SELECT id, path FROM notes
       WHERE path = ?
          OR path LIKE ?
       ORDER BY length(path) ASC
       LIMIT 1`,
    );
    const filename = `${normalizedTarget}.md`;
    const suffix = `%/${filename}`;
    const hit = stmt.get(filename, suffix);
    if (hit) return hit;
  }

  return null;
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
