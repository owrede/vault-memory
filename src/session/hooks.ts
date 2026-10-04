import { z } from "zod";
import { checkpointProperties } from "./checkpoint.js";
import { timestampMillis } from "../memory/valid-time.js";
export const SessionStartSchema = z
  .object({
    vault: z.string().min(1),
    topic: z.string().min(1),
    sink: z.string().min(1).optional(),
    max_chars: z.number().int().min(0).max(1000000).optional(),
    as_of: z
      .string()
      .refine((v) => timestampMillis(v) !== null, "Invalid as_of")
      .optional(),
  })
  .strict();
export const CheckpointSchema = z
  .object({
    session_id: z.string().min(1),
    event_id: z.string().min(1),
    sink: z.string().min(1),
    summary: z.string().min(1).max(12000),
    source_doc_ids: z.array(z.string().min(1)).min(1).max(100),
    observed_at: z.string(),
  })
  .strict()
  .superRefine((input, ctx) => {
    try {
      checkpointProperties(input);
    } catch (error) {
      ctx.addIssue({ code: "custom", message: String(error) });
    }
  });
export const SessionEventSchema = z.discriminatedUnion("event", [
  z
    .object({
      schema_version: z.literal(1),
      event: z.literal("session_start"),
      input: SessionStartSchema,
    })
    .strict(),
  z
    .object({
      schema_version: z.literal(1),
      event: z.literal("session_checkpoint"),
      input: CheckpointSchema,
    })
    .strict(),
]);
export const parseSessionEvent = (input: unknown) => SessionEventSchema.parse(input);
