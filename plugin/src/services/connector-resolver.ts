/**
 * connector-resolver — `${secret:name}` resolution layer for the
 * peer-MCP connector add/test flow.
 *
 * Phase 7 / 07-10 / PLG-05 / D-CHROME-CONNECTORS + D-CHROME-SECRETS.
 *
 * # Why this module exists
 *
 * The connector add/update flow (`set_mcp_client`) accepts an
 * `env_secrets` map whose values may contain `${secret:name}` references
 * (the kebab-name binds to a PLG-02 secret in `data.json`). At
 * peer-MCP-connect time, the server substitutes those references with
 * the plaintext value of the named secret.
 *
 * # The architectural responsibility map (RESEARCH §"Architectural Responsibility Map")
 *
 *   - **Plugin process** (Obsidian renderer): owns ciphertext storage in
 *     `data.json`; owns Electron `safeStorage` decryption (the API only
 *     lives in the renderer process).
 *   - **stdio**: plaintext-of-this-call crosses the wire — local, single
 *     OS user, no network.
 *   - **Server process**: receives plaintext via the `resolve_secret` MCP
 *     tool (07-04); substitutes it into the connector env at connect
 *     time; never logs the value.
 *
 * # The shape of resolution
 *
 *   resolveConnectorSecrets(envSecrets, deps) returns a fully-resolved
 *   `Record<string, string>` where every `${secret:name}` placeholder
 *   has been replaced with the plaintext from the server's
 *   `resolve_secret` response. The CALLER is responsible for passing
 *   the resolved map onward to `set_mcp_client` (the resolution layer
 *   itself does NOT call `set_mcp_client` — that is the panel's job).
 *
 * # Failure modes
 *
 *   - `secret_not_found`: the name has no entry in `SecretsStore`. The
 *     UI must route the user to Settings → Secrets to add it.
 *   - `safe_storage_unavailable`: the plugin-process decrypt failed
 *     (Electron `safeStorage` missing or backend mismatched between
 *     sync'd devices). The UI must prompt the user to re-enter the
 *     secret in Settings → Secrets. **There is NO plugin-side
 *     plaintext-fallback path** — per-device ciphertext is the
 *     intentional security posture (CONTEXT D-CHROME-SECRETS).
 *   - `decrypt_failed`: the server's `resolve_secret` returned
 *     `{ok:false, reason:"decrypt_failed"}`. Treated symmetrically to
 *     the safe_storage_unavailable path.
 *
 * # No partial returns
 *
 * One missing or undecryptable secret aborts the whole resolution. The
 * caller never sees a half-substituted map — either every reference
 * resolves or the resolver throws.
 *
 * # Reference syntax
 *
 * `${secret:name}` where `name` matches `[a-z][a-z0-9_-]{2,63}` (kebab-
 * compatible, 3–64 chars). Matches the `NAME_RE` contract in
 * `secrets-store.ts` so the same names round-trip between Settings →
 * Secrets and Connector env_secrets values.
 */

/**
 * Matches one `${secret:name}` reference. Name must start with a lower-
 * case letter, then 2–63 chars of [a-z0-9_-]. Total length 3–64. The
 * `g` flag is required for repeated `exec` / `match`-all in
 * extractSecretRefs.
 */
const SECRET_REF_RE = /\$\{secret:([a-z][a-z0-9_-]{2,63})\}/g;

/** The reasons resolution can fail. Mirrors `resolve-secret.ts` outputs + a plugin-side `secret_not_found`. */
export type SecretResolveReason =
  | "secret_not_found"
  | "decrypt_failed"
  | "safe_storage_unavailable";

/**
 * Thrown by `resolveConnectorSecrets` when any single secret reference
 * cannot be resolved. The Connectors panel UI surfaces a re-enter prompt
 * on `safe_storage_unavailable` (per CONTEXT D-CHROME-SECRETS) and a
 * route-to-Settings prompt on `secret_not_found`.
 */
export class SecretResolveError extends Error {
  override readonly name = "SecretResolveError" as const;
  readonly secretName: string;
  readonly reason: SecretResolveReason;
  constructor(args: { secretName: string; reason: SecretResolveReason }) {
    super(
      `Failed to resolve \${secret:${args.secretName}} — reason: ${args.reason}`,
    );
    this.secretName = args.secretName;
    this.reason = args.reason;
  }
}

/** Minimal surface of the PLG-02 SecretsStore the resolver depends on. */
export interface SecretsStoreLookup {
  getCiphertext(name: string): string | undefined;
}

/** Minimal surface of the plugin's SafeStorageAdapter the resolver depends on. */
export interface SafeStorageDecrypt {
  decrypt(ciphertextBase64: string): string;
}

