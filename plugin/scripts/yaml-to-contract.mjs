/**
 * yaml-to-contract.mjs — one-shot conversion of bundled YAML examples
 * into .contract files (the editor's JSON envelope).
 *
 * Why: the canvas editor is registered against the .contract extension.
 * Plain .yaml files in _contracts/ open in Obsidian's default text view
 * (or, for files outside the vault's recognised extensions, get passed
 * to the OS file opener). To make the four example contracts
 * canvas-editable on first click, we ship them as .contract JSON
 * envelopes.
 *
 * Reads:  plugin/examples/_contracts/*.yaml
 * Writes: plugin/examples/_contracts/*.contract  (same basename)
 *
 * Runs Node (the codec uses ESM imports + the `yaml` package). Invoke
 * from the plugin/ directory:
 *
 *   cd plugin && node scripts/yaml-to-contract.mjs
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = join(__dirname, "..", "examples", "_contracts");

const DEFAULT_NODE_DX = 220;
const DEFAULT_NODE_DY = 120;
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };

/**
 * Build a deterministic LTR layout for a contract — one node per
 * assembly step, 220 px apart. Matches the codec's buildDefaultEditorState
 * exactly so the first canvas open shows the same layout the codec
 * would have produced.
 */
function buildDefaultEditorState(contract) {
  const assembly = Array.isArray(contract.assembly) ? contract.assembly : [];
  const nodes = assembly.map((_step, i) => ({
    id: `step-${i}`,
    position: { x: i * DEFAULT_NODE_DX, y: 0 },
    size: { width: DEFAULT_NODE_DX - 20, height: DEFAULT_NODE_DY - 20 },
  }));
  return {
    selection: null,
    viewport: { ...DEFAULT_VIEWPORT },
    nodes,
    preservedComments: [],
  };
}

async function convertOne(yamlPath) {
  const yamlText = await readFile(yamlPath, "utf8");
  // Strip the editor-state header if present (these examples don't have
  // one — they were authored as plain Phase-6 YAML).
  const body = yamlText.replace(/^# vm-editor-state: [^\n]*\n/, "");
  const doc = parseDocument(body);
  const contract = doc.toJS();
  const editor = buildDefaultEditorState(contract);
  const envelope = {
    vmFormatVersion: 1,
    contract,
    editor,
  };
  const outPath = yamlPath.replace(/\.yaml$/, ".contract");
  await writeFile(outPath, JSON.stringify(envelope, null, 2) + "\n");
  console.log(`  ${basename(yamlPath)} → ${basename(outPath)}`);
  return outPath;
}

async function main() {
  const entries = await readdir(EXAMPLES_DIR);
  const yamls = entries.filter((e) => e.endsWith(".yaml")).map((e) => join(EXAMPLES_DIR, e));
  console.log(`Converting ${yamls.length} YAML example(s) → .contract envelopes`);
  for (const y of yamls) {
    await convertOne(y);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
