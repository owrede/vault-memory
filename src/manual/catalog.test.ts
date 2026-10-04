import { expect, it } from "vitest";
import { manualTopic } from "./catalog.js";
it("provides versioned manuals and truthful operation hints", () => {
  expect(manualTopic("edit_document")).toMatchObject({
    schema_version: 1,
    topic: "edit_document",
    feature: "document_edit",
    annotations: { readOnlyHint: false, idempotentHint: false },
    input_schema: { properties: { expected_hash: { type: "string" } } },
  });
  expect(manualTopic("audit_log")).toMatchObject({ annotations: { readOnlyHint: true } });
  expect(manualTopic("index")).toMatchObject({ annotations: { readOnlyHint: false } });
  expect(() => manualTopic("absent")).toThrow("Unknown manual topic");
});
it("pins additive tool annotations separately from unchanged input schemas", async () => {
  const { readFileSync } = await import("node:fs");
  const { TOOLS } = await import("../tool-registry.js");
  const { operationAnnotations } = await import("./catalog.js");
  const snapshot = JSON.parse(
    readFileSync(
      new URL("../../evals/v1-baseline/tool-annotations.snapshot.json", import.meta.url),
      "utf8",
    ),
  );
  expect(TOOLS.map((t) => ({ name: t.name, annotations: operationAnnotations(t.name) }))).toEqual(
    snapshot,
  );
});
it("describes overwrite operations as destructive and pure suggestions as readonly", () => {
  for (const topic of ["edit_document", "write_note", "update_frontmatter", "supersede"])
    expect(manualTopic(topic).annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  expect(manualTopic("suggest_frontmatter").annotations).toMatchObject({ readOnlyHint: true });
});
