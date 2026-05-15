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
});
