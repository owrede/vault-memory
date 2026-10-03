import { parseDocId, decomposeDocId } from "../../registry.js";
/** This importer publishes Markdown sources through the Obsidian filesystem adapter. */
export function formatConversationDestination(folder: string, identity: string): string {
  const { scheme, resource } = decomposeDocId(parseDocId(folder));
  if (
    scheme !== "obsidian-fs" ||
    !resource.endsWith("/") ||
    resource.split("/").some((p) => p === "." || p === "..") ||
    !/^[a-f0-9]{64}$/.test(identity)
  )
    throw new Error("Unsupported or unsafe conversation source folder");
  return folder + "conversation-" + identity + ".md";
}
