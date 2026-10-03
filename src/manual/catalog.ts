import { z } from "zod";
import { TOOLS } from "../tool-registry.js";
import { FEATURE_TOOLS } from "../server/feature-tools.js";
const mutations = new Set([
  "write_note",
  "update_frontmatter",
  "delete_note",
  "start_shadow_index",
  "switch_active_model",
  "vacuum_embeddings",
  "record_observation",
  "supersede",
  "compile_brief",
  "register_contracts_as_tools",
  "instantiate_contract",
  "edit_document",
  "edit",
  "suggest_frontmatter",
  "index",
  "add-vault",
]);
export function operationAnnotations(name: string) {
  const readOnlyHint = !mutations.has(name);
  return {
    readOnlyHint,
    destructiveHint: ["delete_note", "vacuum_embeddings"].includes(name),
    idempotentHint: readOnlyHint,
    openWorldHint: ["register_contracts_as_tools", "instantiate_contract"].includes(name),
  };
}
export function manualTopic(topic: string) {
  const tool = TOOLS.find((t) => t.name === topic);
  const feature = Object.entries(FEATURE_TOOLS).find(([, t]) => t.name === topic);
  const cli: Record<string, string> = {
    index: "Build or update the derived local index; mutates SQLite and may request embeddings.",
    "add-vault": "Register a vault in local configuration.",
    search: "Search indexed knowledge. --query Q [--vault V] [--as-of ISO] [--json]",
    read: "Read a canonical source. --doc-id ID [--projection full|metadata] [--as-of ISO] [--json]",
    edit: "Apply a targeted patch. --doc-id ID --expected-hash H --patch-file FILE [--json]",
  };
  if (!tool && !feature && !cli[topic]) throw new Error(`Unknown manual topic: ${topic}`);
  return {
    schema_version: 1,
    topic,
    description: tool?.description ?? feature?.[1].description ?? cli[topic],
    input_schema: tool?.inputSchema ?? (feature ? z.toJSONSchema(feature[1].schema) : null),
    annotations: operationAnnotations(topic),
    ...(feature ? { feature: feature[0], activation: `server.features = ["${feature[0]}"]` } : {}),
    ...(topic === "edit_document" || topic === "edit"
      ? {
          conflicts: ["hash_mismatch", "document_locked", "permission_denied"],
          example:
            'vault-memory edit --doc-id "obsidian-fs://main/A.md" --expected-hash HASH --patch-file patch.json --json',
        }
      : {}),
  };
}
