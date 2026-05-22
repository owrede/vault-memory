/**
 * Unit tests for `src/memory/contract/default-brief-v1.ts`.
 *
 * Phase 5 / Pitfall 1 resolution. Mirrors `default-v1.test.ts` shape:
 *   - Identity (name / version / required keys / naming strategy).
 *   - Positive cases: active and stale briefs parse cleanly.
 *   - Cross-field invariants: stale without source_hashes rejected;
 *     superseded inherits parent invariants.
 *   - Status enum: widened to include `"stale"` (Phase 2 default-v1
 *     does not accept this).
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_BRIEF_V1 } from "./default-brief-v1.js";
import { DEFAULT_MEMORY_V1 } from "./default-v1.js";
import { getContract } from "./index.js";

const ACTIVE_BRIEF = {
  source: "agent",
  confidence: "inferred",
  evidence: ["obsidian-fs://v/notes/foo.md"],
  status: "active",
  observed_at: "2026-05-18T10:00:00Z",
  superseded_by: null,
  type: "brief",
  target: "atlas-q3-status",
  purpose: "Synthesize the Q3 Atlas Robotics status across all source notes.",
  compiled_from: ["obsidian-fs://v/notes/foo.md"],
  compiled_at: "2026-05-18T10:00:00Z",
  source_hashes: { "obsidian-fs://v/notes/foo.md#chunk-a3f5b2c": "sha256:abc" },
};

describe("DEFAULT_BRIEF_V1 — identity", () => {
  it("has the canonical name and version", () => {
    expect(DEFAULT_BRIEF_V1.name).toBe("default-brief-v1");
    expect(DEFAULT_BRIEF_V1.version).toBe("1.0");
  });

  it("requiredKeys extends the base seven with brief-specific keys", () => {
    expect(DEFAULT_BRIEF_V1.requiredKeys).toEqual([
      "source",
      "confidence",
      "evidence",
      "status",
      "observed_at",
      "superseded_by",
      "type",
      "target",
      "purpose",
      "compiled_from",
      "compiled_at",
      "source_hashes",
    ]);
  });

  it("uses caller-provided naming (compile_brief mints the slug per D-12)", () => {
    expect(DEFAULT_BRIEF_V1.naming.strategy).toBe("caller-provided");
  });
});

describe("DEFAULT_BRIEF_V1 — registry integration", () => {
  it("getContract('default-brief-v1') returns the contract", () => {
    expect(getContract("default-brief-v1")).toBe(DEFAULT_BRIEF_V1);
  });

  it("getContract('default-memory-v1') still returns the Phase 2 contract", () => {
    expect(getContract("default-memory-v1")).toBe(DEFAULT_MEMORY_V1);
  });
});

describe("DEFAULT_BRIEF_V1 — propertiesSchema (positive)", () => {
  it("accepts a fully-populated active brief", () => {
    const result = DEFAULT_BRIEF_V1.propertiesSchema.safeParse(ACTIVE_BRIEF);
    expect(result.success).toBe(true);
  });

  it("accepts a stale brief with source_hashes + changed_sources", () => {
    const result = DEFAULT_BRIEF_V1.propertiesSchema.safeParse({
      ...ACTIVE_BRIEF,
      status: "stale",
      changed_sources: ["obsidian-fs://v/notes/foo.md"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an archived brief", () => {
    const result = DEFAULT_BRIEF_V1.propertiesSchema.safeParse({
      ...ACTIVE_BRIEF,
      status: "archived",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a superseded brief with both fields populated", () => {
    const result = DEFAULT_BRIEF_V1.propertiesSchema.safeParse({
      ...ACTIVE_BRIEF,
      status: "superseded",
      superseded_by: "obsidian-fs://v/_memory/_briefs/atlas-q3-status--20260520T0900.md",
      superseded_reason: "recompiled",
    });
    expect(result.success).toBe(true);
  });

  it("passes through contract-extra keys (D-02 escape hatch)", () => {
    const result = DEFAULT_BRIEF_V1.propertiesSchema.safeParse({
      ...ACTIVE_BRIEF,
      llm_strategy: "sampling", // contract-extra: D-10 ladder tier resolved
      max_tokens: 2000,
    });
    expect(result.success).toBe(true);
  });
});

describe("DEFAULT_BRIEF_V1 — status enum (Pitfall 1)", () => {
  it("accepts status='stale' (Phase 5 widens the enum)", () => {
    const result = DEFAULT_BRIEF_V1.propertiesSchema.safeParse({
      ...ACTIVE_BRIEF,
      status: "stale",
    });
    expect(result.success).toBe(true);
  });

  it("default-memory-v1 rejects status='stale' (the divergence motivating Pitfall 1)", () => {
    const stale = { ...ACTIVE_BRIEF, status: "stale" };
    const result = DEFAULT_MEMORY_V1.propertiesSchema.safeParse(stale);
    expect(result.success).toBe(false);
  });

  it("rejects status='unknown' (out of widened enum)", () => {
    const result = DEFAULT_BRIEF_V1.propertiesSchema.safeParse({
      ...ACTIVE_BRIEF,
      status: "unknown",
    });
    expect(result.success).toBe(false);
  });
});

describe("DEFAULT_BRIEF_V1 — cross-field invariants", () => {
  it("stale without source_hashes is rejected", () => {
    const { source_hashes: _ignore, ...withoutHashes } = ACTIVE_BRIEF;
    void _ignore;
    const result = DEFAULT_BRIEF_V1.propertiesSchema.safeParse({
      ...withoutHashes,
      status: "stale",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // The error must reference source_hashes on its path.
      const onSourceHashes = result.error.issues.some((i) => i.path.includes("source_hashes"));
      expect(onSourceHashes).toBe(true);
    }
  });

  it("superseded without superseded_by is rejected (inherited from default-v1)", () => {
    const result = DEFAULT_BRIEF_V1.propertiesSchema.safeParse({
      ...ACTIVE_BRIEF,
      status: "superseded",
      superseded_by: null,
      superseded_reason: "recompiled",
    });
    expect(result.success).toBe(false);
  });

  it("superseded without superseded_reason is rejected (inherited from default-v1)", () => {
    const result = DEFAULT_BRIEF_V1.propertiesSchema.safeParse({
      ...ACTIVE_BRIEF,
      status: "superseded",
      superseded_by: "obsidian-fs://v/_memory/_briefs/next.md",
      // no superseded_reason
    });
    expect(result.success).toBe(false);
  });
});

describe("DEFAULT_BRIEF_V1 — bounded fields", () => {
  it("rejects empty purpose", () => {
    const result = DEFAULT_BRIEF_V1.propertiesSchema.safeParse({
      ...ACTIVE_BRIEF,
      purpose: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects purpose > 500 chars (soft cap for list_briefs scannability)", () => {
    const result = DEFAULT_BRIEF_V1.propertiesSchema.safeParse({
      ...ACTIVE_BRIEF,
      purpose: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty compiled_from array", () => {
    const result = DEFAULT_BRIEF_V1.propertiesSchema.safeParse({
      ...ACTIVE_BRIEF,
      compiled_from: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects compiled_at without offset", () => {
    const result = DEFAULT_BRIEF_V1.propertiesSchema.safeParse({
      ...ACTIVE_BRIEF,
      compiled_at: "2026-05-18T10:00:00", // no Z, no offset
    });
    expect(result.success).toBe(false);
  });
});
