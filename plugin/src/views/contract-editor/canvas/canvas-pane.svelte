<!--
  canvas-pane — Svelte Flow wrapper for the contract assembly DAG.

  Phase 7 / Plan 07-05 / D-UI / UI-SPEC §"Canvas Interaction Grammar".

  Consumes:
    - `file: ContractDocumentShape` — the in-memory `.contract` envelope.
    - `selection: string | null` — currently-selected step alias (id form
      `step:<alias>`), bound back from the editor shell.
    - `onChange(next)` — emitted on any user-initiated mutation (drop new
      step, move node, create edge). Viewport-only changes are debounced
      per RESEARCH Pitfall 7 and do NOT call onChange.
    - `onSelect(stepAlias | null)` — selection change.

  Wraps `@xyflow/svelte` with:
    - snapGrid={[20, 20]} per UI-SPEC §"Spacing Scale" exception.
    - nodeTypes={{step: StepNode}} — single node type per Variant C lock.
    - fitView — initial render fits all nodes with 40px margin.

  Drop handler — palette → canvas:
    On drop of an HTML5 drag with dataTransfer type
    `application/x-vault-memory-verb`, inserts a new assembly step with
    auto-assigned `as: step{n}` alias and the dropped verb at the
    drop-point translated to flow coordinates. Calls onChange with the
    updated file.

  Node-drag commit:
    Every node drag updates `file.editor.nodes[i].x/y` and calls
    onChange via a 500ms debounced commit so rapid drags don't thrash
    the file save cycle. Per RESEARCH Pitfall 7 separation: viewport
    pan/zoom are NOT saved here — only positional moves of nodes are.
-->

