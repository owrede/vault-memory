<!--
  palette-pane — left pane of the contract editor (Slice A redesign).

  Renders the verb catalog grouped by what a user accomplishes (read /
  search / navigate / reference / compose / escape) rather than by
  technical surface. Each row is a draggable card with:
    - Lucide icon for its category (Obsidian's setIcon)
    - Plain-language title (e.g. "Read a note")
    - Monospace verb subtitle (e.g. `read_note`)
    - One-line description
    - Drag handle (left edge) — cursor: grab; lifts on hover

  Styling references Obsidian CSS variables exclusively — no hex
  literals — so the palette matches the active theme. Section headers
  use the same .nav-header style Obsidian uses in the file explorer.
-->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { setIcon } from "obsidian";
  import { groupByCategory, lookupVerb, VERB_CATEGORY_META } from "./verb-catalog.js";
  import type { VerbMeta } from "./verb-catalog.js";
  import { fetchPeerMcpVerbs, type PeerMcpVerb, type ResourceClient } from "./peer-mcp.js";

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

  /**
   * Mount a Lucide icon into the element via Obsidian's setIcon. Called
   * as `use:lucideIcon={name}` so Svelte handles the action lifecycle.
   * Re-mounts on parameter change.
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

  function dragStartVerb(event: DragEvent, verb: string): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-vault-memory-verb", verb);
    // Native HTML5 drag image — we ask the browser to use the item itself.
    // Setting an explicit dragImage keeps the cursor-following preview
    // stable across browsers; without it, some Electron versions show
    // a blank rectangle.
    const card = event.currentTarget as HTMLElement;
    if (card?.cloneNode) {
      try {
        event.dataTransfer.setDragImage(card, 12, 12);
      } catch {
        // Best-effort; setDragImage throws on some headless contexts.
      }
    }
  }

  const groups = groupByCategory();
  const peerCategoryMeta = VERB_CATEGORY_META["escape"]; // peer-MCP uses the escape colour token
  void lookupVerb; // re-exported for inspector consumers
</script>

<aside class="vm-palette-pane" aria-label="Verb palette">
  <header class="vm-palette-header">
    <h2 class="vm-palette-title">Steps</h2>
    <p class="vm-palette-help">
      Drag a step onto the canvas. Each step is one action your contract
      runs in order. Steps starting with <strong>Read</strong> or
      <strong>Search</strong> usually come first; <strong>Compose</strong>
      usually comes last.
    </p>
  </header>

  {#each groups as group (group.category.id)}
    <section class="vm-palette-section">
      <div class="vm-palette-section-header">
        <span class="vm-palette-section-icon" use:lucideIcon={group.category.icon}></span>
        <h3 class="vm-palette-section-title">{group.category.label}</h3>
      </div>
      <ul class="vm-palette-list">
        {#each group.items as item (item.verb)}
          <li>
            <button
              type="button"
              class="vm-palette-card"
              draggable="true"
              ondragstart={(e) => dragStartVerb(e, item.verb)}
              data-verb={item.verb}
              style:--vm-cat-color="var({group.category.colorVar})"
              aria-label="{item.title} ({item.verb}) — drag onto canvas"
            >
              <span class="vm-palette-card-grip" aria-hidden="true">
                <span class="vm-palette-card-grip-dot"></span>
                <span class="vm-palette-card-grip-dot"></span>
                <span class="vm-palette-card-grip-dot"></span>
                <span class="vm-palette-card-grip-dot"></span>
                <span class="vm-palette-card-grip-dot"></span>
                <span class="vm-palette-card-grip-dot"></span>
              </span>
              <span class="vm-palette-card-body">
                <span class="vm-palette-card-title">{item.title}</span>
                <span class="vm-palette-card-verb">{item.verb}</span>
                <span class="vm-palette-card-desc">{item.description}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/each}

  {#if peerMcp.length > 0}
    <section class="vm-palette-section">
      <div class="vm-palette-section-header">
        <span class="vm-palette-section-icon" use:lucideIcon={"plug"}></span>
        <h3 class="vm-palette-section-title">Peer MCP</h3>
      </div>
      <p class="vm-palette-section-desc">
        Tools provided by other MCP servers you've connected (e.g. GitHub,
        Linear). Use sparingly — peer outputs are advisory, not real DocIds.
      </p>
      <ul class="vm-palette-list">
        {#each peerMcp as entry (entry.verb)}
          <li>
            <button
              type="button"
              class="vm-palette-card vm-palette-card--peer"
              draggable="true"
              ondragstart={(e) => dragStartVerb(e, entry.verb)}
              data-verb={entry.verb}
              style:--vm-cat-color="var({peerCategoryMeta.colorVar})"
              title="From {entry.server}"
              aria-label="{entry.verb} from {entry.server} — drag onto canvas"
            >
              <span class="vm-palette-card-grip" aria-hidden="true">
                <span class="vm-palette-card-grip-dot"></span>
                <span class="vm-palette-card-grip-dot"></span>
                <span class="vm-palette-card-grip-dot"></span>
                <span class="vm-palette-card-grip-dot"></span>
                <span class="vm-palette-card-grip-dot"></span>
                <span class="vm-palette-card-grip-dot"></span>
              </span>
              <span class="vm-palette-card-body">
                <span class="vm-palette-card-title">{entry.server}</span>
                <span class="vm-palette-card-verb">{entry.verb}</span>
              </span>
            </button>
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
    font-size: var(--font-ui-small);
    height: 100%;
    overflow-y: auto;
    border-right: 1px solid var(--background-modifier-border);
    padding-bottom: var(--size-4-4);
  }

  /* ── Header ── */
  .vm-palette-header {
    padding: var(--size-4-4) var(--size-4-4) var(--size-4-3);
    border-bottom: 1px solid var(--background-modifier-border);
    background: var(--background-secondary-alt, var(--background-secondary));
  }
  .vm-palette-title {
    margin: 0 0 var(--size-2-2);
    font-size: var(--font-ui-medium);
    font-weight: var(--font-semibold);
    color: var(--text-normal);
  }
  .vm-palette-help {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    line-height: 1.4;
  }
  .vm-palette-help strong {
    color: var(--text-normal);
    font-weight: var(--font-medium);
  }

  /* ── Section ── */
  .vm-palette-section {
    padding: var(--size-4-3) var(--size-4-3) 0;
  }
  .vm-palette-section-header {
    display: flex;
    align-items: center;
    gap: var(--size-2-2);
    padding: 0 var(--size-2-2) var(--size-2-2);
    color: var(--text-muted);
  }
  .vm-palette-section-icon {
    display: inline-flex;
    width: 16px;
    height: 16px;
    color: var(--text-muted);
  }
  .vm-palette-section-icon :global(svg) {
    width: 16px;
    height: 16px;
  }
  .vm-palette-section-title {
    margin: 0;
    font-size: var(--font-ui-smaller);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .vm-palette-section-desc {
    margin: 0 var(--size-2-2) var(--size-2-2);
    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
    line-height: 1.4;
  }
  .vm-palette-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--size-2-1);
  }

  /* ── Card ── */
  .vm-palette-card {
    /* Reset native button so the card looks like a draggable list item. */
    all: unset;
    box-sizing: border-box;
    width: 100%;
    display: flex;
    align-items: stretch;
    gap: var(--size-2-2);
    padding: var(--size-2-2) var(--size-2-2) var(--size-2-2) 0;
    border-radius: var(--radius-s);
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    cursor: grab;
    user-select: none;
    /* The 4px coloured strip on the left signals the category. */
    border-left: 4px solid var(--vm-cat-color, var(--text-muted));
    transition: transform 80ms ease-out, box-shadow 80ms ease-out, background 80ms;
  }
  .vm-palette-card:hover {
    background: var(--background-modifier-hover);
    box-shadow: var(--shadow-s, 0 1px 2px rgba(0, 0, 0, 0.06));
    transform: translateY(-1px);
  }
  .vm-palette-card:focus-visible {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 2px;
  }
  .vm-palette-card:active {
    cursor: grabbing;
    transform: translateY(0);
  }

  /* Grip — six dots in a 2-column grid. Pure CSS; no images. */
  .vm-palette-card-grip {
    display: grid;
    grid-template-columns: 4px 4px;
    grid-auto-rows: 4px;
    gap: 3px;
    align-self: center;
    padding: 0 var(--size-2-2);
    opacity: 0.5;
  }
  .vm-palette-card:hover .vm-palette-card-grip {
    opacity: 1;
  }
  .vm-palette-card-grip-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--text-faint);
  }

  .vm-palette-card-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .vm-palette-card-title {
    font-size: var(--font-ui-small);
    font-weight: var(--font-medium);
    color: var(--text-normal);
    line-height: 1.3;
  }
  .vm-palette-card-verb {
    font-family: var(--font-monospace);
    font-size: var(--font-smaller);
    color: var(--text-accent);
    line-height: 1.2;
  }
  .vm-palette-card-desc {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    line-height: 1.4;
    /* Wrap to two lines max; ellipsis on overflow. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Peer-MCP variant: muted background, no description (server name is
     in the title slot so the verb shows in the subtitle). */
  .vm-palette-card--peer {
    border-style: dashed;
  }
</style>
