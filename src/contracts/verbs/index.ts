/**
 * verbDispatcher — Phase 6 / D-A2a / ADR-006 §Decision 2 / Invariant C-1.
 *
 * Closed 11-verb baseline dispatcher + `"literal"` escape + `mcp://`
 * peer-MCP extension. Write verbs are NOT part of the assembly enum —
 * writes happen exclusively via the structurally-separate `write_back:`
 * block (Invariant C-1).
 *
 * # Baseline verb signatures (verified against existing implementations per RESEARCH §A9)
 *
 *   - search_hybrid: ({query, vaults?, top_k?, recency_weight?, authority_weight?, include_superseded?, expand?}) → {hits}
 *   - expand: ({seed_doc_ids, hops, direction?, edge_types?, filter_properties?, include_superseded?}) → {doc_ids, edges}
 *   - cluster: ({seed_doc_ids?, query?, vault?, method, query_top_k?, force?}) → {clusters}
 *   - recall: ({query, min_confidence?, types?, max_age_days?, sink?, vaults?, limit?}) → {hits}
 *   - compile_brief: ({vault, target, source_doc_ids, purpose, max_tokens?, prepared_text?, sink?}) → {ok, doc_id, body?}
 *   - get_brief: ({vault, target, max_age_days?, allow_stale?}) → Brief | {stale: true, ...} | null
 *   - query_frontmatter: ({vault, where, limit?}) → {doc_ids, rows}
 *   - list_backlinks: ({vault, path}) → {backlinks}
 *   - get_outline: ({doc_id, vaults?}) → {nodes}
 *   - search_sections: ({query, vaults?, limit?, recency_weight?, authority_weight?, include_superseded?}) → {hits}
 *   - read_note: ({vault, path}) → {body, properties, ...}
 *
 * Each adapter passes contract YAML args (post-template-resolution)
 * verbatim to the verb handler — no reshaping. The contract author is
 * responsible for matching the verb's documented signature; Zod
 * validation at `instantiate_contract` time catches type mismatches.
 *
 * # Q-TIMEOUT (ADR-006 §Decision 11)
 *
 *   `opts.timeoutSeconds` applies ONLY to `mcp://*` verbs (peer-MCP).
 *   Baseline verbs are NOT wrapped — they use their own timeout
 *   discipline. Test 11 verifies that an absurdly small
 *   `timeoutSeconds` does not affect baseline dispatch.
 *
 * # Adapter-seam discipline
 *
 *   Imports `../mcp-clients.js` (registry type), `../types.js`
 *   (AssemblyVerb type), and `./mcp-extension.js`. Zero `fs` / `path` /
 *   `gray-matter` / `chokidar` imports.
 */

import type { AssemblyVerb } from "../types.js";
import type { PeerMcpRegistry } from "../mcp-clients.js";
import { callMcpVerb, type VerbDispatchOpts } from "./mcp-extension.js";

export type { VerbDispatchOpts } from "./mcp-extension.js";

/**
 * Dependencies injected into `verbDispatcher`. Each handler is a thin
 * thunk over the existing Phase 1-5 implementation — `instantiate.ts`
 * binds these against a specific Vault at call site.
 */
export interface VerbDeps {
  hybridSearch: (args: unknown) => Promise<unknown>;
  handleExpand: (args: unknown) => Promise<unknown>;
  handleCluster: (args: unknown) => Promise<unknown>;
  handleRecall: (args: unknown) => Promise<unknown>;
  handleCompileBrief: (args: unknown) => Promise<unknown>;
  handleGetBrief: (args: unknown) => Promise<unknown>;
  handleQueryFrontmatter: (args: unknown) => Promise<unknown>;
  handleListBacklinks: (args: unknown) => Promise<unknown>;
  handleGetOutline: (args: unknown) => Promise<unknown>;
  handleSearchSections: (args: unknown) => Promise<unknown>;
  handleReadNote: (args: unknown) => Promise<unknown>;
  peerMcpRegistry: PeerMcpRegistry;
}

/**
 * Dispatch one assembly step. Returns the verb's output OR a structured
 * error envelope; the orchestrator (`instantiate.ts`) inspects the
 * shape and either binds the output under the step's `as:` alias or
 * short-circuits with an `InstantiateError`.
 *
 * `step` carries the original step record so `literal` can peel
 * `step.value` (not `args`).
 */
export async function verbDispatcher(
  verb: AssemblyVerb,
  args: Record<string, unknown> | undefined,
  step: { value?: unknown } | undefined,
  deps: VerbDeps,
  opts: VerbDispatchOpts,
): Promise<unknown> {
  // The `literal` escape hatch — emits `step.value` verbatim.
  if (verb === "literal") {
    return step?.value;
  }
  // Peer-MCP extension — wrapped in Q-TIMEOUT.
  if (typeof verb === "string" && verb.startsWith("mcp://")) {
    return callMcpVerb(verb, args ?? {}, deps.peerMcpRegistry, opts);
  }
  // Closed baseline enum.
  switch (verb) {
    case "search_hybrid":
      return deps.hybridSearch(args);
    case "expand":
      return deps.handleExpand(args);
    case "cluster":
      return deps.handleCluster(args);
    case "recall":
      return deps.handleRecall(args);
    case "compile_brief":
      return deps.handleCompileBrief(args);
    case "get_brief":
      return deps.handleGetBrief(args);
    case "query_frontmatter":
      return deps.handleQueryFrontmatter(args);
    case "list_backlinks":
      return deps.handleListBacklinks(args);
    case "get_outline":
      return deps.handleGetOutline(args);
    case "search_sections":
      return deps.handleSearchSections(args);
    case "read_note":
      return deps.handleReadNote(args);
    default:
      // Defense-in-depth — the Zod schema at contract load rejects any
      // verb outside the closed enum; this is the runtime backstop.
      return { ok: false, reason: "verb_not_available", verb };
  }
}
