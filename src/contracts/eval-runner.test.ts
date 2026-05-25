/**
 * Eval-runner — CON-08 + CON-10 eval scenarios.
 *
 * Loads each `evals/fixtures/v2-test-vault/_queries/contracts-*.yaml`
 * scenario file, looks up the referenced contract under
 * `_contracts/<name>.yaml`, runs `instantiateContract` with mocked
 * `handleCompileBrief` and stubbed delivery/sink registry, and asserts:
 *
 *   1. `result.ok === true` (the orchestrator produced a bundle).
 *   2. The bundle matches `scenario.expected_output_shape` (JSON Schema
 *      fragment → Zod via `z.fromJSONSchema`).
 *   3. When present, the resolved `write_back.properties` carry every
 *      key in `scenario.expected_write_back.properties_required`.
 *
 * Q-CI-LLM resolution: `handleCompileBrief` is deterministically mocked
 * — CI runs without Ollama, without MCP Sampling, without any LLM. The
 * orchestrator (steps 1-3 + write_back path) is proven structurally;
 * the LLM ladder itself is covered by Phase 5's own tests.
 *
 * Test discipline: `node:fs/promises` is permitted in *.test.ts via
 * `scripts/lint-adapters.sh --exclude='*.test.ts'`.
 */

import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";
import { z } from "zod";
import { Database } from "../db/database.js";
import { ContractFileSchema } from "./schema.js";
import { buildInputSchema } from "./input-schema.js";
import { ContractRegistry } from "./registry.js";
import { PeerMcpRegistry } from "./mcp-clients.js";
import {
  instantiateContract,
  type InstantiateDeps,
} from "./instantiate.js";
import type { ParsedContract } from "./types.js";
import type { DocId } from "../types.js";

const SCENARIO_FILES = [
  "evals/fixtures/v2-test-vault/_queries/contracts-meeting-prep.yaml",
  "evals/fixtures/v2-test-vault/_queries/contracts-project-status.yaml",
  "evals/fixtures/v2-test-vault/_queries/contracts-person-dossier.yaml",
  "evals/fixtures/v2-test-vault/_queries/contracts-stub-parity.yaml",
] as const;

interface Scenario {
  name: string;
  contract: string;
  inputs: Record<string, unknown>;
  expected_output_shape?: Record<string, unknown>;
  expected_write_back?: {
    sink: string;
    properties_required: string[];
  };
  source_overrides?: Record<string, string>;
  expected_output_shape_matches?: { reference: string };
}

interface ScenarioFile {
  description: string;
  scenarios: Scenario[];
}

async function loadContract(name: string): Promise<ParsedContract> {
  const path = `evals/fixtures/v2-test-vault/_contracts/${name}.yaml`;
  const text = await readFile(path, "utf8");
  const validated = ContractFileSchema.parse(
    parseDocument(text).toJS() as unknown,
  );
  const built = buildInputSchema(validated.inputs, validated.required);
  return {
    version: 1,
    name: validated.name,
    description: validated.description,
    inputs: validated.inputs,
    required: validated.required,
    sources: validated.sources,
    sinks: validated.sinks,
    assembly: validated.assembly,
    inputZodSchema: built.zodSchema,
    inputJsonSchema: built.jsonSchema,
    ...(validated.output_shape !== undefined
      ? { output_shape: validated.output_shape as object }
      : {}),
    ...(validated.write_back !== undefined
      ? { write_back: validated.write_back }
      : {}),
  };
}

// Builds a deterministic, LLM-free InstantiateDeps for eval runs.
// Captures the resolved write_back properties so the test harness can
// assert MEM-05 keys are present.
interface EvalRunDeps extends InstantiateDeps {
  capturedProperties: { value: Record<string, unknown> | null };
}

