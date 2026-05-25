#!/usr/bin/env node
/**
 * One-shot regenerator for the three reference `.contract` files
 * shipped under `examples/contracts/`. Sourced from the Phase 6 YAML
 * fixtures at `evals/fixtures/v2-test-vault/_contracts/`.
 *
 * Output shape (per ADR-007 §D-FORMAT-SCHEMA):
 *   {
 *     "$schema": "https://vault-memory.dev/schemas/contract-v1.json",
 *     "vmFormatVersion": 1,
 *     "contract": <parsed yaml>,
 *     "editor": {
 *       "nodes": [{ "id": "step:<as>", "x": i*220, "y": 0 }, ...],
 *       "selection": null,
 *       "viewport": { "x": 0, "y": 0, "zoom": 1.0 },
 *       "yamlComments": {}
 *     }
 *   }
 *
 * The `editor.nodes` layout matches the codec's deterministic default
 * (plugin/src/codec/contract-codec.ts buildDefaultEditorState) so a
 * round-trip through emit/parse preserves the same coordinates.
 *
 * Usage:
 *   node examples/contracts/_generate.mjs
 *
 * This file is one-shot tooling — the canonical regression check is
 * `examples/contracts/round-trip.test.ts`.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const FIXTURES = resolve(REPO_ROOT, "evals/fixtures/v2-test-vault/_contracts");
const OUT_DIR = HERE;

const NAMES = ["meeting-prep", "project-status", "person-dossier"];

const DX = 220;
const DY = 0;

function buildEditor(contract) {
  const nodes = contract.assembly.map((step, i) => ({
    id: `step:${step.as}`,
    x: i * DX,
    y: 0 * DY,
  }));
  return {
    nodes,
    selection: null,
    viewport: { x: 0, y: 0, zoom: 1.0 },
    yamlComments: {},
  };
}

async function generateOne(name) {
  const yamlPath = resolve(FIXTURES, `${name}.yaml`);
  const yamlText = await readFile(yamlPath, "utf8");
  const contract = parseYaml(yamlText);

  if (contract.name !== name) {
    throw new Error(
      `Source mismatch: ${yamlPath} has contract.name=${contract.name} (expected ${name})`,
    );
  }

  const document = {
    $schema: "https://vault-memory.dev/schemas/contract-v1.json",
    vmFormatVersion: 1,
    contract,
    editor: buildEditor(contract),
  };

  const outPath = resolve(OUT_DIR, `${name}.contract`);
  await writeFile(outPath, JSON.stringify(document, null, 2) + "\n", "utf8");
  console.log(`wrote ${outPath}`);
}

async function main() {
  for (const name of NAMES) {
    await generateOne(name);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
