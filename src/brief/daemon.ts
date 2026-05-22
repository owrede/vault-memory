/**
 * Phase 5 / BRF-05/06/07/08 — `BriefStalenessDaemon`.
 *
 * In-process daemon that subscribes to the same `ChangeFeed` as the
 * `VaultWatcher` and flips affected briefs to `status: "stale"` when
 * chunk-hash divergence is observed.
 *
 * # Lifecycle (mirrors `VaultWatcher.start/stop`)
 *
 *   1. `start(vault, feed, deps)`:
 *        a. acquire `~/.vault-memory/locks/<vault>.lock`; on contention
 *           log structured WARN to stderr + audit (`daemon_already_owned`)
 *           and return early — second-server boots fine without a daemon.
 *        b. read `daemon_state.last_seen_doc_mtime` cursor (diagnostic).
 *        c. run a startup full scan over `brief_sources.listBriefDocIds()`
 *           and mark divergent briefs stale (D-09 correctness floor).
 *        d. subscribe to the feed for create/update/delete/rename events.
 *
 *   2. handler — on each ChangeEvent:
 *        - create/update → `evaluateChangedDocId(id)` (recompute hashes,
 *          flip divergent briefs stale via `delivery.update`).
 *        - delete → record in pendingDeletes (5s grace-window); when
 *          the grace-window expires without a matching create, mark
 *          briefs stale with reason `"source_deleted"`.
 *        - rename — adapter-native rename → update
 *          `brief_sources.chunk_doc_id` in place (BRF-08 preserve
 *          brief→source links).
 *
 *   3. `shutdown()` — dispose subscription FIRST, then releaseLock LAST.
 *      A crashed shutdown that fails to release the lock leaves it for
 *      `kill(pid, 0)` stale-detection to recover.
 *
 * # Anti-Pattern 2 — never direct DB writes
 *
 * Brief staleness writes route through `delivery.update(briefId, patch,
 * {expectedHash, sink})` so the MEM-05 validator runs at the
 * `DeliveryAdapter` chokepoint (`default-brief-v1` permits
 * `status: "stale"` per slice 1 contract). Direct
 * `vault.db.notes.upsert(...)` would bypass the validator AND the
 * existing watcher suppression-set hook → Pitfall 3.
 *
 * # Adapter-seam discipline
 *
 * Zero `fs` / `path.join` / `gray-matter` / `chokidar` imports here.
 * The daemon delegates to `lock.ts` (the only lockfile carve-out) for
 * `~/.vault-memory/locks/` access; everything else routes through the
 * `DeliveryAdapter` / `SourceConnector` / `ChangeFeed` seams.
 */

import type { ChangeEvent, ChangeFeed, Disposable } from "../adapters/change-feed/types.js";
import type { DeliveryAdapter } from "../adapters/delivery/types.js";
import type { SourceConnector } from "../adapters/source/types.js";
import { decomposeDocId } from "../adapters/registry.js";
import type { MemorySinkRegistry } from "../memory/index.js";
import type { Vault } from "../vault/index.js";
import type { DocId, Document } from "../types.js";
import { recomputeCurrentHash } from "./source-hashes.js";
import { releaseLock, tryAcquireLock } from "./lock.js";

/** Default sink name for briefs. Mirrors compile.ts / get.ts. */
const DEFAULT_BRIEF_SINK_NAME = "_memory/_briefs";

/**
 * 5-second grace-window for rename survival (BRF-08). chokidar surfaces
 * a true OS-level rename as `unlink + add`; this window correlates the
 * pair by matching chunk hash sets.
 */
const RENAME_GRACE_MS = 5_000;

/**
 * Defensive hop cap for shutdown-period grace-window expiry — should
 * never fire in normal operation.
 */
const MAX_EXPIRE_PER_TICK = 1024;

