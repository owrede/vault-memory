/**
 * Memory-sink sentinel mechanics.
 *
 * Per ADR-004 §"Sentinel file — `.memory-sink`", every folder serving
 * as a memory sink MUST contain a `.memory-sink` file at its root.
 * The handle parser refuses to resolve a sink against a folder that
 * lacks the sentinel. This module is the SOLE file licensed to call
 * `node:fs` for sentinel-write / sentinel-check work (ADR-002 I-2 +
 * I-3 confine `node:fs` and `node:path` to
 * `src/adapters/delivery/obsidian-fs/`).
 *
 * Provisioning policy (ADR-004 §"Provisioning"):
 *   - Empty folder OR folder with only sink-expected content
 *     (observations/, _briefs/, status-updates/, .memory-sink, *.md):
 *     write the sentinel.
 *   - Folder with unrelated user content: throw
 *     `SinkProvisioningError`. The user must either move the foreign
 *     content out or change the configured sink handle.
 *   - Sentinel already exists: no-op (idempotent).
 *   - Folder does not exist: create with `recursive: true`, then
 *     write the sentinel.
 *
 * Path joins go through `pathInSink` / `joinVaultPath` from this
 * directory's `path.ts` — the SOLE licensed `path.join` site for
 * sink/vault path resolution in Phase 2.
 */

import { promises as fs } from "node:fs";
import type { MemorySink } from "../../../types.js";
import { SENTINEL_FILENAME as SINK_SENTINEL_FILENAME } from "../../../memory/sink.js";
import { pathInSink } from "./path.js";

/** Re-export so `src/server.ts` / tests can import from this barrel. */
export const SENTINEL_FILENAME = SINK_SENTINEL_FILENAME;

/**
 * Provisioning error — thrown when a folder cannot be safely labeled as
 * a memory sink because it already contains unrelated user content.
 */
export class SinkProvisioningError extends Error {
  override readonly name = "SinkProvisioningError";
  readonly code = "SINK_PROVISION_UNSAFE";
  constructor(
    public readonly sinkName: string,
    public readonly absoluteFolderPath: string,
    public readonly offendingEntries: readonly string[],
  ) {
    super(
      `Memory sink "${sinkName}" target folder ${absoluteFolderPath} ` +
        `contains unrelated user content (${offendingEntries.join(", ")}). ` +
        `Refusing to label as a sink. Move user content out, or change the ` +
        `[[memory_sinks]] handle.`,
    );
  }
}

/**
 * Heuristic: returns true if an entry name "looks like" expected
 * memory-sink content. The Phase 2 list matches the Atlas fixture
 * structure (observations/, _briefs/, status-updates/) plus the
 * sentinel and any plain markdown file at the sink root. This is
 * intentionally narrow — anything else (txt, json, png, README, etc.)
 * trips the SinkProvisioningError so misconfiguration fails loudly.
 */
function isExpectedSinkContent(entry: string): boolean {
  if (entry === SENTINEL_FILENAME) return true;
  if (entry === "observations" || entry === "_briefs" || entry === "status-updates") {
    return true;
  }
  if (entry.endsWith(".md")) return true;
  return false;
}

/**
 * Build the three-line sentinel content per RESEARCH §Q10.
 * Format is informational only — the parser does not validate
 * contents; the *presence* of the file is the gate.
 */
function formatSentinelContent(args: { sinkName: string; version: string }): string {
  const ts = new Date().toISOString();
  return [
    `created_at: ${ts}`,
    `sink_name: ${args.sinkName}`,
    `vault_memory_version: ${args.version}`,
    "",
  ].join("\n");
}

/**
 * Provision (or no-op) a memory sink at `<vaultAbsolutePath>/<sink.resolveToRelativePath>`.
 *
 *   - If the sentinel already exists, return immediately.
 *   - If the folder does not exist, create it recursively and write the sentinel.
 *   - If the folder exists and is empty (or contains only expected content),
 *     write the sentinel.
 *   - If the folder exists and contains foreign content, throw `SinkProvisioningError`.
 */
export async function provisionSink(
  sink: MemorySink,
  vaultAbsolutePath: string,
  opts: { version: string },
): Promise<void> {
  const folder = pathInSink(vaultAbsolutePath, sink);
  const sentinelPath = pathInSink(vaultAbsolutePath, sink, SENTINEL_FILENAME);

  // Fast path: sentinel already in place.
  try {
    await fs.access(sentinelPath);
    return;
  } catch {
    // Sentinel missing — fall through to creation logic.
  }

  let folderExists = true;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(folder);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      folderExists = false;
    } else {
      throw err;
    }
  }

  if (!folderExists) {
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      sentinelPath,
      formatSentinelContent({ sinkName: sink.name, version: opts.version }),
      "utf-8",
    );
    return;
  }

  // Folder exists. Check it contains only expected sink content.
  const foreign = entries.filter((e) => !isExpectedSinkContent(e));
  if (foreign.length > 0) {
    throw new SinkProvisioningError(sink.name, folder, foreign);
  }
  await fs.writeFile(
    sentinelPath,
    formatSentinelContent({ sinkName: sink.name, version: opts.version }),
    "utf-8",
  );
}

/**
 * Return true iff the sentinel exists under the resolved sink folder.
 * Cheap (one `fs.access`) — safe to call on every write per ADR-004
 * §"Runtime check on every write".
 */
export async function assertSentinelExists(
  sink: MemorySink,
  vaultAbsolutePath: string,
): Promise<boolean> {
  const sentinelPath = pathInSink(vaultAbsolutePath, sink, SENTINEL_FILENAME);
  try {
    await fs.access(sentinelPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lower-level discovery probe used by server bootstrap auto-discovery
 * (Plan 02-03b). Returns true iff `<vaultRoot>/<relPath>/.memory-sink`
 * exists. Confined to this adapter directory because it touches `node:fs`
 * (ADR-002 I-2). Server bootstrap calls this through `joinVaultPath` so
 * the path-join stays inside the licensed adapter dir too.
 */
export async function sentinelExistsAt(
  vaultRoot: string,
  relPath: string,
): Promise<boolean> {
  // We intentionally do NOT use pathInSink here — auto-discovery probes a
  // candidate folder BEFORE any sink record exists, so the join must
  // operate on a plain relative path.
  const probe = `${vaultRoot.endsWith("/") ? vaultRoot.slice(0, -1) : vaultRoot}/${relPath.replace(/^\//, "")}/${SENTINEL_FILENAME}`;
  try {
    await fs.access(probe);
    return true;
  } catch {
    return false;
  }
}
