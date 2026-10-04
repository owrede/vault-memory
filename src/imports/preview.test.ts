import { expect, it } from "vitest";
import { previewImport } from "./preview.js";
const c = {
  provider: "neutral",
  external_id: "../../Escape",
  messages: [{ id: "m1", role: "user" as const, text: "Evidence" }],
};
it("makes deterministic identity-safe destinations and content hashes without using external IDs as paths", () => {
  const first = previewImport([c], "obsidian-fs://lab/imports/");
  expect(first).toHaveLength(1);
  expect(first[0]!.target).toMatch(/^obsidian-fs:\/\/lab\/imports\/conversation-[a-f0-9]{64}\.md$/);
  expect(first[0]!.content).toContain("../../Escape");
  expect(first[0]!.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(previewImport([c], "obsidian-fs://lab/imports/")).toEqual(first);
  const changed = previewImport(
    [{ ...c, messages: [{ ...c.messages[0]!, text: "Changed" }] }],
    "obsidian-fs://lab/imports/",
  )[0]!;
  expect(changed.target).toBe(first[0]!.target);
  expect(changed.hash).not.toBe(first[0]!.hash);
});
it("rejects traversal in the target prefix", () =>
  expect(() => previewImport([c], "obsidian-fs://lab/../imports/")).toThrow());
