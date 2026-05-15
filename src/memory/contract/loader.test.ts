/**
 * Unit tests for `src/memory/contract/loader.ts` + `index.ts`
 * (`getContract` / `loadContractFromDisk`).
 *
 * Covers:
 *   - `getContract("default-memory-v1")` returns DEFAULT_MEMORY_V1 without
 *     disk I/O.
 *   - `getContract("unknown")` throws with a registered-name list.
 *   - `loadContractFromDisk(name, vaultPath)` reads the YAML file,
 *     parses + validates it, returns a `MemoryContract` with a built
 *     Zod `propertiesSchema`.
 *   - Missing file → `MemoryContractNotFoundError`.
 *   - Malformed YAML → `MemoryContractInvalidError` with file path in
 *     the message.
 *   - Cache hit: second call returns the same object reference.
 *   - The shipped `_contracts/memory/default-memory-v1.yaml` round-trips:
 *     loading it via loadContractFromDisk produces a schema equivalent
 *     to DEFAULT_MEMORY_V1 (validates the same example doc).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getContract,
  loadContractFromDisk,
  DEFAULT_MEMORY_V1,
  MemoryContractInvalidError,
  MemoryContractNotFoundError,
  __clearContractCache,
} from "./index.js";
import { __clearContractCache as __clearLoaderCacheNoReseed } from "./loader.js";

describe("getContract", () => {
  it('returns DEFAULT_MEMORY_V1 for name "default-memory-v1"', () => {
    const c = getContract("default-memory-v1");
    expect(c).toBe(DEFAULT_MEMORY_V1);
  });

  it("throws on an unknown contract name with a helpful diagnostic", () => {
    expect(() => getContract("does-not-exist")).toThrow(/does-not-exist/);
    expect(() => getContract("does-not-exist")).toThrow(/default-memory-v1/);
  });
});

describe("loadContractFromDisk", () => {
  let tmpVault: string;

  beforeEach(async () => {
    tmpVault = await mkdtemp(join(tmpdir(), "vm-contract-"));
    __clearContractCache();
  });

  async function seedContract(filename: string, body: string): Promise<string> {
    const dir = join(tmpVault, "_contracts", "memory");
    await mkdir(dir, { recursive: true });
    const path = join(dir, filename);
    await writeFile(path, body, "utf-8");
    return path;
  }

  it("reads a YAML contract, validates it, returns a MemoryContract", async () => {
    await seedContract(
      "brief-memory-v1.yaml",
      [
        "name: brief-memory-v1",
        "version: '1.0'",
        "required_properties:",
        "  source: { type: string, allowed: [agent, user, imported] }",
        "  confidence: { type: string, allowed: [direct, inferred, uncertain] }",
        "  observed_at: { type: datetime }",
        "  type: { type: string, min_length: 1 }",
        "naming:",
        "  strategy: date-slug",
        "  pattern: '{observed_at:YYYY-MM-DD}-{slug}.md'",
      ].join("\n"),
    );
    const c = await loadContractFromDisk("brief-memory-v1", tmpVault);
    expect(c.name).toBe("brief-memory-v1");
    expect(c.version).toBe("1.0");
    expect(c.requiredKeys).toEqual(["source", "confidence", "observed_at", "type"]);
    expect(c.naming.strategy).toBe("date-slug");
    const parsed = c.propertiesSchema.safeParse({
      source: "agent",
      confidence: "direct",
      observed_at: "2026-04-16T10:00:00Z",
      type: "brief",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a contract missing required_properties (Zod validation)", async () => {
    await seedContract(
      "bad-contract.yaml",
      ["name: bad-contract", "naming:", "  strategy: caller-provided"].join("\n"),
    );
    await expect(loadContractFromDisk("bad-contract", tmpVault)).rejects.toBeInstanceOf(
      MemoryContractInvalidError,
    );
  });

  it("throws MemoryContractNotFoundError for a missing file", async () => {
    await expect(loadContractFromDisk("absent", tmpVault)).rejects.toBeInstanceOf(
      MemoryContractNotFoundError,
    );
  });

  it("throws MemoryContractInvalidError with file path on malformed YAML", async () => {
    const path = await seedContract(
      "malformed.yaml",
      "this: is: not: valid: yaml: at all\n  - [{unbalanced",
    );
    try {
      await loadContractFromDisk("malformed", tmpVault);
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MemoryContractInvalidError);
      expect((err as Error).message).toContain(path);
    }
  });

  it("caches loaded contracts (second call returns the same instance)", async () => {
    await seedContract(
      "cached.yaml",
      [
        "name: cached",
        "required_properties:",
        "  source: { type: string, allowed: [agent] }",
        "naming:",
        "  strategy: caller-provided",
      ].join("\n"),
    );
    const a = await loadContractFromDisk("cached", tmpVault);
    const b = await loadContractFromDisk("cached", tmpVault);
    expect(a).toBe(b);
  });

  it("after disk load, getContract('<loaded-name>') returns the cached contract", async () => {
    await seedContract(
      "lookup-after-load.yaml",
      [
        "name: lookup-after-load",
        "required_properties:",
        "  source: { type: string, allowed: [agent] }",
        "naming:",
        "  strategy: caller-provided",
      ].join("\n"),
    );
    const loaded = await loadContractFromDisk("lookup-after-load", tmpVault);
    expect(getContract("lookup-after-load")).toBe(loaded);
  });
});

describe("shipped _contracts/memory/default-memory-v1.yaml", () => {
  beforeEach(() => {
    // Clear WITHOUT re-seeding the hardcoded baseline — we want the
    // loader to hit disk so the shipped YAML is exercised.
    __clearLoaderCacheNoReseed();
  });

  it("loads and validates the same canonical observation as DEFAULT_MEMORY_V1", async () => {
    // The shipped file lives at the repo root. Treat the cwd as the
    // "vault path" — the loader resolves
    // `<vaultPath>/_contracts/memory/default-memory-v1.yaml`.
    const loaded = await loadContractFromDisk("default-memory-v1", process.cwd());
    expect(loaded.name).toBe("default-memory-v1");
    expect(loaded.requiredKeys).toEqual(
      expect.arrayContaining(DEFAULT_MEMORY_V1.requiredKeys),
    );
    const observation = {
      source: "agent",
      confidence: "direct",
      evidence: ["obsidian-fs://atlas/projects/Atlas-1.md"],
      status: "active",
      observed_at: "2026-04-16T10:00:00Z",
      superseded_by: null,
      type: "observation",
    };
    expect(loaded.propertiesSchema.safeParse(observation).success).toBe(true);
  });
});

describe("yaml@2.9.x and zod@4.x runtime availability", () => {
  it("imports both packages without throwing", async () => {
    const yaml = await import("yaml");
    const zod = await import("zod");
    expect(typeof yaml.parse).toBe("function");
    expect(typeof zod.z).toBe("object");
  });
});
