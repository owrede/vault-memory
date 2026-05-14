import { describe, it, expect } from "vitest";
import { matchesAnyGlob } from "./glob.js";

describe("matchesAnyGlob", () => {
  it("returns false for empty pattern list", () => {
    expect(matchesAnyGlob("any/path.md", [])).toBe(false);
  });

  it("matches single-level wildcard", () => {
    expect(matchesAnyGlob("Personen/Holger.md", ["Personen/*.md"])).toBe(true);
    expect(matchesAnyGlob("Personen/Sub/Holger.md", ["Personen/*.md"])).toBe(false);
  });

  it("matches recursive double-star", () => {
    expect(matchesAnyGlob("Personen/Sub/Holger.md", ["Personen/**"])).toBe(true);
    expect(matchesAnyGlob("Personen/Holger.md", ["**/*.md"])).toBe(true);
  });

  it("matches single-char wildcard", () => {
    expect(matchesAnyGlob("a.md", ["?.md"])).toBe(true);
    expect(matchesAnyGlob("ab.md", ["?.md"])).toBe(false);
  });

  it("escapes regex-special chars", () => {
    expect(matchesAnyGlob("a.b+c.md", ["a.b+c.md"])).toBe(true);
    expect(matchesAnyGlob("axb+c.md", ["a.b+c.md"])).toBe(false);
  });

  it("returns true if any pattern matches", () => {
    expect(matchesAnyGlob("Personen/Holger.md", ["Org/*.md", "Personen/*.md"])).toBe(true);
  });

  it("eval-note-bias case from v0.6.0 eval report", () => {
    expect(
      matchesAnyGlob("_research/vault-memory-eval.md", ["_research/vault-memory-eval.md"]),
    ).toBe(true);
    expect(
      matchesAnyGlob("Netzwerk/Personen/Holger Hoos.md", ["_research/vault-memory-eval.md"]),
    ).toBe(false);
  });
});
