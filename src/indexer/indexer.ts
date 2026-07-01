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
import { scanVault } from "../adapters/source/obsidian-fs/scanner.js";
import { parseNote } from "../adapters/source/obsidian-fs/parser.js";
import { chunkNote } from "../chunker/index.js";
import { computeChunkIdFragment } from "../chunker/chunk-id.js";
import { OllamaClient } from "../ollama/index.js";
import type { Vault } from "../vault/index.js";
import type {
  ChunkRow,
  InsertSectionRow,
  ParsedNote,
  ParsedWikilink,
  SectionInfo,
} from "../types.js";
import { WikilinkResolver } from "./resolver.js";
import { extractAllEdges } from "./extract-edges.js";
import { extractSections, markdownToSectionBlocks } from "../sections/index.js";
import { extractHeadings } from "../chunker/headings.js";
import { errorMessage } from "../errors/format.js";

export interface IndexerOptions {
  mode?: "full" | "incremental";
  embeddingModel: string;
  /** Phase 7c: optional secondary (shadow) embedding model. When set, every
   *  chunk is embedded with BOTH the primary and the secondary model in
   *  parallel. Stored in separate `embeddings_<dim>` tables so search and
   *  the active model are unaffected. Used by `/setup-memory-system` and
   *  the watcher to keep a shadow index live for a future model switch. */
  secondaryEmbeddingModel?: string;
  /** Ollama client. Required when `embeddings !== "none"`. ContextFit-backed
   *  vaults pass `embeddings: "none"` and may omit this (no Ollama needed). */
  ollama?: OllamaClient;
  /** ADR-008: embedding strategy.
   *  - "ollama" (default): build the full SQLite layer AND embed chunks into
   *    sqlite-vec (the classic path).
   *  - "none": build the full SQLite content layer (notes, chunks, sections,
   *    wikilinks, edges, audit) but SKIP embedding + model registration. Used
   *    by ContextFit vaults, whose search runs through the ContextFit engine —
   *    the SQLite layer still powers graph/sections/frontmatter/stats tools. */
  embeddings?: "ollama" | "none";
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
  // ADR-008: "none" builds the SQLite content layer but skips embedding +
  // model registration (ContextFit vaults). "ollama" is the classic path.
  const embedMode = options.embeddings ?? "ollama";
  const ollama = options.ollama;

  // 1. Resolve / upsert model in DB — ONLY for the Ollama embedding path.
  // ContextFit vaults register no model and need no Ollama at all.
  let dim = 0;
  let modelRow: { id: number } | null = null;
  let secondaryModelRow: { id: number; dim: number } | null = null;

