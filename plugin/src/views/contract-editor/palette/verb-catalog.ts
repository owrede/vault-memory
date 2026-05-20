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

export interface ArgDoc {
  /** Plain-language label for the field shown in the inspector. */
  label: string;
  /**
   * One-line help text rendered under the input. Describes what the
   * field is for in plain English. ~120 chars max.
   */
  help: string;
  /** True if the step won't run without this arg. Hints the UI to flag. */
  required?: boolean;
  /**
   * Hint about the expected shape; the inspector uses this to pick the
   * right input control (text / number / textarea / mustache).
   */
  shape?: "text" | "number" | "textarea" | "docId" | "mustache" | "json";
}

export interface VerbMeta {
  /** Canonical verb name (matches Phase 6 closed enum / "literal"). */
  verb: string;
  category: VerbCategory;
  /** Plain-language title shown as the primary label. */
  title: string;
  /** One-line description. ~80 chars max. */
  description: string;
  /**
   * Paragraph explanation rendered in the inspector when a step using
   * this verb is selected. Two to four sentences explaining what this
   * verb does, when to use it, and what it returns.
   */
  longDescription: string;
  /**
   * Skeleton `args` object dropped into the YAML when the user drags
   * this verb in. Each key maps to a placeholder value (string with a
   * leading `?` so the canvas inspector can highlight it as "fill me").
   *
   * The canvas + inspector are the SOURCE of which fields to render —
   * this is just the starting state.
   */
  defaultArgs: Record<string, unknown>;
  /**
   * Per-arg documentation. Keys match defaultArgs. The inspector
   * renders fields in the order keys appear here (so put the most
   * important arg first), with the label + help text + shape hint.
   * Unknown keys (e.g. a hand-edited arg the user added) render with
   * the raw key name and no help text — defensive but not pretty.
   */
  argDocs: Record<string, ArgDoc>;
  /**
   * One-line statement of what this verb's output looks like, used in
   * the inspector's "what you get back" line and in the canvas node
   * preview when an arg refers to this step.
   */
  outputShape: string;
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
    longDescription:
      "Returns the full text, frontmatter, and metadata of a single note identified by its DocId. Use this when a later step needs the actual contents of a note — for example, when compiling a brief that quotes from a meeting. The DocId usually comes from a contract input or from a previous step's output.",
    defaultArgs: { doc_id: "?{{inputs.doc_id}}" },
    argDocs: {
      doc_id: {
        label: "Document to read",
        help: "The DocId of the note. Usually `{{inputs.<your-input>}}` so the agent supplies it at call time.",
        required: true,
        shape: "docId",
      },
    },
    outputShape: "{ body: string, frontmatter: object, doc_id: string }",
  },
  {
    verb: "get_outline",
    category: "read-document",
    title: "Get a note's outline",
    description: "Return just the heading structure of a note (no body text).",
    longDescription:
      "Returns the hierarchical heading tree of a note — useful when the agent only needs to know what sections exist (for navigation, summarisation, or cross-referencing) rather than the full body text. Cheap; no token cost on downstream LLM steps.",
    defaultArgs: { doc_id: "?{{inputs.doc_id}}" },
    argDocs: {
      doc_id: {
        label: "Document",
        help: "The DocId of the note whose outline you want.",
        required: true,
        shape: "docId",
      },
    },
    outputShape: "{ headings: Array<{level, text, anchor}> }",
  },
  {
    verb: "search_sections",
    category: "read-document",
    title: "Find sections in a note",
    description: "Search within one note for sections matching a query.",
    longDescription:
      "Scopes a hybrid search to a single note instead of the whole vault. Useful when you have one long source document and want to find the relevant sections — for example, finding the parts of a meeting transcript that discuss a specific topic.",
    defaultArgs: { doc_id: "?{{inputs.doc_id}}", query: "?" },
    argDocs: {
      doc_id: {
        label: "Document",
        help: "The DocId of the note to search inside.",
        required: true,
        shape: "docId",
      },
      query: {
        label: "Search query",
        help: "Natural-language query. Hybrid search combines semantic + keyword.",
        required: true,
        shape: "text",
      },
    },
    outputShape: "{ sections: Array<{heading, body, score}> }",
  },

  // ── Search the vault ──
  {
    verb: "search_hybrid",
    category: "search-vault",
    title: "Search the vault",
    description: "Hybrid semantic + keyword search across every note.",
    longDescription:
      "Runs a hybrid semantic + BM25 + RRF search across the entire vault and returns the top matching notes. The recommended default search verb when you don't know which note holds the answer. Output IDs can be fed into `expand`, `cluster`, or `compile_brief`.",
    defaultArgs: { query: "?", limit: 20 },
    argDocs: {
      query: {
        label: "Search query",
        help: "Natural-language question or topic. Often references inputs: `{{inputs.topic}}`.",
        required: true,
        shape: "text",
      },
      limit: {
        label: "Result limit",
        help: "How many top results to return. 10–30 is typical; lower is faster.",
        shape: "number",
      },
    },
    outputShape: "{ docs: Array<{doc_id, title, score, snippet}> }",
  },
  {
    verb: "query_frontmatter",
    category: "search-vault",
    title: "Filter by frontmatter",
    description: "Find notes whose frontmatter properties match a filter.",
    longDescription:
      "Structured filter over note frontmatter properties (e.g. `status: open`, `project: atlas-1`). Use this when the agent needs to find all notes of a kind — for example, all notes tagged with a specific project key, or all unresolved tasks.",
    defaultArgs: { where: { "?key": "?value" } },
    argDocs: {
      where: {
        label: "Filter expression",
        help: "Object of `key: value` pairs. All conditions must match (logical AND).",
        required: true,
        shape: "json",
      },
    },
    outputShape: "{ docs: Array<{doc_id, frontmatter}> }",
  },

  // ── Navigate the graph ──
  {
    verb: "expand",
    category: "navigate-graph",
    title: "Expand the link graph",
    description: "Find notes 1-2 hops away from a seed via wikilinks + mentions.",
    longDescription:
      "Starting from one or more seed notes, walks the typed-edge graph (wikilinks, mentions, frontmatter-refs, hyperlinks) and returns all reachable notes within `hops` steps. Use this to gather context around a focal note — for example, the notes linked from a meeting are usually the projects discussed.",
    defaultArgs: {
      seed_doc_ids: ["?{{inputs.doc_id}}"],
      hops: 1,
      direction: "both",
    },
    argDocs: {
      seed_doc_ids: {
        label: "Starting notes",
        help: "Array of DocIds to start walking from. Often `[{{inputs.doc_id}}]` or `{{search_results.docs}}`.",
        required: true,
        shape: "json",
      },
      hops: {
        label: "Walk distance",
        help: "1 = direct neighbours only. 2 = friends-of-friends. v2.0 caps at 2.",
        shape: "number",
      },
      direction: {
        label: "Direction",
        help: "`out` follows links from seeds, `in` follows backlinks, `both` does both.",
        shape: "text",
      },
    },
    outputShape: "{ doc_ids: string[], edges: Array<{source, target, type}> }",
  },
  {
    verb: "cluster",
    category: "navigate-graph",
    title: "Cluster related notes",
    description: "Group a set of notes into communities by their link density.",
    longDescription:
      "Runs Louvain community detection on the subgraph induced by the seed notes. Returns groups of notes that link to each other more densely than to the rest. Use after `expand` to break a large neighbourhood into themes.",
    defaultArgs: { seed_doc_ids: ["?{{linked.doc_ids}}"], method: "edge-community" },
    argDocs: {
      seed_doc_ids: {
        label: "Notes to cluster",
        help: "DocIds. Usually `{{<expand-step>.doc_ids}}` from a prior expand step.",
        required: true,
        shape: "json",
      },
      method: {
        label: "Method",
        help: "`edge-community` is the only method in v2.0. Reserved for future variants.",
        shape: "text",
      },
    },
    outputShape: "{ communities: Array<{cluster_id, member_doc_ids}> }",
  },
  {
    verb: "list_backlinks",
    category: "navigate-graph",
    title: "List backlinks",
    description: "Find every note that links TO a target document.",
    longDescription:
      "Returns all notes that wikilink, mention, or reference (via frontmatter) the target document. Use to find every meeting where a person was discussed, or every project status that touches a particular initiative.",
    defaultArgs: { target_doc_id: "?{{inputs.doc_id}}" },
    argDocs: {
      target_doc_id: {
        label: "Target document",
        help: "DocId whose backlinks to fetch.",
        required: true,
        shape: "docId",
      },
    },
    outputShape: "{ backlinks: Array<{source_doc_id, type, anchor?}> }",
  },

  // ── Reference earlier work ──
  {
    verb: "recall",
    category: "reference",
    title: "Recall an earlier memory",
    description: "Look up a document the agent wrote in an earlier run.",
    longDescription:
      "Returns documents the agent previously wrote to the memory namespace, identified by handle and freshness window. Use this to give an agent continuity across runs — for example, recalling last week's meeting prep before this week's.",
    defaultArgs: { handle: "?", since_days: 30 },
    argDocs: {
      handle: {
        label: "Memory handle",
        help: "MemorySink handle (e.g. `_memory/_briefs`) or a document handle.",
        required: true,
        shape: "text",
      },
      since_days: {
        label: "Freshness window (days)",
        help: "Only return memories written within the last N days.",
        shape: "number",
      },
    },
    outputShape: "{ memories: Array<{doc_id, body, written_at}> }",
  },
  {
    verb: "get_brief",
    category: "reference",
    title: "Fetch a saved brief",
    description: "Retrieve a brief compiled in an earlier run by its handle.",
    longDescription:
      "Returns a brief document by handle. Use when a contract should build on a previously-compiled brief — for example, a weekly status that references last week's status. The handle usually comes from a contract input or a `recall` step.",
    defaultArgs: { handle: "?" },
    argDocs: {
      handle: {
        label: "Brief handle",
        help: "DocId of a previously-compiled brief.",
        required: true,
        shape: "docId",
      },
    },
    outputShape: "{ body: string, compiled_at: number, sources: string[] }",
  },

  // ── Compose ──
  {
    verb: "compile_brief",
    category: "compose",
    title: "Compile a brief",
    description: "Bundle a set of notes into a structured brief using an LLM.",
    longDescription:
      "Bundles a set of source notes into a structured brief using the configured LLM (or a fallback ladder). This is the canonical compose step — most contracts end with a `compile_brief` followed by the `write_back` block. Output is a brief document the contract's write_back writes to a MemorySink.",
    defaultArgs: {
      target: "?{{inputs.doc_id}}--brief",
      source_doc_ids: "?{{linked.doc_ids}}",
      purpose: "?",
      max_tokens: 2000,
    },
    argDocs: {
      target: {
        label: "Target handle",
        help: "Stable handle for the resulting brief (used as DocId stem in the sink).",
        required: true,
        shape: "text",
      },
      source_doc_ids: {
        label: "Source notes",
        help: "Array of DocIds the brief should be built from. Usually `{{<expand>.doc_ids}}`.",
        required: true,
        shape: "json",
      },
      purpose: {
        label: "Purpose",
        help: "Free-text description of what the brief is for. Goes into the LLM prompt.",
        required: true,
        shape: "textarea",
      },
      max_tokens: {
        label: "Max tokens",
        help: "Cap on the output length. 1000–3000 is typical.",
        shape: "number",
      },
    },
    outputShape: "{ body: string, doc_id: string, sources: string[] }",
  },

  // ── Escape hatch ──
  {
    verb: "literal",
    category: "escape",
    title: "Literal value",
    description: "Inject a fixed value (string, number, object) into the pipeline.",
    longDescription:
      "Hard-codes a value into the assembly graph. Use sparingly — most steps should derive their values from inputs or upstream steps. Common uses: a hard-coded query for a fixed report, a constant section heading, a fixture-pinned DocId for tests.",
    defaultArgs: { value: "?" },
    argDocs: {
      value: {
        label: "Value",
        help: "Any JSON value: string, number, object, array. Quoted strings literal; bare numbers numeric.",
        required: true,
        shape: "json",
      },
    },
    outputShape: "The value, as-is.",
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
