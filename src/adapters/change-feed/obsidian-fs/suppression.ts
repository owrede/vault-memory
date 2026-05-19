/**
 * SuppressionSet — short-lived registry of paths the server itself just
 * touched, so the file watcher can ignore the resulting filesystem events.
 *
 * Entries auto-expire after `ttlMs` (default 2000). `consume(path)` returns
 * true exactly once per add — repeated consumes return false. This ensures
 * a legitimate later edit to the same file is NOT suppressed.
 *
 * # Phase 7 / Plan 07-07 / CAN-08 — hash-keyed suppression (additive)
 *
 * Phase 6 (RESEARCH §6 Pitfall 1) discovered that a pure path/TTL gate
 * cannot distinguish "the agent's own write echoed back" from "the user
 * edited the file in another editor within the TTL window". Plan 07-07
 * extends the API additively:
 *
 *   - `add(path)` — existing path-only behavior; second arg may be a
 *     number for `ttlMs` (legacy callers in writer/indexer pass this).
 *   - `add(path, { ttlMs?, hash? })` — new options form. When `hash` is
 *     recorded, `consume(path, hash)` only suppresses if hashes match;
 *     a mismatch leaves the entry intact (so a later legitimate match
 *     can still drop it).
 *   - `consume(path)` — unconditional; matches today's semantics.
 *   - `consume(path, hash)` — if the recorded entry has a hash, requires
 *     equality; entries without a recorded hash always match (legacy
 *     path-only entries fall through, so existing callers stay correct).
 *
 * Choice rationale (planner option (a) — overloaded `add`): the second
 * argument's type discriminates legacy vs. new shape. `typeof ttlMs ===
 * "number"` continues to mean "TTL override"; `typeof === "object"` is
 * the new options form. The option (b) split (`add` + `addHashed`) was
 * rejected on call-site simplicity grounds — the new `suppress_contract_write`
 * MCP tool wants the options-object form so its handler reads cleanly.
 *
 * # Trust boundary (THREAT-T-07-07-02 mitigation)
 *
 * TTL is bounded by the caller (the `suppress_contract_write` Zod schema
 * caps it at 30s). Hash mismatch on consume keeps the entry intact so
 * the next legitimate match still works — this guards against a
 * suppression entry "swallowing" a real external edit.
 *
 * @see plan 07-07 §"Task 1" — full behavior matrix.
 * @see ADR-007 §D-WATCH-PLUGIN-OUT — hash-keyed contract for the
 *      plugin's YAML companion emission.
 */

export interface SuppressionOptions {
  /** Default TTL for new entries in ms. Default 2000. */
  ttlMs?: number;
  /** Override for testing: a clock function returning epoch ms. Default Date.now. */
  now?: () => number;
}

/** Per-entry options for the additive `add(path, opts)` overload. */
export interface SuppressionEntryOptions {
  /** Per-entry TTL override; falls back to the set's default. */
  ttlMs?: number;
  /**
   * Optional content hash. When present, `consume(path, hash)` only
   * suppresses on hash equality; mismatches leave the entry intact.
   * See file header for the full semantics matrix.
   */
  hash?: string;
}

interface Entry {
  expiresAt: number;
  /** Recorded content hash (when the caller supplied one). */
  hash?: string;
}

export class SuppressionSet {
  private readonly defaultTtlMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();

  constructor(options: SuppressionOptions = {}) {
    this.defaultTtlMs = options.ttlMs ?? 2000;
    this.now = options.now ?? Date.now;
  }

  /**
   * Mark a path as "expect a filesystem event for this — please ignore it".
   *
   * Legacy form: `add(path)` or `add(path, ttlMs)`.
   * Hash-keyed form: `add(path, { ttlMs?, hash? })`.
   *
   * @see file header for the full backwards-compatibility matrix.
   */
  add(path: string, ttlMsOrOpts?: number | SuppressionEntryOptions): void {
    this.prune();
    let ttl: number;
    let hash: string | undefined;
    if (typeof ttlMsOrOpts === "number") {
      ttl = ttlMsOrOpts;
    } else if (ttlMsOrOpts !== undefined) {
      ttl = ttlMsOrOpts.ttlMs ?? this.defaultTtlMs;
      hash = ttlMsOrOpts.hash;
    } else {
      ttl = this.defaultTtlMs;
    }
    const entry: Entry = { expiresAt: this.now() + ttl };
    if (hash !== undefined) entry.hash = hash;
    this.entries.set(path, entry);
  }

  /**
   * If path is suppressed, return true and (usually) remove the entry.
   *
   * Hash semantics:
   *   - `consume(path)`              — unconditional; removes the entry.
   *   - `consume(path, undefined)`   — same as above.
   *   - `consume(path, hash)`        — if the recorded entry has a hash
   *     and it does NOT equal `hash`, leave the entry intact and return
   *     false (RESEARCH §6 Pitfall 1: don't let an arbitrary external
   *     edit consume our suppression slot). When hashes match, remove
   *     and return true. When the recorded entry has no hash, treat it
   *     as a legacy path-only entry and match unconditionally.
   */
  consume(path: string, hash?: string): boolean {
    this.prune();
    const entry = this.entries.get(path);
    if (!entry) return false;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(path);
      return false;
    }
    // Hash-aware path: when the caller supplies a hash AND the entry has
    // one, require equality. If they don't match, preserve the entry so
    // a later legitimate match can still consume it.
    if (hash !== undefined && entry.hash !== undefined && entry.hash !== hash) {
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
