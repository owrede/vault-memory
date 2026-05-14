/**
 * Combiner — fuses folder-conventions, neighbor-inference, and content-
 * heuristics into a single structured suggestion bundle.
 *
 * Output shape (per the v0.10.0 contract):
 *
 *   {
 *     existing: [...],     // keys already present in the note's frontmatter
 *     suggestions: [...],  // new keys with one agreed value (highest confidence)
 *     conflicts: [...]     // keys where sources disagree (existing or new)
 *   }
 *
 * Confidence calibration per source:
 *   - folder:    raw prevalence (already in [0, 1])
 *   - neighbor:  prevalence × 0.6  (dampened — indirect signal)
 *   - content:   fixed per rule (0.5 / 0.7 / 0.85 → see content-heuristics)
 */

import type { Vault } from "../vault/index.js";
import { inferFromFolder, type FolderConventionResult } from "./folder-conventions.js";
import { inferFromNeighbors, type NeighborInferenceResult } from "./neighbor-inference.js";
import { inferFromContent, type ContentHeuristicResult } from "./content-heuristics.js";

const NEIGHBOR_DAMPING = 0.6;
const MIN_PRESENTATION_CONFIDENCE = 0.2;

export type SourceTag = "folder" | "neighbor" | "content";

export interface FrontmatterExisting {
  key: string;
  value: unknown;
}

export interface FrontmatterSuggestion {
  key: string;
  /** Suggested value. `null` means "key only, no concrete value" — agent
   *  should ask the user to fill it in. */
  suggestedValue: unknown | null;
  /** Combined confidence (max across sources that agreed). */
  confidence: number;
  /** Which sources contributed (in order of confidence DESC). */
  sources: SourceTag[];
  /**
   * Optional rule name for content-heuristics matches (helps the user
   * understand why something was suggested).
   */
  rule?: string;
}

export interface FrontmatterConflict {
  key: string;
  /**
   * Each candidate value, with its source and confidence. The agent (or
   * user) picks one explicitly.
   */
  candidates: Array<{
    value: unknown;
    source: SourceTag | "existing";
    confidence: number;
    rule?: string;
  }>;
}

export interface SuggestFrontmatterInput {
  vault: Vault;
  /**
   * The note's vault-relative path. May NOT yet exist in the DB — the
   * folder learner uses the path prefix, the neighbor learner uses
   * additionalForwardTargets (parsed from content).
   */
  path: string;
  /** Optional existing frontmatter on the note. Used for the `existing`
   *  classification and conflict detection. */
  existingFrontmatter?: Record<string, unknown> | null;
  /** Optional content for the heuristics layer. If omitted, the layer
   *  is skipped (only folder + neighbor remain). */
  content?: string;
  /** Title (for content-heuristics). Falls back to the basename. */
  title?: string;
  /** Wikilink targets parsed from the (possibly draft) content. Used by
   *  neighbor-inference when the note isn't indexed yet. */
  draftWikilinkTargets?: string[];
  /** Optional path to exclude from folder inference. Defaults to `path`. */
  excludePath?: string | null;
}

export interface SuggestFrontmatterResult {
  /** Keys already present in the note's frontmatter (no conflict). */
  existing: FrontmatterExisting[];
  /** New (or value-clarifying) suggestions, sorted by confidence DESC. */
  suggestions: FrontmatterSuggestion[];
  /** Disagreements between sources, or existing-vs-suggestion mismatches. */
  conflicts: FrontmatterConflict[];
  /** Diagnostic info — useful when the agent wants to explain the result. */
  diagnostics: {
    folder: FolderConventionResult;
    neighbor: NeighborInferenceResult;
    content: ContentHeuristicResult;
  };
}

interface Candidate {
  source: SourceTag;
  value: unknown | null;
  confidence: number;
  rule?: string;
}

/**
 * Stable canonical string for value comparison. Arrays preserved in order;
 * objects key-sorted. Mirrors the canonical-JSON convention used elsewhere
 * in the codebase (reader/hash.ts) for the same reason: equality must be
 * robust to JS object-property order quirks.
 */
