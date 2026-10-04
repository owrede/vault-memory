import { expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createVaultFixture } from "../../tests/helpers/vault-fixture.js";
import { registerFeatureTools } from "../server/feature-tools.js";
it("registers lifecycle tools only when enabled and records the checkpoint through the shared guarded controller", async () => {
  const f = await createVaultFixture({ memorySink: true }),
    server = new McpServer({ name: "session-test", version: "1" }),
    client = new Client({ name: "session-test", version: "1" });
  try {
    await fs.writeFile(join(f.root, "Source.md"), "Evidence");
    server.registerTool("baseline", { inputSchema: {} }, async () => ({
      content: [{ type: "text", text: "baseline" }],
    }));
    registerFeatureTools(
      server,
      {
        adapterRegistry: f.adapterRegistry,
        session: { ...f, sourceConnectorFor: () => f.source, deliveryAdapterFor: () => f.delivery },
      } as never,
      ["session_lifecycle"],
    );
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name)).toEqual(["baseline", "start_session", "record_checkpoint"]);
    expect(tools[2]?.annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: true,
      destructiveHint: false,
    });
    const result = await client.callTool({
      name: "record_checkpoint",
      arguments: {
        session_id: "mcp",
        event_id: "end",
        sink: "memory",
        summary: "Finished",
        source_doc_ids: [f.id("Source.md")],
        observed_at: "2026-10-03T10:00:00Z",
      },
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse((result.content as { text: string }[])[0]!.text).ok).toBe(true);
    expect(f.vault.db.audit.listWrites({ op: "create" })).toHaveLength(1);
  } finally {
    await client.close();
    await server.close();
    await f.cleanup();
  }
});