<script lang="ts">
  import {
    SvelteFlow,
    Background,
    Controls,
    type Node,
    type Edge,
    type NodeProps,
    type Connection,
    useSvelteFlow,
  } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";
  import type { Component } from "svelte";
  import StepNodeRaw from "./StepNode.svelte";
  import { computeDefaultLayout, NODE_WIDTH, NODE_HEIGHT } from "./layout.js";
  import type { ContractDocumentShape } from "../../../shared-types.js";

  // Cast StepNode to Svelte Flow's NodeProps shape — its runtime contract
  // is "any Svelte component receiving {id, data, selected, ...}".
  const StepNode = StepNodeRaw as unknown as Component<NodeProps>;

  let {
    file,
    selection,
    onChange,
    onSelect,
  }: {
    file: ContractDocumentShape;
    selection: string | null;
    onChange: (next: ContractDocumentShape) => void;
    onSelect: (alias: string | null) => void;
  } = $props();

  // Build initial node positions. Preserve `file.editor.nodes` when
  // present; fall back to deterministic LTR layout when not (e.g. for
  // newly-imported YAML with no editor-state comment).
  function buildNodes(f: ContractDocumentShape): Node[] {
    const explicit = new Map(
      f.editor.nodes.map((n) => [n.id, { x: n.x, y: n.y }]),
    );
    const defaultLayout = computeDefaultLayout(f.contract.assembly);
    return f.contract.assembly.map((step, i): Node => {
      const id = `step:${step.as}`;
      const pos = explicit.get(id) ?? defaultLayout[i];
      return {
        id,
        type: "step",
        position: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
        data: { alias: step.as, verb: step.verb },
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      };
    });
  }

  // Derive edges from `{{alias.field}}` references in step args.
  function buildEdges(f: ContractDocumentShape): Edge[] {
    const aliasToIndex = new Map<string, number>();
    f.contract.assembly.forEach((step, i) => aliasToIndex.set(step.as, i));
    const out: Edge[] = [];
    const visit = (i: number, value: unknown): void => {
      if (typeof value === "string") {
        const re = /\{\{\s*([a-z_][a-z0-9_]*)(?:\.[^}]*)?\s*\}\}/gi;
        let match: RegExpExecArray | null;
        while ((match = re.exec(value)) !== null) {
          const ref = match[1];
          if (!ref) continue;
          const parentIdx = aliasToIndex.get(ref);
          if (parentIdx !== undefined && parentIdx < i) {
            const target = f.contract.assembly[i];
            if (!target) continue;
            out.push({
              id: `edge:${ref}->${target.as}`,
              source: `step:${ref}`,
              target: `step:${target.as}`,
              type: "default",
            });
          }
        }
      } else if (Array.isArray(value)) {
        for (const entry of value) visit(i, entry);
      } else if (value && typeof value === "object") {
        for (const v of Object.values(value as Record<string, unknown>)) {
          visit(i, v);
        }
      }
    };
    f.contract.assembly.forEach((step, i) => {
      if (step.args) visit(i, step.args);
      if (step.value !== undefined) visit(i, step.value);
    });
    return out;
  }

  let nodes = $state<Node[]>(buildNodes(file));
  let edges = $state<Edge[]>(buildEdges(file));

  // Re-seed when the input file identity changes.
  $effect(() => {
    nodes = buildNodes(file);
    edges = buildEdges(file);
  });

  const nodeTypes = { step: StepNode } as const;
  const flowApi = useSvelteFlow();

  // Debounced position commit — Pitfall 7 split.
  let positionTimer: number | null = null;
  function schedulePositionCommit(): void {
    if (positionTimer !== null) {
      window.clearTimeout(positionTimer);
    }
    positionTimer = window.setTimeout(() => {
      positionTimer = null;
      commitPositions();
    }, 500);
  }

  function commitPositions(): void {
    const idToPos = new Map(
      nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
    );
    const newNodes = file.editor.nodes.map((entry) => {
      const p = idToPos.get(entry.id);
      return p ? { ...entry, x: p.x, y: p.y } : entry;
    });
    // Add any new step nodes that weren't in editor.nodes yet.
    for (const [id, pos] of idToPos) {
      if (!file.editor.nodes.some((e) => e.id === id)) {
        newNodes.push({ id, x: pos.x, y: pos.y });
      }
    }
    onChange({
      ...file,
      editor: { ...file.editor, nodes: newNodes },
    });
  }

  function nextAlias(existing: readonly string[]): string {
    const used = new Set(existing);
    for (let i = 1; i < 10_000; i++) {
      const candidate = `step${i}`;
      if (!used.has(candidate)) return candidate;
    }
    return `step${Date.now()}`;
  }

  // Drop handler — palette → canvas.
  function onDrop(event: DragEvent): void {
    event.preventDefault();
    const verb = event.dataTransfer?.getData("application/x-vault-memory-verb");
    if (!verb) return;

    const flowPos = flowApi.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    const alias = nextAlias(file.contract.assembly.map((s) => s.as));
    const newStep = { as: alias, verb };
    const newAssembly = [...file.contract.assembly, newStep];
    const newEditorNodes = [
      ...file.editor.nodes,
      { id: `step:${alias}`, x: flowPos.x, y: flowPos.y },
    ];
    onChange({
      ...file,
      contract: { ...file.contract, assembly: newAssembly },
      editor: { ...file.editor, nodes: newEditorNodes },
    });
  }

  function onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  // Edge-connect handler — wire `{{alias.field}}` reference into target.
  function onConnect(connection: Connection): void {
    if (!connection.source || !connection.target) return;
    const sourceAlias = connection.source.replace(/^step:/, "");
    const targetAlias = connection.target.replace(/^step:/, "");
    // Defensive: only allow connections among existing aliases.
    if (
      !file.contract.assembly.some((s) => s.as === sourceAlias) ||
      !file.contract.assembly.some((s) => s.as === targetAlias)
    ) {
      return;
    }
    // Inspector handles the actual `{{ref}}` insertion; here we just
    // append the alias as a placeholder `__ref` arg key so the inspector
    // can surface it. Plan 07-06+ refines this UX.
    const newAssembly = file.contract.assembly.map((s) => {
      if (s.as !== targetAlias) return s;
      return {
        ...s,
        args: { ...(s.args ?? {}), [`__ref_${sourceAlias}`]: `{{${sourceAlias}}}` },
      };
    });
    onChange({
      ...file,
      contract: { ...file.contract, assembly: newAssembly },
    });
  }

  // Selection handler — first selected node alias surfaces to the inspector.
  $effect(() => {
    const selected = nodes.find((n) => n.selected);
    if (selected) {
      const alias = String(selected.id).replace(/^step:/, "");
      if (selection !== alias) onSelect(alias);
    } else if (selection !== null) {
      onSelect(null);
    }
  });
</script>

<div
  class="vm-canvas-pane"
  ondrop={onDrop}
  ondragover={onDragOver}
  role="region"
  aria-label="Contract assembly canvas"
>
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    snapGrid={[20, 20]}
    fitView
    onnodedragstop={schedulePositionCommit}
    onconnect={onConnect}
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
    position: relative;
  }
</style>
