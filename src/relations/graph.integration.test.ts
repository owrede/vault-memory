import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createVaultFixture } from "../../tests/helpers/vault-fixture.js";
import { indexVault } from "../indexer/indexer.js";
import { indexNote } from "../indexer/single.js";
import { expand, type ExpandOptions } from "../graph/expand.js";
import { applyDocumentPatch } from "../edit/apply.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TOOL_SCHEMAS } from "../tool-registry.js";
import { makeGraphHandlers } from "../server/handlers/graph.js";
import type { HandlerDeps } from "../server/deps.js";
import { ok } from "../server/responses.js";
describe("domain relations on the real file/SQLite graph", () => {
  let f: Awaited<ReturnType<typeof createVaultFixture>>;
  const oliver =
    "---\nsource: imported\nevidence: [original]\n---\n# Oliver\n## Relations\n- owns [[Atlas#Plan|Roadmap]]\n- manages [[Atlas]]\n- custom_role [[Missing]]\n## Notes\n[[Budget]]\n";
  beforeEach(async () => {
    f = await createVaultFixture();
    await fs.writeFile(join(f.root, "Oliver.md"), oliver);
    await fs.writeFile(
      join(f.root, "Atlas.md"),
      "# Atlas\n## Plan\nPlanning\n## Relations\n- depends_on [[Budget]]\n",
    );
    await fs.writeFile(join(f.root, "Budget.md"), "# Budget\n");
    await indexVault(f.vault, { embeddings: "none", embeddingModel: "unused" });
  });
  afterEach(async () => {
    await f.cleanup();
  });
  const run = (path: string, args: object = {}) =>
    expand({ manager: f.manager, sourceConnectorFor: () => f.source }, {
      seed_doc_ids: [f.id(path)],
      hops: 1,
      ...args,
    } as ExpandOptions);
  const roles = () =>
    f.vault.db.handle
      .prepare(
        "SELECT n.path source, e.rel, e.target_path target, e.anchor, e.line_number line, e.target_doc FROM edges e JOIN notes n ON n.id=e.source_doc WHERE e.rel IS NOT NULL ORDER BY n.path,e.line_number",
      )
      .all();
  it("keeps parallel roles, anchors, source lines and unresolved targets", () => {
    expect(roles()).toMatchObject([
      { source: "Atlas.md", rel: "depends_on", target: "Budget", line: 5 },
      { source: "Oliver.md", rel: "owns", target: "Atlas", anchor: "Plan", line: 3 },
      { source: "Oliver.md", rel: "manages", target: "Atlas", line: 4 },
      { source: "Oliver.md", rel: "custom_role", target: "Missing", line: 5, target_doc: null },
    ]);
  });
  it("distinguishes incoming/outgoing roles and cites the actual declaring source", async () => {
    const outgoing = await run("Oliver.md", { direction: "outgoing", rels: ["owns"] });
    expect(outgoing.documents.map((doc) => doc.doc_id)).toEqual([f.id("Atlas.md")]);
    expect(outgoing.documents[0]!.via).toMatchObject({
      rel: "owns",
      line_number: 3,
      source_doc_id: f.id("Oliver.md"),
      source_hash: (await f.source.readDocument(f.id("Oliver.md"))).hash,
    });
    const incoming = await run("Atlas.md", { direction: "incoming", rels: ["owns"] });
    expect(incoming.documents.map((doc) => doc.doc_id)).toEqual([f.id("Oliver.md")]);
    expect(incoming.documents[0]!.properties).toMatchObject({
      source: "imported",
      evidence: ["original"],
    });
    expect((await run("Atlas.md", { direction: "outgoing", rels: ["owns"] })).documents).toEqual(
      [],
    );
    expect((await run("Oliver.md", { direction: "forward", rels: ["owns"] })).documents).toEqual(
      outgoing.documents,
    );
    expect((await run("Atlas.md", { direction: "backward", rels: ["owns"] })).documents).toEqual(
      incoming.documents,
    );
  });
  it("preserves unfiltered traversal and binds arbitrary role filters safely", async () => {
    expect(
      (await run("Oliver.md", { direction: "forward" })).documents.map((doc) => doc.title).sort(),
    ).toEqual(["Atlas", "Budget"]);
    expect((await run("Atlas.md")).documents.map((doc) => doc.title).sort()).toEqual([
      "Budget",
      "Oliver",
    ]);
    expect(
      (await run("Oliver.md", { direction: "forward", rels: ["owns') OR 1=1 --"] })).documents,
    ).toEqual([]);
    expect((await run("Oliver.md", { direction: "forward", rels: [] })).documents).toEqual([]);
  });
  it("rebuilds deterministically and removes only the removed relation", async () => {
    const before = roles();
    await indexVault(f.vault, { mode: "full", embeddings: "none", embeddingModel: "unused" });
    expect(roles()).toEqual(before);
    await fs.writeFile(
      join(f.root, "Oliver.md"),
      oliver.replace("- owns [[Atlas#Plan|Roadmap]]\n", ""),
    );
    await indexNote({
      vault: f.vault,
      absolutePath: join(f.root, "Oliver.md"),
      embeddings: "none",
      embeddingModel: "unused",
    });
    expect(roles()).toMatchObject([
      { rel: "depends_on" },
      { rel: "manages" },
      { rel: "custom_role" },
    ]);
    expect((await run("Atlas.md", { direction: "backward", rels: ["owns"] })).documents).toEqual(
      [],
    );
  });

  it("uses role filters on every hop and discloses stale declaring sources", async () => {
    expect(
      (
        await run("Oliver.md", { hops: 2, direction: "outgoing", rels: ["owns", "depends_on"] })
      ).documents
        .map((doc) => doc.title)
        .sort(),
    ).toEqual(["Atlas", "Budget"]);
    expect(
      (await run("Oliver.md", { hops: 2, direction: "outgoing", rels: ["owns"] })).documents.map(
        (doc) => doc.title,
      ),
    ).toEqual(["Atlas"]);
    await fs.writeFile(join(f.root, "Oliver.md"), oliver.replace("owns", "leads"));
    const stale = await run("Atlas.md", { direction: "incoming", rels: ["owns"] });
    expect(stale.documents).toEqual([]);
    expect(stale.warnings).toContainEqual({
      seed_doc_id: f.id("Atlas.md"),
      source_doc_id: f.id("Oliver.md"),
      reason: "stale_relation",
    });
    await indexNote({
      vault: f.vault,
      absolutePath: join(f.root, "Oliver.md"),
      embeddings: "none",
      embeddingModel: "unused",
    });
    expect(
      (await run("Atlas.md", { direction: "incoming", rels: ["leads"] })).documents.map(
        (doc) => doc.title,
      ),
    ).toEqual(["Oliver"]);
  });

  it("invalidates ordinary delivery writes and repairs changed role edges on retry", async () => {
    const id = f.id("Oliver.md");
    const original = await f.source.readDocument(id);
    const update = await f.delivery.update(
      id,
      { blocks: [{ kind: "paragraph", text: "# Oliver\n## Relations\n- leads [[Atlas]]\n" }] },
      { expectedHash: original.hash },
    );
    expect(update.ok).toBe(true);
    expect((await run("Oliver.md", { direction: "outgoing", rels: ["owns"] })).documents).toEqual(
      [],
    );
    expect(f.vault.db.notes.getByPath("Oliver.md")!.body_hash).toBeNull();
    await indexNote({
      vault: f.vault,
      absolutePath: join(f.root, "Oliver.md"),
      embeddings: "none",
      embeddingModel: "unused",
    });
    expect(
      (await run("Oliver.md", { direction: "outgoing", rels: ["leads"] })).documents.map(
        (doc) => doc.title,
      ),
    ).toEqual(["Atlas"]);
  });
  it.each([
    "- ```md\n  example\n  ```\n- owns [[Atlas]]\n",
    "- ```md\n  example\n- owns [[Atlas]]\n",
    "```bad`info\n- owns [[Atlas]]\n",
    "- owns [[Atlas # Plan | Roadmap]]\n",
  ])(
    "indexes actual declarations despite legacy wikilink fence/whitespace differences: %s",
    async (body) => {
      await fs.writeFile(join(f.root, "Oliver.md"), "# Relations\n" + body);
      await indexNote({
        vault: f.vault,
        absolutePath: join(f.root, "Oliver.md"),
        embeddings: "none",
        embeddingModel: "unused",
      });
      expect(
        (await run("Oliver.md", { direction: "outgoing", rels: ["owns"] })).documents.map(
          (doc) => doc.title,
        ),
      ).toEqual(["Atlas"]);
    },
  );
  it("refuses edits to locked relation sources without changing graph rows", async () => {
    await fs.writeFile(
      join(f.root, "Oliver.md"),
      oliver.replace("source: imported", "locked: true\nsource: imported"),
    );
    await indexNote({
      vault: f.vault,
      absolutePath: join(f.root, "Oliver.md"),
      embeddings: "none",
      embeddingModel: "unused",
    });
    const before = roles();
    const doc = await f.source.readDocument(f.id("Oliver.md"));
    expect(
      await applyDocumentPatch(
        { source: f.source, delivery: f.delivery },
        {
          doc_id: doc.id,
          expected_hash: doc.hash,
          patch: { kind: "replace", old_text: "owns", new_text: "leads" },
        },
      ),
    ).toMatchObject({ ok: false, reason: "document_locked" });
    expect(roles()).toEqual(before);
  });
  it("exposes and forwards additive role options through the MCP SDK", async () => {
    const server = new McpServer({ name: "relations-test", version: "1" });
    const client = new Client({ name: "test", version: "1" });
    const handlers = makeGraphHandlers({
      manager: f.manager,
      adapterRegistry: f.adapterRegistry,
    } as HandlerDeps);
    server.registerTool("expand", { inputSchema: TOOL_SCHEMAS.expand }, async (args) =>
      ok(await handlers.expand!(args)),
    );
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    try {
      expect((await client.listTools()).tools[0]!.inputSchema.properties).toHaveProperty("rels");
      const response = await client.callTool({
        name: "expand",
        arguments: {
          seed_doc_ids: [f.id("Atlas.md")],
          hops: 1,
          direction: "incoming",
          rels: ["owns"],
        },
      });
      expect(response.isError).not.toBe(true);
      const result = JSON.parse((response.content as { text: string }[])[0]!.text);
      expect(result.documents.map((doc: { doc_id: string }) => doc.doc_id)).toEqual([
        f.id("Oliver.md"),
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
