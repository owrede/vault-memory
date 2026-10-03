import { expect, it } from "vitest";
import { parseConversation, renderConversation } from "./conversation.js";
const conversation = {
  provider: "neutral",
  external_id: "c1",
  messages: [{ id: "m1", role: "user" as const, text: "Two pilots" }],
};
it("keeps role and message identity in the imported source", () =>
  expect(renderConversation(conversation)).toBe(
    "# Conversation c1\n\n## m1 · user\n\nTwo pilots\n",
  ));
it("keeps tool identity, text and absent timestamps without inventing provenance", () => {
  const c = {
    ...conversation,
    messages: [...conversation.messages, { id: "m2", role: "tool" as const, text: "Tool result" }],
  };
  expect(parseConversation([c], "neutral")).toEqual([c]);
  expect(renderConversation(c)).toContain("## m2 · tool\n\nTool result");
  expect(parseConversation([c], "neutral")[0]!.messages[0]).not.toHaveProperty("at");
});
it.each([
  { bad: "object" },
  [{ ...conversation, messages: [conversation.messages[0], conversation.messages[0]] }],
  [
    {
      ...conversation,
      messages: [{ id: "m1", role: "user", text: "x", attachment: { image: "x" } }],
    },
  ],
  [{ ...conversation, messages: [{ id: "m1", role: "unknown", text: "x" }] }],
  [
    {
      ...conversation,
      messages: [{ id: "m1", role: "user", text: "x", at: "2026-02-30T10:00:00Z" }],
    },
  ],
  [conversation, conversation],
])("rejects malformed, ambiguous or unsupported neutral data (%#)", (input) =>
  expect(() => parseConversation(input, "neutral")).toThrow(),
);
it("fails closed for unknown and undocumented provider-specific schemas", () => {
  expect(() => parseConversation([conversation], "unknown" as "neutral")).toThrow(
    "unsupported_format",
  );
  expect(() =>
    parseConversation([{ id: "c", current_node: "branch", mapping: {} }], "chatgpt"),
  ).toThrow("unsupported_format");
});
