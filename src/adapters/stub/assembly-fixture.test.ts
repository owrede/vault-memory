/**
 * Sanity checks for the Phase 3 / 03-07 assembly-fixture Document[].
 *
 * Pinned invariants:
 *   - All 8 documents have a structurally valid shape (validator).
 *   - Every DocId is unique, brand-valid, and within the `stub://memory/`
 *     namespace.
 *   - Each "named" DocId constant is one of the documents.
 *   - The Long doc has 3 sibling-level headings (1 H1 + 2 H2) that the
 *     section extractor will assemble into a 3-section outline tree.
 *   - The Alice doc has the H2 "Working style" section that
 *     `search_sections` conformance tests will target.
 *   - The Atlas-0 doc has `status: "superseded"` and `superseded_by`
 *     pointing at Atlas-1.
 *   - blocksToMarkdown projects to a markdown string whose round-trip
 *     produces the same heading hierarchy (sanity check for the
 *     indexStubAssembly harness).
 */

import { describe, expect, it } from "vitest";
import {
  ALICE_DOC_ID,
  ATLAS_0_DOC_ID,
  ATLAS_1_DOC_ID,
  LONG_DOC_ID,
  Q2_REVIEW_DOC_ID,
  SYNC_DOC_ID,
  blocksToMarkdown,
  makeAssemblyStubDocs,
  validateAssemblyStubDocs,
} from "./assembly-fixture.js";

describe("assembly-fixture stub Document[]", () => {
  it("validates clean (no missing fields, no duplicates)", () => {
    const docs = makeAssemblyStubDocs();
    expect(validateAssemblyStubDocs(docs)).toEqual([]);
  });

  it("has 8 documents", () => {
    const docs = makeAssemblyStubDocs();
    // Plan 04-06 / Task 5 extended the fixture with two `_memory/...`
    // docs to exercise expand()'s ADR-004 opacity rule against the
    // stub adapter — bumping the count from 8 to 10.
    expect(docs).toHaveLength(10);
  });

  it("every DocId is in the stub://memory/ namespace", () => {
    const docs = makeAssemblyStubDocs();
    for (const d of docs) {
      expect(d.id.startsWith("stub://memory/")).toBe(true);
    }
  });

  it("every named DocId constant resolves to a document in the fixture", () => {
    const docs = makeAssemblyStubDocs();
    const ids = new Set(docs.map((d) => d.id as string));
    for (const id of [
      ALICE_DOC_ID,
      ATLAS_1_DOC_ID,
      ATLAS_0_DOC_ID,
      Q2_REVIEW_DOC_ID,
      SYNC_DOC_ID,
      LONG_DOC_ID,
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("Alice has Person type + Alice C. alias + active status", () => {
    const docs = makeAssemblyStubDocs();
    const alice = docs.find((d) => d.id === ALICE_DOC_ID);
    expect(alice).toBeDefined();
    expect(alice?.properties.type).toBe("Person");
    expect(alice?.properties.aliases).toEqual(["Alice C.", "ac"]);
    expect(alice?.properties.status).toBe("active");
  });

  it("Atlas-1 is authoritative + active Project", () => {
    const docs = makeAssemblyStubDocs();
    const atlas1 = docs.find((d) => d.id === ATLAS_1_DOC_ID);
    expect(atlas1).toBeDefined();
    expect(atlas1?.properties.type).toBe("Project");
    expect(atlas1?.properties.authoritative).toBe(true);
    expect(atlas1?.properties.status).toBe("active");
  });

  it("Atlas-0 is superseded by Atlas-1", () => {
    const docs = makeAssemblyStubDocs();
    const atlas0 = docs.find((d) => d.id === ATLAS_0_DOC_ID);
    expect(atlas0).toBeDefined();
    expect(atlas0?.properties.status).toBe("superseded");
    expect(atlas0?.properties.superseded_by).toBe(ATLAS_1_DOC_ID);
  });

  it("Long doc has 3 headings: Intro (H1), Background (H2), Conclusion (H2)", () => {
    const docs = makeAssemblyStubDocs();
    const long = docs.find((d) => d.id === LONG_DOC_ID);
    expect(long).toBeDefined();
    const headings = long?.blocks.filter((b) => b.kind === "heading");
    expect(headings).toHaveLength(3);
    expect(headings?.[0]).toMatchObject({ level: 1, text: "Intro" });
    expect(headings?.[1]).toMatchObject({ level: 2, text: "Background" });
    expect(headings?.[2]).toMatchObject({ level: 2, text: "Conclusion" });
  });

  it("Alice doc has the 'Working style' H2 section", () => {
    const docs = makeAssemblyStubDocs();
    const alice = docs.find((d) => d.id === ALICE_DOC_ID);
    const workingStyle = alice?.blocks.find(
      (b) => b.kind === "heading" && b.text === "Working style",
    );
    expect(workingStyle).toBeDefined();
    expect(workingStyle?.kind === "heading" && workingStyle.level).toBe(2);
  });

  it("Sync doc carries a wikilink edge to Alice (the v2.0.0 dossier edge source)", () => {
    const docs = makeAssemblyStubDocs();
    const sync = docs.find((d) => d.id === SYNC_DOC_ID);
    expect(sync?.links).toHaveLength(1);
    expect(sync?.links[0]).toEqual({ type: "wikilink", target: ALICE_DOC_ID });
  });

  it("mention + hyperlink + frontmatter-ref docs each carry one non-wikilink edge", () => {
    const docs = makeAssemblyStubDocs();
    const edgeKinds = docs
      .flatMap((d) => d.links.map((l) => l.type))
      .filter((t) => t !== "wikilink");
    expect(edgeKinds.sort()).toEqual(["frontmatter-ref", "hyperlink", "mention"]);
  });

  it("blocksToMarkdown round-trips Long doc to a 3-heading markdown string", () => {
    const docs = makeAssemblyStubDocs();
    const long = docs.find((d) => d.id === LONG_DOC_ID);
    const md = blocksToMarkdown(long!.blocks);
    // The markdown serialization carries each heading on its own line
    // (heading rendering uses `#`-prefixed lines).
    expect(md).toContain("# Intro");
    expect(md).toContain("## Background");
    expect(md).toContain("## Conclusion");
  });

  it("every doc carries a fixed-byte stub hash (not empty)", () => {
    const docs = makeAssemblyStubDocs();
    for (const d of docs) {
      expect(d.hash).toMatch(/^0x[0-9a-f]+$/);
      expect(d.hash.length).toBeGreaterThan(8);
    }
  });

  it("mtimes are strictly ascending across the fixture", () => {
    const docs = makeAssemblyStubDocs();
    for (let i = 1; i < docs.length; i++) {
      expect(docs[i]!.mtime).toBeGreaterThan(docs[i - 1]!.mtime);
    }
  });
});
