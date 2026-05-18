import { describe, it, expect } from "vitest";
import { parseChunkId, formatChunkId, decomposeChunkId } from "./chunk-id.js";
import { parseDocId } from "../adapters/registry.js";

describe("ChunkId (Phase 5 / D-04)", () => {
  const docId = parseDocId("obsidian-fs://v/notes/foo.md");

  it("formatChunkId joins a DocId + 7-hex fragment", () => {
    expect(formatChunkId(docId, "a3f5b2c")).toBe(
      "obsidian-fs://v/notes/foo.md#chunk-a3f5b2c",
    );
  });

  it("formatChunkId rejects non-7-hex fragments", () => {
    expect(() => formatChunkId(docId, "toolong0")).toThrow(/Invalid chunk fragment/);
    expect(() => formatChunkId(docId, "abc")).toThrow(/Invalid chunk fragment/);
    expect(() => formatChunkId(docId, "ABCDEFG")).toThrow(/Invalid chunk fragment/); // upper-case
    expect(() => formatChunkId(docId, "zzzzzzz")).toThrow(/Invalid chunk fragment/); // non-hex
  });

  it("parseChunkId accepts well-formed strings", () => {
    const id = parseChunkId("obsidian-fs://v/p.md#chunk-a3f5b2c");
    expect(id).toBe("obsidian-fs://v/p.md#chunk-a3f5b2c");
  });

  it("parseChunkId rejects malformed strings", () => {
    expect(() => parseChunkId("not-a-uri")).toThrow(/Invalid ChunkId/);
    expect(() => parseChunkId("obsidian-fs://v/p.md")).toThrow(/Invalid ChunkId/); // no fragment
    expect(() => parseChunkId("obsidian-fs://v/p.md#chunk-XYZ1234")).toThrow(
      /Invalid ChunkId/,
    ); // upper-case hex
    expect(() => parseChunkId("obsidian-fs://v/p.md#chunk-toolong0")).toThrow(
      /Invalid ChunkId/,
    );
  });

  it("formatChunkId + decomposeChunkId round-trip", () => {
    const id = formatChunkId(docId, "deadbee");
    const parts = decomposeChunkId(id);
    expect(parts.docId).toBe(docId);
    expect(parts.fragment).toBe("deadbee");
  });

  it("parseChunkId then decomposeChunkId on a literal", () => {
    const id = parseChunkId("obsidian-fs://atlas/projects/Atlas-1.md#chunk-a3f5b2c");
    const parts = decomposeChunkId(id);
    expect(parts.fragment).toBe("a3f5b2c");
    expect(parts.docId).toBe("obsidian-fs://atlas/projects/Atlas-1.md");
  });
});
