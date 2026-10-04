import { describe, expect, it } from "vitest";
import { inspectionBody } from "./body.js";
import { parseObservations } from "../observations/parse.js";
import { parseDomainRelations } from "../relations/parse.js";
describe("inspection Markdown projection", () => {
  it("retains an exact flat-text body", () => {
    expect(inspectionBody([{ kind: "paragraph", text: "# A\n- [fact] Real\n" }])).toEqual({
      text: "# A\n- [fact] Real\n",
      line_basis: "source_body",
    });
  });
  it("walks nested sections with headings and explicit list declarations", () => {
    const result = inspectionBody([
      {
        kind: "section",
        anchor: "a",
        level: 1,
        heading_path: ["A"],
        blocks: [
          { kind: "list", ordered: false, items: ["[fact] Real"] },
          {
            kind: "section",
            anchor: "b",
            level: 2,
            heading_path: ["A", "Relations"],
            blocks: [{ kind: "paragraph", text: "- owns [[B]]" }],
          },
        ],
      },
    ]);
    expect(result.line_basis).toBe("rendered_markdown");
    expect(parseObservations(result.text).map((row) => row.text)).toEqual(["Real"]);
    expect(
      parseDomainRelations(result.text).map((row) => ({ rel: row.rel, target: row.target })),
    ).toEqual([{ rel: "owns", target: "B" }]);
  });
  it("keeps list item continuations without creating sibling declarations", () => {
    const result = inspectionBody([
      { kind: "list", ordered: false, items: ["[fact] Real\nContinued"] },
    ]);
    expect(parseObservations(result.text)).toEqual([
      { category: "fact", text: "Real\nContinued", line_start: 1, line_end: 2 },
    ]);
  });
  it("keeps code containing fence markers outside inference", () => {
    const result = inspectionBody([
      { kind: "code", lang: "md", text: "```\n- [fact] Example\n## Relations\n- owns [[Fake]]" },
    ]);
    expect(result.text).toContain("Example");
    expect(parseObservations(result.text)).toEqual([]);
    expect(parseDomainRelations(result.text)).toEqual([]);
  });
});
