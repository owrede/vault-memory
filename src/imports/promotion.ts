import { z } from "zod";
import { parseDocId } from "../adapters/registry.js";
import { handleRecordObservation } from "../memory/tools/record-observation.js";
import { importAdapters, importedConversation, type ImportDeps } from "./commit.js";
import { timestampMillis } from "../memory/valid-time.js";
export const PromotionSchema = z
  .object({
    doc_id: z.string().min(1),
    expected_hash: z.string().min(1),
    message_ids: z.array(z.string().min(1)).min(1).max(100),
    claim: z.string().min(1).max(12000),
    mode: z.enum(["quote", "inference"]),
    sink: z.string().min(1),
    observed_at: z.string().refine((v) => timestampMillis(v) !== null),
  })
  .strict();
export type PromotionInput = z.infer<typeof PromotionSchema>;
export async function promoteConversation(input: PromotionInput, deps: ImportDeps) {
  const args = PromotionSchema.parse(input);
  if (!args.claim.trim() || new Set(args.message_ids).size !== args.message_ids.length)
    throw new Error("Invalid promotion claim/message IDs");
  const id = parseDocId(args.doc_id),
    { source } = importAdapters(id, deps),
    doc = await source.readDocument(id);
  if (doc.hash !== args.expected_hash)
    return { ok: false as const, reason: "hash_mismatch", currentHash: doc.hash };
  const conversation = importedConversation(doc),
    messages = args.message_ids.map((messageId) =>
      conversation.messages.find((m) => m.id === messageId),
    );
  if (messages.some((m) => !m)) return { ok: false as const, reason: "message_not_found" };
  const selected = messages.map((m) => m!);
  if (args.mode === "quote" && args.claim !== selected.map((m) => m.text).join("\n\n"))
    return { ok: false as const, reason: "quote_mismatch" };
  const sink = deps.memorySinkRegistry.resolveMemorySink(args.sink);
  return handleRecordObservation(deps, {
    vault: sink.vault,
    sink: sink.handle,
    claim: args.claim,
    type: "observation",
    confidence: args.mode === "quote" ? "direct" : "inferred",
    evidence: selected.map((m) => `${id}#${encodeURIComponent(m.id)}`),
    observed_at: args.observed_at,
    properties: {
      conversation_source_hash: doc.hash,
      conversation_message_ids: args.message_ids,
      conversation_roles: selected.map((m) => m.role),
      promotion_mode: args.mode,
    },
  });
}
