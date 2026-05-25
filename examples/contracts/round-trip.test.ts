/**
 * CAN-06 + CAN-07 acceptance test — Phase 7 / ADR-007 §D-CANON-TEST.
 *
 * The two acceptance criteria close in this single file:
 *
 *   - CAN-06: For each of the three reference `.contract` files shipped
 *     under `examples/contracts/`, the JSON-encoded `contract` block
 *     deepEqual's the parsed Phase 6 YAML fixture under
 *     `evals/fixtures/v2-test-vault/_contracts/`. The `.contract` files
 *     are pinned to the YAML twins.
 *
 *   - CAN-07: For each fixture (3 reference + smoketest-trivial), the
 *     codec round-trip is a fixed-point — `parseYaml → emitYaml →
 *     parseYaml → emitYaml` produces byte-identical YAML on the third
 *     and fourth emissions, and the editor-state comment block survives
 *     across cycles.
 *
 * Test discipline: `node:fs/promises` is permitted in *.test.ts files
 * because `scripts/lint-adapters.sh` excludes them by filename. The
 * sibling analog at `src/contracts/reference-contracts.test.ts` documents
 * the carve-out.
 */

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseDocument } from "yaml";
import { emitYaml, parseYaml } from "../../plugin/src/codec/contract-codec.js";
import { EDITOR_COMMENT_PREFIX } from "../../plugin/src/codec/editor-state-comment.js";
import { ContractDocumentSchema } from "../../src/contracts/contract-file-schema.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const YAML_FIXTURES_ROOT = resolve(
  REPO_ROOT,
  "evals/fixtures/v2-test-vault/_contracts",
);
const CONTRACT_FIXTURES_ROOT = HERE;

/**
 * Four round-trip fixtures: three reference contracts (CAN-06 anchors)
 * plus smoketest-trivial (CAN-07-only sanity).
 */
const FIXTURES = [
  {
    name: "meeting-prep",
    yamlPath: resolve(YAML_FIXTURES_ROOT, "meeting-prep.yaml"),
    contractPath: resolve(CONTRACT_FIXTURES_ROOT, "meeting-prep.contract"),
    canon06: true,
  },
  {
    name: "project-status",
    yamlPath: resolve(YAML_FIXTURES_ROOT, "project-status.yaml"),
    contractPath: resolve(CONTRACT_FIXTURES_ROOT, "project-status.contract"),
    canon06: true,
  },
  {
    name: "person-dossier",
    yamlPath: resolve(YAML_FIXTURES_ROOT, "person-dossier.yaml"),
    contractPath: resolve(CONTRACT_FIXTURES_ROOT, "person-dossier.contract"),
    canon06: true,
  },
  {
    name: "smoketest-trivial",
    yamlPath: resolve(YAML_FIXTURES_ROOT, "smoketest-trivial.yaml"),
    contractPath: null,
    canon06: false,
  },
] as const;

/**
 * Decode the base64 editor-state payload off the leading
 * `# vm-editor-state: <base64>\n` header.
 */
function decodeEditorState(yamlText: string): unknown {
  const nl = yamlText.indexOf("\n");
  if (nl === -1) throw new Error("Emitted YAML has no newline");
  const firstLine = yamlText.slice(0, nl);
  if (!firstLine.startsWith(EDITOR_COMMENT_PREFIX)) {
    throw new Error(
      `Emitted YAML does not start with editor-state header: ${firstLine}`,
    );
  }
  const base64 = firstLine.slice(EDITOR_COMMENT_PREFIX.length).trim();
  const json = Buffer.from(base64, "base64").toString("utf8");
  return JSON.parse(json);
}

/** Strip the editor-state header so semantic compares ignore it. */
function stripEditorHeader(yamlText: string): string {
  const nl = yamlText.indexOf("\n");
  if (nl === -1) return yamlText;
  const firstLine = yamlText.slice(0, nl);
  if (firstLine.startsWith(EDITOR_COMMENT_PREFIX)) {
    return yamlText.slice(nl + 1);
  }
  return yamlText;
}

