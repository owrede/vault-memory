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
