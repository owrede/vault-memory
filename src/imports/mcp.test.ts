import { expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createVaultFixture } from "../../tests/helpers/vault-fixture.js";
import { registerFeatureTools } from "../server/feature-tools.js";
it("exposes opt-in preview, commit and promotion tools without changing baseline tools", async () => {
  const f = await createVaultFixture({ memorySink: true }),
    server = new McpServer({ name: "import-test", version: "1" }),
    client = new Client({ name: "import-test", version: "1" });
  try {
    server.registerTool("baseline", { inputSchema: {} }, async () => ({
      content: [{ type: "text", text: "baseline" }],
    }));
    registerFeatureTools(
      server,
      {
        adapterRegistry: f.adapterRegistry,
        session: { ...f, sourceConnectorFor: () => f.source, deliveryAdapterFor: () => f.delivery },
      },
      ["conversation_import"],
    );
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name)).toEqual([
      "baseline",
      "preview_conversation_import",
      "commit_conversation_import",
      "promote_conversation",
    ]);
    const result = await client.callTool({
      name: "preview_conversation_import",
      arguments: {
        conversations: [
          {
            provider: "neutral",
            external_id: "mcp1",
            messages: [{ id: "m1", role: "user", text: "Evidence" }],
          },
        ],
        target: "obsidian-fs://lab/imports/",
        imported_at: "2026-10-03T10:00:00Z",
      },
    });
    expect(result.isError).not.toBe(true);
    const manifest = JSON.parse((result.content as { text: string }[])[0]!.text);
    expect(manifest.items).toHaveLength(1);
    expect(f.vault.db.audit.listWrites()).toHaveLength(0);
    const committed = await client.callTool({
      name: "commit_conversation_import",
      arguments: { manifest },
    });
    expect(JSON.parse((committed.content as { text: string }[])[0]!.text).ok).toBe(true);
    expect(f.vault.db.audit.listWrites()).toHaveLength(1);
  } finally {
    await client.close();
    await server.close();
    await f.cleanup();
  }
});
