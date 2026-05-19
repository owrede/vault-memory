/**
 * startContractRegistry — Phase 6 / D-LOAD, ADR-006 §Decision 7.
 *
 * Boot scan + ChangeFeed subscriber for `_contracts/<single>.yaml` files
 * (Pitfall F3 — non-recursive; `_contracts/memory/*.yaml` belongs to the
 * Phase 2 MemoryContract loader). On each event:
 *   - parse via `yaml@2.9 parseDocument(text).toJS()` (preserves comments
 *     on a later round-trip per CON-01);
 *   - Zod-validate via `ContractFileSchema`;
 *   - resolve `$ref` via `resolveRefs`;
 *   - build the cached input schema via `buildInputSchema`;
 *   - register via `ContractRegistry.set(name, parsed)` (first-wins per
 *     D-A1c — duplicate-name writes a `contract_load_error` audit row).
 *
 * Parse failures during a hot-reload event do NOT mutate the registry
 * (graceful degradation per D-LOAD): the prior version stays in place
 * and a `contract_load_error` audit row records the diagnostic.
 *
 * # Adapter-seam discipline
 *
 * Zero `fs` / `path.join` / `gray-matter` / `chokidar` imports. The loader
 * reads vault content exclusively through `SourceConnector.readDocument`
 * and `SourceConnector.listDocuments`; ChangeEvents arrive through the
 * `ChangeFeed.subscribe` seam. `yaml`'s `parseDocument` operates on text
 * already read by the source, not the filesystem.
 *
 * # Production end-to-end coverage (forward note)
 *
 * The existing Phase-1 `ObsidianFsSource` + `ObsidianFsChangeFeed` only
 * enumerate / watch `.md` files (see `scanner.ts:47` and `change-feed.ts:191`).
 * Until those adapters are widened to also surface `_contracts/*.yaml`,
 * the loader's boot scan + hot-reload paths only fire under tests (which
 * supply YAML-aware stubs). Server bootstrap wires the loader through
 * the existing seams so the registry, the audit table, and the
 * `register_contracts_as_tools` tool surface land in v2.0.0; widening
 * obsidian-fs to enumerate contract YAML is a follow-up tracked under
 * Phase 6 wave-4 (Plan 06-04). This file is the seam, not the surface.
 */

import { parseDocument } from "yaml";
import {
  CONTRACT_PATH_REGEX,
  type ParsedContract,
  type ContractInputs,
  type ContractStep,
  type ContractSourceDecl,
  type ContractSinkDecl,
  type WriteBackSpec,
} from "./types.js";
import { ContractFileSchema, type ContractFileShape } from "./schema.js";
import { buildInputSchema } from "./input-schema.js";
import { resolveRefs } from "./json-schema-ref.js";
import { ContractRegistry } from "./registry.js";
import { recordContractLoadError, type ContractAuditDeps } from "./audit.js";
import { decomposeDocId } from "../adapters/registry.js";
import { sha256 } from "../adapters/source/obsidian-fs/hash.js";
import type { SuppressionSet } from "../adapters/change-feed/obsidian-fs/suppression.js";
import type { Vault } from "../vault/index.js";
import type { SourceConnector } from "../adapters/source/types.js";
import type {
  ChangeFeed,
  ChangeEvent,
  Disposable,
} from "../adapters/change-feed/types.js";
import type { DocId, Document } from "../types.js";

/**
 * Discriminator for the `onRegistryChange` callback (test hook). Boot
 * scan fires `"boot"` once after the scan completes; ChangeFeed events
 * fire `"create"` | `"update"` | `"delete"` on successful registry
 * mutation. NOT fired on parse failures (graceful degradation).
 */
export type RegistryChangeKind = "boot" | "create" | "update" | "delete";

