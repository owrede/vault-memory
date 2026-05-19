<!--
  Spike canvas pane — wraps `@xyflow/svelte` and renders the contract
  assembly DAG as a left-to-right topological layout.

  Phase 7 / ADR-007 / Plan 07-01 Task 2. This is the SPIKE component that
  proves Svelte Flow is the right renderer choice. Plan 07-02 extracts the
  layout helper into `plugin/src/views/contract-editor/canvas/layout.ts`;
  plan 07-03 adds the palette + inspector panes; plan 07-04 wires the codec
  + save lifecycle.

  Defaults:
    - Node footprint: 220×120px (per UI-SPEC §"Canvas Interaction Grammar").
    - snapGrid: [20, 20] (per UI-SPEC).
    - Layout: LTR topological sort over `{{alias.field}}` read-back edges;
      tiebreak by assembly index. Inspector-driven inputs/sources/sinks/
      write_back are intentionally NOT rendered as nodes (Variant C lock).
-->

<script lang="ts">
  import {
    SvelteFlow,
    Background,
    Controls,
    type Node,
    type Edge,
  } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";
  import StepNode from "./StepNode.svelte";
  import type { ContractFile } from "../view.js";

  // Svelte 5 runes-style props. The view passes the parsed `.contract`
  // envelope plus an `onChange` callback that we will wire in plan 07-02
  // (this spike is read-only).
  let {
    file,
    onChange: _onChange,
  }: { file: ContractFile; onChange: (next: ContractFile) => void } = $props();

  // The `_onChange` callback is unused in the spike but pinned here for
  // type-level contract validation. Silence the unused-variable warning
  // structurally — the typecheck script catches genuine drift.
  void _onChange;

  const NODE_WIDTH = 220;
  const NODE_HEIGHT = 120;
  const COLUMN_GAP = 80;
  const ROW_GAP = 40;

  /** Pull the alias references out of a step's args. Recognizes `{{x.y}}`
   * and `{{x}}` template forms; the alias is the first dotted segment. */
  function aliasRefsIn(step: ContractFile["contract"]["assembly"][number]): readonly string[] {
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

  /** Compute the LTR topological layout for the assembly array. Column =
   * depth in the read-back dependency graph; row tiebreak = assembly index. */
  function layoutAssembly(
    assembly: ContractFile["contract"]["assembly"],
  ): { nodes: Node[]; edges: Edge[] } {
    const aliasToIndex = new Map<string, number>();
    assembly.forEach((step, i) => aliasToIndex.set(step.as, i));

    const depth: number[] = new Array(assembly.length).fill(0);
    for (let i = 0; i < assembly.length; i++) {
      const step = assembly[i];
      if (!step) continue;
      let maxParent = -1;
      for (const ref of aliasRefsIn(step)) {
        const idx = aliasToIndex.get(ref);
        if (idx !== undefined && idx < i) {
          maxParent = Math.max(maxParent, depth[idx] ?? 0);
        }
      }
      depth[i] = maxParent + 1;
    }

    // Group by depth column for row assignment.
    const byColumn = new Map<number, number[]>();
    depth.forEach((col, i) => {
      const list = byColumn.get(col) ?? [];
      list.push(i);
      byColumn.set(col, list);
    });

    const nodes: Node[] = assembly.map((step, i) => {
      const col = depth[i] ?? 0;
      const rowList = byColumn.get(col) ?? [i];
      const row = rowList.indexOf(i);
      return {
        id: `step:${step.as}`,
        type: "step",
        position: {
          x: col * (NODE_WIDTH + COLUMN_GAP),
          y: row * (NODE_HEIGHT + ROW_GAP),
        },
        data: {
          alias: step.as,
          verb: step.verb,
        },
        // Pin the node size so Svelte Flow's layout engine doesn't auto-resize.
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      };
    });

    const edges: Edge[] = [];
    assembly.forEach((step, i) => {
      for (const ref of aliasRefsIn(step)) {
        if (aliasToIndex.has(ref) && (aliasToIndex.get(ref) ?? -1) < i) {
          edges.push({
            id: `edge:${ref}->${step.as}`,
            source: `step:${ref}`,
            target: `step:${step.as}`,
            type: "default",
          });
        }
      }
    });

    return { nodes, edges };
  }

  const { nodes: initialNodes, edges: initialEdges } = $derived(
    layoutAssembly(file.contract.assembly),
  );

  // Svelte Flow expects writable `$state` arrays bound via `bind:`.
  let nodes = $state<Node[]>(initialNodes);
  let edges = $state<Edge[]>(initialEdges);

  // Re-seed when the input file changes.
  $effect(() => {
    nodes = initialNodes;
    edges = initialEdges;
  });

  const nodeTypes = { step: StepNode } as const;
</script>

<div class="vm-canvas-pane">
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    snapGrid={[20, 20]}
    fitView
    proOptions={{ hideAttribution: true }}
  >
    <Background />
    <Controls />
  </SvelteFlow>
</div>

<style>
  .vm-canvas-pane {
    width: 100%;
    height: 100%;
    min-height: 400px;
    background: var(--background-primary);
  }
</style>
