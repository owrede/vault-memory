import { describe, expect, it } from "vitest";
import { SuppressionSet } from "./suppression.js";

function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("SuppressionSet", () => {
  it("add + consume returns true", () => {
    const clock = makeClock();
    const s = new SuppressionSet({ ttlMs: 1000, now: clock.now });
    s.add("a.md");
    expect(s.consume("a.md")).toBe(true);
  });

  it("consume twice — second is false", () => {
    const clock = makeClock();
    const s = new SuppressionSet({ ttlMs: 1000, now: clock.now });
    s.add("a.md");
    expect(s.consume("a.md")).toBe(true);
    expect(s.consume("a.md")).toBe(false);
  });

  it("has() does not consume", () => {
    const clock = makeClock();
    const s = new SuppressionSet({ ttlMs: 1000, now: clock.now });
    s.add("a.md");
    expect(s.has("a.md")).toBe(true);
    expect(s.has("a.md")).toBe(true);
    expect(s.consume("a.md")).toBe(true);
    expect(s.has("a.md")).toBe(false);
  });

  it("expired entry — consume returns false", () => {
    const clock = makeClock();
    const s = new SuppressionSet({ ttlMs: 1000, now: clock.now });
    s.add("a.md");
    clock.advance(1500);
    expect(s.consume("a.md")).toBe(false);
    expect(s.has("a.md")).toBe(false);
  });

  it("per-call ttlMs override beats the default", () => {
    const clock = makeClock();
    const s = new SuppressionSet({ ttlMs: 100, now: clock.now });
    s.add("a.md", 5000);
    clock.advance(500); // past default ttl
    expect(s.has("a.md")).toBe(true);
    expect(s.consume("a.md")).toBe(true);
  });

  it("prune removes expired entries", () => {
    const clock = makeClock();
    const s = new SuppressionSet({ ttlMs: 1000, now: clock.now });
    s.add("a.md");
    s.add("b.md");
    s.add("c.md", 10_000);
    expect(s.size()).toBe(3);
    clock.advance(1500);
    s.prune();
    expect(s.size()).toBe(1);
    expect(s.has("c.md")).toBe(true);
  });

  it("re-add refreshes the TTL", () => {
    const clock = makeClock();
    const s = new SuppressionSet({ ttlMs: 1000, now: clock.now });
    s.add("a.md");
    clock.advance(800);
    s.add("a.md");
    clock.advance(500); // 1300ms after first add, but only 500ms after re-add
    expect(s.consume("a.md")).toBe(true);
  });

  // ── Phase 7 / Plan 07-07 / CAN-08 — hash-keyed suppression ───────────
  // RESEARCH §6 Pitfall 1: path-only suppression loses a legitimate
  // second-edit-within-TTL. Hash-keyed entries: `consume(path, hash)`
  // matches only when hashes equal; on mismatch, the entry is preserved
  // so a later matching consume can still drop it.

  describe("hash-keyed add + consume (CAN-08)", () => {
    it("hash-keyed add + matching-hash consume returns true and removes entry", () => {
      const clock = makeClock();
      const s = new SuppressionSet({ ttlMs: 1000, now: clock.now });
      s.add("_contracts/foo.yaml", { hash: "abc123" });
      expect(s.consume("_contracts/foo.yaml", "abc123")).toBe(true);
      // Second consume — entry gone.
      expect(s.consume("_contracts/foo.yaml", "abc123")).toBe(false);
    });

    it("hash-keyed add + non-matching-hash consume returns false AND leaves entry intact", () => {
      const clock = makeClock();
      const s = new SuppressionSet({ ttlMs: 1000, now: clock.now });
      s.add("_contracts/foo.yaml", { hash: "abc123" });
      // External edit has a different hash — must NOT be suppressed.
      expect(s.consume("_contracts/foo.yaml", "deadbeef")).toBe(false);
      // The entry is still there for a later legitimate match.
      expect(s.has("_contracts/foo.yaml")).toBe(true);
      expect(s.consume("_contracts/foo.yaml", "abc123")).toBe(true);
    });

    it("path-only add + hash-aware consume returns true (legacy entry falls through)", () => {
      // Legacy callers in writer/indexer use the path-only add; the new
      // hash-aware consume still matches them (no recorded hash means
      // any consume succeeds).
      const clock = makeClock();
      const s = new SuppressionSet({ ttlMs: 1000, now: clock.now });
      s.add("notes/a.md");
      expect(s.consume("notes/a.md", "any-hash")).toBe(true);
    });

    it("hash-keyed add + path-only consume returns true and removes the entry", () => {
      // Path-only consume is unconditional (matches today's semantics)
      // — used by legacy writer callers that don't compute hashes.
      const clock = makeClock();
      const s = new SuppressionSet({ ttlMs: 1000, now: clock.now });
      s.add("_contracts/foo.yaml", { hash: "abc123" });
      expect(s.consume("_contracts/foo.yaml")).toBe(true);
      expect(s.has("_contracts/foo.yaml")).toBe(false);
    });

    it("hash-keyed add honors ttlMs from options object", () => {
      const clock = makeClock();
      const s = new SuppressionSet({ ttlMs: 100, now: clock.now });
      s.add("_contracts/foo.yaml", { hash: "abc123", ttlMs: 5000 });
      clock.advance(500); // past default ttl
      expect(s.has("_contracts/foo.yaml")).toBe(true);
      expect(s.consume("_contracts/foo.yaml", "abc123")).toBe(true);
    });
  });
});
