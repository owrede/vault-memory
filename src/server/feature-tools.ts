import { inspectSchema, type InspectSchemaDeps } from "../schema/inspect.js";
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
  schema_inspection: {
    name: "inspect_schema",
    description:
      "Schema inspection module v1: read-only candidate profiles, explicit MemoryContract validation and drift. Never changes contracts or provenance.",
    schema: z.object({
      mode: z.enum(["infer", "validate", "diff"]),
      doc_ids: z.array(z.string().min(1)),
      contract: z.string().min(1).optional(),
      strict: z.boolean().optional().default(false),
    }),
  },
} as const;
export interface FeatureToolDeps {
  adapterRegistry: AdapterRegistry;
  resolveSchemaContract?: InspectSchemaDeps["resolveContract"];
  onBeforeWrite?: (id: DocId) => void;
  onAfterWrite?: (id: DocId) => Promise<void>;
}
export function registerFeatureTools(
  server: McpServer,
  deps: FeatureToolDeps,
  features: readonly string[],
): void {
  if (features.includes("schema_inspection")) {
    const tool = FEATURE_TOOLS.schema_inspection;
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema.shape,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) => {
        try {
          return ok(
            await inspectSchema(tool.schema.parse(input), {
              adapterRegistry: deps.adapterRegistry,
              resolveContract: deps.resolveSchemaContract,
            }),
          );
        } catch (error) {
          return errorResponse(errorMessage(error));
        }
      },
    );
  }
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
        const result = await applyDocumentPatch(
          {
            source: deps.adapterRegistry.resolveSource(handle),
            delivery: deps.adapterRegistry.resolveDelivery(handle),
            onBeforeWrite: () => deps.onBeforeWrite?.(id),
          },
          { ...args, doc_id: id },
        );
        if (result.ok && result.newHash !== args.expected_hash && deps.onAfterWrite) {
          try {
            await deps.onAfterWrite(id);
          } catch (error) {
            // The canonical edit succeeded. Report refresh failure honestly;
            // invalidated derived data is repairable by normal indexing.
            return ok({ ...result, index_refresh: "pending", warning: errorMessage(error) });
          }
        }
        return ok(result);
      } catch (error) {
        return errorResponse(errorMessage(error));
      }
    },
  );
}
