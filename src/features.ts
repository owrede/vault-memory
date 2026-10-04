/** Explicitly enabled, separately versioned extensions to the base tool catalog. */
export const FEATURE_NAMES = [
  "document_edit",
  "schema_inspection",
  "session_lifecycle",
  "conversation_import",
] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];
