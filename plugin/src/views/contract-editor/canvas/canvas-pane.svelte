<!--
  canvas-pane — Svelte Flow wrapper for the contract assembly DAG.

  Slice B redesign: register two node types (`step` for assembly steps,
  `comment` for free-text post-it annotations); pass `args` into the
  StepNode data so the node renders its arg preview line; add MiniMap +
  background; controls bottom-right; "+ Comment" toolbar button.

  Consumes:
    - file: ContractDocumentShape         — in-memory `.contract` envelope
    - selection: string | null            — currently-selected step alias
    - onChange(next)                      — emit user-initiated mutations
    - onSelect(stepAlias | null)          — selection change

  Drop handler — palette → canvas:
    On drop of an HTML5 drag with dataTransfer type
    `application/x-vault-memory-verb`, inserts a new assembly step with
    auto-assigned `as: step{n}` alias and the dropped verb at the
    drop-point translated to flow coordinates. Calls onChange with the
    updated file. Default args from verb-catalog populate the step's
    args, so the new node shows a useful arg preview immediately.

  Comment-node persistence:
    Comments live in editor.nodes[] with kind: "comment" and
    text: string fields. The NodePositionSchema is passthrough so these
    extra keys round-trip cleanly to YAML + back. canvas-pane is the
    single owner: read on $effect re-seed, write through onChange when
    the CommentNode emits a text update or the user drags it.

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
    MiniMap,
    type Node,
    type Edge,
    type NodeProps,
    type Connection,
    useSvelteFlow,
  } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";
  import type { Component } from "svelte";
  import { setIcon } from "obsidian";
  import StepNodeRaw from "./StepNode.svelte";
  import CommentNodeRaw from "./CommentNode.svelte";
  import { computeDefaultLayout, NODE_WIDTH, NODE_HEIGHT } from "./layout.js";
  import { lookupVerb, VERB_CATEGORY_META } from "../palette/verb-catalog.js";
  import type { ContractDocumentShape } from "../../../shared-types.js";

  const StepNode = StepNodeRaw as unknown as Component<NodeProps>;
  const CommentNode = CommentNodeRaw as unknown as Component<NodeProps>;

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

  /**
   * Type guard for comment-kind editor nodes. The schema passthrough
   * allows the extra `kind` and `text` fields; here we narrow safely.
   */
  function isCommentNodeEntry(
    entry: unknown,
  ): entry is { id: string; x: number; y: number; kind: "comment"; text: string; width?: number; height?: number } {
    if (!entry || typeof entry !== "object") return false;
    const e = entry as Record<string, unknown>;
    return e.kind === "comment" && typeof e.text === "string";
  }

  function commentText(id: string): string {
    const entry = file.editor.nodes.find((n) => n.id === id);
    return entry && isCommentNodeEntry(entry) ? entry.text : "";
  }

  /**
   * Push a text update for a specific comment-id back into the
   * contract envelope. Called by CommentNode via the onTextChange
   * callback wired into data.
   */
  function setCommentText(id: string, next: string): void {
    const newNodes = file.editor.nodes.map((entry) =>
      entry.id === id && isCommentNodeEntry(entry) ? { ...entry, text: next } : entry,
    );
    onChange({ ...file, editor: { ...file.editor, nodes: newNodes } });
  }

  // Build initial node positions. Preserve `file.editor.nodes` when
  // present; fall back to deterministic LTR layout when not.
  function buildNodes(f: ContractDocumentShape): Node[] {
    const explicit = new Map(
      f.editor.nodes.map((n) => [n.id, { x: n.x, y: n.y, width: n.width, height: n.height }]),
    );
    const defaultLayout = computeDefaultLayout(f.contract.assembly);
    const stepNodes: Node[] = f.contract.assembly.map((step, i): Node => {
      const id = `step:${step.as}`;
      const pos = explicit.get(id) ?? defaultLayout[i];
      const sz = explicit.get(id);
      return {
        id,
        type: "step",
        position: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
        data: {
          alias: step.as,
          verb: step.verb,
          // Surface args so StepNode can render the inline preview.
          args: step.args,
          status: "ok",
        },
        width: sz?.width ?? NODE_WIDTH,
        height: sz?.height ?? NODE_HEIGHT,
      };
    });
    const commentNodes: Node[] = f.editor.nodes.filter(isCommentNodeEntry).map((entry): Node => ({
      id: entry.id,
      type: "comment",
      position: { x: entry.x, y: entry.y },
      data: {
        text: entry.text,
        onTextChange: (next: string) => setCommentText(entry.id, next),
      },
      width: entry.width ?? 240,
      height: entry.height ?? 80,
    }));
    return [...stepNodes, ...commentNodes];
  }

  // Derive edges from `{{alias.field}}` references in step args.
  function buildEdges(f: ContractDocumentShape): Edge[] {
    const aliasToIndex = new Map<string, number>();
    f.contract.assembly.forEach((step, i) => aliasToIndex.set(step.as, i));
    const out: Edge[] = [];
    const seen = new Set<string>();
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
            const edgeId = `edge:${ref}->${target.as}`;
            if (seen.has(edgeId)) continue;
            seen.add(edgeId);
            // Source-step category drives the edge colour so users can
            // read the graph's "flavour" at a glance.
            const sourceStep = f.contract.assembly[parentIdx];
            const sourceMeta = sourceStep ? lookupVerb(sourceStep.verb) : undefined;
            const colorVar = sourceMeta
              ? VERB_CATEGORY_META[sourceMeta.category].colorVar
              : "--text-muted";
            out.push({
              id: edgeId,
              source: `step:${ref}`,
              target: `step:${target.as}`,
              type: "smoothstep",
              animated: false,
              style: `stroke: var(${colorVar}); stroke-width: 2;`,
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

  const nodeTypes = { step: StepNode, comment: CommentNode } as const;
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
    const idToNode = new Map(
      nodes.map((n) => [
        n.id,
        {
          x: n.position.x,
          y: n.position.y,
          width: typeof n.width === "number" ? n.width : undefined,
          height: typeof n.height === "number" ? n.height : undefined,
        },
      ]),
    );
    const newNodes = file.editor.nodes.map((entry) => {
      const p = idToNode.get(entry.id);
      if (!p) return entry;
      return {
        ...entry,
        x: p.x,
        y: p.y,
        ...(p.width !== undefined ? { width: p.width } : {}),
        ...(p.height !== undefined ? { height: p.height } : {}),
      };
    });
    // Add any new nodes that weren't in editor.nodes yet.
    for (const [id, p] of idToNode) {
      if (!file.editor.nodes.some((e) => e.id === id)) {
        newNodes.push({
          id,
          x: p.x,
          y: p.y,
          ...(p.width !== undefined ? { width: p.width } : {}),
          ...(p.height !== undefined ? { height: p.height } : {}),
        });
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
    // Pre-fill args from the verb catalog so the new node shows the
    // shape the user will need to fill in. The "?" placeholders convey
    // "this slot is empty" to the inspector (Slice C).
    const meta = lookupVerb(verb);
    const defaultArgs = meta?.defaultArgs ?? {};
    const newStep: { as: string; verb: string; args?: Record<string, unknown> } = {
      as: alias,
      verb,
      ...(Object.keys(defaultArgs).length > 0 ? { args: { ...defaultArgs } } : {}),
    };
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

  // Add a comment node at canvas centre (or near the cursor if hovering
  // over the canvas). Each comment gets a unique id of the form
  // `comment:<timestamp>` so it never collides with `step:<alias>`.
  function addComment(): void {
    const viewport = flowApi.getViewport?.() ?? { x: 0, y: 0, zoom: 1 };
    // Drop the new comment roughly in the middle of the visible area.
    const flowPos = flowApi.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    void viewport; // unused but kept for clarity
    const id = `comment:${Date.now().toString(36)}`;
    const newEditorNodes = [
      ...file.editor.nodes,
      {
        id,
        x: flowPos.x,
        y: flowPos.y,
        width: 240,
        height: 80,
        kind: "comment" as const,
        text: "",
      },
    ];
    onChange({
      ...file,
      editor: { ...file.editor, nodes: newEditorNodes },
    });
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
    // Inspector handles the actual `{{ref}}` insertion; here we append
    // the alias as a placeholder `__ref` arg key so the inspector can
    // surface it. Slice C will refine this UX.
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

  // Selection handler — first selected step node alias surfaces to the
  // inspector. Comment nodes don't drive the inspector (they're remarks).
  $effect(() => {
    const selected = nodes.find((n) => n.selected);
    if (selected && typeof selected.id === "string" && selected.id.startsWith("step:")) {
      const alias = selected.id.replace(/^step:/, "");
      if (selection !== alias) onSelect(alias);
    } else if (selection !== null) {
      onSelect(null);
    }
  });

  /**
   * Mount a Lucide icon into the element via Obsidian's setIcon. Used
   * on the toolbar "+ Comment" button.
   */
  function lucideIcon(node: HTMLElement, iconName: string): { update(next: string): void; destroy(): void } {
    setIcon(node, iconName);
    return {
      update(next: string): void {
        node.empty?.();
        setIcon(node, next);
      },
      destroy(): void {
        node.empty?.();
      },
    };
  }
</script>

<div
  class="vm-canvas-pane"
  ondrop={onDrop}
  ondragover={onDragOver}
  role="region"
  aria-label="Contract assembly canvas"
>
  <!--
    Floating toolbar — top-right. Currently houses the "+ Comment"
    button; Slice C may add validate / autoformat / fit-selection.
  -->
  <div class="vm-canvas-toolbar">
    <button
      type="button"
      class="vm-canvas-toolbar-btn"
      onclick={addComment}
      title="Add a free-text comment to the canvas"
      aria-label="Add comment"
    >
      <span class="vm-canvas-toolbar-icon" use:lucideIcon={"message-square-plus"} aria-hidden="true"></span>
      <span>Comment</span>
    </button>
  </div>

  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    snapGrid={[20, 20]}
    fitView
    fitViewOptions={{ padding: 0.2, maxZoom: 1.0 }}
    onnodedragstop={schedulePositionCommit}
    onconnect={onConnect}
    proOptions={{ hideAttribution: true }}
  >
    <Background bgColor="var(--background-primary)" patternColor="var(--background-modifier-border)" gap={20} size={1.2} />
    <Controls position="bottom-right" showLock={false} />
    <MiniMap position="bottom-left" maskColor="color-mix(in srgb, var(--background-primary) 80%, transparent)" />
  </SvelteFlow>

  {#if file.contract.assembly.length === 0}
    <!--
      Empty-state hint. Visible only when the contract has no assembly
      steps yet. Disappears as soon as the user drops the first verb.
    -->
    <div class="vm-canvas-emptystate" role="status">
      <h3>Build your contract</h3>
      <p>
        Drag a step from the <strong>left palette</strong> onto the canvas.
        Most contracts start with a <em>Read</em> or <em>Search</em> step
        and end with a <em>Compose</em> step. Connect steps by dragging
        from the right handle of one node to the left handle of another —
        that wires <code>&#123;&#123;alias&#125;&#125;</code> references
        between them automatically.
      </p>
    </div>
  {/if}
</div>

<style>
  .vm-canvas-pane {
    width: 100%;
    height: 100%;
    min-height: 400px;
    background: var(--background-primary);
    position: relative;
    overflow: hidden;
  }

  /* Floating toolbar — top-right. */
  .vm-canvas-toolbar {
    position: absolute;
    top: var(--size-4-2);
    right: var(--size-4-2);
    z-index: 5;
    display: flex;
    gap: var(--size-2-2);
  }
  .vm-canvas-toolbar-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--size-2-2);
    padding: var(--size-2-2) var(--size-4-2);
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    color: var(--text-normal);
    font-family: var(--font-interface);
    font-size: var(--font-ui-smaller);
    cursor: pointer;
    box-shadow: var(--shadow-s, 0 1px 2px rgba(0, 0, 0, 0.06));
  }
  .vm-canvas-toolbar-btn:hover {
    background: var(--background-modifier-hover);
  }
  .vm-canvas-toolbar-icon {
    display: inline-flex;
    width: 14px;
    height: 14px;
  }
  .vm-canvas-toolbar-icon :global(svg) {
    width: 14px;
    height: 14px;
  }

  /* Empty-state — centred over the canvas. */
  .vm-canvas-emptystate {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: var(--size-4-8);
    pointer-events: none;
    color: var(--text-muted);
    z-index: 2;
  }
  .vm-canvas-emptystate h3 {
    margin: 0 0 var(--size-2-3);
    font-size: var(--font-ui-medium);
    font-weight: var(--font-semibold);
    color: var(--text-normal);
  }
  .vm-canvas-emptystate p {
    margin: 0;
    max-width: 32rem;
    font-size: var(--font-ui-small);
    line-height: 1.5;
  }
  .vm-canvas-emptystate code {
    font-family: var(--font-monospace);
    color: var(--text-accent);
  }

  /* xyflow theme overrides — keep Controls + MiniMap looking native. */
  :global(.vm-canvas-pane .svelte-flow__controls) {
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    box-shadow: var(--shadow-s, 0 1px 2px rgba(0, 0, 0, 0.06));
    overflow: hidden;
  }
  :global(.vm-canvas-pane .svelte-flow__controls-button) {
    background: var(--background-secondary);
    color: var(--text-normal);
    border-bottom: 1px solid var(--background-modifier-border);
  }
  :global(.vm-canvas-pane .svelte-flow__controls-button:hover) {
    background: var(--background-modifier-hover);
  }
  :global(.vm-canvas-pane .svelte-flow__controls-button svg) {
    fill: var(--text-normal);
  }
  :global(.vm-canvas-pane .svelte-flow__minimap) {
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
  }
</style>
