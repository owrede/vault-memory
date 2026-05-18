/**
 * Unit tests for TYPES_CATALOG (Phase 6 / D-A3b, ADR-006 §Decision 6).
 *
 * The catalog is additive-only. Phase 10 may extend `DocId.pattern` for
 * `notion://`; we MUST NEVER narrow. These tests pin the v2.0.0 shape so a
 * future tightening change becomes a visible diff.
 */

import { describe, it, expect } from "vitest";
import { TYPES_CATALOG } from "./types-catalog.js";

describe("TYPES_CATALOG (D-A3b, ADR-006 §Decision 6)", () => {
  it("Test 1: DocId pattern matches '<lowercase-scheme>://'", () => {
    const docId = TYPES_CATALOG.DocId as Record<string, unknown>;
    expect(docId).toBeDefined();
    expect(docId.type).toBe("string");
    expect(docId.pattern).toBe("^[a-z][a-z0-9-]*://");
    expect(typeof docId.description).toBe("string");

    // Functional sanity: the pattern accepts the v2 obsidian-fs URIs and
    // forward-compatible schemes.
    const re = new RegExp(docId.pattern as string);
    expect(re.test("obsidian-fs://my-vault/notes/foo.md")).toBe(true);
    expect(re.test("notion://workspace/page-id")).toBe(true);
    expect(re.test("file:/etc/passwd")).toBe(false);
    expect(re.test("no-scheme")).toBe(false);
  });

  it("Test 2: ChunkId pattern matches Phase 5 ADR-003 H-5 (7-hex fragment)", () => {
    const chunkId = TYPES_CATALOG.ChunkId as Record<string, unknown>;
    expect(chunkId.type).toBe("string");
    expect(chunkId.pattern).toBe("^[a-z][a-z0-9-]*://.+#chunk-[0-9a-f]{7}$");
    const re = new RegExp(chunkId.pattern as string);
    expect(re.test("obsidian-fs://v/p.md#chunk-a3f5b2c")).toBe(true);
    expect(re.test("obsidian-fs://v/p.md#chunk-deadbee")).toBe(true);
    // Reject malformed strings
    expect(re.test("obsidian-fs://v/p.md")).toBe(false);
    expect(re.test("obsidian-fs://v/p.md#chunk-")).toBe(false);
    expect(re.test("obsidian-fs://v/p.md#chunk-a3f5b2cXX")).toBe(false);
    expect(re.test("obsidian-fs://v/p.md#chunk-a3f5b2")).toBe(false); // only 6 hex
  });

  it("Test 3: MemorySink carries x-validator: 'memory-sink' extension keyword", () => {
    const sink = TYPES_CATALOG.MemorySink as Record<string, unknown>;
    expect(sink.type).toBe("string");
    expect(sink["x-validator"]).toBe("memory-sink");
  });

  it("catalog is frozen — additive-only contract is structurally enforced", () => {
    // Object.freeze(Object.freeze(...)) — mutation attempts must throw
    // in strict mode (the test file is an ESM module, so strict is implied).
    expect(() => {
      (TYPES_CATALOG as Record<string, unknown>).Newcomer = {};
    }).toThrow();
  });

  it("Handle is structurally identical to DocId today (future-proof split)", () => {
    const handle = TYPES_CATALOG.Handle as Record<string, unknown>;
    const docId = TYPES_CATALOG.DocId as Record<string, unknown>;
    expect(handle.type).toBe(docId.type);
    expect(handle.pattern).toBe(docId.pattern);
  });
});
