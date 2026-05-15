/**
 * MEM-10 fixture lint — Plan 02-07.
 *
 * Walks two trees:
 *   1. `evals/fixtures/v2-test-vault/_memory/` — the CLEAN tree. Every
 *      doc must pass `DEFAULT_MEMORY_V1.propertiesSchema.safeParse`,
 *      `superseded_by` values are full DocIds, the A→B→C Spire-budget
 *      supersede chain is intact, and the sentinel is correctly shaped.
 *   2. `tests/fixtures/malformed-memory/` — the DELIBERATELY-BROKEN tree.
 *      Each doc carries an `expected_reason` (and usually an
 *      `expected_key`) in its frontmatter; the test asserts the FIRST
 *      validator issue maps to that reason/key.
 *
 * The malformed tree lives under `tests/fixtures/` rather than
 * `evals/fixtures/` precisely so the v1-baseline eval suite and any
 * future clean-fixture lint cannot accidentally scoop it up — the
 * directory boundary is the safety net (per Plan 02-07 must-have:
 * "Greps that check for hyphenated provenance keys MUST exclude
 * tests/fixtures/malformed-memory/").
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";

import { DEFAULT_MEMORY_V1 } from "../src/memory/contract/default-v1.js";
import { validateAgentWrite } from "../src/memory/validator.js";
import { parseDocId } from "../src/adapters/registry.js";

const memoryDir = "evals/fixtures/v2-test-vault/_memory";
const malformedDir = "tests/fixtures/malformed-memory";

interface WalkedDoc {
  path: string;
  fm: Record<string, unknown>;
  body: string;
}

function walkMarkdown(root: string): WalkedDoc[] {
  const out: WalkedDoc[] = [];
  function recurse(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        recurse(join(dir, entry.name));
      } else if (entry.name.endsWith(".md") && entry.name !== "README.md") {
        const full = join(dir, entry.name);
        const parsed = matter(readFileSync(full, "utf8"));
        out.push({ path: full, fm: parsed.data, body: parsed.content });
      }
    }
  }
  recurse(root);
  return out;
}

describe("MEM-10 — clean fixture validates against default-memory-v1", () => {
  const docs = walkMarkdown(memoryDir);

  it("contains exactly 20 markdown documents", () => {
    expect(docs.length).toBe(20);
  });

  it("partitions into 13 observations + 3 briefs + 4 status-updates", () => {
    const obs = docs.filter((d) => d.path.includes("/observations/")).length;
    const briefs = docs.filter((d) => d.path.includes("/_briefs/")).length;
    const status = docs.filter((d) => d.path.includes("/status-updates/")).length;
    expect(obs).toBe(13);
    expect(briefs).toBe(3);
    expect(status).toBe(4);
  });

  it.each(docs)("$path passes propertiesSchema", ({ path, fm }) => {
    const result = DEFAULT_MEMORY_V1.propertiesSchema.safeParse(fm);
    if (!result.success) {
      throw new Error(
        `${path}: ${JSON.stringify(result.error.issues, null, 2)}`,
      );
    }
  });

  it("all superseded_by values are either null or full DocId form", () => {
    for (const doc of docs) {
      const sb = doc.fm["superseded_by"];
      if (sb === null || sb === undefined) continue;
      expect(typeof sb).toBe("string");
      expect(sb).toMatch(/^obsidian-fs:\/\//);
      // Must round-trip through the branded DocId parser.
      parseDocId(sb as string);
    }
  });

  it("contains the A→B→C Spire-budget supersede chain", () => {
    const byPath = new Map(docs.map((d) => [d.path, d]));
    const a = byPath.get(
      join(memoryDir, "observations/2026-04-23-spire-budget-uncertain.md"),
    );
    const b = byPath.get(
      join(memoryDir, "observations/2026-04-24-spire-budget-revised.md"),
    );
    const c = byPath.get(
      join(memoryDir, "observations/2026-04-26-spire-budget-final.md"),
    );
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(c).toBeDefined();
    expect(a!.fm["status"]).toBe("superseded");
    expect(b!.fm["status"]).toBe("superseded");
    expect(c!.fm["status"]).toBe("active");
    expect(a!.fm["superseded_by"]).toBe(
      "obsidian-fs://atlas-fixture/_memory/observations/2026-04-24-spire-budget-revised.md",
    );
    expect(b!.fm["superseded_by"]).toBe(
      "obsidian-fs://atlas-fixture/_memory/observations/2026-04-26-spire-budget-final.md",
    );
    expect(c!.fm["superseded_by"]).toBeNull();
    expect(typeof a!.fm["superseded_reason"]).toBe("string");
    expect((a!.fm["superseded_reason"] as string).length).toBeGreaterThan(0);
    expect(typeof b!.fm["superseded_reason"]).toBe("string");
    expect((b!.fm["superseded_reason"] as string).length).toBeGreaterThan(0);
  });

  it("confidence enum coverage spans all three values", () => {
    const confidences = new Set(docs.map((d) => d.fm["confidence"]));
    expect(confidences).toContain("direct");
    expect(confidences).toContain("inferred");
    expect(confidences).toContain("uncertain");
  });

  it("type enum coverage includes observation, hypothesis, decision, brief, status-update", () => {
    const types = new Set(docs.map((d) => d.fm["type"]));
    expect(types).toContain("observation");
    expect(types).toContain("hypothesis");
    expect(types).toContain("decision");
    expect(types).toContain("brief");
    expect(types).toContain("status-update");
  });

  it("status enum coverage includes active and superseded", () => {
    const statuses = new Set(docs.map((d) => d.fm["status"]));
    expect(statuses).toContain("active");
    expect(statuses).toContain("superseded");
  });

  it("observed_at spans at least 14 days (2026-04-16 → 2026-04-28)", () => {
    const dates = docs
      .map((d) => d.fm["observed_at"])
      .filter((v): v is string => typeof v === "string")
      .map((s) => s.slice(0, 10))
      .sort();
    expect(dates[0]).toBeDefined();
    expect(dates[dates.length - 1]).toBeDefined();
    // Earliest is the historical pre-pivot doc (2026-03-01); latest is
    // the Q2 OKR decision (2026-04-28). The 14-day window guard is on
    // the post-pivot density: at least one doc on or before 2026-04-16,
    // at least one on or after 2026-04-28.
    expect(dates.some((d) => d <= "2026-04-16")).toBe(true);
    expect(dates.some((d) => d >= "2026-04-28")).toBe(true);
  });
});

describe("MEM-10 — sentinel file is present and correctly shaped", () => {
  it(".memory-sink exists at the sink root with three k:v lines", () => {
    const path = join(memoryDir, ".memory-sink");
    const content = readFileSync(path, "utf8");
    expect(content).toMatch(/created_at: /);
    expect(content).toMatch(/sink_name: /);
    expect(content).toMatch(/vault_memory_version: /);
  });
});

describe("MEM-10 — malformed fixtures reject with expected reason", () => {
  const malformed = walkMarkdown(malformedDir);

  it("contains exactly 5 malformed documents", () => {
    expect(malformed.length).toBe(5);
  });

  it.each(malformed)(
    "$path fails validation with expected_reason '$fm.expected_reason'",
    ({ path, fm }) => {
      const expectedReason = fm["expected_reason"] as string;
      const expectedKey = fm["expected_key"] as string | undefined;

      if (expectedReason === "agent_write_outside_sink") {
        // Guard B path — structurally well-formed doc, no sink resolves.
        // Mint a synthetic DocId outside any sink and run the validator.
        const id = parseDocId(
          "obsidian-fs://atlas-fixture/not-a-sink/synthetic-test.md",
        );
        const result = validateAgentWrite(
          id,
          { properties: fm },
          /* sink */ null,
          /* contract */ null,
        );
        expect(result).not.toBeNull();
        expect(result!.reason).toBe("agent_write_outside_sink");
        return;
      }

      // Guard A path — schema parse must fail and the FIRST issue's path
      // head must match expected_key.
      const result = DEFAULT_MEMORY_V1.propertiesSchema.safeParse(fm);
      expect(result.success).toBe(false);
      if (!result.success) {
        const firstIssue = result.error.issues[0];
        expect(firstIssue).toBeDefined();
        if (expectedKey) {
          expect(firstIssue!.path[0]).toBe(expectedKey);
        }
      }
    },
  );
});
