import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "../db/index.js";
import type { Vault } from "../vault/index.js";
import { suggestFrontmatter, combineSuggestions } from "./combiner.js";

function makeVault(): Vault {
  const db = new Database(":memory:");
  db.migrate();
  return {
    config: { name: "test", path: "/tmp/test" },
    db,
    dbPath: ":memory:",
  };
}

function seedNote(
  vault: Vault,
  path: string,
  frontmatter: Record<string, unknown> | null,
): number {
  const r = vault.db.notes.upsertByPath({
    path,
    content: "body",
    frontmatter: frontmatter ? JSON.stringify(frontmatter) : null,
    title: path.split("/").pop()!.replace(/\.md$/, ""),
    hash: `h-${path}`,
    bodyHash: `bh-${path}`,
    mtime: 1,
    wordCount: 1,
  });
  return r.id;
}

/**
 * Seed a synthetic 5-class vault used by the integration-style tests.
 * Returns counts per class so tests can assert about expected siblings.
 */
function seedSyntheticVault(vault: Vault): { persons: number; meetings: number } {
  // 6 Persons in `Personen/`
  for (let i = 0; i < 6; i++) {
    seedNote(vault, `Personen/p${i}.md`, {
      class: "Person",
      type: "person",
      participation: [],
    });
  }
  // 6 Meetings in `Meetings/`
  for (let i = 0; i < 6; i++) {
    seedNote(vault, `Meetings/m${i}.md`, {
      class: "Meeting",
      type: "meeting",
      meeting_date: `2026-01-${(i + 1).toString().padStart(2, "0")}`,
      participants: [],
    });
  }
  return { persons: 6, meetings: 6 };
}

describe("combineSuggestions (pure-function)", () => {
  it("emits a suggestion when folder + content agree", () => {
    const r = combineSuggestions({
      existingFrontmatter: null,
      folder: {
        resolvedFolder: "Personen/",
        siblingCount: 5,
        fellBackFrom: null,
        entries: [
          {
            key: "class",
            presenceCount: 5,
            siblingCount: 5,
            prevalence: 1.0,
            dominantValue: "Person",
            dominantValueRatio: 1.0,
          },
        ],
      },
      neighbor: {
        forwardCount: 0,
        backwardCount: 0,
        totalNeighbors: 0,
        entries: [],
      },
      content: {
        matchedRules: ["person-name-title-with-corroboration"],
        entries: [
          {
            key: "class",
            value: "Person",
            confidence: 0.85,
            rule: "person-name-title-with-corroboration",
          },
        ],
      },
    });

    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]!.key).toBe("class");
    expect(r.suggestions[0]!.suggestedValue).toBe("Person");
    // Folder confidence is 1.0; content 0.85; max wins → 1.0.
    expect(r.suggestions[0]!.confidence).toBe(1.0);
    // Both folder and content agreed.
    expect(r.suggestions[0]!.sources).toContain("folder");
    expect(r.suggestions[0]!.sources).toContain("content");
    expect(r.conflicts).toHaveLength(0);
    expect(r.existing).toHaveLength(0);
  });

  it("emits a conflict when folder and content disagree on value", () => {
    const r = combineSuggestions({
      existingFrontmatter: null,
      folder: {
        resolvedFolder: "X/",
        siblingCount: 5,
        fellBackFrom: null,
        entries: [
          {
            key: "class",
            presenceCount: 4,
            siblingCount: 5,
            prevalence: 0.8,
            dominantValue: "Person",
            dominantValueRatio: 1.0,
          },
        ],
      },
      neighbor: {
        forwardCount: 0,
        backwardCount: 0,
        totalNeighbors: 0,
        entries: [],
      },
      content: {
        matchedRules: ["meeting-title-keyword"],
        entries: [
          {
            key: "class",
            value: "Meeting",
            confidence: 0.85,
            rule: "meeting-title-keyword",
          },
        ],
      },
    });

    expect(r.suggestions).toHaveLength(0);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]!.key).toBe("class");
    // Two candidates, sorted by confidence DESC.
    expect(r.conflicts[0]!.candidates[0]!.confidence).toBe(0.85);
    expect(r.conflicts[0]!.candidates[1]!.confidence).toBeCloseTo(0.8);
  });

  it("classifies a frontmatter key already on the note as existing (no conflict when source agrees)", () => {
    const r = combineSuggestions({
      existingFrontmatter: { class: "Person" },
      folder: {
        resolvedFolder: "Personen/",
        siblingCount: 5,
        fellBackFrom: null,
        entries: [
          {
            key: "class",
            presenceCount: 5,
            siblingCount: 5,
            prevalence: 1.0,
            dominantValue: "Person",
            dominantValueRatio: 1.0,
          },
        ],
      },
      neighbor: {
        forwardCount: 0,
        backwardCount: 0,
        totalNeighbors: 0,
        entries: [],
      },
      content: { matchedRules: [], entries: [] },
    });
    expect(r.existing).toHaveLength(1);
    expect(r.existing[0]).toEqual({ key: "class", value: "Person" });
    expect(r.suggestions).toHaveLength(0);
    expect(r.conflicts).toHaveLength(0);
  });

  it("emits conflict when existing value disagrees with inference", () => {
    const r = combineSuggestions({
      existingFrontmatter: { class: "OldValue" },
      folder: {
        resolvedFolder: "X/",
        siblingCount: 5,
        fellBackFrom: null,
        entries: [
          {
            key: "class",
            presenceCount: 5,
            siblingCount: 5,
            prevalence: 1.0,
            dominantValue: "Person",
            dominantValueRatio: 1.0,
          },
        ],
      },
      neighbor: {
        forwardCount: 0,
        backwardCount: 0,
        totalNeighbors: 0,
        entries: [],
      },
      content: { matchedRules: [], entries: [] },
    });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]!.candidates).toHaveLength(2);
    const sources = r.conflicts[0]!.candidates.map((c) => c.source);
    expect(sources).toContain("existing");
    expect(sources).toContain("folder");
  });

  it("dampens neighbor confidence by 0.6 factor", () => {
    const r = combineSuggestions({
      existingFrontmatter: null,
      folder: {
        resolvedFolder: "",
        siblingCount: 0,
        fellBackFrom: null,
        entries: [],
      },
      neighbor: {
        forwardCount: 5,
        backwardCount: 0,
        totalNeighbors: 5,
        entries: [
          {
            key: "class",
            neighborCount: 5,
            totalNeighbors: 5,
            prevalence: 1.0,
            dominantValue: "Person",
            dominantValueRatio: 1.0,
          },
        ],
      },
      content: { matchedRules: [], entries: [] },
    });
    expect(r.suggestions).toHaveLength(1);
    // 1.0 * 0.6 damping factor.
    expect(r.suggestions[0]!.confidence).toBeCloseTo(0.6);
  });

  it("drops below-threshold candidates", () => {
    const r = combineSuggestions({
      existingFrontmatter: null,
      folder: {
        resolvedFolder: "X/",
        siblingCount: 10,
        fellBackFrom: null,
        entries: [
          {
            key: "weak",
            presenceCount: 1,
            siblingCount: 10,
            prevalence: 0.1, // below MIN_PRESENTATION_CONFIDENCE (0.2)
            dominantValue: "x",
            dominantValueRatio: 1.0,
          },
        ],
      },
      neighbor: {
        forwardCount: 0,
        backwardCount: 0,
        totalNeighbors: 0,
        entries: [],
      },
      content: { matchedRules: [], entries: [] },
    });
    expect(r.suggestions).toHaveLength(0);
    expect(r.conflicts).toHaveLength(0);
  });
});

