import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createVaultFixture } from "../../tests/helpers/vault-fixture.js";
import { indexVault } from "../indexer/indexer.js";
import { hybridSearch, type HybridSearchOptions } from "./hybrid.js";
import { OllamaClient } from "../ollama/index.js";
import { handleRecall as recall } from "../memory/tools/recall.js";
import { getDocumentBundle } from "../assembly/bundle.js";
import { DEFAULT_MEMORY_V1 } from "../memory/contract/index.js";
import { updateFrontmatter } from "../frontmatter/update.js";
import { z } from "zod";
import { TOOLS, TOOL_SCHEMAS } from "../tool-registry.js";
import { parseObservations } from "../observations/parse.js";
describe("business validity in real SQLite search and source citations", () => {
  let f: Awaited<ReturnType<typeof createVaultFixture>>;
  const january = "2026-01-15T00:00:00Z",
    now = "2026-10-03T00:00:00Z";
  const body = (from: string, to?: string, extra = "") =>
    `---\nsource: agent\nconfidence: direct\nevidence: [original]\nstatus: active\nobserved_at: '2026-03-01T00:00:00Z'\nsuperseded_by: null\ntype: observation\nvalid_from: '${from}'\n${to ? `valid_to: '${to}'\n` : ""}---\n# Budget\n- [fact] Budget rule\n${extra}`;
  beforeEach(async () => {
    f = await createVaultFixture({ memorySink: true });
    await fs.writeFile(
      join(f.root, "_memory", "old.md"),
      body("2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"),
    );
    await fs.writeFile(join(f.root, "_memory", "new.md"), body("2026-02-01T00:00:00Z"));
    await indexVault(f.vault, { embeddings: "none", embeddingModel: "unused" });
  });
  afterEach(async () => {
    await f.cleanup();
  });
  const search = (args: object = {}) =>
    hybridSearch({
      query: "Budget",
      vaults: [f.vault],
      embeddingModel: "unused",
      ollama: new OllamaClient(),
      clock: () => Date.parse(now),
      topK: 1,
      ...args,
    } as HybridSearchOptions);
  const recalled = (args: object = {}) =>
    recall(
      {
        manager: f.manager,
        memorySinkRegistry: f.memorySinkRegistry,
        sourceConnectorFor: () => f.source,
        searchHybrid: (input) =>
          hybridSearch({
            ...input,
            embeddingModel: "unused",
            ollama: new OllamaClient(),
          } as HybridSearchOptions),
        ...{ clock: () => Date.parse(now) },
      },
      { query: "Budget", limit: 1, ...args },
    );
  it("pre-filters native vector nearest neighbours before K", () => {
    const model = f.vault.db.models.upsert({ name: "validity-test", provider: "test", dim: 2 });
    const old = f.vault.db.notes.getByPath("_memory/old.md")!;
    const current = f.vault.db.notes.getByPath("_memory/new.md")!;
    const oldChunk = f.vault.db.chunks.getByNote(old.id)[0]!;
    const newChunk = f.vault.db.chunks.getByNote(current.id)[0]!;
    f.vault.db.embeddings.insertBatch([
      { chunkId: oldChunk.id, modelId: model.id, vector: [0, 0] },
      { chunkId: newChunk.id, modelId: model.id, vector: [10, 10] },
    ]);
    expect(
      f.vault.db.embeddings
        .searchSemantic(model.id, [0, 0], 1, { asOfMs: Date.parse(now), excludeSuperseded: true })
        .map((h) => h.chunkId),
    ).toEqual([newChunk.id]);
  });
  it("exposes validated as_of only on additive v2 retrieval schemas", () => {
    for (const name of ["recall", "search_sections", "get_document_bundle"]) {
      expect(TOOLS.find((t) => t.name === name)!.inputSchema.properties).toHaveProperty("as_of");
      const schema = z.object(TOOL_SCHEMAS[name]!);
      const input =
        name === "get_document_bundle" ? { doc_id: f.id("_memory/old.md") } : { query: "Budget" };
      expect(schema.safeParse({ ...input, as_of: "2026-02-30T00:00:00Z" }).success).toBe(false);
      expect(schema.parse({ ...input, as_of: january })).toMatchObject({ as_of: january });
    }
  });
  it("refuses invalid validity before delivery mutates a file", async () => {
    const doc = await f.source.readDocument(f.id("_memory/new.md"));
    const result = await f.delivery.update(
      doc.id,
      { ...doc, properties: { ...doc.properties, valid_to: "wrong" } },
      { expectedHash: doc.hash },
    );
    expect(result).toMatchObject({ ok: false, reason: "invalid_validity" });
    expect((await f.source.readDocument(doc.id)).hash).toBe(doc.hash);
  });
  it("keeps invalid_validity distinct from OCC in frontmatter updates", async () => {
    await fs.writeFile(join(f.root, "user.md"), "# User\nOriginal");
    await indexVault(f.vault, { embeddings: "none", embeddingModel: "unused" });
    const doc = await f.source.readDocument(f.id("user.md"));
    const result = await updateFrontmatter({
      vault: f.vault,
      registry: f.adapterRegistry,
      relativePath: "user.md",
      expectedHash: doc.hash,
      merge: { valid_from: "2026-02-30T00:00:00Z" },
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid_validity" });
    expect((await f.source.readDocument(doc.id)).hash).toBe(doc.hash);
  });
  it("stores canonical UTC bounds and current/historical search filters before limit", async () => {
    expect(f.vault.db.notes.getByPath("_memory/old.md")).toMatchObject({
      valid_from_ms: Date.parse("2026-01-01T00:00:00Z"),
      valid_to_ms: Date.parse("2026-02-01T00:00:00Z"),
      validity_error: null,
    });
    expect((await search()).map((hit) => hit.notePath)).toEqual(["_memory/new.md"]);
    expect((await search({ asOf: january })).map((hit) => hit.notePath)).toEqual([
      "_memory/old.md",
    ]);
    expect((await search({ asOf: "2026-02-01T00:00:00Z" })).map((hit) => hit.notePath)).toEqual([
      "_memory/new.md",
    ]);
  });
  it("does not starve an eligible lower-ranked document behind many expired candidates", async () => {
    for (let i = 0; i < 15; i++)
      await fs.writeFile(
        join(f.root, `expired-${i}.md`),
        body("2020-01-01T00:00:00Z", "2020-02-01T00:00:00Z"),
      );
    await indexVault(f.vault, { embeddings: "none", embeddingModel: "unused" });
    expect((await search()).map((hit) => hit.notePath)).toEqual(["_memory/new.md"]);
  });
  it("recalls at the requested business time and preserves supersede as a separate gate", async () => {
    const current = await recalled();
    expect(current.map((doc) => doc.doc_id)).toEqual([f.id("_memory/new.md")]);
    const past = await recalled({ as_of: january });
    expect(past).toMatchObject([
      {
        doc_id: f.id("_memory/old.md"),
        as_of: "2026-01-15T00:00:00.000Z",
        validity: { valid_from: "2026-01-01T00:00:00.000Z", valid_to: "2026-02-01T00:00:00.000Z" },
        properties: { source: "agent", evidence: ["original"] },
      },
    ]);
    await fs.writeFile(
      join(f.root, "_memory", "old.md"),
      body("2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z")
        .replace("status: active", "status: superseded\nsuperseded_reason: Updated")
        .replace("superseded_by: null", "superseded_by: 'obsidian-fs://lab/_memory/new.md'"),
    );
    await indexVault(f.vault, { embeddings: "none", embeddingModel: "unused" });
    expect(await recalled({ as_of: january })).toEqual([]);
    expect(
      (await recalled({ as_of: january, include_superseded: true })).map((doc) => doc.doc_id),
    ).toEqual([f.id("_memory/old.md")]);
  });
  it("diagnoses invalid imported dates without treating them as open intervals", async () => {
    await fs.writeFile(join(f.root, "invalid.md"), body("2026-02-30T00:00:00Z"));
    await indexVault(f.vault, { embeddings: "none", embeddingModel: "unused" });
    expect(f.vault.db.notes.getByPath("invalid.md")).toMatchObject({
      validity_error: "valid_from",
    });
    expect((await search({ topK: 20 })).map((hit) => hit.notePath)).not.toContain("invalid.md");
    await expect(
      getDocumentBundle(
        { manager: f.manager, sourceConnectorFor: () => f.source },
        { doc_id: f.id("invalid.md"), ...{ as_of: now } },
      ),
    ).rejects.toThrow("invalid_validity");
  });
  it("rejects invalid MemoryContract bounds and preserves mandatory observed_at", () => {
    const properties = {
      source: "agent",
      confidence: "direct",
      evidence: ["original"],
      status: "active",
      observed_at: now,
      superseded_by: null,
      type: "observation",
      valid_from: "2026-02-30T00:00:00Z",
    };
    expect(DEFAULT_MEMORY_V1.propertiesSchema.safeParse(properties).success).toBe(false);
    expect(
      DEFAULT_MEMORY_V1.propertiesSchema.safeParse({
        ...properties,
        valid_from: "2026-01-01T00:00:00Z",
        valid_to: "2026-01-01T00:00:00Z",
      }).success,
    ).toBe(false);
    expect(DEFAULT_MEMORY_V1.requiredKeys).toContain("observed_at");
  });
  it("inherits document validity and permits explicit statement bounds without provenance overrides", async () => {
    const explicit =
      '- [decision] January exception <!-- validity: {"valid_from":"2026-01-01T00:00:00Z","valid_to":"2026-02-01T00:00:00Z"} -->\n';
    expect(parseObservations(explicit)).toMatchObject([
      {
        text: "January exception",
        validity: { valid_from: "2026-01-01T00:00:00.000Z", valid_to: "2026-02-01T00:00:00.000Z" },
      },
    ]);
    await fs.writeFile(
      join(f.root, "statement.md"),
      body("2026-01-01T00:00:00Z", undefined, explicit),
    );
    await indexVault(f.vault, { embeddings: "none", embeddingModel: "unused" });
    const result = await getDocumentBundle(
      { manager: f.manager, sourceConnectorFor: () => f.source },
      { doc_id: f.id("statement.md"), include_observations: true, ...{ as_of: now } },
    );
    expect(result.observations!.statements).toMatchObject([
      {
        text: "Budget rule",
        validity_origin: "inherited",
        properties: { source: "agent", evidence: ["original"] },
      },
    ]);
    const past = await getDocumentBundle(
      { manager: f.manager, sourceConnectorFor: () => f.source },
      { doc_id: f.id("statement.md"), include_observations: true, ...{ as_of: january } },
    );
    expect(past.observations!.statements.map((row) => row.text)).toEqual([
      "Budget rule",
      "January exception",
    ]);
    expect(past.observations!.statements[1]).toMatchObject({
      validity_origin: "explicit",
      as_of: "2026-01-15T00:00:00.000Z",
    });
  });
});
