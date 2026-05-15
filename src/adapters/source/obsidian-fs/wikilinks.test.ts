import { describe, it, expect } from "vitest";
import { extractWikilinks, extractFrontmatterWikilinks } from "./wikilinks.js";

describe("extractWikilinks", () => {
  it("parses a plain wikilink", () => {
    const out = extractWikilinks("Hello [[Foo]] world");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      rawTarget: "Foo",
      normalizedTarget: "Foo",
      anchor: null,
      alias: null,
      line: 1,
    });
  });

  it("parses an alias", () => {
    const out = extractWikilinks("See [[Foo|Bar]] here");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      rawTarget: "Foo",
      normalizedTarget: "Foo",
      anchor: null,
      alias: "Bar",
    });
  });

  it("parses an anchor", () => {
    const out = extractWikilinks("Jump to [[Foo#Section]]");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      rawTarget: "Foo",
      anchor: "Section",
      alias: null,
    });
  });

  it("parses anchor + alias together", () => {
    const out = extractWikilinks("[[Foo#Section|Bar]]");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      rawTarget: "Foo",
      normalizedTarget: "Foo",
      anchor: "Section",
      alias: "Bar",
    });
  });

  it("parses path-style targets", () => {
    const out = extractWikilinks("[[Notes/Sub/Foo]]");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      rawTarget: "Notes/Sub/Foo",
      normalizedTarget: "Notes/Sub/Foo",
    });
  });

  it("strips trailing .md from normalizedTarget", () => {
    const out = extractWikilinks("[[Foo.md]]");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      rawTarget: "Foo.md",
      normalizedTarget: "Foo",
    });
  });

  it("tracks 1-based line numbers across multiple lines", () => {
    const content = [
      "Line one",
      "Line two with [[A]]",
      "",
      "Line four with [[B|alias]] and [[C#sec]]",
    ].join("\n");
    const out = extractWikilinks(content);
    expect(out).toHaveLength(3);
    expect(out[0]?.rawTarget).toBe("A");
    expect(out[0]?.line).toBe(2);
    expect(out[1]?.rawTarget).toBe("B");
    expect(out[1]?.line).toBe(4);
    expect(out[2]?.rawTarget).toBe("C");
    expect(out[2]?.line).toBe(4);
  });

  it("ignores wikilinks inside triple-backtick code blocks", () => {
    const content = [
      "Before [[Real]]",
      "```",
      "Inside [[Fake]] block",
      "```",
      "After [[AlsoReal]]",
    ].join("\n");
    const out = extractWikilinks(content);
    const targets = out.map((w) => w.rawTarget);
    expect(targets).toEqual(["Real", "AlsoReal"]);
  });

  it("does not match embeds (![[...]])", () => {
    const out = extractWikilinks("Image: ![[Pic.png]] and [[Doc]]");
    const targets = out.map((w) => w.rawTarget);
    expect(targets).toEqual(["Doc"]);
  });
});

describe("extractFrontmatterWikilinks", () => {
  it("returns [] for null frontmatter", () => {
    expect(extractFrontmatterWikilinks(null)).toEqual([]);
  });

  it("returns [] when no wikilinks in any value", () => {
    const out = extractFrontmatterWikilinks({
      class: "Person",
      email: "x@y.com",
      tags: ["network", "client"],
    });
    expect(out).toEqual([]);
  });

  it("extracts a single wikilink from a string value", () => {
    const out = extractFrontmatterWikilinks({
      organisation: "[[INFORM GmbH]]",
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      rawTarget: "INFORM GmbH",
      normalizedTarget: "INFORM GmbH",
      anchor: null,
      alias: null,
      line: 0,
    });
  });

  it("extracts multiple wikilinks from a list value", () => {
    const out = extractFrontmatterWikilinks({
      members: ["[[Jörg Herbers]]", "[[Oliver Wrede]]"],
    });
    expect(out).toHaveLength(2);
    expect(out.map((w) => w.normalizedTarget)).toEqual(["Jörg Herbers", "Oliver Wrede"]);
  });

  it("extracts multiple wikilinks from a single string value", () => {
    const out = extractFrontmatterWikilinks({
      Teilnehmer: "[[OWR]], [[JHE]]",
    });
    expect(out).toHaveLength(2);
    expect(out.map((w) => w.normalizedTarget)).toEqual(["OWR", "JHE"]);
  });

  it("parses anchor and alias inside frontmatter wikilinks", () => {
    const out = extractFrontmatterWikilinks({
      ref: "[[Foo#Section|Bar]]",
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      rawTarget: "Foo",
      anchor: "Section",
      alias: "Bar",
    });
  });

  it("strips trailing .md from frontmatter wikilink targets", () => {
    const out = extractFrontmatterWikilinks({
      ref: "[[Foo.md]]",
    });
    expect(out[0]?.normalizedTarget).toBe("Foo");
  });

  it("skips aliases and alias keys", () => {
    const out = extractFrontmatterWikilinks({
      aliases: ["[[Should Not Match]]", "JHE"],
      alias: "[[Also Not]]",
      organisation: "[[Real Match]]",
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.normalizedTarget).toBe("Real Match");
  });

  it("recurses into nested objects", () => {
    const out = extractFrontmatterWikilinks({
      meta: {
        related: ["[[A]]", "[[B]]"],
        owner: "[[C]]",
      },
    });
    expect(out.map((w) => w.normalizedTarget).sort()).toEqual(["A", "B", "C"]);
  });

  it("handles unquoted YAML wikilinks that parse as nested arrays", () => {
    // `Klient: [[LAG]]` in YAML parses as Klient = [["LAG"]]. We treat
    // string-array elements as wikilink targets.
    const out = extractFrontmatterWikilinks({
      Klient: [["LAG"]],
    });
    // Nested array of strings has no [[ ]] syntax — we deliberately do NOT
    // synthesize wikilinks from raw strings, because we can't tell a real
    // wikilink target apart from an arbitrary string ("LAG" could be an
    // alias, a code, or anything). Behavior: no match.
    expect(out).toEqual([]);
  });

  it("ignores non-string scalar values", () => {
    const out = extractFrontmatterWikilinks({
      count: 42,
      enabled: true,
      tags: null,
    });
    expect(out).toEqual([]);
  });

  it("collects all wikilinks across multiple keys (real-world INIM example)", () => {
    const out = extractFrontmatterWikilinks({
      class: "Person",
      organisation: "[[INFORM GmbH]]",
      affiliated_with: ["[[INFORM GmbH]]", "[[Intelligence Impact]]", "[[RWTH Aachen]]"],
      cofounder_of: ["[[Intelligence Impact]]"],
      past_roles: ["[[RWTH Aachen]]"],
      participation: ["[[LAG-EPIX]]"],
    });
    const targets = out.map((w) => w.normalizedTarget);
    // Each key contributes one or more entries; we don't dedupe at this
    // layer — DB UNIQUE constraint dedupes downstream.
    expect(targets).toContain("INFORM GmbH");
    expect(targets).toContain("Intelligence Impact");
    expect(targets).toContain("RWTH Aachen");
    expect(targets).toContain("LAG-EPIX");
    expect(out.every((w) => w.line === 0)).toBe(true);
  });
});
