/**
 * StubDelivery co-located tests.
 *
 * Exercise the in-memory DeliveryAdapter behavior + the shared-Map pattern
 * with StubSource (read-after-write round-trip).
 */

import { describe, expect, it } from "vitest";
import { StubDelivery } from "./delivery.js";
import { StubSource } from "./source.js";
import { formatDocId } from "../registry.js";
import type { Document, DocId } from "../../types.js";

describe("StubDelivery", () => {
  it("publishes honest hashProtected=none capabilities", () => {
    const delivery = new StubDelivery(new Map());
    expect(delivery.capabilities).toEqual({
      atomic: true,
      hashProtected: "none",
      enforcedSchema: false,
      naming: "caller-provided",
    });
  });

  it("handle is stub://memory", () => {
    const delivery = new StubDelivery(new Map());
    expect(delivery.handle).toBe("stub://memory");
  });

  it("write(new id) succeeds with created:true", async () => {
    const docs = new Map<DocId, Document>();
    const delivery = new StubDelivery(docs);
    const id = formatDocId("stub", "memory", "hi.md");
    const res = await delivery.write(id, {
      blocks: [{ kind: "paragraph", text: "Hello" }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.created).toBe(true);
    expect(res.doc_id).toBe(id);
    expect(docs.has(id)).toBe(true);
  });

  it("write(existing id) returns created:false", async () => {
    const docs = new Map<DocId, Document>();
    const delivery = new StubDelivery(docs);
    const id = formatDocId("stub", "memory", "a.md");
    await delivery.write(id, { blocks: [{ kind: "paragraph", text: "v1" }] });
    const res = await delivery.write(id, { blocks: [{ kind: "paragraph", text: "v2" }] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.created).toBe(false);
  });

  it("write ignores expectedHash (hashProtected=none honesty)", async () => {
    const docs = new Map<DocId, Document>();
    const delivery = new StubDelivery(docs);
    const id = formatDocId("stub", "memory", "b.md");
    await delivery.write(id, { blocks: [{ kind: "paragraph", text: "v1" }] });
    // Wrong expectedHash MUST still succeed — capability says none.
    const res = await delivery.write(
      id,
      { blocks: [{ kind: "paragraph", text: "v2" }] },
      { expectedHash: "wrong" },
    );
    expect(res.ok).toBe(true);
  });

  it("update(unknown id) → not_found", async () => {
    const delivery = new StubDelivery(new Map());
    const id = formatDocId("stub", "memory", "ghost.md");
    const res = await delivery.update(id, { properties: { x: 1 } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("not_found");
  });

  it("update(existing id) merges properties shallow", async () => {
    const docs = new Map<DocId, Document>();
    const delivery = new StubDelivery(docs);
    const id = formatDocId("stub", "memory", "m.md");
    await delivery.write(id, {
      blocks: [{ kind: "paragraph", text: "body" }],
      properties: { a: 1, b: 2 },
    });
    const res = await delivery.update(id, { properties: { b: 99, c: 3 } });
    expect(res.ok).toBe(true);
    const stored = docs.get(id);
    expect(stored?.properties).toEqual({ a: 1, b: 99, c: 3 });
  });

  it("delete(known id) → ok + Map.delete observed", async () => {
    const docs = new Map<DocId, Document>();
    const delivery = new StubDelivery(docs);
    const id = formatDocId("stub", "memory", "rm.md");
    await delivery.write(id, { blocks: [{ kind: "paragraph", text: "x" }] });
    expect(docs.has(id)).toBe(true);

    const res = await delivery.delete(id);
    expect(res.ok).toBe(true);
    expect(docs.has(id)).toBe(false);
  });

  it("delete(unknown id) → not_found", async () => {
    const delivery = new StubDelivery(new Map());
    const id = formatDocId("stub", "memory", "never.md");
    const res = await delivery.delete(id);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("not_found");
  });

  it("shared-Map pattern: StubDelivery write → StubSource readDocument", async () => {
    const docs = new Map<DocId, Document>();
    const source = new StubSource(docs);
    const delivery = new StubDelivery(docs);

    const id = formatDocId("stub", "memory", "round-trip.md");
    await delivery.write(id, {
      blocks: [{ kind: "paragraph", text: "round-trip" }],
      properties: { author: "stub" },
    });

    // Same Map: StubSource sees the write immediately.
    expect(await source.exists(id)).toBe(true);
    const doc = await source.readDocument(id);
    expect(doc.properties).toEqual({ author: "stub" });
  });
});
