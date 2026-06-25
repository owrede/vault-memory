/**
 * Tests for `CitationPacket` + `toCitationPacket` + `displayUrlFor`.
 *
 * Pins the D-01 8-field shape, the read-side `hash` semantics (the
 * packet `hash` must mirror `Document.hash`, NOT `WriteSuccess.newHash`),
 * the defensive shallow-copy of `properties` and `heading_path` (caller
 * mutations cannot leak back), and the obsidian:// URL construction
 * with URL-encoding correctness.
 */

import { describe, it, expect } from "vitest";
import { formatDocId, parseSourceHandle } from "../adapters/registry.js";
import {
  type CitationPacket,
  displayUrlFor,
  toCitationPacket,
  withPropertyExtras,
} from "./citation-packet.js";
import type { Document } from "../types.js";

function makeDoc(overrides: Partial<Document> & { heading_path?: string[] } = {}): Document & {
  heading_path?: string[];
} {
  const id = formatDocId("obsidian-fs", "atlas", "_memory/observations/2026-04-22-test.md");
  const source = parseSourceHandle("obsidian-fs://atlas");
  const base: Document & { heading_path?: string[] } = {
    id,
    source,
    title: "Test observation",
    blocks: [{ kind: "paragraph", text: "body" }],
    properties: { confidence: "direct", type: "observation" },
    links: [],
    mtime: 1_715_000_000_000,
    hash: "abc123def456",
  };
  return { ...base, ...overrides };
}

describe("CitationPacket — D-01 shape", () => {
  it("toCitationPacket returns exactly the 8 D-01 fields, all present", () => {
    const doc = makeDoc({ heading_path: ["Intro", "Background"] });
    const packet: CitationPacket = toCitationPacket(doc, "obsidian://open?vault=atlas&file=foo");
    const keys = Object.keys(packet).sort();
    expect(keys).toEqual(
      [
        "display_url",
        "doc_id",
        "hash",
        "heading_path",
        "mtime",
        "properties",
        "source_handle",
        "title",
      ].sort(),
    );
    expect(packet.doc_id).toBe(doc.id);
    expect(packet.source_handle).toBe(doc.source);
    expect(packet.title).toBe("Test observation");
    expect(packet.heading_path).toEqual(["Intro", "Background"]);
    expect(packet.mtime).toBe(doc.mtime);
    expect(packet.hash).toBe("abc123def456");
    expect(packet.display_url).toBe("obsidian://open?vault=atlas&file=foo");
    expect(packet.properties).toEqual({ confidence: "direct", type: "observation" });
  });

  it("packet.hash mirrors Document.hash (read-side; never aliased to newHash)", () => {
    const doc = makeDoc({ hash: "read-side-hash-value" });
    const packet = toCitationPacket(doc, "obsidian://x");
    expect(packet.hash).toBe("read-side-hash-value");
    // Negative pin: there is no `newHash` on a citation packet — that's the
    // write-side WriteSuccess field, not the read-side Document field.
    expect((packet as Record<string, unknown>).newHash).toBeUndefined();
  });

  it("heading_path defaults to [] when the input doc has no heading_path", () => {
    const doc = makeDoc(); // no heading_path provided
    const packet = toCitationPacket(doc, "obsidian://x");
    expect(packet.heading_path).toEqual([]);
  });

  it("mutating packet.heading_path does NOT mutate the source doc's heading_path", () => {
    const doc = makeDoc({ heading_path: ["A"] });
    const packet = toCitationPacket(doc, "obsidian://x");
    packet.heading_path.push("X");
    expect(packet.heading_path).toEqual(["A", "X"]);
    expect(doc.heading_path).toEqual(["A"]);
  });

  it("mutating packet.properties does NOT mutate the source doc's properties", () => {
    const doc = makeDoc({ properties: { confidence: "direct", type: "observation" } });
    const packet = toCitationPacket(doc, "obsidian://x");
    packet.properties.foo = "leaked";
    expect(packet.properties.foo).toBe("leaked");
    expect((doc.properties as Record<string, unknown>).foo).toBeUndefined();
  });
});

describe("displayUrlFor — adapter seam delegation", () => {
  it("delegates to the source's formatDisplayUrl when available", () => {
    const id = formatDocId("obsidian-fs", "atlas", "_memory/observations/foo.md");
    const fakeSource = {
      formatDisplayUrl: (d: typeof id): string => `fake://${d}#test`,
    };
    expect(displayUrlFor(id, fakeSource)).toBe(`fake://${id}#test`);
  });

  it("falls back to the DocId string when the adapter omits formatDisplayUrl", () => {
    const id = formatDocId("notion-api", "workspace-id", "page-id");
    const fakeSource = {}; // no formatDisplayUrl
    expect(displayUrlFor(id, fakeSource)).toBe(id);
  });

  it("falls back to the DocId string when formatDisplayUrl returns null", () => {
    const id = formatDocId("notion-api", "workspace-id", "page-id");
    const fakeSource = {
      formatDisplayUrl: (_d: typeof id): string | null => null,
    };
    expect(displayUrlFor(id, fakeSource)).toBe(id);
  });
});

describe("withPropertyExtras — shared status/superseded_by denormalization", () => {
  it("attaches status when properties.status is a string", () => {
    const packet = toCitationPacket(makeDoc({ properties: { status: "active" } }), "obsidian://x");
    const out = withPropertyExtras(packet);
    expect(out.status).toBe("active");
  });

  it("attaches superseded_by when properties.superseded_by is a string", () => {
    const packet = toCitationPacket(
      makeDoc({ properties: { superseded_by: "obsidian://atlas/newer.md" } }),
      "obsidian://x",
    );
    const out = withPropertyExtras(packet);
    expect(out.superseded_by).toBe("obsidian://atlas/newer.md");
  });

  it("omits status/superseded_by when the property is not a string", () => {
    const packet = toCitationPacket(
      makeDoc({ properties: { status: 42, superseded_by: ["a"] } }),
      "obsidian://x",
    );
    const out = withPropertyExtras(packet);
    expect(out.status).toBeUndefined();
    expect(out.superseded_by).toBeUndefined();
  });

  it("omits both when the property keys are absent", () => {
    const packet = toCitationPacket(makeDoc({ properties: { type: "note" } }), "obsidian://x");
    const out = withPropertyExtras(packet);
    expect(out.status).toBeUndefined();
    expect(out.superseded_by).toBeUndefined();
  });

  it("returns a fresh object; does not mutate the input packet", () => {
    const packet = toCitationPacket(makeDoc({ properties: { status: "active" } }), "obsidian://x");
    const out = withPropertyExtras(packet);
    expect(out).not.toBe(packet);
    expect((packet as Record<string, unknown>).status).toBeUndefined();
  });

  it("preserves a subtype's extra fields (generic T passthrough)", () => {
    const base = toCitationPacket(makeDoc({ properties: { status: "active" } }), "obsidian://x");
    const withRelation = { ...base, relation: "wikilink" as const };
    const out = withPropertyExtras(withRelation);
    expect(out.relation).toBe("wikilink");
    expect(out.status).toBe("active");
  });
});
