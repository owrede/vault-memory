/**
 * Unit tests for ContractDocumentSchema (Phase 7 / ADR-007 D-FORMAT-SCHEMA).
 *
 * Verifies the `.contract` JSON envelope: vmFormatVersion gate, nested
 * Phase 6 `ContractFileSchema` re-validation, editor block presence, and
 * the forward-compat passthrough for unknown editor keys (C-7-6).
 */

import { describe, it, expect } from "vitest";
import { ContractDocumentSchema, type ContractDocumentShape } from "./contract-file-schema.js";

const VALID_CONTRACT_BLOCK = {
  version: 1 as const,
  name: "minimal",
  description: "",
  inputs: {},
  required: [],
  sources: {},
  sinks: {},
  assembly: [{ as: "step", verb: "literal", value: 1 }],
};

const VALID_EDITOR_BLOCK = {
  nodes: [{ id: "step:step", x: 0, y: 0 }],
  selection: null,
  viewport: { x: 0, y: 0, zoom: 1 },
  yamlComments: {},
};

function validDoc(): unknown {
  return {
    vmFormatVersion: 1,
    contract: structuredClone(VALID_CONTRACT_BLOCK),
    editor: structuredClone(VALID_EDITOR_BLOCK),
  };
}

describe("ContractDocumentSchema (D-FORMAT-SCHEMA)", () => {
  it("accepts a valid minimal `.contract` document", () => {
    const result = ContractDocumentSchema.safeParse(validDoc());
    if (!result.success) {
      throw new Error(`validDoc rejected: ${JSON.stringify(result.error.issues, null, 2)}`);
    }
    expect(result.success).toBe(true);
    expect(result.data.vmFormatVersion).toBe(1);
    expect(result.data.contract.name).toBe("minimal");
    expect(result.data.editor.nodes).toHaveLength(1);
  });

  it("rejects `vmFormatVersion: 2` (only format version 1 is supported)", () => {
    const doc = validDoc() as Record<string, unknown>;
    doc.vmFormatVersion = 2;
    const result = ContractDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("vmFormatVersion");
    }
  });

  it("rejects documents missing `vmFormatVersion`", () => {
    const doc = validDoc() as Record<string, unknown>;
    delete doc.vmFormatVersion;
    const result = ContractDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it("rejects documents missing the `editor` block", () => {
    const doc = validDoc() as Record<string, unknown>;
    delete doc.editor;
    const result = ContractDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it("rejects documents missing `editor.viewport`", () => {
    const doc = validDoc() as { editor: Record<string, unknown> } & Record<string, unknown>;
    delete doc.editor.viewport;
    const result = ContractDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.startsWith("editor"))).toBe(true);
    }
  });

  it("propagates Phase 6 ContractFileSchema errors for an invalid inner contract", () => {
    // `name` must be kebab-case per ContractFileSchema. "Not Kebab" is not.
    const doc = validDoc() as { contract: Record<string, unknown> } & Record<string, unknown>;
    doc.contract.name = "Not Kebab";
    const result = ContractDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.startsWith("contract."))).toBe(true);
    }
  });

  it("rejects documents missing the `contract` block", () => {
    const doc = validDoc() as Record<string, unknown>;
    delete doc.contract;
    const result = ContractDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it("accepts unknown `editor.*` keys (forward-compat C-7-6)", () => {
    const doc = validDoc() as { editor: Record<string, unknown> } & Record<string, unknown>;
    doc.editor.futureField = { some: "extension" };
    const result = ContractDocumentSchema.safeParse(doc);
    expect(result.success).toBe(true);
    if (result.success) {
      // passthrough preserves the unknown key on parsed output
      expect((result.data.editor as Record<string, unknown>).futureField).toEqual({
        some: "extension",
      });
    }
  });

  it("accepts the optional `$schema` URI literal when present", () => {
    const doc = validDoc() as Record<string, unknown>;
    doc.$schema = "https://vault-memory.dev/schemas/contract-v1.json";
    const result = ContractDocumentSchema.safeParse(doc);
    expect(result.success).toBe(true);
  });

  it("rejects an unrelated `$schema` literal", () => {
    const doc = validDoc() as Record<string, unknown>;
    doc.$schema = "https://example.com/wrong.json";
    const result = ContractDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it("type export `ContractDocumentShape` infers correctly", () => {
    // Compile-time check via assignment + structural use.
    const sample: ContractDocumentShape = {
      vmFormatVersion: 1,
      contract: {
        ...VALID_CONTRACT_BLOCK,
        description: "",
      } as ContractDocumentShape["contract"],
      editor: { ...VALID_EDITOR_BLOCK } as ContractDocumentShape["editor"],
    };
    expect(sample.contract.name).toBe("minimal");
  });
});
