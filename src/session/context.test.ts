import { expect, it } from "vitest";
import { buildSessionContext } from "./context.js";
import { parseDocId, parseSourceHandle } from "../adapters/registry.js";
const brief = {
  id: parseDocId("obsidian-fs://lab/brief.md"),
  source: parseSourceHandle("obsidian-fs://lab"),
  title: "Brief",
  hash: "h",
  mtime: 0,
  properties: {},
  blocks: [{ kind: "paragraph" as const, text: "Useful context" }],
};
const deps = {
  getBrief: async () => ({ brief }),
  verify: async () => ({ stale: false, citations: [] }),
  displayUrlFor: () => "display",
};
it("budgets context and retains its source citation", async () =>
  expect(await buildSessionContext({ topic: "Project", max_chars: 6 }, deps)).toMatchObject({
    text: "Useful",
    truncated: true,
    stale: false,
    citations: [{ doc_id: brief.id, hash: "h" }],
  }));
it("blocks stale briefs instead of presenting them as fresh", async () =>
  expect(
    await buildSessionContext(
      { topic: "Project" },
      { ...deps, verify: async () => ({ stale: true, citations: [] }) },
    ),
  ).toMatchObject({ text: "", stale: true }));
