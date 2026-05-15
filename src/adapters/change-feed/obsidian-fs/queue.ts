/**
 * DebouncedQueue — coalesces rapid filesystem events on the same path
 * into a single onFlush call.
 *
 * Semantics:
 * - Multiple "change" events on the same path within debounceMs collapse
 *   to one flush.
 * - "delete" overrides a pending "change" (delete is final).
 * - A later "change" on a pending "delete" replaces it (file came back).
 * - maxLatencyMs caps how long an entry may sit pending; once exceeded,
 *   the next enqueue (or scheduled timer) flushes it immediately.
 */

export interface QueueEvent {
  /** Vault-relative path, forward slashes. */
  path: string;
  /** "change" or "delete". add/change are merged to "change". */
  kind: "change" | "delete";
}

export interface DebouncedQueueOptions {
  /** Debounce window in ms. Default 500. */
  debounceMs?: number;
  /** Maximum age (ms) a pending event may sit before forced flush. Default 5000. */
  maxLatencyMs?: number;
  /** Called when an event is ready to be processed. Errors are caught + logged. */
  onFlush: (event: QueueEvent) => Promise<void> | void;
  /** Optional error sink — invoked with (event, error) when onFlush throws. */
  onError?: (event: QueueEvent, err: unknown) => void;
}

interface PendingEntry {
  kind: "change" | "delete";
  /** Insertion order — first time this path was enqueued in the current pending cycle. */
  firstSeen: number;
  /** Timer for the debounce window. */
  timer: ReturnType<typeof setTimeout>;
}

export class DebouncedQueue {
  private readonly debounceMs: number;
  private readonly maxLatencyMs: number;
  private readonly onFlush: (event: QueueEvent) => Promise<void> | void;
  private readonly onError: (event: QueueEvent, err: unknown) => void;
  private readonly pending = new Map<string, PendingEntry>();
  /** Tracks in-flight flush promises so flushAll can await them. */
  private readonly inFlight = new Set<Promise<void>>();
  private stopped = false;

  constructor(options: DebouncedQueueOptions) {
    this.debounceMs = options.debounceMs ?? 500;
    this.maxLatencyMs = options.maxLatencyMs ?? 5000;
    this.onFlush = options.onFlush;
    this.onError =
      options.onError ??
      ((event, err) => {
        // eslint-disable-next-line no-console
        console.error(`[DebouncedQueue] onFlush failed for ${event.path} (${event.kind}):`, err);
      });
  }

  /**
   * Enqueue an event. After shutdown() this is a no-op.
   */
  enqueue(event: QueueEvent): void {
    if (this.stopped) return;

    const now = Date.now();
    const existing = this.pending.get(event.path);

    // maxLatencyMs guard: if we already have a pending entry that has been
    // sitting longer than the cap, flush it now (with its current kind)
    // before recording the new event.
    if (existing && now - existing.firstSeen >= this.maxLatencyMs) {
      clearTimeout(existing.timer);
      this.pending.delete(event.path);
      this.dispatch({ path: event.path, kind: existing.kind });
      // Fall through and record the new event fresh.
    }

    const prior = this.pending.get(event.path);
    const firstSeen = prior?.firstSeen ?? now;
    if (prior) clearTimeout(prior.timer);

    // Coalesce kind. Later events overwrite. (Both delete-after-change and
    // change-after-delete simply take the latest event's kind, matching the
    // documented behavior.)
    const kind: "change" | "delete" = event.kind;

    // Schedule debounce. If the entry is close to maxLatency, fire sooner.
    const age = now - firstSeen;
    const remaining = this.maxLatencyMs - age;
    const delay = Math.max(0, Math.min(this.debounceMs, remaining));

    const timer = setTimeout(() => {
      const entry = this.pending.get(event.path);
      if (!entry) return;
      this.pending.delete(event.path);
      this.dispatch({ path: event.path, kind: entry.kind });
    }, delay);

    this.pending.set(event.path, { kind, firstSeen, timer });
  }

  /** Force-flush all pending events. Resolves once all onFlush calls settle. */
  async flushAll(): Promise<void> {
    // Snapshot in insertion order (Map preserves it).
    const entries = [...this.pending.entries()];
    for (const [path, entry] of entries) {
      clearTimeout(entry.timer);
      this.pending.delete(path);
      this.dispatch({ path, kind: entry.kind });
    }
    // Await any in-flight promises (including just-dispatched ones).
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }

  /** Cancel timers, drop pending events. Idempotent. After this enqueue is a no-op. */
  shutdown(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
  }

  /** Pending event count (excludes in-flight). */
  size(): number {
    return this.pending.size;
  }

  private dispatch(event: QueueEvent): void {
    let result: Promise<void> | void;
    try {
      result = this.onFlush(event);
    } catch (err) {
      this.safeOnError(event, err);
      return;
    }
    if (result && typeof (result as Promise<void>).then === "function") {
      const p = (result as Promise<void>)
        .catch((err: unknown) => this.safeOnError(event, err))
        .finally(() => {
          this.inFlight.delete(p);
        });
      this.inFlight.add(p);
    }
  }

  private safeOnError(event: QueueEvent, err: unknown): void {
    try {
      this.onError(event, err);
    } catch {
      // swallow — onError is best-effort
    }
  }
}
