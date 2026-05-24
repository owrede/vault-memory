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
    MarkerType,
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
  import {
    lookupVerb,
    VERB_CATEGORY_META,
    isCompatible,
  } from "../palette/verb-catalog.js";
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
          // Default to {} when undefined (e.g. literal steps that use
          // top-level `value` instead of `args`) — leaving `args` as
          // `undefined` in xyflow's node data caused selection-handler
          // breakage on those nodes.
          args: step.args ?? {},
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
              // Bezier (default) — consistent with user-drawn edges
              // created via handle drag. Edge labels intentionally
              // omitted: the field-name conflated "what flows" with
              // "relationship type". A richer typology is deferred
              // until we can spec it as a contract-schema addition.
              type: "default",
              animated: false,
              style: `stroke: var(${colorVar}); stroke-width: 2;`,
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: `var(${colorVar})`,
                width: 18,
                height: 18,
              },
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
  let paneEl: HTMLDivElement | null = $state(null);
  /**
   * Outputs the user is dragging from. Set by onconnectstart, cleared
   * by onconnectend. Drives the `[data-dragging-output]` attribute on
   * the canvas pane that CSS uses to hide incompatible target handles.
   * Empty string means no drag in progress.
   */
  let draggingOutputType = $state<string>("");
  /**
   * Step alias of the node a connection drag was started FROM. Used by
   * CSS to hide that node's own target handle so the user can't draw a
   * loop. isValidConnection refuses self-loops independently, but
   * without this attribute the CSS would still leave the source's
   * target knob visible-and-compatible.
   */
  let draggingSourceAlias = $state<string>("");

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
    // The live `nodes` array (driven by xyflow via bind:nodes) is the
    // authoritative source. Build the new editor.nodes from it,
    // preserving any forward-compat fields (kind, text, etc.) that
    // sit on the existing editor.nodes entry by the same id.
    //
    // Before: this function MERGED file.editor.nodes with live nodes
    // (preserving entries not in the live array). That meant nodes the
    // user had just deleted via Backspace stayed in the file — and any
    // subsequent move re-introduced them on the canvas. Now: anything
    // not in `nodes` is gone.
    const existingById = new Map(file.editor.nodes.map((e) => [e.id, e]));
    const newNodes = nodes.map((n) => {
      const existing = existingById.get(n.id);
      const next: Record<string, unknown> = existing ? { ...existing } : { id: n.id };
      next.x = n.position.x;
      next.y = n.position.y;
      if (typeof n.width === "number") next.width = n.width;
      if (typeof n.height === "number") next.height = n.height;
      return next as (typeof file.editor.nodes)[number];
    });
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
    // Centre of the VISIBLE canvas pane, not the window. window.* coords
    // include Obsidian's full UI and don't map sensibly through
    // screenToFlowPosition.
    let centerScreen = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    if (paneEl) {
      const rect = paneEl.getBoundingClientRect();
      centerScreen = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    const flowPos = flowApi.screenToFlowPosition(centerScreen);
    const id = `comment:${Date.now().toString(36)}`;
    const newEditorNodes = [
      ...file.editor.nodes,
      {
        id,
        x: flowPos.x - 120, // centre the 240-wide node on the click point
        y: flowPos.y - 40,
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

  // Edge-delete handler — fires when xyflow deletes one or more edges
  // (e.g. user selects an edge with click + presses Delete/Backspace).
  // For each deleted edge, strip any args entry in the target step
  // that references the source alias (the `__ref_<alias>` placeholder
  // created by onConnect, plus any explicit `{{alias}}` references).
  /**
   * Unified delete handler. xyflow's prop is `ondelete` (NOT
   * `onnodesdelete` / `onedgesdelete` — those were never called, which
   * is why deletions resurrected on the next move: the file kept the
   * entries and the rebuild $effect put them back). The payload is
   * `{ nodes, edges }` — both kinds in one shot.
   *
   * Node deletion: drop editor.nodes entry; for step nodes, also drop
   * the matching assembly step + scrub every downstream `__ref_<alias>`
   * placeholder key and every `{{alias[.field]}}` mustache reference in
   * other steps' args/value.
   *
   * Edge deletion: drop the source-alias reference from the target
   * step's args (placeholder key `__ref_<source>` AND bare
   * `{{<source>[.field]}}` values).
   */
  function onDelete(params: { nodes: Node[]; edges: Edge[] }): void {
    const deletedNodes = params.nodes ?? [];
    const deletedEdges = params.edges ?? [];
    if (deletedNodes.length === 0 && deletedEdges.length === 0) return;

    // Collect deleted step aliases (only step:* nodes contribute).
    const deletedIds = new Set(deletedNodes.map((n) => n.id));
    const deletedStepAliases = new Set<string>();
    for (const id of deletedIds) {
      if (id.startsWith("step:")) deletedStepAliases.add(id.replace(/^step:/, ""));
    }

    // Recursively strip {{alias[.path]}} string values for any deleted
    // alias. Used by node deletion to clean up downstream references.
    const scrubDeletedAliasRefs = (value: unknown): unknown => {
      if (typeof value === "string") {
        for (const alias of deletedStepAliases) {
          const re = new RegExp(`\\{\\{\\s*${alias}(?:\\.[^}]*)?\\s*\\}\\}`, "g");
          if (re.test(value)) return undefined; // drop the whole arg
        }
        return value;
      }
      if (Array.isArray(value)) {
        return value.map((v) => scrubDeletedAliasRefs(v)).filter((v) => v !== undefined);
      }
      if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (deletedStepAliases.has(k.replace(/^__ref_/, ""))) continue;
          const next = scrubDeletedAliasRefs(v);
          if (next === undefined) continue;
          out[k] = next;
        }
        return out;
      }
      return value;
    };

    // Per-edge: strip the source ref from the target's args.
    function stripEdgeRefs(
      assembly: typeof file.contract.assembly,
    ): typeof file.contract.assembly {
      let next = assembly;
      for (const e of deletedEdges) {
        const sourceAlias = String(e.source).replace(/^step:/, "");
        const targetAlias = String(e.target).replace(/^step:/, "");
        // Skip refs to steps we're already deleting — the node-deletion
        // pass above will drop them entirely.
        if (deletedStepAliases.has(sourceAlias)) continue;
        if (deletedStepAliases.has(targetAlias)) continue;
        const refRe = new RegExp(`^\\{\\{\\s*${sourceAlias}(?:\\.[^}]*)?\\s*\\}\\}\\s*$`);
        next = next.map((s) => {
          if (s.as !== targetAlias) return s;
          const args = s.args ?? {};
          const cleaned: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(args)) {
            if (k === `__ref_${sourceAlias}`) continue;
            if (typeof v === "string" && refRe.test(v)) continue;
            cleaned[k] = v;
          }
          return { ...s, args: cleaned };
        });
      }
      return next;
    }

    // 1) Drop editor.nodes entries for deleted nodes.
    const newEditorNodes = file.editor.nodes.filter((e) => !deletedIds.has(e.id));

    // 2) Drop deleted assembly steps + scrub their downstream refs.
    let newAssembly = file.contract.assembly
      .filter((s) => !deletedStepAliases.has(s.as))
      .map((s) => {
        const cleanedArgs =
          s.args !== undefined
            ? (scrubDeletedAliasRefs(s.args) as Record<string, unknown>)
            : undefined;
        const cleanedValue =
          s.value !== undefined ? scrubDeletedAliasRefs(s.value) : undefined;
        const next: typeof s = { ...s };
        if (cleanedArgs !== undefined) next.args = cleanedArgs;
        else delete (next as Record<string, unknown>).args;
        if (cleanedValue !== undefined) next.value = cleanedValue;
        else if (s.value !== undefined) delete (next as Record<string, unknown>).value;
        return next;
      });

    // 3) Strip refs for explicitly deleted edges.
    newAssembly = stripEdgeRefs(newAssembly);

    onChange({
      ...file,
      contract: { ...file.contract, assembly: newAssembly },
      editor: { ...file.editor, nodes: newEditorNodes },
    });
  }

  // Connect-drag lifecycle. We tag the pane with the source step's
  // outputType so the canvas CSS can hide incompatible target handles
  // for the duration of the drag. xyflow's `isValidConnection`
  // independently refuses to land an incompatible drop, but the visual
  // hide is what actually GUIDES the user.
  function onConnectStart(_event: unknown, params: { nodeId?: string | null }): void {
    const sourceId = params.nodeId;
    if (!sourceId) return;
    const alias = String(sourceId).replace(/^step:/, "");
    const sourceStep = file.contract.assembly.find((s) => s.as === alias);
    if (!sourceStep) return;
    const meta = lookupVerb(sourceStep.verb);
    draggingOutputType = meta?.outputType ?? "any";
    draggingSourceAlias = alias;
    // Tag the source node's DOM element directly — CSS can't compare
    // two data-attributes from different elements, but a class on the
    // source node lets the rule below match it precisely.
    if (paneEl) {
      const srcNode = paneEl.querySelector<HTMLElement>(`.vm-step-node[data-alias="${CSS.escape(alias)}"]`);
      srcNode?.classList.add("vm-drag-source");
    }
  }
  function onConnectEnd(): void {
    draggingOutputType = "";
    draggingSourceAlias = "";
    if (paneEl) {
      paneEl.querySelectorAll(".vm-drag-source").forEach((el) => el.classList.remove("vm-drag-source"));
    }
  }

  // Type-aware connection guard. xyflow calls this for every candidate
  // (source, target) pair while the user is dragging from a handle.
  // Returning false hides the dragged-edge tip from snapping onto the
  // target and the CSS below also fades incompatible handles to zero
  // so the canvas visually narrows to only the valid drop targets.
  function isValidConnection(connection: Connection | Edge): boolean {
    if (!connection.source || !connection.target) return false;
    if (connection.source === connection.target) return false;
    const sourceAlias = String(connection.source).replace(/^step:/, "");
    const targetAlias = String(connection.target).replace(/^step:/, "");
    const sourceStep = file.contract.assembly.find((s) => s.as === sourceAlias);
    const targetStep = file.contract.assembly.find((s) => s.as === targetAlias);
    if (!sourceStep || !targetStep) return false;
    const sourceMeta = lookupVerb(sourceStep.verb);
    const targetMeta = lookupVerb(targetStep.verb);
    // Uncatalogued verbs (peer MCP, custom) bypass the check — we
    // don't have shape info to gate them, so allow the user to wire.
    if (!sourceMeta || !targetMeta) return true;
    return isCompatible(sourceMeta, targetMeta);
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
  // DEBUG: deferred via queueMicrotask so the click event fully unwinds
  // through xyflow before we touch parent state. Direct synchronous
  // onSelect during xyflow's selection update may have been racing with
  // xyflow's internal pointer-capture / event-completion handlers,
  // leaving the canvas frozen on certain nodes (literal verb steps
  // exhibited this 100% of the time; other verbs were intermittent).
  let lastEmitted: string | null = null;
  $effect(() => {
    const selected = nodes.find((n) => n.selected);
    let next: string | null = null;
    if (selected && typeof selected.id === "string" && selected.id.startsWith("step:")) {
      next = selected.id.replace(/^step:/, "");
    }
    if (next === lastEmitted) return;
    lastEmitted = next;
    // Defer the onSelect callback so it doesn't run inside xyflow's
    // event-dispatch frame.
    queueMicrotask(() => {
      if (lastEmitted !== next) return; // raced — newer selection won
      onSelect(next);
    });
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
  bind:this={paneEl}
  class="vm-canvas-pane"
  data-dragging-output={draggingOutputType}
  data-dragging-source={draggingSourceAlias}
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
      title="Add a sticky note to the canvas to explain what this contract does"
      aria-label="Add note"
    >
      <span class="vm-canvas-toolbar-icon" use:lucideIcon={"message-square-plus"} aria-hidden="true"></span>
      <span>Add note</span>
    </button>
  </div>

  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    snapGrid={[20, 20]}
    fitView
    fitViewOptions={{ padding: 0.2, maxZoom: 1.0 }}
    minZoom={0.2}
    maxZoom={2}
    defaultEdgeOptions={{
      type: "default",
      style: "stroke: var(--text-muted); stroke-width: 2;",
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "var(--text-muted)",
        width: 18,
        height: 18,
      },
    }}
    onnodedragstop={schedulePositionCommit}
    ondelete={onDelete}
    onconnect={onConnect}
    onconnectstart={onConnectStart}
    onconnectend={onConnectEnd}
    {isValidConnection}
    proOptions={{ hideAttribution: true }}
  >
    <Background bgColor="var(--background-primary)" patternColor="var(--text-faint)" gap={22} size={1.6} />
    <Controls position="bottom-right" showLock={false} />
    <MiniMap position="bottom-left" maskColor="color-mix(in srgb, var(--background-primary) 80%, transparent)" />
  </SvelteFlow>

  {#if file.contract.assembly.length === 0}
    <!--
      Empty-state hint. Visible only when the contract has no assembly
      steps yet. Disappears as soon as the user drops the first action.
    -->
    <div class="vm-canvas-emptystate" role="status">
      <h3>Build your first contract.</h3>
      <p>
        Drag an action from the <strong>left sidebar</strong> onto this
        canvas. Most contracts start with <em>Read a note</em> or
        <em>Search the vault</em>, and end with <em>Compile a brief</em>
        that produces the final result. Connect steps by dragging from a
        step's right edge to another step's left edge.
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

  /* xyflow theme overrides — keep Controls + MiniMap looking native.
     Bottom offset clears Obsidian's status bar (which overlays the
     bottom of the workspace). Without this padding the zoom controls
     and minimap collide with the "0 Rückverweise · N Wörter" line. */
  :global(.vm-canvas-pane .svelte-flow__controls) {
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    box-shadow: var(--shadow-s, 0 1px 2px rgba(0, 0, 0, 0.06));
    overflow: hidden;
    bottom: 36px !important;
  }
  :global(.vm-canvas-pane .svelte-flow__minimap) {
    bottom: 36px !important;
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

  /* ─────────────────────────────────────────────────────────────────
     Connection-drag compatibility.

     The canvas pane carries [data-dragging-output="<type>"] while a drag
     is in progress (set by onconnectstart, cleared by onconnectend).
     Each step node carries [data-accepted-inputs="<type1> <type2>…"]
     listing the OutputTypes it can accept.

     Default: every TARGET handle fades to 10% during any drag.
     Override: TARGET handles on nodes whose data-accepted-inputs
     contains the dragging type are restored to full opacity + glow.

     One rule per OutputType in the closed enum — `[attr~=value]` only
     accepts literal values, not variables. ──────────────────────── */

  /* Default during a drag: every target handle hides entirely.
     `!important` beats the per-node hover-grow rules in StepNode.svelte
     that otherwise highlight whichever incompatible card the cursor
     happens to be over. The hide is total (0 opacity) so the user
     visually sees only the compatible drop targets — that's the cue
     the user asked for. */
  :global(.vm-canvas-pane[data-dragging-output]:not([data-dragging-output=""])
    .vm-step-node .vm-step-node__handle.target) {
    opacity: 0 !important;
    pointer-events: none !important;
    transform: translate(-50%, -50%) scale(0.5) !important;
    box-shadow: none !important;
  }

  /* Compatible target: node's data-accepted-inputs has the dragging type. */
  :global(.vm-canvas-pane[data-dragging-output="any"]
    .vm-step-node .vm-step-node__handle.target),
  :global(.vm-canvas-pane[data-dragging-output="note"]
    .vm-step-node[data-accepted-inputs~="note"] .vm-step-node__handle.target),
  :global(.vm-canvas-pane[data-dragging-output="note-list"]
    .vm-step-node[data-accepted-inputs~="note-list"] .vm-step-node__handle.target),
  :global(.vm-canvas-pane[data-dragging-output="cluster-list"]
    .vm-step-node[data-accepted-inputs~="cluster-list"] .vm-step-node__handle.target),
  :global(.vm-canvas-pane[data-dragging-output="brief"]
    .vm-step-node[data-accepted-inputs~="brief"] .vm-step-node__handle.target),
  :global(.vm-canvas-pane[data-dragging-output="outline"]
    .vm-step-node[data-accepted-inputs~="outline"] .vm-step-node__handle.target),
  :global(.vm-canvas-pane[data-dragging-output="sections"]
    .vm-step-node[data-accepted-inputs~="sections"] .vm-step-node__handle.target) {
    opacity: 1 !important;
    pointer-events: auto !important;
    transform: translate(-50%, -50%) scale(1.15) !important;
    box-shadow:
      0 0 0 1px var(--background-modifier-border),
      0 0 0 6px color-mix(in srgb, var(--interactive-accent) 25%, transparent),
      0 0 12px color-mix(in srgb, var(--interactive-accent) 35%, transparent) !important;
  }

  /* Source handles stay visible. */
  :global(.vm-canvas-pane[data-dragging-output]:not([data-dragging-output=""])
    .vm-step-node .vm-step-node__handle.source) {
    opacity: 1 !important;
    pointer-events: auto !important;
  }

  /* The source node's OWN target handle must be hidden — no self-loops.
     isValidConnection refuses self-loops too; this is the visual cue. */
  :global(.vm-canvas-pane[data-dragging-output]:not([data-dragging-output=""])
    .vm-step-node.vm-drag-source .vm-step-node__handle.target) {
    opacity: 0 !important;
    pointer-events: none !important;
    transform: translate(-50%, -50%) scale(0.5) !important;
    box-shadow: none !important;
  }
</style>
