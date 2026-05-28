/**
 * ObsidianFsChangeFeed — the ChangeFeed adapter for filesystem-backed
 * Obsidian vaults (ADR-002 §ChangeFeed; plan 01-05 task 02).
 *
 * # What this is
 *
 * The watch seam. Subscribers receive `ChangeEvent`s as the underlying
 * filesystem changes. Internally backed by a chokidar watcher configured
 * via the shared `buildChokidarOptions` helper (`./chokidar-config.ts`)
 * — the SAME four-field config used by the v1 `VaultWatcher`, preserved
 * BYTE-FOR-BYTE from v1 per RESEARCH Pitfall 6:
 *
 *   - awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
 *   - ignored:          [/(^|[\\/])\../, "**\/*.tmp.*"] (+ caller excludes)
 *   - followSymlinks:   false
 *   - ignoreInitial:    true
 *
 * Modifying these values breaks the suppression-set integration. The
 * conformance test ("suppression marker registered → no ChangeEvent
 * emitted") is the safety net.
 *
 * # Event mapping
 *
 *   chokidar `add`    → ChangeEvent { kind: "create", id, at }
 *   chokidar `change` → ChangeEvent { kind: "update", id, at }
 *   chokidar `unlink` → ChangeEvent { kind: "delete", id, at }
 *
 * Rename emission is DEFERRED to Phase 4 (RESEARCH A3 / Risk #3) — a
 * true OS-level rename surfaces in chokidar as `unlink` + `add` and
 * Phase 1 keeps that v1 behavior. `ChangeFeedCapabilities.emitsRename`
 * is FALSE for honest publication per Invariant I-7.
 *
 * # Suppression-set integration (Pitfall 6)
 *
 * The MCP server marks paths on a shared `SuppressionSet` immediately
 * before atomic-rename writes (see `handleWriteNote` / `handleDelete` /
 * `handleUpdateFrontmatter` in `src/server.ts`). On every chokidar event,
 * this feed checks `suppression.consume(relativePath)` first; if hit,
 * the event is dropped. This prevents the write → watch → re-index loop.
 *
 * # Filtering
 *
 * Only `.md` files emit events. Other artifacts (`.obsidian/*`, lock
 * files, etc.) are filtered by either chokidar's `ignored` regex or a
 * post-event suffix check — same as v1.
 *
 * # Lifecycle
 *
 * - `subscribe(handler)` registers a handler; multiple subscribers each
 *   get a copy of every event. Returns a `Disposable` whose
 *   `Symbol.dispose` unregisters the handler synchronously.
 * - `close()` is idempotent. After close, no more events fire. Future
 *   `subscribe` calls register but receive no events (the watcher is
 *   gone). The conformance suite gates this assertion on
 *   `capabilities.watch === "push"`.
 *
 * # Coexistence with v1 VaultWatcher
 *
 * Phase 1 wires BOTH the v1 `VaultWatcher` (live-indexing path, drives
 * indexNote/removeNote) AND this `ObsidianFsChangeFeed` (registry-
 * exposed ChangeFeed seam, used by conformance tests + future Phase 2+
 * indexer rewiring) into the bootstrap. Both watch the same vault with
 * the SAME chokidar options — duplicate event volume, but each event is
 * cheap and suppression filters own-writes in both watchers. A future
 * plan will retire the v1 VaultWatcher in favor of an indexer that
 * subscribes through the ChangeFeed seam directly (RESEARCH §Recommended
 * Decomposition note).
 */

import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import { sep as nativeSep } from "node:path";
import type { Vault } from "../../../vault/index.js";
import type { ChangeEvent, DocId, SourceHandle } from "../../../types.js";
import type { ChangeFeed, ChangeFeedCapabilities, Disposable } from "../types.js";
import { formatDocId, parseSourceHandle } from "../../registry.js";
import { SuppressionSet } from "./suppression.js";
import { buildChokidarOptions } from "./chokidar-config.js";
import { errorMessage } from "../../../errors/format.js";

const SCHEME = "obsidian-fs";

export interface ObsidianFsChangeFeedOptions {
  /** Vault providing config (path + name + exclude_globs). */
  vault: Vault;
  /**
   * Shared with `ObsidianFsDelivery` so own-writes (atomic rename
   * artifacts) don't fire events. The delivery adapter adds the
   * vault-relative path before `atomicWriteFile`; this feed
   * `consume()`s on every chokidar event. (Pitfall 6 invariant.)
   */
  suppression: SuppressionSet;
  /** Optional stderr logger; defaults to silent. */
  log?: (msg: string) => void;
}

