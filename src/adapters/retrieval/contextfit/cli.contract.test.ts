/**
 * ContextFit CLI contract tests.
 *
 * Two layers:
 *  1. `parseQueryOutput` unit tests — pin the JSON shape vault-memory parses,
 *     using a captured real `contextfit query --json` payload. These run
 *     everywhere (no contextfit needed).
 *  2. A live round-trip (ingest → query) gated behind contextfit being on
 *     PATH. Skipped automatically when it isn't, so CI without contextfit
 *     stays green while a dev machine with it installed gets real coverage.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseQueryOutput,
  contextFitProbe,
  contextFitIngest,
  contextFitQuery,
  ContextFitError,
  type ContextFitCliConfig,
} from "./cli.js";

// Detect contextfit ONCE at module load so `describe.skipIf` can gate the live
// suite at collection time (beforeAll runs too late for a collection guard).
const CF_AVAILABLE = await contextFitProbe({ command: "contextfit" });

// A real captured `contextfit query "..." --json` payload (contextfit 0.1.0),
// trimmed to the fields vault-memory consumes plus the non-JSON preamble that
// the binary prints before the JSON object.
const REAL_OUTPUT = `Loading LSH from disk...
{
  "query": "warehouse robotics decision",
  "method": "hybrid",
  "retrieved_chunks": 2,
  "input_ids": [2, 28368, 10506],
  "sid_predictions": [{ "prefix": [1, 2], "score": 2.0, "depth": 4 }],
  "chunks": [
    {
      "rank": 1,
      "chunk_id": 1,
      "score": 500000.19,
      "level": 0,
      "parent_id": null,
      "token_count": 17,
      "semantic_id": [2000000197, 2000000361],
      "metadata": { "source": "/abs/vault/budget.md" },
      "preview": "# Budget Review\\n\\nThe Q2 budget was approved with a focus on warehouse robotics.",
      "tokens": [2, 28368, 10506]
    }
  ]
}`;

describe("parseQueryOutput — pinned ContextFit JSON contract", () => {
  it("parses the chunks[] array out of a real --json payload (with preamble)", () => {
    const r = parseQueryOutput(REAL_OUTPUT);
    expect(r.query).toBe("warehouse robotics decision");
    expect(r.method).toBe("hybrid");
    expect(r.chunks).toHaveLength(1);
    const c = r.chunks[0]!;
    expect(c.chunk_id).toBe(1);
    expect(c.score).toBeCloseTo(500000.19, 1);
    expect(c.metadata.source).toBe("/abs/vault/budget.md");
    expect(c.preview).toContain("warehouse robotics");
  });

  it("throws BAD_JSON when there is no JSON object in stdout", () => {
    expect(() => parseQueryOutput("Loading LSH... no json here")).toThrow(ContextFitError);
    try {
      parseQueryOutput("nothing");
    } catch (e) {
      expect((e as ContextFitError).code).toBe("BAD_JSON");
    }
  });

  it("throws BAD_JSON when the JSON lacks a chunks[] array", () => {
    expect(() => parseQueryOutput('{"query":"x","method":"hybrid"}')).toThrow(/chunks/);
  });
});

// ─── Live round-trip (only when contextfit is installed) ────────────────────
describe.skipIf(!CF_AVAILABLE)("ContextFit CLI live round-trip", () => {
  let kbDir = "";
  let vaultDir = "";
  let cfg: ContextFitCliConfig;

  beforeAll(async () => {
    const base = await fs.mkdtemp(join(tmpdir(), "vm-cf-contract-"));
    vaultDir = join(base, "vault");
    kbDir = join(base, "kb");
    await fs.mkdir(vaultDir, { recursive: true });
    await fs.writeFile(
      join(vaultDir, "budget.md"),
      "# Budget Review\n\nThe Q2 budget was approved with a focus on warehouse robotics.\n",
    );
    await fs.writeFile(
      join(vaultDir, "alice.md"),
      "# Alice Chen\n\nAlice is a robotics engineer who pivoted to warehouse automation.\n",
    );
    cfg = { command: "contextfit", kbPath: kbDir };
  });

  it("ingest then query returns chunks with source + preview", async () => {
    await contextFitIngest(cfg, vaultDir);
    const result = await contextFitQuery(cfg, "warehouse robotics", { topK: 3 });
    expect(result.chunks.length).toBeGreaterThan(0);
    const top = result.chunks[0]!;
    expect(typeof top.metadata.source).toBe("string");
    expect(top.metadata.source!).toMatch(/\.md$/);
    expect(typeof top.preview).toBe("string");
    expect(typeof top.score).toBe("number");
  }, 60_000);
});
