/**
 * VaultWatcher — chokidar-driven incremental re-indexing.
 *
 * Lifecycle: start() opens a chokidar watcher on the vault path, routes
 * change/add/unlink events through a DebouncedQueue, and on flush invokes
 * indexNote / removeNote.
 *
 * Suppression: writes from the MCP server itself (writeNote, deleteNote,
 * updateFrontmatter) mark the path on a shared SuppressionSet just before
 * touching the filesystem. The watcher checks + consumes the entry; if
 * present, the event is dropped. This prevents endless write→watch→reindex
 * loops.
 */

import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import { sep as nativeSep } from "node:path";
import type { Vault } from "../../../vault/index.js";
import type { OllamaClient } from "../../../ollama/index.js";
import { indexNote, removeNote } from "../../../indexer/index.js";
import { DebouncedQueue, type QueueEvent } from "./queue.js";
import type { SuppressionSet } from "./suppression.js";
import { buildChokidarOptions } from "./chokidar-config.js";
import { errorMessage } from "../../../errors/format.js";

export interface VaultWatcherOptions {
  vault: Vault;
  embeddingModel: string;
  /** Phase 7c: optional shadow model name; passed through to indexNote so
   *  the secondary index stays current on live file edits. Silently
   *  ignored if the model is not yet registered in the DB. */
  secondaryEmbeddingModel?: string;
  ollama: OllamaClient;
  suppression: SuppressionSet;
  /** Debounce window (ms) for coalescing rapid file changes. Default 500. */
  debounceMs?: number;
  /** Log sink — defaults to stderr. */
  log?: (msg: string) => void;
}

export class VaultWatcher {
  private fsWatcher: FSWatcher | null = null;
  private queue: DebouncedQueue;
  private readonly opts: Required<
    Omit<VaultWatcherOptions, "log" | "debounceMs" | "secondaryEmbeddingModel">
  > & {
    log: (msg: string) => void;
    debounceMs: number;
    secondaryEmbeddingModel: string | undefined;
  };
  private started = false;
  /** ADR-008: debounce timer for ContextFit KB re-ingest (coalesces bursts). */
  private cfReingestTimer: ReturnType<typeof setTimeout> | null = null;
  private cfReingestInFlight = false;

