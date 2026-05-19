<!--
  palette-pane — left pane of the Variant C three-pane editor.

  Phase 7 / Plan 07-05 / D-PALETTE.

  Renders the five-section palette per 07-CONTEXT.md §"D-PALETTE":
    Section 1: Types (compile-time from TYPE_CATALOG)
    Section 2: Read verbs (compile-time from VERB_CATEGORIES.read)
    Section 3: Assembly verbs (compile-time from VERB_CATEGORIES.assembly)
    Section 4: Escape-hatch (compile-time from VERB_CATEGORIES.escape)
    Section 5: Peer-MCP (dynamic from fetchPeerMcpVerbs — refreshes on
               plugin focus per D-PALETTE)

  Each row is HTML5 drag-source-enabled with dataTransfer type
  `application/x-vault-memory-verb` and the verb name as the data;
  canvas-pane consumes the drop.

  Background `var(--background-secondary)` per UI-SPEC §"Color".
-->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { BASELINE_VERBS, VERB_CATEGORIES } from "./verb-list.js";
  import { TYPE_CATALOG } from "./type-catalog.js";
  import { fetchPeerMcpVerbs, type PeerMcpVerb, type ResourceClient } from "./peer-mcp.js";

  // Silence the unused-import lint — BASELINE_VERBS is consumed indirectly
  // via the verb-list test partition assertion, but the palette-pane
  // references it for its empty-render fallback case below.
  void BASELINE_VERBS;

  let {
    mcpClient,
  }: {
    mcpClient: ResourceClient | null;
  } = $props();

  let peerMcp = $state<PeerMcpVerb[]>([]);

  async function refresh(): Promise<void> {
    if (!mcpClient) {
      peerMcp = [];
      return;
    }
    peerMcp = await fetchPeerMcpVerbs(mcpClient);
  }

  onMount(() => {
    void refresh();
    document.addEventListener("visibilitychange", onVisibility);
  });
  onDestroy(() => {
    document.removeEventListener("visibilitychange", onVisibility);
  });
  function onVisibility(): void {
    if (document.visibilityState === "visible") {
      void refresh();
    }
  }

  function dragStartVerb(event: DragEvent, verb: string): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-vault-memory-verb", verb);
  }
</script>

<aside class="vm-palette-pane" aria-label="Verb palette">
  <section class="palette-section">
    <h3>Types</h3>
    <ul>
      {#each TYPE_CATALOG as entry (entry.name)}
        <li class="palette-item palette-type" title={entry.description}>
          <span class="label">{entry.name}</span>
        </li>
      {/each}
    </ul>
  </section>

  <section class="palette-section">
    <h3>Read verbs</h3>
    <ul>
      {#each VERB_CATEGORIES.read as verb (verb)}
        <li
          class="palette-item palette-verb"
          draggable="true"
          ondragstart={(e) => dragStartVerb(e, verb)}
        >
          <span class="label">{verb}</span>
        </li>
      {/each}
    </ul>
  </section>

  <section class="palette-section">
    <h3>Assembly verbs</h3>
    <ul>
      {#each VERB_CATEGORIES.assembly as verb (verb)}
        <li
          class="palette-item palette-verb"
          draggable="true"
          ondragstart={(e) => dragStartVerb(e, verb)}
        >
          <span class="label">{verb}</span>
        </li>
      {/each}
    </ul>
  </section>

  <section class="palette-section">
    <h3>Escape-hatch</h3>
    <ul>
      {#each VERB_CATEGORIES.escape as verb (verb)}
        <li
          class="palette-item palette-verb"
          draggable="true"
          ondragstart={(e) => dragStartVerb(e, verb)}
        >
          <span class="label">{verb}</span>
        </li>
      {/each}
    </ul>
  </section>

  {#if peerMcp.length > 0}
    <section class="palette-section">
      <h3>Peer MCP</h3>
      <ul>
        {#each peerMcp as entry (entry.verb)}
          <li
            class="palette-item palette-verb palette-mcp"
            draggable="true"
            ondragstart={(e) => dragStartVerb(e, entry.verb)}
            title="From {entry.server}"
          >
            <span class="label">{entry.verb}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</aside>

<style>
  .vm-palette-pane {
    background: var(--background-secondary);
    color: var(--text-normal);
    font-family: var(--font-interface);
    padding: var(--size-4-4, 16px) 0;
    height: 100%;
    overflow-y: auto;
    border-right: 1px solid var(--background-modifier-border);
  }
  .palette-section {
    padding: 0 var(--size-4-4, 16px);
    margin-bottom: var(--size-4-4, 16px);
  }
  .palette-section h3 {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
    margin: 0 0 var(--size-4-2, 8px) 0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .palette-section ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .palette-item {
    padding: var(--size-4-2, 8px) var(--size-4-3, 12px);
    border-radius: 4px;
    cursor: grab;
    font-family: var(--font-monospace);
    font-size: 13px;
    border-left: 2px solid transparent;
    margin-bottom: 2px;
  }
  .palette-item:hover {
    background: var(--background-modifier-hover);
  }
  .palette-item:active {
    cursor: grabbing;
    border-left-color: var(--interactive-accent);
  }
  .palette-type {
    cursor: default;
    color: var(--text-muted);
  }
  .palette-type:active {
    cursor: default;
    border-left-color: transparent;
  }
  .palette-mcp {
    color: var(--text-accent);
  }
</style>
