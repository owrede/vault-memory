/**
 * Tests for `handleRecordObservation` (MEM-02).
 *
 * Strategy: stand up a real `MemorySinkRegistry` + `ObsidianFsDelivery`
 * + `ObsidianFsSource` against an `mkdtemp`'d vault. The controller's
 * obligations are:
 *   - Sugar args prefill contract-required keys; caller-supplied
 *     `properties` wins (D-02 merge-last).
 *   - Delivery refusals are returned UNCHANGED.
 *   - Path-collision on the would-be filename retries with a fresh
 *     hash6 suffix up to 3 times.
 *   - Unknown sink / vault-sink mismatch throws.
 *   - Returns the WriteSuccess shape (`{ok, doc_id, newHash, created}`)
 *     — uses `newHash`, NOT `hash`.
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
import {
  MemorySinkRegistry,
  parseMemorySinkHandle,
} from "../../memory/index.js";
import type { MemorySink } from "../../types.js";
import { handleRecordObservation } from "./record-observation.js";

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
  const vaultDir = await mkdtemp(join(tmpdir(), "vm-rec-obs-"));
  const db = new Database(":memory:", VAULT_NAME);
  db.migrate();
  const vault: Vault = {
    config: { name: VAULT_NAME, path: vaultDir, write_enabled: true },
    db,
    dbPath: ":memory:",
  };

  const manager = new VaultManager();
  (manager as unknown as { vaults: Map<string, Vault> }).vaults.set(
    VAULT_NAME,
    vault,
  );

  const registry = new MemorySinkRegistry();
  const sinkHandle = parseMemorySinkHandle(
    `obsidian-fs://${VAULT_NAME}/${SINK_REL_PATH}`,
  );
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

describe("handleRecordObservation — MEM-02 controller", () => {
  let fixture: Awaited<ReturnType<typeof buildFixture>>;

  beforeEach(async () => {
    fixture = await buildFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  function deps() {
    return {
      memorySinkRegistry: fixture.registry,
      manager: fixture.manager,
      deliveryAdapterFor: () => fixture.delivery,
      sourceConnectorFor: () => fixture.source,
    };
  }

  it("happy path: writes a fully-formed observation with sugar defaults", async () => {
    const res = await handleRecordObservation(deps(), {
      vault: VAULT_NAME,
      claim: "Acme is migrating to Postgres",
      evidence: ["call-2026-05-15"],
      confidence: "direct",
      type: "observation",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(typeof res.newHash).toBe("string");
    expect(res.newHash.length).toBeGreaterThan(0);
    // The WriteSuccess shape uses `newHash`, NOT `hash`.
    expect((res as Record<string, unknown>).hash).toBeUndefined();
    expect(res.created).toBe(true);
    expect(res.doc_id).toMatch(/^obsidian-fs:\/\/test-vault\/_memory\/observations\/\d{4}-\d{2}-\d{2}-acme-is-migrating-to-postgres-[a-f0-9]{6}\.md$/);

    // File exists on disk; frontmatter carries the seven required keys.
    const resource = res.doc_id.replace(`obsidian-fs://${VAULT_NAME}/`, "");
    const onDisk = await fs.readFile(join(fixture.vaultDir, resource), "utf-8");
    const parsed = matter(onDisk);
    const fm = parsed.data as Record<string, unknown>;
    expect(fm.source).toBe("agent");
    expect(fm.confidence).toBe("direct");
    expect(fm.evidence).toEqual(["call-2026-05-15"]);
    expect(fm.status).toBe("active");
    expect(typeof fm.observed_at).toBe("string");
    expect(fm.superseded_by).toBeNull();
    expect(fm.type).toBe("observation");
    expect(parsed.content.trim()).toBe("Acme is migrating to Postgres");
  });

  it("D-02 escape hatch: caller properties merge LAST and survive into frontmatter", async () => {
    const res = await handleRecordObservation(deps(), {
      vault: VAULT_NAME,
      claim: "Renewal scheduled",
      evidence: [],
      confidence: "direct",
      type: "observation",
      properties: {
        expires_at: "2026-12-31T00:00:00Z",
        custom_tag: "experiment",
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const resource = res.doc_id.replace(`obsidian-fs://${VAULT_NAME}/`, "");
    const onDisk = await fs.readFile(join(fixture.vaultDir, resource), "utf-8");
    const fm = matter(onDisk).data as Record<string, unknown>;
    expect(fm.expires_at).toBe("2026-12-31T00:00:00Z");
    expect(fm.custom_tag).toBe("experiment");
    // Sugar defaults still present.
    expect(fm.source).toBe("agent");
  });

  it("D-02 override: caller-supplied properties.confidence wins over sugar arg", async () => {
    const res = await handleRecordObservation(deps(), {
      vault: VAULT_NAME,
      claim: "Soft signal",
      evidence: [],
      confidence: "direct",
      type: "observation",
      properties: { confidence: "uncertain" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const resource = res.doc_id.replace(`obsidian-fs://${VAULT_NAME}/`, "");
    const fm = matter(
      await fs.readFile(join(fixture.vaultDir, resource), "utf-8"),
    ).data as Record<string, unknown>;
    expect(fm.confidence).toBe("uncertain");
  });

  it("D-02 source override: caller passing source:'user' bubbles up as non_agent_write_inside_sink (controller does NOT rewrite)", async () => {
    const res = await handleRecordObservation(deps(), {
      vault: VAULT_NAME,
      claim: "User-authored claim",
      evidence: [],
      confidence: "direct",
      type: "observation",
      properties: { source: "user" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("non_agent_write_inside_sink");
    expect(res.sinkName).toBe("default");
  });

  it("caller-supplied properties.observed_at overrides the now-default (useful for backfill)", async () => {
    const explicitDate = "2024-03-14T12:00:00Z";
    const res = await handleRecordObservation(deps(), {
      vault: VAULT_NAME,
      claim: "Historical fact",
      evidence: [],
      confidence: "direct",
      type: "observation",
      properties: { observed_at: explicitDate },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The filename's date prefix comes from observed_at — must be 2024-03-14.
    expect(res.doc_id).toContain("/2024-03-14-");
    const resource = res.doc_id.replace(`obsidian-fs://${VAULT_NAME}/`, "");
    const fm = matter(
      await fs.readFile(join(fixture.vaultDir, resource), "utf-8"),
    ).data as Record<string, unknown>;
    expect(fm.observed_at).toBe(explicitDate);
  });

  it("unknown sink name throws with diagnostic listing registered sinks", async () => {
    await expect(
      handleRecordObservation(deps(), {
        vault: VAULT_NAME,
        claim: "x",
        evidence: [],
        confidence: "direct",
        type: "observation",
        sink: "nonexistent",
      }),
    ).rejects.toThrow(/Unknown memory sink/);
  });

  it("sink/vault mismatch throws", async () => {
    // Register a second vault + sink that mismatches the args.vault.
    await expect(
      handleRecordObservation(deps(), {
        vault: "wrong-vault",
        claim: "x",
        evidence: [],
        confidence: "direct",
        type: "observation",
        sink: "default",
      }),
    ).rejects.toThrow(/belongs to vault/);
  });

  it("DocId collision retries with a fresh hash6 suffix and succeeds on attempt 2", async () => {
    // Manually pre-create the file that the first hash6 would land at.
    // We compute the first-attempt path by replicating the slug+hash
    // logic deterministically (claim + observed_at + salt='0').
    const claim = "Deterministic collision";
    const explicitObservedAt = "2026-05-15T09:00:00Z";

    // Drive a first call to learn the first-attempt DocId, then delete
    // and re-create the collision shape to provoke a retry on the
    // SECOND invocation.
    const first = await handleRecordObservation(deps(), {
      vault: VAULT_NAME,
      claim,
      evidence: [],
      confidence: "direct",
      type: "observation",
      properties: { observed_at: explicitObservedAt },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstResource = first.doc_id.replace(
      `obsidian-fs://${VAULT_NAME}/`,
      "",
    );
    // first file is still on disk → next call with identical args MUST
    // retry to a different DocId (different suffix from salt='1').
    const second = await handleRecordObservation(deps(), {
      vault: VAULT_NAME,
      claim,
      evidence: [],
      confidence: "direct",
      type: "observation",
      properties: { observed_at: explicitObservedAt },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const secondResource = second.doc_id.replace(
      `obsidian-fs://${VAULT_NAME}/`,
      "",
    );
    expect(secondResource).not.toBe(firstResource);
    // Both files exist on disk.
    await fs.access(join(fixture.vaultDir, firstResource));
    await fs.access(join(fixture.vaultDir, secondResource));
  });

  it("returns the WriteConflict UNCHANGED when delivery refuses (e.g. missing_provenance on bad caller override)", async () => {
    // Force a validator rejection by overriding confidence to an invalid value.
    const res = await handleRecordObservation(deps(), {
      vault: VAULT_NAME,
      claim: "Bad confidence",
      evidence: [],
      confidence: "direct",
      type: "observation",
      properties: { confidence: "high" }, // not in {direct, inferred, uncertain}
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("invalid_provenance");
    expect(res.key).toBe("confidence");
    expect(res.observedValue).toBe("high");
    expect(res.sinkName).toBe("default");
  });
});
