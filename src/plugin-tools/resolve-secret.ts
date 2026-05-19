/**
 * resolve_secret — Phase 7 / Plan 07-04 / PLG-02, ADR-007 §D-CHROME-SECRETS.
 *
 * Receives plaintext from the plugin (which decrypted it via Electron
 * `safeStorage.decryptString(...)` inside the Obsidian renderer process) and
 * makes it available to the server-side `${secret:name}` substitution layer.
 *
 * Architectural rationale (RESEARCH §"Architectural Responsibility Map"):
 * `safeStorage` is an Electron-renderer API only reachable inside the
 * Obsidian process. The plugin owns ciphertext storage in `data.json` (per-
 * device ciphertext is the correct security posture per CONTEXT
 * D-CHROME-SECRETS); the server tool merely consumes the plaintext for
 * substitution and never logs it.
 *
 * Input shape:
 *   {name: string, ciphertext: string}         — plugin succeeded; field
 *                                                 carries plaintext-of-this-call
 *   {name: string, error: "safe_storage_unavailable" | "decrypt_failed"}
 *                                               — plugin reports decryption failure
 *
 * Output:
 *   {ok: true, plaintext: string}                                  — success
 *   {ok: false, reason: "safe_storage_unavailable", name}          — OS keyring missing
 *   {ok: false, reason: "decrypt_failed", name}                    — other failure
 *
 * SECURITY: response payload contains plaintext only — handler MUST NOT
 * include `name` in any log line at level >= info; debug-level logging must
 * redact the plaintext. Source-file scan in `resolve-secret.test.ts` enforces
 * that no logging statement references the secret value.
 *
 * # Adapter-seam discipline
 *
 * Imports only `zod` + sibling `errors.js`. Zero `fs`, `path`, `yaml`,
 * `chokidar`, MCP SDK, Electron.
 */

import { z } from "zod";

const ResolveSecretArgs = z
  .object({
    name: z
      .string()
      .min(1)
      .describe("Secret identifier referenced as `${secret:name}` in a contract."),
    ciphertext: z
      .string()
      .optional()
      .describe(
        "Plaintext-of-this-call (the plugin has already decrypted ciphertext " +
          "in-process via safeStorage). Field name preserved for provenance.",
      ),
    error: z
      .enum(["safe_storage_unavailable", "decrypt_failed"])
      .optional()
      .describe(
        "Plugin-side failure indicator. `safe_storage_unavailable` means " +
          "the OS keyring backend was missing; `decrypt_failed` covers any " +
          "other plugin-side decryption failure.",
      ),
  })
  .refine((v) => v.ciphertext !== undefined || v.error !== undefined, {
    message: "must provide either `ciphertext` or `error`",
  });

export type ResolveSecretInput = z.infer<typeof ResolveSecretArgs>;

export type ResolveSecretResult =
  | { ok: true; plaintext: string }
  | { ok: false; reason: "safe_storage_unavailable"; name: string }
  | { ok: false; reason: "decrypt_failed"; name: string };

async function handler(args: ResolveSecretInput): Promise<ResolveSecretResult> {
  if (args.error !== undefined) {
    return { ok: false, reason: args.error, name: args.name };
  }
  if (args.ciphertext === undefined) {
    // Defensive: Zod refine should have caught this; preserve a typed
    // fall-through so the discriminated-union remains exhaustive.
    return { ok: false, reason: "decrypt_failed", name: args.name };
  }
  // SECURITY: do not log or stringify `args.ciphertext` here.
  return { ok: true, plaintext: args.ciphertext };
}

export const resolveSecretTool = {
  name: "resolve_secret" as const,
  description:
    "Resolve a secret to plaintext for ${secret:name} substitution. The plugin " +
    "decrypts ciphertext in-process via Electron safeStorage; this tool consumes " +
    "the plaintext and never logs it. ADR-007 §D-CHROME-SECRETS.",
  inputSchema: ResolveSecretArgs,
  handler,
};
