/**
 * `MemorySinkRegistry` — the SOLE resolver for `MemorySink` handles
 * per ADR-004 §Resolution + ADR-002 §Registry M-1.
 *
 * Responsibilities:
 *   - Hold the runtime map of registered sinks keyed by handle.
 *   - Track the default sink (configured by `[memory].default_sink`
 *     in TOML, or the first registered sink as a fallback).
 *   - Provide name-OR-handle dual lookup via `resolveMemorySink`.
 *   - Expose `findSinkContaining(docId)` for entry-point Guard A
 *     refusals in v1 write tools (MEM-07).
 *
 * The registry is filesystem-ignorant: provisioning (sentinel writes)
 * is delegated to a `provisioner` callback supplied by the server
 * bootstrap. In production the callback wraps
 * `provisionSink(...)` from
 * `src/adapters/delivery/obsidian-fs/sentinel.ts`; in tests it is a
 * spy. This keeps `src/memory/` free of `node:fs` per ADR-002 I-2.
 *
 * The registry uses `decomposeDocId` from `src/adapters/registry.ts`
 * for splitting `DocId`s into `(scheme, authority, resource)` — no
 * ad-hoc regex. Handle-resource splitting uses a small private helper
 * because `MemorySinkHandle` is a distinct brand from `DocId`.
 */

import { decomposeDocId } from "../adapters/registry.js";
import { getContract } from "./contract/index.js";
import { parseMemorySinkHandle } from "./sink.js";
import type { DocId, MemorySink, MemorySinkHandle } from "../types.js";

/** TOML-shape entry from `[[memory_sinks]]`. Validated by config/loader.ts. */
export interface MemorySinkConfig {
  name: string;
  handle: string;
  contract: string;
}

/** Options for `registerMemorySinks`. */
export interface RegisterMemorySinksOptions {
  /** Resolve a vault name (handle authority) to the vault-absolute path. */
  resolveVaultAbsolutePath: (vaultName: string) => string;
  /** Name of the configured default sink (from `[memory].default_sink`). */
  defaultSinkName?: string;
  /**
   * Optional getter override (defaults to `getContract` from
   * `./contract/index.js`); test-injectable.
   */
  contractGetter?: (name: string) => { name: string };
  /**
   * Provision the sink on disk (writes the sentinel). In production
   * this wraps `provisionSink(...)` from
   * `src/adapters/delivery/obsidian-fs/sentinel.ts`; in tests it is
   * a spy. The registry must not import `node:fs` directly.
   */
  provisioner: (sink: MemorySink, vaultAbsolutePath: string) => Promise<void>;
}

/**
 * Split a `MemorySinkHandle` into `(scheme, authority, resource)`.
 * Pure string split — the handle is already validated by
 * `parseMemorySinkHandle` so the shape is guaranteed.
 */
function decomposeMemorySinkHandle(handle: MemorySinkHandle): {
  scheme: string;
  authority: string;
  resource: string;
} {
  const schemeEnd = handle.indexOf("://");
  const scheme = handle.slice(0, schemeEnd);
  const rest = handle.slice(schemeEnd + 3);
  const authoritySlash = rest.indexOf("/");
  const authority = rest.slice(0, authoritySlash);
  const resource = rest.slice(authoritySlash + 1);
  return { scheme, authority, resource };
}

export class MemorySinkRegistry {
  private readonly sinks = new Map<MemorySinkHandle, MemorySink>();
  /** Insertion order — used for the "first registered" default fallback. */
  private readonly order: MemorySinkHandle[] = [];
  private defaultHandle: MemorySinkHandle | null = null;

