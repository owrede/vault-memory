import { expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerManualResources } from "./resources.js";
import { RESOURCES } from "../resource-registry.js";
it("advertises manuals only as templates and returns the same versioned catalog", async () => {
  const server = new McpServer({ name: "manual", version: "1" });
  registerManualResources(server);
  const client = new Client({ name: "reader", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    expect(RESOURCES).toHaveLength(13);
    expect((await client.listResources()).resources).toEqual([]);
    expect((await client.listResourceTemplates()).resourceTemplates).toMatchObject([
      { uriTemplate: "vault-memory://man/{topic}" },
    ]);
    const read = await client.readResource({ uri: "vault-memory://man/edit_document" });
    expect(JSON.parse((read.contents[0] as { text: string }).text)).toMatchObject({
      schema_version: 1,
      feature: "document_edit",
    });
  } finally {
    await client.close();
    await server.close();
  }
});
