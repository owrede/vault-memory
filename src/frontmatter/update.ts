/**
 * updateFrontmatter — merge-style frontmatter editor.
 *
 * Modifies only the YAML frontmatter of a markdown note. The body is
 * preserved bytegenau. Writes are atomic and audited.
 *
 * Merge DSL (top-level keys of `merge`):
 *   <key>: <value>             → set / overwrite
 *   <key>: { $unset: true }    → delete the key
 *   <key>: { $push: x }        → push x onto array (create if absent)
 *   <key>: { $pull: x }        → remove x from array (no-op if absent)
 *   <key>: { ...plainObj }     → shallow-merge into existing object (or set)
 *
 * Concurrency: optional `expectedHash` is checked against the current
 * note hash (sha256 of `content + JSON.stringify(frontmatter ?? {})`).
 * Mismatch → conflict, no write.
 *
 * NOTE: gray-matter's stringify preserves the existing serialization
 * style for fields it knows about, but YAML key order for *new* keys is
 * insertion order. We do not guarantee a stable global key order.
 *
 * Plan 01-04 task 05: this module no longer imports `gray-matter` or
 * `node:fs` directly. The READ path goes through the v2 SourceConnector
 * (`registry.resolveSource(handle).readDocument(id)`) and the WRITE
 * path goes through the v2 DeliveryAdapter (`registry.resolveDelivery
 * (handle).write(id, partial, opts)`). The merge-DSL semantics + diff
 * emission are UNCHANGED.
 */

import type { Vault } from "../vault/index.js";
import type { Document, DocId, SourceHandle, WikilinkRef } from "../types.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import { formatDocId, parseSourceHandle } from "../adapters/registry.js";
import type { MemorySinkRegistry } from "../memory/registry.js";
import { errorMessage } from "../errors/format.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateFrontmatterInput {
  vault: Vault;
  /**
   * Adapter registry — Source for read, Delivery for write. Optional for
   * backwards-compatibility with v1 callers that haven't been migrated;
   * when omitted, the function falls back to constructing per-call
   * adapters from `vault` (delegated by the server handler in Phase 1).
   */
  registry?: AdapterRegistry;
  /**
   * Plan 02-03b — defense-in-depth entry-point Guard. When supplied AND
   * the target lands inside a registered MemorySink, the update is
   * refused with `{ok:false, reason:"sink_write_blocked"}` BEFORE any
   * filesystem read. When omitted (Phase 1 unit-test fixtures + back-
   * compat callers), the guard is silently skipped. See
   * `src/adapters/delivery/obsidian-fs/write.ts:WriteNoteInput.registry`
   * for the full rationale (the authoritative chokepoint lives at the
   * DeliveryAdapter; this is defense-in-depth).
   */
  memorySinkRegistry?: MemorySinkRegistry;
  relativePath: string;
  merge: Record<string, unknown>;
  expectedHash?: string;
  clientId?: string;
  /** Called once, immediately before the filesystem write. See
   *  `WriteNoteInput.onBeforeFsWrite`. Not called when the update is a
   *  no-op (empty merge or no effective change) since no fs event will
   *  occur. */
  onBeforeFsWrite?: () => void;
}

export type DiffOp = "set" | "unset" | "push" | "pull";

export interface DiffEntry {
  key: string;
  op: DiffOp;
  before?: unknown;
  after?: unknown;
}

export interface UpdateSuccess {
  ok: true;
  newHash: string;
  noteId: number;
  diff: DiffEntry[];
}

export interface UpdateConflict {
  ok: false;
  reason: "hash_mismatch" | "permission_denied" | "note_not_found" | "sink_write_blocked";
  currentHash?: string;
  message: string;
  /** Phase 2 envelope (sink_write_blocked). */
  sinkName?: string;
  /** Phase 2 envelope — actionable next-step hint. */
  suggestion?: string;
}

export type UpdateResult = UpdateSuccess | UpdateConflict;

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isUnsetDirective(v: unknown): v is { $unset: true } {
  return isPlainObject(v) && v["$unset"] === true;
}

function isPushDirective(v: unknown): v is { $push: unknown } {
  return isPlainObject(v) && "$push" in v;
}

function isPullDirective(v: unknown): v is { $pull: unknown } {
  return isPlainObject(v) && "$pull" in v;
}

