import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MANUAL_TEMPLATE } from "../resource-registry.js";
import { manualTopic } from "./catalog.js";
export function registerManualResources(server: McpServer): void {
  server.registerResource(
    "manual",
    new ResourceTemplate(MANUAL_TEMPLATE.uriTemplate, { list: undefined }),
    { description: MANUAL_TEMPLATE.description, mimeType: "application/json" },
    async (uri, variables) => {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(manualTopic(String(variables.topic))),
          },
        ],
      };
    },
  );
}
