/**
 * Single-Note Indexer — re-index one note efficiently.
 *
 * Used by the file-watcher (Phase 4) to react to individual file events
 * without paying the full-vault setup overhead (model probe, audit run,
 * scan, second-pass wikilink resolution).
 *
 * Behavioral contract: see `indexNote` JSDoc below.
 */

import * as path from "node:path";
import type { Vault } from "../vault/index.js";
import type { OllamaClient } from "../ollama/index.js";
import { parseNote } from "../adapters/source/obsidian-fs/parser.js";
import { chunkNote } from "../chunker/index.js";
import { extractAliases, resolveWikilinkTarget } from "./indexer.js";
import type { ParsedWikilink } from "../types.js";

export interface IndexNoteOptions {
  vault: Vault;
  /** Absolute file path. Must be inside the vault. */
  absolutePath: string;
  embeddingModel: string;
  /** Phase 7c: optional secondary (shadow) model name. When set AND the
   *  model is already registered in the vault DB, the watcher / single
   *  indexer also writes shadow embeddings so the secondary index stays
   *  current with the primary. Unregistered names are ignored silently —
   *  registration only happens via a full `indexVault` run. */
  secondaryEmbeddingModel?: string;
  ollama: OllamaClient;
}

export interface IndexNoteResult {
  status: "indexed" | "unchanged" | "outside_vault" | "missing" | "parse_error";
  notePath: string | null;
  noteId: number | null;
  chunksCreated: number;
  /** True if this was a brand-new note (vs. updated existing). */
  isNew: boolean;
}

/**
 * Re-index a single note. Cheaper than a full vault scan: no model probe,
 * no audit run wrapping, no second-pass wikilink resolution (so transient
 * unresolved aliases will be flagged broken — call the full indexer if you
 * need them resolved).
 *
 * Behavior:
 *   - Path outside vault → status: "outside_vault"
 *   - File missing → status: "missing" (caller should call removeNote instead)
 *   - File hash unchanged → status: "unchanged" (no-op fast path; aliases
 *     are still re-applied idempotently)
 *   - Otherwise → full re-index of this note: parse, chunk, embed, persist,
 *     update aliases, persist wikilinks
 */
