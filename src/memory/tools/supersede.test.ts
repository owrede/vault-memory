/**
 * Tests for `handleSupersede` (MEM-04).
 *
 * Strategy: stand up a real `MemorySinkRegistry` + `ObsidianFsDelivery`
 * + `ObsidianFsSource`. Seed the sink with two observation files
 * (OLD + REPLACEMENT). Then call `handleSupersede` and inspect both
 * files on disk:
 *   - OLD: status:superseded, superseded_by, superseded_reason all set.
 *   - REPLACEMENT: completely untouched (mtime unchanged).
 *
 * Asserts the WriteSuccess shape uses `newHash`, not `hash`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import matter from "gray-matter";
import { Database } from "../../db/index.js";
import { VaultManager } from "../../vault/index.js";
import type { Vault } from "../../vault/index.js";
import { ObsidianFsDelivery } from "../../adapters/delivery/obsidian-fs/index.js";
import { ObsidianFsSource } from "../../adapters/source/obsidian-fs/index.js";
import { provisionSink } from "../../adapters/delivery/obsidian-fs/sentinel.js";
import { MemorySinkRegistry, parseMemorySinkHandle } from "../../memory/index.js";
import { formatDocId } from "../../adapters/registry.js";
import type { MemorySink } from "../../types.js";
import { handleRecordObservation } from "./record-observation.js";
import { handleSupersede } from "./supersede.js";

const VAULT_NAME = "test-vault";
const SINK_REL_PATH = "_memory/";

async function buildFixture(): Promise<{
  vaultDir: string;
  vault: Vault;
  manager: VaultManager;
  delivery: ObsidianFsDelivery;
  source: ObsidianFsSource;
  registry: MemorySinkRegistry;
  cleanup: () => Promise<void>;
}> {
  const vaultDir = await mkdtemp(join(tmpdir(), "vm-supersede-"));
  const db = new Database(":memory:", VAULT_NAME);
  db.migrate();
  const vault: Vault = {
    config: { name: VAULT_NAME, path: vaultDir, write_enabled: true },
    db,
    dbPath: ":memory:",
  };
  const manager = new VaultManager();
  (manager as unknown as { vaults: Map<string, Vault> }).vaults.set(VAULT_NAME, vault);

  const registry = new MemorySinkRegistry();
  const sinkHandle = parseMemorySinkHandle(`obsidian-fs://${VAULT_NAME}/${SINK_REL_PATH}`);
  await registry.registerMemorySinks(
    [{ name: "default", handle: sinkHandle, contract: "default-memory-v1" }],
    {
      resolveVaultAbsolutePath: () => vaultDir,
      provisioner: async (sink: MemorySink, vaultAbs: string) => {
        await provisionSink(sink, vaultAbs, { version: "test" });
      },
    },
  );
  const delivery = new ObsidianFsDelivery(vault, "test-client", registry);
  const source = new ObsidianFsSource(vault.config);

  return {
    vaultDir,
    vault,
    manager,
    delivery,
    source,
    registry,
    cleanup: async () => {
      db.close();
      await rm(vaultDir, { recursive: true, force: true });
    },
  };
}

describe("handleSupersede — MEM-04 controller", () => {
  let fixture: Awaited<ReturnType<typeof buildFixture>>;

  function deps() {
    return {
      memorySinkRegistry: fixture.registry,
      manager: fixture.manager,
      deliveryAdapterFor: () => fixture.delivery,
      sourceConnectorFor: () => fixture.source,
    };
  }

  /**
   * Seed two observations via `handleRecordObservation` so the
   * fixture mirrors the real authoring path. Returns the (OLD,
   * REPLACEMENT) DocIds.
   */
  async function seedTwoObservations(): Promise<{
    oldId: string;
    replacementId: string;
  }> {
    const recordDeps = deps();
    const a = await handleRecordObservation(recordDeps, {
      vault: VAULT_NAME,
      claim: "Old claim",
      evidence: [],
      confidence: "direct",
      type: "observation",
      properties: { observed_at: "2026-01-01T00:00:00Z" },
    });
    if (!a.ok) throw new Error("seed (old) failed");
    const b = await handleRecordObservation(recordDeps, {
      vault: VAULT_NAME,
      claim: "Replacement claim",
      evidence: [],
      confidence: "direct",
      type: "observation",
      properties: { observed_at: "2026-01-02T00:00:00Z" },
    });
    if (!b.ok) throw new Error("seed (replacement) failed");
    return { oldId: a.doc_id, replacementId: b.doc_id };
  }

  beforeEach(async () => {
    fixture = await buildFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("happy path: OLD doc gets status=superseded + back-reference; REPLACEMENT untouched", async () => {
    const { oldId, replacementId } = await seedTwoObservations();
    const oldResource = oldId.replace(`obsidian-fs://${VAULT_NAME}/`, "");
    const replResource = replacementId.replace(`obsidian-fs://${VAULT_NAME}/`, "");
    const replMtimeBefore = (await fs.stat(join(fixture.vaultDir, replResource))).mtimeMs;
    const replContentBefore = await fs.readFile(join(fixture.vaultDir, replResource), "utf-8");

    const res = await handleSupersede(deps(), {
      doc_id: oldId,
      replacement_doc_id: replacementId,
      reason: "new evidence supersedes",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(typeof res.newHash).toBe("string");
    expect(res.newHash.length).toBeGreaterThan(0);
    expect((res as Record<string, unknown>).hash).toBeUndefined();
    expect(res.doc_id).toBe(oldId);

    // OLD doc frontmatter reflects the supersede.
    const oldFm = matter(await fs.readFile(join(fixture.vaultDir, oldResource), "utf-8"))
      .data as Record<string, unknown>;
    expect(oldFm.status).toBe("superseded");
    expect(oldFm.superseded_by).toBe(replacementId);
    expect(oldFm.superseded_reason).toBe("new evidence supersedes");

    // REPLACEMENT doc: file content and mtime are unchanged.
    const replContentAfter = await fs.readFile(join(fixture.vaultDir, replResource), "utf-8");
    expect(replContentAfter).toBe(replContentBefore);
    const replMtimeAfter = (await fs.stat(join(fixture.vaultDir, replResource))).mtimeMs;
    expect(replMtimeAfter).toBe(replMtimeBefore);
  });

  it("OCC conflict: concurrent edit between read and update surfaces as hash_mismatch UNCHANGED", async () => {
    const { oldId, replacementId } = await seedTwoObservations();
    const oldResource = oldId.replace(`obsidian-fs://${VAULT_NAME}/`, "");

    // Wrap the source so the controller reads the hash BEFORE we mutate
    // the file. We can't intercept the controller's readDocument call
    // post-hoc, so simulate the concurrent edit by patching exists/readDocument
    // through a wrapper that reads the file, returns its current hash,
    // then we manually mutate the file before the controller's
    // delivery.update() runs.
    //
    // Concrete approach: rewrite the file's content directly so its
    // on-disk hash drifts from whatever the controller captured. The
    // controller's expectedHash will be stale; the delivery's OCC check
    // surfaces `hash_mismatch`.
    let firstRead = true;
    const realRead = fixture.source.readDocument.bind(fixture.source);
    const racingDeps = {
      ...deps(),
      sourceConnectorFor: () => ({
        ...fixture.source,
        readDocument: async (id: typeof oldId & { __brand: "DocId" }) => {
          const doc = await realRead(id);
          if (firstRead) {
            firstRead = false;
            // Mutate the file AFTER the controller has read its hash
            // but BEFORE the delivery.update() runs. This simulates
            // the concurrent-edit window.
            const fullPath = join(fixture.vaultDir, oldResource);
            const current = await fs.readFile(fullPath, "utf-8");
            await fs.writeFile(fullPath, current + "\n\nracing edit", "utf-8");
          }
          return doc;
        },
        exists: fixture.source.exists.bind(fixture.source),
        listDocuments: fixture.source.listDocuments.bind(fixture.source),
        hash: fixture.source.hash.bind(fixture.source),
        handle: fixture.source.handle,
        capabilities: fixture.source.capabilities,
      }),
    };

    const res = await handleSupersede(racingDeps, {
      doc_id: oldId,
      replacement_doc_id: replacementId,
      reason: "x",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("hash_mismatch");
  });

  it("throws when target DocId is not inside any registered memory sink", async () => {
    const outsideId = formatDocId("obsidian-fs", VAULT_NAME, "ordinary/note.md");
    const replacementId = formatDocId("obsidian-fs", VAULT_NAME, "_memory/observations/r.md");
    await expect(
      handleSupersede(deps(), {
        doc_id: outsideId,
        replacement_doc_id: replacementId,
        reason: "x",
      }),
    ).rejects.toThrow(/not inside any configured MemorySink/);
  });

  it("idempotent re-supersede: second call updates superseded_reason to the new value", async () => {
    const { oldId, replacementId } = await seedTwoObservations();
    const first = await handleSupersede(deps(), {
      doc_id: oldId,
      replacement_doc_id: replacementId,
      reason: "first reason",
    });
    expect(first.ok).toBe(true);

    const second = await handleSupersede(deps(), {
      doc_id: oldId,
      replacement_doc_id: replacementId,
      reason: "second reason",
    });
    expect(second.ok).toBe(true);

    const oldResource = oldId.replace(`obsidian-fs://${VAULT_NAME}/`, "");
    const fm = matter(await fs.readFile(join(fixture.vaultDir, oldResource), "utf-8"))
      .data as Record<string, unknown>;
    expect(fm.superseded_reason).toBe("second reason");
  });

  it("malformed replacement_doc_id is rejected by parseDocId at the controller boundary", async () => {
    const { oldId } = await seedTwoObservations();
    await expect(
      handleSupersede(deps(), {
        doc_id: oldId,
        replacement_doc_id: "not-a-doc-id",
        reason: "x",
      }),
    ).rejects.toThrow(/Invalid DocId/);
  });

  it("malformed doc_id is rejected by parseDocId at the controller boundary", async () => {
    await expect(
      handleSupersede(deps(), {
        doc_id: "bogus",
        replacement_doc_id: "obsidian-fs://test-vault/_memory/observations/r.md",
        reason: "x",
      }),
    ).rejects.toThrow(/Invalid DocId/);
  });
});
