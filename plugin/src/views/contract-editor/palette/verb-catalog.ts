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
    label: "Pull from one note",
    icon: "file-text",
    colorVar: "--color-blue",
  },
  "search-vault": {
    id: "search-vault",
    label: "Find notes",
    icon: "search",
    colorVar: "--color-cyan",
  },
  "navigate-graph": {
    id: "navigate-graph",
    label: "Follow links between notes",
    icon: "network",
    colorVar: "--color-purple",
  },
  reference: {
    id: "reference",
    label: "Look up past results",
    icon: "history",
    colorVar: "--color-orange",
  },
  compose: {
    id: "compose",
    label: "Write something new",
    icon: "sparkles",
    colorVar: "--color-green",
  },
  escape: {
    id: "escape",
    label: "Advanced",
    icon: "wrench",
    colorVar: "--text-muted",
  },
};

/**
 * The output type a step produces — a closed enum so the canvas can
 * validate connections. Loosely modelled on the verb's actual
 * outputShape but coarser so a small compatibility matrix is enough.
 *
 *   - note         : single DocId + body + frontmatter (read_note, get_brief)
 *   - note-list    : list of DocIds (search_hybrid, expand, list_backlinks, recall, query_frontmatter)
 *   - cluster-list : grouped DocIds with cluster metadata (cluster)
 *   - brief        : compiled brief (body + saved DocId) (compile_brief, get_brief)
 *   - outline      : heading tree (get_outline)
 *   - sections     : section search hits (search_sections)
 *   - any          : escape-hatch — literal step, peer-MCP, etc.
 *
 * `none` means the step has no useful output to connect downstream
 * (none today, reserved for future side-effect-only verbs).
 */
export type OutputType =
  | "note"
  | "note-list"
  | "cluster-list"
  | "brief"
  | "outline"
  | "sections"
  | "any"
  | "none";

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
   * right input control. Extended in the UX redesign:
   *
   *   - text      : single-line free-form input
   *   - textarea  : multi-line free-form input
   *   - number    : numeric stepper
   *   - bool      : yes/no toggle
   *   - enum      : dropdown from `enumOptions`
   *   - docId     : single note picker
   *   - docList   : list of note pickers (multi-pick)
   *   - composite : chip-strip of fixed-string + reference segments
   *                 (stubbed; renders as advanced raw editor for now)
   *   - json      : raw JSON value (advanced)
   *
   * "mustache" was removed — the inspector's picker handles
   * upstream-vs-literal disambiguation on top of the typed shapes.
   */
  shape?:
    | "text"
    | "number"
    | "textarea"
    | "bool"
    | "enum"
    | "docId"
    | "docList"
    | "composite"
    | "json";
  /**
   * Options for `shape: "enum"`. Each entry's `value` is the literal
   * string written into the contract's args; `label` is what the user
   * sees in the dropdown.
   */
  enumOptions?: ReadonlyArray<{ value: string; label: string }>;
  /**
   * Which upstream OutputTypes can feed this slot. Drives canvas-level
   * connection compatibility — incompatible source/target pairs hide
   * their handles during drag. When omitted, derived from `shape`:
   *
   *   - docId    → ["note", "brief", "any"]
   *   - docList  → ["note-list", "cluster-list", "any"]
   *   - text     → ["note", "brief", "outline", "sections", "any"]
   *   - textarea → ["note", "brief", "outline", "sections", "any"]
   *   - number   → ["any"]
   *   - bool     → ["any"]
   *   - enum     → ["any"]
   *   - json     → ["any"]
   *   - composite→ ["any"]
   *
   * Set explicitly when an arg should accept a narrower or wider set
   * than its shape's default.
   */
  acceptedOutputTypes?: ReadonlyArray<OutputType>;
}

/**
 * Default `acceptedOutputTypes` derived from an arg's shape. Used when
 * a verb's ArgDoc doesn't override the value explicitly. Read by
 * `verbAcceptedInputs()`.
 */
