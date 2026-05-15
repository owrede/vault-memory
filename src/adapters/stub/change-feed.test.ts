/**
 * StubChangeFeed unit tests. Covers the stub-specific behavior; the
 * cross-adapter floor is in `src/adapters/change-feed/conformance.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { StubChangeFeed } from "./change-feed.js";
import type { ChangeEvent } from "../../types.js";
import { formatDocId } from "../registry.js";

function ev(kind: "create" | "update" | "delete", resource: string): ChangeEvent {
  const id = formatDocId("stub", "memory", resource);
  return { kind, id, at: Date.now() };
}

describe("StubChangeFeed", () => {
  it("publishes capabilities { watch: 'push', emitsRename: true }", () => {
    const feed = new StubChangeFeed();
    expect(feed.capabilities.watch).toBe("push");
    expect(feed.capabilities.emitsRename).toBe(true);
  });

  it("emit() drives a handler synchronously after subscribe()", () => {
    const feed = new StubChangeFeed();
    const seen: ChangeEvent[] = [];
    feed.subscribe((e) => {
      seen.push(e);
    });
    const e1 = ev("create", "a.md");
    feed.emit(e1);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(e1);
  });

  it("multiple subscribers each receive every event", () => {
    const feed = new StubChangeFeed();
    const a: ChangeEvent[] = [];
    const b: ChangeEvent[] = [];
    feed.subscribe((e) => a.push(e));
    feed.subscribe((e) => b.push(e));
    feed.emit(ev("update", "x.md"));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("Disposable unsubscribes synchronously", () => {
    const feed = new StubChangeFeed();
    const seen: ChangeEvent[] = [];
    const sub = feed.subscribe((e) => seen.push(e));
    feed.emit(ev("create", "1.md"));
    sub[Symbol.dispose]();
    feed.emit(ev("update", "2.md"));
    expect(seen).toHaveLength(1);
  });

  it("close() is idempotent and stops events from firing", async () => {
    const feed = new StubChangeFeed();
    const seen: ChangeEvent[] = [];
    feed.subscribe((e) => seen.push(e));
    await feed.close();
    await feed.close(); // idempotent
    feed.emit(ev("create", "post-close.md"));
    expect(seen).toHaveLength(0);
  });

  it("emitsRename:true permits synthetic rename events", () => {
    const feed = new StubChangeFeed();
    const seen: ChangeEvent[] = [];
    feed.subscribe((e) => seen.push(e));
    const renameEvent: ChangeEvent = {
      kind: "rename",
      old_id: formatDocId("stub", "memory", "a.md"),
      new_id: formatDocId("stub", "memory", "b.md"),
      at: Date.now(),
    };
    feed.emit(renameEvent);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe("rename");
  });

  it("handler exceptions do not crash the feed", () => {
    const feed = new StubChangeFeed();
    feed.subscribe(() => {
      throw new Error("boom");
    });
    expect(() => feed.emit(ev("update", "ok.md"))).not.toThrow();
  });
});
