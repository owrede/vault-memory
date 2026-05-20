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
  Wrap the entire editor in <SvelteFlowProvider> so `useSvelteFlow()`
  inside CanvasPane resolves to the same store the <SvelteFlow>
  component creates. Without the provider, useSvelteFlow throws
  "To call useStore outside of <SvelteFlow /> you need to wrap your
  component in a <SvelteFlowProvider />" at module init — exactly
  what the user saw when opening a .contract from the file explorer.
-->
<SvelteFlowProvider>
  <div class="vm-editor-root" role="application" aria-label="vault-memory contract editor">
    <PalettePane {mcpClient} />
    <div class="vm-canvas-slot">
      <CanvasPane
        {file}
        selection={selectedAlias}
        {onChange}
        {onSelect}
      />
    </div>
    <InspectorPane {file} {selectedAlias} {onChange} />
  </div>
</SvelteFlowProvider>

<style>
  .vm-editor-root {
    display: grid;
    grid-template-columns: 260px 1fr 320px;
    grid-template-rows: 1fr;
    width: 100%;
    height: 100%;
    background: var(--background-primary);
    color: var(--text-normal);
    font-family: var(--font-interface);
  }
  .vm-canvas-slot {
    min-width: 0;
    min-height: 0;
    background: var(--background-primary);
  }
</style>