export async function indexNote(options: IndexNoteOptions): Promise<IndexNoteResult> {
  const { vault, absolutePath, embeddingModel, ollama } = options;
  const secondaryName = options.secondaryEmbeddingModel;

  // 1. Validate path is inside the vault.
  if (!isInsideVault(absolutePath, vault.config.path)) {
    return emptyResult("outside_vault");
  }

  // 2. Parse — handle missing-file fast path and invalid-frontmatter skip.
  let parsed;
  try {
    parsed = await parseNote(absolutePath, vault.config.path);
  } catch (err) {
    if (isENOENT(err)) {
      return emptyResult("missing");
    }
    // Invalid frontmatter or other parse failure: skip silently so a single
    // bad note doesn't kill the watcher or break the indexer mid-run. Caller
    // can inspect `status === "parse_error"` if it wants to log.
    return emptyResult("parse_error");
  }

  // 3. Look up existing note for hash check.
  const existing = vault.db.notes.getByPath(parsed.relativePath);

  // 4. Fast path: hash unchanged → still re-apply aliases idempotently.
  if (existing && existing.hash === parsed.hash) {
    vault.db.aliases.setForNote(existing.id, extractAliases(parsed.frontmatter));
    return {
      status: "unchanged",
      notePath: parsed.relativePath,
      noteId: existing.id,
      chunksCreated: 0,
      isNew: false,
    };
  }

  // 4b. Body-hash fast path (v0.9.1): combined hash differs but body is
  //     unchanged → frontmatter-only edit. Update note row + aliases, but
  //     KEEP chunks/embeddings as-is. Saves an Ollama roundtrip per chunk
  //     (typically 5-15 per note) on every update_frontmatter call.
  //
  //     Wikilinks: extracted from BOTH body and frontmatter. Frontmatter
  //     wikilinks (e.g. participation: ["[[X]]"]) can change with a
  //     frontmatter-only edit, so we still rewrite the wikilinks index.
  //
  //     NULL guard: legacy rows pre-migration-006 have body_hash=NULL.
  //     `null === parsed.bodyHash` is always false, so we fall through to
  //     the full re-embed path. Self-heals on next touch.
  if (existing && existing.body_hash && existing.body_hash === parsed.bodyHash) {
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
    vault.db.aliases.setForNote(upsert.id, extractAliases(parsed.frontmatter));
    vault.db.wikilinks.deleteByNote(upsert.id);
    insertWikilinks(vault, upsert.id, parsed.wikilinks);
    return {
      status: "indexed",
      notePath: parsed.relativePath,
      noteId: upsert.id,
      chunksCreated: 0,
      isNew: false,
    };
  }

  // 5. Active model lookup + dimension contract check. The full indexer
  //    upserts the model row; here we require it to already exist (caller
  //    should run a full index first if not).
  const activeModel = vault.db.models.getActive();
  if (!activeModel) {
    throw new Error(
      `single-indexer: no active embedding model in DB. ` +
        `Run a full index first to register "${embeddingModel}".`,
    );
  }
  if (activeModel.name !== embeddingModel) {
    throw new Error(
      `single-indexer: active model "${activeModel.name}" does not match ` +
        `requested "${embeddingModel}". Run a full re-index to switch models.`,
    );
  }

  // 6. Upsert note row + aliases.
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
  vault.db.aliases.setForNote(upsert.id, extractAliases(parsed.frontmatter));

  // 7. Wipe derived layer for this note.
  vault.db.chunks.deleteByNote(upsert.id);
  vault.db.wikilinks.deleteByNote(upsert.id);

  // 8. Chunk + embed + persist.
  const chunks = chunkNote(parsed.content);

  if (chunks.length === 0) {
    insertWikilinks(vault, upsert.id, parsed.wikilinks);
    return {
      status: "indexed",
      notePath: parsed.relativePath,
      noteId: upsert.id,
      chunksCreated: 0,
      isNew: upsert.isNew,
    };
  }

  const chunkIds = vault.db.chunks.insertBatch(
    upsert.id,
    chunks.map((c) => ({
      idx: c.idx,
      text: c.text,
      headingPath: c.headingPath,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      tokenCount: c.tokenCount,
    })),
  );

  const embedResult = await ollama.embed({
    model: embeddingModel,
    texts: chunks.map((c) => c.text),
  });
  if (embedResult.dim !== activeModel.dim) {
    throw new Error(
      `single-indexer: embedding dim ${embedResult.dim} does not match ` +
        `registered dim ${activeModel.dim} for model "${embeddingModel}".`,
    );
  }

  vault.db.embeddings.insertBatch(
    chunkIds.map((chunkId, i) => ({
      chunkId,
      modelId: activeModel.id,
      vector: embedResult.vectors[i]!,
    })),
  );

  // Phase 7c: keep the shadow index live. Only embed if the secondary model
  // is already registered (i.e. a full indexVault run has set it up). We
  // never register a new model from a single-note path — the dim probe is
  // a full-indexer responsibility.
  if (secondaryName) {
    const secondaryModel = vault.db.models.getByName(secondaryName);
    if (secondaryModel && secondaryModel.id !== activeModel.id) {
      const secEmbed = await ollama.embed({
        model: secondaryName,
        texts: chunks.map((c) => c.text),
      });
      if (secEmbed.dim !== secondaryModel.dim) {
        throw new Error(
          `single-indexer: shadow embedding dim ${secEmbed.dim} ` +
            `does not match registered dim ${secondaryModel.dim} for ` +
            `"${secondaryName}".`,
        );
      }
      vault.db.embeddings.insertBatch(
        chunkIds.map((chunkId, i) => ({
          chunkId,
          modelId: secondaryModel.id,
          vector: secEmbed.vectors[i]!,
        })),
      );
    }
  }

  insertWikilinks(vault, upsert.id, parsed.wikilinks);

  return {
    status: "indexed",
    notePath: parsed.relativePath,
    noteId: upsert.id,
    chunksCreated: chunks.length,
    isNew: upsert.isNew,
  };
}

/**
 * Remove a note from the index (note row + cascade: chunks, embeddings,
 * wikilinks, aliases). Does NOT touch the file on disk.
 */
export function removeNote(
  vault: Vault,
  absolutePath: string,
): { removed: boolean; notePath: string | null } {
  if (!isInsideVault(absolutePath, vault.config.path)) {
    return { removed: false, notePath: null };
  }
  const relativePath = toRelativePosix(absolutePath, vault.config.path);

  const existing = vault.db.notes.getByPath(relativePath);
  if (!existing) {
    return { removed: false, notePath: null };
  }
  vault.db.notes.deleteByPath(relativePath);
  return { removed: true, notePath: relativePath };
}

// ───────────────────────────────────────────────────────────────────────────
// helpers
// ───────────────────────────────────────────────────────────────────────────

function emptyResult(status: "outside_vault" | "missing" | "parse_error"): IndexNoteResult {
  return {
    status,
    notePath: null,
    noteId: null,
    chunksCreated: 0,
    isNew: false,
  };
}

function isInsideVault(absolutePath: string, vaultRoot: string): boolean {
  const absResolved = path.resolve(absolutePath);
  const rootResolved = path.resolve(vaultRoot);
  const absPosix = absResolved.split(path.sep).join("/");
  const rootPosix = rootResolved.split(path.sep).join("/");
  const rootWithSep = rootPosix.endsWith("/") ? rootPosix : `${rootPosix}/`;
  return absPosix === rootPosix || absPosix.startsWith(rootWithSep);
}

function toRelativePosix(absolutePath: string, vaultRoot: string): string {
  return path
    .relative(path.resolve(vaultRoot), path.resolve(absolutePath))
    .split(path.sep)
    .join("/");
}

function isENOENT(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "ENOENT"
  );
}

/**
 * Mirror of indexer.ts `insertWikilinks` — kept private to avoid widening
 * that module's public API. Single-indexer skips the second-pass resolution,
 * so unresolved targets remain broken until a full index runs.
 */
function insertWikilinks(vault: Vault, sourceNoteId: number, wikilinks: ParsedWikilink[]): void {
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
