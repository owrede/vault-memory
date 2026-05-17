/**
 * tool-registry tests — assert structural invariants of TOOLS +
 * TOOL_SCHEMAS that downstream code (server.ts, dump-tools.mjs,
 * baseline.test.ts) relies on.
 */

import { describe, expect, it } from "vitest";
import { TOOLS, TOOL_SCHEMAS, buildToolSchema, type ToolName } from "./tool-registry.js";

describe("TOOLS array", () => {
  it("has exactly 31 entries (23 v1 + 02-04 record_observation + supersede + 02-05 recall + 03-02 get_outline + 03-03 search_sections + 03-04 get_document_bundle + 03-06 assemble_dossier + 04-03 expand)", () => {
    expect(TOOLS).toHaveLength(31);
  });

  it("includes record_observation, supersede, recall, get_outline, search_sections, get_document_bundle, and assemble_dossier with non-empty descriptions", () => {
    const byName = new Map(TOOLS.map((t) => [t.name, t]));
    const ro = byName.get("record_observation");
    const sup = byName.get("supersede");
    const rc = byName.get("recall");
    const ss = byName.get("search_sections");
    const go = byName.get("get_outline");
    const gb = byName.get("get_document_bundle");
    const ad = byName.get("assemble_dossier");
    expect(ro).toBeDefined();
    expect(sup).toBeDefined();
    expect(rc).toBeDefined();
    expect(ss).toBeDefined();
    expect(go).toBeDefined();
    expect(gb).toBeDefined();
    expect(ad).toBeDefined();
    expect((ro?.description ?? "").length).toBeGreaterThan(0);
    expect((sup?.description ?? "").length).toBeGreaterThan(0);
    expect((rc?.description ?? "").length).toBeGreaterThan(0);
    expect((ss?.description ?? "").length).toBeGreaterThan(0);
    expect((go?.description ?? "").length).toBeGreaterThan(0);
    expect((gb?.description ?? "").length).toBeGreaterThan(0);
    expect((ad?.description ?? "").length).toBeGreaterThan(0);
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

  describe("record_observation schema (Plan 02-04)", () => {
    it("accepts a fully-specified valid payload", () => {
      const schema = buildToolSchema("record_observation");
      const r = schema.safeParse({
        vault: "v",
        claim: "c",
        evidence: [],
        confidence: "direct",
        type: "observation",
      });
      expect(r.success).toBe(true);
    });

    it("rejects empty input (missing required fields)", () => {
      const schema = buildToolSchema("record_observation");
      const r = schema.safeParse({});
      expect(r.success).toBe(false);
    });

    it("rejects unknown confidence enum values", () => {
      const schema = buildToolSchema("record_observation");
      const r = schema.safeParse({
        vault: "v",
        claim: "c",
        evidence: [],
        confidence: "high",
        type: "observation",
      });
      expect(r.success).toBe(false);
    });

    it("accepts the optional properties escape hatch (passthrough record)", () => {
      const schema = buildToolSchema("record_observation");
      const r = schema.safeParse({
        vault: "v",
        claim: "c",
        evidence: [],
        confidence: "direct",
        type: "observation",
        properties: { expires_at: "2026-12-31", custom_tag: "x" },
      });
      expect(r.success).toBe(true);
    });
  });

  describe("supersede schema (Plan 02-04)", () => {
    it("accepts a fully-valid payload", () => {
      const schema = buildToolSchema("supersede");
      const r = schema.safeParse({
        doc_id: "obsidian-fs://v/_memory/a.md",
        replacement_doc_id: "obsidian-fs://v/_memory/b.md",
        reason: "new evidence",
      });
      expect(r.success).toBe(true);
    });

    it("rejects malformed doc_id (not a canonical URI)", () => {
      const schema = buildToolSchema("supersede");
      const r = schema.safeParse({
        doc_id: "not-a-doc-id",
        replacement_doc_id: "obsidian-fs://v/_memory/b.md",
        reason: "x",
      });
      expect(r.success).toBe(false);
    });

    it("rejects empty reason", () => {
      const schema = buildToolSchema("supersede");
      const r = schema.safeParse({
        doc_id: "obsidian-fs://v/_memory/a.md",
        replacement_doc_id: "obsidian-fs://v/_memory/b.md",
        reason: "",
      });
      expect(r.success).toBe(false);
    });
  });

  describe("recall schema (Plan 02-05)", () => {
    it("accepts a minimal valid payload (only query)", () => {
      const schema = buildToolSchema("recall");
      const r = schema.safeParse({ query: "foo" });
      expect(r.success).toBe(true);
    });

    it("rejects empty query (min 1 char)", () => {
      const schema = buildToolSchema("recall");
      const r = schema.safeParse({ query: "" });
      expect(r.success).toBe(false);
    });

    it("rejects unknown min_confidence enum values", () => {
      const schema = buildToolSchema("recall");
      const r = schema.safeParse({ query: "foo", min_confidence: "unknown-level" });
      expect(r.success).toBe(false);
    });

    it("rejects non-positive max_age_days", () => {
      const schema = buildToolSchema("recall");
      const r = schema.safeParse({ query: "foo", max_age_days: -5 });
      expect(r.success).toBe(false);
    });

    it("accepts a fully-specified valid payload", () => {
      const schema = buildToolSchema("recall");
      const r = schema.safeParse({
        query: "Spire budget",
        min_confidence: "inferred",
        types: ["observation", "hypothesis"],
        max_age_days: 30,
        sink: "default",
        limit: 5,
        vaults: ["atlas"],
      });
      expect(r.success).toBe(true);
    });

    it("rejects limit > 200", () => {
      const schema = buildToolSchema("recall");
      const r = schema.safeParse({ query: "foo", limit: 1000 });
      expect(r.success).toBe(false);
    });
  });

  describe("assemble_dossier schema (Plan 03-06)", () => {
    it("accepts a minimal valid payload (type + key only)", () => {
      const schema = buildToolSchema("assemble_dossier");
      const r = schema.safeParse({ type: "Person", key: "Alice Chen" });
      expect(r.success).toBe(true);
    });

    it("rejects empty type", () => {
      const schema = buildToolSchema("assemble_dossier");
      const r = schema.safeParse({ type: "", key: "Alice" });
      expect(r.success).toBe(false);
    });

    it("rejects empty key", () => {
      const schema = buildToolSchema("assemble_dossier");
      const r = schema.safeParse({ type: "Person", key: "" });
      expect(r.success).toBe(false);
    });

    it("rejects missing required fields", () => {
      const schema = buildToolSchema("assemble_dossier");
      expect(schema.safeParse({}).success).toBe(false);
      expect(schema.safeParse({ type: "Person" }).success).toBe(false);
      expect(schema.safeParse({ key: "Alice" }).success).toBe(false);
    });

    it("accepts the optional vaults filter", () => {
      const schema = buildToolSchema("assemble_dossier");
      const r = schema.safeParse({
        type: "Project",
        key: "Atlas-1",
        vaults: ["atlas"],
      });
      expect(r.success).toBe(true);
    });
  });
});
