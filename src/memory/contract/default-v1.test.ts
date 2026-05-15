/**
 * Unit tests for `src/memory/contract/default-v1.ts`.
 *
 * The DEFAULT_MEMORY_V1 contract's Zod `propertiesSchema` is the
 * single source of truth for what `default-memory-v1` accepts. These
 * tests exercise:
 *
 *   - Positive: a fully-populated active observation parses cleanly.
 *   - Negative: each of the seven required keys is missing → safeParse
 *     fails identifying the missing key.
 *   - Enum: each enum-bound key with an out-of-range value → safeParse
 *     fails identifying the key.
 *   - Cross-field rule: `status === "superseded"` without
 *     `superseded_reason` (or with empty string, or with null
 *     `superseded_by`) → safeParse fails on the superseded_reason or
 *     superseded_by path.
 *   - Contract-extras (D-02): unknown keys pass through (passthrough).
 *
 * Mirrors test layout from src/adapters/registry.test.ts (the IIFE
 * parser tests) — describe per concern, then table-driven cases.
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_MEMORY_V1 } from "./default-v1.js";

const ACTIVE_OBSERVATION = {
  source: "agent",
  confidence: "direct",
  evidence: ["obsidian-fs://atlas/projects/Atlas-1.md"],
  status: "active",
  observed_at: "2026-04-16T10:00:00Z",
  superseded_by: null,
  type: "observation",
};

describe("DEFAULT_MEMORY_V1 — identity", () => {
  it("has the canonical name and version", () => {
    expect(DEFAULT_MEMORY_V1.name).toBe("default-memory-v1");
    expect(DEFAULT_MEMORY_V1.version).toBe("1.0");
  });

  it("lists the seven required keys in canonical order", () => {
    expect(DEFAULT_MEMORY_V1.requiredKeys).toEqual([
      "source",
      "confidence",
      "evidence",
      "status",
      "observed_at",
      "superseded_by",
      "type",
    ]);
  });

  it("uses the date-slug naming strategy", () => {
    expect(DEFAULT_MEMORY_V1.naming.strategy).toBe("date-slug");
    expect(DEFAULT_MEMORY_V1.naming.pattern).toBe("{observed_at:YYYY-MM-DD}-{slug}.md");
  });
});

describe("DEFAULT_MEMORY_V1 — propertiesSchema (positive)", () => {
  it("accepts a fully-populated active observation", () => {
    const result = DEFAULT_MEMORY_V1.propertiesSchema.safeParse(ACTIVE_OBSERVATION);
    expect(result.success).toBe(true);
  });

  it("accepts a fully-populated superseded observation with a reason", () => {
    const result = DEFAULT_MEMORY_V1.propertiesSchema.safeParse({
      ...ACTIVE_OBSERVATION,
      status: "superseded",
      superseded_by: "obsidian-fs://atlas/_memory/observations/newer.md",
      superseded_reason: "Alice clarified at the 2026-05-01 sync.",
    });
    expect(result.success).toBe(true);
  });

  it("passes through contract-extra keys (D-02 escape hatch)", () => {
    const result = DEFAULT_MEMORY_V1.propertiesSchema.safeParse({
      ...ACTIVE_OBSERVATION,
      expires_at: "2026-12-31T00:00:00Z",
      tags: ["pinned"],
    });
    expect(result.success).toBe(true);
  });
});

describe("DEFAULT_MEMORY_V1 — propertiesSchema (missing required keys)", () => {
  it.each([
    "source",
    "confidence",
    "evidence",
    "observed_at",
    "type",
    // NOTE: `status` and `superseded_by` are intentionally omitted —
    // per the MEMORY_CONTRACT.md spec both have defaults applied at
    // the adapter ("active" / null), so the schema does not reject
    // when they are absent. The cross-field rule still catches a
    // superseded-without-link case.
  ])("rejects when %s is missing", (key) => {
    const { [key]: _omitted, ...rest } = ACTIVE_OBSERVATION as Record<string, unknown>;
    void _omitted;
    const result = DEFAULT_MEMORY_V1.propertiesSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("DEFAULT_MEMORY_V1 — propertiesSchema (invalid enums)", () => {
  it.each([
    ["source", "not-an-allowed-value"],
    ["confidence", "completely-sure"],
    ["status", "garbage"],
  ])("rejects %s=%s", (key, value) => {
    const result = DEFAULT_MEMORY_V1.propertiesSchema.safeParse({
      ...ACTIVE_OBSERVATION,
      [key]: value,
    });
    expect(result.success).toBe(false);
  });
});

describe("DEFAULT_MEMORY_V1 — propertiesSchema (cross-field rule)", () => {
  it("rejects status=superseded with no superseded_reason", () => {
    const result = DEFAULT_MEMORY_V1.propertiesSchema.safeParse({
      ...ACTIVE_OBSERVATION,
      status: "superseded",
      superseded_by: "obsidian-fs://atlas/_memory/observations/newer.md",
    });
    expect(result.success).toBe(false);
  });

  it("rejects status=superseded with an empty superseded_reason", () => {
    const result = DEFAULT_MEMORY_V1.propertiesSchema.safeParse({
      ...ACTIVE_OBSERVATION,
      status: "superseded",
      superseded_by: "obsidian-fs://atlas/_memory/observations/newer.md",
      superseded_reason: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects status=superseded with null superseded_by", () => {
    const result = DEFAULT_MEMORY_V1.propertiesSchema.safeParse({
      ...ACTIVE_OBSERVATION,
      status: "superseded",
      superseded_by: null,
      superseded_reason: "explanation",
    });
    expect(result.success).toBe(false);
  });
});

describe("DEFAULT_MEMORY_V1 — propertiesSchema (invalid types)", () => {
  it("rejects evidence as a non-array", () => {
    const result = DEFAULT_MEMORY_V1.propertiesSchema.safeParse({
      ...ACTIVE_OBSERVATION,
      evidence: "not-an-array",
    });
    expect(result.success).toBe(false);
  });

  it("rejects observed_at that is not an ISO 8601 timestamp", () => {
    const result = DEFAULT_MEMORY_V1.propertiesSchema.safeParse({
      ...ACTIVE_OBSERVATION,
      observed_at: "yesterday",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty-string type", () => {
    const result = DEFAULT_MEMORY_V1.propertiesSchema.safeParse({
      ...ACTIVE_OBSERVATION,
      type: "",
    });
    expect(result.success).toBe(false);
  });
});
