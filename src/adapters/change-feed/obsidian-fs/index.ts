/**
 * `obsidian-fs` ChangeFeed adapter barrel.
 *
 * Re-exports the relocated v1 VaultWatcher / DebouncedQueue / SuppressionSet
 * primitives PLUS the new `ObsidianFsChangeFeed` facade implementing
 * the `ChangeFeed` interface (ADR-002 §ChangeFeed, plan 01-05 task 02).
 *
 * Invariant I-1 (ADR-002): chokidar imports live ONLY under this directory.
 * Plan 01-06 ships the lint script that enforces this mechanically.
 */

export { VaultWatcher } from "./watcher.js";
export type { VaultWatcherOptions } from "./watcher.js";
export { DebouncedQueue } from "./queue.js";
export type { QueueEvent, DebouncedQueueOptions } from "./queue.js";
export { SuppressionSet } from "./suppression.js";
export type { SuppressionOptions } from "./suppression.js";
