/**
 * layout — Phase 7 / Plan 07-05 / D-UI / UI-SPEC §"Canvas Interaction
 * Grammar".
 *
 * Pure deterministic LTR-topological layout function used to seed Svelte
 * Flow node positions when an assembly has no preserved `editor.nodes`
 * (e.g. first-open of a YAML-imported `.contract`, or a step added via
 * palette drag without a known position).
 *
 * # Algorithm
 *
 *   1. Build alias → assembly-index map.
 *   2. For each step i, walk the step's args/value recursively. Every
 *      `{{alias.field}}` (or bare `{{alias}}`) match contributes an
 *      upstream-edge constraint: `depth[i] >= depth[parent] + 1`.
 *   3. Group steps by depth column → row index = 0, 1, 2, … within the
 *      column, preserving original assembly order as tiebreak.
 *   4. Emit `{id: "step:<alias>", x: col * (220 + 40), y: row * (120 + 40)}`.
 *
 * # Constants
 *
 *   - 220 — node width per UI-SPEC §"Spacing Scale" exceptions.
 *   - 120 — node height per the same.
 *   - 40  — column / row gutter (round multiple of 4 from spacing scale).
 *
 * # Determinism
 *
 *   Same input ↦ same output. No Date, Math.random, environment reads.
 *   The function is pure data-in / data-out so the unit tests can lock
 *   exact coordinates.
 *
 * # Adapter-seam discipline
 *
 *   Zero `obsidian` / `fs` / `yaml` imports. Pure data transform.
 */

import type { ContractFileShape } from "../../../shared-types.js";

/** Node width in CSS pixels — locked by UI-SPEC §"Spacing Scale" exceptions. */
export const NODE_WIDTH = 220;
/** Node height in CSS pixels — locked by UI-SPEC. */
export const NODE_HEIGHT = 120;
/** Gutter between adjacent columns / rows in CSS pixels. */
export const NODE_GUTTER = 40;

type AssemblyStep = ContractFileShape["assembly"][number];

/** Output of `computeDefaultLayout` — one entry per assembly step. */
export interface LayoutNode {
  /** Stable id matching `step:<alias>` (Phase 6 / D-A2c). */
  id: string;
  /** X coordinate in CSS pixels. */
  x: number;
  /** Y coordinate in CSS pixels. */
  y: number;
}

/**
 * Walk a step's args + value and yield every alias name referenced
 * via `{{alias}}` or `{{alias.field}}` syntax. Used to derive depth.
 */
function collectAliasRefs(step: AssemblyStep): readonly string[] {
  const refs = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      const re = /\{\{\s*([a-z_][a-z0-9_]*)(?:\.[^}]*)?\s*\}\}/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(value)) !== null) {
        const alias = match[1];
        if (alias) refs.add(alias);
      }
    } else if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
    } else if (value && typeof value === "object") {
      for (const v of Object.values(value as Record<string, unknown>)) visit(v);
    }
  };
  if (step.args) visit(step.args);
  if (step.value !== undefined) visit(step.value);
  return [...refs];
}

/**
 * Compute the deterministic LTR-topological default layout for an
 * assembly. Column = depth in the read-back dependency graph; row =
 * within-column position by original assembly order.
 */
export function computeDefaultLayout(
  assembly: ContractFileShape["assembly"],
): LayoutNode[] {
  // Map alias → assembly index for parent lookup.
  const aliasToIndex = new Map<string, number>();
  assembly.forEach((step, i) => {
    aliasToIndex.set(step.as, i);
  });

  // Depth (column) per step. depth[i] = 1 + max(depth[parent_i]); 0 if leaf.
  const depth: number[] = new Array(assembly.length).fill(0);
  for (let i = 0; i < assembly.length; i++) {
    const step = assembly[i];
    if (!step) continue;
    let maxParent = -1;
    for (const ref of collectAliasRefs(step)) {
      const idx = aliasToIndex.get(ref);
      if (idx !== undefined && idx < i) {
        const parentDepth = depth[idx] ?? 0;
        if (parentDepth > maxParent) maxParent = parentDepth;
      }
    }
    depth[i] = maxParent + 1;
  }

  // Group by column, row index = original assembly order within column.
  const byColumn = new Map<number, number[]>();
  depth.forEach((col, i) => {
    const list = byColumn.get(col) ?? [];
    list.push(i);
    byColumn.set(col, list);
  });

  return assembly.map((step, i): LayoutNode => {
    const col = depth[i] ?? 0;
    const rowList = byColumn.get(col) ?? [i];
    const row = rowList.indexOf(i);
    return {
      id: `step:${step.as}`,
      x: col * (NODE_WIDTH + NODE_GUTTER),
      y: row * (NODE_HEIGHT + NODE_GUTTER),
    };
  });
}
