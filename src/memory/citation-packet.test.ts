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
} from "./citation-packet.js";
import type { Document } from "../types.js";

function makeDoc(overrides: Partial<Document> & { heading_path?: string[] } = {}): Document & {
  heading_path?: string[];
} {
  const id = formatDocId(
    "obsidian-fs",
    "atlas",
    "_memory/observations/2026-04-22-test.md",
  );
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

describe("displayUrlFor — obsidian-fs scheme", () => {
  it("constructs obsidian://open?vault=…&file=… for an obsidian-fs DocId", () => {
    const id = formatDocId(
      "obsidian-fs",
      "atlas",
      "_memory/observations/foo.md",
    );
    expect(displayUrlFor(id)).toBe(
      "obsidian://open?vault=atlas&file=_memory%2Fobservations%2Ffoo.md",
    );
  });

  it("URL-encodes spaces as %20 in both vault name and resource", () => {
    const id = formatDocId(
      "obsidian-fs",
      "my vault",
      "Daily Notes/2026-05-15 Friday.md",
    );
    expect(displayUrlFor(id)).toBe(
      "obsidian://open?vault=my%20vault&file=Daily%20Notes%2F2026-05-15%20Friday.md",
    );
  });

  it("URL-encodes Unicode characters in the resource path", () => {
    const id = formatDocId(
      "obsidian-fs",
      "atlas",
      "Personen/Müller.md",
    );
    const url = displayUrlFor(id);
    expect(url).toContain("obsidian://open?vault=atlas&file=");
    // Müller encoded as M%C3%BCller (UTF-8 percent-encoded).
    expect(url).toContain("M%C3%BCller");
  });
});

describe("displayUrlFor — non-obsidian-fs schemes return the DocId itself", () => {
  it("returns the DocId verbatim for a notion-api DocId (future adapter)", () => {
    // Using a brand-cast through formatDocId with a future scheme. The
    // function is scheme-aware: only obsidian-fs gets the obsidian:// URL.
    const id = formatDocId("notion-api", "workspace-id", "page-id");
    expect(displayUrlFor(id)).toBe(id);
  });
});
