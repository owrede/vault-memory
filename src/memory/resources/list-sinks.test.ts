/**
 * Plan 02-06 (MEM-09) — `readListSinks` Resource handler tests.
 *
 * Pure-function tests against a `MemorySinkRegistry` populated via
 * `registerMemorySinks` with a spy provisioner (no fs).
 */

import { describe, it, expect, vi } from "vitest";
import { MemorySinkRegistry } from "../registry.js";
import { readListSinks } from "./list-sinks.js";

const VAULT_ROOT = "/abs/vault/atlas";

function makeOpts() {
  return {
    resolveVaultAbsolutePath: (_v: string) => VAULT_ROOT,
    provisioner: vi.fn().mockResolvedValue(undefined),
  };
}

describe("readListSinks (MEM-09 / Plan 02-06)", () => {
  it("returns total: 0 / sinks: [] when no sinks registered", () => {
    const reg = new MemorySinkRegistry();
    const out = readListSinks(reg);
    expect(out).toEqual({ total: 0, sinks: [] });
  });

  it("emits one entry per registered sink with full surface", async () => {
    const reg = new MemorySinkRegistry();
    await reg.registerMemorySinks(
      [
        {
          name: "default",
          handle: "obsidian-fs://atlas/_memory/",
          contract: "default-memory-v1",
        },
        {
          name: "staging",
          handle: "obsidian-fs://atlas/_memory-staging/",
          contract: "default-memory-v1",
        },
      ],
      makeOpts(),
    );

    const out = readListSinks(reg);
    expect(out.total).toBe(2);
    expect(out.sinks).toHaveLength(2);

    expect(out.sinks[0]).toEqual({
      name: "default",
      handle: "obsidian-fs://atlas/_memory/",
      vault: "atlas",
      contract: "default-memory-v1",
      default: true, // first-registered fallback
      resolves_to: "_memory/",
    });
    expect(out.sinks[1]).toEqual({
      name: "staging",
      handle: "obsidian-fs://atlas/_memory-staging/",
      vault: "atlas",
      contract: "default-memory-v1",
      default: false,
      resolves_to: "_memory-staging/",
    });
  });

  it("honors an explicit default_sink_name (default flag flips)", async () => {
    const reg = new MemorySinkRegistry();
    await reg.registerMemorySinks(
      [
        {
          name: "default",
          handle: "obsidian-fs://atlas/_memory/",
          contract: "default-memory-v1",
        },
        {
          name: "staging",
          handle: "obsidian-fs://atlas/_memory-staging/",
          contract: "default-memory-v1",
        },
      ],
      { ...makeOpts(), defaultSinkName: "staging" },
    );
    const out = readListSinks(reg);
    const names = out.sinks.map((s) => ({ name: s.name, default: s.default }));
    expect(names).toEqual([
      { name: "default", default: false },
      { name: "staging", default: true },
    ]);
  });
});
