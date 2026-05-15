/**
 * Co-located unit tests for `validateAgentWrite`.
 *
 * Covers the five GuardFailure reasons + three negative-control passes
 * (the validator's API contract per Plan 02-03 Task 1 <behavior>).
 *
 * The contract under test is `DEFAULT_MEMORY_V1` (pre-seeded by the
 * `./contract/index.js` barrel at module load), so these tests do not
 * touch disk.
 */

import { describe, expect, it } from "vitest";
import { validateAgentWrite } from "./validator.js";
import { DEFAULT_MEMORY_V1 } from "./contract/index.js";
import { parseMemorySinkHandle } from "./sink.js";
import { formatDocId } from "../adapters/registry.js";
import type { Document, DocId, MemorySink } from "../types.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeSink(overrides: Partial<MemorySink> = {}): MemorySink {
  return {
    name: "test",
    handle: parseMemorySinkHandle("obsidian-fs://atlas/_memory/"),
    vault: "atlas",
    resolveToRelativePath: "_memory/",
    contractName: "default-memory-v1",
    isDefault: true,
    ...overrides,
  };
}

const INSIDE_SINK_ID: DocId = formatDocId(
  "obsidian-fs",
  "atlas",
  "_memory/observations/2026-01-01-foo.md",
);

const OUTSIDE_SINK_ID: DocId = formatDocId(
  "obsidian-fs",
  "atlas",
  "notes/random.md",
);

const VALID_PROPS: Record<string, unknown> = {
  source: "agent",
  confidence: "direct",
  evidence: ["call-with-jess-2026-01-01"],
  status: "active",
  observed_at: "2026-01-01T10:00:00Z",
  superseded_by: null,
  type: "fact",
};

