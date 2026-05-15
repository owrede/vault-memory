import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DebouncedQueue } from "./queue.js";
import type { QueueEvent } from "./queue.js";

describe("DebouncedQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes a single event after debounceMs", async () => {
    const flushed: QueueEvent[] = [];
    const q = new DebouncedQueue({
      debounceMs: 500,
      onFlush: (e) => {
        flushed.push(e);
      },
    });

    q.enqueue({ path: "a.md", kind: "change" });
    expect(flushed).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(499);
    expect(flushed).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(flushed).toEqual([{ path: "a.md", kind: "change" }]);
  });

  it("coalesces two events on the same path within debounceMs", async () => {
    const flushed: QueueEvent[] = [];
    const q = new DebouncedQueue({
      debounceMs: 500,
      onFlush: (e) => {
        flushed.push(e);
      },
    });

    q.enqueue({ path: "a.md", kind: "change" });
    await vi.advanceTimersByTimeAsync(200);
    q.enqueue({ path: "a.md", kind: "change" });
    await vi.advanceTimersByTimeAsync(499);
    expect(flushed).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(flushed).toEqual([{ path: "a.md", kind: "change" }]);
  });

  it("flushes two different paths independently", async () => {
    const flushed: QueueEvent[] = [];
    const q = new DebouncedQueue({
      debounceMs: 500,
      onFlush: (e) => {
        flushed.push(e);
      },
    });

    q.enqueue({ path: "a.md", kind: "change" });
    q.enqueue({ path: "b.md", kind: "change" });
    await vi.advanceTimersByTimeAsync(500);
    expect(flushed).toHaveLength(2);
    const paths = flushed.map((e) => e.path).sort();
    expect(paths).toEqual(["a.md", "b.md"]);
  });

  it("change followed by delete flushes as delete", async () => {
    const flushed: QueueEvent[] = [];
    const q = new DebouncedQueue({
      debounceMs: 500,
      onFlush: (e) => {
        flushed.push(e);
      },
    });

    q.enqueue({ path: "a.md", kind: "change" });
    await vi.advanceTimersByTimeAsync(100);
    q.enqueue({ path: "a.md", kind: "delete" });
    await vi.advanceTimersByTimeAsync(500);
    expect(flushed).toEqual([{ path: "a.md", kind: "delete" }]);
  });

  it("delete followed by change flushes as change (file came back)", async () => {
    const flushed: QueueEvent[] = [];
    const q = new DebouncedQueue({
      debounceMs: 500,
      onFlush: (e) => {
        flushed.push(e);
      },
    });

    q.enqueue({ path: "a.md", kind: "delete" });
    await vi.advanceTimersByTimeAsync(100);
    q.enqueue({ path: "a.md", kind: "change" });
    await vi.advanceTimersByTimeAsync(500);
    expect(flushed).toEqual([{ path: "a.md", kind: "change" }]);
  });

  it("flushAll awaits all pending onFlush calls", async () => {
    const flushed: QueueEvent[] = [];
    let resolveAll!: () => void;
    const gate = new Promise<void>((r) => {
      resolveAll = r;
    });
    const q = new DebouncedQueue({
      debounceMs: 500,
      onFlush: async (e) => {
        await gate;
        flushed.push(e);
      },
    });

    q.enqueue({ path: "a.md", kind: "change" });
    q.enqueue({ path: "b.md", kind: "change" });
    q.enqueue({ path: "c.md", kind: "delete" });
    expect(q.size()).toBe(3);

    const flushPromise = q.flushAll();
    expect(q.size()).toBe(0);
    // Let dispatch happen
    await Promise.resolve();
    resolveAll();
    await flushPromise;

    expect(flushed).toHaveLength(3);
    const paths = flushed.map((e) => e.path).sort();
    expect(paths).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("shutdown cancels pending events", async () => {
    const flushed: QueueEvent[] = [];
    const q = new DebouncedQueue({
      debounceMs: 500,
      onFlush: (e) => {
        flushed.push(e);
      },
    });

    q.enqueue({ path: "a.md", kind: "change" });
    q.enqueue({ path: "b.md", kind: "change" });
    expect(q.size()).toBe(2);

    q.shutdown();
    expect(q.size()).toBe(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(flushed).toHaveLength(0);

    // enqueue after shutdown is a no-op
    q.enqueue({ path: "c.md", kind: "change" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(flushed).toHaveLength(0);

    // shutdown is idempotent
    expect(() => {
      q.shutdown();
    }).not.toThrow();
  });

  it("respects maxLatencyMs by force-flushing entries that sit too long", async () => {
    const flushed: QueueEvent[] = [];
    const q = new DebouncedQueue({
      debounceMs: 500,
      maxLatencyMs: 1000,
      onFlush: (e) => {
        flushed.push(e);
      },
    });

    // Re-enqueue every 100ms — without maxLatencyMs this would never fire.
    // With maxLatencyMs=1000 it must fire by ~1000ms.
    q.enqueue({ path: "a.md", kind: "change" });
    for (let i = 0; i < 11; i++) {
      await vi.advanceTimersByTimeAsync(100);
      q.enqueue({ path: "a.md", kind: "change" });
    }
    // We have advanced 1100ms total of enqueue cycles. Latency cap should
    // have triggered at least one flush by now.
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed.length).toBeGreaterThanOrEqual(1);
    expect(flushed[0]).toEqual({ path: "a.md", kind: "change" });
  });

  it("invokes onError when onFlush throws synchronously", async () => {
    const errors: Array<{ event: QueueEvent; err: unknown }> = [];
    const q = new DebouncedQueue({
      debounceMs: 500,
      onFlush: () => {
        throw new Error("boom");
      },
      onError: (event, err) => {
        errors.push({ event, err });
      },
    });

    q.enqueue({ path: "a.md", kind: "change" });
    await vi.advanceTimersByTimeAsync(500);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.event).toEqual({ path: "a.md", kind: "change" });
    expect((errors[0]?.err as Error).message).toBe("boom");
  });

  it("invokes onError when onFlush rejects asynchronously", async () => {
    const errors: Array<{ event: QueueEvent; err: unknown }> = [];
    const q = new DebouncedQueue({
      debounceMs: 500,
      onFlush: async () => {
        throw new Error("async-boom");
      },
      onError: (event, err) => {
        errors.push({ event, err });
      },
    });

    q.enqueue({ path: "a.md", kind: "change" });
    await vi.advanceTimersByTimeAsync(500);
    await q.flushAll(); // drain in-flight

    expect(errors).toHaveLength(1);
    expect((errors[0]?.err as Error).message).toBe("async-boom");
  });
});
