/**
 * layout.test.ts — Phase 7 / Plan 07-05 / Task 1.
 *
 * Pattern F doc-block: D-UI (UI-SPEC §"Canvas Interaction Grammar" — node
 * 220×120, grid snap 20, LTR topological default layout). The pure layout
 * helper computes a deterministic LTR position grid from the assembly's
 * `{{alias.field}}` read-back references.
 *
 * Test coverage per Plan 07-05 §Task 1 acceptance:
 *   1. Linear chain → straight LTR layout (each step in its own column).
 *   2. Diamond (two later steps reference a common upstream) → upstream
 *      col 0, parallel pair col 1, sink col 2.
 *   3. Idempotency — same input gives identical output across two calls.
 */

import { describe, expect, it } from "vitest";
import type { ContractFileShape } from "../../../shared-types.js";
import { computeDefaultLayout } from "./layout.js";

type Assembly = ContractFileShape["assembly"];

function step(as: string, verb: string, args?: Record<string, unknown>): Assembly[number] {
  return { as, verb, args } as Assembly[number];
}

describe("computeDefaultLayout", () => {
  it("places a linear chain of steps in LTR columns", () => {
    const assembly: Assembly = [
      step("first", "read_note"),
      step("second", "search_hybrid", { query: "{{first.body}}" }),
      step("third", "expand", { seed_doc_ids: "{{second.hits}}" }),
    ];
    const layout = computeDefaultLayout(assembly);
    expect(layout).toHaveLength(3);
    expect(layout[0]).toEqual({ id: "step:first", x: 0, y: 0 });
    // Column 1 = (220 + 40) * 1 = 260; column 2 = 520
    expect(layout[1]).toEqual({ id: "step:second", x: 260, y: 0 });
    expect(layout[2]).toEqual({ id: "step:third", x: 520, y: 0 });
  });

  it("places a diamond (two steps depend on one upstream, one sink consumes both)", () => {
    const assembly: Assembly = [
      step("seed", "read_note"),
      step("branch_a", "expand", { seed_doc_ids: "{{seed.id}}" }),
      step("branch_b", "search_hybrid", { query: "{{seed.body}}" }),
      step("sink", "cluster", { a: "{{branch_a.hits}}", b: "{{branch_b.hits}}" }),
    ];
    const layout = computeDefaultLayout(assembly);
    expect(layout).toHaveLength(4);
    // seed in col 0
    expect(layout[0]).toEqual({ id: "step:seed", x: 0, y: 0 });
    // branch_a + branch_b both depend on seed → col 1, stacked by y (row 0, row 1)
    expect(layout[1]?.x).toBe(260);
    expect(layout[2]?.x).toBe(260);
    expect(layout[1]?.y).toBe(0);
    // Column height = (120 + 40) * 1 = 160
    expect(layout[2]?.y).toBe(160);
    // sink depends on both branches → col 2
    expect(layout[3]).toEqual({ id: "step:sink", x: 520, y: 0 });
  });

  it("is idempotent — same input yields identical output across two calls", () => {
    const assembly: Assembly = [
      step("a", "read_note"),
      step("b", "expand", { seed_doc_ids: "{{a.id}}" }),
      step("c", "cluster", { a: "{{a.body}}", b: "{{b.doc_ids}}" }),
    ];
    const first = computeDefaultLayout(assembly);
    const second = computeDefaultLayout(assembly);
    expect(second).toEqual(first);
  });
});
