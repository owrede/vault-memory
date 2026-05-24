<!--
  palette-pane — left column of the contract editor.

  Layout:
    1. Source dropdown (top): single-select <select> listing all connected
       MCP servers. vault-memory is always present; peer servers appear as
       discovered. Verb list below shows ONLY the selected server's tools.
       A small "Refresh" button next to the dropdown re-runs discovery
       on demand (also triggered automatically on mount and on
       `visibilitychange` to "visible").
    2. Scrollable verb list grouped by category. Category headers are
       click-to-collapse (chevron flips). Per-server collapse-state memory
       so collapsed categories stay collapsed when you switch servers.

  # MCP discovery architecture (read this before changing discovery)

  The plugin holds ONE MCP client connection — to the vault-memory
  server itself (see `plugin/src/services/mcp-client.ts`). It does NOT
  enumerate the user's other MCP servers directly. Peer-MCP sources in
  the dropdown are discovered through the host server's resource
  `vault-memory://contract-verbs`, which returns the set of peer
  servers/tools observed in the current vault's contracts (i.e. verbs
  that have actually been used in `contract_step` audit rows, plus
  whatever the host has configured under `[contracts.mcp_clients.*]`).

  So this dropdown lists "peer servers the host knows about" — which
  in practice means peer servers that have been declared in TOML and
  invoked at least once. Servers the host has not been configured to
  proxy to are invisible to the plugin. That is by design: the plugin
  trusts the host to be the single MCP bus.

  Each verb card is a draggable <div role="button">. Native HTML5 drag
  with MIME `application/x-vault-memory-verb` + text/plain fallback so
  Electron-quirky drop targets still resolve the verb.
-->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { setIcon } from "obsidian";
  import { groupByCategory, lookupVerb, VERB_CATEGORY_META } from "./verb-catalog.js";
  import { fetchPeerMcpVerbs, type PeerMcpVerb, type ResourceClient } from "./peer-mcp.js";

  let {
    mcpClient,
  }: {
    mcpClient: ResourceClient | null;
  } = $props();

  let peerMcp = $state<PeerMcpVerb[]>([]);
  /** True while a discovery refresh is in flight — disables the refresh button + spins the icon. */
  let refreshing = $state<boolean>(false);

  const VAULT_MEMORY_ID = "vault-memory";
  let selectedSource = $state<string>(VAULT_MEMORY_ID);

  /** Search filter applied across action title, name, and description. */
  let searchQuery = $state<string>("");

  /**
   * Per-server set of collapsed category ids. Keyed by source id, so
   * switching servers preserves each server's expand/collapse state.
   */
  let collapsedPerSource = $state<Record<string, Set<string>>>({});

  async function refresh(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
      if (!mcpClient) {
        peerMcp = [];
        return;
      }
      peerMcp = await fetchPeerMcpVerbs(mcpClient);
    } finally {
      refreshing = false;
    }
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

  function onDragStart(event: DragEvent, verb: string): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("application/x-vault-memory-verb", verb);
    event.dataTransfer.setData("text/plain", verb);
    const card = event.currentTarget as HTMLElement;
    card?.classList.add("is-dragging");
  }

  function onDragEnd(event: DragEvent): void {
    const card = event.currentTarget as HTMLElement | null;
    card?.classList.remove("is-dragging");
  }

  function tooltip(title: string, verbName: string, description: string): string {
    return `${title}\n\n${description}\n\nDrag onto the canvas to add this step.`;
  }

  /** Lowercased, trimmed search query for case-insensitive substring matching. */
  const normalizedQuery = $derived(searchQuery.trim().toLowerCase());

  function matchesSearch(
    title: string,
    verbName: string,
    description: string,
  ): boolean {
    if (normalizedQuery.length === 0) return true;
    const hay = `${title} ${verbName} ${description}`.toLowerCase();
    return hay.includes(normalizedQuery);
  }

  function clearSearch(): void {
    searchQuery = "";
  }

  const groups = groupByCategory();
  /** Groups with their items filtered by the current search query. */
  const filteredGroups = $derived(
    groups
      .map((g) => ({
        category: g.category,
        items: g.items.filter((item) =>
          matchesSearch(item.title, item.verb, item.description),
        ),
      }))
      .filter((g) => g.items.length > 0),
  );
  /** Total vault-memory matches after filtering, for empty-state check. */
  const filteredVaultMemoryCount = $derived(
    filteredGroups.reduce((sum, g) => sum + g.items.length, 0),
  );
  const peerCategoryMeta = VERB_CATEGORY_META["escape"];
  void lookupVerb;

  type SourceOption = { id: string; label: string; count: number };
  const vaultMemoryVerbCount = groups.reduce((sum, g) => sum + g.items.length, 0);
  const sources = $derived<SourceOption[]>([
    { id: VAULT_MEMORY_ID, label: "vault-memory", count: vaultMemoryVerbCount },
    ...Array.from(
      peerMcp.reduce<Map<string, number>>((acc, v) => {
        acc.set(v.server, (acc.get(v.server) ?? 0) + 1);
        return acc;
      }, new Map()),
    ).map(([id, count]) => ({ id, label: id, count })),
  ]);

  const collapsedSet = $derived(collapsedPerSource[selectedSource] ?? new Set<string>());

  function toggleCategory(categoryId: string): void {
    const current = collapsedPerSource[selectedSource] ?? new Set<string>();
    const next = new Set(current);
    if (next.has(categoryId)) next.delete(categoryId);
    else next.add(categoryId);
    collapsedPerSource = { ...collapsedPerSource, [selectedSource]: next };
  }

  const visiblePeers = $derived(
    selectedSource === VAULT_MEMORY_ID
      ? []
      : peerMcp
          .filter((v) => v.server === selectedSource)
          .filter((v) => matchesSearch(v.verb, v.verb, v.server)),
  );

  const showVaultMemory = $derived(selectedSource === VAULT_MEMORY_ID);