export interface DaemonDeps {
  memorySinkRegistry: MemorySinkRegistry;
  deliveryAdapterFor: (vaultName: string) => DeliveryAdapter;
  sourceConnectorFor: (vaultName: string) => SourceConnector;
  /** Optional override for the lock root (tests inject mkdtemp dir). */
  lockRootOverride?: string;
  /** Optional override for the brief sink name (defaults to _memory/_briefs). */
  briefSinkName?: string;
  /** Optional logger; defaults to stderr writer. */
  log?: (msg: string) => void;
  /** Optional clock override for tests (default `Date.now`). */
  now?: () => number;
}

interface PendingDelete {
  id: DocId;
  /** Set of full chunk hashes (`"sha256:..."`) captured at delete time. */
  chunkHashes: Set<string>;
  timestamp: number;
}

export interface DaemonStartResult {
  acquired: boolean;
  ownerPid?: number;
}

export class BriefStalenessDaemon {
  private disposable: Disposable | null = null;
  private vault: Vault | null = null;
  private deps: DaemonDeps | null = null;
  private acquired = false;
  private readonly pendingDeletes = new Map<DocId, PendingDelete>();
  private now: () => number = Date.now;
  private log: (msg: string) => void = (m) => process.stderr.write(`[brief-daemon] ${m}\n`);

  /**
   * Acquire the per-vault lock, run the startup scan, subscribe to
   * the feed. Multi-MCP-client friendly: returns
   * `{acquired: false, ownerPid}` on lock contention WITHOUT
   * subscribing or throwing — the second server boots normally.
   */
  async start(vault: Vault, feed: ChangeFeed, deps: DaemonDeps): Promise<DaemonStartResult> {
    this.vault = vault;
    this.deps = deps;
    if (deps.now) this.now = deps.now;
    if (deps.log) this.log = deps.log;

    const lockOpts =
      deps.lockRootOverride !== undefined ? { rootOverride: deps.lockRootOverride } : {};
    const lock = await tryAcquireLock(vault.config.name, lockOpts);
    if (!lock.acquired) {
      // D-08: structured WARN + return early. The lock-contention path
      // is a NORMAL multi-MCP-client outcome, not an error. We log to
      // stderr in a structured (single-line JSON) shape so external
      // collectors can parse it. Audit-log integration uses the
      // `audit.recordWrite` shape — but that table is `write_audit`
      // (per-note write history); a daemon-ownership event does not
      // bind to a note row, so we emit stderr only.
      const payload = JSON.stringify({
        kind: "daemon_already_owned",
        vault: vault.config.name,
        ownerPid: lock.ownerPid,
        path: lock.path,
      });
      this.log(`WARN ${payload}`);
      return { acquired: false, ownerPid: lock.ownerPid };
    }
    this.acquired = true;
    // Diagnostic: capture starting cursor (slice 1 D-09 cursor table).
    // The startup scan is the correctness floor regardless of cursor
    // value, but we log the value so operators can compare against
    // the post-scan cursor to verify the daemon is current.
    const startCursor = vault.db.daemonState.getCursor(vault.config.name);
    this.log(`start vault=${vault.config.name} startCursor=${startCursor ?? "null"}`);

    // ── Startup full scan (D-09 correctness floor) ─────────────────
    await this.runStartupScan();

    // ── Subscribe to ChangeFeed (D-07) ─────────────────────────────
    this.disposable = feed.subscribe(async (event: ChangeEvent) => {
      try {
        await this.handleEvent(event);
        vault.db.daemonState.setCursor(vault.config.name, this.now());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const payload = JSON.stringify({
          kind: "brief_staleness_error",
          vault: vault.config.name,
          event_kind: event.kind,
          event_id: "id" in event ? event.id : null,
          message,
        });
        this.log(`ERROR ${payload}`);
      }
    });

    // Set initial cursor.
    vault.db.daemonState.setCursor(vault.config.name, this.now());
    return { acquired: true };
  }

  /**
   * Force any pending grace-window deletes to expire and propagate.
   * Test hook + shutdown-flush helper.
   */
  async drainPending(): Promise<void> {
    await this.expireGraceWindow(true);
  }

