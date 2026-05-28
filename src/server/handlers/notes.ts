/**
 * Notes-domain MCP handler factory.
 *
 * Tools: read_note, write_note, update_frontmatter, delete_note,
 * query_frontmatter, suggest_frontmatter.
 *
 * Extracted verbatim from the inline `handlers` literal + standalone
 * `handle*` functions in `src/server.ts`. Behavior-neutral.
 *
 * # Adapter-seam discipline
 *
 * No node:path / node:fs / chokidar / gray-matter imports. All file IO
 * goes through the adapter registry (`resolveSource` / `resolveDelivery`)
 * and the `vault.db` query namespaces.
 */

import type { VaultManager, Vault } from "../../vault/index.js";
import type { AdapterRegistry } from "../../adapters/registry.js";
import { formatDocId, parseSourceHandle } from "../../adapters/registry.js";
import type { Document, WikilinkRef } from "../../types.js";
import { queryFrontmatter, updateFrontmatter } from "../../frontmatter/index.js";
import { suggestFrontmatter } from "../../schema/index.js";
import { countWords, safeParseFrontmatter, defaultBasename, normalizeFolderHint } from "../utils.js";
import type { ToolName } from "../../tool-registry.js";
import type { Handler, HandlerDeps } from "../deps.js";

/**
 * Read a note via the v2 SourceConnector seam (Plan 01-03 Task 06).
 *
 * The v1 wire shape `{path, title, content, frontmatter, hash, mtime,
 * word_count}` is preserved byte-for-byte; only the INTERNAL data path
 * changed: the handler now resolves the source by handle, mints a DocId,
 * and reads a Document via `source.readDocument(id)`. The mapping back
 * to the v1 shape happens at this boundary.
 *
 * Side effect: reads the file fresh from disk on every call (where v1
 * served the DB-cached row). In a normally-running server the catch-up
 * scan + watcher keep DB ≈ disk, so behavior is observationally
 * identical; the path goes through the seam either way.
 */
export async function handleReadNote(
  registry: AdapterRegistry,
  vaultName: string,
  path: string,
): Promise<object> {
  const handle = parseSourceHandle(`obsidian-fs://${vaultName}`);
  let source;
  try {
    source = registry.resolveSource(handle);
  } catch {
    // Preserve the v1 error message shape for unknown-vault cases.
    throw new Error(`Note not found: ${vaultName}/${path}`);
  }
  const id = formatDocId("obsidian-fs", vaultName, path);
  let doc: Document;
  try {
    doc = await source.readDocument(id);
  } catch {
    throw new Error(`Note not found: ${vaultName}/${path}`);
  }

  // Map Document → v1 read_note response shape.
  // - `frontmatter` is `doc.properties` minus the adapter-injected
  //   `wikilinks: WikilinkRef[]` (D-05). The v1 shape never carried the
  //   wikilinks key; preserve that.
  const { wikilinks: _wikilinks, ...frontmatterOnly } = doc.properties as Record<
    string,
    unknown
  > & {
    wikilinks?: WikilinkRef[];
  };
  const hasFrontmatter = Object.keys(frontmatterOnly).length > 0;
  // Single-paragraph BodyShape="flat-text" — body lives in blocks[0].text.
  const content = doc.blocks[0]?.kind === "paragraph" ? doc.blocks[0].text : "";

  return {
    path,
    title: doc.title,
    content,
    frontmatter: hasFrontmatter ? frontmatterOnly : null,
    hash: doc.hash,
    mtime: doc.mtime,
    word_count: countWords(content),
  };
}

/**
 * write_note handler. Routes through `registry.resolveDelivery(handle).write`
 * (plan 01-04 task 06) while preserving the v1 wire shape: caller sees
 * `{ok, noteId, newHash, created, reason?, ...}`. The DocId mapping happens
 * at the seam — v2 returns doc_id: DocId; we derive v1 noteId from the DB
 * row after a successful write.
 *
 * The v1 `client_id` arg, when supplied, overrides the constructor-injected
 * default per D-02. When omitted, the delivery's lazy clientId getter reads
 * `server.getClientVersion()?.name` at call time.
 */
