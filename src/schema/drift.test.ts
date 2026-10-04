import { describe, expect, it } from "vitest";
import { inferFieldProfile } from "./profile.js";
import { diffSchema } from "./drift.js";
describe("explicit schema drift", () => {
  const expected = [
    { key: "evidence", types: ["array"], required: true },
    { key: "name", types: ["string"], required: false },
  ];
  it("reports required missing in any sampled document, unexpected keys and new types", () => {
    expect(
      diffSchema(
        expected,
        inferFieldProfile([{ evidence: [], name: 2, extra: true }, { name: "Ada" }]),
      ),
    ).toEqual([
      { key: "evidence", kind: "missing" },
      { key: "extra", kind: "unexpected" },
      { key: "name", kind: "type_changed" },
    ]);
  });
  it("does not require optional fields or treat a narrower observed type set as drift", () => {
    expect(
      diffSchema(
        [{ key: "name", types: ["string", "null"], required: false }],
        inferFieldProfile([{ name: "Ada" }]),
      ),
    ).toEqual([]);
    expect(diffSchema(expected, inferFieldProfile([{ evidence: [] }]))).toEqual([]);
  });
  it("reports an entirely absent required field even for an empty sample", () => {
    expect(diffSchema(expected, [])).toEqual([{ key: "evidence", kind: "missing" }]);
  });
  it("compares null to the explicit allowed types", () => {
    expect(diffSchema(expected, inferFieldProfile([{ evidence: null }]))).toEqual([
      { key: "evidence", kind: "type_changed" },
    ]);
  });
});