const DEFAULT_ACCEPTED_BY_SHAPE: Record<NonNullable<ArgDoc["shape"]>, ReadonlyArray<OutputType>> = {
  text: ["note", "brief", "outline", "sections", "any"],
  textarea: ["note", "brief", "outline", "sections", "any"],
  number: ["any"],
  bool: ["any"],
  enum: ["any"],
  docId: ["note", "brief", "any"],
  docList: ["note-list", "cluster-list", "any"],
  composite: ["any"],
  json: ["any"],
};

/**
 * Compute the union of OutputTypes a verb's argDocs can accept. Used by
 * canvas-pane's isValidConnection to gate drag-targets at the card
 * level (we don't yet expose per-arg handles).
 */
export function verbAcceptedInputs(meta: VerbMeta): ReadonlySet<OutputType> {
  const out = new Set<OutputType>();
  for (const doc of Object.values(meta.argDocs)) {
    if (doc.acceptedOutputTypes) {
      for (const t of doc.acceptedOutputTypes) out.add(t);
    } else if (doc.shape) {
      for (const t of DEFAULT_ACCEPTED_BY_SHAPE[doc.shape]) out.add(t);
    }
  }
  // `any` is the universal accept — a literal upstream always fits.
  out.add("any");
  return out;
}

/**
 * Whether `source.outputType` can validly feed any arg of `target`.
 */
