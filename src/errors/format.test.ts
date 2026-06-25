import { describe, expect, it } from "vitest";
import { errorMessage } from "./format.js";

describe("errorMessage", () => {
  it("returns the message of an Error instance", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns a string value unchanged", () => {
    expect(errorMessage("boom")).toBe("boom");
  });

  it("stringifies a number", () => {
    expect(errorMessage(42)).toBe("42");
  });

  it("stringifies null", () => {
    expect(errorMessage(null)).toBe("null");
  });

  it("stringifies undefined", () => {
    expect(errorMessage(undefined)).toBe("undefined");
  });

  it("stringifies a plain object via String()", () => {
    const obj = { a: 1 };
    expect(errorMessage(obj)).toBe(String(obj));
    expect(errorMessage(obj)).toBe("[object Object]");
  });

  it("is byte-identical to the inline ternary for subclassed errors", () => {
    class CustomError extends Error {}
    const err: unknown = new CustomError("custom");
    expect(errorMessage(err)).toBe(err instanceof Error ? err.message : String(err));
  });
});