async function handleWriteNote(
  registry: AdapterRegistry,
  vault: Vault,
  parsed: {
    vault: string;
    path: string;
    content: string;
    frontmatter?: Record<string, unknown> | null;
    expected_hash?: string;
    client_id?: string;
  },
): Promise<object> {
  const handle = parseSourceHandle(`obsidian-fs://${parsed.vault}`);
  const delivery = registry.resolveDelivery(handle);
  const docId = formatDocId("obsidian-fs", parsed.vault, parsed.path);

  const partial: Partial<Document> = {
    blocks: [{ kind: "paragraph", text: parsed.content }],
    properties: parsed.frontmatter ?? {},
  };
  const opts: { expectedHash?: string; clientId?: string } = {};
  if (parsed.expected_hash !== undefined) opts.expectedHash = parsed.expected_hash;
  if (parsed.client_id !== undefined) opts.clientId = parsed.client_id;

  const res = await delivery.write(docId, partial, opts);
  if (!res.ok) {
    // Preserve v1 conflict shape — handlers used to forward writeNote's
    // v1 WriteConflict directly; reshape to match. Phase 2 envelope fields
    // (sinkName / suggestion) are propagated unchanged when present so
    // callers receive actionable diagnostics on `sink_write_blocked` and
    // the other Phase 2 refusal codes.
    const out: Record<string, unknown> = {
      ok: false,
      reason: res.reason === "not_found" ? "hash_mismatch" : res.reason,
    };
    if (res.currentHash !== undefined) out.currentHash = res.currentHash;
    if (res.message !== undefined) out.message = res.message;
    if (res.sinkName !== undefined) out.sinkName = res.sinkName;
    if (res.suggestion !== undefined) out.suggestion = res.suggestion;
    if (res.key !== undefined) out.key = res.key;
    if (res.observedValue !== undefined) out.observedValue = res.observedValue;
    return out;
  }

  // Derive v1 noteId from the DB. The write went through writeNote
  // internally which upserts the note; getByPath returns the row.
  const noteRow = vault.db.notes.getByPath(parsed.path);
  return {
    ok: true,
    newHash: res.newHash,
    noteId: noteRow?.id ?? 0,
    created: res.created,
  };
}

/**
 * delete_note handler. Routes through `registry.resolveDelivery(handle).delete`
 * (plan 01-04 task 06). Preserves the v1 wire shape `{ok, newHash, noteId,
 * created}` (created=false for delete; newHash echoes the now-gone file's
 * pre-delete hash, matching v1 deleteNote semantics).
 */
async function handleDeleteNote(
  registry: AdapterRegistry,
  vault: Vault,
  parsed: {
    vault: string;
    path: string;
    expected_hash: string;
    client_id?: string;
  },
): Promise<object> {
  // Capture the v1 noteId + existing hash BEFORE we ask the delivery to
  // delete (after success, getByPath returns null).
  const noteRow = vault.db.notes.getByPath(parsed.path);
  const preDeleteHash = noteRow?.hash ?? parsed.expected_hash;

  const handle = parseSourceHandle(`obsidian-fs://${parsed.vault}`);
  const delivery = registry.resolveDelivery(handle);
  const docId = formatDocId("obsidian-fs", parsed.vault, parsed.path);

  const opts: { expectedHash?: string; clientId?: string } = {
    expectedHash: parsed.expected_hash,
  };
  if (parsed.client_id !== undefined) opts.clientId = parsed.client_id;

  const res = await delivery.delete(docId, opts);
  if (!res.ok) {
    const out: Record<string, unknown> = {
      ok: false,
      reason: res.reason === "not_found" ? "hash_mismatch" : res.reason,
    };
    if (res.currentHash !== undefined) out.currentHash = res.currentHash;
    if (res.message !== undefined) out.message = res.message;
    if (res.sinkName !== undefined) out.sinkName = res.sinkName;
    if (res.suggestion !== undefined) out.suggestion = res.suggestion;
    return out;
  }
  return {
    ok: true,
    newHash: preDeleteHash,
    noteId: noteRow?.id ?? 0,
    created: false,
  };
}

/**
 * Handler for the v0.10.0 `suggest_frontmatter` tool.
 *
 * Two-mode dispatch:
 *   - `path` provided → existing-note inference. Reads stored content +
 *     frontmatter + wikilinks from DB. Folder-conventions use the note's
 *     own folder.
 *   - `content` provided (no path) → draft inference. Folder-conventions
 *     use `folder_hint` (or vault root). No backlinks. Forward-link
 *     extraction would require a lightweight markdown parse — for v0.10.0
 *     we skip it to keep the tool dependency-free and document the
 *     limitation in the response.
 */