  async shutdown(): Promise<void> {
    // Dispose subscription FIRST so no more events arrive mid-shutdown.
    if (this.disposable) {
      this.disposable[Symbol.dispose]();
      this.disposable = null;
    }
    // Release lock LAST. A crashed shutdown that fails here leaves the
    // lock for `kill(pid, 0)` stale-detection (lock.ts) to recover.
    if (this.acquired && this.vault && this.deps) {
      const lockOpts =
        this.deps.lockRootOverride !== undefined
          ? { rootOverride: this.deps.lockRootOverride }
          : {};
      await releaseLock(this.vault.config.name, lockOpts);
      this.acquired = false;
    }
  }

  /** True iff the daemon currently owns the lock (test hook). */
  get isOwner(): boolean {
    return this.acquired;
  }

  // ────────────────────────────────────────────────────────────────────
  //  Internal — handlers
  // ────────────────────────────────────────────────────────────────────

  private async runStartupScan(): Promise<void> {
    const vault = this.requireVault();
    const briefIds = vault.db.briefSources.listBriefDocIds();
    for (const briefId of briefIds) {
      try {
        await this.evaluateBrief(briefId as DocId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const payload = JSON.stringify({
          kind: "brief_staleness_error",
          vault: vault.config.name,
          phase: "startup_scan",
          brief_id: briefId,
          message,
        });
        this.log(`ERROR ${payload}`);
      }
    }
  }

  private async handleEvent(event: ChangeEvent): Promise<void> {
    // Always tick the grace-window expiries at the start of each event
    // so pending deletes propagate even when the next event is itself
    // a non-matching create on a different doc.
    await this.expireGraceWindow(false);

    switch (event.kind) {
      case "create":
        await this.handleCreate(event.id);
        break;
      case "update":
        await this.evaluateChangedDocId(event.id);
        break;
      case "delete":
        await this.handleDelete(event.id);
        break;
      case "rename":
        await this.handleRenameDirect(event.old_id, event.new_id);
        break;
    }
  }

  /**
   * For each brief that cites `docId`, re-evaluate its source_hashes
   * and flip the brief stale if any chunk diverges (or sources were
   * removed entirely).
   */
  private async evaluateChangedDocId(docId: DocId): Promise<void> {
    const vault = this.requireVault();
    const affected = vault.db.briefSources.briefsForChunkDoc(docId);
    const briefIds = new Set(affected.map((a) => a.briefDocId));
    for (const briefId of briefIds) {
      await this.evaluateBrief(briefId as DocId);
    }
  }

  /**
   * Read the brief Document, walk its `brief_sources` rows, and
   * compare each `recorded_hash` to the current chunk hash. On
   * divergence, call `delivery.update` to flip status → "stale".
   *
   * Errors per-brief are caught + logged; the loop never crashes.
   */
  private async evaluateBrief(briefId: DocId): Promise<void> {
    const vault = this.requireVault();
    const deps = this.requireDeps();

    const sources = vault.db.briefSources.sourcesForBrief(briefId);
    if (sources.length === 0) return; // Brief was never recorded.

    // Recompute the current hash for each cited chunk.
    const currentHashes = new Map<string, string | null>();
    for (const row of sources) {
      const key = `${row.chunkDocId}#${row.chunkIdFragment}`;
      if (currentHashes.has(key)) continue;
      try {
        const { resource } = decomposeDocId(row.chunkDocId as DocId);
        const note = vault.db.notes.getByPath(resource);
        if (!note) {
          currentHashes.set(key, null); // Source doc disappeared.
          continue;
        }
        const chunks = vault.db.chunks.getByNote(note.id);
        const found = chunks.find((c) => c.chunk_id_fragment === row.chunkIdFragment);
        if (!found) {
          currentHashes.set(key, null); // Chunk was renamed / deleted.
          continue;
        }
        currentHashes.set(key, recomputeCurrentHash(found.text));
      } catch {
        currentHashes.set(key, null);
      }
    }

    // Build the changed_sources list — unique DocIds whose any chunk
    // diverged or disappeared.
    const changedSourceIds = new Set<DocId>();
    for (const row of sources) {
      const key = `${row.chunkDocId}#${row.chunkIdFragment}`;
      const current = currentHashes.get(key);
      if (current === null || current !== row.recordedHash) {
        changedSourceIds.add(row.chunkDocId as DocId);
      }
    }

    if (changedSourceIds.size === 0) return;

    // Read the brief Document for its current hash + properties.
    const source = deps.sourceConnectorFor(vault.config.name);
    let briefDoc: Document;
    try {
      briefDoc = await source.readDocument(briefId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const payload = JSON.stringify({
        kind: "brief_staleness_error",
        vault: vault.config.name,
        brief_id: briefId,
        phase: "read_brief",
        message,
      });
      this.log(`ERROR ${payload}`);
      return;
    }

    // If the brief is already stale or superseded, skip the write —
    // re-flipping a stale brief would churn the suppression set.
    const currentStatus = briefDoc.properties.status;
    if (currentStatus === "stale" || currentStatus === "superseded") return;

    const briefSink = this.resolveBriefSink(vault.config.name);
    const delivery = deps.deliveryAdapterFor(vault.config.name);

    // Preserve existing properties; flip status + record changed_sources.
    const patchProperties: Record<string, unknown> = {
      ...briefDoc.properties,
      status: "stale",
      changed_sources: Array.from(changedSourceIds),
    };
    const updateRes = await delivery.update(
      briefId,
      { properties: patchProperties },
      {
        expectedHash: briefDoc.hash,
        sink: briefSink.handle,
      },
    );
    if (!updateRes.ok) {
      const payload = JSON.stringify({
        kind: "brief_staleness_error",
        vault: vault.config.name,
        brief_id: briefId,
        phase: "update",
        reason: updateRes.reason,
        message: updateRes.message,
      });
      this.log(`ERROR ${payload}`);
    }
  }

  /**
   * Delete handler — capture the deleted doc's chunk hashes into the
   * grace-window so a matching `create` can survive the link via
   * rename heuristic (BRF-08).
   */
  private async handleDelete(docId: DocId): Promise<void> {
    const vault = this.requireVault();
    // Capture the set of chunk hashes for this doc BEFORE the deletion
    // propagates through the indexer. We read from the chunks table
    // which is still populated at this point — the watcher's removeNote
    // happens on its own debounced flush, not synchronously with our
    // event handler.
    const chunkHashes = new Set<string>();
    try {
      const { resource } = decomposeDocId(docId);
      const note = vault.db.notes.getByPath(resource);
      if (note) {
        for (const chunk of vault.db.chunks.getByNote(note.id)) {
          chunkHashes.add(recomputeCurrentHash(chunk.text));
        }
      }
    } catch {
      // Doc may already be gone; we keep an empty set so the
      // grace-window will eventually expire and propagate as a "real"
      // delete (mark briefs stale).
    }
    this.pendingDeletes.set(docId, {
      id: docId,
      chunkHashes,
      timestamp: this.now(),
    });
  }

  /**
   * Create handler — look for a matching pendingDelete by chunk-hash
   * set; if found, rewrite `brief_sources.chunk_doc_id` from old → new
   * in place (BRF-08).
   */
  private async handleCreate(docId: DocId): Promise<void> {
    const vault = this.requireVault();
    // Compute the new doc's chunk hashes.
    const newHashes = new Set<string>();
    try {
      const { resource } = decomposeDocId(docId);
      const note = vault.db.notes.getByPath(resource);
      if (note) {
        for (const chunk of vault.db.chunks.getByNote(note.id)) {
          newHashes.add(recomputeCurrentHash(chunk.text));
        }
      }
    } catch {
      // If we can't read the new doc, skip the rename heuristic —
      // it's purely an optimization on top of the staleness fallback.
      return;
    }
    if (newHashes.size === 0) return;

    // Find a pending delete with the same chunk-hash set.
    for (const [oldId, pending] of this.pendingDeletes) {
      if (chunkSetMatch(pending.chunkHashes, newHashes)) {
        this.pendingDeletes.delete(oldId);
        // UPDATE brief_sources.chunk_doc_id = newId WHERE chunk_doc_id = oldId.
        // We use a low-level prepared statement against the same DB
        // handle the BriefSourcesQueries class uses, surfaced as a
        // dedicated method below to keep the SQL string in one place.
        rewriteBriefSourceDocId(vault, oldId, docId);
        return;
      }
    }
  }

  /**
   * Native rename handler — for adapters that surface `rename` events
   * directly. Today's obsidian-fs ChangeFeed emits delete+create
   * (`emitsRename: false`); this branch fires only when a future
   * adapter (notion-api, github-api) emits a real rename.
   */
  private async handleRenameDirect(oldId: DocId, newId: DocId): Promise<void> {
    const vault = this.requireVault();
    rewriteBriefSourceDocId(vault, oldId, newId);
  }

  /**
   * Walk the pendingDeletes map; for each entry older than the grace
   * window, treat as a real delete and mark its dependent briefs stale.
   */
  private async expireGraceWindow(force: boolean): Promise<void> {
    const cutoff = force ? Number.POSITIVE_INFINITY : RENAME_GRACE_MS;
    const nowMs = this.now();
    let processed = 0;
    for (const [id, pending] of this.pendingDeletes) {
      if (processed++ > MAX_EXPIRE_PER_TICK) break;
      if (force || nowMs - pending.timestamp >= cutoff) {
        this.pendingDeletes.delete(id);
        // Mark briefs stale with reason: "source_deleted".
        try {
          await this.evaluateChangedDocId(id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const vault = this.vault;
          const payload = JSON.stringify({
            kind: "brief_staleness_error",
            vault: vault?.config.name ?? "unknown",
            brief_id: id,
            phase: "grace_expire",
            message,
          });
          this.log(`ERROR ${payload}`);
        }
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────

  private resolveBriefSink(vaultName: string) {
    const deps = this.requireDeps();
    const name = deps.briefSinkName ?? DEFAULT_BRIEF_SINK_NAME;
    const sink = deps.memorySinkRegistry.resolveMemorySink(name);
    if (sink.vault !== vaultName) {
      throw new Error(`Brief sink "${name}" belongs to vault "${sink.vault}", not "${vaultName}"`);
    }
    return sink;
  }

  private requireVault(): Vault {
    if (!this.vault) throw new Error("daemon used before start()");
    return this.vault;
  }

  private requireDeps(): DaemonDeps {
    if (!this.deps) throw new Error("daemon used before start()");
    return this.deps;
  }
}

/** Set equality for chunk-hash multisets. Order-independent. */
function chunkSetMatch(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * Rewrite every `brief_sources.chunk_doc_id` from `oldId` to `newId`.
 * Idempotent and INSERT-OR-IGNORE friendly. The dedicated method lives
 * here (not in `BriefSourcesQueries`) because the rename heuristic is
 * a daemon concern; the query class stays focused on read-side lookups.
 */
function rewriteBriefSourceDocId(vault: Vault, oldId: DocId, newId: DocId): void {
  // We reach into the shared db handle to issue the UPDATE. The query
  // class doesn't ship a `updateChunkDocId` method (yet); doing it
  // here keeps the migration surface minimal. If a future slice
  // promotes this to a first-class API on BriefSourcesQueries, the
  // signature is already correct.
  // Note: the UNIQUE(brief_doc_id, chunk_id_fragment) constraint is
  // unaffected because we only change `chunk_doc_id` — not the unique
  // key columns.
  vault.db.handle
    .prepare(
      `UPDATE brief_sources
          SET chunk_doc_id = ?
        WHERE chunk_doc_id = ?`,
    )
    .run(newId, oldId);
}
