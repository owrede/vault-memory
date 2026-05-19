/**
 * Tests for the connector-resolver service.
 *
 * Phase 7 / 07-10 / PLG-05 / D-CHROME-CONNECTORS + D-CHROME-SECRETS.
 *
 * The resolver is the seam between:
 *   - PLG-02's `SecretsStore` (ciphertext lookup by name; per-device
 *     ciphertext is the correct security posture per CONTEXT
 *     D-CHROME-SECRETS).
 *   - the renderer-process `SafeStorageAdapter.decrypt(...)` call
 *     (RESEARCH §"Architectural Responsibility Map" — `safeStorage` is
 *     only reachable inside the Obsidian renderer).
 *   - the server-side `resolve_secret` MCP tool, which receives the
 *     plaintext-of-this-call and returns it as the substituted value.
 *
 * The plugin never returns plaintext to the calling UI; the resolver
 * exists purely to bundle the (name, plaintext) pair for the server to
 * substitute at peer-MCP connect time. On `safe_storage_unavailable` the
 * UI MUST prompt the user to re-enter the secret in Settings → Secrets —
 * there is no plugin-side plaintext-fallback path (CONTEXT D-CHROME-SECRETS).
 */

import { describe, expect, it, vi } from "vitest";
import {
  extractSecretRefs,
  resolveConnectorSecrets,
  SecretResolveError,
  type ConnectorResolverDeps,
} from "./connector-resolver.js";

/** Build a fake deps trio for resolveConnectorSecrets. */
function makeDeps(
  overrides: Partial<{
    ciphertexts: Record<string, string>;
    decrypt: (ct: string) => string;
    callTool: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<unknown>;
  }> = {},
): {
  deps: ConnectorResolverDeps;
  callTool: ReturnType<typeof vi.fn>;
  decrypt: ReturnType<typeof vi.fn>;
} {
  const ciphertexts = overrides.ciphertexts ?? { api_key: "ct-of-api_key" };
  const decrypt = vi.fn(
    overrides.decrypt ?? ((ct: string) => `plain-of-${ct}`),
  );
  const callTool = vi.fn(
    overrides.callTool ??
      (async (_n: string, args: Record<string, unknown>) => ({
        ok: true,
        plaintext: args["ciphertext"],
      })),
  );
  const deps: ConnectorResolverDeps = {
    secretsStore: {
      getCiphertext: (name: string) => ciphertexts[name],
    },
    safeStorage: {
      decrypt: decrypt as unknown as (ct: string) => string,
    },
    mcpClient: {
      callTool: callTool as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<unknown>,
    },
  };
  return { deps, callTool, decrypt };
}

describe("extractSecretRefs", () => {
  it("(a) returns the secret name inside a `${secret:name}` placeholder", () => {
    expect(extractSecretRefs("foo${secret:api_key}bar")).toEqual(["api_key"]);
  });

  it("(b) returns multiple secret names from a value with multiple placeholders", () => {
    expect(extractSecretRefs("${secret:abc}${secret:xyz_1}")).toEqual([
      "abc",
      "xyz_1",
    ]);
  });

  it("(f) leaves malformed placeholders alone — only kebab-style names match the regex", () => {
    // Uppercase, leading digit, too short, and unclosed braces are all
    // ignored. `\${secret:...}` with invalid name → no match.
    expect(extractSecretRefs("${secret:API_KEY}")).toEqual([]);
    expect(extractSecretRefs("${secret:1abc}")).toEqual([]);
    expect(extractSecretRefs("${secret:ab}")).toEqual([]); // too short (min 3 chars)
    expect(extractSecretRefs("${secret:abc")).toEqual([]); // unclosed
    expect(extractSecretRefs("plain string with no refs")).toEqual([]);
  });
});

