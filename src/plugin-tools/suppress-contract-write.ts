/**
 * suppress_contract_write — Phase 7 / Plan 07-07 / CAN-08, ADR-007 §D-WATCH-PLUGIN-OUT.
 *
 * Plugin-control MCP tool. Called by the contract editor's
 * `emitYamlCompanion` BEFORE every `.yaml` companion write so the
 * Phase 6 ContractRegistry ChangeFeed handler can recognize the
 * resulting filesystem event as "our own echo" and drop it silently.
 *
 * Workflow:
 *   1. Plugin computes `yamlBody = emitYaml(file)` via the 07-02 codec.
 *   2. Plugin computes `hash = sha256(yamlBody)` (SubtleCrypto in the
 *      renderer process).
 *   3. Plugin calls THIS tool with {path, hash}.
 *   4. Plugin writes the YAML via `app.vault.adapter.write(...)`.
 *   5. ChangeFeed observes the write → loader.ts hashes the on-disk
 *      body → `SuppressionSet.consume(path, hash)` returns true (match)
 *      → reload is skipped.
 *
 * # Input validation (THREAT-T-07-07-01 mitigation)
 *
 *   - `path`: must match `^_contracts/[^/]+\.yaml$` (non-recursive,
 *     Pitfall F3-aligned with the loader's `CONTRACT_PATH_REGEX`).
 *   - `hash`: 64-char lowercase hex (SHA-256 digest format).
 *   - `ttl_ms`: bounded 200..30_000 (defends THREAT-T-07-07-02 — a
 *     too-long TTL could swallow a legitimate later edit).
 *
 * Invalid paths return a structured `{ok: false, reason: "invalid_path"}`
 * result without registering a suppression entry. Zod schema failures
 * surface as exceptions caught by `syncPluginTools`'s wrapper and
 * returned as `isError: true` MCP responses.
 *
 * # Plugin-gating
 *
 * Like the other 5 plugin-control tools, this one only registers when
 * `[plugin] enabled = true` (D-MCP-SURFACE). The v1-baseline tools-list
 * snapshot stays byte-identical under the default-OFF gate.
 *
 * # Adapter-seam discipline
 *
 * Imports only `zod` + the sibling `SuppressionSet` type. Zero `fs`,
 * `path`, `yaml`, `chokidar`, MCP SDK.
 */

import { z } from "zod";
import type { SuppressionSet } from "../adapters/change-feed/obsidian-fs/suppression.js";

/**
 * `^_contracts/<name>.yaml$` — non-recursive, matches the loader's
 * `CONTRACT_PATH_REGEX` (Pitfall F3). Tools written for a contract
 * outside this shape are rejected with `invalid_path` rather than
 * silently registering a useless suppression entry.
 */
const CONTRACT_PATH_REGEX = /^_contracts\/[^/]+\.yaml$/;

const SuppressContractWriteArgs = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      "Vault-relative path of the YAML companion (e.g. `_contracts/foo.yaml`). " +
        "Non-recursive — `_contracts/sub/foo.yaml` is rejected with invalid_path.",
    ),
  hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "must be 64-char lowercase hex (SHA-256)")
    .describe(
      "SHA-256 of the YAML body the plugin is about to write. Used by the " +
        "ChangeFeed handler to distinguish echo events from real external edits.",
    ),
  ttl_ms: z
    .number()
    .int()
    .min(200)
    .max(30_000)
    .optional()
    .describe(
      "Suppression entry TTL in ms (default 2000). Bounded 200..30000 to " +
        "defend against an over-long entry swallowing a legitimate later edit.",
    ),
});

export type SuppressContractWriteInput = z.infer<
  typeof SuppressContractWriteArgs
>;

export interface SuppressContractWriteDeps {
  suppression: SuppressionSet;
}

export type SuppressContractWriteResult =
  | { ok: true }
  | { ok: false; reason: "invalid_path"; path: string };

async function handler(
  args: SuppressContractWriteInput,
  deps: SuppressContractWriteDeps,
): Promise<SuppressContractWriteResult> {
  const { path, hash, ttl_ms } = args;

  if (!CONTRACT_PATH_REGEX.test(path)) {
    return { ok: false, reason: "invalid_path", path };
  }

  deps.suppression.add(path, { hash, ttlMs: ttl_ms ?? 2000 });
  return { ok: true };
}

export const suppressContractWriteTool = {
  name: "suppress_contract_write" as const,
  description:
    "Register a hash-keyed suppression entry for an upcoming `.yaml` " +
    "companion write. The Phase 6 ContractRegistry ChangeFeed handler " +
    "uses this to distinguish plugin-driven echoes from external edits " +
    "(CAN-08 D-WATCH-PLUGIN-OUT). Plugin must call BEFORE writing.",
  inputSchema: SuppressContractWriteArgs,
  handler,
};