  constructor(options: VaultWatcherOptions) {
    this.opts = {
      vault: options.vault,
      embeddingModel: options.embeddingModel,
      secondaryEmbeddingModel: options.secondaryEmbeddingModel,
      ollama: options.ollama,
      suppression: options.suppression,
      debounceMs: options.debounceMs ?? 500,
      log: options.log ?? ((m) => process.stderr.write(`[watcher] ${m}\n`)),
    };

    this.queue = new DebouncedQueue({
      debounceMs: this.opts.debounceMs,
      maxLatencyMs: 5000,
      onFlush: (event) => this.handleFlush(event),
      onError: (event, err) => {
        const message = errorMessage(err);
        this.opts.log(`error processing ${event.path}: ${message}`);
      },
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    const vaultPath = this.opts.vault.config.path;
    const excludes = this.opts.vault.config.exclude_globs ?? [];

    this.fsWatcher = chokidar.watch(vaultPath, buildChokidarOptions(vaultPath, excludes));

    this.fsWatcher.on("add", (path) => this.onFsEvent(path, "change"));
    this.fsWatcher.on("change", (path) => this.onFsEvent(path, "change"));
    this.fsWatcher.on("unlink", (path) => this.onFsEvent(path, "delete"));
    this.fsWatcher.on("error", (err) => {
      const message = errorMessage(err);
      this.opts.log(`fs watcher error: ${message}`);
    });

    await new Promise<void>((resolve) => {
      this.fsWatcher!.once("ready", () => resolve());
    });

    this.started = true;
    this.opts.log(`watching ${vaultPath}`);
  }

  /** Force-process any pending events. Used during shutdown. */
  async drain(): Promise<void> {
    await this.queue.flushAll();
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.queue.shutdown();
    if (this.cfReingestTimer) {
      clearTimeout(this.cfReingestTimer);
      this.cfReingestTimer = null;
    }
    if (this.fsWatcher) {
      await this.fsWatcher.close();
      this.fsWatcher = null;
    }
  }

  // ─── internal ──────────────────────────────────────────────────────────

  /**
   * ADR-008: schedule a debounced full ContextFit KB re-ingest. Per-note
   * changes update the SQLite layer immediately (via indexNote); the ContextFit
   * search KB is rebuilt in one coalesced pass ~1.5s after the last change so a
   * burst of edits triggers a single re-ingest. CPU-only and fast.
   */
  private scheduleContextFitReingest(): void {
    if (this.cfReingestTimer) clearTimeout(this.cfReingestTimer);
    this.cfReingestTimer = setTimeout(() => {
      this.cfReingestTimer = null;
      void this.runContextFitReingest();
    }, 1500);
  }

  private async runContextFitReingest(): Promise<void> {
    if (this.cfReingestInFlight) {
      // A re-ingest is already running; schedule another pass after it so the
      // latest changes are captured.
      this.scheduleContextFitReingest();
      return;
    }
    this.cfReingestInFlight = true;
    try {
      const { indexVaultWithContextFit } = await import("../../retrieval/contextfit/index.js");
      const r = await indexVaultWithContextFit(this.opts.vault.config, {});
      if (r.status === "completed") {
        this.opts.log(`ContextFit KB refreshed (${r.durationMs}ms)`);
      } else if (r.status === "skipped") {
        // Issue #17: another process is mid-ingest; it will do a trailing pass.
        this.opts.log(`ContextFit KB refresh skipped (another ingest in progress; flagged)`);
      } else {
        this.opts.log(`ContextFit KB refresh failed: ${r.error}`);
      }
    } catch (err) {
      this.opts.log(
        `ContextFit KB refresh error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.cfReingestInFlight = false;
    }
  }

  private onFsEvent(absolutePath: string, kind: "change" | "delete"): void {
    // Filter to .md only — Obsidian writes other artifacts (.obsidian/*) that
    // we either don't care about or already excluded.
    if (!absolutePath.endsWith(".md")) return;

    const relativePath = this.toRelative(absolutePath);

    // Suppression: was this just written by the MCP server itself?
    if (this.opts.suppression.consume(relativePath)) {
      this.opts.log(`suppressed ${kind} ${relativePath} (own write)`);
      return;
    }

    this.queue.enqueue({ path: absolutePath, kind });
  }

  private toRelative(absolutePath: string): string {
    const root = this.opts.vault.config.path;
    let rel = absolutePath;
    if (rel.startsWith(root)) rel = rel.slice(root.length);
    if (rel.startsWith(nativeSep) || rel.startsWith("/")) rel = rel.slice(1);
    return rel.split(nativeSep).join("/");
  }

  private async handleFlush(event: QueueEvent): Promise<void> {
    const relativePath = this.toRelative(event.path);

    const isContextFit = this.opts.vault.config.backend === "contextfit";

    if (event.kind === "delete") {
      const result = removeNote(this.opts.vault, event.path);
      if (result.removed) {
        this.opts.log(`removed ${relativePath}`);
        // ADR-008: a deleted note must drop out of the ContextFit KB too.
        if (isContextFit) this.scheduleContextFitReingest();
      } else {
        this.opts.log(`delete event for unknown ${relativePath} (skip)`);
      }
      return;
    }

    const result = await indexNote({
      vault: this.opts.vault,
      absolutePath: event.path,
      embeddingModel: this.opts.embeddingModel,
      secondaryEmbeddingModel: this.opts.secondaryEmbeddingModel,
      // ADR-008: ContextFit vaults build the SQLite layer without embeddings;
      // their search KB is refreshed by the debounced re-ingest below.
      ...(isContextFit ? { embeddings: "none" as const } : { ollama: this.opts.ollama }),
    });

    switch (result.status) {
      case "indexed":
        this.opts.log(
          `indexed ${relativePath} (${result.isNew ? "new" : "updated"}, ${result.chunksCreated} chunks)`,
        );
        // ADR-008: refresh the ContextFit search KB (debounced full re-ingest).
        if (isContextFit) this.scheduleContextFitReingest();
        break;
      case "unchanged":
        // Common when chokidar fires for a re-save with no content delta —
        // log at debug level (skip entirely for now).
        break;
      case "outside_vault":
        this.opts.log(`event for path outside vault ignored: ${event.path}`);
        break;
      case "missing":
        // File disappeared between event and parse — treat as delete.
        this.opts.log(`file missing on parse — removing ${relativePath}`);
        removeNote(this.opts.vault, event.path);
        break;
    }
  }
}
