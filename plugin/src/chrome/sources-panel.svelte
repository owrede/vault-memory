<!--
  Sources panel — Settings-tab section.

  Spec: .planning/specs/SOURCES-REGISTRY.md §8.

  Phase B (minimal + live MCP):
    - Source list from set_mcp_client {list:true}
    - Per-source accordion shows tools known via vault-memory://contract-verbs
      (only audit-observed tools today; full tools/list later, spec §5.2)
    - Per-tool checkbox toggles plugin-side curation (sourceEnabledTools)

  Deliberately omitted for now:
    - Add-source form (Chrome view's Connectors panel already covers add/remove)
    - Bulk enable/disable per source
    - Status indicators richer than connected/disconnected/untested
-->

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { setIcon } from "obsidian";
  import {
    createSourcesController,
    type SourceEntry,
    type SourceTool,
    type SourcesController,
    type SourcesControllerDeps,
    type SourcesState,
    type ToolsLoadStatus,
  } from "./sources-controller.js";

  let {
    mcpClient,
    enabledTools,
    vaultName,
  }: {
    mcpClient: SourcesControllerDeps["mcpClient"];
    enabledTools: SourcesControllerDeps["enabledTools"];
    vaultName: string;
  } = $props();

  const controller: SourcesController = createSourcesController({
    mcpClient,
    enabledTools,
    vaultName,
  });

  let state: SourcesState = $state(controller.getState());
  const off = controller.subscribe((s) => {
    state = s;
  });
  onMount(() => void controller.refresh());
  onDestroy(off);

  let expanded: Record<string, boolean> = $state({});

  function toggleExpanded(name: string): void {
    expanded = { ...expanded, [name]: !expanded[name] };
    if (expanded[name]) {
      void controller.loadToolsFor(name);
    }
  }

  function statusDotClass(status: SourceEntry["status"]): string {
    if (status === "connected") return "vm-src-dot vm-src-dot--ok";
    if (status === "disconnected") return "vm-src-dot vm-src-dot--err";
    return "vm-src-dot vm-src-dot--unknown";
  }

  function statusLabel(status: SourceEntry["status"]): string {
    if (status === "connected") return "Connected";
    if (status === "disconnected") return "Disconnected";
    return "Not tested";
  }

  function toolsStatusLine(
    source: SourceEntry,
    status: ToolsLoadStatus | undefined,
    tools: readonly SourceTool[] | undefined,
  ): string {
    if (!status || status.kind === "idle") {
      return "Click to load available tools";
    }
    if (status.kind === "loading") return "Loading tools…";
    if (status.kind === "error") return `Failed to load tools: ${status.message}`;
    const all = tools ?? [];
    const enabledCount = all.filter((t) =>
      controller.isToolEnabled(source.name, t.name),
    ).length;
    if (all.length === 0) {
      return "No tools observed yet — used a tool once to register it";
    }
    return `${enabledCount} of ${all.length} enabled`;
  }

  function chevronRef(el: HTMLElement, open: boolean): { update(o: boolean): void } {
    setIcon(el, open ? "chevron-down" : "chevron-right");
    return {
      update(o: boolean): void {
        setIcon(el, o ? "chevron-down" : "chevron-right");
      },
    };
  }
</script>

<div class="vm-sources">
  <div class="vm-sources__header">
    <p class="vm-sources__desc">
      Peer MCP servers vault-memory connects to. Toggle individual tools to
      control which appear in the contract editor palette. Adding or removing
      sources happens in the vault-memory chrome view (Connectors).
    </p>
    <button
      type="button"
      class="vm-sources__refresh"
      onclick={() => void controller.refresh()}
      disabled={state.loading}
      aria-label="Refresh sources"
      title="Refresh sources"
    >
      {state.loading ? "Loading…" : "Refresh"}
    </button>
  </div>

  {#if state.loadError}
    <div class="vm-sources__error" role="alert">
      {state.loadError}
    </div>
  {/if}

  {#if !state.loading && state.sources.length === 0 && !state.loadError}
    <div class="vm-sources__empty">
      No peer MCP servers configured. Open the vault-memory chrome view
      (Connectors panel) to add one, or edit
      <code>~/.vault-memory/config.toml</code> under
      <code>[contracts.mcp_clients.&lt;name&gt;]</code>.
    </div>
  {/if}

  <ul class="vm-sources__list">
    {#each state.sources as src (src.name)}
      {@const isOpen = !!expanded[src.name]}
      {@const status = state.toolsStatusBySource[src.name]}
      {@const tools = state.toolsBySource[src.name]}
      <li class="vm-source">
        <button
          type="button"
          class="vm-source__head"
          aria-expanded={isOpen}
          onclick={() => toggleExpanded(src.name)}
        >
          <span
            class="vm-source__chevron"
            use:chevronRef={isOpen}
          ></span>
          <span class={statusDotClass(src.status)} aria-hidden="true"></span>
          <span class="vm-source__name">{src.name}</span>
          <span class="vm-source__status">{statusLabel(src.status)}</span>
          <span class="vm-source__tool-count">
            {toolsStatusLine(src, status, tools)}
          </span>
        </button>

        <div class="vm-source__cmd">
          <code>{src.command}{src.args.length > 0 ? " " + src.args.join(" ") : ""}</code>
        </div>

        {#if isOpen}
          <div class="vm-source__tools">
            {#if status?.kind === "loading"}
              <div class="vm-source__tools-empty">Loading tools…</div>
            {:else if status?.kind === "error"}
              <div class="vm-source__tools-empty vm-source__tools-empty--err">
                {status.message}
              </div>
            {:else if (tools?.length ?? 0) === 0}
              <div class="vm-source__tools-empty">
                No tools have been observed for this source yet. Tools are
                discovered as contracts call them; the full <code>tools/list</code>
                discovery surface is on the roadmap.
              </div>
            {:else}
              <ul class="vm-source__tool-list">
                {#each tools ?? [] as tool (tool.verb)}
                  {@const enabled = controller.isToolEnabled(src.name, tool.name)}
                  <li class="vm-tool">
                    <label class="vm-tool__label">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onchange={(e) =>
                          void controller.setToolEnabled(
                            src.name,
                            tool.name,
                            (e.currentTarget as HTMLInputElement).checked,
                          )}
                      />
                      <span class="vm-tool__name">{tool.name}</span>
                      {#if tool.invocationCount !== undefined && tool.invocationCount > 0}
                        <span class="vm-tool__count" title="Invocation count">
                          ×{tool.invocationCount}
                        </span>
                      {/if}
                    </label>
                    {#if tool.description}
                      <div class="vm-tool__desc">{tool.description}</div>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .vm-sources {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .vm-sources__header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    justify-content: space-between;
  }
  .vm-sources__desc {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
    flex: 1;
  }
  .vm-sources__refresh {
    flex-shrink: 0;
  }
  .vm-sources__error {
    padding: 8px 12px;
    border-radius: var(--radius-s);
    background: var(--background-modifier-error);
    color: var(--text-on-accent);
    font-size: var(--font-ui-small);
  }
  .vm-sources__empty {
    padding: 12px;
    border-radius: var(--radius-s);
    border: 1px dashed var(--background-modifier-border);
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }
  .vm-sources__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .vm-source {
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    background: var(--background-secondary);
    overflow: hidden;
  }
  .vm-source__head {
    display: grid;
    grid-template-columns: 16px 10px 1fr auto auto;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text-normal);
  }
  .vm-source__head:hover {
    background: var(--background-modifier-hover);
  }
  .vm-source__chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }
  .vm-src-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }
  .vm-src-dot--ok { background: var(--color-green); }
  .vm-src-dot--err { background: var(--color-red); }
  .vm-src-dot--unknown { background: var(--background-modifier-border); }
  .vm-source__name {
    font-weight: 600;
  }
  .vm-source__status {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }
  .vm-source__tool-count {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }
  .vm-source__cmd {
    padding: 0 12px 8px 38px;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }
  .vm-source__cmd code {
    background: transparent;
    padding: 0;
  }
  .vm-source__tools {
    border-top: 1px solid var(--background-modifier-border);
    padding: 8px 12px 12px 38px;
  }
  .vm-source__tools-empty {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
    padding: 4px 0;
  }
  .vm-source__tools-empty--err {
    color: var(--text-error);
  }
  .vm-source__tool-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .vm-tool__label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .vm-tool__name {
    font-family: var(--font-monospace);
    font-size: var(--font-ui-small);
  }
  .vm-tool__count {
    color: var(--text-faint);
    font-size: var(--font-ui-smaller);
  }
  .vm-tool__desc {
    margin-left: 24px;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
  }
</style>