</script>

<aside class="vm-palette-pane" aria-label="Actions palette">
  <div class="vm-palette-sources" aria-label="MCP source">
    <label class="vm-palette-sources-label" for="vm-source-select">Source</label>
    <select
      id="vm-source-select"
      class="vm-palette-source-select dropdown"
      bind:value={selectedSource}
      aria-label="Select MCP source"
    >
      {#each sources as src (src.id)}
        <option value={src.id}>{src.label} ({src.count})</option>
      {/each}
    </select>
    <button
      type="button"
      class="vm-palette-source-refresh clickable-icon"
      onclick={() => void refresh()}
      disabled={refreshing}
      title="Refresh MCP sources"
      aria-label="Refresh MCP sources"
    >
      <span
        class="vm-palette-refresh-icon"
        class:is-spinning={refreshing}
        use:lucideIcon={"refresh-cw"}
      ></span>
    </button>
  </div>
  {#if !mcpClient}
    <div class="vm-palette-source-warning" role="status">
      Connect to vault-memory to see more sources.
    </div>
  {/if}

  <div class="vm-palette-search">
    <input
      type="search"
      class="vm-palette-search-input search-input"
      placeholder="Search actions…"
      bind:value={searchQuery}
      aria-label="Search actions"
    />
    {#if normalizedQuery.length > 0}
      <button
        type="button"
        class="vm-palette-search-clear"
        onclick={clearSearch}
        title="Clear search"
        aria-label="Clear search"
      >×</button>
    {/if}
  </div>

  <div class="vm-palette-scroll">
    {#if showVaultMemory}
      {#each filteredGroups as group (group.category.id)}
        {@const isCollapsed = collapsedSet.has(group.category.id)}
        <section class="vm-palette-section" class:is-collapsed={isCollapsed}>
          <button
            type="button"
            class="vm-palette-section-header"
            onclick={() => toggleCategory(group.category.id)}
            aria-expanded={!isCollapsed}
          >
            <span class="vm-palette-section-chevron" use:lucideIcon={isCollapsed ? "chevron-right" : "chevron-down"}></span>
            <span class="vm-palette-section-icon" use:lucideIcon={group.category.icon}></span>
            <span class="vm-palette-section-title">{group.category.label}</span>
            <span class="vm-palette-section-count">{group.items.length}</span>
          </button>
          {#if !isCollapsed}
            <div class="vm-palette-list">
              {#each group.items as item (item.verb)}
                <div
                  class="vm-palette-card"
                  draggable="true"
                  role="button"
                  tabindex="0"
                  ondragstart={(e) => onDragStart(e, item.verb)}
                  ondragend={onDragEnd}
                  data-verb={item.verb}
                  style:--vm-cat-color="var({group.category.colorVar})"
                  title={tooltip(item.title, item.verb, item.description)}
                  aria-label="{item.title} ({item.verb}) — drag onto canvas"
                >
                  <span class="vm-palette-card-grip" aria-hidden="true"></span>
                  <span class="vm-palette-card-title">{item.title}</span>
                  <span class="vm-palette-card-verb">{item.verb}</span>
                </div>
              {/each}
            </div>
          {/if}
        </section>
      {/each}
    {/if}

    {#if visiblePeers.length > 0}
      {@const peerCatId = `peer:${selectedSource}`}
      {@const isCollapsed = collapsedSet.has(peerCatId)}
      <section class="vm-palette-section" class:is-collapsed={isCollapsed}>
        <button
          type="button"
          class="vm-palette-section-header"
          onclick={() => toggleCategory(peerCatId)}
          aria-expanded={!isCollapsed}
        >
          <span class="vm-palette-section-chevron" use:lucideIcon={isCollapsed ? "chevron-right" : "chevron-down"}></span>
          <span class="vm-palette-section-icon" use:lucideIcon={"plug"}></span>
          <span class="vm-palette-section-title">{selectedSource}</span>
          <span class="vm-palette-section-count">{visiblePeers.length}</span>
        </button>
        {#if !isCollapsed}
          <div class="vm-palette-list">
            {#each visiblePeers as entry (entry.verb)}
              <div
                class="vm-palette-card"
                draggable="true"
                role="button"
                tabindex="0"
                ondragstart={(e) => onDragStart(e, entry.verb)}
                ondragend={onDragEnd}
                data-verb={entry.verb}
                style:--vm-cat-color="var({peerCategoryMeta.colorVar})"
                title={entry.description
                  ? `${entry.verb}\n\n${entry.description}\n\nFrom ${entry.server} (an external MCP server). Output is advisory.\n\nDrag onto the canvas to add this step.`
                  : `${entry.verb}\n\nFrom ${entry.server} (an external MCP server). Output is advisory.\n\nDrag onto the canvas to add this step.`}
                aria-label="{entry.verb} from {entry.server} — drag onto canvas"
              >
                <span class="vm-palette-card-grip" aria-hidden="true"></span>
                <span class="vm-palette-card-title">{entry.verb}</span>
                <span class="vm-palette-card-verb">{entry.server}</span>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/if}

    {#if showVaultMemory && filteredVaultMemoryCount === 0 && normalizedQuery.length > 0}
      <div class="vm-palette-empty" role="status">
        <p>No actions match "{searchQuery}".</p>
        <p>Try a different search or <button type="button" class="vm-palette-empty-link" onclick={clearSearch}>clear the filter</button>.</p>
      </div>
    {/if}

    {#if !showVaultMemory && visiblePeers.length === 0}
      <div class="vm-palette-empty" role="status">
        {#if normalizedQuery.length > 0}
          <p>No actions match "{searchQuery}" in this source.</p>
          <p><button type="button" class="vm-palette-empty-link" onclick={clearSearch}>Clear the filter</button> or try another source.</p>
        {:else}
          <p>This source has no tools.</p>
        {/if}
      </div>
    {/if}
  </div>
</aside>

<style>
  .vm-palette-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-size: var(--font-ui-small);
  }

  /* ── Source dropdown ── */
  .vm-palette-sources {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--size-2-3);
    padding: var(--size-4-2) var(--size-4-3);
    border-bottom: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
  }
  .vm-palette-sources-label {
    font-size: 10px;
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    flex: 0 0 auto;
  }
  .vm-palette-source-select {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--font-ui-small);
  }
  .vm-palette-source-refresh {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border-radius: var(--radius-s);
    color: var(--text-muted);
    cursor: pointer;
  }
  .vm-palette-source-refresh:hover:not(:disabled) {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }
  .vm-palette-source-refresh:disabled {
    opacity: 0.5;
    cursor: progress;
  }
  .vm-palette-refresh-icon {
    display: inline-flex;
    width: 14px;
    height: 14px;
  }
  .vm-palette-refresh-icon :global(svg) {
    width: 14px;
    height: 14px;
  }
  .vm-palette-refresh-icon.is-spinning :global(svg) {
    animation: vm-palette-spin 900ms linear infinite;
  }
  @keyframes vm-palette-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .vm-palette-source-warning {
    flex: 0 0 auto;
    padding: var(--size-2-2) var(--size-4-3);
    background: var(--background-modifier-error-rgb, var(--background-secondary));
    background: rgba(var(--background-modifier-error-rgb, 255 200 80) / 0.08);
    border-bottom: 1px solid var(--background-modifier-border);
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    font-style: italic;
  }

  /* ── Search box ── */
  .vm-palette-search {
    flex: 0 0 auto;
    position: relative;
    padding: var(--size-2-3) var(--size-4-3);
    border-bottom: 1px solid var(--background-modifier-border);
  }
  .vm-palette-search-input {
    width: 100%;
    box-sizing: border-box;
    font-size: var(--font-ui-small);
  }
  .vm-palette-search-clear {
    position: absolute;
    right: calc(var(--size-4-3) + 6px);
    top: 50%;
    transform: translateY(-50%);
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    border-radius: 50%;
  }
  .vm-palette-search-clear:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .vm-palette-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: var(--size-4-2) var(--size-4-3) var(--size-4-4);
  }

  /* ── Section / category ── */
  .vm-palette-section + .vm-palette-section {
    margin-top: var(--size-4-3);
  }
  .vm-palette-section-header {
    all: unset;
    box-sizing: border-box;
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--size-2-2);
    padding: var(--size-2-2) var(--size-2-1);
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
    border-radius: var(--radius-s);
  }
  .vm-palette-section-header:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }
  .vm-palette-section-header:focus-visible {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 2px;
  }
  .vm-palette-section-chevron,
  .vm-palette-section-icon {
    display: inline-flex;
    width: 12px;
    height: 12px;
    flex: 0 0 auto;
  }
  .vm-palette-section-chevron :global(svg),
  .vm-palette-section-icon :global(svg) {
    width: 12px;
    height: 12px;
  }
  .vm-palette-section-title {
    margin: 0;
    flex: 1 1 auto;
    font-size: 10px;
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .vm-palette-section-count {
    flex: 0 0 auto;
    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }

  /* ── Empty state ── */
  .vm-palette-empty {
    padding: var(--size-4-6) var(--size-4-3);
    text-align: center;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
  }
  .vm-palette-empty p {
    margin: 0 0 var(--size-2-2);
  }
  .vm-palette-empty-link {
    all: unset;
    color: var(--text-accent);
    cursor: pointer;
    text-decoration: underline;
  }
  .vm-palette-empty-link:hover {
    color: var(--text-accent-hover, var(--text-accent));
  }

  /* ── Verb list ── */
  .vm-palette-list {
    display: flex;
    flex-direction: column;
    gap: var(--size-2-3);
    padding-top: var(--size-2-2);
  }

  /* ── Card ── */
  .vm-palette-card {
    display: flex;
    align-items: center;
    gap: var(--size-2-3);
    min-height: 30px;
    padding: var(--size-2-2) var(--size-2-3) var(--size-2-2) 0;
    border-radius: var(--radius-s);
    border: 1px solid var(--background-modifier-border);
    border-left: 4px solid var(--vm-cat-color, var(--text-muted));
    background: var(--background-primary);
    color: var(--text-normal);
    cursor: grab;
    user-select: none;
    transition: background 80ms, border-color 80ms, transform 80ms, box-shadow 80ms,
      opacity 80ms;
  }
  .vm-palette-card:hover {
    background: var(--background-modifier-hover);
    border-color: var(--interactive-accent);
    border-left-color: var(--vm-cat-color, var(--interactive-accent));
    box-shadow: var(--shadow-s, 0 1px 3px rgba(0, 0, 0, 0.12));
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
  .vm-palette-card.is-dragging {
    opacity: 0.55;
    transform: scale(0.97);
    box-shadow: none;
  }

  .vm-palette-card-grip {
    flex: 0 0 auto;
    width: 8px;
    height: 14px;
    margin-left: var(--size-2-2);
    background-image: radial-gradient(circle, var(--text-faint) 1px, transparent 1.5px);
    background-size: 4px 4px;
    background-position: 0 0;
    opacity: 0.5;
    transition: opacity 80ms;
  }
  .vm-palette-card:hover .vm-palette-card-grip {
    opacity: 1;
    background-image: radial-gradient(circle, var(--text-muted) 1px, transparent 1.5px);
  }
  .vm-palette-card-title {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--font-ui-small);
    font-weight: var(--font-medium);
    color: var(--text-normal);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .vm-palette-card-verb {
    flex: 0 0 auto;
    font-family: var(--font-monospace);
    font-size: var(--font-smaller);
    color: var(--text-faint);
    white-space: nowrap;
  }
  .vm-palette-card:hover .vm-palette-card-verb {
    color: var(--text-muted);
  }
</style>
