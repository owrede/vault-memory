import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { DocId } from "../types.js";
import { z } from "zod";
import { decomposeDocId, parseDocId, parseSourceHandle } from "../adapters/registry.js";
import { applyDocumentPatch } from "../edit/apply.js";
import { ok, errorResponse } from "./responses.js";
import { errorMessage } from "../errors/format.js";

export const FEATURE_TOOLS = {
  document_edit: {
    name: "edit_document",
    description:
      "Document edit module v1: replace one unique text occurrence or a heading section. Requires the hash read by the caller; preserves document locks and provenance.",
    schema: z.object({
      doc_id: z.string().min(1),
      expected_hash: z.string().min(1),
      patch: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("replace"), old_text: z.string().min(1), new_text: z.string() }),
        z.object({
          kind: z.literal("section"),
          heading_path: z.array(z.string().min(1)).min(1),
          content: z.string(),
        }),
      ]),
    }),
  },
} as const;
export interface FeatureToolDeps {
  adapterRegistry: AdapterRegistry;
  onBeforeWrite?: (id: DocId) => void;
}
export function registerFeatureTools(
  server: McpServer,
  deps: FeatureToolDeps,
  features: readonly string[],
): void {
  if (!features.includes("document_edit")) return;
  const tool = FEATURE_TOOLS.document_edit;
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.schema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const args = tool.schema.parse(input);
        const id = parseDocId(args.doc_id);
        const { scheme, authority } = decomposeDocId(id);
        const handle = parseSourceHandle(`${scheme}://${authority}`);
        return ok(
          await applyDocumentPatch(
            {
              source: deps.adapterRegistry.resolveSource(handle),
              delivery: deps.adapterRegistry.resolveDelivery(handle),
              onBeforeWrite: () => deps.onBeforeWrite?.(id),
            },
            { ...args, doc_id: id },
          ),
        );
      } catch (error) {
        return errorResponse(errorMessage(error));
      }
    },
  );
}
