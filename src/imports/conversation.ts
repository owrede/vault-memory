import { z } from "zod";
import { timestampMillis } from "../memory/valid-time.js";
const identity = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !/[\r\n\u0000]/.test(value), "Identity must be a single line");
export const ConversationSchema = z
  .object({
    provider: identity,
    external_id: identity,
    messages: z
      .array(
        z
          .object({
            id: identity,
            role: z.enum(["user", "assistant", "system", "tool"]),
            text: z.string().max(2000000),
            at: z
              .string()
              .refine((v) => timestampMillis(v) !== null, "Invalid message timestamp")
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(10000),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (new Set(c.messages.map((m) => m.id)).size !== c.messages.length)
      ctx.addIssue({ code: "custom", message: "Duplicate message ID" });
  });
export type Conversation = z.infer<typeof ConversationSchema>;
export class ImportError extends Error {
  constructor(
    readonly code: "unsupported_format" | "invalid_conversation" | "invalid_manifest",
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "ImportError";
  }
}
export function parseConversation(json: unknown, format: "neutral" | "chatgpt"): Conversation[] {
  if (format !== "neutral")
    throw new ImportError(
      "unsupported_format",
      "Only neutral-v1 is supported; no verified provider export schema is registered.",
    );
  const result = z.array(ConversationSchema).min(1).max(10000).safeParse(json);
  if (!result.success)
    throw new ImportError(
      "invalid_conversation",
      "Expected neutral conversation array with unique IDs, supported text messages and optional explicit ISO timestamps.",
    );
  const ids = result.data.map((c) => JSON.stringify([c.provider, c.external_id]));
  if (new Set(ids).size !== ids.length)
    throw new ImportError("invalid_conversation", "Duplicate conversation identity");
  return result.data;
}
export function renderConversation(c: Conversation): string {
  const checked = ConversationSchema.parse(c);
  return (
    "# Conversation " +
    checked.external_id +
    "\n" +
    checked.messages
      .map(
        (m) =>
          "\n## " +
          m.id +
          " · " +
          m.role +
          "\n\n" +
          (m.at ? "Time: " + m.at + "\n\n" : "") +
          m.text +
          "\n",
      )
      .join("")
  );
}
