import { describe, expect, it } from "vitest";
import { projectContext } from "./projection.js";

describe("context character budget", () => {
  it.each([
    ["abcdef", 3, { text: "abc", truncated: true, original_chars: 6 }],
    ["abc", 3, { text: "abc", truncated: false, original_chars: 3 }],
    ["abc", 0, { text: "", truncated: true, original_chars: 3 }],
    ["", 0, { text: "", truncated: false, original_chars: 0 }],
    ["A😀B", 2, { text: "A", truncated: true, original_chars: 4 }],
    ["A😀B", 3, { text: "A😀", truncated: true, original_chars: 4 }],
    ["😀", 2, { text: "😀", truncated: false, original_chars: 2 }],
  ] as const)("projects %s with budget %s", (text, budget, expected) => {
    expect(projectContext(text, budget)).toEqual(expected);
  });
  it.each([-1, NaN, Infinity, 0.5])("rejects invalid budget %s", (budget) => {
    expect(() => projectContext("abc", budget)).toThrow(RangeError);
  });
});
