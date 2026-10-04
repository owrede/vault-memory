import { describe, expect, it } from "vitest";
import { inferFieldProfile } from "./profile.js";
describe("empirical field prevalence", () => {
  it("reports prevalence without inventing required fields", () => {
    expect(inferFieldProfile([{ name: "Oliver", team: "IA" }, { name: "Ada" }])).toEqual([
      { key: "name", types: ["string"], present: 2, total: 2 },
      { key: "team", types: ["string"], present: 1, total: 2 },
    ]);
  });
  it("distinguishes null, arrays and missing values with deterministic ordering", () => {
    expect(
      inferFieldProfile([
        { z: null, a: [1], mix: "yes" },
        { mix: false, a: {}, z: 3 },
      ]),
    ).toEqual([
      { key: "a", types: ["array", "object"], present: 2, total: 2 },
      { key: "mix", types: ["boolean", "string"], present: 2, total: 2 },
      { key: "z", types: ["null", "number"], present: 2, total: 2 },
    ]);
  });
  it("returns no candidates from an empty sample", () => expect(inferFieldProfile([])).toEqual([]));
  it("ignores inherited properties and counts own undefined as present", () => {
    const row = Object.assign(Object.create({ inherited: true }), { own: undefined });
    expect(inferFieldProfile([row])).toEqual([
      { key: "own", types: ["undefined"], present: 1, total: 1 },
    ]);
  });
});