/** Minimal surface of the MCP client the resolver depends on. */
export interface ResolverMcpClient {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

/** Dependency bundle for `resolveConnectorSecrets`. */
export interface ConnectorResolverDeps {
  secretsStore: SecretsStoreLookup;
  safeStorage: SafeStorageDecrypt;
  mcpClient: ResolverMcpClient;
}

/**
 * Extract the secret names from every `${secret:name}` placeholder in
 * `value`. Returns an empty array when no valid references are present.
 * Invalid placeholders (uppercase, leading digit, too short, unclosed)
 * are left as-is — they will not appear in the result.
 *
 * @example
 *   extractSecretRefs("foo${secret:api_key}bar") // ["api_key"]
 *   extractSecretRefs("${secret:a}${secret:b}")  // ["a", "b"]
 *   extractSecretRefs("${secret:API_KEY}")       // []  (uppercase)
 */
export function extractSecretRefs(value: string): readonly string[] {
  const names: string[] = [];
  // Re-create the regex each call so we don't share `lastIndex` across
  // invocations (the `g` flag makes `exec` stateful on the regex object).
  const re = new RegExp(SECRET_REF_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const name = m[1];
    if (name !== undefined) names.push(name);
  }
  return names;
}

/**
 * Server response shape for `resolve_secret` (kept loose — we only
 * inspect the discriminant fields).
 */
interface ResolveSecretResponse {
  ok?: boolean;
  plaintext?: string;
  reason?: string;
}

/**
 * Resolve every `${secret:name}` reference in `envSecrets`. Returns a
 * new map with all references substituted; throws `SecretResolveError`
 * on the first failed reference (no partial returns).
 *
 * Resolution per reference:
 *   1. Look up ciphertext via `secretsStore.getCiphertext(name)`.
 *      Missing → throw `{reason: "secret_not_found"}`.
 *   2. Decrypt ciphertext via `safeStorage.decrypt(...)` in the plugin
 *      process. Throws → catch and re-throw
 *      `{reason: "safe_storage_unavailable"}` (matches CONTEXT
 *      D-CHROME-SECRETS — no plaintext-fallback path).
 *   3. Call `mcpClient.callTool("resolve_secret", {name, ciphertext: plaintext})`.
 *      The field name `ciphertext` is preserved from the 07-04 input
 *      contract for provenance; the payload at this point is the
 *      plaintext-of-this-call (the plugin already decrypted). The
 *      server's response `{ok:true, plaintext}` carries the value we
 *      substitute into the placeholder.
 *
 * SECURITY: the returned map carries plaintext intended ONLY for
 * forwarding to `set_mcp_client`. Callers MUST NOT log or render the
 * values. The Connectors panel never returns this map to its template.
 */
export async function resolveConnectorSecrets(
  envSecrets: Record<string, string>,
  deps: ConnectorResolverDeps,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [envKey, rawValue] of Object.entries(envSecrets)) {
    const refs = extractSecretRefs(rawValue);
    if (refs.length === 0) {
      out[envKey] = rawValue;
      continue;
    }
    let substituted = rawValue;
    for (const name of refs) {
      const ciphertext = deps.secretsStore.getCiphertext(name);
      if (ciphertext === undefined) {
        throw new SecretResolveError({
          secretName: name,
          reason: "secret_not_found",
        });
      }
      let plaintext: string;
      try {
        plaintext = deps.safeStorage.decrypt(ciphertext);
      } catch {
        // Per CONTEXT D-CHROME-SECRETS: on safeStorage failure the user
        // is prompted to re-enter the secret in Settings → Secrets.
        // There is NO plaintext-fallback path on the plugin side.
        throw new SecretResolveError({
          secretName: name,
          reason: "safe_storage_unavailable",
        });
      }
      const resp = (await deps.mcpClient.callTool("resolve_secret", {
        name,
        // Field name `ciphertext` preserved from the 07-04 contract for
        // provenance; the value carried is plaintext-of-this-call.
        ciphertext: plaintext,
      })) as ResolveSecretResponse | undefined;
      if (!resp || resp.ok !== true || typeof resp.plaintext !== "string") {
        const reason =
          resp?.reason === "safe_storage_unavailable"
            ? "safe_storage_unavailable"
            : "decrypt_failed";
        throw new SecretResolveError({ secretName: name, reason });
      }
      // Replace every occurrence of THIS exact placeholder with the
      // resolved plaintext. Use a fresh regex per substitution to keep
      // `lastIndex` state local.
      const placeholderRe = new RegExp(
        `\\$\\{secret:${name.replace(/[-_]/g, (c) => `\\${c}`)}\\}`,
        "g",
      );
      substituted = substituted.replace(placeholderRe, resp.plaintext);
    }
    out[envKey] = substituted;
  }
  return out;
}