function handleSuggestFrontmatter(
  manager: VaultManager,
  parsed: {
    vault: string;
    path?: string;
    content?: string;
    title?: string;
    folder_hint?: string;
  },
): object {
  const vault = manager.require(parsed.vault);

  // Mode 1: existing-note path.
  if (parsed.path) {
    const note = vault.db.notes.getByPath(parsed.path);
    if (!note) {
      throw new Error(
        `Note not found: ${parsed.vault}/${parsed.path}. ` +
          `Use draft mode ({content, folder_hint}) for unindexed notes.`,
      );
    }
    const existingFm: Record<string, unknown> | null = note.frontmatter
      ? safeParseFrontmatter(note.frontmatter)
      : null;
    const result = suggestFrontmatter({
      vault,
      path: note.path,
      existingFrontmatter: existingFm,
      content: parsed.content ?? note.content,
      title: parsed.title ?? note.title ?? defaultBasename(note.path),
      excludePath: note.path,
    });
    return {
      mode: "existing",
      path: note.path,
      ...result,
    };
  }

  // Mode 2: draft.
  const folderHint = normalizeFolderHint(parsed.folder_hint);
  // Synthesize a path under the folder hint so folder-conventions can
  // resolve. The path itself never gets written; it's a probe.
  const probePath = `${folderHint}__draft__${Date.now()}.md`;
  const result = suggestFrontmatter({
    vault,
    path: probePath,
    existingFrontmatter: null,
    content: parsed.content!,
    title: parsed.title ?? "Draft",
    // Exclude the synthetic path explicitly — though it won't match any
    // existing note, this future-proofs against collisions.
    excludePath: probePath,
  });
  return {
    mode: "draft",
    folder_hint: folderHint,
    note: "Draft mode: no backlinks contributed. Provide `path` (and index the note first) for richer neighbor-inference.",
    ...result,
  };
}

export function makeNotesHandlers(deps: HandlerDeps): Partial<Record<ToolName, Handler>> {
  const { manager, adapterRegistry, suppression, memorySinkRegistry } = deps;
  return {
    read_note: async (a) => {
      const p = a as { vault: string; path: string };
      return handleReadNote(adapterRegistry, p.vault, p.path);
    },
    query_frontmatter: async (a) => {
      const p = a as { vault: string; where: Record<string, unknown>; limit: number };
      const vault = manager.require(p.vault);
      const hits = queryFrontmatter(vault, {
        where: p.where as Record<string, never>,
        limit: p.limit,
      });
      return {
        notes: hits.map((n) => ({
          path: n.path,
          title: n.title,
          frontmatter: n.frontmatter ? JSON.parse(n.frontmatter) : null,
          mtime: n.mtime,
        })),
        count: hits.length,
      };
    },
    write_note: async (a) => {
      const p = a as {
        vault: string;
        path: string;
        content: string;
        frontmatter?: Record<string, unknown> | null;
        expected_hash?: string;
        client_id?: string;
      };
      const vault = manager.require(p.vault);
      // Suppress the watcher event triggered by our own atomic rename.
      // We call suppression BEFORE delivery.write() so the event is
      // pre-filtered. Worst case (permission_denied / hash_mismatch):
      // we suppress an event that never fires — harmless beyond the
      // ~2s TTL.
      suppression.add(p.path);
      return handleWriteNote(adapterRegistry, vault, p);
    },
    update_frontmatter: async (a) => {
      const p = a as {
        vault: string;
        path: string;
        merge: Record<string, unknown>;
        expected_hash?: string;
        client_id?: string;
      };
      const vault = manager.require(p.vault);
      return updateFrontmatter({
        vault,
        registry: adapterRegistry,
        memorySinkRegistry,
        relativePath: p.path,
        merge: p.merge,
        ...(p.expected_hash !== undefined ? { expectedHash: p.expected_hash } : {}),
        ...(p.client_id !== undefined ? { clientId: p.client_id } : {}),
        onBeforeFsWrite: () => suppression.add(p.path),
      });
    },
    delete_note: async (a) => {
      const p = a as {
        vault: string;
        path: string;
        expected_hash: string;
        client_id?: string;
      };
      const vault = manager.require(p.vault);
      suppression.add(p.path);
      return handleDeleteNote(adapterRegistry, vault, p);
    },
    suggest_frontmatter: async (a) => {
      const p = a as {
        vault: string;
        path?: string;
        content?: string;
        title?: string;
        folder_hint?: string;
      };
      return handleSuggestFrontmatter(manager, p);
    },
  };
}
