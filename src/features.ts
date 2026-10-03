/** Explicitly enabled, separately versioned extensions to the base tool catalog. */
export const FEATURE_NAMES = ["document_edit", "schema_inspection", "session_lifecycle"] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];
