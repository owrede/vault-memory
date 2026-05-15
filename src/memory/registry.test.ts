/**
 * Unit tests for `src/memory/registry.ts` — `MemorySinkRegistry`.
 *
 * Covers:
 *   - `registerMemorySinks` calls the injected `provisioner` exactly
 *     once per configured sink, with the resolved vault-absolute path.
 *   - `listMemorySinks` returns all registered sinks.
 *   - `resolveMemorySink(name)` and `resolveMemorySink(handle)` both
 *     return the same record (dual-input lookup).
 *   - `resolveMemorySink(unknown)` throws with the registered list.
 *   - `getDefaultMemorySink()` returns the default; throws when none.
 *   - `findSinkContaining(docId)` matches by vault authority +
 *     resolveToRelativePath prefix; returns `null` on miss.
 *   - Default selection: explicit `defaultSinkName` wins; otherwise
 *     the first-registered sink is the default.
 *
 * The provisioner is always a spy — the registry itself never touches
 * `fs.*`; in production the spy is replaced with a thin wrapper that
 * calls `provisionSink` from the obsidian-fs adapter.
 */

import { describe, it, expect, vi } from "vitest";
import { MemorySinkRegistry } from "./registry.js";
import { parseDocId } from "../adapters/registry.js";

const VAULT_ROOT = "/abs/vault/atlas";

function makeOpts(overrides: Partial<{
  defaultSinkName: string;
  provisioner: ReturnType<typeof vi.fn>;
}> = {}) {
  const provisioner = overrides.provisioner ?? vi.fn().mockResolvedValue(undefined);
  return {
    resolveVaultAbsolutePath: (_v: string) => VAULT_ROOT,
    defaultSinkName: overrides.defaultSinkName,
    provisioner,
  };
}