describe("suggestFrontmatter (integration, synthetic vault)", () => {
  let vault: Vault;
  beforeEach(() => {
    vault = makeVault();
    seedSyntheticVault(vault);
  });
  afterEach(() => {
    vault.db.close();
  });

  it("suggests Person-class frontmatter for a new note in Personen/", () => {
    const r = suggestFrontmatter({
      vault,
      path: "Personen/Alice.md",
      existingFrontmatter: null,
    });
    const keys = r.suggestions.map((s) => s.key);
    expect(keys).toContain("class");
    expect(keys).toContain("type");
    const classSugg = r.suggestions.find((s) => s.key === "class")!;
    expect(classSugg.suggestedValue).toBe("Person");
  });

  it("suggests Meeting-class for a new note in Meetings/ with content-heuristic boost", () => {
    const r = suggestFrontmatter({
      vault,
      path: "Meetings/2026-05-12 Sync Call.md",
      existingFrontmatter: null,
      title: "2026-05-12 Sync Call",
      content: "Attendees: Alice, Bob\n\nNotes from the call.",
    });
    const classSugg = r.suggestions.find((s) => s.key === "class")!;
    expect(classSugg.suggestedValue).toBe("Meeting");
    // Folder + content both contributed.
    expect(classSugg.sources.length).toBeGreaterThanOrEqual(1);
    // Date heuristic should have emitted `created`.
    const createdSugg = r.suggestions.find((s) => s.key === "created");
    expect(createdSugg?.suggestedValue).toBe("2026-05-12");
  });

  it("reports `existing` for already-populated keys", () => {
    const r = suggestFrontmatter({
      vault,
      path: "Personen/Alice.md",
      existingFrontmatter: { class: "Person", type: "person" },
    });
    const existingKeys = r.existing.map((e) => e.key).sort();
    expect(existingKeys).toContain("class");
    expect(existingKeys).toContain("type");
  });

  it("works in draft mode (no path in DB) via folder-hint synthesis", () => {
    // Caller provides a probe-path under Personen/; the function treats it
    // as draft (since the note isn't in DB).
    const r = suggestFrontmatter({
      vault,
      path: "Personen/__draft__.md",
      content: "Alice Schmidt\n\nalice@example.com",
      title: "Alice Schmidt",
      existingFrontmatter: null,
    });
    const classSugg = r.suggestions.find((s) => s.key === "class");
    expect(classSugg?.suggestedValue).toBe("Person");
  });
});
