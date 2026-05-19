/**
 * verb-list.test.ts — Phase 7 / Plan 07-05 / Task 1.
 *
 * Pattern F doc-block: D-PALETTE (07-CONTEXT.md §"D-PALETTE" — five-section
 * palette structure). The baseline verb list is sourced from the Phase 6
 * closed enum via shared-types; categorization mirrors the palette
 * sections 2/3/4 (read / assembly / escape).
 *
 * Test coverage per Plan 07-05 §Task 1 acceptance:
 *   1. VERB_CATEGORIES partitions BASELINE_VERBS without gaps.
 *   2. `escape` section always contains `literal`.
 *   3. Static-assertion holds — set union of read+assembly equals BASELINE_VERBS.
 */

import { describe, expect, it } from "vitest";
import { BASELINE_VERBS, VERB_CATEGORIES } from "./verb-list.js";

describe("verb-list", () => {
  it("VERB_CATEGORIES partitions BASELINE_VERBS without gaps", () => {
    const read = new Set(VERB_CATEGORIES.read);
    const assembly = new Set(VERB_CATEGORIES.assembly);
    const partitioned = new Set<string>([...read, ...assembly]);
    const baseline = new Set<string>(BASELINE_VERBS);
    // Every baseline verb appears in exactly one of read/assembly.
    for (const v of baseline) {
      const inRead = read.has(v);
      const inAssembly = assembly.has(v);
      expect(inRead || inAssembly, `${v} must appear in read OR assembly`).toBe(true);
      expect(inRead && inAssembly, `${v} must NOT appear in both`).toBe(false);
    }
    expect(partitioned).toEqual(baseline);
  });

  it("escape section contains literal", () => {
    expect(VERB_CATEGORIES.escape).toContain("literal");
  });

  it("BASELINE_VERBS matches the Phase 6 closed-enum 11-verb set", () => {
    expect(BASELINE_VERBS).toHaveLength(11);
    expect(new Set(BASELINE_VERBS)).toEqual(
      new Set([
        "search_hybrid",
        "expand",
        "cluster",
        "recall",
        "compile_brief",
        "get_brief",
        "query_frontmatter",
        "list_backlinks",
        "get_outline",
        "search_sections",
        "read_note",
      ]),
    );
  });
});