describe("resolveConnectorSecrets — happy paths", () => {
  it("(c) decrypts ciphertext and forwards plaintext to resolve_secret, substituting in-place", async () => {
    const { deps, callTool, decrypt } = makeDeps();
    const result = await resolveConnectorSecrets(
      { OPENAI_KEY: "${secret:api_key}" },
      deps,
    );
    expect(result).toEqual({ OPENAI_KEY: "plain-of-ct-of-api_key" });
    // Plugin process decrypted ciphertext via safeStorage.
    expect(decrypt).toHaveBeenCalledWith("ct-of-api_key");
    // Plaintext was forwarded to the server's resolve_secret tool. The
    // `ciphertext` field name is preserved from the 07-04 contract; the
    // payload at this point is plaintext-of-this-call (the plugin has
    // already decrypted in-process via safeStorage).
    expect(callTool).toHaveBeenCalledWith("resolve_secret", {
      name: "api_key",
      ciphertext: "plain-of-ct-of-api_key",
    });
  });

  it("substitutes every placeholder in a value with multiple refs", async () => {
    const { deps } = makeDeps({
      ciphertexts: { a: "ct-a", b: "ct-b" },
    });
    const result = await resolveConnectorSecrets(
      { COMBO: "left-${secret:a}-mid-${secret:b}-right" },
      deps,
    );
    expect(result).toEqual({
      COMBO: "left-plain-of-ct-a-mid-plain-of-ct-b-right",
    });
  });

  it("passes through env-secret values with no placeholders unchanged", async () => {
    const { deps, callTool } = makeDeps();
    const result = await resolveConnectorSecrets(
      { PLAIN_VAR: "no-secret-here" },
      deps,
    );
    expect(result).toEqual({ PLAIN_VAR: "no-secret-here" });
    expect(callTool).not.toHaveBeenCalled();
  });
});

describe("resolveConnectorSecrets — error paths", () => {
  it("(d) throws SecretResolveError{secret_not_found} when ciphertext is missing", async () => {
    const { deps } = makeDeps({ ciphertexts: {} });
    await expect(
      resolveConnectorSecrets({ K: "${secret:nope}" }, deps),
    ).rejects.toMatchObject({
      name: "SecretResolveError",
      reason: "secret_not_found",
      secretName: "nope",
    });
  });

  it("(e) throws SecretResolveError{safe_storage_unavailable} when safeStorage.decrypt throws", async () => {
    const { deps } = makeDeps({
      decrypt: () => {
        throw new Error("DecryptFailedError: backend mismatch");
      },
    });
    await expect(
      resolveConnectorSecrets({ K: "${secret:api_key}" }, deps),
    ).rejects.toMatchObject({
      name: "SecretResolveError",
      reason: "safe_storage_unavailable",
      secretName: "api_key",
    });
  });

  it("throws SecretResolveError{decrypt_failed} when the server reports decrypt_failed", async () => {
    const { deps } = makeDeps({
      callTool: async () => ({ ok: false, reason: "decrypt_failed", name: "api_key" }),
    });
    await expect(
      resolveConnectorSecrets({ K: "${secret:api_key}" }, deps),
    ).rejects.toMatchObject({
      name: "SecretResolveError",
      reason: "decrypt_failed",
      secretName: "api_key",
    });
  });

  it("aborts entirely on the first failed reference — partial plaintext is never returned", async () => {
    let calls = 0;
    const { deps, callTool } = makeDeps({
      ciphertexts: { good: "ct-good", bad: "ct-bad" },
      decrypt: (ct: string) => {
        calls++;
        if (ct === "ct-bad")
          throw new Error("DecryptFailedError: corrupted blob");
        return `plain-of-${ct}`;
      },
    });
    await expect(
      resolveConnectorSecrets(
        { A: "${secret:good}", B: "${secret:bad}" },
        deps,
      ),
    ).rejects.toMatchObject({
      name: "SecretResolveError",
      reason: "safe_storage_unavailable",
      secretName: "bad",
    });
    // Whether `good` got called or not, the caller never sees a partial
    // map — the rejection means no resolved object is returned.
    expect(calls).toBeGreaterThan(0);
    // resolve_secret may have fired for `good` before `bad` failed; the
    // contract is "no partial RETURN", not "no partial side effect".
    expect(callTool).not.toHaveBeenCalledWith("resolve_secret", {
      name: "bad",
      ciphertext: expect.anything(),
    });
  });
});

describe("SecretResolveError", () => {
  it("carries {secretName, reason} fields and a human-readable message", () => {
    const err = new SecretResolveError({
      secretName: "stripe",
      reason: "secret_not_found",
    });
    expect(err.name).toBe("SecretResolveError");
    expect(err.secretName).toBe("stripe");
    expect(err.reason).toBe("secret_not_found");
    expect(err.message).toMatch(/stripe/);
    expect(err.message).toMatch(/secret_not_found/);
  });
});
