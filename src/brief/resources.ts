/**
 * `vault-memory://briefs` — MCP Resource enumerating compiled briefs
 * (Plan 05-04, BRF-09). Mirrors the structural analog
 * `src/memory/resources/list-sinks.ts`.
 *
 * Resource, not Tool: brief discovery is a read-only side-effect-free
 * enumeration surface. Agents that want to find briefs by target read
 * this URI instead of invoking a tool. Per CONTEXT D-Q4 this is
 * polled-only — no `notifyResourceUpdated` integration in v2.x.
 *
 * The handler is a pure function over (`MemorySinkRegistry`,
 * `VaultManager`, per-vault `SourceConnector`). It MUST NOT touch
 * `node:fs`, `node:path`, `gray-matter`, or `chokidar` — all reads
 * route through `SourceConnector.listDocuments` + `readDocument`.
 * `scripts/lint-adapters.sh` enforces this.
 *
 * Status surfacing:
 *   The resource projects `properties.status` verbatim so agents see
 *   `active`, `stale`, and `superseded` entries. Callers filter
 *   client-side; the registry-style listing intentionally lets the
 *   chain be inspectable (this matches the "let agents see the chain"
 *   stance in the Phase 5 CONTEXT discretion).
 *
 * Source-count semantics:
 *   `source_count` is the row count from `brief_sources` — the
 *   reverse-index of record per ADR-005. It is independent of
 *   `properties.compiled_from`; if the brief was compiled without
 *   chunk-level sources, `source_count === 0` even though the brief
 *   exists.
 */

import type { MemorySinkRegistry } from "../memory/registry.js";
import type { VaultManager } from "../vault/index.js";
import type { SourceConnector } from "../adapters/source/types.js";

/** Default sink name for briefs; the caller may override via `opts.sink`. */
const DEFAULT_BRIEF_SINK_NAME = "_memory/_briefs";

export interface ListBriefEntry {
  /** Canonical brief DocId (e.g. `obsidian-fs://<vault>/_memory/_briefs/<slug>--<purpose>--<ts>.md`). */
  doc_id: string;
  /** Brief target slug (e.g. `"atlas-q3"`). */
  target: string;
  /** Free-form purpose recorded at compile time. */
  purpose: string;
  /** ISO-8601 compile timestamp (UTC, milliseconds precision). */
  compiled_at: string;
  /** Lifecycle status: `"active"`, `"stale"`, or `"superseded"`. */
  status: string;
  /** Number of source-chunk rows in `brief_sources` for this brief. */
  source_count: number;
  /** Days since `compiled_at` (`floor((now - compiled_at) / 86400000)`). */
  age_days: number;
  /** Owning vault name. */
  vault: string;
}

export interface ListBriefsResource {
  /** Total number of briefs across all enumerated vaults (post-filter). */
  total: number;
  briefs: ListBriefEntry[];
}

export interface ListBriefsOpts {
  /** Restrict enumeration to a single vault. */
  vault?: string;
  /** Substring filter applied to `properties.target` (case-sensitive). */
  target?: string;
  /** Override the default `_memory/_briefs` sink. */
  sink?: string;
  /** Test override; defaults to `Date.now()`. */
  _now?: number;
}

export interface ListBriefsDeps {
  registry: MemorySinkRegistry;
  manager: VaultManager;
  sourceConnectorFor: (vaultName: string) => SourceConnector;
}

/**
 * Build the resource payload by enumerating each vault's brief sink
 * through `SourceConnector.listDocuments`, reading each candidate
 * document, and projecting briefs that satisfy `properties.type ===
 * "brief"`. Substring-filter on `properties.target` when
 * `opts.target` is set.
 */
export async function readListBriefs(
  deps: ListBriefsDeps,
  opts: ListBriefsOpts = {},
): Promise<ListBriefsResource> {
  const sinkName = opts.sink ?? DEFAULT_BRIEF_SINK_NAME;
  const now = opts._now ?? Date.now();

  // Resolve which vaults to enumerate. When `opts.vault` is set we go
  // single-vault via `manager.require()` (which throws on unknown vault
  // — same contract as `handleGetBrief`). Otherwise we fan out over
  // every vault the manager knows about.
  const vaults = opts.vault !== undefined
    ? [deps.manager.require(opts.vault)]
    : deps.manager.list();

  const out: ListBriefEntry[] = [];
  for (const vault of vaults) {
    const vaultName = vault.config.name;
    // The brief sink might not be registered in every vault (the
    // sink-registry is per-vault). Skip vaults that have no brief
    // sink — they have no briefs to list.
    let resolveTo: string;
    try {
      const briefSink = deps.registry.resolveMemorySink(sinkName);
      if (briefSink.vault !== vaultName) continue;
      resolveTo = briefSink.resolveToRelativePath;
    } catch {
      continue;
    }

    const connector = deps.sourceConnectorFor(vaultName);
    for await (const ref of connector.listDocuments()) {
      // listDocuments returns DocumentRef; the path-prefix filter
      // applies to the resource portion of the DocId. We use a
      // substring check on the canonical id (`<scheme>://<auth>/<res>`)
      // since the brief sink's `resolveToRelativePath` is part of
      // the DocId resource segment. Cheap pre-filter before the
      // expensive `readDocument()` call.
      if (!String(ref.id).includes(`/${resolveTo}`)) continue;

      let doc;
      try {
        doc = await connector.readDocument(ref.id);
      } catch {
        // Tolerate transient read errors so the discovery surface
        // never crashes the resource read. The brief simply won't
        // show up; subsequent reads can retry.
        continue;
      }
      const props = doc.properties as Record<string, unknown>;
      if (props.type !== "brief") continue;
      const target = typeof props.target === "string" ? props.target : "";
      if (opts.target !== undefined && !target.includes(opts.target)) continue;

      const compiledAt =
        typeof props.compiled_at === "string" ? props.compiled_at : "";
      const purpose = typeof props.purpose === "string" ? props.purpose : "";
      const status = typeof props.status === "string" ? props.status : "active";
      const sourceCount = vault.db.briefSources.sourcesForBrief(doc.id).length;
      const compiledAtMs = compiledAt ? Date.parse(compiledAt) : NaN;
      const ageDays = Number.isNaN(compiledAtMs)
        ? Number.POSITIVE_INFINITY
        : Math.floor((now - compiledAtMs) / 86_400_000);

      out.push({
        doc_id: String(doc.id),
        target,
        purpose,
        compiled_at: compiledAt,
        status,
        source_count: sourceCount,
        age_days: ageDays,
        vault: vaultName,
      });
    }
  }

  return { total: out.length, briefs: out };
}