describe("MemorySinkRegistry.registerMemorySinks", () => {
  it("registers a single sink and invokes the provisioner once", async () => {
    const reg = new MemorySinkRegistry();
    const opts = makeOpts();
    await reg.registerMemorySinks(
      [{ name: "default", handle: "obsidian-fs://atlas/_memory/", contract: "default-memory-v1" }],
      opts,
    );
    expect(opts.provisioner).toHaveBeenCalledTimes(1);
    expect(opts.provisioner).toHaveBeenCalledWith(
      expect.objectContaining({ name: "default", vault: "atlas" }),
      VAULT_ROOT,
    );
  });

  it("registers multiple sinks in declaration order", async () => {
    const reg = new MemorySinkRegistry();
    const opts = makeOpts();
    await reg.registerMemorySinks(
      [
        { name: "a", handle: "obsidian-fs://atlas/_memory/", contract: "default-memory-v1" },
        {
          name: "b",
          handle: "obsidian-fs://atlas/_memory-staging/",
          contract: "default-memory-v1",
        },
      ],
      opts,
    );
    expect(reg.listMemorySinks().map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("rejects a malformed handle from config", async () => {
    const reg = new MemorySinkRegistry();
    const opts = makeOpts();
    await expect(
      reg.registerMemorySinks(
        [{ name: "bad", handle: "not-a-handle", contract: "default-memory-v1" }],
        opts,
      ),
    ).rejects.toThrow(/Invalid MemorySinkHandle/);
  });
});

describe("MemorySinkRegistry.resolveMemorySink", () => {
  it("resolves by name", async () => {
    const reg = new MemorySinkRegistry();
    await reg.registerMemorySinks(
      [
        { name: "default", handle: "obsidian-fs://atlas/_memory/", contract: "default-memory-v1" },
      ],
      makeOpts(),
    );
    const resolved = reg.resolveMemorySink("default");
    expect(resolved.name).toBe("default");
  });

  it("resolves by full handle string", async () => {
    const reg = new MemorySinkRegistry();
    await reg.registerMemorySinks(
      [
        { name: "default", handle: "obsidian-fs://atlas/_memory/", contract: "default-memory-v1" },
      ],
      makeOpts(),
    );
    const resolved = reg.resolveMemorySink("obsidian-fs://atlas/_memory/");
    expect(resolved.name).toBe("default");
  });

  it("throws on an unknown name with the registered-sink list in the message", async () => {
    const reg = new MemorySinkRegistry();
    await reg.registerMemorySinks(
      [
        { name: "default", handle: "obsidian-fs://atlas/_memory/", contract: "default-memory-v1" },
      ],
      makeOpts(),
    );
    expect(() => reg.resolveMemorySink("absent")).toThrow(/Unknown memory sink/);
    expect(() => reg.resolveMemorySink("absent")).toThrow(/default/);
  });
});

describe("MemorySinkRegistry.getDefaultMemorySink", () => {
  it("returns the sink whose name matches defaultSinkName", async () => {
    const reg = new MemorySinkRegistry();
    await reg.registerMemorySinks(
      [
        { name: "a", handle: "obsidian-fs://atlas/_memory/", contract: "default-memory-v1" },
        {
          name: "b",
          handle: "obsidian-fs://atlas/_memory-staging/",
          contract: "default-memory-v1",
        },
      ],
      makeOpts({ defaultSinkName: "b" }),
    );
    expect(reg.getDefaultMemorySink().name).toBe("b");
  });

  it("falls back to the first registered sink when defaultSinkName is unset", async () => {
    const reg = new MemorySinkRegistry();
    await reg.registerMemorySinks(
      [
        { name: "first", handle: "obsidian-fs://atlas/_memory/", contract: "default-memory-v1" },
        {
          name: "second",
          handle: "obsidian-fs://atlas/_memory-staging/",
          contract: "default-memory-v1",
        },
      ],
      makeOpts(),
    );
    expect(reg.getDefaultMemorySink().name).toBe("first");
  });

  it("throws when no sinks are registered", () => {
    const reg = new MemorySinkRegistry();
    expect(() => reg.getDefaultMemorySink()).toThrow(/no memory sinks/i);
  });
});

describe("MemorySinkRegistry.findSinkContaining", () => {
  it("returns the enclosing sink when the DocId resource starts with the sink path", async () => {
    const reg = new MemorySinkRegistry();
    await reg.registerMemorySinks(
      [
        { name: "default", handle: "obsidian-fs://atlas/_memory/", contract: "default-memory-v1" },
      ],
      makeOpts(),
    );
    const docId = parseDocId("obsidian-fs://atlas/_memory/observations/foo.md");
    const sink = reg.findSinkContaining(docId);
    expect(sink?.name).toBe("default");
  });

  it("returns null when the DocId is outside any sink", async () => {
    const reg = new MemorySinkRegistry();
    await reg.registerMemorySinks(
      [
        { name: "default", handle: "obsidian-fs://atlas/_memory/", contract: "default-memory-v1" },
      ],
      makeOpts(),
    );
    const docId = parseDocId("obsidian-fs://atlas/projects/Atlas-1.md");
    expect(reg.findSinkContaining(docId)).toBeNull();
  });

  it("returns null when the DocId belongs to a different vault authority", async () => {
    const reg = new MemorySinkRegistry();
    await reg.registerMemorySinks(
      [
        { name: "default", handle: "obsidian-fs://atlas/_memory/", contract: "default-memory-v1" },
      ],
      makeOpts(),
    );
    const docId = parseDocId("obsidian-fs://other-vault/_memory/observations/foo.md");
    expect(reg.findSinkContaining(docId)).toBeNull();
  });

  it("returns null for a non-obsidian-fs DocId scheme", async () => {
    const reg = new MemorySinkRegistry();
    await reg.registerMemorySinks(
      [
        { name: "default", handle: "obsidian-fs://atlas/_memory/", contract: "default-memory-v1" },
      ],
      makeOpts(),
    );
    const docId = parseDocId("notion-api://workspace/page-123");
    expect(reg.findSinkContaining(docId)).toBeNull();
  });
});
