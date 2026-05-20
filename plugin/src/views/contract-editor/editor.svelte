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
    file,
    onChange,
    mcpClient,
  }: {
    file: ContractDocumentShape;
    onChange: (next: ContractDocumentShape) => void;
    mcpClient: ResourceClient | null;
  } = $props();

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
    {file}
    selection={selectedAlias}
    {onChange}
    {onSelect}
  />
</SvelteFlowProvider>
<InspectorPane {file} {selectedAlias} {onChange} />
