/**
 * Tests for `describeContract` — Plan 06-03 Task 5 (CON-05, Q-DESCRIBE).
 *
 * Pure-function tests over a real `ContractRegistry` populated with
 * hand-built `ParsedContract` objects. No fs / db / network surfaces.
 */

import { describe, it, expect } from "vitest";
import { ContractRegistry } from "./registry.js";
import { buildInputSchema } from "./input-schema.js";
import { describeContract } from "./describe.js";
import type { ParsedContract, WriteBackSpec } from "./types.js";

interface BuildOpts {
  name?: string;
  description?: string;
  inputs?: Record<string, unknown>;
  required?: string[];
  sources?: Record<string, { handle: string; required: boolean }>;
  sinks?: Record<string, { handle: string; required: boolean }>;
  assembly?: ParsedContract["assembly"];
  write_back?: WriteBackSpec;
  output_shape?: object;
}

function buildContract(opts: BuildOpts = {}): ParsedContract {
  const inputs = opts.inputs ?? {};
  const required = opts.required ?? [];
  const built = buildInputSchema(inputs, required);
  return {
    version: 1,
    name: opts.name ?? "test",
    description: opts.description ?? "",
    inputs,
    required,
    sources: opts.sources ?? {},
    sinks: opts.sinks ?? {},
    assembly: opts.assembly ?? [],
    inputZodSchema: built.zodSchema,
    inputJsonSchema: built.jsonSchema,
    ...(opts.output_shape !== undefined ? { output_shape: opts.output_shape } : {}),
    ...(opts.write_back !== undefined ? { write_back: opts.write_back } : {}),
  };
}

describe("describeContract (CON-05, Q-DESCRIBE)", () => {
  it("Test 1: happy path — returns json_schema + markdown summary with all sections", () => {
    const registry = new ContractRegistry();
    registry.set(
      "meeting-prep",
      buildContract({
        name: "meeting-prep",
        description: "Prepare for a meeting using context and recent observations.",
        inputs: {
          meeting_topic: { type: "string", minLength: 1 },
          attendee: { $ref: "#/types/DocId" },
        },
        required: ["meeting_topic"],
        sources: { main_vault: { handle: "obsidian-fs://my-vault", required: true } },
        sinks: {
          notes: {
            handle: "obsidian-fs://my-vault/_memory/observations/",
            required: false,
          },
        },
        assembly: [
          { as: "related_notes", verb: "search_hybrid", args: { query: "x" } },
          { as: "literal_block", verb: "literal", value: "Static reminder text" },
        ],
        write_back: {
          sink: "{{notes}}",
          document_kind: "observation",
          properties: { source: "agent" },
          body_from: "{{related_notes.body}}",
        },
        output_shape: {
          type: "object",
          properties: {
            brief_doc_id: { type: "string" },
            cluster_count: { type: "integer" },
          },
        },
      }),
    );
    const result = describeContract({ registry }, { name: "meeting-prep" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toContain("# meeting-prep");
    expect(result.summary).toContain("## Inputs");
    expect(result.summary).toContain("## Sources");
    expect(result.summary).toContain("## Sinks");
    expect(result.summary).toContain("## Assembly");
    expect(result.summary).toContain("## write_back");
    expect(result.summary).toContain("## Output Shape");
    // Each input rendered with name + type + required flag.
    expect(result.summary).toContain("- **meeting_topic** (string, required)");
    expect(result.summary).toContain("- **attendee** (`#/types/DocId`, optional)");
    // Assembly steps are numbered, with a plain-language gloss + the verb
    // call kept inline.
    expect(result.summary).toContain(
      "1. **related_notes** — Search the vault (semantic + keyword) _(`search_hybrid(query)`)_",
    );
    expect(result.summary).toContain("2. **literal_block** — Use a fixed inline value _(`literal()`)_");
    // json_schema returned verbatim (the cached inputJsonSchema).
    expect(result.json_schema).toBeDefined();
    expect((result.json_schema as { type?: string }).type).toBe("object");
  });

  it("Test 2: unknown_contract", () => {
    const registry = new ContractRegistry();
    const r = describeContract({ registry }, { name: "nope" });
    expect(r).toEqual({ ok: false, reason: "unknown_contract", name: "nope" });
  });

  it("Test 3: assembly numbered list with arg keys", () => {
    const registry = new ContractRegistry();
    registry.set(
      "c3",
      buildContract({
        name: "c3",
        assembly: [
          { as: "step1", verb: "search_hybrid", args: { query: "x", vault: "v", top_k: 5 } },
        ],
      }),
    );
    const r = describeContract({ registry }, { name: "c3" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toContain(
      "1. **step1** — Search the vault (semantic + keyword) _(`search_hybrid(query, vault, top_k)`)_",
    );
  });

  it("Test 4: write_back section present when configured; absent otherwise", () => {
    const registry = new ContractRegistry();
    registry.set(
      "with-wb",
      buildContract({
        name: "with-wb",
        write_back: {
          sink: "{{default_sink}}",
          document_kind: "brief",
          properties: {},
          body_from: "{{x}}",
        },
      }),
    );
    registry.set("no-wb", buildContract({ name: "no-wb" }));
    const w = describeContract({ registry }, { name: "with-wb" });
    const n = describeContract({ registry }, { name: "no-wb" });
    expect(w.ok && w.summary.includes("## write_back")).toBe(true);
    expect(w.ok && w.summary.includes("Writes a brief document")).toBe(true);
    expect(n.ok && n.summary.includes("## write_back")).toBe(false);
  });

  it("Test 5: Output Shape section renders properties compactly", () => {
    const registry = new ContractRegistry();
    registry.set(
      "c5",
      buildContract({
        name: "c5",
        output_shape: {
          type: "object",
          properties: {
            brief_doc_id: { type: "string" },
            cluster_count: { type: "integer" },
          },
        },
      }),
    );
    const r = describeContract({ registry }, { name: "c5" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toContain("`{brief_doc_id: string, cluster_count: integer}`");
  });

  it("Test 6: sources/sinks rendering with required flags", () => {
    const registry = new ContractRegistry();
    registry.set(
      "c6",
      buildContract({
        name: "c6",
        sources: { src: { handle: "obsidian-fs://a", required: true } },
        sinks: { snk: { handle: "obsidian-fs://b/_memory/", required: false } },
      }),
    );
    const r = describeContract({ registry }, { name: "c6" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toContain("- **src** → `obsidian-fs://a` (required)");
    expect(r.summary).toContain(
      "- **snk** → `obsidian-fs://b/_memory/` (optional MemorySink)",
    );
  });

  it("Test 7: pure — works with minimal registry-only deps (no DB/network/FS surface)", () => {
    const registry = new ContractRegistry();
    registry.set("c7", buildContract({ name: "c7" }));
    const r = describeContract({ registry }, { name: "c7" });
    expect(r.ok).toBe(true);
  });
});