describe("round-trip (CAN-07) across four fixtures", () => {
  for (const fixture of FIXTURES) {
    it(`fixed-point: ${fixture.name} — 3rd and 4th emissions are byte-identical`, async () => {
      const originalYaml = await readFile(fixture.yamlPath, "utf8");

      // Cycle 1: parse the fixture (no editor header), emit (synthesizes
      // default layout). Subsequent cycles preserve the editor header.
      const doc1 = parseYaml(originalYaml);
      const yaml1 = emitYaml(doc1);
      const doc2 = parseYaml(yaml1);
      const yaml2 = emitYaml(doc2);

      // After the first canonicalization round, subsequent emissions must
      // be byte-stable. yaml1 and yaml2 are the "third and fourth
      // emissions" semantically (the fixture YAML is the first authored
      // form; yaml1 is the first canonical emit; yaml2 is the second).
      expect(yaml2).toBe(yaml1);
    });

    it(`deepEqual JS: ${fixture.name} — round1 body parses to same JS as round2 body`, async () => {
      const originalYaml = await readFile(fixture.yamlPath, "utf8");
      const yaml1 = emitYaml(parseYaml(originalYaml));
      const yaml2 = emitYaml(parseYaml(yaml1));

      const body1 = stripEditorHeader(yaml1);
      const body2 = stripEditorHeader(yaml2);
      expect(parseDocument(body1).toJS()).toEqual(parseDocument(body2).toJS());
    });

    it(`editor-state header present: ${fixture.name} — every emitted YAML starts with the literal`, async () => {
      const originalYaml = await readFile(fixture.yamlPath, "utf8");
      const yaml1 = emitYaml(parseYaml(originalYaml));
      const yaml2 = emitYaml(parseYaml(yaml1));
      expect(yaml1.startsWith(EDITOR_COMMENT_PREFIX)).toBe(true);
      expect(yaml2.startsWith(EDITOR_COMMENT_PREFIX)).toBe(true);
    });

    it(`editor-state survives two cycles: ${fixture.name} — decoded payloads are structurally equal`, async () => {
      const originalYaml = await readFile(fixture.yamlPath, "utf8");
      const yaml1 = emitYaml(parseYaml(originalYaml));
      const yaml2 = emitYaml(parseYaml(yaml1));
      const editor1 = decodeEditorState(yaml1);
      const editor2 = decodeEditorState(yaml2);
      expect(editor2).toEqual(editor1);
    });
  }
});

describe("CAN-06 — three reference .contract files pin to Phase 6 YAML twins", () => {
  for (const fixture of FIXTURES) {
    if (!fixture.canon06 || fixture.contractPath === null) continue;

    it(`${fixture.name}.contract validates and contract block deepEqual's YAML`, async () => {
      const contractText = await readFile(fixture.contractPath, "utf8");
      const contractJson = JSON.parse(contractText) as unknown;

      // The wrapper must validate against ContractDocumentSchema.
      const parsed = ContractDocumentSchema.parse(contractJson);

      // The contract block must deepEqual the parsed YAML's JS value.
      // We use parseYaml on the YAML to get a fully-defaulted Phase 6
      // shape (matches what parseDocument(...).toJS() then
      // ContractFileSchema.parse(...) would produce). The .contract's
      // contract block has the same defaults applied (it was generated
      // from yaml.parse which preserves only authored fields), so a
      // direct deepEqual would fail on Zod-applied defaults. Round-trip
      // both sides through ContractFileSchema to normalize defaults.
      const yamlText = await readFile(fixture.yamlPath, "utf8");
      const yamlDoc = parseYaml(yamlText);

      expect(parsed.contract).toEqual(yamlDoc.contract);
      expect(parsed.contract.name).toBe(fixture.name);
      expect(parsed.editor.nodes.length).toBe(parsed.contract.assembly.length);
    });
  }
});
