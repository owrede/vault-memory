/**
 * Frontmatter-aware rescore/filter for search_hybrid — pure-helper tests.
 * (DB hydration is a memoized getByPath lookup; the match/boost/filter
 * logic is pure and tested here with an in-memory frontmatter map.)
 */

import { describe, it, expect } from "vitest";
import {
  matchesFrontmatterCondition,
  applyFrontmatterRescore,
} from "./search.js";
import type { SearchHit } from "../../types.js";

function hit(notePath: string, score: number): SearchHit {
  return {
    vault: "v",
    notePath,
    noteTitle: notePath.replace(/\.md$/i, ""),
    chunkText: "…",
    chunkIdx: 0,
    headingPath: null,
    score,
    scoreBreakdown: {},
  };
}

describe("matchesFrontmatterCondition", () => {
  it("matches scalar values via String()", () => {
    expect(matchesFrontmatterCondition({ class: "Person" }, { key: "class", value: "Person" })).toBe(true);
    expect(matchesFrontmatterCondition({ class: "Sync" }, { key: "class", value: "Person" })).toBe(false);
    expect(matchesFrontmatterCondition({ authoritative: true }, { key: "authoritative", value: "true" })).toBe(true);
    expect(matchesFrontmatterCondition({ year: 2026 }, { key: "year", value: "2026" })).toBe(true);
  });
  it("matches array-valued fields by membership", () => {
    expect(matchesFrontmatterCondition({ tags: ["a", "b"] }, { key: "tags", value: "b" })).toBe(true);
    expect(matchesFrontmatterCondition({ tags: ["a", "b"] }, { key: "tags", value: "c" })).toBe(false);
  });
  it("never matches null/undefined/missing", () => {
    expect(matchesFrontmatterCondition(null, { key: "class", value: "Person" })).toBe(false);
    expect(matchesFrontmatterCondition({}, { key: "class", value: "Person" })).toBe(false);
    expect(matchesFrontmatterCondition({ class: null }, { key: "class", value: "null" })).toBe(false);
  });
});

describe("applyFrontmatterRescore", () => {
  const FM: Record<string, Record<string, unknown>> = {
    "person.md": { class: "Person" },
    "minutes.md": { class: "Sync" },
    "plain.md": {},
  };
  const fmFor = (h: SearchHit): Record<string, unknown> | null => FM[h.notePath] ?? null;

  it("boost lifts a matching note above a higher-scored non-match", () => {
    const hits = [hit("minutes.md", 0.03), hit("person.md", 0.02)];
    const out = applyFrontmatterRescore(hits, {
      boosts: [{ key: "class", value: "Person", weight: 0.05 }],
      fmFor,
    });
    expect(out.map((h) => h.notePath)).toEqual(["person.md", "minutes.md"]);
    expect(out[0]!.score).toBeCloseTo(0.07);
    // input hits are not mutated
    expect(hits[1]!.score).toBeCloseTo(0.02);
  });

  it("filter keeps only notes matching ALL conditions", () => {
    const hits = [hit("minutes.md", 0.03), hit("person.md", 0.02), hit("plain.md", 0.01)];
    const out = applyFrontmatterRescore(hits, {
      filter: [{ key: "class", value: "Person" }],
      fmFor,
    });
    expect(out.map((h) => h.notePath)).toEqual(["person.md"]);
  });

  it("filter and boost compose (filter first, then boost re-sorts)", () => {
    const hits = [hit("minutes.md", 0.05), hit("person.md", 0.02), hit("plain.md", 0.04)];
    const out = applyFrontmatterRescore(hits, {
      filter: [{ key: "class", value: "Person" }],
      boosts: [{ key: "class", value: "Person", weight: 0.1 }],
      fmFor,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.notePath).toBe("person.md");
    expect(out[0]!.score).toBeCloseTo(0.12);
  });

  it("no filter, no boosts → input returned unchanged", () => {
    const hits = [hit("a.md", 0.5)];
    expect(applyFrontmatterRescore(hits, { fmFor })).toBe(hits);
  });
});