export class ObsidianFsChangeFeed implements ChangeFeed {
  readonly handle: SourceHandle;
  readonly capabilities: ChangeFeedCapabilities = {
    watch: "push",
    /**
     * Phase 1 emits delete+create rather than a tagged rename event.
     * Honest publication per Invariant I-7 — the conformance test
     * asserts no `{kind: "rename"}` event is observed when this flag
     * is false.
     */
    emitsRename: false,
  };

  private readonly vault: Vault;
  private readonly suppression: SuppressionSet;
  private readonly log: (msg: string) => void;
  private readonly handlers = new Set<(e: ChangeEvent) => void | Promise<void>>();
  private fsWatcher: FSWatcher | null = null;
  private startPromise: Promise<void> | null = null;
  private closed = false;

  constructor(options: ObsidianFsChangeFeedOptions) {
    this.vault = options.vault;
    this.suppression = options.suppression;
    this.log = options.log ?? ((_m) => {});
    this.handle = parseSourceHandle(`${SCHEME}://${this.vault.config.name}`);
  }

  subscribe(handler: (e: ChangeEvent) => void | Promise<void>): Disposable {
    if (this.closed) {
      // After close, register-but-never-fire is the contract floor for
      // the conformance suite. Returning an inert Disposable mirrors
      // what users get if they subscribe before start() has resolved.
      return { [Symbol.dispose]: () => void 0 };
    }
    this.handlers.add(handler);
    // Lazy start — first subscribe brings the watcher up. Subsequent
    // subscribes attach to the same watcher.
    if (!this.startPromise) {
      this.startPromise = this.start();
    }
    return {
      [Symbol.dispose]: () => {
        this.handlers.delete(handler);
      },
    };
  }

  /**
   * Wait until the chokidar watcher has reported "ready". Test-only
   * helper — the conformance test awaits this between `subscribe` and
   * its first synthetic event so the watcher has surveyed the dir.
   */
  async ready(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return; // idempotent
    this.closed = true;
    this.handlers.clear();
    if (this.fsWatcher) {
      await this.fsWatcher.close();
      this.fsWatcher = null;
    }
  }

  // ─── internal ──────────────────────────────────────────────────────────

  private async start(): Promise<void> {
    if (this.closed) return;
    const vaultPath = this.vault.config.path;
    const excludes = this.vault.config.exclude_globs ?? [];

    const watcher = chokidar.watch(vaultPath, buildChokidarOptions(vaultPath, excludes));
    this.fsWatcher = watcher;

    watcher.on("add", (absolutePath) => this.onFsEvent(absolutePath, "create"));
    watcher.on("change", (absolutePath) => this.onFsEvent(absolutePath, "update"));
    watcher.on("unlink", (absolutePath) => this.onFsEvent(absolutePath, "delete"));
    watcher.on("error", (err) => {
      const message = errorMessage(err);
      this.log(`fs watcher error: ${message}`);
    });

    await new Promise<void>((resolve) => {
      watcher.once("ready", () => resolve());
    });
  }

  private onFsEvent(absolutePath: string, kind: "create" | "update" | "delete"): void {
    if (this.closed) return;
    // Only emit for markdown files — same v1 filter.
    if (!absolutePath.endsWith(".md")) return;

    const relativePath = this.toRelative(absolutePath);

    // Pitfall 6: own-write suppression. The delivery adapter marked this
    // path on the shared SuppressionSet before its atomic rename; consume
    // the entry and drop the event so we don't loop.
    if (this.suppression.consume(relativePath)) {
      this.log(`suppressed ${kind} ${relativePath} (own write)`);
      return;
    }

    const id: DocId = formatDocId(SCHEME, this.vault.config.name, relativePath);
    const event: ChangeEvent = { kind, id, at: Date.now() };
    this.fanout(event);
  }

  private toRelative(absolutePath: string): string {
    const root = this.vault.config.path;
    let rel = absolutePath;
    if (rel.startsWith(root)) rel = rel.slice(root.length);
    if (rel.startsWith(nativeSep) || rel.startsWith("/")) rel = rel.slice(1);
    return rel.split(nativeSep).join("/");
  }

  private fanout(event: ChangeEvent): void {
    // Snapshot handlers before iterating — a handler may dispose during
    // its own callback, which would otherwise corrupt the iteration.
    for (const handler of [...this.handlers]) {
      try {
        const result = handler(event);
        if (result && typeof (result as Promise<void>).then === "function") {
          (result as Promise<void>).catch((err: unknown) => {
            const message = errorMessage(err);
            this.log(`handler error: ${message}`);
          });
        }
      } catch (err) {
        const message = errorMessage(err);
        this.log(`handler error: ${message}`);
      }
    }
  }
}
