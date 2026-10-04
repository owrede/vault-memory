import { describe, expect, it } from "vitest";
import { isValidAt, parseValidity } from "./valid-time.js";
describe("explicit business validity", () => {
  it("uses an inclusive start and exclusive end", () => {
    const validity = { valid_from: "2026-01-01T00:00:00Z", valid_to: "2026-02-01T00:00:00Z" };
    expect(isValidAt(validity, "2026-01-01T00:00:00Z")).toBe(true);
    expect(isValidAt(validity, "2026-02-01T00:00:00Z")).toBe(false);
    expect(isValidAt(validity, "2025-12-31T23:59:59.999Z")).toBe(false);
  });
  it("normalizes offsets to UTC without interpreting observed_at", () => {
    expect(
      parseValidity({
        valid_from: "2026-01-01T01:00:00+01:00",
        valid_to: "2026-02-01T00:00:00Z",
        observed_at: "1990-01-01T00:00:00Z",
      }),
    ).toEqual({
      ok: true,
      validity: { valid_from: "2026-01-01T00:00:00.000Z", valid_to: "2026-02-01T00:00:00.000Z" },
    });
    expect(parseValidity({ observed_at: "1990-01-01T00:00:00Z" })).toEqual({
      ok: true,
      validity: {},
    });
  });
  it("keeps null and missing boundaries open", () => {
    expect(parseValidity({ valid_from: null })).toEqual({
      ok: true,
      validity: { valid_from: null },
    });
    expect(isValidAt({}, "2000-01-01T00:00:00Z")).toBe(true);
    expect(isValidAt({ valid_from: null, valid_to: null }, "2000-01-01T00:00:00Z")).toBe(true);
  });
  it.each([
    "2026-01-01",
    "2026-01-01T00:00:00",
    "yesterday",
    "2026-02-30T00:00:00Z",
    "2026-02-29T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:60:00Z",
    "2026-01-01T00:00:60Z",
    "2026-01-01T00:00:00.0001Z",
  ])("rejects invalid timestamps %s", (timestamp) => {
    expect(parseValidity({ valid_from: timestamp })).toEqual({
      ok: false,
      reason: "invalid_validity",
      key: "valid_from",
    });
    expect(() => isValidAt({}, timestamp)).toThrow("invalid as_of");
  });
  it("accepts real leap days and millisecond precision", () => {
    expect(parseValidity({ valid_from: "2024-02-29T00:00:00.1Z" })).toEqual({
      ok: true,
      validity: { valid_from: "2024-02-29T00:00:00.100Z" },
    });
  });
  it.each([12, true, {}, new Date("2026-01-01T00:00:00Z")])(
    "rejects non-string bounds %s",
    (value) => {
      expect(parseValidity({ valid_to: value })).toEqual({
        ok: false,
        reason: "invalid_validity",
        key: "valid_to",
      });
    },
  );
  it.each(["2026-01-01T00:00:00Z", "2025-12-31T23:59:59Z"])(
    "rejects empty or reversed ranges ending %s",
    (end) => {
      expect(parseValidity({ valid_from: "2026-01-01T00:00:00Z", valid_to: end })).toEqual({
        ok: false,
        reason: "invalid_validity",
        key: "valid_to",
      });
    },
  );
  it("does not treat invalid ranges as valid in direct calls", () => {
    expect(() => isValidAt({ valid_from: "bad" }, "2026-01-01T00:00:00Z")).toThrow(
      "invalid_validity",
    );
  });
});
