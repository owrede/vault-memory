/**
 * verb-catalog — single source of truth for the palette's plain-language
 * metadata about every verb a contract step can use.
 *
 * Why a separate file from `verb-list.ts`:
 *   `verb-list.ts` carries the COMPILE-TIME closed enum (the partition
 *   that mirrors the Phase 6 verb set from shared-types). It's used by
 *   the verb-list invariant test and by the palette to enumerate
 *   baseline verbs. It contains NO user-facing copy — adding human
 *   strings there would mix two concerns.
 *
 *   This file carries the UI copy: a category bucket per verb, a
 *   plain-language title, a one-line description, a Lucide icon name,
 *   and the default `args` skeleton that the canvas should drop into
 *   the YAML when the user drags the verb in. All UI concerns; no
 *   runtime impact on the orchestrator.
 *
 * Adapter-seam discipline: pure data module. No `obsidian` / `fs`.
 *
 * To add a new baseline verb: extend the Phase 6 closed enum in
 * `shared-types`, add it to verb-list.ts's VERB_CATEGORIES, then add
 * its metadata here. The verb-catalog test enforces that every
 * BASELINE_VERB + `literal` has metadata.
 */

import { BASELINE_VERBS } from "./verb-list.js";

/**
 * Category buckets for palette grouping. These reflect what a user
 * accomplishes with the verb, not the technical surface.
 *
 *   - read-document  : pull content out of a specific note
 *   - search-vault   : find relevant notes across the vault
 *   - navigate-graph : traverse links + clusters
 *   - reference      : reach back into earlier agent work
 *   - compose        : synthesize a new structured artifact
 *   - escape         : literal value or peer-MCP extension
 *
 * Each category has a color hint (an Obsidian CSS variable name) that
 * the canvas node renders as a 4px left border, and a Lucide icon the
 * palette + canvas render at 16x16.
 */
export type VerbCategory =
  | "read-document"
  | "search-vault"
  | "navigate-graph"
  | "reference"
  | "compose"
  | "escape";

export interface VerbCategoryMeta {
  id: VerbCategory;
  /** Section title shown in the palette and on canvas legends. */
  label: string;
  /** Lucide icon name (Obsidian ships Lucide; setIcon(el, name)). */
  icon: string;
  /**
   * Obsidian CSS variable name (resolves under any theme). Used as the
   * 4px left-border color on canvas nodes and the palette section
   * accent.
   */
  colorVar: string;
}

export const VERB_CATEGORY_META: Record<VerbCategory, VerbCategoryMeta> = {
  "read-document": {
    id: "read-document",
    label: "Read a document",
    icon: "file-text",
    colorVar: "--color-blue",
  },
  "search-vault": {
    id: "search-vault",
    label: "Search the vault",
    icon: "search",
    colorVar: "--color-cyan",
  },
  "navigate-graph": {
    id: "navigate-graph",
    label: "Navigate the graph",
    icon: "network",
    colorVar: "--color-purple",
  },
  reference: {
    id: "reference",
    label: "Reference earlier work",
    icon: "history",
    colorVar: "--color-orange",
  },
  compose: {
    id: "compose",
    label: "Compose a new artifact",
    icon: "sparkles",
    colorVar: "--color-green",
  },
  escape: {
    id: "escape",
    label: "Escape-hatch",
    icon: "wrench",
    colorVar: "--text-muted",
  },
};

export interface VerbMeta {
  /** Canonical verb name (matches Phase 6 closed enum / "literal"). */
  verb: string;
  category: VerbCategory;
  /** Plain-language title shown as the primary label. */
  title: string;
  /** One-line description. ~80 chars max. */
  description: string;
  /**
   * Skeleton `args` object dropped into the YAML when the user drags
   * this verb in. Each key maps to a placeholder value (string with a
   * leading `?` so the canvas inspector can highlight it as "fill me").
   *
   * The canvas + inspector are the SOURCE of which fields to render —
   * this is just the starting state.
   */
  defaultArgs: Record<string, unknown>;
}

/**
 * Verb catalog — every baseline verb + `literal` gets a row.
 *
 * Ordering inside a category is alphabetical by `verb` so the palette
 * stays stable across releases.
 */