  if (embedMode === "ollama") {
    if (!ollama) {
      throw new Error("indexVault: embeddings='ollama' requires an OllamaClient (options.ollama).");
    }
    log(`Probing Ollama model: ${options.embeddingModel}`);
    const health = await ollama.healthCheck();
    if (!health.ok) {
      throw new Error(`Ollama unreachable: ${health.error ?? "unknown error"}`);
    }
    const modelExists = await ollama.modelExists(options.embeddingModel);
    if (!modelExists) {
      throw new Error(
        `Embedding model "${options.embeddingModel}" not found in Ollama. ` +
          `Available: ${health.models?.join(", ") ?? "(none)"}. ` +
          `Run: ollama pull ${options.embeddingModel}`,
      );
    }

    // Probe dim with a 1-text embed (cheap)
    const probe = await ollama.embed({
      model: options.embeddingModel,
      texts: ["probe"],
    });
    dim = probe.dim;
    modelRow = vault.db.models.upsert({
      name: options.embeddingModel,
      provider: "ollama",
      dim,
    });

    // Phase 7c: secondary (shadow) model registration. We probe + upsert with
    // active=false so the primary stays active. Probing also fails fast if the
    // model isn't pulled — better than discovering that mid-run on note 5000.
    if (options.secondaryEmbeddingModel) {
      const secName = options.secondaryEmbeddingModel;
      log(`Probing secondary (shadow) model: ${secName}`);
      const secExists = await ollama.modelExists(secName);
      if (!secExists) {
        throw new Error(
          `Secondary embedding model "${secName}" not found in Ollama. ` +
            `Run: ollama pull ${secName}`,
        );
      }
      const secProbe = await ollama.embed({
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
  }

  vault.db.audit.startRun({
    runId,
    vaultName: vault.config.name,
    modelId: modelRow?.id ?? null,
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
          // Phase 4 / 04-01 (D-01): dual-write mirror.
          vault.db.edges.deleteByNote(n.id);
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
      // Issue #14 / P1: read the PRE-upsert state so we can make a correct
      // re-index decision. `upsertByPath` mutates notes.hash/content in place,
      // so we must capture the previous hashes BEFORE it runs — otherwise a
      // changed body keeps stale chunks/embeddings/sections/edges (the bug).
      // Mirrors the 3-way decision in `src/indexer/single.ts`:
      //   - hash unchanged            → no re-embed (metadata maintenance only)
      //   - body_hash unchanged       → frontmatter-only edit: keep chunks
      //   - body changed / NULL body_hash → full re-embed
      const previous = vault.db.notes.getByPath(parsed.relativePath);
      const hashUnchanged = previous != null && previous.hash === parsed.hash;
      const bodyUnchanged =
        previous != null &&
        previous.body_hash != null &&
        previous.body_hash === parsed.bodyHash;

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

      // Phase 3 / 03-01 (M4): maintain the denormalized notes.status
      // column in sync with the frontmatter on every write. The
      // migration-time backfill populates this for existing notes;
      // this call keeps it correct for new writes and re-indexes.
      // Done unconditionally (every run, not just on reindex) so an
      // alias-only frontmatter edit that flips status also propagates.
      vault.db.notes.setStatus(upsert.id, extractStatus(parsed.frontmatter));

      // Persist aliases from frontmatter. We do this every run (not just on
      // reindex) so alias-only frontmatter edits propagate even when the body
      // is unchanged. The set is idempotent: setForNote does delete+insert.
      vault.db.aliases.setForNote(upsert.id, extractAliases(parsed.frontmatter));

      // A note with zero chunks still needs (re-)indexing even if its hash
      // matched — e.g. a previous run inserted the row but crashed before
      // chunking, or a legacy row predates the chunk layer.
      const chunkCount = vault.db.chunks.getByNote(upsert.id).length;

      // Full re-embed when: full mode, brand-new note, no chunks yet, OR the
      // body actually changed (hash differs AND body_hash differs / is NULL).
      const bodyChanged = !hashUnchanged && !bodyUnchanged;
      const needsReindex =
        mode === "full" || upsert.isNew || chunkCount === 0 || bodyChanged;

      // Frontmatter-only edit (hash changed, body identical): the note row +
      // status + aliases are already updated above. We must ALSO refresh
      // wikilinks + typed edges (frontmatter can hold wikilink-shaped refs
      // like `owner: "[[X]]"`), but we KEEP chunks/embeddings/sections —
      // no Ollama roundtrip. Mirrors single.ts step 4b.
      const frontmatterOnly = !upsert.isNew && !needsReindex && !hashUnchanged;

      if (upsert.isNew) notesIndexed++;
      else if (needsReindex || frontmatterOnly) notesUpdated++;

      if (needsReindex) {
        parsedNotes.push({ parsed, noteId: upsert.id, needsReindex: true });
      } else if (frontmatterOnly) {
        vault.db.wikilinks.deleteByNote(upsert.id);
        vault.db.edges.deleteByNote(upsert.id);
        insertWikilinks(vault, upsert.id, parsed.wikilinks, firstPassResolver);
        writeAllEdges(vault, upsert.id, parsed, firstPassResolver);
      }
    }

    log(`${parsedNotes.length} notes need (re-)indexing`);

    // 5. Chunk + embed + persist
    for (const { parsed, noteId } of parsedNotes) {
      // Clear derived layer for this note. Sections FIRST — sections
      // reference chunks via chunk_id_first/last with no ON DELETE cascade,
      // so deleting chunks while sections still point at them trips a
      // FOREIGN KEY constraint. Ordering matches single.ts step 7. (Before
      // Issue #14's P1 fix this path only ran for brand-new notes, which
      // have no sections yet — so the wrong order never surfaced. It does
      // now that changed notes are correctly re-indexed.)
      vault.db.sections.deleteByNote(noteId);
      vault.db.chunks.deleteByNote(noteId);
      vault.db.wikilinks.deleteByNote(noteId);
      // Phase 4 / 04-01 (D-01): dual-write mirror.
      vault.db.edges.deleteByNote(noteId);

      const chunks = chunkNote(parsed.indexedContent);

      if (chunks.length === 0) {
        // empty note — record wikilinks anyway, but no chunks/embeddings
        insertWikilinks(vault, noteId, parsed.wikilinks, firstPassResolver);
        // Phase 4 / 04-02 / GRA-04 / D-02: also emit typed edges for
        // frontmatter-ref / hyperlink / mention. A note with only
        // frontmatter (no body) can still contribute owner / attendees
        // edges to the graph.
        writeAllEdges(vault, noteId, parsed, firstPassResolver);
        continue;
      }

      // Insert chunks first to get IDs.
      // Phase 5 / D-05: compute chunk_id_fragment via the canonical
      // helper (`src/chunker/chunk-id.ts`) at every insert path.
      // Scattered createHash calls are an anti-pattern (RESEARCH §Pitfall 14).
      const chunkInputs = chunks.map((c) => ({
        idx: c.idx,
        text: c.text,
        headingPath: c.headingPath,
        startOffset: c.startOffset,
        endOffset: c.endOffset,
        tokenCount: c.tokenCount,
        chunkIdFragment: computeChunkIdFragment(c.text),
      }));
      const chunkIds = vault.db.chunks.insertBatch(noteId, chunkInputs);

      // Phase 3 / 03-01: extract + persist sections. Runs AFTER chunks
      // are inserted so chunk IDs exist (sections.chunk_id_first/last
      // reference chunks.id). The chunk-to-section binning uses the
      // chunker's start_offset to find each chunk's owning heading
      // region. Sections of a heading with no body content get
      // chunk_id_first = chunk_id_last = NULL.
      // Defensive: section building must never abort the whole vault index
      // because of one pathological note. The duplicate-anchor crash is
      // handled at the insert layer (insertOneResolving); this catch covers
      // any other unexpected failure — log and continue with the rest of the
      // vault (see ISSUE-indexer-duplicate-anchor.md "Notes for the agent").
      try {
        buildSectionsForNote(vault, noteId, parsed.indexedContent, chunkIds);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[indexer:${vault.config.name}] section build failed for ${parsed.relativePath}: ${message} — skipping sections for this note`,
        );
      }

      // Embed — ONLY in the Ollama path. ContextFit vaults (embedMode "none")
      // skip this entirely: chunks + sections + links + edges are persisted
      // above; search runs through the ContextFit engine, not sqlite-vec.
      if (embedMode === "ollama") {
        const embedResult = await ollama!.embed({
          model: options.embeddingModel,
          texts: chunks.map((c) => c.text),
        });
        if (embedResult.dim !== dim) {
          throw new Error(`Embedding dimension mismatch: expected ${dim}, got ${embedResult.dim}`);
        }

        const embeddingInputs = chunkIds.map((chunkId, i) => ({
          chunkId,
          modelId: modelRow!.id,
          vector: embedResult.vectors[i]!,
        }));
        vault.db.embeddings.insertBatch(embeddingInputs);

        // Phase 7c: shadow-index pass. Embed each chunk a second time with
        // the secondary model and persist into its dim-specific table.
        // Independent failure surface: if secondary embed throws, the primary
        // index for this run still completes — the secondary will be retried
        // on the next index run (idempotent: LEFT JOIN in start_shadow_index).
        if (secondaryModelRow) {
          const secEmbed = await ollama!.embed({
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
      }

      // Wikilinks (v1 invariant write path — D-01)
      insertWikilinks(vault, noteId, parsed.wikilinks, firstPassResolver);
      // Phase 4 / 04-02 / GRA-04 / D-02: typed-edge unified write.
      writeAllEdges(vault, noteId, parsed, firstPassResolver);

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
    const message = errorMessage(err);
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
  // Phase 4 / 04-02 / GRA-04 / D-02 — the unified edge write is no
  // longer co-located here. `writeAllEdges` (called immediately
  // after this helper at every call site) produces the full typed
  // edge mix in a single pass, sharing this same `WikilinkResolver`
  // so cache lookups are not duplicated. The legacy `wikilinks`
  // table write above stays for v1 invariance per D-01.
}

/**
 * Phase 4 / 04-02 / GRA-04 / D-02 — emit all four typed edges into
 * `vault.db.edges`. Callers MUST have already issued
 * `vault.db.edges.deleteByNote(sourceNoteId)` for a clean replace;
 * the UNIQUE index on `(source_doc, target_doc, type, anchor)` +
 * `INSERT OR IGNORE` makes the write idempotent regardless.
 *
 * The full-index path passes its long-lived `firstPassResolver` so
 * the wikilink-edge resolution shares the same cache as the
 * frontmatter-ref rule-(a) lookups. Plan 04-01's second-pass broken-
 * link resolver (`secondPassResolver`) only mutates the `wikilinks`
 * table — Plan 04-03 will lift that into `edges` if needed.
 */
function writeAllEdges(
  vault: Vault,
  sourceNoteId: number,
  parsed: ParsedNote,
  resolver: WikilinkResolver,
): void {
  const edges = extractAllEdges(vault, parsed, resolver);
  if (edges.length > 0) vault.db.edges.insertBatch(sourceNoteId, edges);
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

/**
 * Phase 3 / 03-01: extract the `status` value from a parsed
 * frontmatter object. Accepts any string value; returns null when
 * absent / non-string. The denormalized `notes.status` column is
 * read by 03-05's SQL-level superseded filter.
 */
export function extractStatus(frontmatter: Record<string, unknown> | null): string | null {
  if (!frontmatter) return null;
  const raw = frontmatter["status"];
  if (typeof raw === "string") return raw;
  return null;
}

/**
 * Phase 3 / 03-01: extract sections for a note and persist them.
 *
 * Sections are materialized from the SAME `notes.content` bytes the
 * chunker just consumed — `markdownToSectionBlocks` → `extractSections`
 * runs on the unmodified parsed body. The resulting `SectionInfo[]`
 * gets `chunk_id_first` / `chunk_id_last` filled in by walking the
 * inserted chunk IDs and binning each chunk into the section whose
 * source-offset window contains the chunk's `start_offset`.
 *
 * Sibling: `backfillSectionsFromChunks` does the same operation for
 * existing v1 notes at migration time. Both code paths run the same
 * pipeline against the same `content` bytes → identical anchors
 * (anchor-equivalence proven in
 * `src/sections/backfill.test.ts`).
 */
export function buildSectionsForNote(
  vault: Vault,
  noteId: number,
  content: string,
  insertedChunkIds: number[],
): number {
  if (content.length === 0) return 0;
  const blocks = markdownToSectionBlocks(content);
  const sections = extractSections(blocks);
  if (sections.length === 0) return 0;

  // Hydrate just-inserted chunks so we can bin by start_offset. The
  // `getByNote` query returns chunks in `idx` order — same as
  // `insertedChunkIds`. We pass the chunk rows through to the helper
  // so the helper itself is pure (no DB dep).
  const chunkRows = vault.db.chunks.getByNote(noteId);
  // Defensive sanity: chunk count must match.
  if (chunkRows.length !== insertedChunkIds.length) {
    // This should never happen — chunkInputs went in via insertBatch
    // and we read them right back. If it does, the section ranges are
    // best-effort but the anchors are still correct.
  }

  const sectionRanges = computeSectionOffsetRanges(content, sections);
  const rangePairs = mapChunksToSections(chunkRows, sectionRanges);

  // Materialize rows: parent_id is filled in via the inserted-id map
  // (the in-memory `SectionInfo.parent_index` is an array index).
  // Duplicate-anchor sibling sections (two H2s GitHub-slugify to the same
  // anchor) would collide on UNIQUE(note_id, anchor). `insertOneResolving`
  // collapses later siblings into the first one's row and returns that
  // surviving id, so a single offending note can't abort the whole index
  // run (see ISSUE-indexer-duplicate-anchor.md). `null` is possible in
  // theory (insert ignored AND lookup miss) — mirror the backfill type.
  const insertedIds: Array<number | null> = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    const parentId = s.parent_index === null ? null : (insertedIds[s.parent_index] ?? null);
    const pair = rangePairs[i] ?? { first: null, last: null };
    const row: InsertSectionRow = {
      note_id: noteId,
      anchor: s.anchor,
      heading_path: JSON.stringify(s.heading_path),
      heading_text: s.heading_text,
      level: s.level,
      parent_id: parentId,
      ord: s.ord,
      chunk_id_first: pair.first,
      chunk_id_last: pair.last,
    };
    insertedIds.push(vault.db.sections.insertOneResolving(row));
  }
  return insertedIds.length;
}

/**
 * Phase 3 / 03-01: pure helper that bins each chunk into the section
 * whose source-offset range contains its `start_offset`. Returns the
 * `{first, last}` chunk-id pair per section index (in the order of
 * the `sectionRanges` array). Sections with no contained chunks get
 * `{first: null, last: null}`.
 *
 * Exported for unit testing.
 */
export function mapChunksToSections(
  chunks: ChunkRow[],
  sectionRanges: Array<{ start: number; end: number }>,
): Array<{ first: number | null; last: number | null }> {
  const out: Array<{ first: number | null; last: number | null }> = sectionRanges.map(() => ({
    first: null,
    last: null,
  }));
  for (const chunk of chunks) {
    const offset = chunk.start_offset;
    let chosenIdx: number | null = null;
    // Walk in reverse so the innermost (deepest) section wins.
    for (let i = sectionRanges.length - 1; i >= 0; i--) {
      const r = sectionRanges[i];
      if (!r) continue;
      if (offset >= r.start && offset < r.end) {
        chosenIdx = i;
        break;
      }
    }
    if (chosenIdx === null) continue;
    const slot = out[chosenIdx]!;
    if (slot.first === null || chunk.id < slot.first) slot.first = chunk.id;
    if (slot.last === null || chunk.id > slot.last) slot.last = chunk.id;
  }
  return out;
}

/**
 * Compute the [start, end) byte range for each section in `content`.
 * Mirrors `src/sections/backfill.ts:computeSectionOffsetRanges`. Kept
 * here (not imported) so the indexer doesn't reach into the
 * backfill module's private surface — both implementations share
 * `src/chunker/headings.ts:extractHeadings` as the canonical heading
 * source, which is what guarantees they agree byte-for-byte.
 */
function computeSectionOffsetRanges(
  content: string,
  sections: SectionInfo[],
): Array<{ start: number; end: number }> {
  const headings = extractHeadings(content);
  const ranges: Array<{ start: number; end: number }> = [];
  const hasPreamble =
    sections.length > 0 && sections[0]!.level === 0 && sections[0]!.heading_text === "";
  const firstHeadingOffset = headings.length === 0 ? content.length : headings[0]!.startOffset;
  if (hasPreamble) {
    ranges.push({ start: 0, end: firstHeadingOffset });
  }
  for (let h = 0; h < headings.length; h++) {
    const h0 = headings[h]!;
    let endOffset = content.length;
    for (let j = h + 1; j < headings.length; j++) {
      if (headings[j]!.level <= h0.level) {
        endOffset = headings[j]!.startOffset;
        break;
      }
    }
    ranges.push({ start: h0.startOffset, end: endOffset });
  }
  while (ranges.length < sections.length) {
    ranges.push({ start: 0, end: content.length });
  }
  return ranges;
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
