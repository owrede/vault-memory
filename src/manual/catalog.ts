import { z } from "zod";
import { TOOLS } from "../tool-registry.js";
import { FEATURE_TOOLS, FEATURE_TOOL_GROUPS } from "../server/feature-tools.js";
const mutations = new Set([
  "write_note",
  "update_frontmatter",
  "delete_note",
  "start_shadow_index",
  "switch_active_model",
  "vacuum_embeddings",
  "record_observation",
  "record_checkpoint",
  "commit_conversation_import",
  "promote_conversation",
  "import-commit",
  "promote-conversation",
  "session-checkpoint",
  "supersede",
  "compile_brief",
  "register_contracts_as_tools",
  "instantiate_contract",
  "edit_document",
  "edit",
  "index",
  "add-vault",
]);
export function operationAnnotations(name: string) {
  const readOnlyHint = !mutations.has(name);
  return {
    readOnlyHint,
    destructiveHint: [
      "delete_note",
      "vacuum_embeddings",
      "write_note",
      "update_frontmatter",
      "edit_document",
      "edit",
      "supersede",
      "compile_brief",
      "commit_conversation_import",
      "import-commit",
    ].includes(name),
    idempotentHint:
      readOnlyHint ||
      [
        "record_checkpoint",
        "session-checkpoint",
        "commit_conversation_import",
        "import-commit",
      ].includes(name),
    openWorldHint: ["register_contracts_as_tools", "instantiate_contract"].includes(name),
  };
}
export function manualTopic(topic: string) {
  const tool = TOOLS.find((t) => t.name === topic);
  const feature = [
    ...Object.entries(FEATURE_TOOLS),
    ...Object.entries(FEATURE_TOOL_GROUPS).flatMap(([feature, tools]) =>
      tools.map((tool) => [feature, tool] as const),
    ),
  ].find(([, t]) => t.name === topic);
  const cli: Record<string, string> = {
    "session-start":
      "Read existing brief context. session start --vault V --topic T [--sink S] [--max-chars N] [--as-of ISO] --json; requires session_lifecycle.",
    "session-checkpoint":
      "Record explicit idempotent summary. session checkpoint --input FILE --json; requires session_lifecycle and an existing sink.",
    "import-preview":
      "Preview supported neutral-v1 conversations without writing: import --format neutral --input FILE --target SOURCE_FOLDER --json. Requires conversation_import.",
    "import-commit":
      "Commit reviewed import manifest with expected source hashes: import --commit MANIFEST --json. Requires conversation_import.",
    "promote-conversation":
      "Explicitly record selected messages as agent evidence: promote-conversation --input FILE --json. Requires conversation_import.",
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
