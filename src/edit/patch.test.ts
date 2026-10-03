import { describe, expect, it } from "vitest";
import { patchBody, type TextPatch } from "./patch.js";

describe("targeted text patches", () => {
  it("does not treat a short fence as the end of a longer code fence", () => {
    expect(
      patchBody("# A\n````md\n```\n## Example\n````\n", {
        kind: "section",
        heading_path: ["A", "Example"],
        content: "New",
      }),
    ).toEqual({ ok: false, reason: "target_not_found" });
  });

  it("recognizes legal indented ATX headings without rewriting the heading line", () => {
    expect(
      patchBody("# A\n  ## B\nOld\n## C\nKeep\n", {
        kind: "section",
        heading_path: ["A", "B"],
        content: "New\n",
      }),
    ).toEqual({ ok: true, body: "# A\n  ## B\nNew\n## C\nKeep\n" });
  });

  it.each([
    [
      "before old after",
      { kind: "replace", old_text: "old", new_text: "new" },
      { ok: true, body: "before new after" },
    ],
    [
      "old / old",
      { kind: "replace", old_text: "old", new_text: "new" },
      { ok: false, reason: "ambiguous_target" },
    ],
    [
      "original",
      { kind: "replace", old_text: "missing", new_text: "new" },
      { ok: false, reason: "target_not_found" },
    ],
    [
      "original",
      { kind: "replace", old_text: "", new_text: "new" },
      { ok: false, reason: "invalid_patch" },
    ],
    [
      "original",
      { kind: "replace", old_text: "original", new_text: "original" },
      { ok: true, body: "original" },
    ],
    [
      "# A\nKeep\n## B\nOld\n## C\nKeep\n",
      { kind: "section", heading_path: ["A", "B"], content: "New\n" },
      { ok: true, body: "# A\nKeep\n## B\nNew\n## C\nKeep\n" },
    ],
    [
      "# A\r\nKeep\r\n## B\r\nOld\r\n## C\r\nKeep\r\n",
      { kind: "section", heading_path: ["A", "B"], content: "New\nLines\n" },
      { ok: true, body: "# A\r\nKeep\r\n## B\r\nNew\r\nLines\r\n## C\r\nKeep\r\n" },
    ],
    [
      "# A\nOld\n# A\nOther\n",
      { kind: "section", heading_path: ["A"], content: "New" },
      { ok: false, reason: "ambiguous_target" },
    ],
    [
      "# A\n```md\n## Example\n```\n",
      { kind: "section", heading_path: ["A", "Example"], content: "New" },
      { ok: false, reason: "target_not_found" },
    ],
    [
      "# A\n~~~md\n## Example\n~~~\n",
      { kind: "section", heading_path: ["A", "Example"], content: "New" },
      { ok: false, reason: "target_not_found" },
    ],
    [
      "# A\nOld\n# B\nKeep",
      { kind: "section", heading_path: ["A"], content: "New" },
      { ok: true, body: "# A\nNew\n# B\nKeep" },
    ],
    [
      "# A",
      { kind: "section", heading_path: ["A"], content: "New" },
      { ok: true, body: "# A\nNew" },
    ],
    [
      "# A\nOld\n## Child\nOld child\n# B\nKeep\n",
      { kind: "section", heading_path: ["A"], content: "New\n" },
      { ok: true, body: "# A\nNew\n# B\nKeep\n" },
    ],
    [
      "# A\nOld\n# B\nKeep",
      { kind: "section", heading_path: ["A"], content: "" },
      { ok: true, body: "# A\n# B\nKeep" },
    ],
    [
      "# A\nOld",
      { kind: "section", heading_path: [], content: "New" },
      { ok: false, reason: "invalid_patch" },
    ],
    [
      "# A\nOld",
      { kind: "section", heading_path: ["Missing"], content: "New" },
      { ok: false, reason: "target_not_found" },
    ],
  ] as const)("patches fixture %s without unrelated changes", (body, patch, expected) => {
    expect(patchBody(body, patch as TextPatch)).toEqual(expected);
  });
});
