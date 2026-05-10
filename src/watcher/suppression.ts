/**
 * SuppressionSet — short-lived registry of paths the server itself just
 * touched, so the file watcher can ignore the resulting filesystem events.
 *
 * Entries auto-expire after `ttlMs` (default 2000). `consume(path)` returns
 * true exactly once per add — repeated consumes return false. This ensures
 * a legitimate later edit to the same file is NOT suppressed.
 */

export interface SuppressionOptions {
  /** Default TTL for new entries in ms. Default 2000. */
  ttlMs?: number;
  /** Override for testing: a clock function returning epoch ms. Default Date.now. */
  now?: () => number;
}

interface Entry {
  expiresAt: number;
}

export class SuppressionSet {
  private readonly defaultTtlMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();

  constructor(options: SuppressionOptions = {}) {
    this.defaultTtlMs = options.ttlMs ?? 2000;
    this.now = options.now ?? Date.now;
  }

  /** Mark a path as "expect a filesystem event for this — please ignore it". */
  add(path: string, ttlMs?: number): void {
    this.prune();
    const ttl = ttlMs ?? this.defaultTtlMs;
    this.entries.set(path, { expiresAt: this.now() + ttl });
  }

  /**
   * If path is suppressed, remove the entry and return true (skip event).
   * Otherwise return false.
   */
  consume(path: string): boolean {
    this.prune();
    const entry = this.entries.get(path);
    if (!entry) return false;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(path);
      return false;
    }
    this.entries.delete(path);
    return true;
  }

  /** Read-only check; does not consume. */
  has(path: string): boolean {
    this.prune();
    const entry = this.entries.get(path);
    if (!entry) return false;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(path);
      return false;
    }
    return true;
  }

  /** Drop expired entries. */
  prune(): void {
    const t = this.now();
    for (const [path, entry] of this.entries) {
      if (entry.expiresAt <= t) {
        this.entries.delete(path);
      }
    }
  }

  size(): number {
    this.prune();
    return this.entries.size;
  }
}
