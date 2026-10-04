import { expect, it } from "vitest";
import { checkpointKey, checkpointProperties } from "./checkpoint.js";
const input = {
  session_id: "s",
  event_id: "e",
  sink: "memory",
  summary: "Progress",
  source_doc_ids: ["obsidian-fs://lab/A.md"],
  observed_at: "2026-10-03T10:00:00Z",
};
it("separates session and event components", () => {
  expect(checkpointKey("ab", "c")).not.toBe(checkpointKey("a", "bc"));
  expect(checkpointKey("ab", "c")).toBe(checkpointKey("ab", "c"));
});
it("keeps explicit observation time and concrete source evidence", () =>
  expect(checkpointProperties(input)).toMatchObject({
    source: "agent",
    confidence: "inferred",
    type: "summary",
    observed_at: input.observed_at,
    evidence: ["obsidian-fs://lab/A.md", "session:s", "event:e"],
    checkpoint_key: checkpointKey("s", "e"),
  }));
it.each([
  { summary: "" },
  { source_doc_ids: [] },
  { observed_at: "bad" },
  { source_doc_ids: ["not-a-docid"] },
  { session_id: "" },
])("rejects invalid checkpoint %j", (patch) =>
  expect(() => checkpointProperties({ ...input, ...patch })).toThrow(),
);
