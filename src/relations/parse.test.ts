import { describe, expect, it } from "vitest";
import { parseDomainRelations } from "./parse.js";
describe("explicit domain relation declarations", () => {
  it("keeps role, alias target and source line", () => {
    expect(
      parseDomainRelations("## Relations\n- owns [[Atlas]]\n- depends_on [[Budget|Funding]]\n"),
    ).toEqual([
      { rel: "owns", target: "Atlas", line: 2 },
      { rel: "depends_on", target: "Budget", line: 3 },
    ]);
  });
  it("does not infer relations from ordinary wikilinks or prose", () => {
    expect(
      parseDomainRelations(
        "- owns [[Atlas]]\n## Relations\n[[Budget]]\nOliver owns [[Atlas]]\n- [[Budget]]\n",
      ),
    ).toEqual([]);
  });
  it("retains distinct unknown roles pointing to the same target", () => {
    expect(
      parseDomainRelations("# Relations\n- custom_role [[Atlas]]\n- manages [[Atlas]]\n"),
    ).toEqual([
      { rel: "custom_role", target: "Atlas", line: 2 },
      { rel: "manages", target: "Atlas", line: 3 },
    ]);
  });
  it("stops at a sibling heading and supports nested Relations sections", () => {
    expect(
      parseDomainRelations(
        "# Oliver\n## Relations\n- owns [[Atlas]]\n### Details\n- leads [[Budget]]\n## Other\n- owns [[No]]\n",
      ),
    ).toEqual([
      { rel: "owns", target: "Atlas", line: 3 },
      { rel: "leads", target: "Budget", line: 5 },
    ]);
  });
  it.each(["```md", "~~~md", "````md"])(
    "ignores fenced declarations and headings with %s",
    (marker) => {
      const close = marker.startsWith("~") ? "~~~" : marker.startsWith("````") ? "````" : "```";
      expect(
        parseDomainRelations(
          `${marker}\n## Relations\n- owns [[Fake]]\n${close}\n## Relations\n- owns [[Real]]\n`,
        ),
      ).toEqual([{ rel: "owns", target: "Real", line: 6 }]);
    },
  );
  it("keeps code examples inside Relations out of the graph", () => {
    expect(
      parseDomainRelations(
        "# Relations\n- Examples\n    ```md\n    - owns [[Fake]]\n    ```\n- owns [[Real]]\n",
      ),
    ).toEqual([{ rel: "owns", target: "Real", line: 6 }]);
  });
  it("retains section-qualified targets and CRLF line numbers", () => {
    expect(parseDomainRelations("  ## Relations\r\n+ owns [[Atlas#Plan|Roadmap]]\r\n")).toEqual([
      { rel: "owns", target: "Atlas#Plan", line: 2 },
    ]);
  });
  it("rejects malformed declarations and standalone indented code", () => {
    expect(
      parseDomainRelations(
        "# Relations\n- owns [[]]\n- Owns [[Atlas]]\n- depends-on [[Atlas]]\n- owns [[Atlas]] extra\n\nOutside code example\n\n    - owns [[Example]]\n",
      ),
    ).toEqual([]);
  });
});