function valueKey(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) {
    return "[" + v.map(valueKey).join(",") + "]";
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + valueKey(obj[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

/**
 * Core orchestration entrypoint. Runs all three learners and combines
 * their output into the structured response.
 */
export function suggestFrontmatter(input: SuggestFrontmatterInput): SuggestFrontmatterResult {
  const title = input.title ?? defaultTitleFromPath(input.path);

  const folder = inferFromFolder(input.vault, input.path, {
    excludePath: input.excludePath ?? input.path,
  });
  const neighbor = inferFromNeighbors(input.vault, input.path, input.draftWikilinkTargets ?? []);
  const content =
    input.content !== undefined
      ? inferFromContent({ title, body: input.content })
      : { entries: [], matchedRules: [] };

  return combineSuggestions({
    existingFrontmatter: input.existingFrontmatter ?? null,
    folder,
    neighbor,
    content,
  });
}

function defaultTitleFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}

/**
 * Pure combiner — exposed separately so unit tests can construct
 * synthetic inputs without spinning up a vault.
 */
export function combineSuggestions(args: {
  existingFrontmatter: Record<string, unknown> | null;
  folder: FolderConventionResult;
  neighbor: NeighborInferenceResult;
  content: ContentHeuristicResult;
}): SuggestFrontmatterResult {
  const { existingFrontmatter, folder, neighbor, content } = args;

  // Build a `key -> candidates[]` map from the three sources.
  const candidates = new Map<string, Candidate[]>();

  const push = (key: string, c: Candidate): void => {
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key)!.push(c);
  };

  // Folder layer.
  for (const e of folder.entries) {
    if (e.prevalence < MIN_PRESENTATION_CONFIDENCE) continue;
    push(e.key, {
      source: "folder",
      value: e.dominantValue,
      confidence: e.prevalence,
    });
  }

  // Neighbor layer (dampened).
  for (const e of neighbor.entries) {
    const conf = e.prevalence * NEIGHBOR_DAMPING;
    if (conf < MIN_PRESENTATION_CONFIDENCE) continue;
    push(e.key, {
      source: "neighbor",
      value: e.dominantValue,
      confidence: conf,
    });
  }

  // Content layer.
  for (const e of content.entries) {
    push(e.key, {
      source: "content",
      value: e.value,
      confidence: e.confidence,
      rule: e.rule,
    });
  }

  const existing: FrontmatterExisting[] = [];
  const suggestions: FrontmatterSuggestion[] = [];
  const conflicts: FrontmatterConflict[] = [];

  const fm = existingFrontmatter ?? {};
  const existingKeys = new Set(Object.keys(fm));

  // Process each key from candidates + every existing key (so existing
  // keys that no source touched still land in `existing`).
  const allKeys = new Set<string>([...candidates.keys(), ...existingKeys]);

  for (const key of allKeys) {
    const cands = candidates.get(key) ?? [];
    const existingValue = existingKeys.has(key) ? fm[key] : undefined;
    const hasExisting = existingValue !== undefined;
    const existingValueKey = hasExisting ? valueKey(existingValue) : null;

    // Group candidates by value-key to find disagreement and combine
    // confidence within an agreed value.
    const byValue = new Map<string, Candidate[]>();
    for (const c of cands) {
      if (c.value === null) {
        // Null value means "key only". Bucket separately so it doesn't
        // collide with a concrete-value candidate.
        const k = "__keyonly__";
        if (!byValue.has(k)) byValue.set(k, []);
        byValue.get(k)!.push(c);
      } else {
        const k = valueKey(c.value);
        if (!byValue.has(k)) byValue.set(k, []);
        byValue.get(k)!.push(c);
      }
    }

    const distinctValueCount = Array.from(byValue.keys()).filter((k) => k !== "__keyonly__").length;

    if (hasExisting) {
      // Anything in candidates that disagrees with the existing value is
      // a conflict; anything that agrees is silently absorbed.
      const agreeingBucket = byValue.get(existingValueKey!);
      if (agreeingBucket) {
        // Existing is corroborated. Drop the agreeing candidate, treat as
        // pure existing.
        byValue.delete(existingValueKey!);
      }
      const disagreeingValues = Array.from(byValue.entries()).filter(([k]) => k !== "__keyonly__");
      if (disagreeingValues.length === 0) {
        // No conflict — existing stays as-is.
        existing.push({ key, value: existingValue });
      } else {
        // Conflict between existing and one or more inferred values.
        const candidatesList: FrontmatterConflict["candidates"] = [
          {
            value: existingValue,
            source: "existing",
            confidence: 1.0,
          },
        ];
        for (const [, group] of disagreeingValues) {
          const best = pickBestCandidate(group);
          candidatesList.push({
            value: best.value,
            source: best.source,
            confidence: best.confidence,
            ...(best.rule ? { rule: best.rule } : {}),
          });
        }
        conflicts.push({ key, candidates: candidatesList });
      }
    } else {
      // No existing value — emit a suggestion or a conflict between
      // disagreeing inference sources.
      if (distinctValueCount > 1) {
        // Sources disagree on the value. Emit a conflict.
        const candidatesList: FrontmatterConflict["candidates"] = [];
        for (const [k, group] of byValue) {
          if (k === "__keyonly__") continue;
          const best = pickBestCandidate(group);
          candidatesList.push({
            value: best.value,
            source: best.source,
            confidence: best.confidence,
            ...(best.rule ? { rule: best.rule } : {}),
          });
        }
        // Sort candidates by confidence DESC for stable agent UX.
        candidatesList.sort((a, b) => b.confidence - a.confidence);
        conflicts.push({ key, candidates: candidatesList });
      } else if (distinctValueCount === 1) {
        // All sources that suggest a value agree. Pick the best one,
        // combine confidence by max.
        const [valueKeyStr, group] = Array.from(byValue.entries()).find(
          ([k]) => k !== "__keyonly__",
        )!;
        const best = pickBestCandidate(group);
        const sources = uniqueSources(group);
        suggestions.push({
          key,
          suggestedValue: best.value,
          confidence: best.confidence,
          sources,
          ...(best.rule ? { rule: best.rule } : {}),
        });
        void valueKeyStr;
      } else {
        // Only key-only candidates (no concrete value). Suggest the key
        // with `suggestedValue: null` — agent should ask user to fill in.
        const group = byValue.get("__keyonly__")!;
        const best = pickBestCandidate(group);
        suggestions.push({
          key,
          suggestedValue: null,
          confidence: best.confidence,
          sources: uniqueSources(group),
        });
      }
    }
  }

  // Stable sorting for the response: suggestions DESC by confidence,
  // conflicts ASC by key (no clear order signal there).
  suggestions.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.key.localeCompare(b.key);
  });
  conflicts.sort((a, b) => a.key.localeCompare(b.key));
  existing.sort((a, b) => a.key.localeCompare(b.key));

  return {
    existing,
    suggestions,
    conflicts,
    diagnostics: { folder, neighbor, content },
  };
}

function pickBestCandidate(group: Candidate[]): Candidate {
  // Callers always pass at least one candidate — the `if (group)` check
  // above gates this. Defensive throw rather than non-null-assertion
  // keeps the failure mode loud if the invariant ever breaks.
  if (group.length === 0) {
    throw new Error("pickBestCandidate called with empty group");
  }
  let best: Candidate = group[0]!;
  for (const c of group) {
    if (c.confidence > best.confidence) best = c;
  }
  return best;
}

function uniqueSources(group: Candidate[]): SourceTag[] {
  const seen = new Set<SourceTag>();
  const out: SourceTag[] = [];
  // Order: by confidence DESC.
  const sorted = [...group].sort((a, b) => b.confidence - a.confidence);
  for (const c of sorted) {
    if (seen.has(c.source)) continue;
    seen.add(c.source);
    out.push(c.source);
  }
  return out;
}
