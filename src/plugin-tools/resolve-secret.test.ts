/**
 * Unit tests for `resolve_secret` MCP tool (PLG-02).
 *
 * Per ADR-007 §D-CHROME-SECRETS: the plugin owns ciphertext storage in
 * `data.json`; on a resolve request the plugin reads ciphertext, calls
 * `safeStorage.decryptString(...)` IN THE PLUGIN PROCESS, then passes the
 * resulting plaintext to the server tool over the local stdio MCP transport.
 * The server tool consumes the plaintext for `${secret:name}` substitution
 * and never logs it.
 *
 * The `ciphertext` field carries the plaintext-as-of-this-call (the plugin
 * has already decrypted it). The field name is preserved for provenance
 * clarity.
 *
 * Asserts:
 *   - happy path: input plaintext → output plaintext (echoed for substitution)
 *   - validation failure: Zod rejects malformed input
 *   - safeStorage-unavailable failure → reason='safe_storage_unavailable'
 *   - decrypt_failed failure → reason='decrypt_failed'
 *   - source file contains NO `console.log` referencing the plaintext value
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSecretTool } from "./resolve-secret.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("resolve_secret tool (PLG-02)", () => {
  it("declares the expected MCP tool surface", () => {
    expect(resolveSecretTool.name).toBe("resolve_secret");
    expect(typeof resolveSecretTool.description).toBe("string");
    expect(resolveSecretTool.inputSchema).toBeDefined();
  });

  it("happy path: returns the plaintext supplied by the plugin", async () => {
    const result = await resolveSecretTool.handler({
      name: "GITHUB_TOKEN",
      ciphertext: "ghp_secretvalue123",
    });
    expect(result).toEqual({ ok: true, plaintext: "ghp_secretvalue123" });
  });

  it("safe_storage_unavailable: reason='safe_storage_unavailable'", async () => {
    const result = await resolveSecretTool.handler({
      name: "GITHUB_TOKEN",
      error: "safe_storage_unavailable",
    });
    expect(result).toEqual({
      ok: false,
      reason: "safe_storage_unavailable",
      name: "GITHUB_TOKEN",
    });
  });

  it("decrypt_failed: reason='decrypt_failed'", async () => {
    const result = await resolveSecretTool.handler({
      name: "GITHUB_TOKEN",
      error: "decrypt_failed",
    });
    expect(result).toEqual({
      ok: false,
      reason: "decrypt_failed",
      name: "GITHUB_TOKEN",
    });
  });

  it("Zod rejects payload with neither ciphertext nor error", () => {
    const parsed = resolveSecretTool.inputSchema.safeParse({ name: "X" });
    expect(parsed.success).toBe(false);
  });

  it("Zod rejects missing `name`", () => {
    const parsed = resolveSecretTool.inputSchema.safeParse({
      ciphertext: "abc",
    });
    expect(parsed.success).toBe(false);
  });

  it("Zod rejects empty `name`", () => {
    const parsed = resolveSecretTool.inputSchema.safeParse({
      name: "",
      ciphertext: "abc",
    });
    expect(parsed.success).toBe(false);
  });

  it("source file contains NO `console.log` referencing the plaintext value", () => {
    // Defensive scan: forbid any `console.log` invocation that could leak
    // the plaintext. We deliberately scan the SOURCE (not just runtime
    // behavior) so the SECURITY invariant is structurally enforced.
    const src = readFileSync(join(__dirname, "resolve-secret.ts"), "utf-8");
    // Allow `console.log` to be entirely absent. If present anywhere, the
    // source must not reference `plaintext`/`ciphertext` in the same line.
    const lines = src.split("\n");
    for (const line of lines) {
      if (!line.includes("console.log")) continue;
      expect(line).not.toMatch(/plaintext|ciphertext/);
    }
  });
});
