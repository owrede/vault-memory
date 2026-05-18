/**
 * Unit tests for slugify (Phase 6 / D-A1c).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { slugify } from "./slug.js";

describe("slugify (D-A1c)", () => {
  it("Test 2: 'meeting-prep' + 'vm_' → 'vm_meeting_prep'", () => {
    expect(slugify("meeting-prep", "vm_")).toBe("vm_meeting_prep");
  });

  it("Test 2b: 'project-status' + '' → 'project_status' (empty prefix is the caller's A7 problem)", () => {
    expect(slugify("project-status", "")).toBe("project_status");
  });

  it("Test 2c: non-kebab input pass-through (no hyphens to replace)", () => {
    expect(slugify("simple", "vm_")).toBe("vm_simple");
    expect(slugify("camelCaseInput", "vm_")).toBe("vm_camelCaseInput");
  });

  it("Test 3: zero external deps imported", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "slug.ts"), "utf-8");
    // No imports of lodash/change-case/any external package
    expect(src).not.toMatch(/from\s+["'](lodash|change-case|kebab-case|snake-case)/);
    // No imports at all (the function is pure)
    expect(src).not.toMatch(/^import /m);
  });

  it("multiple hyphens all replaced (defensive)", () => {
    expect(slugify("multi-word-contract", "vm_")).toBe("vm_multi_word_contract");
  });
});
