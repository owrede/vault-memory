import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createVaultFixture } from "../../tests/helpers/vault-fixture.js";
import { registerFeatureTools } from "./feature-tools.js";

describe("opt-in feature MCP surface", () => {
  let f: Awaited<ReturnType<typeof createVaultFixture>>;
  let server: McpServer;
  let client: Client;
  beforeEach(async () => {
    f = await createVaultFixture();
    server = new McpServer({ name: "feature-test", version: "2.4.1" });
    server.registerTool("baseline_read", { inputSchema: {} }, async () => ({
      content: [{ type: "text", text: "baseline" }],
    }));
    client = new Client({ name: "feature-client", version: "1" });
  });
  afterEach(async () => {
    await client.close();
    await server.close();
    await f.cleanup();
  });
  async function connect(features: string[]) {
    registerFeatureTools(server, { adapterRegistry: f.adapterRegistry }, features);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
  }
  it("keeps optional tools absent by default", async () => {
    await connect([]);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["baseline_read"]);
  });
  it("registers one versioned edit tool and executes a real file edit", async () => {
    const id = f.id("example.md");
    const created = await f.delivery.write(id, {
      blocks: [{ kind: "paragraph", text: "Original" }],
    });
    if (!created.ok) throw new Error("fixture creation failed");
    await connect(["document_edit", "document_edit"]);
    const listed = (await client.listTools()).tools;
    expect(listed.map((t) => t.name)).toEqual(["baseline_read", "edit_document"]);
    expect(listed.find((t) => t.name === "edit_document")?.description).toContain("v1");
    expect(listed.find((t) => t.name === "edit_document")).toMatchSnapshot(
      "document_edit module v1",
    );
    const response = await client.callTool({
      name: "edit_document",
      arguments: {
        doc_id: id,
        expected_hash: created.newHash,
        patch: { kind: "replace", old_text: "Original", new_text: "Edited" },
      },
    });
    expect(response.isError).not.toBe(true);
    const content = response.content as { text: string }[];
    expect(JSON.parse(content[0]!.text)).toMatchObject({ ok: true, doc_id: id });
    expect((await f.source.readDocument(id)).blocks).toEqual([
      { kind: "paragraph", text: "Edited" },
    ]);
  });
});
