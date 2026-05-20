/**
 * verb-catalog.test — every baseline verb (+ `literal`) MUST have a
 * VERB_CATALOG row, every catalog row MUST reference a real verb, and
 * no two rows may share a `verb`. The catalog is the single source of
 * truth for palette UI copy; missing rows produce blank palette entries.
 */

import { describe, expect, it } from "vitest";
import { BASELINE_VERBS } from "./verb-list.js";
import {
  VERB_CATALOG,
  VERB_CATEGORY_META,
  catalogVerbNames,
  groupByCategory,
  lookupVerb,
} from "./verb-catalog.js";

describe("verb-catalog", () => {
  it("covers every baseline verb plus literal", () => {
    const covered = catalogVerbNames();
    for (const v of BASELINE_VERBS) {
      expect(covered.has(v), `missing palette metadata for baseline verb "${v}"`).toBe(true);
    }
    expect(covered.has("literal"), "missing palette metadata for `literal`").toBe(true);
  });

  it("does not reference any verb outside the baseline set + literal", () => {
    const allowed = new Set<string>([...BASELINE_VERBS, "literal"]);
    for (const row of VERB_CATALOG) {
      expect(allowed.has(row.verb), `unknown verb in catalog: "${row.verb}"`).toBe(true);
    }
  });

  it("has unique verb rows (no duplicates)", () => {
    const seen = new Set<string>();
    for (const row of VERB_CATALOG) {
      expect(seen.has(row.verb), `duplicate catalog row for "${row.verb}"`).toBe(false);
      seen.add(row.verb);
    }
  });

  it("every row's category is a known category", () => {
    const known = new Set(Object.keys(VERB_CATEGORY_META));
    for (const row of VERB_CATALOG) {
      expect(known.has(row.category), `unknown category "${row.category}" on "${row.verb}"`).toBe(
        true,
      );
    }
  });

  it("title + description are non-empty for every row", () => {
    for (const row of VERB_CATALOG) {
      expect(row.title.length, `empty title on "${row.verb}"`).toBeGreaterThan(0);
      expect(row.description.length, `empty description on "${row.verb}"`).toBeGreaterThan(0);
    }
  });

  it("lookupVerb returns the right row by name", () => {
    const sample = VERB_CATALOG[0]!;
    expect(lookupVerb(sample.verb)?.verb).toBe(sample.verb);
    expect(lookupVerb("does-not-exist")).toBeUndefined();
  });

  it("groupByCategory respects category order and omits empty buckets", () => {
    const grouped = groupByCategory();
    const ids = grouped.map((g) => g.category.id);
    // Ordered subsequence check — every actual category appears in the
    // canonical order; empty categories are omitted.
    const canonical = [
      "read-document",
      "search-vault",
      "navigate-graph",
      "reference",
      "compose",
      "escape",
    ];
    let cursor = 0;
    for (const id of ids) {
      const next = canonical.indexOf(id, cursor);
      expect(next, `category "${id}" out of order or duplicated`).toBeGreaterThanOrEqual(cursor);
      cursor = next + 1;
    }
    for (const g of grouped) {
      expect(g.items.length, `empty bucket ${g.category.id} should not appear`).toBeGreaterThan(0);
    }
  });
});
