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
import { MemorySinkRegistry, parseMemorySinkHandle } from "../../memory/index.js";
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
    expect(res.doc_id).toMatch(
      /^obsidian-fs:\/\/test-vault\/_memory\/observations\/\d{4}-\d{2}-\d{2}-acme-is-migrating-to-postgres-[a-f0-9]{6}\.md$/,
    );

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

  // ── WR-07 refinement of D-02 ────────────────────────────────────────────
  //
  // D-02's "caller properties win" rule is refined: the rule applies only to
  // contract-allowed extras (e.g. tags, expires_at, priority). Provenance
  // keys (source / evidence / confidence / observed_at / type / status /
  // superseded_by / superseded_reason) are STRIPPED from caller-supplied
  // `properties` before merge so sugar values survive into the audit trail.

  it.each([
    ["source", "user"],
    ["evidence", []],
    ["confidence", "uncertain"],
    ["observed_at", "1970-01-01T00:00:00Z"],
    ["type", "fact"],
    ["status", "retired"],
    ["superseded_by", "obsidian-fs://test-vault/_memory/x.md"],
    ["superseded_reason", "test-override"],
  ] as const)(
    "WR-07: caller-supplied properties.%s is stripped — sugar value survives",
    async (key, bogusValue) => {
      const explicitDate = "2026-04-01T12:00:00Z";
      const res = await handleRecordObservation(deps(), {
        vault: VAULT_NAME,
        claim: `Protected key test: ${key}`,
        evidence: ["call-2026-04-01"],
        confidence: "direct",
        type: "observation",
        // Use a known observed_at on the sugar side so we can compare it
        // against the bogus override for the observed_at sub-case.
        properties: {
          // Caller-side bogus override that MUST be stripped:
          [key]: bogusValue,
          // Also pin observed_at for stability when key !== observed_at:
          ...(key === "observed_at" ? {} : { observed_at: explicitDate }),
        },
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const resource = res.doc_id.replace(`obsidian-fs://${VAULT_NAME}/`, "");
      const fm = matter(await fs.readFile(join(fixture.vaultDir, resource), "utf-8"))
        .data as Record<string, unknown>;
      // The expected sugar value for each protected key:
      const expectedSugar: Record<string, unknown> = {
        source: "agent",
        evidence: ["call-2026-04-01"],
        confidence: "direct",
        type: "observation",
        status: "active",
        superseded_by: null,
        superseded_reason: undefined, // never set by sugar; not present in fm
      };
      if (key === "observed_at") {
        // Sugar default is `new Date().toISOString()` — assert NOT the bogus
        // 1970 epoch and is a recent ISO-8601 string.
        expect(fm.observed_at).not.toBe(bogusValue);
        expect(typeof fm.observed_at).toBe("string");
        expect(String(fm.observed_at).startsWith("19")).toBe(false);
      } else if (key === "superseded_reason") {
        // Not in sugar → key MUST NOT appear in frontmatter at all.
        expect(fm.superseded_reason).toBeUndefined();
      } else {
        expect(fm[key]).toEqual(expectedSugar[key]);
      }
    },
  );

  it("WR-07: caller-supplied non-provenance extras (tags, expires_at, priority) flow through (D-02 refinement preserves extras)", async () => {
    const res = await handleRecordObservation(deps(), {
      vault: VAULT_NAME,
      claim: "Extras preserved",
      evidence: ["call-x"],
      confidence: "direct",
      type: "observation",
      properties: {
        tags: ["a", "b"],
        expires_at: "2030-01-01T00:00:00Z",
        priority: 5,
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const resource = res.doc_id.replace(`obsidian-fs://${VAULT_NAME}/`, "");
    const fm = matter(await fs.readFile(join(fixture.vaultDir, resource), "utf-8")).data as Record<
      string,
      unknown
    >;
    expect(fm.tags).toEqual(["a", "b"]);
    expect(fm.expires_at).toBe("2030-01-01T00:00:00Z");
    expect(fm.priority).toBe(5);
    // Sugar defaults still present.
    expect(fm.source).toBe("agent");
    expect(fm.confidence).toBe("direct");
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
    // WR-04 (b): the per-retry salt is now `crypto.randomBytes(3)` so each
    // retry mints a fresh suffix. Two identical-arg calls in the same
    // millisecond must still produce DIFFERENT DocIds.
    const claim = "Deterministic collision";
    const explicitObservedAt = "2026-05-15T09:00:00Z";

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
    const firstResource = first.doc_id.replace(`obsidian-fs://${VAULT_NAME}/`, "");
    // first file is still on disk → next call with identical args MUST
    // retry to a different DocId (fresh randomBytes salt).
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
    const secondResource = second.doc_id.replace(`obsidian-fs://${VAULT_NAME}/`, "");
    expect(secondResource).not.toBe(firstResource);
    // Both files exist on disk.
    await fs.access(join(fixture.vaultDir, firstResource));
    await fs.access(join(fixture.vaultDir, secondResource));
  });

  // ── WR-04 (a): collision exhaustion returns collision_retry_exhausted ──

  it("WR-04: returns collision_retry_exhausted (NOT permission_denied) when 3 retries fail", async () => {
    // Stub the source connector so `exists()` ALWAYS returns true — the
    // controller will exhaust MAX_COLLISION_RETRIES regardless of the
    // random salt and return the new structured reason.
    const stubbedDeps = {
      ...deps(),
      sourceConnectorFor: () =>
        ({
          exists: async () => true,
          fetch: async () => null,
        }) as unknown as ReturnType<typeof deps>["sourceConnectorFor"] extends (
          ...args: unknown[]
        ) => infer R
          ? R
          : never,
    };
    const res = await handleRecordObservation(stubbedDeps, {
      vault: VAULT_NAME,
      claim: "Always-collides",
      evidence: [],
      confidence: "direct",
      type: "observation",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("collision_retry_exhausted");
    // Critically: NOT permission_denied — callers must distinguish
    // "vault is read-only" from "vary the claim text and retry".
    expect(res.reason).not.toBe("permission_denied");
    expect(typeof res.message).toBe("string");
    expect(res.message).toMatch(/3 attempts/);
  });

  // ── WR-04 (b): per-retry salts are truly random ─────────────────────────

  it("WR-04: each collision retry mints a DIFFERENT random salt (not deterministic '0','1','2')", async () => {
    // Capture every DocId the controller attempts by stubbing `exists()`
    // to record the call and force a retry (true) for the first 2 calls,
    // then return false (no collision) on the 3rd so the controller can
    // proceed to delivery.
    const attemptedIds: string[] = [];
    let callCount = 0;
    const stubbedDeps = {
      ...deps(),
      sourceConnectorFor: () =>
        ({
          exists: async (docId: string) => {
            attemptedIds.push(docId);
            callCount += 1;
            return callCount <= 2; // true, true, then false → 3 attempts
          },
          fetch: async () => null,
        }) as unknown as ReturnType<typeof deps>["sourceConnectorFor"] extends (
          ...args: unknown[]
        ) => infer R
          ? R
          : never,
    };
    const res = await handleRecordObservation(stubbedDeps, {
      vault: VAULT_NAME,
      claim: "Random-salt verification",
      evidence: [],
      confidence: "direct",
      type: "observation",
      properties: { observed_at: "2026-05-15T09:00:00Z" },
    });
    expect(res.ok).toBe(true);
    expect(attemptedIds.length).toBe(3);
    // Extract the 6-char hex suffix from each attempted DocId filename.
    // Pattern: ...-<slug>-<suffix>.md
    const suffixes = attemptedIds.map((id) => {
      const m = id.match(/-([a-f0-9]{6})\.md$/);
      return m ? m[1] : null;
    });
    expect(suffixes.every((s) => s !== null)).toBe(true);
    // All three suffixes MUST differ — random salts produce
    // distinct entropy per retry (no deterministic 0/1/2 collision chain).
    expect(new Set(suffixes).size).toBe(3);
  });

  // ── IN-04: slugify still strips combining marks (Unicode escape form) ──

  it("IN-04: slugify strips combining diacritical marks (Unicode escape form)", async () => {
    const res = await handleRecordObservation(deps(), {
      vault: VAULT_NAME,
      claim: "café résumé",
      evidence: [],
      confidence: "direct",
      type: "observation",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The slug portion of the DocId must contain "cafe-resume", proving
    // the combining marks were stripped.
    expect(res.doc_id).toMatch(/cafe-resume/);
  });
});
