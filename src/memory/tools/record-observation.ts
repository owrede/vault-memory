/**
 * `handleRecordObservation` — the MEM-02 controller.
 *
 * Authors a new memory observation under a labeled `MemorySink`. Sugar
 * arguments (`claim`, `evidence`, `confidence`, `type`) pre-fill the
 * contract-required keys; the caller-supplied `properties` bag merges
 * LAST so contract-allowed extras win over sugar defaults — D-02
 * escape hatch.
 *
 * The controller never pre-validates beyond required-args presence;
 * contract enforcement is the validator's job at the
 * `DeliveryAdapter.write()` chokepoint (Plan 02-03 wired). When the
 * delivery returns a `WriteConflict`, the controller returns it
 * unchanged so the caller observes the structured Phase 2 envelope
 * (sinkName / key / observedValue / suggestion).
 *
 * The controller is pure: no `node:fs`, no `node:path`, no
 * `gray-matter`, no `chokidar`. Slug derivation is pure string ops;
 * `node:crypto` is used for the 6-char hash suffix to avoid same-day
 * collisions.
 */

import { createHash } from "node:crypto";
import type {
  DeliveryAdapter,
  WriteResult,
} from "../../adapters/delivery/types.js";
import { formatDocId } from "../../adapters/registry.js";
import type { SourceConnector } from "../../adapters/source/types.js";
import type { Document } from "../../types.js";
import type { VaultManager } from "../../vault/index.js";
import type { MemorySinkRegistry } from "../registry.js";

/** Naming subfolder used by the default-memory-v1 contract. */
const OBSERVATIONS_SUBFOLDER = "observations/";

/** Max number of times we retry the DocId-collision avoidance loop. */
const MAX_COLLISION_RETRIES = 3;

/**
 * Dependencies — supplied by the server bootstrap. Pure interface so
 * tests can wire fakes without touching the file system seam.
 */
export interface RecordObservationDeps {
  memorySinkRegistry: MemorySinkRegistry;
  manager: VaultManager;
  /**
   * Resolve the `DeliveryAdapter` instance for a vault name. The
   * controller never instantiates adapters itself — bootstrap owns
   * adapter lifetimes.
   */
  deliveryAdapterFor: (vaultName: string) => DeliveryAdapter;
  /**
   * Resolve the `SourceConnector` instance for a vault name. The
   * controller uses `connector.exists(docId)` to detect path
   * collisions on the same-day same-claim retry path. Bootstrap
   * (Plan 02-03b) supplies this closure.
   */
  sourceConnectorFor: (vaultName: string) => SourceConnector;
}

export interface RecordObservationArgs {
  vault: string;
  claim: string;
  evidence: string[];
  confidence: "direct" | "inferred" | "uncertain";
  type: string;
  /** Bare sink name OR full `obsidian-fs://…` handle. Defaults to the vault's default sink. */
  sink?: string;
  /**
   * Escape-hatch: contract-allowed extras merged AFTER sugar args.
   * Caller-supplied keys win — D-02.
   */
  properties?: Record<string, unknown>;
}

/**
 * Slugify a `claim` string for use in the date-slug naming pattern.
 *
 * Rules:
 *   - lowercase
 *   - strip accents via `normalize("NFD")` + combining-mark removal
 *   - replace non-ASCII-alnum with hyphens
 *   - collapse repeated hyphens
 *   - trim leading/trailing hyphens
 *   - cap at 60 chars (without breaking mid-word past the cap)
 */
function slugify(claim: string): string {
  const stripped = claim
    .normalize("NFD")
    // Strip combining diacritical marks (U+0300–U+036F).
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (stripped.length <= 60) return stripped || "observation";
  return stripped.slice(0, 60).replace(/-+$/g, "") || "observation";
}

/**
 * Compute a 6-character hex hash suffix for collision avoidance within
 * the same day. Mixes `claim`, `observed_at`, and an optional `salt`
 * (retry counter) so consecutive retries produce different suffixes.
 */
