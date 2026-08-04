/**
 * dispatch tests — note-level dedup for ContextFit chunk hits.
 * (searchVaults engine routing is covered by the live adapter tests; the
 * dedup helper is pure and tested directly.)
 */

import { describe, it, expect } from "vitest";
import { dedupeByNote } from "./dispatch.js";
import type { SearchHit } from "../types.js";

function hit(vault: string, notePath: string, score: number, chunkIdx = 0): SearchHit {
  return {
    vault,
    notePath,
    noteTitle: notePath.replace(/\.md$/i, ""),
    chunkText: `chunk ${chunkIdx} of ${notePath}`,
    chunkIdx,
    headingPath: null,
    score,
    scoreBreakdown: { contextfit: score },
  };
}

describe("dedupeByNote", () => {
  it("keeps only the best-scoring chunk per note", () => {
    const hits = [
      hit("v", "transcript.md", 0.9, 0),
      hit("v", "transcript.md", 0.8, 1),
      hit("v", "transcript.md", 0.7, 2),
      hit("v", "person.md", 0.75),
    ];
    const out = dedupeByNote(hits);
    expect(out.map((h) => h.notePath)).toEqual(["transcript.md", "person.md"]);
    expect(out[0]!.chunkIdx).toBe(0); // best transcript chunk survived
  });

  it("re-sorts by score descending after collapsing", () => {
    const hits = [
      hit("v", "a.md", 0.5),
      hit("v", "b.md", 0.3),
      hit("v", "b.md", 0.9, 1), // b's best chunk outranks a
    ];
    const out = dedupeByNote(hits);
    expect(out.map((h) => h.notePath)).toEqual(["b.md", "a.md"]);
    expect(out[0]!.score).toBe(0.9);
  });

  it("treats the same notePath in different vaults as distinct notes", () => {
    const hits = [hit("v1", "note.md", 0.9), hit("v2", "note.md", 0.8)];
    expect(dedupeByNote(hits)).toHaveLength(2);
  });

  it("is stable on equal scores (earlier-ranked chunk wins)", () => {
    const hits = [hit("v", "note.md", 0.5, 0), hit("v", "note.md", 0.5, 1)];
    const out = dedupeByNote(hits);
    expect(out).toHaveLength(1);
    expect(out[0]!.chunkIdx).toBe(0);
  });

  it("passes empty input through", () => {
    expect(dedupeByNote([])).toEqual([]);
  });
});