function hasDirective(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  return Object.keys(v).some((k) => k.startsWith("$"));
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

function applyMerge(
  data: Record<string, unknown>,
  merge: Record<string, unknown>,
): { next: Record<string, unknown>; diff: DiffEntry[] } {
  const next: Record<string, unknown> = { ...data };
  const diff: DiffEntry[] = [];

  for (const [key, instr] of Object.entries(merge)) {
    const before = next[key];

    if (isUnsetDirective(instr)) {
      if (key in next) {
        delete next[key];
        diff.push({ key, op: "unset", before });
      }
      continue;
    }

    if (isPushDirective(instr)) {
      const value = (instr as { $push: unknown }).$push;
      if (Array.isArray(before)) {
        const arr = [...before, value];
        next[key] = arr;
        diff.push({ key, op: "push", before, after: arr });
      } else if (before === undefined) {
        next[key] = [value];
        diff.push({ key, op: "push", before: undefined, after: [value] });
      } else {
        // Treat non-array existing scalar as wrapping into a new array
        next[key] = [value];
        diff.push({ key, op: "push", before, after: [value] });
      }
      continue;
    }

    if (isPullDirective(instr)) {
      const value = (instr as { $pull: unknown }).$pull;
      if (Array.isArray(before)) {
        const filtered = before.filter((v) => !deepEqual(v, value));
        if (filtered.length !== before.length) {
          next[key] = filtered;
          diff.push({ key, op: "pull", before, after: filtered });
        }
      }
      // else: no-op
      continue;
    }

    // Plain set or shallow-merge nested object
    if (isPlainObject(instr) && !hasDirective(instr) && isPlainObject(before)) {
      const merged = { ...before, ...instr };
      if (!deepEqual(before, merged)) {
        next[key] = merged;
        diff.push({ key, op: "set", before, after: merged });
      }
    } else {
      if (!deepEqual(before, instr)) {
        next[key] = instr;
        diff.push({ key, op: "set", before, after: instr });
      }
    }
  }

  return { next, diff };
}

/**
 * Strip the adapter-injected `wikilinks: WikilinkRef[]` property that
 * `ObsidianFsSource.readDocument` puts on `Document.properties` (D-05).
 * The user's frontmatter never contained this key — we must NOT carry
 * it through the merge or re-write.
 */
function stripWikilinks(props: Record<string, unknown>): Record<string, unknown> {
  const { wikilinks: _w, ...rest } = props as { wikilinks?: WikilinkRef[] } & Record<
    string,
    unknown
  >;
  return rest;
}

/**
 * Extract the flat-text body string from `Document.blocks`. Phase 1 only
 * emits single-paragraph blocks (BodyShape="flat-text") so this is
 * trivially the first block's text. Matches the inverse of
 * `extractBodyAndFrontmatter` in ObsidianFsDelivery.
 */
function blocksToBody(doc: Document): string {
  return doc.blocks
    .map((b) => (b.kind === "paragraph" ? b.text : ""))
    .filter((s) => s.length > 0)
    .join("\n\n");
}

export async function updateFrontmatter(input: UpdateFrontmatterInput): Promise<UpdateResult> {
  const {
    vault,
    relativePath,
    merge,
    expectedHash,
    clientId,
    registry,
    memorySinkRegistry,
    onBeforeFsWrite,
  } = input;

  // Plan 02-03b — defense-in-depth entry-point Guard. Runs BEFORE the
  // write_enabled check and BEFORE any DB / FS read. When the optional
  // MemorySinkRegistry is supplied (production path) AND the target lands
  // inside a registered sink, refuse with the structured `sink_write_blocked`
  // envelope. The suggestion directs the caller to `record_observation +
  // supersede` per Plan 02-03b action notes.
  if (memorySinkRegistry) {
    const docId = formatDocId("obsidian-fs", vault.config.name, relativePath);
    const sink = memorySinkRegistry.findSinkContaining(docId);
    if (sink !== null) {
      return {
        ok: false,
        reason: "sink_write_blocked",
        sinkName: sink.name,
        message:
          `Target ${relativePath} resolves into MemorySink "${sink.name}". ` +
          `v1 update_frontmatter is refused for memory-sink targets.`,
        suggestion: "Use record_observation + supersede for memory updates.",
      };
    }
  }

  if (vault.config.write_enabled !== true) {
    return {
      ok: false,
      reason: "permission_denied",
      message: "Vault is not write-enabled. Set write_enabled=true in config.",
    };
  }

  const noteRow = vault.db.notes.getByPath(relativePath);
  if (noteRow === null) {
    return {
      ok: false,
      reason: "note_not_found",
      message: `No indexed note at path: ${relativePath}`,
    };
  }

  // Resolve the adapter triple. Phase 1 fallback (no registry supplied):
  // construct one inline from `vault` so existing callers (handlers that
  // haven't been migrated to registry-based dispatch yet) keep working.
  const { source, delivery } = await resolveAdapters(vault, registry);
  const handle = parseSourceHandle(`obsidian-fs://${vault.config.name}`);
  void handle;
  const docId: DocId = formatDocId("obsidian-fs", vault.config.name, relativePath);

  // ── READ via Source ────────────────────────────────────────────────────────
  let doc: Document;
  try {
    doc = await source.readDocument(docId);
  } catch (err) {
    const msg = errorMessage(err);
    return {
      ok: false,
      reason: "note_not_found",
      message: `Failed to read document: ${msg}`,
    };
  }

  const body = blocksToBody(doc);
  const existingFm = stripWikilinks(doc.properties as Record<string, unknown>);
  // The current hash on disk is exactly `doc.hash` (ObsidianFsSource uses
  // `computeNoteHash(body, fm)`). The wikilinks injection happens AFTER
  // hash computation in the parser, so doc.hash matches the gray-matter
  // round-trip the v1 code computed.
  const currentHash = doc.hash;

  if (expectedHash !== undefined && expectedHash !== currentHash) {
    return {
      ok: false,
      reason: "hash_mismatch",
      currentHash,
      message: `Expected hash ${expectedHash} but current is ${currentHash}.`,
    };
  }

  // Empty merge → no-op
  if (Object.keys(merge).length === 0) {
    return {
      ok: true,
      newHash: currentHash,
      noteId: noteRow.id,
      diff: [],
    };
  }

  const { next, diff } = applyMerge(existingFm, merge);

  if (diff.length === 0) {
    // Nothing actually changed (e.g. $pull on absent value)
    return {
      ok: true,
      newHash: currentHash,
      noteId: noteRow.id,
      diff: [],
    };
  }

  // ── WRITE via Delivery ─────────────────────────────────────────────────────
  // Pass the suppression hook through opts? — DeliveryAdapter does not
  // expose it on the v2 surface. Instead, call it directly before
  // dispatching; this matches the v1 ordering (hook fires immediately
  // before the fs write).
  onBeforeFsWrite?.();

  const partial: Partial<Document> = {
    blocks: [{ kind: "paragraph", text: body }],
    properties: Object.keys(next).length > 0 ? next : {},
  };
  const writeOpts: {
    expectedHash: string;
    clientId?: string;
  } = {
    expectedHash: currentHash,
  };
  if (clientId !== undefined) writeOpts.clientId = clientId;

  const writeRes = await delivery.write(docId, partial, writeOpts);
  if (!writeRes.ok) {
    // Shape-map Delivery v2 conflict reasons back to v1 update result.
    if (writeRes.reason === "permission_denied") {
      return {
        ok: false,
        reason: "permission_denied",
        message: writeRes.message ?? "Write rejected by delivery adapter.",
      };
    }
    return {
      ok: false,
      reason: "hash_mismatch",
      ...(writeRes.currentHash !== undefined ? { currentHash: writeRes.currentHash } : {}),
      message: writeRes.message ?? "Write conflict.",
    };
  }

  return {
    ok: true,
    newHash: writeRes.newHash,
    noteId: noteRow.id,
    diff,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 adapter resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phase 1: when callers don't supply an AdapterRegistry, construct an
 * inline source + delivery for the vault. The eventual end-state (after
 * task 06's server.ts wiring) is that every caller supplies the
 * registry; this fallback is for the legacy `updateFrontmatter({vault,
 * ...})` shape during the migration window.
 *
 * The dynamic imports avoid pulling the obsidian-fs adapter into the
 * module-load graph for callers that never reach this branch — there
 * are no current consumers besides src/server.ts which WILL pass a
 * registry post-task-06.
 */
async function resolveAdapters(
  vault: Vault,
  registry: AdapterRegistry | undefined,
): Promise<{
  source: { readDocument: (id: DocId) => Promise<Document> };
  delivery: {
    write: (
      id: DocId,
      doc: Partial<Document>,
      opts?: { expectedHash?: string; clientId?: string },
    ) => Promise<
      | { ok: true; newHash: string; doc_id: DocId; created: boolean }
      | { ok: false; reason: string; currentHash?: string; message?: string }
    >;
  };
}> {
  const handle: SourceHandle = parseSourceHandle(`obsidian-fs://${vault.config.name}`);
  if (registry !== undefined) {
    return {
      source: registry.resolveSource(handle),
      delivery: registry.resolveDelivery(handle),
    };
  }
  // Fallback path — instantiate inline. clientId="unknown" because the
  // server bootstrap has not threaded an actual MCP client_info value
  // through to this call; the caller's `clientId` arg wins in writeOpts.
  const { ObsidianFsSource } = await import("../adapters/source/obsidian-fs/index.js");
  const { ObsidianFsDelivery } = await import("../adapters/delivery/obsidian-fs/index.js");
  return {
    source: new ObsidianFsSource(vault.config),
    delivery: new ObsidianFsDelivery(vault, "unknown"),
  };
}