function hashSuffix(claim: string, observedAt: string, salt = ""): string {
  return createHash("sha256")
    .update(`${claim}\x00${observedAt}\x00${salt}`)
    .digest("hex")
    .slice(0, 6);
}

/**
 * Extract the `YYYY-MM-DD` portion of an ISO-8601 timestamp.
 * Works for both `Z`-suffixed and `+HH:MM` variants because the date
 * prefix is always the first 10 characters of an ISO string.
 */
function dateSlug(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

/**
 * Record a new memory observation. See file header for D-02 / D-03
 * semantics.
 *
 * Returns the `WriteResult` discriminated union from the delivery
 * adapter UNCHANGED — never renames `newHash` to `hash`, never re-
 * shapes a `WriteConflict`.
 */
export async function handleRecordObservation(
  deps: RecordObservationDeps,
  args: RecordObservationArgs,
): Promise<WriteResult> {
  // ── Resolve the target sink ──────────────────────────────────────────────
  const registry = deps.memorySinkRegistry;
  const sink =
    args.sink !== undefined
      ? registry.resolveMemorySink(args.sink)
      : registry.getDefaultMemorySink();

  if (sink.vault !== args.vault) {
    throw new Error(
      `Sink "${sink.name}" belongs to vault "${sink.vault}", not "${args.vault}"`,
    );
  }

  // ── Build the property bag (sugar first, caller LAST per D-02) ──────────
  const observedAtDefault = new Date().toISOString();
  const sugarProps: Record<string, unknown> = {
    source: "agent",
    observed_at: observedAtDefault,
    status: "active",
    confidence: args.confidence,
    evidence: args.evidence,
    type: args.type,
    superseded_by: null,
  };
  const properties: Record<string, unknown> = {
    ...sugarProps,
    ...(args.properties ?? {}),
  };

  // ── Mint a DocId, retrying with fresh hash suffix on path collision ─────
  const observedAtForNaming =
    typeof properties.observed_at === "string"
      ? properties.observed_at
      : observedAtDefault;
  const slug = slugify(args.claim);

  const delivery = deps.deliveryAdapterFor(args.vault);
  const source = deps.sourceConnectorFor(args.vault);

  let attempt = 0;
  while (attempt < MAX_COLLISION_RETRIES) {
    const suffix = hashSuffix(args.claim, observedAtForNaming, String(attempt));
    const filename = `${dateSlug(observedAtForNaming)}-${slug}-${suffix}.md`;
    // `sink.resolveToRelativePath` already ends in "/" (enforced by the
    // MemorySinkHandle regex in Plan 02-02). Safe to concatenate.
    const relativeResource =
      sink.resolveToRelativePath + OBSERVATIONS_SUBFOLDER + filename;
    const docId = formatDocId("obsidian-fs", args.vault, relativeResource);

    // Path-collision check: if the candidate DocId already resolves to
    // an existing file, retry with a fresh hash6 salt rather than
    // overwriting. The delivery would otherwise create-or-overwrite per
    // its `naming: "caller-provided"` capability.
    const collides = await source.exists(docId);
    if (collides) {
      attempt += 1;
      continue;
    }

    const partialDoc: Partial<Document> = {
      id: docId,
      title: args.claim.slice(0, 80),
      properties,
      blocks: [{ kind: "paragraph", text: args.claim }],
    };

    // Delegate to the delivery — the validator at the chokepoint runs
    // Guard A + Guard B + sentinel. WriteConflicts (including
    // contract-validator rejections like non_agent_write_inside_sink)
    // are returned UNCHANGED.
    return await delivery.write(docId, partialDoc, { sink: sink.handle });
  }

  return {
    ok: false,
    reason: "permission_denied",
    message: `Failed to mint unique DocId after ${MAX_COLLISION_RETRIES} attempts`,
  };
}
