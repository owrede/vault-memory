/**
 * Plan 02-06 (MEM-09) — `readMemoryStats` Resource handler tests.
 *
 * Build a real in-memory `Database` per test, seed `notes` rows whose
 * paths sit under the sink's `resolveToRelativePath`, seed `write_audit`
 * rows with the v9 discriminator flag, then assert the projected shape.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Database } from "../../db/database.js";
import { MemorySinkRegistry } from "../registry.js";
import { readMemoryStats } from "./memory-stats.js";
import type { VaultManager } from "../../vault/manager.js";
import type { Vault } from "../../vault/manager.js";

const VAULT_NAME = "atlas";
const VAULT_PATH = "/abs/vault/atlas";

function seedNote(
  db: Database,
  path: string,
  frontmatter: Record<string, unknown> | null,
): number {
  return db.notes.upsertByPath({
    path,
    content: "x",
    frontmatter: frontmatter ? JSON.stringify(frontmatter) : null,
    title: path,
    hash: `hash-${path}`,
    bodyHash: `body-${path}`,
    mtime: 1,
    wordCount: 1,
  }).id;
}

/** Tiny VaultManager stub — `readMemoryStats` only calls `require(name)`. */
function makeManager(vault: Vault | null): VaultManager {
  return {
    require(name: string): Vault {
      if (vault && name === vault.config.name) return vault;
      throw new Error(`Unknown vault: "${name}"`);
    },
  } as unknown as VaultManager;
}

describe("readMemoryStats (MEM-09 / Plan 02-06)", () => {
  let db: Database;
  let vault: Vault;
  let registry: MemorySinkRegistry;

  beforeEach(async () => {
    db = new Database(":memory:", VAULT_NAME);
    vault = {
      config: { name: VAULT_NAME, path: VAULT_PATH, write_enabled: true },
      db,
      dbPath: ":memory:",
    };
    registry = new MemorySinkRegistry();
  });

  afterEach(() => db.close());

  it("returns empty stats when no sinks registered", () => {
    const out = readMemoryStats(registry, makeManager(vault));
    expect(out).toEqual({ total_docs: 0, sinks: [] });
  });

  it("aggregates doc_count + by_type + by_status under one sink", async () => {
    await registry.registerMemorySinks(
      [
        {
          name: "default",
          handle: `obsidian-fs://${VAULT_NAME}/_memory/`,
          contract: "default-memory-v1",
        },
      ],
      {
        resolveVaultAbsolutePath: () => VAULT_PATH,
        provisioner: vi.fn().mockResolvedValue(undefined),
      },
    );

    // 3 docs inside _memory/ (the sink), 1 doc outside (must not count).
    seedNote(db, "_memory/obs-1.md", { type: "fact", status: "active" });
    seedNote(db, "_memory/obs-2.md", { type: "fact", status: "active" });
    seedNote(db, "_memory/decision-1.md", {
      type: "decision",
      status: "superseded",
    });
    seedNote(db, "regular/note.md", { type: "fact", status: "active" });

    const out = readMemoryStats(registry, makeManager(vault));
    expect(out.total_docs).toBe(3);
    expect(out.sinks).toHaveLength(1);

    const entry = out.sinks[0]!;
    expect(entry.name).toBe("default");
    expect(entry.vault).toBe(VAULT_NAME);
    expect(entry.handle).toBe(`obsidian-fs://${VAULT_NAME}/_memory/`);
    expect(entry.doc_count).toBe(3);
    expect(entry.by_type).toEqual({ fact: 2, decision: 1 });
    expect(entry.by_status).toEqual({ active: 2, superseded: 1 });
    expect(entry.last_write_at).toBeNull(); // no audit rows yet
  });

  it("populates last_write_at from the most recent memory-sink audit row", async () => {
    await registry.registerMemorySinks(
      [
        {
          name: "default",
          handle: `obsidian-fs://${VAULT_NAME}/_memory/`,
          contract: "default-memory-v1",
        },
      ],
      {
        resolveVaultAbsolutePath: () => VAULT_PATH,
        provisioner: vi.fn().mockResolvedValue(undefined),
      },
    );

    const obsId = seedNote(db, "_memory/obs.md", { type: "fact", status: "active" });
    // Non-memory write should NOT count toward last_write_at.
    const userId = seedNote(db, "regular.md", null);
    db.audit.recordWrite({
      noteId: userId,
      op: "create",
      previousHash: null,
      newHash: "u",
      expectedHash: null,
      clientId: "user",
      diffSummary: null,
      isMemorySinkWrite: false,
    });
    db.audit.recordWrite({
      noteId: obsId,
      op: "create",
      previousHash: null,
      newHash: "m1",
      expectedHash: null,
      clientId: "agent",
      diffSummary: null,
      isMemorySinkWrite: true,
    });

    const out = readMemoryStats(registry, makeManager(vault));
    const entry = out.sinks[0]!;
    expect(entry.last_write_at).not.toBeNull();
    expect(typeof entry.last_write_at).toBe("number");
    expect(entry.last_write_at!).toBeGreaterThan(0);
  });

  it("tolerates a sink whose vault is no longer mounted (zero counts, null last_write_at)", async () => {
    await registry.registerMemorySinks(
      [
        {
          name: "ghost",
          handle: "obsidian-fs://unknown-vault/_memory/",
          contract: "default-memory-v1",
        },
      ],
      {
        resolveVaultAbsolutePath: () => "/abs/unknown",
        provisioner: vi.fn().mockResolvedValue(undefined),
      },
    );

    // Manager only knows about `atlas`; the sink references `unknown-vault`.
    const out = readMemoryStats(registry, makeManager(vault));
    expect(out.total_docs).toBe(0);
    expect(out.sinks).toHaveLength(1);
    const entry = out.sinks[0]!;
    expect(entry.name).toBe("ghost");
    expect(entry.vault).toBe("unknown-vault");
    expect(entry.doc_count).toBe(0);
    expect(entry.by_type).toEqual({});
    expect(entry.by_status).toEqual({});
    expect(entry.last_write_at).toBeNull();
  });

  it("tolerates malformed frontmatter without throwing", async () => {
    await registry.registerMemorySinks(
      [
        {
          name: "default",
          handle: `obsidian-fs://${VAULT_NAME}/_memory/`,
          contract: "default-memory-v1",
        },
      ],
      {
        resolveVaultAbsolutePath: () => VAULT_PATH,
        provisioner: vi.fn().mockResolvedValue(undefined),
      },
    );

    // Insert a row with non-JSON frontmatter directly to bypass NotesQueries.
    db.handle
      .prepare(
        "INSERT INTO notes (path, content, frontmatter, title, hash, body_hash, mtime, word_count, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "_memory/broken.md",
        "x",
        "not-json-{[", // intentionally corrupt
        "broken",
        "h",
        "b",
        1,
        1,
        1,
        1,
      );

    const out = readMemoryStats(registry, makeManager(vault));
    expect(out.total_docs).toBe(1);
    expect(out.sinks[0]!.by_type).toEqual({});
    expect(out.sinks[0]!.by_status).toEqual({});
  });
});
