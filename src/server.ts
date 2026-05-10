/**
 * MCP server entrypoint. Wires tool handlers to the MCP SDK.
 *
 * Phase 1: minimal stub that responds to MCP protocol handshake +
 * the `list_vaults` tool, so we can verify wiring against Claude Code
 * before the modules below are complete.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const VERSION = "0.1.0";

export async function serve(): Promise<void> {
  const server = new Server(
    {
      name: "vault-memory",
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_vaults",
        description: "List configured vaults with status info.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;

    switch (name) {
      case "list_vaults":
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  vaults: [],
                  note: "vault-memory v0.1.0 stub — config loader not yet wired",
                },
                null,
                2,
              ),
            },
          ],
        };

      default:
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Unknown tool: ${name}`,
            },
          ],
        };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
