import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createVaultFixture } from "../../tests/helpers/vault-fixture.js";
import { makeAssemblyHandlers } from "./handlers/assembly.js";
import { TOOLS, TOOL_SCHEMAS } from "../tool-registry.js";
import { indexVault } from "../indexer/indexer.js";
import { OllamaClient } from "../ollama/index.js";
import { ok, errorResponseJson } from "./responses.js";
import { ProjectionError } from "../assembly/selection.js";
import { z } from "zod";

describe("v2 assembly projection through MCP", () => {
  let f: Awaited<ReturnType<typeof createVaultFixture>>;
  let server: McpServer;
  let client: Client;
  beforeEach(async () => {
    f = await createVaultFixture();
    await fs.writeFile(
      join(f.root, "a.md"),
      "---\ntype: Project\n---\n# A\nSECRET\n## B\nWanted\n",
    );
    await fs.writeFile(join(f.root, "link.md"), "[[a]]\n" + "LINK_BODY_SECRET".repeat(30));
    await indexVault(f.vault, { embeddingModel: "unused", embeddings: "none" });
    server = new McpServer({ name: "projection-test", version: "1" });
    client = new Client({ name: "test-client", version: "1" });
    const handlers = makeAssemblyHandlers({
      manager: f.manager,
      adapterRegistry: f.adapterRegistry,
      ollama: new OllamaClient(),
      defaultModel: "unused",
    });
    for (const name of ["get_document_bundle", "assemble_dossier"] as const) {
      server.registerTool(name, { inputSchema: TOOL_SCHEMAS[name] }, async (args) => {
        try {
          return ok(await handlers[name]!(args));
        } catch (error) {
          if (error instanceof ProjectionError)
            return errorResponseJson({ error: error.code, heading_path: error.heading_path });
          throw error;
        }
      });
    }
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
  });
  afterEach(async () => {
    await client.close();
    await server.close();
    await f.cleanup();
  });
  async function call(arguments_: object) {
    const response = await client.callTool({
      name: "get_document_bundle",
      arguments: { doc_id: f.id("a.md"), ...arguments_ },
    });
    return { response, text: (response.content as { text: string }[])[0]!.text };
  }
  it("publishes additive projection options and transmits a smaller metadata response", async () => {
    const listed = (await client.listTools()).tools;
    expect(listed[0]!.inputSchema.properties).toHaveProperty("projection");
    const full = await call({});
    const metadata = await call({ projection: "metadata" });
    expect(metadata.text).not.toContain("LINK_BODY_SECRET");
    expect(metadata.text.length).toBeLessThan(full.text.length);
    const selected = JSON.parse(
      (await call({ projection: "sections", heading_paths: [["A", "B"]], max_chars: 4 })).text,
    );
    expect(selected.context.slices[0]).toMatchObject({
      text: "Want",
      truncated: true,
      doc_id: f.id("a.md"),
      source_handle: f.source.handle,
      hash: (await f.source.readDocument(f.id("a.md"))).hash,
    });
    expect(Object.keys(selected.context.slices[0])).toEqual(
      expect.arrayContaining(["title", "heading_path", "mtime", "display_url", "properties"]),
    );
    const bad = await call({ projection: "sections", heading_paths: [["Missing"]] });
    expect(bad.response.isError).toBe(true);
    expect(JSON.parse(bad.text)).toMatchObject({ error: "target_not_found" });
  });
  it("preserves the separately frozen original 23 names and both input-schema representations", async () => {
    const frozen = JSON.parse(
      await fs.readFile(
        new URL("../../evals/v1-baseline/original-v1-tools.snapshot.json", import.meta.url),
        "utf8",
      ),
    );
    expect({
      tools: TOOLS.slice(0, 23),
      schemas: TOOLS.slice(0, 23).map((t) => ({
        name: t.name,
        inputSchema: z.toJSONSchema(z.object(TOOL_SCHEMAS[t.name]), { target: "draft-7" }),
      })),
    }).toEqual(frozen);
  });
});
