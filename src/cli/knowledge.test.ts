import { expect, it } from "vitest";
import { parseKnowledgeArgs } from "./knowledge.js";
it("requires an OCC hash for edits", () =>
  expect(() =>
    parseKnowledgeArgs([
      "edit",
      "--doc-id",
      "obsidian-fs://lab/A B.md",
      "--patch-file",
      "patch.json",
    ]),
  ).toThrow("--expected-hash"));
it("preserves unicode and space arguments", () =>
  expect(
    parseKnowledgeArgs(["search", "--vault", "lab", "--query", "Über Jörg", "--json"]),
  ).toEqual({ command: "search", vault: "lab", query: "Über Jörg", json: true }));
it.each([
  ["search", "--query", "Q", "--typo"],
  ["read", "--doc-id", "ID", "--query", "Q"],
  ["edit", "--doc-id", "ID", "--expected-hash", "h", "--patch-file", "-"],
  ["read", "--doc-id"],
  ["search", "--query", "Q", "--query", "B"],
])("rejects invalid or unsupported flags %j", (...args) =>
  expect(() => parseKnowledgeArgs(args)).toThrow(),
);
