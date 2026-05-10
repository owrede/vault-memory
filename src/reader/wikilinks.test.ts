import { describe, it, expect } from "vitest";
import { extractWikilinks } from "./wikilinks.js";

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
