/**
 * `handleGetBrief` — the BRF-04 controller.
 *
 * Looks up a brief by target slug and applies the D-13 decision tree:
 *
 *   - **Staleness dominates.** If the brief's `status === "stale"` and
 *     the caller did not opt in via `allow_stale: true`, return
 *     `{brief: null, stale: true, ...}` so the caller knows to
 *     recompile.
 *   - **Age is independent.** Even on a non-stale brief, if
 *     `max_age_days` is set and the brief's `compiled_at` is older
 *     than that window AND `allow_stale: false`, return
 *     `{brief: null, too_old: true, ...}`.
 *   - **Follow the supersede chain.** If the looked-up brief carries
 *     `status: "superseded"` with a non-null `superseded_by`, follow
 *     the chain via `SourceConnector.readDocument` until a terminal
 *     brief is reached (or a cycle is detected — defensive 100-hop
 *     cap, see Phase 2 D-03 forward-only supersede invariant).
 *
 * The "not_found" case is its own branch so callers can differentiate
 * "no brief exists for this target" from "exists but stale/too_old".
 *
 * Pure controller — no `node:fs`, no `node:path`, no `gray-matter`,
 * no `chokidar`. Everything goes through `SourceConnector.listDocuments`
 * + `readDocument`.
 */

import type { SourceConnector } from "../adapters/source/types.js";
import { decomposeDocId, parseDocId } from "../adapters/registry.js";
import type { Document } from "../types.js";
import type { VaultManager } from "../vault/index.js";
import type { MemorySinkRegistry } from "../memory/registry.js";

/** Defensive cycle guard for the supersede chain (forward-only invariant). */
const MAX_SUPERSEDE_HOPS = 100;

/** Default sink name for briefs; the user may override via `args.sink`. */
const DEFAULT_BRIEF_SINK_NAME = "_memory/_briefs";

export interface GetBriefDeps {
  memorySinkRegistry: MemorySinkRegistry;
  manager: VaultManager;
  sourceConnectorFor: (vaultName: string) => SourceConnector;
}

export interface GetBriefArgs {
  vault: string;
  target: string;
  max_age_days?: number;
  allow_stale?: boolean;
  sink?: string;
}

export type GetBriefResult =
  | { brief: Document; stale: false; too_old: false; age_days: number }
  | {
      brief: Document;
      stale: true;
      too_old: boolean;
      age_days: number;
      changed_sources: string[];
    }
  | {
      brief: Document;
      stale: false;
      too_old: true;
      age_days: number;
    }
  | {
      brief: null;
      stale: true;
      too_old?: boolean;
      changed_sources: string[];
      reason: "stale_blocked";
    }
  | {
      brief: null;
      stale: false;
      too_old: true;
      age_days: number;
      reason: "too_old_blocked";
    }
  | { brief: null; reason: "not_found" };

/**
 * Enumerate `_memory/_briefs/` and find the FIRST brief whose
 * `properties.target` matches. Skips superseded briefs at the listing
 * pass — the supersede chain is followed below by the controller.
 */
