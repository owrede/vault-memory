/**
 * Schema-inference module — public API for the `suggest_frontmatter`
 * MCP tool.
 *
 * Pipeline:
 *   inferFromFolder      — folder-convention prevalence + dominant values
 *   inferFromNeighbors   — wikilink-neighborhood prevalence + dominant values
 *   inferFromContent     — title/body pattern matchers (deterministic rules)
 *   combineSuggestions   — merge the three, resolve conflicts, classify as
 *                          existing / suggestions / conflicts
 *
 * Each layer returns a confidence in [0, 1]; the combiner uses the MAX
 * across sources when more than one agrees, and emits a conflict entry
 * when sources disagree on a value for the same key.
 */

export { inferFromFolder, folderOf } from "./folder-conventions.js";
export type { FolderConventionEntry, FolderConventionResult } from "./folder-conventions.js";

export { inferFromNeighbors } from "./neighbor-inference.js";
export type { NeighborInferenceEntry, NeighborInferenceResult } from "./neighbor-inference.js";

export { inferFromContent } from "./content-heuristics.js";
export type { ContentHeuristicEntry, ContentHeuristicResult } from "./content-heuristics.js";

export { suggestFrontmatter, combineSuggestions } from "./combiner.js";
export type {
  FrontmatterSuggestion,
  FrontmatterConflict,
  FrontmatterExisting,
  SuggestFrontmatterResult,
  SuggestFrontmatterInput,
} from "./combiner.js";
