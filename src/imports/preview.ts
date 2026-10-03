import { createHash } from "node:crypto";
import { parseDocId, decomposeDocId } from "../adapters/registry.js";
import {
  renderConversation,
  parseConversation,
  type Conversation,
  ImportError,
} from "./conversation.js";
export interface ImportPreview {
  source_id: string;
  content: string;
  hash: string;
  target: string;
  conversation: Conversation;
}
export const contentHash = (content: string) =>
  "sha256:" + createHash("sha256").update(content).digest("hex");
export function previewImport(conversations: Conversation[], target: string): ImportPreview[] {
  const parsed = parseDocId(target),
    { resource } = decomposeDocId(parsed);
  if (!resource.endsWith("/") || resource.split("/").some((p) => p === "." || p === ".."))
    throw new ImportError(
      "invalid_manifest",
      "Target must be a safe source-folder DocId ending in /.",
    );
  return parseConversation(conversations, "neutral").map((c) => {
    const identity = createHash("sha256")
        .update(JSON.stringify([c.provider, c.external_id]))
        .digest("hex"),
      content = renderConversation(c);
    return {
      source_id: "conversation:" + identity,
      content,
      hash: contentHash(content),
      target: target + "conversation-" + identity + ".md",
      conversation: c,
    };
  });
}
