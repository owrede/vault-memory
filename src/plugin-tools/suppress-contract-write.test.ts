/**
 * suppress_contract_write tool tests — Phase 7 / Plan 07-07 / CAN-08.
 *
 * Behavior matrix (07-07-PLAN.md Task 2):
 *   (a) valid path + hash registers entry; subsequent consume(path, hash) returns true
 *   (b) invalid path (not under `_contracts/`) returns structured error
 *   (c) invalid hash format (not 64-hex) rejects via Zod
 *   (d) ttl bounds enforced (200..30000)
 */

import { describe, it, expect } from "vitest";
import { SuppressionSet } from "../adapters/change-feed/obsidian-fs/suppression.js";
import { suppressContractWriteTool } from "./suppress-contract-write.js";

const VALID_HASH = "a".repeat(64); // 64-hex sha256 placeholder

describe("suppress_contract_write tool (CAN-08)", () => {
  it("(a) valid path + hash registers an entry; consume with matching hash returns true", async () => {
    const suppression = new SuppressionSet({ ttlMs: 2000 });
    const result = await suppressContractWriteTool.handler(
      { path: "_contracts/foo.yaml", hash: VALID_HASH },
      { suppression },
    );
    expect(result).toEqual({ ok: true });
    expect(suppression.has("_contracts/foo.yaml")).toBe(true);
    expect(suppression.consume("_contracts/foo.yaml", VALID_HASH)).toBe(true);
  });

  it("(a2) honors ttl_ms override", async () => {
    const suppression = new SuppressionSet({ ttlMs: 100 });
    const result = await suppressContractWriteTool.handler(
      { path: "_contracts/bar.yaml", hash: VALID_HASH, ttl_ms: 5000 },
      { suppression },
    );
    expect(result).toEqual({ ok: true });
    expect(suppression.has("_contracts/bar.yaml")).toBe(true);
  });

  it("(b) invalid path (not under _contracts/) returns invalid_path error", async () => {
    const suppression = new SuppressionSet({ ttlMs: 2000 });
    const result = await suppressContractWriteTool.handler(
      { path: "notes/foo.yaml", hash: VALID_HASH },
      { suppression },
    );
    expect(result).toEqual({ ok: false, reason: "invalid_path", path: "notes/foo.yaml" });
    expect(suppression.size()).toBe(0);
  });

  it("(b2) invalid path (recursive _contracts/sub/foo.yaml) returns invalid_path error", async () => {
    const suppression = new SuppressionSet({ ttlMs: 2000 });
    const result = await suppressContractWriteTool.handler(
      { path: "_contracts/sub/foo.yaml", hash: VALID_HASH },
      { suppression },
    );
    expect(result).toEqual({
      ok: false,
      reason: "invalid_path",
      path: "_contracts/sub/foo.yaml",
    });
    expect(suppression.size()).toBe(0);
  });

  it("(b3) invalid path (wrong extension) returns invalid_path error", async () => {
    const suppression = new SuppressionSet({ ttlMs: 2000 });
    const result = await suppressContractWriteTool.handler(
      { path: "_contracts/foo.md", hash: VALID_HASH },
      { suppression },
    );
    expect(result).toEqual({
      ok: false,
      reason: "invalid_path",
      path: "_contracts/foo.md",
    });
    expect(suppression.size()).toBe(0);
  });

  it("(c) invalid hash (not 64-hex) rejects via Zod", () => {
    const parsed = suppressContractWriteTool.inputSchema.safeParse({
      path: "_contracts/foo.yaml",
      hash: "not-a-real-hex",
    });
    expect(parsed.success).toBe(false);
  });

  it("(c2) hash with non-hex characters rejects via Zod", () => {
    const parsed = suppressContractWriteTool.inputSchema.safeParse({
      path: "_contracts/foo.yaml",
      hash: "z".repeat(64),
    });
    expect(parsed.success).toBe(false);
  });

  it("(d) ttl_ms below 200 rejects via Zod", () => {
    const parsed = suppressContractWriteTool.inputSchema.safeParse({
      path: "_contracts/foo.yaml",
      hash: VALID_HASH,
      ttl_ms: 100,
    });
    expect(parsed.success).toBe(false);
  });

  it("(d2) ttl_ms above 30000 rejects via Zod", () => {
    const parsed = suppressContractWriteTool.inputSchema.safeParse({
      path: "_contracts/foo.yaml",
      hash: VALID_HASH,
      ttl_ms: 60_000,
    });
    expect(parsed.success).toBe(false);
  });
});
