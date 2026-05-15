/**
 * `handleRecordObservation` — the MEM-02 controller.
 *
 * Authors a new memory observation under a labeled `MemorySink`. Sugar
 * arguments (`claim`, `evidence`, `confidence`, `type`) pre-fill the
 * contract-required keys. The caller-supplied `properties` bag is
 * filtered to drop the 8 provenance-critical keys
 * (`source`, `evidence`, `confidence`, `observed_at`, `type`, `status`,
 * `superseded_by`, `superseded_reason`) BEFORE merge, then the sugar
 * values are applied LAST. Result: contract-allowed extras (tags,
 * expires_at, priority, etc.) flow through unchanged — D-02
 * escape-hatch preserved — but the provenance trail can never be
 * weakened by the caller (WR-07 closure).
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

import { createHash, randomBytes } from "node:crypto";
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
 * Provenance-critical keys that callers MAY NOT override via the
 * `properties` escape-hatch. The validator at the DeliveryAdapter
 * chokepoint trusts these values; allowing caller override would let
 * a malicious or buggy agent weaken its own provenance trail.
 *
 * WR-07 closure + D-02 refinement: D-02's "caller keys win over sugar
 * defaults" rule is EXPLICITLY scoped to non-provenance extras (e.g.
 * tags, expires_at, priority). Provenance keys (the 8 listed below)
 * come exclusively from validated MCP args. The validator at
 * `DeliveryAdapter.write()` (Guard A/B, Plan 02-03) remains the single
 * source of truth for which non-protected keys the contract accepts.
 */
const PROTECTED_PROVENANCE_KEYS = new Set<string>([
  "source",
  "evidence",
  "confidence",
  "observed_at",
  "type",
  "status",
  "superseded_by",
  "superseded_reason",
]);

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
    // Strip combining diacritical marks (U+0300–U+036F). IN-04: explicit
    // Unicode-escape form is source-stable; some editors / log
    // aggregators silently drop literal combining characters and
    // produce an empty char-class.
    .replace(/[\u0300-\u036F]/g, "")
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

  // ── Build the property bag ───────────────────────────────────────────────
  //
  // WR-07 closure + D-02 refinement: strip provenance-critical keys from
  // caller-supplied `properties` BEFORE merging, then place sugar LAST so
  // the 8 protected keys (source / evidence / confidence / observed_at /
  // type / status / superseded_by / superseded_reason) cannot be weakened
  // by the caller. Non-provenance extras (tags, expires_at, priority,
  // custom_tag, etc.) still win over absent sugar defaults — the D-02
  // escape-hatch is preserved for contract-allowed extras.
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
  const callerExtras: Record<string, unknown> = {};
  if (args.properties !== undefined) {
    for (const [k, v] of Object.entries(args.properties)) {
      if (!PROTECTED_PROVENANCE_KEYS.has(k)) {
        callerExtras[k] = v;
      }
    }
  }
  // callerExtras FIRST, sugarProps LAST — defensive ordering means even
  // if the filter is ever bypassed, sugar still wins for provenance keys.
  const properties: Record<string, unknown> = {
    ...callerExtras,
    ...sugarProps,
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
    // WR-04 (b): per-retry salt is cryptographically random — six hex
    // chars of fresh entropy. Two same-millisecond calls with identical
    // claim/observed_at no longer produce identical collision chains.
    const suffix = hashSuffix(
      args.claim,
      observedAtForNaming,
      randomBytes(3).toString("hex"),
    );
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

  // WR-04 (a): distinct reason on retry exhaustion so callers can branch
  // on a meaningful recovery path (vary the claim text, the observed_at
  // timestamp, or retry later) — `permission_denied` everywhere else
  // means "vault is read-only" and would mislead automatic retry logic.
  return {
    ok: false,
    reason: "collision_retry_exhausted",
    message:
      `Failed to mint unique DocId after ${MAX_COLLISION_RETRIES} attempts. ` +
      `Vary the claim text, the observed_at timestamp, or retry the call.`,
  };
}
