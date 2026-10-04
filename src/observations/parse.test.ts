import { describe, expect, it } from "vitest";
import { parseObservations } from "./parse.js";
describe("explicit categorized observations", () => {
  it("anchors statements and ignores fenced examples", () => {
    expect(
      parseObservations("# Oliver\n- [preference] Async writing\n```md\n- [fact] Example\n```\n"),
    ).toEqual([{ category: "preference", text: "Async writing", line_start: 2, line_end: 2 }]);
  });
  it("keeps indented continuation and nested explicit items distinct", () => {
    expect(
      parseObservations(
        "- [decision] First\n  continuation\n  - [fact] Nested\n    extra\n\nFree paragraph\n",
      ),
    ).toEqual([
      { category: "decision", text: "First\ncontinuation", line_start: 1, line_end: 2 },
      { category: "fact", text: "Nested\nextra", line_start: 3, line_end: 4 },
    ]);
  });
  it("retains unknown explicit categories with CRLF source lines", () => {
    expect(
      parseObservations("Title\r\n+ [custom_kind-2] Specific claim\r\n  continued\r\n"),
    ).toEqual([
      { category: "custom_kind-2", text: "Specific claim\ncontinued", line_start: 2, line_end: 3 },
    ]);
  });
  it("ignores checkboxes, empty entries and unmarked text", () => {
    expect(
      parseObservations(
        "- [x] Done\n- [X] Done\n- [ ] Todo\n- [] Missing\n- [fact] \n- Plain item\nFree inference\n",
      ),
    ).toEqual([]);
  });
  it.each(["```", "~~~~", "  ````md"])("ignores code fenced with %s", (marker) => {
    const close = marker.includes("~") ? "~~~~" : marker.includes("````") ? "  ````" : "```";
    expect(parseObservations(`${marker}\n- [fact] Not real\n${close}\n- [fact] Real\n`)).toEqual([
      { category: "fact", text: "Real", line_start: 4, line_end: 4 },
    ]);
  });
  it("ignores short closers inside a longer fence", () => {
    expect(parseObservations("````\n```\n- [fact] Example\n````\n")).toEqual([]);
  });
  it("ignores fenced examples nested within a list", () => {
    expect(
      parseObservations("- Parent\n    ```md\n    - [fact] Example\n    ```\n- [fact] Real\n"),
    ).toEqual([{ category: "fact", text: "Real", line_start: 5, line_end: 5 }]);
  });
  it("does not open an invalid backtick info fence", () => {
    expect(parseObservations("```bad`info\n- [fact] Real\n")).toEqual([
      { category: "fact", text: "Real", line_start: 2, line_end: 2 },
    ]);
  });
  it("ignores standalone indented code but permits nested list depth", () => {
    expect(parseObservations("    - [fact] Code\n- Parent\n    - [fact] Nested\n")).toEqual([
      { category: "fact", text: "Nested", line_start: 3, line_end: 3 },
    ]);
  });
  it("never attaches unindented prose or unmarked sibling content", () => {
    expect(parseObservations("- [fact] Real\nUnrelated\n- Other\n  continuation\n")).toEqual([
      { category: "fact", text: "Real", line_start: 1, line_end: 1 },
    ]);
  });
  it("ignores a fence opened on a list item line", () => {
    expect(parseObservations("- ```md\n  - [fact] Example only\n  ```\n- [fact] Real\n")).toEqual([
      { category: "fact", text: "Real", line_start: 4, line_end: 4 },
    ]);
  });
  it("does not close a root fence with a four-space indented marker", () => {
    expect(
      parseObservations("```md\n    ```\n- [fact] Example only\n```\n- [fact] Real\n"),
    ).toEqual([{ category: "fact", text: "Real", line_start: 5, line_end: 5 }]);
  });
  it("ignores an indented code example within a list container", () => {
    expect(parseObservations("- Parent\n\n      - [fact] Code example\n")).toEqual([]);
  });
  it("ends a list fence when a sibling exits its container", () => {
    expect(parseObservations("- ```md\n  example\n- [fact] Real\n")).toEqual([
      { category: "fact", text: "Real", line_start: 3, line_end: 3 },
    ]);
  });
  it("retains deeply aligned paragraph continuations without a blank line", () => {
    expect(
      parseObservations("- [preference] Async writing\n               with detailed context\n"),
    ).toEqual([
      {
        category: "preference",
        text: "Async writing\nwith detailed context",
        line_start: 1,
        line_end: 2,
      },
    ]);
  });
});
it("preserves literal inline-code and non-trailing validity examples", () => {
  const claims = [
    "The literal `<!-- validity: {} -->` is documentation.",
    "Documentation <!-- validity: {} --> continues.",
    "The example `<!-- validity: broken -->`",
  ];
  for (const claim of claims)
    expect(parseObservations(`- [fact] ${claim}`)).toEqual([
      { category: "fact", text: claim, line_start: 1, line_end: 1 },
    ]);
});