  /**
   * Register a batch of configured sinks. Validates each handle, looks
   * up the named contract, invokes the provisioner, and stores the
   * resolved `MemorySink` record.
   *
   * Throws on the first failure — server bootstrap should treat any
   * registration error as fatal per ADR-004 §Provisioning fail-fast.
   */
  async registerMemorySinks(
    configs: MemorySinkConfig[],
    opts: RegisterMemorySinksOptions,
  ): Promise<void> {
    const getC = opts.contractGetter ?? getContract;
    for (const cfg of configs) {
      const handle = parseMemorySinkHandle(cfg.handle);
      const parts = decomposeMemorySinkHandle(handle);
      if (parts.scheme !== "obsidian-fs") {
        throw new Error(
          `MemorySink "${cfg.name}" has unsupported scheme "${parts.scheme}". ` +
            `Phase 2 supports only obsidian-fs sinks.`,
        );
      }
      const vaultName = parts.authority;
      const resolveToRelativePath = parts.resource;
      const contract = getC(cfg.contract);
      const isFirst = this.sinks.size === 0;
      const isExplicitDefault = opts.defaultSinkName === cfg.name;
      const isDefault = isExplicitDefault || (opts.defaultSinkName === undefined && isFirst);
      const sink: MemorySink = {
        name: cfg.name,
        handle,
        vault: vaultName,
        resolveToRelativePath,
        contractName: contract.name,
        isDefault,
      };
      await opts.provisioner(sink, opts.resolveVaultAbsolutePath(vaultName));
      this.sinks.set(handle, sink);
      this.order.push(handle);
      if (isDefault) this.defaultHandle = handle;
    }
  }

  /** Return all registered sinks in insertion order. */
  listMemorySinks(): MemorySink[] {
    const out: MemorySink[] = [];
    for (const handle of this.order) {
      const s = this.sinks.get(handle);
      if (s) out.push(s);
    }
    return out;
  }

  /**
   * Resolve a sink by EITHER its short `name` OR its full handle
   * string. Throws with a helpful diagnostic on miss — mirrors the
   * `AdapterRegistry.resolveSource` message style.
   */
  resolveMemorySink(nameOrHandle: string): MemorySink {
    // Name lookup first (most common case).
    for (const handle of this.order) {
      const s = this.sinks.get(handle);
      if (s && s.name === nameOrHandle) return s;
    }
    // Then handle lookup (string-equal to a registered handle).
    for (const handle of this.order) {
      if (handle === nameOrHandle) {
        const s = this.sinks.get(handle);
        if (s) return s;
      }
    }
    const known =
      this.order
        .map((h) => this.sinks.get(h)?.name)
        .filter(Boolean)
        .join(", ") || "(none)";
    throw new Error(`Unknown memory sink: "${nameOrHandle}". Registered sinks: ${known}`);
  }

  /** Return the default sink. Throws if no sinks are registered. */
  getDefaultMemorySink(): MemorySink {
    if (this.defaultHandle === null) {
      throw new Error(
        "No memory sinks are registered; cannot resolve the default sink. " +
          "Configure [[memory_sinks]] in config.toml.",
      );
    }
    const sink = this.sinks.get(this.defaultHandle);
    if (!sink) {
      throw new Error(
        `Internal error: default memory sink handle "${this.defaultHandle}" not found in registry.`,
      );
    }
    return sink;
  }

  /**
   * Find the sink that encloses a given `DocId`, or `null` if the
   * DocId is outside every configured sink. Used by v1 write tools
   * (MEM-07) for entry-point Guard A refusals.
   *
   * Match policy: the DocId's authority must equal the sink's vault,
   * and the DocId's resource must start with the sink's
   * `resolveToRelativePath` (which includes its trailing slash, so
   * `_memory/observations/foo.md` matches sink `_memory/` but
   * `_memory-staging/...` does not).
   */
  findSinkContaining(docId: DocId): MemorySink | null {
    const { scheme, authority, resource } = decomposeDocId(docId);
    if (scheme !== "obsidian-fs") return null;
    for (const handle of this.order) {
      const sink = this.sinks.get(handle);
      if (!sink) continue;
      if (sink.vault !== authority) continue;
      if (resource.startsWith(sink.resolveToRelativePath)) {
        return sink;
      }
    }
    return null;
  }
}
