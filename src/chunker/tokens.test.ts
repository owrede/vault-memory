import { describe, it, expect } from "vitest";
import { countTokens } from "./tokens.js";

describe("countTokens", () => {
  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });

  it("ceils text.length / 4", () => {
    expect(countTokens("abc")).toBe(1);
    expect(countTokens("abcd")).toBe(1);
    expect(countTokens("abcde")).toBe(2);
    expect(countTokens("abcdefgh")).toBe(2);
    expect(countTokens("abcdefghi")).toBe(3);
  });

  it("is deterministic and proportional", () => {
    const a = "x".repeat(1000);
    const b = "x".repeat(2000);
    expect(countTokens(a)).toBe(250);
    expect(countTokens(b)).toBe(500);
    expect(countTokens(a)).toBe(countTokens(a));
  });
});
