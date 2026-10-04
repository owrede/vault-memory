import { StubSource } from "../adapters/stub/source.js";
import { parseDocId } from "../adapters/registry.js";
import { z } from "zod";
import { resolveInspectionContract } from "./resolve-contract.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createVaultFixture } from "../../tests/helpers/vault-fixture.js";
import { inspectSchema } from "./inspect.js";
import { loadContractFromDisk } from "../memory/contract/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerFeatureTools } from "../server/feature-tools.js";
import { loadConfig } from "../config/loader.js";
describe("read-only schema inspection over real sources and contracts", () => {
  let f: Awaited<ReturnType<typeof createVaultFixture>>;
  const valid =
    "---\nsource: imported\nconfidence: direct\nevidence: [original]\nstatus: active\nobserved_at: '2026-10-03T10:00:00Z'\nsuperseded_by: null\ntype: observation\n---\n# Note\n- [custom_fact] Statement\n## Relations\n- custom_role [[Other]]\n";
  beforeEach(async () => {
    f = await createVaultFixture({ writeEnabled: false });
    await fs.writeFile(join(f.root, "a.md"), valid);
  });
  afterEach(async () => {
    await f.cleanup();
  });
  const run = (args: object = {}) =>
    inspectSchema(
      { mode: "validate", contract: "default-memory-v1", doc_ids: [f.id("a.md")], ...args },
      { adapterRegistry: f.adapterRegistry },
    ) as Promise<any>;
  it("never makes required provenance optional, even in permissive mode", async () => {
    await fs.writeFile(join(f.root, "a.md"), valid.replace("evidence: [original]\n", ""));
    const result = await run({ strict: false });
    expect(result).toMatchObject({ passed: false, warning_count: 0 });
    expect(result.error_count).toBeGreaterThan(0);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          doc_id: f.id("a.md"),
          path: ["evidence"],
          code: "missing_required",
        }),
      ]),
    );
    const infer = await run({ mode: "infer" });
    expect(infer.candidates).toContainEqual({ key: "evidence", types: ["array"], required: true });
  });
  it("makes extra properties warnings in permissive mode and errors in strict mode", async () => {
    await fs.writeFile(
      join(f.root, "a.md"),
      valid.replace("type: observation", "type: observation\nextra: true"),
    );
    expect(await run({ strict: false })).toMatchObject({
      passed: true,
      error_count: 0,
      warning_count: 1,
      warnings: [{ path: ["extra"], code: "unexpected_field" }],
    });
    expect(await run({ strict: true })).toMatchObject({
      passed: false,
      error_count: 1,
      warning_count: 0,
      errors: [{ path: ["extra"], code: "unexpected_field" }],
    });
  });
  it("reports fresh source citations, sample size and non-mutating candidate profiles", async () => {
    const before = await fs.readFile(join(f.root, "a.md"), "utf8");
    const result = await run({
      mode: "infer",
      contract: undefined,
      doc_ids: [f.id("a.md"), f.id("a.md")],
    });
    expect(result).toMatchObject({
      sample_size: 1,
      candidate_only: true,
      sources: [
        {
          doc_id: f.id("a.md"),
          hash: (await f.source.readDocument(f.id("a.md"))).hash,
          properties: { source: "imported", evidence: ["original"] },
        },
      ],
      categories: [{ value: "custom_fact", present: 1, total: 1 }],
      relations: [{ value: "custom_role", present: 1, total: 1 }],
    });
    expect(result.candidates.every((field: { required: boolean }) => !field.required)).toBe(true);
    expect(await fs.readFile(join(f.root, "a.md"), "utf8")).toBe(before);
    expect(f.vault.db.notes.listAll().length).toBe(0);
    expect(f.vault.db.audit.listWrites({})).toEqual([]);
    expect(await run({ mode: "infer", contract: undefined, doc_ids: [] })).toMatchObject({
      sample_size: 0,
      profiles: [],
      candidates: [],
      sources: [],
    });
  });
  it("validates and diffs explicit category/role vocabularies from a real YAML contract", async () => {
    await fs.mkdir(join(f.root, "_contracts", "memory"), { recursive: true });
    await fs.writeFile(
      join(f.root, "_contracts", "memory", "inspection-fixture.yaml"),
      "name: inspection-fixture\nrequired_properties:\n  source: {type: string}\n  evidence: {type: array}\noptional_properties:\n  confidence: {type: string}\n  status: {type: string}\n  observed_at: {type: string}\n  superseded_by: {type: string, nullable: true}\n  type: {type: string}\nobservation_categories: [fact]\nrelation_roles: [owns]\nnaming: {strategy: caller-provided}\n",
    );
    await loadContractFromDisk("inspection-fixture", f.root);
    const permissive = await run({ contract: "inspection-fixture", strict: false });
    expect(permissive).toMatchObject({
      passed: true,
      error_count: 0,
      warning_count: 2,
      warnings: [
        { code: "unknown_category", value: "custom_fact", line: 2 },
        { code: "unknown_relation", value: "custom_role", line: 4 },
      ],
    });
    const strict = await run({ contract: "inspection-fixture", strict: true });
    expect(strict).toMatchObject({ passed: false, error_count: 2, warning_count: 0 });
    const diff = await run({ mode: "diff", contract: "inspection-fixture" });
    expect(diff).toMatchObject({
      sample_size: 1,
      category_drift: [{ value: "custom_fact", kind: "unexpected" }],
      relation_drift: [{ value: "custom_role", kind: "unexpected" }],
    });
  });
  it("returns required missing and changed types in diff without changing the contract", async () => {
    await fs.writeFile(
      join(f.root, "a.md"),
      valid.replace("evidence: [original]\n", "").replace("type: observation", "type: 12"),
    );
    expect(await run({ mode: "diff" })).toMatchObject({
      drift: expect.arrayContaining([
        { key: "evidence", kind: "missing" },
        { key: "type", kind: "type_changed" },
      ]),
      sources: [{ doc_id: f.id("a.md") }],
    });
  });
  it("fails closed for missing contracts and unavailable samples", async () => {
    await expect(run({ contract: "unknown" })).rejects.toThrow("Unknown memory contract");
    await expect(run({ contract: undefined })).rejects.toThrow("contract_required");
    await expect(run({ doc_ids: [f.id("missing.md")] })).rejects.toThrow();
  });

  it("loads an explicitly named disk contract for one vault without storing inference", async () => {
    await fs.mkdir(join(f.root, "_contracts", "memory"), { recursive: true });
    await fs.writeFile(
      join(f.root, "_contracts", "memory", "inspection-auto-fixture.yaml"),
      "name: inspection-auto-fixture\nrequired_properties:\n  evidence: {type: array}\nnaming: {strategy: caller-provided}\n",
    );
    const result = await inspectSchema(
      { mode: "validate", contract: "inspection-auto-fixture", doc_ids: [f.id("a.md")] },
      {
        adapterRegistry: f.adapterRegistry,
        resolveContract: (name, ids) => resolveInspectionContract(f.manager, name, ids),
      },
    );
    expect(result).toMatchObject({ passed: true, contract: { name: "inspection-auto-fixture" } });
  });

  it("retains structured lists/headings and marks rendered declaration lines", async () => {
    const original = await f.source.readDocument(f.id("a.md"));
    const source = new StubSource();
    const doc = {
      ...original,
      id: parseDocId("stub://memory/structured"),
      source: source.handle,
      properties: {},
      blocks: [
        { kind: "list" as const, ordered: false, items: ["[custom_fact] Claim"] },
        { kind: "heading" as const, level: 2 as const, text: "Relations" },
        { kind: "paragraph" as const, text: "- custom_role [[Other]]" },
      ],
    };
    source.inner().set(doc.id, doc);
    f.adapterRegistry.registerSource(source.handle, source);
    const result = await inspectSchema(
      { mode: "validate", contract: "structured-fixture", doc_ids: [doc.id], strict: true },
      {
        adapterRegistry: f.adapterRegistry,
        resolveContract: async () => ({
          name: "structured-fixture",
          version: "1",
          propertiesSchema: z.object({}).passthrough(),
          requiredKeys: [],
          naming: { strategy: "caller-provided" },
          observationCategories: [],
          relationRoles: [],
        }),
      },
    );
    expect(result.passed).toBe(false);
    expect(result.categories).toEqual([{ value: "custom_fact", present: 1, total: 1 }]);
    expect(result.relations).toEqual([{ value: "custom_role", present: 1, total: 1 }]);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknown_category", line_basis: "rendered_markdown" }),
        expect.objectContaining({ code: "unknown_relation", line_basis: "rendered_markdown" }),
      ]),
    );
  });
  it("is opt-in through configuration and executes through the real MCP schema", async () => {
    const configPath = join(f.root, "config.toml");
    await fs.writeFile(configPath, '[server]\nfeatures = ["schema_inspection"]\n');
    expect((await loadConfig(configPath)).server.features).toEqual(["schema_inspection"]);
    const server = new McpServer({ name: "inspection-test", version: "1" });
    const client = new Client({ name: "test", version: "1" });
    registerFeatureTools(server, { adapterRegistry: f.adapterRegistry }, [
      "schema_inspection",
      "schema_inspection",
    ]);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["inspect_schema"]);
      const response = await client.callTool({
        name: "inspect_schema",
        arguments: {
          mode: "validate",
          contract: "default-memory-v1",
          doc_ids: [f.id("a.md")],
          strict: false,
        },
      });
      expect(response.isError).not.toBe(true);
      expect(JSON.parse((response.content as { text: string }[])[0]!.text)).toMatchObject({
        passed: true,
        error_count: 0,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
