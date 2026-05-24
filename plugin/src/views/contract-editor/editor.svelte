<!--
  editor — three-pane root for the Variant C contract editor.

  Phase 7 / Plan 07-05 / D-UI / UI-SPEC §"Layout".

  Layout: CSS grid with three columns (palette / canvas / inspector)
  per UI-SPEC §"Layout". Default widths: 260px / 1fr / 320px. Background
  colors reference Obsidian variables — `--background-primary` on the
  canvas pane, `--background-secondary` on palette + inspector.

  Selection state is local to the editor: the canvas pane emits
  selection changes, the inspector reads them. File state lives in the
  prop `file`; every mutation flows through `onChange`.
-->

<script lang="ts">
  import { SvelteFlowProvider } from "@xyflow/svelte";
  import PalettePane from "./palette/palette-pane.svelte";
  import CanvasPane from "./canvas/canvas-pane.svelte";
  import InspectorPane from "./inspector/inspector-pane.svelte";
  import type { ContractDocumentShape } from "../../shared-types.js";
  import type { ResourceClient } from "./palette/peer-mcp.js";

  let {
    file: initialFile,
    onChange,
    mcpClient,
  }: {
    file: ContractDocumentShape;
    onChange: (next: ContractDocumentShape) => void;
    mcpClient: ResourceClient | null;
  } = $props();

  // editor.svelte owns the live contract state. view.ts mounts us with
  // the parsed file once; from then on every mutation flows through
  // apply() which (a) replaces the reference here so the panes
  // re-render, and (b) forwards to view.ts via onChange for save +
  // YAML emission. Without this layer, dropping a palette item or
  // creating a connection updated view.ts's currentJson but the file
  // prop the panes read from stayed frozen — visible bug: nothing
  // appeared on the canvas after a drop.
  //
  // Uses $state.raw so the inner contract object isn't wrapped in a
  // deep reactive proxy. Reactivity fires only when we REPLACE the
  // reference in apply(); xyflow's bind:nodes mutations don't trip
  // cross-component effects, which was the cause of the literal-card
  // freeze before the queueMicrotask fix in canvas-pane.
  let liveFile = $state.raw<ContractDocumentShape>(initialFile);

  function apply(next: ContractDocumentShape): void {
    liveFile = next;
    onChange(next);
  }

  let selectedAlias = $state<string | null>(null);

  function onSelect(alias: string | null): void {
    selectedAlias = alias;
  }
</script>

<!--
  No wrapping <div> — render the three panes as direct DOM children of
  the parent `.vm-contract-editor` host (created by view.ts:renderEditor).
  styles.css defines `.vm-contract-editor` as a CSS grid with
  grid-template-areas "palette canvas inspector" + the corresponding
  grid-area: <palette|canvas|inspector> on each child. Grid items must
  be DIRECT children of the grid container — an intermediate
  `.vm-editor-root` div (used in 2.0.1) broke the layout by demoting
  the panes from direct children to grandchildren, so grid-area
  assignments stopped applying. Result was a half-rendered tab with
  panes overlapping in the top-right corner (the "Co" cutout the user
  reported in 2.0.4).

  SvelteFlowProvider renders no DOM (its template is just
  `{@render children?.()}`), so it's transparent to layout — safe to
  wrap the canvas slot without breaking the parent grid.
-->
<PalettePane {mcpClient} />
<SvelteFlowProvider>
  <CanvasPane
    file={liveFile}
    selection={selectedAlias}
    onChange={apply}
    {onSelect}
  />
</SvelteFlowProvider>
<InspectorPane file={liveFile} {selectedAlias} onChange={apply} />
