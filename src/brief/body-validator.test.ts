/**
 * Phase 5 / D-11 — BriefBodyValidator tests.
 *
 * The validator runs after the LLM ladder and before
 * `delivery.write` — it enforces "every source has a wikilink",
 * appending a `## Sources` footer for any missing reference. The
 * Phase 4 D-02 indexer materializes back-edges on the next pass.
 */

import { describe, it, expect } from "vitest";
import { parseDocId } from "../adapters/registry.js";
import { validateAndPatchBody } from "./body-validator.js";

const docA = parseDocId("obsidian-fs://v/projects/atlas-1.md");
const docB = parseDocId("obsidian-fs://v/projects/atlas-2.md");
const docC = parseDocId("obsidian-fs://v/meetings/standup.md");

const titles: Record<string, string> = {
  [docA]: "Atlas-1",
  [docB]: "Atlas-2",
  [docC]: "Standup",
};
const resolveTitle = (id: string) => titles[id] ?? id;

describe("validateAndPatchBody (D-11)", () => {
  it("returns body unchanged when every source is referenced by title", () => {
    const body = "Atlas-1 status: [[Atlas-1]] hit ROI per [[Atlas-2]].";
    const out = validateAndPatchBody(body, [docA, docB], resolveTitle);
    expect(out).toBe(body);
  });

  it("returns body unchanged when sources are referenced via aliases or headings", () => {
    const body = "See [[Atlas-1|the project]] and [[Atlas-2#status]] for context.";
    const out = validateAndPatchBody(body, [docA, docB], resolveTitle);
    expect(out).toBe(body);
  });

  it("returns body unchanged when sources are referenced by raw DocId (escape hatch)", () => {
    const body = `Reference: [[${docA}]] and [[Atlas-2]].`;
    const out = validateAndPatchBody(body, [docA, docB], resolveTitle);
    expect(out).toBe(body);
  });

  it("appends a Sources footer with only the missing references", () => {
    const body = "Some narrative. [[Atlas-1]] but other sources are uncited.";
    const out = validateAndPatchBody(body, [docA, docB, docC], resolveTitle);
    expect(out.startsWith(body)).toBe(true);
    // Should contain only Atlas-2 and Standup (Atlas-1 is cited).
    expect(out).toContain("## Sources");
    expect(out).toContain("- [[Atlas-2]]");
    expect(out).toContain("- [[Standup]]");
    expect(out.split("Atlas-1").length).toBe(2); // body has one occurrence; footer adds none
  });

  it("appends a Sources footer when nothing in body cites any source", () => {
    const body = "Bare summary with no wikilinks at all.";
    const out = validateAndPatchBody(body, [docA, docB], resolveTitle);
    expect(out).toContain("\n\n## Sources\n");
    expect(out).toContain("- [[Atlas-1]]");
    expect(out).toContain("- [[Atlas-2]]");
  });

  it("returns body unchanged when sourceDocIds is empty", () => {
    const body = "No sources to validate.";
    const out = validateAndPatchBody(body, [], resolveTitle);
    expect(out).toBe(body);
  });

  it("matches the wikilink shapes the Phase 4 D-02 indexer parses (alias / heading / both)", () => {
    // Same regex shape as src/indexer/extract-edges.ts — verifies
    // the validator and the indexer agree on what counts as a citation.
    const shapes = [
      "[[Atlas-1]]",
      "[[Atlas-1|alias]]",
      "[[Atlas-1#heading]]",
      "[[Atlas-1#heading|alias]]",
    ];
    for (const s of shapes) {
      const out = validateAndPatchBody(`see ${s}`, [docA], resolveTitle);
      expect(out).toBe(`see ${s}`);
    }
  });
});
