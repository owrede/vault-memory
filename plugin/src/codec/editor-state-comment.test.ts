/**
 * Unit tests for editor-state-comment (Phase 7 / D-FORMAT2).
 */

import { describe, it, expect } from "vitest";
import {
  encodeEditorComment,
  extractEditorComment,
  EDITOR_COMMENT_PREFIX,
} from "./editor-state-comment.js";
import type { EditorStateShape } from "../shared-types.js";

function editor(): EditorStateShape {
  return {
    nodes: [{ id: "step:alpha", x: 12, y: 34 }],
    selection: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    yamlComments: {},
  };
}

describe("encodeEditorComment", () => {
  it("emits `# vm-editor-state: <base64>\\n` exactly", () => {
    const out = encodeEditorComment(editor());
    expect(out.startsWith(EDITOR_COMMENT_PREFIX)).toBe(true);
    expect(out.endsWith("\n")).toBe(true);
    // Exactly one newline at the end (no embedded newlines in base64).
    expect(out.split("\n")).toHaveLength(2);
  });

  it("produces a base64 payload that decodes to JSON of the editor state", () => {
    const e = editor();
    const out = encodeEditorComment(e);
    const base64 = out.slice(EDITOR_COMMENT_PREFIX.length).trim();
    const decoded = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
    expect(decoded).toEqual(e);
  });
});

describe("extractEditorComment", () => {
  it("returns `editor: null` and untouched body when the header is absent", () => {
    const body = "version: 1\nname: x\n";
    const { editor: e, body: b } = extractEditorComment(body);
    expect(e).toBeNull();
    expect(b).toBe(body);
  });

  it("strips the leading header and returns the parsed editor state", () => {
    const e = editor();
    const yaml = encodeEditorComment(e) + "version: 1\nname: x\n";
    const { editor: parsed, body } = extractEditorComment(yaml);
    expect(parsed).toEqual(e);
    expect(body).toBe("version: 1\nname: x\n");
  });

  it("only strips ONE leading line — interior `# vm-editor-state` lines are preserved", () => {
    const e = editor();
    const yaml =
      encodeEditorComment(e) +
      "version: 1\n" +
      "# vm-editor-state: ZmFrZQ==\n" +
      "name: x\n";
    const { body } = extractEditorComment(yaml);
    expect(body).toContain("# vm-editor-state: ZmFrZQ==");
  });

  it("does not match a header that isn't on line 1", () => {
    const yaml =
      "version: 1\n" + EDITOR_COMMENT_PREFIX + "ZmFrZQ==\n" + "name: x\n";
    const { editor: e, body } = extractEditorComment(yaml);
    expect(e).toBeNull();
    expect(body).toBe(yaml);
  });

  it("recovers gracefully from a malformed base64 / JSON payload", () => {
    const bad = `${EDITOR_COMMENT_PREFIX}@@@not-base64@@@\nversion: 1\n`;
    const { editor: e, body } = extractEditorComment(bad);
    expect(e).toBeNull();
    // The bad header line is stripped; body remains the YAML payload.
    expect(body).toBe("version: 1\n");
  });
});

describe("encode + extract round-trip", () => {
  it("extractEditorComment(encodeEditorComment(e) + body).editor deepEqual e", () => {
    const e = editor();
    const body = "version: 1\nname: x\n";
    const wrapped = encodeEditorComment(e) + body;
    const { editor: parsed, body: extracted } = extractEditorComment(wrapped);
    expect(parsed).toEqual(e);
    expect(extracted).toBe(body);
  });

  it("survives multi-cycle: encode → extract → encode → extract", () => {
    const e = editor();
    const first = encodeEditorComment(e) + "v: 1\n";
    const r1 = extractEditorComment(first);
    expect(r1.editor).not.toBeNull();
    const second = encodeEditorComment(r1.editor as EditorStateShape) + r1.body;
    const r2 = extractEditorComment(second);
    expect(r2.editor).toEqual(e);
    expect(r2.body).toBe("v: 1\n");
  });

  it("preserves complex editor state including arrays and selection", () => {
    const e: EditorStateShape = {
      nodes: [
        { id: "step:a", x: 0, y: 0 },
        { id: "step:b", x: 220, y: 120 },
        { id: "step:c", x: 440, y: 240 },
      ],
      selection: ["step:a", "step:b"],
      viewport: { x: -10, y: -20, zoom: 1.25 },
      yamlComments: { topOfFile: "Some preserved comment text" },
    };
    const wrapped = encodeEditorComment(e);
    const { editor: parsed } = extractEditorComment(wrapped);
    expect(parsed).toEqual(e);
  });
});