export const VERB_CATALOG: readonly VerbMeta[] = [
  // ── Read a document ──
  {
    verb: "read_note",
    category: "read-document",
    title: "Read a note",
    description: "Fetch the full text of one note by its document ID.",
    defaultArgs: { doc_id: "?{{inputs.doc_id}}" },
  },
  {
    verb: "get_outline",
    category: "read-document",
    title: "Get a note's outline",
    description: "Return just the heading structure of a note (no body text).",
    defaultArgs: { doc_id: "?{{inputs.doc_id}}" },
  },
  {
    verb: "search_sections",
    category: "read-document",
    title: "Find sections in a note",
    description: "Search within one note for sections matching a query.",
    defaultArgs: { doc_id: "?{{inputs.doc_id}}", query: "?" },
  },

  // ── Search the vault ──
  {
    verb: "search_hybrid",
    category: "search-vault",
    title: "Search the vault",
    description: "Hybrid semantic + keyword search across every note.",
    defaultArgs: { query: "?", limit: 20 },
  },
  {
    verb: "query_frontmatter",
    category: "search-vault",
    title: "Filter by frontmatter",
    description: "Find notes whose frontmatter properties match a filter.",
    defaultArgs: { where: { "?key": "?value" } },
  },

  // ── Navigate the graph ──
  {
    verb: "expand",
    category: "navigate-graph",
    title: "Expand the link graph",
    description: "Find notes 1-2 hops away from a seed via wikilinks + mentions.",
    defaultArgs: {
      seed_doc_ids: ["?{{inputs.doc_id}}"],
      hops: 1,
      direction: "both",
    },
  },
  {
    verb: "cluster",
    category: "navigate-graph",
    title: "Cluster related notes",
    description: "Group a set of notes into communities by their link density.",
    defaultArgs: { seed_doc_ids: ["?{{linked.doc_ids}}"], method: "edge-community" },
  },
  {
    verb: "list_backlinks",
    category: "navigate-graph",
    title: "List backlinks",
    description: "Find every note that links TO a target document.",
    defaultArgs: { target_doc_id: "?{{inputs.doc_id}}" },
  },

  // ── Reference earlier work ──
  {
    verb: "recall",
    category: "reference",
    title: "Recall an earlier memory",
    description: "Look up a document the agent wrote in an earlier run.",
    defaultArgs: { handle: "?", since_days: 30 },
  },
  {
    verb: "get_brief",
    category: "reference",
    title: "Fetch a saved brief",
    description: "Retrieve a brief compiled in an earlier run by its handle.",
    defaultArgs: { handle: "?" },
  },

  // ── Compose ──
  {
    verb: "compile_brief",
    category: "compose",
    title: "Compile a brief",
    description: "Bundle a set of notes into a structured brief using an LLM.",
    defaultArgs: {
      target: "?{{inputs.doc_id}}--brief",
      source_doc_ids: "?{{linked.doc_ids}}",
      purpose: "?",
      max_tokens: 2000,
    },
  },

  // ── Escape hatch ──
  {
    verb: "literal",
    category: "escape",
    title: "Literal value",
    description: "Inject a fixed value (string, number, object) into the pipeline.",
    defaultArgs: { value: "?" },
  },
];

/** Constant-time verb lookup. */
const BY_VERB: ReadonlyMap<string, VerbMeta> = new Map(
  VERB_CATALOG.map((entry) => [entry.verb, entry]),
);

/** Returns the metadata for a verb name, or undefined if not catalogued. */
export function lookupVerb(verb: string): VerbMeta | undefined {
  return BY_VERB.get(verb);
}

/**
 * Group the catalog by category, preserving category order from
 * VERB_CATEGORY_META. Each entry is `{category, items}`; categories with
 * no items are omitted.
 */
export function groupByCategory(
  catalog: readonly VerbMeta[] = VERB_CATALOG,
): Array<{ category: VerbCategoryMeta; items: readonly VerbMeta[] }> {
  const out: Array<{ category: VerbCategoryMeta; items: VerbMeta[] }> = [];
  const order: VerbCategory[] = [
    "read-document",
    "search-vault",
    "navigate-graph",
    "reference",
    "compose",
    "escape",
  ];
  for (const id of order) {
    const items = catalog.filter((v) => v.category === id);
    if (items.length > 0) {
      out.push({ category: VERB_CATEGORY_META[id], items });
    }
  }
  return out;
}

/**
 * Internal — used by the catalog-completeness test to assert every
 * baseline verb + `literal` has a metadata row. Returns the set of
 * canonical verb names that the catalog covers.
 */
export function catalogVerbNames(): ReadonlySet<string> {
  return new Set(VERB_CATALOG.map((v) => v.verb));
}

void BASELINE_VERBS; // referenced via the test, not at runtime here
