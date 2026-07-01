import { describe, it, expect } from "vitest";
import { stripDynamicViewBlocks, DATACORE_PLACEHOLDER } from "./datacore.js";

describe("stripDynamicViewBlocks (ADR-033 headless baseline)", () => {
  it("returns input unchanged when there are no fences", () => {
    const body = "# Title\n\nJust prose.\n";
    const r = stripDynamicViewBlocks(body);
    expect(r.replaced).toBe(0);
    expect(r.content).toBe(body);
  });

  it("replaces a datacorejsx block body with the placeholder, keeps prose + heading", () => {
    const body = [
      "# INARCH-SALES",
      "",
      "## Meeting Notes",
      "",
      "```datacorejsx",
      'const { ProjectMeetingsTable } = await dc.require(dc.headerLink("x.md","T"));',
      "return ProjectMeetingsTable;",
      "```",
      "",
      "Trailing prose.",
    ].join("\n");
    const r = stripDynamicViewBlocks(body);
    expect(r.replaced).toBe(1);
    expect(r.content).toContain("# INARCH-SALES");
    expect(r.content).toContain("## Meeting Notes");
    expect(r.content).toContain(DATACORE_PLACEHOLDER);
    expect(r.content).toContain("Trailing prose.");
    // The JS source is gone.
    expect(r.content).not.toContain("dc.require");
    expect(r.content).not.toContain("ProjectMeetingsTable");
    expect(r.content).not.toContain("```");
  });

  it("strips datacore, dataview, dataviewjs, datacorejs variants (case-insensitive)", () => {
    for (const lang of ["datacore", "DATACORE", "dataview", "dataviewjs", "datacorejs"]) {
      const body = `pre\n\`\`\`${lang}\nQUERY SOURCE\n\`\`\`\npost`;
      const r = stripDynamicViewBlocks(body);
      expect(r.replaced, lang).toBe(1);
      expect(r.content, lang).not.toContain("QUERY SOURCE");
      expect(r.content, lang).toContain(DATACORE_PLACEHOLDER);
    }
  });

  it("leaves NON-dynamic code blocks untouched (js, text, no-lang)", () => {
    for (const lang of ["js", "text", "python", ""]) {
      const body = `pre\n\`\`\`${lang}\nkeep me\n\`\`\`\npost`;
      const r = stripDynamicViewBlocks(body);
      expect(r.replaced, lang || "<none>").toBe(0);
      expect(r.content, lang || "<none>").toContain("keep me");
      expect(r.content, lang || "<none>").toBe(body);
    }
  });

  it("handles multiple dynamic blocks + interleaved prose", () => {
    const body = [
      "a",
      "```datacorejsx",
      "X();",
      "```",
      "b",
      "```js",
      "real();",
      "```",
      "c",
      "```dataview",
      "LIST",
      "```",
      "d",
    ].join("\n");
    const r = stripDynamicViewBlocks(body);
    expect(r.replaced).toBe(2);
    expect(r.content).toContain("real();"); // js block survives
    expect(r.content).not.toContain("X();");
    expect(r.content).not.toContain("LIST");
    expect(r.content.match(/\[Datacore view\]/g)).toHaveLength(2);
    expect(r.content.split("\n").filter((l) => "abcd".includes(l)).length).toBe(4);
  });

  it("handles an unterminated dynamic fence (to EOF) defensively", () => {
    const body = "intro\n```datacorejsx\nnever closed\nmore code";
    const r = stripDynamicViewBlocks(body);
    expect(r.replaced).toBe(1);
    expect(r.content).toContain("intro");
    expect(r.content).toContain(DATACORE_PLACEHOLDER);
    expect(r.content).not.toContain("never closed");
  });

  it("preserves indentation of the opening fence on the placeholder", () => {
    const body = "- list item\n  ```datacore\n  Q\n  ```\n";
    const r = stripDynamicViewBlocks(body);
    expect(r.replaced).toBe(1);
    expect(r.content).toContain(`  ${DATACORE_PLACEHOLDER}`);
  });
});
