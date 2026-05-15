/**
 * StubSource — co-located unit tests.
 *
 * The conformance proof; see ../source/conformance.test.ts for the
 * parameterized cross-adapter assertions.
 */

import { describe, expect, it } from "vitest";
import { StubSource } from "./source.js";
import { parseDocId, parseSourceHandle } from "../registry.js";
import type { Document } from "../../types.js";

function makeDoc(id: string, hash: string, mtime: number): Document {
  return {
    id: parseDocId(id),
    source: parseSourceHandle("stub://memory"),
    title: id.slice(id.lastIndexOf("/") + 1),
    blocks: [{ kind: "paragraph", text: `body of ${id}` }],
    properties: {},
    links: [],
    mtime,
    hash,
  };
}

describe("StubSource", () => {
  it("publishes honest capabilities", () => {
    const s = new StubSource();
    expect(s.capabilities).toMatchObject({
      bodyShape: "flat-text",
      properties: "untyped",
      linkTypes: [],
      identityStable: true,
      permissions: false,
      contentHashStable: true,
      refHashKind: "content",
      watch: "push",
    });
  });

  it("exposes a stub:// source handle", () => {
    const s = new StubSource();
    expect(s.handle).toBe(parseSourceHandle("stub://memory"));
  });

  it("listDocuments yields seeded refs", async () => {
    const a = makeDoc("stub://memory/a.md", "h-a", 1000);
    const b = makeDoc("stub://memory/b.md", "h-b", 2000);
    const s = new StubSource([a, b]);
    const refs = [];
    for await (const ref of s.listDocuments()) refs.push(ref);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("readDocument round-trips a seeded document", async () => {
    const a = makeDoc("stub://memory/a.md", "h-a", 1000);
    const s = new StubSource([a]);
    const got = await s.readDocument(a.id);
    expect(got).toEqual(a);
  });

  it("readDocument throws on unknown id", async () => {
    const s = new StubSource();
    await expect(s.readDocument(parseDocId("stub://memory/missing.md"))).rejects.toThrow(/not found/);
  });

  it("exists returns true/false without throwing", async () => {
    const a = makeDoc("stub://memory/a.md", "h-a", 1000);
    const s = new StubSource([a]);
    await expect(s.exists(a.id)).resolves.toBe(true);
    await expect(s.exists(parseDocId("stub://memory/missing.md"))).resolves.toBe(false);
  });

  it("hash returns the seeded value", async () => {
    const a = makeDoc("stub://memory/a.md", "h-a", 1000);
    const s = new StubSource([a]);
    await expect(s.hash(a.id)).resolves.toBe("h-a");
  });

  it("formatDisplayUrl returns null (stub has no presentation URL)", () => {
    const s = new StubSource();
    expect(s.formatDisplayUrl()).toBeNull();
  });
});
