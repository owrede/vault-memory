/**
 * Unit tests for contract-codec (Phase 7 / ADR-007 §D-CANON-TEST).
 *
 * Mirrors the round-trip pattern in src/contracts/reference-contracts.test.ts
 * but adds the CAN-07 round-trip assertions (editor-state preservation +
 * canonical fixed-point stability). The full multi-fixture acceptance
 * test against the three reference contracts lives in plan 07-06; this
 * suite stops at unit-test scope.
 */

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseDocument } from "yaml";
import { emitYaml, parseYaml } from "./contract-codec.js";
import {
  EDITOR_COMMENT_PREFIX,
  encodeEditorComment,
} from "./editor-state-comment.js";
import type {
  ContractDocumentShape,
  EditorStateShape,
} from "../shared-types.js";

// Resolve fixture paths relative to this test file so vitest cwd is irrelevant.
const HERE = dirname(fileURLToPath(import.meta.url));
// plugin/src/codec/ → ../../../evals/...
const FIXTURES_ROOT = resolve(HERE, "../../../evals/fixtures/v2-test-vault/_contracts");
const MEETING_PREP_PATH = resolve(FIXTURES_ROOT, "meeting-prep.yaml");
const SMOKETEST_PATH = resolve(FIXTURES_ROOT, "smoketest-trivial.yaml");
const CODEC_SRC_PATH = resolve(HERE, "contract-codec.ts");

async function readFixture(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function sampleEditor(): EditorStateShape {
  return {
    nodes: [
      { id: "step:meeting", x: 0, y: 0 },
      { id: "step:linked", x: 220, y: 0 },
      { id: "step:clustered", x: 440, y: 0 },
      { id: "step:compiled", x: 660, y: 0 },
    ],
    selection: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    yamlComments: {},
  };
}

describe("contract-codec (D-CANON-TEST)", () => {
  it("Test 1: round-trip is a fixed-point on meeting-prep YAML (parse → emit → parse → emit stable)", async () => {
    const original = await readFixture(MEETING_PREP_PATH);

    // Inject a known editor-state header so round-trip 1 has explicit
    // editor state rather than a synthesized default. (The fixtures
    // themselves are user-authored YAML, so they have no header.)
    const header = encodeEditorComment(sampleEditor());
    const input = header + original;

    const doc1 = parseYaml(input);
    const yaml1 = emitYaml(doc1);

    const doc2 = parseYaml(yaml1);
    const yaml2 = emitYaml(doc2);

    // After the first canonicalization round, subsequent rounds must be
    // byte-stable. This is the "fixed-point" property of D-CANON-TEST.
    expect(yaml2).toBe(yaml1);
  });

  it("Test 2: parseDocument(round1).toJS() deepEqual parseDocument(round2).toJS()", async () => {
    const original = await readFixture(MEETING_PREP_PATH);
    const input = encodeEditorComment(sampleEditor()) + original;

    const yaml1 = emitYaml(parseYaml(input));
    const yaml2 = emitYaml(parseYaml(yaml1));

    // Strip the editor-state header for the semantic comparison — the
    // YAML body is what Phase 6 cares about. Both bodies must parse to
    // structurally identical JS values.
    const body1 = yaml1.split("\n").slice(1).join("\n");
    const body2 = yaml2.split("\n").slice(1).join("\n");
    expect(parseDocument(body1).toJS()).toEqual(parseDocument(body2).toJS());
  });

  it("Test 3: every emitted YAML starts with `# vm-editor-state: ` (D-FORMAT2)", async () => {
    const original = await readFixture(MEETING_PREP_PATH);
    const yaml = emitYaml(parseYaml(original));
    expect(yaml.startsWith(EDITOR_COMMENT_PREFIX)).toBe(true);
  });

  it("Test 4: parseYaml on YAML lacking the editor-state header synthesizes a default layout (nodes.length === assembly.length)", async () => {
    const original = await readFixture(MEETING_PREP_PATH);
    // Sanity: the fixture has NO editor-state header.
    expect(original.startsWith(EDITOR_COMMENT_PREFIX)).toBe(false);

    const doc = parseYaml(original);
    expect(doc.editor.nodes.length).toBe(doc.contract.assembly.length);
    // Default layout: LTR grid with 220 px stride, y = 0.
    for (let i = 0; i < doc.editor.nodes.length; i++) {
      const node = doc.editor.nodes[i];
      const step = doc.contract.assembly[i];
      expect(node).toBeDefined();
      expect(step).toBeDefined();
      expect(node!.id).toBe(`step:${step!.as}`);
      expect(node!.x).toBe(i * 220);
      expect(node!.y).toBe(0);
    }
    expect(doc.editor.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(doc.editor.selection).toBeNull();
  });

  it("Test 5: ContractFileSchema validation errors propagate with field path intact", () => {
    // Missing `name` field — Phase 6 ContractFileSchema rejects.
    const bad = `version: 1\nassembly:\n  - as: x\n    verb: literal\n    value: 1\n`;
    expect(() => parseYaml(bad)).toThrow();
    try {
      parseYaml(bad);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // ZodError serializes the field path; "name" must appear in the
      // formatted output so callers can pinpoint the issue.
      expect(message).toMatch(/name/i);
    }
  });

  it("Test 6: round-trip on smoketest-trivial fixture (literal-only assembly)", async () => {
    const original = await readFixture(SMOKETEST_PATH);
    const yaml1 = emitYaml(parseYaml(original));
    const yaml2 = emitYaml(parseYaml(yaml1));
    expect(yaml2).toBe(yaml1);

    const parsed = parseYaml(yaml1);
    expect(parsed.contract.name).toBe("smoketest-trivial");
    expect(parsed.contract.assembly.length).toBe(2);
    expect(parsed.editor.nodes.length).toBe(2);
  });

  it("Test 7: source contains the literal `parseDocument` identifier (yaml ^2.9 chokepoint)", async () => {
    // Read the codec source and assert it imports parseDocument — this
    // makes the dependency explicit so future refactors don't silently
    // swap to `parse()` (which loses comments per Pitfall §5).
    const src = await readFile(CODEC_SRC_PATH, "utf8");
    expect(src).toContain("parseDocument");
  });

  it("Test 8: emitYaml preserves an explicitly-supplied editor block through round-trip", () => {
    const editor: EditorStateShape = {
      nodes: [{ id: "step:only", x: 99, y: 88 }],
      selection: "step:only",
      viewport: { x: 1, y: 2, zoom: 1.5 },
      yamlComments: { topOfFile: "test comment" },
    };
    const doc: ContractDocumentShape = {
      vmFormatVersion: 1,
      contract: {
        version: 1,
        name: "only",
        description: "",
        inputs: {},
        required: [],
        sources: {},
        sinks: {},
        assembly: [{ as: "only", verb: "literal", value: 7 }],
      } as ContractDocumentShape["contract"],
      editor,
    };
    const yaml = emitYaml(doc);
    const parsed = parseYaml(yaml);
    expect(parsed.editor).toEqual(editor);
    expect(parsed.contract.name).toBe("only");
  });
});