export interface StartContractRegistryOpts {
  vault: Vault;
  feed: ChangeFeed;
  source: SourceConnector;
  auditDeps: ContractAuditDeps;
  onRegistryChange?: (kind: RegistryChangeKind) => void;
  /**
   * Phase 7 / Plan 07-07 / CAN-08. Shared SuppressionSet from the server
   * bootstrap. When provided, `handleChangeEvent` calls
   * `suppression.consume(file, hash)` BEFORE re-validating; suppressed
   * events with a matching hash short-circuit (no reload, no audit row,
   * no `onExternalReload` fire). When omitted, behavior matches Phase 6
   * (every event re-validates).
   *
   * @see ../adapters/change-feed/obsidian-fs/suppression.ts — the
   *      hash-keyed `consume(path, hash)` semantics.
   */
  suppression?: SuppressionSet;
  /**
   * Phase 7 / Plan 07-07 / CAN-08. Fires AFTER a non-suppressed
   * create/update reload successfully re-registers the contract. The
   * server bootstrap uses this to emit the
   * `vault-memory://contracts/reloaded` MCP Resource notification so
   * the plugin's `ReloadNotifier` can surface an "External edit
   * detected — reload editor?" prompt without polling.
   *
   * Receives the contract file path (vault-relative `_contracts/<n>.yaml`).
   * NOT fired on parse failures, NOT fired on suppressed events, NOT
   * fired on delete (the plugin treats deletes as a separate concern).
   */
  onExternalReload?: (file: string) => void;
}

export interface StartedContractRegistry {
  registry: ContractRegistry;
  dispose: () => void;
}

/**
 * Boot scan + ChangeFeed subscription. Returns a `Disposable` that
 * unsubscribes the feed handler. Idempotent boot scan: even when the
 * ChangeFeed emits an initial `create` for every existing file
 * (Pitfall F5), the registry's first-wins policy prevents duplicate
 * entries — the second attempt yields a `contract_load_error` audit row
 * (latest-error-visible is the desired behavior per D-LOAD).
 */
