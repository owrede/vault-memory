/**
 * Tests for `instantiateContract` — Plan 06-03 Task 4 (CON-06, D-A4a/b/c,
 * Q-OUTPUT, RESEARCH §Architecture (1)-(7)).
 *
 * Strategy:
 *   - Construct minimal `ParsedContract` objects DIRECTLY (no YAML
 *     loader involvement — Plan 06-02 tests cover that). Each test
 *     focuses on one orchestration step.
 *   - Stub `MemorySinkRegistry`, `DeliveryAdapter`, and verb handlers
 *     via `vi.fn()`.
 *   - Real `:memory:` SQLite DB so `recordContractStep` writes to a real
 *     `contract_audit` table.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { Database } from "../db/database.js";
import { ContractRegistry } from "./registry.js";
import { buildInputSchema } from "./input-schema.js";
import { PeerMcpRegistry } from "./mcp-clients.js";
import { instantiateContract, type InstantiateDeps, type InstantiateArgs } from "./instantiate.js";
import type { ParsedContract, ContractStep, WriteBackSpec } from "./types.js";
import type { DocId } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

interface BuildOpts {
  name?: string;
  inputs?: Record<string, unknown>;
  required?: string[];
  sources?: Record<string, { handle: string; required: boolean }>;
  sinks?: Record<string, { handle: string; required: boolean }>;
  assembly?: ContractStep[];
  write_back?: WriteBackSpec;
  output_shape?: object;
  description?: string;
}

function buildContract(opts: BuildOpts = {}): ParsedContract {
  const inputs = opts.inputs ?? {};
  const required = opts.required ?? [];
  const built = buildInputSchema(inputs, required);
  return {
    version: 1,
    name: opts.name ?? "test-contract",
    description: opts.description ?? "test",
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

function buildDeps(
  overrides: Partial<InstantiateDeps> & { registry?: ContractRegistry; db?: Database } = {},
): InstantiateDeps {
  const db = overrides.db ?? new Database(":memory:");
  const registry = overrides.registry ?? new ContractRegistry();
  const noop = vi.fn(async () => ({ ok: true }));
  // Stub MemorySinkRegistry — by default resolves any handle starting
  // with `obsidian-fs://my-vault/_memory/`. Tests override per case.
  const memorySinks = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolveMemorySink: vi.fn((h: string): any => {
      if (h.startsWith("obsidian-fs://my-vault/_memory/")) {
        return { name: "default-sink", handle: h };
      }
      throw new Error(`Unknown memory sink: "${h}"`);
    }),
  } as unknown as InstantiateDeps["memorySinks"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delivery: any = {
    write: vi.fn(async () => ({
      ok: true,
      newHash: "h1",
      doc_id: "obsidian-fs://my-vault/_memory/_briefs/test.md" as DocId,
      created: true,
    })),
  };
  return {
    vault: { config: { name: "my-vault" }, db } as InstantiateDeps["vault"],
    contractAudit: db.contractAudit,
    registry,
    memorySinks,
    delivery,
    configDefaults: {},
    stepTimeoutSeconds: 30,
    peerMcpRegistry: new PeerMcpRegistry(),
    hybridSearch: noop,
    handleExpand: noop,
    handleCluster: noop,
    handleRecall: noop,
    handleCompileBrief: noop,
    handleGetBrief: noop,
    handleQueryFrontmatter: noop,
    handleListBacklinks: noop,
    handleGetOutline: noop,
    handleSearchSections: noop,
    handleReadNote: noop,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Behavior cases
// ─────────────────────────────────────────────────────────────────────────

describe("instantiateContract (CON-06)", () => {
  let db: Database;
  beforeEach(() => {
    db = new Database(":memory:");
  });

  it("Test 1: CON-06 happy path — literal-verb assembly + write_back returns shaped bundle", async () => {
    const registry = new ContractRegistry();
    registry.set(
      "literal-pair",
      buildContract({
        name: "literal-pair",
        inputs: { topic: { type: "string" } },
        required: ["topic"],
        sinks: {
          default_sink: {
            handle: "obsidian-fs://my-vault/_memory/_briefs/",
            required: true,
          },
        },
        assembly: [
          { as: "step1", verb: "literal", value: "value-a" },
          { as: "step2", verb: "literal", value: "Hello {{inputs.topic}}" },
        ],
        write_back: {
          sink: "{{default_sink}}",
          document_kind: "brief",
          properties: { source: "agent" },
          body_from: "{{step2}}",
        },
      }),
    );
    const deps = buildDeps({ db, registry });
    const result = await instantiateContract(deps, {
      name: "literal-pair",
      inputs: { topic: "Atlas" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps).toEqual({ step1: "value-a", step2: "Hello Atlas" });
    expect(result.write_back).toEqual({
      doc_id: "obsidian-fs://my-vault/_memory/_briefs/test.md",
      sink: "obsidian-fs://my-vault/_memory/_briefs/",
    });
    // Two assembly steps → two contract_audit rows.
    const rows = db.contractAudit.listByKind("contract_step", { vault: "my-vault" });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.stepAlias).sort()).toEqual(["step1", "step2"]);
  });

  it("Test 2: unknown_contract", async () => {
    const deps = buildDeps({ db });
    const r = await instantiateContract(deps, { name: "no-such", inputs: {} });
    expect(r).toEqual({ ok: false, reason: "unknown_contract", name: "no-such" });
  });

  it("Test 3: invalid_inputs — Zod rejection (incl. additionalProperties:false)", async () => {
    const registry = new ContractRegistry();
    registry.set(
      "needs-x",
      buildContract({
        name: "needs-x",
        inputs: { x: { type: "string" } },
        required: ["x"],
      }),
    );
    const deps = buildDeps({ db, registry });
    // Missing required + typo'd key.
    const r = await instantiateContract(deps, {
      name: "needs-x",
      inputs: { extra: "typo" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("invalid_inputs");
  });

  it("Test 4: unknown_override_handle for source", async () => {
    const registry = new ContractRegistry();
    registry.set(
      "c4",
      buildContract({
        name: "c4",
        sources: { default_source: { handle: "obsidian-fs://my-vault", required: true } },
      }),
    );
    const deps = buildDeps({ db, registry });
    const r = await instantiateContract(deps, {
      name: "c4",
      inputs: {},
      source_overrides: { nope: "obsidian-fs://x" },
    });
    expect(r).toEqual({
      ok: false,
      reason: "unknown_override_handle",
      handle: "nope",
      valid_handles: ["default_source"],
    });
  });

  it("Test 5: missing_required_source", async () => {
    const registry = new ContractRegistry();
    registry.set(
      "c5",
      buildContract({
        name: "c5",
        // required:true but no default handle (use empty string literal).
        sources: { default_source: { handle: "", required: true } },
      }),
    );
    const deps = buildDeps({ db, registry });
    const r = await instantiateContract(deps, { name: "c5", inputs: {} });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("missing_required_source");
    if (r.reason !== "missing_required_source") return;
    expect(r.handle).toBe("default_source");
  });

  it("Test 6: source default-chain order — explicit > config > literal > error", async () => {
    const registry = new ContractRegistry();
    registry.set(
      "c6",
      buildContract({
        name: "c6",
        sources: {
          default_source: {
            handle: "obsidian-fs://contract-lit",
            required: true,
          },
        },
        assembly: [{ as: "src", verb: "literal", value: "{{inputs.default_source}}" }],
      }),
    );
    // (a) explicit override wins
    const explicit = await instantiateContract(
      buildDeps({
        db,
        registry,
        configDefaults: { default_source: "obsidian-fs://config-default" },
      }),
      {
        name: "c6",
        inputs: {},
        source_overrides: { default_source: "stub://override" },
      },
    );
    expect(explicit.ok).toBe(true);
    if (explicit.ok) expect(explicit.steps.src).toBe("stub://override");
    // (b) config wins over literal when no explicit override
    const config = await instantiateContract(
      buildDeps({
        db: new Database(":memory:"),
        registry,
        configDefaults: { default_source: "obsidian-fs://config-default" },
      }),
      { name: "c6", inputs: {} },
    );
    expect(config.ok).toBe(true);
    if (config.ok) expect(config.steps.src).toBe("obsidian-fs://config-default");
    // (c) literal wins when neither override nor config
    const lit = await instantiateContract(buildDeps({ db: new Database(":memory:"), registry }), {
      name: "c6",
      inputs: {},
    });
    expect(lit.ok).toBe(true);
    if (lit.ok) expect(lit.steps.src).toBe("obsidian-fs://contract-lit");
  });

  it("Test 7: sink_override_not_a_memory_sink (D-A4c MEM-05 invariant)", async () => {
    const registry = new ContractRegistry();
    registry.set(
      "c7",
      buildContract({
        name: "c7",
        sinks: {
          default_sink: {
            handle: "obsidian-fs://my-vault/_memory/_briefs/",
            required: true,
          },
        },
      }),
    );
    const deps = buildDeps({ db, registry });
    const r = await instantiateContract(deps, {
      name: "c7",
      inputs: {},
      sink_overrides: {
        default_sink: "obsidian-fs://my-vault/notes/", // NOT a sink
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("sink_override_not_a_memory_sink");
    if (r.reason !== "sink_override_not_a_memory_sink") return;
    expect(r.target).toBe("obsidian-fs://my-vault/notes/");
  });

  it("Test 8: sink_override happy path resolves through MemorySinkRegistry", async () => {
    const registry = new ContractRegistry();
    registry.set(
      "c8",
      buildContract({
        name: "c8",
        sinks: {
          default_sink: {
            handle: "obsidian-fs://my-vault/_memory/_briefs/",
            required: true,
          },
        },
      }),
    );
    const deps = buildDeps({ db, registry });
    const r = await instantiateContract(deps, {
      name: "c8",
      inputs: {},
      sink_overrides: {
        default_sink: "obsidian-fs://my-vault/_memory/_briefs/",
      },
    });
    expect(r.ok).toBe(true);
  });

  it("Test 9: unresolved_template", async () => {
    const registry = new ContractRegistry();
    registry.set(
      "c9",
      buildContract({
        name: "c9",
        assembly: [{ as: "x", verb: "literal", value: "{{nope.field}}" }],
      }),
    );
    const r = await instantiateContract(buildDeps({ db, registry }), {
      name: "c9",
      inputs: {},
    });
    expect(r).toEqual({
      ok: false,
      reason: "unresolved_template",
      expression: "{{nope.field}}",
    });
  });

  it("Test 10: assembly_step_failed — thrown error captured with cause", async () => {
    const registry = new ContractRegistry();
    registry.set(
      "c10",
      buildContract({
        name: "c10",
        assembly: [{ as: "s", verb: "search_hybrid", args: { query: "q" } }],
      }),
    );
    const hybridSearch = vi.fn(async () => {
      throw new Error("DB exploded");
    });
    const r = await instantiateContract(buildDeps({ db, registry, hybridSearch }), {
      name: "c10",
      inputs: {},
    });
    expect(r).toEqual({
      ok: false,
      reason: "assembly_step_failed",
      step_alias: "s",
      cause: "DB exploded",
    });
  });

  it("Test 11: named-binding accumulation across steps", async () => {
    const registry = new ContractRegistry();
    registry.set(
      "c11",
      buildContract({
        name: "c11",
        assembly: [
          { as: "step1", verb: "literal", value: { foo: "bar" } },
          { as: "step2", verb: "literal", value: "got: {{step1.foo}}" },
        ],
      }),
    );
    const r = await instantiateContract(buildDeps({ db, registry }), {
      name: "c11",
      inputs: {},
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.steps.step2).toBe("got: bar");
  });

  it("Test 12: write_back routes body+properties through DeliveryAdapter.write", async () => {
    const registry = new ContractRegistry();
    registry.set(
      "c12",
      buildContract({
        name: "c12",
        sinks: {
          default_sink: {
            handle: "obsidian-fs://my-vault/_memory/_briefs/",
            required: true,
          },
        },
        assembly: [{ as: "body", verb: "literal", value: "compiled-body-text" }],
        write_back: {
          sink: "{{inputs.default_sink}}",
          document_kind: "brief",
          properties: { source: "agent", type: "brief" },
          body_from: "{{body}}",
        },
      }),
    );
    const writeSpy = vi.fn(async () => ({
      ok: true as const,
      newHash: "h",
      doc_id: "obsidian-fs://my-vault/_memory/_briefs/x.md" as DocId,
      created: true,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delivery: any = { write: writeSpy };
    const r = await instantiateContract(buildDeps({ db, registry, delivery }), {
      name: "c12",
      inputs: {},
    });
    expect(r.ok).toBe(true);
    expect(writeSpy).toHaveBeenCalledOnce();
    const call = writeSpy.mock.calls[0]!;
    // The doc body + properties were resolved + passed through.
    // First arg is the Document patch; second arg is options.
    expect(call.length).toBeGreaterThanOrEqual(2);
    if (!r.ok) return;
    expect(r.write_back?.doc_id).toBe("obsidian-fs://my-vault/_memory/_briefs/x.md");
  });

  it("Test 13: write_back_failed — DeliveryAdapter throws", async () => {
    const registry = new ContractRegistry();
    registry.set(
      "c13",
      buildContract({
        name: "c13",
        sinks: {
          default_sink: {
            handle: "obsidian-fs://my-vault/_memory/_briefs/",
            required: true,
          },
        },
        assembly: [{ as: "body", verb: "literal", value: "x" }],
        write_back: {
          sink: "{{inputs.default_sink}}",
          document_kind: "brief",
          properties: {},
          body_from: "{{body}}",
        },
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delivery: any = {
      write: vi.fn(async () => {
        throw new Error("disk full");
      }),
    };
    const r = await instantiateContract(buildDeps({ db, registry, delivery }), {
      name: "c13",
      inputs: {},
    });
    expect(r).toEqual({ ok: false, reason: "write_back_failed", cause: "disk full" });
  });

  it("Test 14: validation_failed_on_output_shape — Zod rejects bundle", async () => {
    const registry = new ContractRegistry();
    registry.set(
      "c14",
      buildContract({
        name: "c14",
        assembly: [{ as: "x", verb: "literal", value: "hello" }],
        // output_shape: bundle.steps.x MUST be a number — but it's "hello".
        output_shape: {
          type: "object",
          properties: {
            steps: {
              type: "object",
              properties: { x: { type: "number" } },
              required: ["x"],
            },
          },
          required: ["steps"],
        },
      }),
    );
    const r = await instantiateContract(buildDeps({ db, registry }), {
      name: "c14",
      inputs: {},
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("validation_failed_on_output_shape");
  });

  it("Test 15: Q-OUTPUT — bundle shape is {steps, write_back: null} when no write_back", async () => {
    const registry = new ContractRegistry();
    registry.set(
      "c15",
      buildContract({
        name: "c15",
        assembly: [{ as: "x", verb: "literal", value: "hello" }],
      }),
    );
    const r = await instantiateContract(buildDeps({ db, registry }), {
      name: "c15",
      inputs: {},
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.write_back).toBeNull();
    expect(r.steps).toEqual({ x: "hello" });
  });

  it("Test 16: per-step contract_audit rows written payload-free", async () => {
    const registry = new ContractRegistry();
    registry.set(
      "c16",
      buildContract({
        name: "c16",
        assembly: [
          { as: "a", verb: "literal", value: "x" },
          { as: "b", verb: "literal", value: "y" },
          { as: "c", verb: "literal", value: "z" },
        ],
      }),
    );
    const r = await instantiateContract(buildDeps({ db, registry }), {
      name: "c16",
      inputs: {},
    });
    expect(r.ok).toBe(true);
    const rows = db.contractAudit.listByKind("contract_step", { vault: "my-vault" });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      // Payload-free — no `payload`, no `output`, no `args`.
      expect(Object.keys(row).sort()).toEqual(
        ["contract", "kind", "stepAlias", "ts", "verb", "vault"].sort(),
      );
    }
    expect(rows.map((r) => r.stepAlias).sort()).toEqual(["a", "b", "c"]);
  });

  it("Test 17: audit row written on step failure too", async () => {
    const registry = new ContractRegistry();
    registry.set(
      "c17",
      buildContract({
        name: "c17",
        assembly: [
          { as: "ok-step", verb: "literal", value: "x" },
          { as: "bad-step", verb: "search_hybrid", args: {} },
        ],
      }),
    );
    const hybridSearch = vi.fn(async () => {
      throw new Error("boom");
    });
    await instantiateContract(buildDeps({ db, registry, hybridSearch }), {
      name: "c17",
      inputs: {},
    });
    const rows = db.contractAudit.listByKind("contract_step", { vault: "my-vault" });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.stepAlias).sort()).toEqual(["bad-step", "ok-step"]);
  });

  it("Test 18: concurrent — two simultaneous calls both succeed via DeliveryAdapter", async () => {
    const registry = new ContractRegistry();
    registry.set(
      "c18",
      buildContract({
        name: "c18",
        sinks: {
          default_sink: {
            handle: "obsidian-fs://my-vault/_memory/_briefs/",
            required: true,
          },
        },
        assembly: [{ as: "body", verb: "literal", value: "x" }],
        write_back: {
          sink: "{{inputs.default_sink}}",
          document_kind: "brief",
          properties: {},
          body_from: "{{body}}",
        },
      }),
    );
    let n = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delivery: any = {
      write: vi.fn(async () => ({
        ok: true,
        newHash: "h",
        doc_id: `obsidian-fs://my-vault/_memory/_briefs/x${++n}.md` as DocId,
        created: true,
      })),
    };
    const deps = buildDeps({ db, registry, delivery });
    const [r1, r2] = await Promise.all([
      instantiateContract(deps, { name: "c18", inputs: {} }),
      instantiateContract(deps, { name: "c18", inputs: {} }),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    // Both calls produced distinct doc_ids — the auto-supersede chain
    // lives inside DeliveryAdapter.write, not in the orchestrator.
    expect(r1.write_back?.doc_id).not.toBe(r2.write_back?.doc_id);
  });

  it("Test 19: body_from must resolve to a string — non-string is write_back_failed", async () => {
    const registry = new ContractRegistry();
    registry.set(
      "c19",
      buildContract({
        name: "c19",
        sinks: {
          default_sink: {
            handle: "obsidian-fs://my-vault/_memory/_briefs/",
            required: true,
          },
        },
        assembly: [{ as: "body", verb: "literal", value: { not: "a-string" } }],
        write_back: {
          sink: "{{inputs.default_sink}}",
          document_kind: "brief",
          properties: {},
          body_from: "{{body}}",
        },
      }),
    );
    const r = await instantiateContract(buildDeps({ db, registry }), {
      name: "c19",
      inputs: {},
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("write_back_failed");
  });

  it("Test 20: verb_not_available envelope surfaces as InstantiateError (defense-in-depth)", async () => {
    const registry = new ContractRegistry();
    // We must hand-craft a contract that bypasses the Zod gate (the
    // loader rejects unknown verbs). Cast to bypass for runtime test.
    registry.set(
      "c20",
      buildContract({
        name: "c20",
        assembly: [{ as: "x", verb: "write_note" as unknown as ContractStep["verb"], args: {} }],
      }),
    );
    const r = await instantiateContract(buildDeps({ db, registry }), {
      name: "c20",
      inputs: {},
    });
    expect(r).toEqual({ ok: false, reason: "verb_not_available", verb: "write_note" });
  });

  it("zod fromJSONSchema sanity for output_shape", () => {
    // Sanity check the API we depend on.
    const schema = z.fromJSONSchema({
      type: "object",
      properties: { steps: { type: "object" } },
      required: ["steps"],
    } as unknown as Parameters<typeof z.fromJSONSchema>[0]);
    const check = schema.safeParse({ steps: { x: 1 } });
    expect(check.success).toBe(true);
  });
});