function withProps(
  overrides: Record<string, unknown>,
): Partial<Document> {
  return { properties: { ...VALID_PROPS, ...overrides } };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("validateAgentWrite — Guard B (cheap, runs first)", () => {
  it("agent_write_outside_sink: source:'agent' with sink=null", () => {
    const failure = validateAgentWrite(
      OUTSIDE_SINK_ID,
      withProps({}),
      null,
      null,
    );
    expect(failure).not.toBeNull();
    if (!failure) return;
    expect(failure.ok).toBe(false);
    expect(failure.reason).toBe("agent_write_outside_sink");
    expect(failure.suggestion).toBe(
      "Use record_observation for memory writes; or change source to 'user' / 'imported'.",
    );
    expect(failure.message).toContain(OUTSIDE_SINK_ID);
  });

  it("non_agent_write_inside_sink: source:'user' with sink set", () => {
    const sink = makeSink();
    const failure = validateAgentWrite(
      INSIDE_SINK_ID,
      withProps({ source: "user" }),
      sink,
      DEFAULT_MEMORY_V1,
    );
    expect(failure).not.toBeNull();
    if (!failure) return;
    expect(failure.reason).toBe("non_agent_write_inside_sink");
    expect(failure.sinkName).toBe("test");
    expect(failure.message).toContain("user");
    expect(failure.message).toContain("test");
  });

  it("non_agent_write_inside_sink: source:'imported' with sink set", () => {
    const sink = makeSink();
    const failure = validateAgentWrite(
      INSIDE_SINK_ID,
      withProps({ source: "imported" }),
      sink,
      DEFAULT_MEMORY_V1,
    );
    expect(failure?.reason).toBe("non_agent_write_inside_sink");
    expect(failure?.sinkName).toBe("test");
  });
});

describe("validateAgentWrite — Guard A (Zod safeParse + cross-field)", () => {
  it("missing_provenance: missing observed_at", () => {
    const sink = makeSink();
    const props = { ...VALID_PROPS } as Record<string, unknown>;
    delete props.observed_at;
    const failure = validateAgentWrite(
      INSIDE_SINK_ID,
      { properties: props },
      sink,
      DEFAULT_MEMORY_V1,
    );
    expect(failure?.reason).toBe("missing_provenance");
    expect(failure?.key).toBe("observed_at");
    expect(failure?.sinkName).toBe("test");
    expect(failure?.suggestion).toContain("observed_at");
    expect(failure?.suggestion).toContain("default-memory-v1");
  });

  it("missing_provenance: missing source", () => {
    const sink = makeSink();
    const props = { ...VALID_PROPS } as Record<string, unknown>;
    delete props.source;
    const failure = validateAgentWrite(
      INSIDE_SINK_ID,
      { properties: props },
      sink,
      DEFAULT_MEMORY_V1,
    );
    expect(failure?.reason).toBe("missing_provenance");
    expect(failure?.key).toBe("source");
  });

  it("invalid_provenance: confidence='unknown'", () => {
    const sink = makeSink();
    const failure = validateAgentWrite(
      INSIDE_SINK_ID,
      withProps({ confidence: "unknown" }),
      sink,
      DEFAULT_MEMORY_V1,
    );
    expect(failure?.reason).toBe("invalid_provenance");
    expect(failure?.key).toBe("confidence");
    expect(failure?.observedValue).toBe("unknown");
    expect(failure?.sinkName).toBe("test");
  });

  it("invalid_provenance: observed_at not an ISO datetime", () => {
    const sink = makeSink();
    const failure = validateAgentWrite(
      INSIDE_SINK_ID,
      withProps({ observed_at: "not-a-date" }),
      sink,
      DEFAULT_MEMORY_V1,
    );
    expect(failure?.reason).toBe("invalid_provenance");
    expect(failure?.key).toBe("observed_at");
    expect(failure?.observedValue).toBe("not-a-date");
  });

  it("supersede_mismatch: status='superseded' + empty superseded_reason", () => {
    const sink = makeSink();
    const failure = validateAgentWrite(
      INSIDE_SINK_ID,
      withProps({
        status: "superseded",
        superseded_by: "obsidian-fs://atlas/_memory/observations/prior.md",
        superseded_reason: "",
      }),
      sink,
      DEFAULT_MEMORY_V1,
    );
    expect(failure?.reason).toBe("supersede_mismatch");
    expect(failure?.key).toBe("superseded_reason");
    expect(failure?.sinkName).toBe("test");
  });

  it("supersede_mismatch: status='superseded' + null superseded_by", () => {
    const sink = makeSink();
    const failure = validateAgentWrite(
      INSIDE_SINK_ID,
      withProps({
        status: "superseded",
        superseded_by: null,
        superseded_reason: "stale",
      }),
      sink,
      DEFAULT_MEMORY_V1,
    );
    expect(failure?.reason).toBe("supersede_mismatch");
    expect(failure?.key).toBe("superseded_by");
  });
});

describe("validateAgentWrite — negative controls (passes)", () => {
  it("returns null when sink=null and source=undefined (ordinary v1 write)", () => {
    const failure = validateAgentWrite(
      OUTSIDE_SINK_ID,
      { properties: { foo: "bar" } },
      null,
      null,
    );
    expect(failure).toBeNull();
  });

  it("returns null when sink=null and source='user' (user writing outside)", () => {
    const failure = validateAgentWrite(
      OUTSIDE_SINK_ID,
      { properties: { source: "user" } },
      null,
      null,
    );
    expect(failure).toBeNull();
  });

  it("returns null when sink set + source='agent' + all keys valid", () => {
    const sink = makeSink();
    const failure = validateAgentWrite(
      INSIDE_SINK_ID,
      withProps({}),
      sink,
      DEFAULT_MEMORY_V1,
    );
    expect(failure).toBeNull();
  });

  it("returns null when sink set + source='agent' + valid superseded payload", () => {
    const sink = makeSink();
    const failure = validateAgentWrite(
      INSIDE_SINK_ID,
      withProps({
        status: "superseded",
        superseded_by:
          "obsidian-fs://atlas/_memory/observations/2026-01-01-prior.md",
        superseded_reason: "newer observation supersedes this",
      }),
      sink,
      DEFAULT_MEMORY_V1,
    );
    expect(failure).toBeNull();
  });
});
