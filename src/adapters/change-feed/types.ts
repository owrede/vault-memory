/**
 * ChangeFeed — the watch seam (ADR-002 §ChangeFeed).
 *
 * A `ChangeFeed` lets vault-memory subscribe to document change events
 * from a backing store. Implementations: `ObsidianFsChangeFeed` (Plan
 * 01-05, chokidar-backed); `StubChangeFeed` (Plan 01-05, EventEmitter-
 * backed conformance fixture); future push subscriptions in Phase 10
 * (Notion webhook, GitHub webhook).
 *
 * # Invariants (ADR-002)
 *
 *   I-1: `chokidar` imports live ONLY in
 *        `src/adapters/change-feed/obsidian-fs/`. The lint script
 *        (Plan 01-06) enforces.
 *
 * # Rename semantics — Phase 1 vs future adapters
 *
 * Phase 1's obsidian-fs change-feed emits ONLY `create | update | delete`
 * — a true OS-level rename surfaces in chokidar as `unlink` + `add`
 * (RESEARCH A3 / Risk #3), which v1 already treats as delete+create.
 * Phase 1 preserves that v1 behavior verbatim.
 *
 * The `ChangeEvent` tagged union INCLUDES `rename` so that future
 * adapters with first-class rename semantics (e.g. notion-api page-move
 * webhooks, GitHub repo file-move events) can emit it without a type
 * change. Adapters declare their emission policy via
 * `ChangeFeedCapabilities.emitsRename` (Invariant I-7: capabilities
 * don't lie).
 *
 * # Lifecycle
 *
 * - `subscribe(handler)` registers a handler and returns a `Disposable`
 *   (TS 5.2+ `Symbol.dispose`). Disposing the result unregisters the
 *   handler. The codebase targets ES2023 (tsconfig.json), so
 *   `Symbol.dispose` is natively available without polyfills.
 * - `close()` shuts the feed down and releases all underlying resources
 *   (closes chokidar watchers, cancels HTTP subscriptions, etc.).
 *   After `close()`, no further events are delivered to handlers.
 * - `drain?()` (optional) flushes any internally buffered / debounced
 *   events. Present on v1 `VaultWatcher.drain()` (watcher.ts:115) and
 *   used by tests to wait for the debounced queue to settle; declared
 *   optional on the interface so Plan 01-05 can expose it without a
 *   contract break.
 */

import type { ChangeEvent, SourceHandle } from "../../types.js";
import type { WatchKind } from "../capabilities.js";

// Re-export ChangeEvent for adapter-facing convenience so consumers can
// import { ChangeEvent } from this package alongside the ChangeFeed
// interface. The canonical home stays src/types.ts (ADR-002 §ChangeFeed).
export type { ChangeEvent } from "../../types.js";

/**
 * Published capability descriptor for a ChangeFeed. The conformance
 * suite (Plan 01-05) asserts every field against observed behavior
 * (Invariant I-7).
 */
export interface ChangeFeedCapabilities {
  /** Watch semantics — push (live), poll (interval), or none. */
  watch: WatchKind;
  /** Adapter emits `rename` events (vs synthesizing delete+create). */
  emitsRename: boolean;
  /**
   * Internal buffer cap (events buffered between handler invocations).
   * When set, callers SHOULD assume events are dropped when the buffer
   * fills. Optional — adapters without an internal buffer omit it.
   */
  bufferSize?: number;
}

/**
 * Disposable subscription handle (TS 5.2+ `Symbol.dispose`). Returned
 * by `ChangeFeed.subscribe`. Disposing unregisters the handler.
 *
 * Re-declared locally so the type doesn't depend on a `using`-aware
 * lib.d.ts version; ES2023 target provides `Symbol.dispose` natively.
 */
export interface Disposable {
  [Symbol.dispose](): void;
}

/**
 * The watch seam. Phase 1: `ObsidianFsChangeFeed` (reference) +
 * `StubChangeFeed` (conformance fixture).
 */
export interface ChangeFeed {
  /** The adapter handle that names this feed in the registry. */
  readonly handle: SourceHandle;
  /** Published capability descriptor. Honest per Invariant I-7. */
  readonly capabilities: ChangeFeedCapabilities;

  /**
   * Register a handler. Returns a `Disposable` that unregisters the
   * handler when disposed. Handler errors MUST NOT crash the feed —
   * adapters log-and-swallow handler exceptions.
   */
  subscribe(handler: (e: ChangeEvent) => void | Promise<void>): Disposable;

  /** Shut down the feed and release underlying resources. Idempotent. */
  close(): Promise<void>;

  /**
   * Flush any internally buffered / debounced events. Optional —
   * adapters without buffering omit it. Used by tests and graceful
   * shutdown to wait for pending events.
   */
  drain?(): Promise<void>;
}