export async function startContractRegistry(
  opts: StartContractRegistryOpts,
): Promise<StartedContractRegistry> {
  const registry = new ContractRegistry();

  // Closure-local map: contract file relative-path → registered contract
  // name. Used by `delete` / `rename` events to look up the registered
  // name (the file path is the only identity the ChangeFeed carries).
  const fileToName = new Map<string, string>();

  // ── Boot scan ─────────────────────────────────────────────────────────
  await bootScan(opts, registry, fileToName);
  opts.onRegistryChange?.("boot");

  // ── ChangeFeed subscription ───────────────────────────────────────────
  const sub: Disposable = opts.feed.subscribe(async (event: ChangeEvent) => {
    await handleChangeEvent(event, opts, registry, fileToName);
  });

  return {
    registry,
    dispose: () => sub[Symbol.dispose](),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Internal — boot scan
// ─────────────────────────────────────────────────────────────────────────

async function bootScan(
  opts: StartContractRegistryOpts,
  registry: ContractRegistry,
  fileToName: Map<string, string>,
): Promise<void> {
  for await (const ref of opts.source.listDocuments()) {
    const { resource } = decomposeDocId(ref.id);
    if (!CONTRACT_PATH_REGEX.test(resource)) continue;
    let text: string;
    try {
      const doc = await opts.source.readDocument(ref.id);
      text = extractText(doc);
    } catch (err) {
      recordContractLoadError(opts.auditDeps, {
        file: resource,
        error_message: messageOf(err),
        vault: opts.vault.config.name,
      });
      continue;
    }
    parseAndRegister(text, resource, opts, registry, fileToName);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Internal — ChangeFeed handler
// ─────────────────────────────────────────────────────────────────────────

async function handleChangeEvent(
  event: ChangeEvent,
  opts: StartContractRegistryOpts,
  registry: ContractRegistry,
  fileToName: Map<string, string>,
): Promise<void> {
  // Rename — adapter-native rename event. Handle as delete-old + create-new.
  // Renames are NOT suppression candidates (the plugin's YAML emit never
  // emits a rename event — only a create/update on the YAML path) so we
  // skip the suppression check here. `onExternalReload` does NOT fire on
  // rename; the plugin's open .contract view stays bound to its own
  // file path and the user's intent is unambiguous when they rename.
  if (event.kind === "rename") {
    const oldResource = decomposeDocId(event.old_id).resource;
    const newResource = decomposeDocId(event.new_id).resource;
    if (CONTRACT_PATH_REGEX.test(oldResource)) {
      deleteByFile(oldResource, registry, fileToName, opts);
    }
    if (CONTRACT_PATH_REGEX.test(newResource)) {
      await loadFromFeed(event.new_id, newResource, opts, registry, fileToName);
      opts.onRegistryChange?.("update");
    } else if (CONTRACT_PATH_REGEX.test(oldResource)) {
      // Renamed OUT of `_contracts/` — pure delete.
      opts.onRegistryChange?.("delete");
    }
    return;
  }

  const { resource } = decomposeDocId(event.id);
  if (!CONTRACT_PATH_REGEX.test(resource)) return;

  switch (event.kind) {
    case "delete": {
      if (deleteByFile(resource, registry, fileToName, opts)) {
        opts.onRegistryChange?.("delete");
      }
      return;
    }
    case "create":
    case "update": {
      // Phase 7 / CAN-08 — hash-keyed echo suppression. Read the on-disk
      // body once, compute SHA-256, and ask the SuppressionSet whether
      // this event is the echo of a plugin-driven write. If yes, drop
      // silently (no audit row, no registry mutation, no callback fire).
      // If no, fall through to the existing re-validate path.
      //
      // We read the body here (rather than inside loadFromFeed) because
      // the suppression check needs the hash up-front. The body is
      // re-used downstream so the read isn't wasted.
      let text: string;
      try {
        const doc = await opts.source.readDocument(event.id);
        text = extractText(doc);
      } catch (err) {
        recordContractLoadError(opts.auditDeps, {
          file: resource,
          error_message: messageOf(err),
          vault: opts.vault.config.name,
        });
        return;
      }

      if (opts.suppression !== undefined) {
        const hash = sha256(text);
        if (opts.suppression.consume(resource, hash)) {
          // Echo of an own-write — drop silently per CAN-08 D-WATCH-PLUGIN-OUT.
          return;
        }
      }

      // For `update` semantics, drop the prior registration of this file
      // first so the new YAML can re-register (D-LOAD replace).
      if (event.kind === "update") {
        deleteByFile(resource, registry, fileToName, opts);
      }
      const ok = parseAndRegister(text, resource, opts, registry, fileToName);
      if (ok) {
        opts.onRegistryChange?.(event.kind);
        // CAN-08 D-WATCH-SERVER-NOTIFY — surface non-suppressed
        // external edits to subscribers (the plugin's ReloadNotifier).
        opts.onExternalReload?.(resource);
      }
      return;
    }
  }
}

/**
 * Delete the contract previously registered from `file` (if any).
 * Returns true iff something was removed.
 */
function deleteByFile(
  file: string,
  registry: ContractRegistry,
  fileToName: Map<string, string>,
  _opts: StartContractRegistryOpts,
): boolean {
  const name = fileToName.get(file);
  if (name === undefined) return false;
  registry.delete(name);
  fileToName.delete(file);
  return true;
}

/**
 * Read + parse + register the YAML at `id` (a DocId whose resource is
 * `file`). On any failure, write `contract_load_error` and return false;
 * the registry stays unmutated (D-LOAD graceful degradation).
 */
async function loadFromFeed(
  id: DocId,
  file: string,
  opts: StartContractRegistryOpts,
  registry: ContractRegistry,
  fileToName: Map<string, string>,
): Promise<boolean> {
  let text: string;
  try {
    const doc = await opts.source.readDocument(id);
    text = extractText(doc);
  } catch (err) {
    recordContractLoadError(opts.auditDeps, {
      file,
      error_message: messageOf(err),
      vault: opts.vault.config.name,
    });
    return false;
  }
  return parseAndRegister(text, file, opts, registry, fileToName);
}

// ─────────────────────────────────────────────────────────────────────────
// Internal — parse + register
// ─────────────────────────────────────────────────────────────────────────

/**
 * Parse `text` as a YAML contract; validate; register. Writes
 * `contract_load_error` on any failure path (parse error, Zod failure,
 * duplicate name). Returns true iff `registry.set` succeeded.
 */
function parseAndRegister(
  text: string,
  file: string,
  opts: StartContractRegistryOpts,
  registry: ContractRegistry,
  fileToName: Map<string, string>,
): boolean {
  let parsed: ParsedContract;
  try {
    const docNode = parseDocument(text);
    const raw = docNode.toJS();
    const validated = ContractFileSchema.safeParse(raw);
    if (!validated.success) {
      throw new Error(`zod: ${JSON.stringify(validated.error.format())}`);
    }
    parsed = buildParsedContract(validated.data);
  } catch (err) {
    recordContractLoadError(opts.auditDeps, {
      file,
      error_message: messageOf(err),
      vault: opts.vault.config.name,
    });
    return false;
  }

  const result = registry.set(parsed.name, parsed);
  if (!result.ok) {
    recordContractLoadError(opts.auditDeps, {
      file,
      error_message: `duplicate_name: '${parsed.name}' already registered (first-wins per D-A1c)`,
      vault: opts.vault.config.name,
    });
    return false;
  }
  fileToName.set(file, parsed.name);
  return true;
}

/**
 * Compose a ParsedContract from validated YAML data. Builds the cached
 * Zod + JSON Schema (Pitfall F1/F2 chokepoint) and resolves $ref in
 * `output_shape` (D-A3a).
 */
function buildParsedContract(data: ContractFileShape): ParsedContract {
  const inputs: ContractInputs = data.inputs as ContractInputs;
  const required = data.required;
  const built = buildInputSchema(inputs, required);
  const outputShape =
    data.output_shape !== undefined
      ? (resolveRefs(data.output_shape) as object)
      : undefined;

  // Narrow the optional shapes from the Zod-defaulted shape to the
  // ParsedContract surface. The Zod `HandleDeclSchema` fills `required`
  // with a boolean default; same shape on both sides.
  const sources = data.sources as Record<string, ContractSourceDecl>;
  const sinks = data.sinks as Record<string, ContractSinkDecl>;
  const assembly = data.assembly as ContractStep[];
  const writeBack = data.write_back as WriteBackSpec | undefined;

  const result: ParsedContract = {
    version: 1,
    name: data.name,
    description: data.description,
    inputs,
    required,
    sources,
    sinks,
    assembly,
    inputZodSchema: built.zodSchema,
    inputJsonSchema: built.jsonSchema,
  };
  if (outputShape !== undefined) result.output_shape = outputShape;
  if (writeBack !== undefined) result.write_back = writeBack;
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Internal — text extraction
// ─────────────────────────────────────────────────────────────────────────

/**
 * Extract the raw YAML text from a `Document`. The obsidian-fs source
 * publishes content as a single `paragraph` block (`blocks[0].text`);
 * future block-shaped adapters can populate the same field. Throws if
 * the Document has no block content — caller writes a load error.
 */
function extractText(doc: Document): string {
  const block = doc.blocks[0];
  if (block === undefined) {
    throw new Error("Document has no blocks (cannot read contract YAML)");
  }
  if (block.kind === "paragraph") return block.text;
  // For future block-shaped adapters, fall back to concatenating
  // paragraph blocks. Today no other adapter produces non-paragraph
  // contract documents.
  const paragraphs = doc.blocks.filter(
    (b): b is { kind: "paragraph"; text: string } => b.kind === "paragraph",
  );
  if (paragraphs.length === 0) {
    throw new Error("Document blocks contain no paragraph text");
  }
  return paragraphs.map((b) => b.text).join("\n");
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
