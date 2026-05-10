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
import { posix } from "node:path";
import { sep as nativeSep } from "node:path";
import type { Vault } from "../vault/index.js";
import type { OllamaClient } from "../ollama/index.js";
import { indexNote, removeNote } from "../indexer/index.js";
import { DebouncedQueue, type QueueEvent } from "./queue.js";
import type { SuppressionSet } from "./suppression.js";

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
        const message = err instanceof Error ? err.message : String(err);
        this.opts.log(`error processing ${event.path}: ${message}`);
      },
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    const vaultPath = this.opts.vault.config.path;
    const excludes = this.opts.vault.config.exclude_globs ?? [];

    this.fsWatcher = chokidar.watch(vaultPath, {
      persistent: true,
      ignoreInitial: true, // we expect initial state via indexVault
      ignored: [
        // chokidar handles glob-like patterns. Provide both raw and absolute.
        ...excludes.map((g) => posix.join(vaultPath, g)),
        /(^|[\\/])\../, // hidden files at any level
        "**/*.tmp.*",   // our atomic-write artifacts
      ],
      // Only watch markdown files — saves event volume.
      // chokidar's `ignored` runs against absolute paths, so we filter via
      // an after-the-fact event check (cheaper than a glob).
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
      followSymlinks: false,
    });

    this.fsWatcher.on("add", (path) => this.onFsEvent(path, "change"));
    this.fsWatcher.on("change", (path) => this.onFsEvent(path, "change"));
    this.fsWatcher.on("unlink", (path) => this.onFsEvent(path, "delete"));
    this.fsWatcher.on("error", (err) => {
      const message = err instanceof Error ? err.message : String(err);
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
    if (this.fsWatcher) {
      await this.fsWatcher.close();
      this.fsWatcher = null;
    }
  }

  // ─── internal ──────────────────────────────────────────────────────────

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

    if (event.kind === "delete") {
      const result = removeNote(this.opts.vault, event.path);
      if (result.removed) {
        this.opts.log(`removed ${relativePath}`);
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
      ollama: this.opts.ollama,
    });

    switch (result.status) {
      case "indexed":
        this.opts.log(
          `indexed ${relativePath} (${result.isNew ? "new" : "updated"}, ${result.chunksCreated} chunks)`,
        );
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
