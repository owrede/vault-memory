import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "../database.js";
import { FtsQueries } from "./fts.js";

describe("FtsQueries", () => {
  let db: Database;
  let noteAId: number;
  let noteBId: number;
  let chunkFoerderprojekteId: number;
  let chunkBildungId: number;
  let chunkUnrelatedId: number;

  beforeEach(() => {
    db = new Database(":memory:");

    const a = db.notes.upsertByPath({
      path: "a.md",
      content: "Förderprojekte",
      frontmatter: null,
      title: "A",
      hash: "ha",
      mtime: 1,
      wordCount: 1,
    });
    noteAId = a.id;
    const b = db.notes.upsertByPath({
      path: "b.md",
      content: "Bildung",
      frontmatter: null,
      title: "B",
      hash: "hb",
      mtime: 1,
      wordCount: 1,
    });
    noteBId = b.id;

    const aIds = db.chunks.insertBatch(noteAId, [
      {
        idx: 0,
        text: "Förderprojekte Bildung Region sind wichtig fuer die Zukunft.",
        headingPath: null,
        startOffset: 0,
        endOffset: 60,
        tokenCount: 8,
      },
      {
        idx: 1,
        text: "Heute ueber Kaffee und Kuchen reden.",
        headingPath: null,
        startOffset: 60,
        endOffset: 100,
        tokenCount: 6,
      },
    ]);
    chunkFoerderprojekteId = aIds[0]!;
    chunkUnrelatedId = aIds[1]!;

    const bIds = db.chunks.insertBatch(noteBId, [
      {
        idx: 0,
        text: "Bildung ist eine zentrale Aufgabe.",
        headingPath: null,
        startOffset: 0,
        endOffset: 35,
        tokenCount: 5,
      },
    ]);
    chunkBildungId = bIds[0]!;
  });

  afterEach(() => {
    db.close();
  });

  it("instantiates as a member of Database", () => {
    expect(db.fts).toBeInstanceOf(FtsQueries);
  });

  it("single-word query finds the right chunk", () => {
    const hits = db.fts.search("Förderprojekte", 10);
    expect(hits.length).toBe(1);
    expect(hits[0]?.chunkId).toBe(chunkFoerderprojekteId);
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it("multi-word query returns AND-matching hits ordered by relevance", () => {
    // FTS5 default is implicit AND between tokens — only chunks containing
    // BOTH "Förderprojekte" AND "Bildung" match.
    const hits = db.fts.search("Förderprojekte Bildung", 10);
    expect(hits.length).toBe(1);
    expect(hits[0]?.chunkId).toBe(chunkFoerderprojekteId);
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it("explicit OR returns multiple hits ordered by relevance", () => {
    const hits = db.fts.search("Förderprojekte OR Bildung", 10);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0]?.chunkId).toBe(chunkFoerderprojekteId);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i]!.score).toBeLessThanOrEqual(hits[i - 1]!.score);
    }
    expect(hits.some((h) => h.chunkId === chunkBildungId)).toBe(true);
    expect(hits.some((h) => h.chunkId === chunkUnrelatedId)).toBe(false);
  });

  it("no-match returns empty array", () => {
    const hits = db.fts.search("blabblubb", 10);
    expect(hits).toEqual([]);
  });

  it("sanitize strips unbalanced parens without SQL error", () => {
    expect(() => db.fts.search("Bildung (foo", 10)).not.toThrow();
    expect(() => db.fts.search("Bildung)", 10)).not.toThrow();
    // After stripping the lone paren, "Bildung" alone matches.
    const hits = db.fts.search("Bildung)", 10);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("sanitize strips quotes and colons", () => {
    expect(FtsQueries.sanitize('"Förder')).toBe("Förder");
    expect(FtsQueries.sanitize("col:val")).toBe("col val");
  });

  it("sanitize handles trailing/leading operators", () => {
    expect(FtsQueries.sanitize("Bildung AND")).toBe("Bildung");
    expect(FtsQueries.sanitize("OR Bildung")).toBe("Bildung");
    expect(FtsQueries.sanitize("   ")).toBe("");
  });

  it("sanitize keeps balanced parens and prefix star", () => {
    expect(FtsQueries.sanitize("(Bildung OR Förder*)")).toBe(
      "(Bildung OR Förder*)",
    );
  });

  it("empty sanitized query returns no hits (and no throw)", () => {
    expect(db.fts.search("   ", 10)).toEqual([]);
    expect(db.fts.search('""', 10)).toEqual([]);
  });

  it("withSnippet=true returns <mark>-highlighted snippet", () => {
    const hits = db.fts.search("Bildung", 10, true);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const first = hits[0]!;
    expect(first.snippet).toBeDefined();
    expect(first.snippet).toContain("<mark>");
    expect(first.snippet).toContain("</mark>");
  });

  it("respects topK", () => {
    const hits = db.fts.search("Bildung OR Förderprojekte OR Kaffee", 1);
    expect(hits.length).toBe(1);
  });

  // ── Regression tests for crash triggers found in v0.6.0 eval ────────────

  it("sanitize phrase-wraps hyphenated tokens (was: 'no such column: EPIX')", () => {
    expect(FtsQueries.sanitize("LAG-EPIX")).toBe('"LAG-EPIX"');
    expect(FtsQueries.sanitize("LAG-EPIX status")).toBe('"LAG-EPIX" status');
    expect(FtsQueries.sanitize("INIM-397 abc")).toBe('"INIM-397" abc');
  });

  it("sanitize phrase-wraps slash-containing tokens (was: 'no such column: Netzwerk')", () => {
    expect(FtsQueries.sanitize("Netzwerk/Personen")).toBe('"Netzwerk/Personen"');
  });

  it("sanitize phrase-wraps tokens with question marks (was: 'syntax error near ?')", () => {
    expect(FtsQueries.sanitize("Wer ist Holger Hoos?")).toBe(
      'Wer ist Holger "Hoos?"',
    );
  });

  it("sanitize leaves prefix-star tokens intact", () => {
    expect(FtsQueries.sanitize("Förder*")).toBe("Förder*");
    expect(FtsQueries.sanitize("(Bildung OR Förder*)")).toBe(
      "(Bildung OR Förder*)",
    );
  });

  it("sanitize leaves bare operator tokens intact", () => {
    expect(FtsQueries.sanitize("Bildung AND Förder")).toBe(
      "Bildung AND Förder",
    );
    expect(FtsQueries.sanitize("a NEAR b")).toBe("a NEAR b");
  });

  it("search executes without throwing for the three eval-discovered triggers", () => {
    // The three real-world queries that crashed in the v0.6.0 eval.
    expect(() => db.fts.search("LAG-EPIX", 10)).not.toThrow();
    expect(() => db.fts.search("Netzwerk/Personen Bildung", 10)).not.toThrow();
    expect(() => db.fts.search("Wer ist Holger Hoos?", 10)).not.toThrow();
  });
});
