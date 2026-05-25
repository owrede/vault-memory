/**
 * Canonical RESOURCES literal — the single source of truth for the
 * MCP `resources/list` surface.
 *
 * Mirrors src/tool-registry.ts (TOOLS). Consumed by:
 *   - evals/v1-baseline/dump-resources.mjs (snapshot generation)
 *   - evals/v1-baseline/baseline.test.ts (snapshot equality + length === 13)
 *   - src/server.ts (registerResource metadata source)
 *
 * Plan 08-05 (REL-08): 10 entries — 5 pre-existing (memory-sinks,
 * memory-stats, briefs, contracts, contract-verbs) + 5 newly promoted
 * from v1 tools (vaults, models, recent, stats, backlinks).
 *
 * SOURCES-REGISTRY.md §5 (Stage 2): +3 peer-MCP source discovery
 * resources (sources, source-tools, source-tool) → 13 entries.
 *
 * Two URI shapes appear here:
 *   - Static URI (e.g. `vault-memory://memory/sinks`, `vault-memory://vaults`):
 *     a single concrete URI; no template variables.
 *   - Templated URI (e.g. `vault-memory://models/{vault}`): SDK 1.29
 *     ResourceTemplate variables expand at read time.
 *
 * The `list_backlinks` entry uses **RFC 6570 reserved expansion** on the
 * `docId` variable — `vault-memory://backlinks/{vault}/{+docId}` — so a
 * docId like `notes/sub/file.md` (with embedded `/`) parses as a single
 * value instead of being truncated at the first `/`. Without the leading
 * `+`, default expansion matches only one path segment.
 */

export interface ResourceEntry {
  readonly name: string;
  readonly uriTemplate: string;
  readonly description: string;
  readonly mimeType: "application/json";
}

export const RESOURCES: readonly ResourceEntry[] = [
  // ─── Phase 2 (Plan 02-06 / MEM-09) ──────────────────────────────────────
  {
    name: "memory-sinks",
    uriTemplate: "vault-memory://memory/sinks",
    description:
      "Configured + auto-discovered MemorySinks (name, handle, vault, contract, default). " +
      "Read to discover where memory documents (record_observation, supersede) land.",
    mimeType: "application/json",
  },
  {
    name: "memory-stats",
    uriTemplate: "vault-memory://memory/stats",
    description:
      "Per-sink document counts, by_type / by_status breakdowns, and last memory-write timestamp. " +
      "Polled — re-read to refresh.",
    mimeType: "application/json",
  },
  // ─── Phase 5 (Plan 05-04 / BRF-09) ──────────────────────────────────────
  {
    name: "briefs",
    uriTemplate: "vault-memory://briefs",
    description:
      "Discovery of compiled briefs by target. Supports optional `?target=<pattern>` " +
      "substring filter on `properties.target`. Includes `active`, `stale`, and " +
      "`superseded` entries so callers can build their own filter / inspect the " +
      "supersede chain. BRF-09.",
    mimeType: "application/json",
  },
  // ─── Phase 6 (Plan 06-04 / CON-04 + D-A2b) ──────────────────────────────
  {
    name: "contracts",
    uriTemplate: "vault-memory://contracts/{vault}",
    description:
      "Discovery of task contracts available in a vault (CON-04). Each entry " +
      "carries name, description, source/sink counts, and write_back boolean. " +
      "Optional `?source=<prefix>` filters to contracts declaring a source " +
      "whose handle starts with the given prefix.",
    mimeType: "application/json",
  },
  {
    name: "contract-verbs",
    uriTemplate: "vault-memory://contract-verbs/{vault}",
    description:
      "List baseline assembly verbs + custom (mcp://) verbs in use, with " +
      "invocation_count + last_seen aggregated from contract_audit (D-A2b). " +
      "Baseline verbs are constant per ADR-006 §Decision 3.",
    mimeType: "application/json",
  },
  // ─── SOURCES-REGISTRY.md §5 (Stage 2) — peer-MCP source discovery ───────
  {
    name: "sources",
    uriTemplate: "vault-memory://sources",
    description:
      "List peer MCP servers vault-memory connects to, with per-source status " +
      "(connected/unavailable/unreachable), tool_count, and last_refreshed. " +
      "vault-memory itself is not included. SOURCES-REGISTRY §5.1.",
    mimeType: "application/json",
  },
  {
    name: "source-tools",
    uriTemplate: "vault-memory://sources/{name}/tools",
    description:
      "List the cached tools/list for one peer MCP source. Empty when the " +
      "source is not connected. SOURCES-REGISTRY §5.2.",
    mimeType: "application/json",
  },
  {
    name: "source-tool",
    uriTemplate: "vault-memory://sources/{name}/tools/{tool}",
    description:
      "Read a single tool's schema from one peer MCP source, inlined from the " +
      "cached tools/list. SOURCES-REGISTRY §5.3.",
    mimeType: "application/json",
  },
  // ─── Phase 8 (Plan 08-05 / REL-08) — promoted from v1 tools ─────────────
  {
    name: "vaults",
    uriTemplate: "vault-memory://vaults",
    description:
      "List configured vaults with their status (note count, last indexed run). " +
      "Promoted from the `list_vaults` MCP tool in v2.0.0; the tool remains callable " +
      "through v2.x.",
    mimeType: "application/json",
  },
  {
    name: "models",
    uriTemplate: "vault-memory://models/{vault}",
    description:
      "List all embedding models registered for a vault, with dim, active flag, and " +
      "how many chunks have been embedded under each. Promoted from the `list_models` " +
      "MCP tool in v2.0.0; the tool remains callable through v2.x.",
    mimeType: "application/json",
  },
  {
    name: "recent",
    uriTemplate: "vault-memory://recent/{vault}",
    description:
      "List recently modified notes (mtime DESC) for a vault. Use for agent " +
      "self-orientation: 'what has the user been working on lately?'. Promoted from " +
      "the `recent_notes` MCP tool in v2.0.0; the tool remains callable through v2.x.",
    mimeType: "application/json",
  },
  {
    name: "stats",
    uriTemplate: "vault-memory://stats/{vault}",
    description:
      "Vault overview for agent self-orientation: note/word counts, top tags, top " +
      "frontmatter keys, embedding model, last index run. Promoted from the " +
      "`vault_stats` MCP tool in v2.0.0; the tool remains callable through v2.x.",
    mimeType: "application/json",
  },
  {
    name: "backlinks",
    // RFC 6570 reserved expansion on docId: `{+docId}` preserves `/` in the
    // variable so multi-segment paths like `notes/sub/file.md` parse as a
    // single value. Without the `+`, the default expansion stops at the
    // first `/`. See Plan 08-05 §B2 for the acceptance test.
    uriTemplate: "vault-memory://backlinks/{vault}/{+docId}",
    description:
      "Find all notes that link TO a given note. The `docId` segment uses RFC 6570 " +
      "reserved expansion ({+docId}) so multi-segment paths (e.g. `notes/sub/file.md`) " +
      "are preserved verbatim. Promoted from the `list_backlinks` MCP tool in v2.0.0; " +
      "the tool remains callable through v2.x.",
    mimeType: "application/json",
  },
];