export function isCompatible(source: VerbMeta, target: VerbMeta): boolean {
  if (source.outputType === "none") return false;
  if (source.outputType === "any") return true;
  return verbAcceptedInputs(target).has(source.outputType);
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
  /**
   * Closed-enum classification of the output, used for connection
   * compatibility on the canvas. Coarser than `outputShape` (which is
   * free text). When the source's outputType is missing from a target's
   * accepted set, the canvas hides the target's input handle during
   * drag from the source.
   */
  outputType: OutputType;
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
    description: "Pull the full text of one note from your vault.",
    longDescription:
      "Returns the full text, properties, and metadata of a single note. Use this when a later step needs the actual contents of a note — for example, when compiling a brief that quotes from a meeting. The note is usually supplied by the agent at run time, or comes from the result of an earlier step.",
    defaultArgs: { doc_id: "?{{inputs.doc_id}}" },
    argDocs: {
      doc_id: {
        label: "Note to read",
        help: "Which note to read. Usually the agent supplies this when it runs the contract.",
        required: true,
        shape: "docId",
      },
    },
    outputShape: "{ body: string, frontmatter: object, doc_id: string }",
    outputType: "note",
  },
  {
    verb: "get_outline",
    category: "read-document",
    title: "Get a note's outline",
    description: "Return just the headings of a note — no body text.",
    longDescription:
      "Returns the heading tree of a note — useful when the agent only needs to know what sections exist (for navigation, summary, or cross-referencing) rather than the full body. Cheap; uses no LLM tokens downstream.",
    defaultArgs: { doc_id: "?{{inputs.doc_id}}" },
    argDocs: {
      doc_id: {
        label: "Note",
        help: "Which note's outline to read.",
        required: true,
        shape: "docId",
      },
    },
    outputShape: "{ headings: Array<{level, text, anchor}> }",
    outputType: "outline",
  },
  {
    verb: "search_sections",
    category: "read-document",
    title: "Find sections in a note",
    description: "Search inside one note for the sections that match a query.",
    longDescription:
      "Scopes a search to a single note instead of the whole vault. Useful when you have one long source note and want to find the relevant sections — for example, the parts of a meeting transcript that discuss a specific topic.",
    defaultArgs: { doc_id: "?{{inputs.doc_id}}", query: "?" },
    argDocs: {
      doc_id: {
        label: "Note",
        help: "Which note to search inside.",
        required: true,
        shape: "docId",
      },
      query: {
        label: "What to search for",
        help: "A few words about what you're looking for. The agent finds matching sections.",
        required: true,
        shape: "text",
      },
    },
    outputShape: "{ sections: Array<{heading, body, score}> }",
    outputType: "sections",
  },

  // ── Search the vault ──
  {
    verb: "search_hybrid",
    category: "search-vault",
    title: "Search the vault",
    description: "Search across every note in your vault.",
    longDescription:
      "Searches every note in the vault and returns the best matches — combining meaning-based and keyword search. The default starting point when you don't yet know which note holds the answer. The matching notes can feed later steps such as 'Follow links between notes' or 'Compile a brief'.",
    defaultArgs: { query: "?", limit: 20 },
    argDocs: {
      query: {
        label: "What to search for",
        help: "A few words about what you're looking for. The agent finds matching notes.",
        required: true,
        shape: "text",
      },
      limit: {
        label: "How many results",
        help: "How many top results to return. 10–30 is typical; lower is faster.",
        shape: "number",
      },
    },
    outputShape: "{ docs: Array<{doc_id, title, score, snippet}> }",
    outputType: "note-list",
  },
  {
    verb: "query_frontmatter",
    category: "search-vault",
    title: "Filter by properties",
    description: "Find notes whose properties match a filter.",
    longDescription:
      "Structured filter over note properties (e.g. `status: open`, `project: atlas-1`). Use this when the agent needs to find all notes of a kind — for example, every note tagged with a specific project, or every unresolved task.",
    defaultArgs: { where: { "?key": "?value" } },
    argDocs: {
      where: {
        label: "Filter",
        help: "Pairs of property and value. All conditions must match.",
        required: true,
        shape: "json",
      },
    },
    outputShape: "{ docs: Array<{doc_id, frontmatter}> }",
    outputType: "note-list",
  },

  // ── Navigate the graph ──
  {
    verb: "expand",
    category: "navigate-graph",
    title: "Follow links between notes",
    description: "Find notes 1–2 steps away from a starting set via links and mentions.",
    longDescription:
      "Starting from one or more notes, follows wikilinks, mentions, and property references to reach related notes within a given distance. Use this to gather context around a focal note — for example, the notes linked from a meeting are usually the projects discussed.",
    defaultArgs: {
      seed_doc_ids: ["?{{inputs.doc_id}}"],
      hops: 1,
      direction: "both",
    },
    argDocs: {
      seed_doc_ids: {
        label: "Starting notes",
        help: "Which notes to start from. Usually the result of a search, or a note the agent supplies.",
        required: true,
        shape: "docList",
      },
      hops: {
        label: "How far to follow links",
        help: "1 = direct neighbours only. 2 = neighbours of neighbours. Capped at 2.",
        shape: "number",
      },
      direction: {
        label: "Direction",
        help: "Which way to follow links from the starting notes.",
        shape: "enum",
        enumOptions: [
          { value: "in", label: "Inbound only" },
          { value: "out", label: "Outbound only" },
          { value: "both", label: "Both directions" },
        ],
      },
    },
    outputShape: "{ doc_ids: string[], edges: Array<{source, target, type}> }",
    outputType: "note-list",
  },
  {
    verb: "cluster",
    category: "navigate-graph",
    title: "Cluster related notes",
    description: "Group a set of notes into themes by how densely they link to each other.",
    longDescription:
      "Groups the given notes into communities based on how densely they link to each other. Use after 'Follow links between notes' to break a big neighbourhood into themes.",
    defaultArgs: { seed_doc_ids: ["?{{linked.doc_ids}}"], method: "edge-community" },
    argDocs: {
      seed_doc_ids: {
        label: "Notes to cluster",
        help: "The notes to group. Usually the result of a 'Follow links between notes' step.",
        required: true,
        shape: "docList",
      },
      method: {
        label: "Method",
        help: "Only 'edge-community' is available today. Reserved for future variants.",
        shape: "text",
      },
    },
    outputShape: "{ communities: Array<{cluster_id, member_doc_ids}> }",
    outputType: "cluster-list",
  },
  {
    verb: "list_backlinks",
    category: "navigate-graph",
    title: "List backlinks",
    description: "Find every note that links to a target note.",
    longDescription:
      "Returns all notes that link to, mention, or reference the target note. Use to find every meeting where a person was discussed, or every project status that touches a particular initiative.",
    defaultArgs: { target_doc_id: "?{{inputs.doc_id}}" },
    argDocs: {
      target_doc_id: {
        label: "Target note",
        help: "Which note to find backlinks for.",
        required: true,
        shape: "docId",
      },
    },
    outputShape: "{ backlinks: Array<{source_doc_id, type, anchor?}> }",
    outputType: "note-list",
  },

  // ── Reference earlier work ──
  {
    verb: "recall",
    category: "reference",
    title: "Recall an earlier memory",
    description: "Look up something the agent saved in an earlier run.",
    longDescription:
      "Returns notes the agent previously saved to the memory folder, identified by a saved-folder name and a freshness window. Use this to give an agent continuity across runs — for example, recalling last week's meeting prep before this week's.",
    defaultArgs: { handle: "?", since_days: 30 },
    argDocs: {
      handle: {
        label: "Saved folder",
        help: "Name of the memory folder to look in (e.g. `_memory/_briefs`).",
        required: true,
        shape: "text",
      },
      since_days: {
        label: "Look back (days)",
        help: "Only return memories saved within the last N days.",
        shape: "number",
      },
    },
    outputShape: "{ memories: Array<{doc_id, body, written_at}> }",
    outputType: "note-list",
  },
  {
    verb: "get_brief",
    category: "reference",
    title: "Fetch a saved brief",
    description: "Retrieve a brief written in an earlier run by its name.",
    longDescription:
      "Returns a brief saved in an earlier run. Use when a contract should build on a previously-written brief — for example, a weekly status that references last week's status. The name usually comes from a contract input or an earlier 'Recall' step.",
    defaultArgs: { handle: "?" },
    argDocs: {
      handle: {
        label: "Brief name",
        help: "Which saved brief to fetch.",
        required: true,
        shape: "docId",
      },
    },
    outputShape: "{ body: string, compiled_at: number, sources: string[] }",
    outputType: "brief",
  },

  // ── Compose ──
  {
    verb: "compile_brief",
    category: "compose",
    title: "Compile a brief",
    description: "Bundle a set of notes into a structured brief.",
    longDescription:
      "Bundles a set of source notes into a structured brief using the configured language model. This is the usual final step — most contracts end with a 'Compile a brief' that saves its result to a memory folder. The output is a brief that the contract saves to your vault.",
    defaultArgs: {
      target: "?{{inputs.doc_id}}--brief",
      source_doc_ids: "?{{linked.doc_ids}}",
      purpose: "?",
      max_tokens: 2000,
    },
    argDocs: {
      target: {
        label: "Where to save this brief",
        help: "A stable name for the resulting brief (used as the saved file's name).",
        required: true,
        shape: "text",
      },
      source_doc_ids: {
        label: "Source notes",
        help: "The notes the brief is built from. Usually the result of a 'Follow links' or 'Find notes' step.",
        required: true,
        shape: "docList",
      },
      purpose: {
        label: "Purpose",
        help: "What the brief is for — picks the writing template.",
        required: true,
        shape: "enum",
        enumOptions: [
          { value: "summary", label: "Summary" },
          { value: "decisions", label: "Decisions only" },
          { value: "action_items", label: "Action items" },
        ],
      },
      max_tokens: {
        label: "Maximum length",
        help: "Cap on the brief's length, measured in tokens. 1000–3000 is typical.",
        shape: "number",
      },
    },
    outputShape: "{ body: string, doc_id: string, sources: string[] }",
    outputType: "brief",
  },

  // ── Escape hatch ──
  {
    verb: "literal",
    category: "escape",
    title: "Fixed value",
    description: "Drop a fixed value (text, number, list) into your contract.",
    longDescription:
      "Hard-codes a value into the contract. Use sparingly — most steps should take their values from contract inputs or earlier steps. Common uses: a fixed search query for a recurring report, a constant section heading, a pinned note ID for tests.",
    defaultArgs: { value: "?" },
    argDocs: {
      value: {
        label: "Value",
        help: "Any value: text, number, list, or object. Used as-is.",
        required: true,
        shape: "json",
      },
    },
    outputShape: "The value, as-is.",
    outputType: "any",
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