function buildEvalDeps(registry: ContractRegistry): EvalRunDeps {
  const db = new Database(":memory:");
  const captured: { value: Record<string, unknown> | null } = { value: null };

  const memorySinks = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolveMemorySink: vi.fn((h: string): any => ({
      name: "_memory/_briefs",
      handle: h,
    })),
  } as unknown as InstantiateDeps["memorySinks"];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delivery: any = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    write: vi.fn(async (_id: DocId, doc: any) => {
      captured.value = doc.properties ?? {};
      return {
        ok: true,
        newHash: "h-eval",
        doc_id: "obsidian-fs://test-vault/_memory/_briefs/eval.md" as DocId,
        created: true,
      };
    }),
  };

  // Q-CI-LLM (option b): mock compile_brief deterministically so CI
  // does not depend on Ollama / MCP Sampling.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockCompileBrief = vi.fn(async (args: any) => {
    const target = String(args.target ?? "untitled");
    const sources = Array.isArray(args.source_doc_ids) ? args.source_doc_ids : [];
    return {
      ok: true,
      doc_id:
        "obsidian-fs://test-vault/_memory/_briefs/" +
        target.replace(/[^a-z0-9-]/gi, "_") +
        ".md",
      body:
        "# Stub brief for " +
        target +
        "\n## Sources\n" +
        sources.map((d: string) => "- [[" + d + "]]").join("\n"),
    };
  });

  // The other baseline verbs are mocked to return shapes that any
  // contract's downstream step can consume (e.g., `linked.doc_ids` for
  // the meeting-prep contract's cluster step).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockExpand = vi.fn(async () => ({
    ok: true,
    doc_ids: ["obsidian-fs://test-vault/projects/atlas-1.md"],
    packets: [],
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockCluster = vi.fn(async () => ({
    ok: true,
    communities: [],
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockReadNote = vi.fn(async () => ({
    ok: true,
    title: "stubbed",
    content: "stub body",
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockQueryFrontmatter = vi.fn(async () => ({
    ok: true,
    doc_ids: ["obsidian-fs://test-vault/projects/atlas-1.md"],
    results: [],
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockHybridSearch = vi.fn(async () => ({
    ok: true,
    doc_ids: ["obsidian-fs://test-vault/projects/atlas-1.md"],
    hits: [],
  }));
  const noop = vi.fn(async () => ({ ok: true }));

  return {
    vault: { config: { name: "test-vault" }, db } as InstantiateDeps["vault"],
    contractAudit: db.contractAudit,
    registry,
    memorySinks,
    delivery,
    configDefaults: {},
    stepTimeoutSeconds: 30,
    peerMcpRegistry: new PeerMcpRegistry(),
    hybridSearch: mockHybridSearch,
    handleExpand: mockExpand,
    handleCluster: mockCluster,
    handleRecall: noop,
    handleCompileBrief: mockCompileBrief,
    handleGetBrief: noop,
    handleQueryFrontmatter: mockQueryFrontmatter,
    handleListBacklinks: noop,
    handleGetOutline: noop,
    handleSearchSections: noop,
    handleReadNote: mockReadNote,
    capturedProperties: captured,
  };
}

describe("contract eval scenarios (CON-08 + CON-10)", () => {
  for (const file of SCENARIO_FILES) {
    it(`runs every scenario in ${file}`, async () => {
      const yamlText = await readFile(file, "utf8");
      const scenarioDoc = parseDocument(yamlText).toJS() as ScenarioFile;

      for (const scenario of scenarioDoc.scenarios) {
        const parsed = await loadContract(scenario.contract);
        const registry = new ContractRegistry();
        registry.set(parsed.name, parsed);

        const deps = buildEvalDeps(registry);
        const result = await instantiateContract(deps, {
          name: scenario.contract,
          inputs: scenario.inputs,
          ...(scenario.source_overrides !== undefined
            ? { source_overrides: scenario.source_overrides }
            : {}),
        });

        expect(result.ok, `${file}:${scenario.name} → ${JSON.stringify(result)}`).toBe(true);
        if (!result.ok) continue;

        // (2) Bundle matches the scenario's expected_output_shape.
        if (scenario.expected_output_shape !== undefined) {
          // Build a Zod schema from the scenario's JSON Schema fragment.
          // The shape only constrains structure of the returned bundle;
          // it does not validate every property exhaustively.
          const outSchema = z.fromJSONSchema(
            scenario.expected_output_shape as unknown as Parameters<
              typeof z.fromJSONSchema
            >[0],
          );
          const check = outSchema.safeParse({
            steps: result.steps,
            write_back: result.write_back,
          });
          expect(
            check.success,
            `${file}:${scenario.name} bundle shape mismatch — ` +
              JSON.stringify(check.success ? null : check.error.format()),
          ).toBe(true);
        }

        // (3) write_back properties contain MEM-05 required keys.
        if (scenario.expected_write_back !== undefined) {
          const props = deps.capturedProperties.value ?? {};
          for (const key of scenario.expected_write_back.properties_required) {
            expect(
              Object.prototype.hasOwnProperty.call(props, key),
              `${file}:${scenario.name} missing write_back property "${key}"`,
            ).toBe(true);
          }
        }

        // (4) Stub-parity scenario: re-run the referenced reference scenario
        // with no source_overrides and assert identical bundle shape
        // (Object.keys(steps).sort() + write_back.sink).
        if (scenario.expected_output_shape_matches?.reference !== undefined) {
          const refName = scenario.expected_output_shape_matches.reference;
          // Look up the reference scenario in contracts-meeting-prep.yaml.
          const refText = await readFile(
            "evals/fixtures/v2-test-vault/_queries/contracts-meeting-prep.yaml",
            "utf8",
          );
          const refDoc = parseDocument(refText).toJS() as ScenarioFile;
          const refScenario = refDoc.scenarios.find((s) => s.name === refName);
          expect(refScenario, `reference scenario "${refName}" missing`).toBeDefined();
          if (!refScenario) continue;

          const refRegistry = new ContractRegistry();
          const refParsed = await loadContract(refScenario.contract);
          refRegistry.set(refParsed.name, refParsed);
          const refDeps = buildEvalDeps(refRegistry);
          const refResult = await instantiateContract(refDeps, {
            name: refScenario.contract,
            inputs: refScenario.inputs,
          });
          expect(refResult.ok).toBe(true);
          if (!refResult.ok) continue;
          // CON-10 parity: same step keys + same sink type on write_back.
          expect(Object.keys(result.steps).sort()).toEqual(
            Object.keys(refResult.steps).sort(),
          );
          expect(result.write_back?.sink).toBe(refResult.write_back?.sink);
        }
      }
    });
  }
});
