/**
 * tool-registry tests — assert structural invariants of TOOLS +
 * TOOL_SCHEMAS that downstream code (server.ts, dump-tools.mjs,
 * baseline.test.ts) relies on.
 */

import { describe, expect, it } from "vitest";
import { TOOLS, TOOL_SCHEMAS, buildToolSchema, type ToolName } from "./tool-registry.js";

describe("TOOLS array", () => {
  it("has exactly 23 entries", () => {
    expect(TOOLS).toHaveLength(23);
  });

  it("each entry has {name, description, inputSchema}", () => {
    for (const tool of TOOLS) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.inputSchema).toBe("object");
    }
  });

  it("tool names are unique", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("TOOL_SCHEMAS", () => {
  it("has one entry per TOOLS row", () => {
    const toolNames = new Set(TOOLS.map((t) => t.name));
    const schemaNames = new Set(Object.keys(TOOL_SCHEMAS));
    expect(schemaNames).toEqual(toolNames);
  });

  it("buildToolSchema returns a parseable Zod object for every tool", () => {
    for (const tool of TOOLS) {
      const schema = buildToolSchema(tool.name as ToolName);
      expect(typeof schema.parse).toBe("function");
      // safeParse on an empty object — most tools should reject (missing
      // required fields), but the call must not throw at construction.
      const r = schema.safeParse({});
      expect(typeof r.success).toBe("boolean");
    }
  });

  it("read_note schema rejects missing required fields and accepts valid input", () => {
    const schema = buildToolSchema("read_note");
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ vault: "v", path: "p.md" }).success).toBe(true);
  });

  it("suggest_frontmatter schema enforces the path-or-content refinement", () => {
    const schema = buildToolSchema("suggest_frontmatter");
    expect(schema.safeParse({ vault: "v" }).success).toBe(false);
    expect(schema.safeParse({ vault: "v", path: "x.md" }).success).toBe(true);
    expect(schema.safeParse({ vault: "v", content: "# body" }).success).toBe(true);
  });

  it("list_vaults schema accepts empty input (no args)", () => {
    const schema = buildToolSchema("list_vaults");
    expect(schema.safeParse({}).success).toBe(true);
  });
});