async function findBriefByTarget(
  source: SourceConnector,
  briefSinkPrefix: string,
  target: string,
): Promise<Document | null> {
  const candidates: Document[] = [];
  for await (const ref of source.listDocuments()) {
    const { resource } = decomposeDocId(ref.id);
    if (!resource.startsWith(briefSinkPrefix)) continue;
    let doc: Document;
    try {
      doc = await source.readDocument(ref.id);
    } catch {
      continue;
    }
    const props = doc.properties as Record<string, unknown>;
    if (props.target !== target) continue;
    if (props.status === "superseded") continue;
    candidates.push(doc);
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  // Forward-only invariant violation — pick newest by compiled_at and
  // proceed; observability lands when audit-log integration follows.
  candidates.sort((a, b) => {
    const ai = a.properties.compiled_at as string | undefined;
    const bi = b.properties.compiled_at as string | undefined;
    return (bi ?? "").localeCompare(ai ?? "");
  });
  return candidates[0]!;
}

/**
 * Walk the `superseded_by` chain forward until we hit a terminal brief
 * (status !== "superseded" or superseded_by is null) or the cycle
 * guard trips. Returns the terminal Document.
 */
async function followSupersedeChain(
  source: SourceConnector,
  start: Document,
): Promise<Document> {
  let current = start;
  let hops = 0;
  while (current.properties.status === "superseded") {
    const nextRaw = current.properties.superseded_by;
    if (nextRaw === null || nextRaw === undefined) break;
    if (typeof nextRaw !== "string") break;
    if (++hops > MAX_SUPERSEDE_HOPS) {
      throw new Error(
        `get_brief supersede chain exceeded ${MAX_SUPERSEDE_HOPS} hops; ` +
          `target chain rooted at ${start.id}. Indicates a forward-only ` +
          `invariant violation upstream (Phase 2 D-03).`,
      );
    }
    const nextId = parseDocId(nextRaw);
    let next: Document;
    try {
      next = await source.readDocument(nextId);
    } catch {
      // Broken chain — return what we have.
      break;
    }
    current = next;
  }
  return current;
}

function ageDaysFor(brief: Document): number {
  const compiledAt = brief.properties.compiled_at;
  if (typeof compiledAt !== "string") return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(compiledAt);
  if (Number.isNaN(parsed)) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - parsed) / 86_400_000);
}

function changedSourcesFor(brief: Document): string[] {
  const raw = brief.properties.changed_sources;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

/**
 * Look up a brief by target and apply D-13. See file header.
 */
export async function handleGetBrief(
  deps: GetBriefDeps,
  args: GetBriefArgs,
): Promise<GetBriefResult> {
  const vault = deps.manager.require(args.vault);
  const vaultName = vault.config.name;

  // Resolve the brief sink so we know which path prefix to enumerate.
  const briefSink = deps.memorySinkRegistry.resolveMemorySink(
    args.sink ?? DEFAULT_BRIEF_SINK_NAME,
  );
  if (briefSink.vault !== vaultName) {
    throw new Error(
      `Brief sink "${briefSink.name}" belongs to vault "${briefSink.vault}", not "${vaultName}"`,
    );
  }

  const source = deps.sourceConnectorFor(vaultName);
  const found = await findBriefByTarget(
    source,
    briefSink.resolveToRelativePath,
    args.target,
  );
  if (found === null) {
    return { brief: null, reason: "not_found" };
  }

  // Follow the supersede chain to the terminal (defensive — the
  // `findBriefByTarget` pass already filters out superseded briefs,
  // but a brief returned here that carries `superseded_by` non-null
  // means a non-superseded-status row exists with a redirect, which
  // is unusual but possible in mid-flight states).
  const terminal = await followSupersedeChain(source, found);

  const ageDays = ageDaysFor(terminal);
  const status = terminal.properties.status;
  const stale = status === "stale";
  const tooOld =
    args.max_age_days !== undefined && Number.isFinite(ageDays) && ageDays > args.max_age_days;
  const allowStale = args.allow_stale === true;

  if (stale && !allowStale) {
    return {
      brief: null,
      stale: true,
      ...(tooOld ? { too_old: true as const } : {}),
      changed_sources: changedSourcesFor(terminal),
      reason: "stale_blocked",
    };
  }

  if (tooOld && !allowStale) {
    return {
      brief: null,
      stale: false,
      too_old: true,
      age_days: ageDays,
      reason: "too_old_blocked",
    };
  }

  if (stale) {
    return {
      brief: terminal,
      stale: true,
      too_old: tooOld,
      age_days: ageDays,
      changed_sources: changedSourcesFor(terminal),
    };
  }

  if (tooOld) {
    return {
      brief: terminal,
      stale: false,
      too_old: true,
      age_days: ageDays,
    };
  }

  return {
    brief: terminal,
    stale: false,
    too_old: false,
    age_days: ageDays,
  };
}
