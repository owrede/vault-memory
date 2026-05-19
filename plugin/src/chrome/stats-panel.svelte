<!--
  Stats panel — Phase 7 / 07-09 / PLG-04 / ADR-007 §D-CHROME-STATS.

  Pattern F: thin Svelte view delegating to `stats-controller.ts` for
  unit-testability. Behaviors covered by `stats-panel.test.ts` via the
  controller surface.

  # What this renders

  Read-only 2-column key/value grid of runtime stats, with mono font on
  value cells per UI-SPEC §Typography "Mono" row. Fields:
    - notes  (count)
    - chunks (count)
    - last_index_at (ISO formatted timestamp, "—" when null)
    - embedding_model + embedding_dim ("bge-m3 × 1024")
    - audit_log_by_kind (nested list of "kind: count" rows)
    - peer_mcp_status (one row per peer; green/red dot via CSS)
    - contract_count (count)

  # Color rule
  Peer-MCP status dots use `var(--text-success)` / `var(--text-error)`
  per UI-SPEC §"Color" anti-rules (NOT `--interactive-accent`).

  # MCP contracts
  Calls `get_runtime_stats` (`src/plugin-tools/get-runtime-stats.ts`).
  All reads via MCP — no `app.metadataCache`, no direct DB access.
-->

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    createStatsController,
    type StatsController,
    type StatsControllerDeps,
    type StatsState,
  } from "./stats-controller.js";

  let {
    mcpClient,
    activeVault,
  }: {
    mcpClient: StatsControllerDeps["mcpClient"];
    activeVault: string | null;
  } = $props();

  const controller: StatsController = createStatsController({
    mcpClient,
    activeVault,
  });

  let state: StatsState = $state(controller.getState());
  const off = controller.subscribe((s) => {
    state = s;
  });
  onMount(() => {
    void controller.refresh();
  });
  onDestroy(off);

  function formatTimestamp(ms: number | null): string {
    if (ms === null || ms === undefined) return "—";
    try {
      return new Date(ms).toISOString();
    } catch {
      return "—";
    }
  }

  function modelDisplay(stats: NonNullable<StatsState["stats"]>): string {
    if (!stats.embedding_model) return "—";
    if (!stats.embedding_dim) return stats.embedding_model;
    return `${stats.embedding_model} × ${stats.embedding_dim}`;
  }

  async function onClickRefresh(): Promise<void> {
    await controller.refresh();
  }
</script>

<div class="vm-stats-panel">
  <div class="vm-stats-panel__header">
    <button
      type="button"
      class="vm-stats-panel__refresh"
      disabled={state.loading}
      onclick={onClickRefresh}
      data-testid="stats-refresh"
    >
      {state.loading ? "Loading…" : "Refresh"}
    </button>
  </div>

  {#if state.error}
    <div class="vm-stats-panel__error" data-testid="stats-error">
      Could not load stats: {state.error}
    </div>
  {:else if state.stats}
    {@const s = state.stats}
    <dl class="vm-stats-panel__grid">
      <dt class="vm-stats-panel__key">Notes</dt>
      <dd class="vm-stats-panel__value" data-testid="stat-notes">{s.notes}</dd>

      <dt class="vm-stats-panel__key">Chunks</dt>
      <dd class="vm-stats-panel__value" data-testid="stat-chunks">{s.chunks}</dd>

      <dt class="vm-stats-panel__key">Last indexed</dt>
      <dd class="vm-stats-panel__value" data-testid="stat-last-index">
        {formatTimestamp(s.last_index_at)}
      </dd>

      <dt class="vm-stats-panel__key">Embedding model</dt>
      <dd class="vm-stats-panel__value" data-testid="stat-model">
        {modelDisplay(s)}
      </dd>

      <dt class="vm-stats-panel__key">Audit log</dt>
      <dd class="vm-stats-panel__value">
        {#if Object.keys(s.audit_log_by_kind).length === 0}
          <span class="vm-stats-panel__empty">—</span>
        {:else}
          <ul class="vm-stats-panel__audit-list" data-testid="stat-audit-list">
            {#each Object.entries(s.audit_log_by_kind) as [kind, count] (kind)}
              <li class="vm-stats-panel__audit-item">{kind}: {count}</li>
            {/each}
          </ul>
        {/if}
      </dd>

      <dt class="vm-stats-panel__key">Peer-MCP clients</dt>
      <dd class="vm-stats-panel__value" data-testid="stat-peer-mcp">
        {#if s.peer_mcp_status.length === 0}
          <span class="vm-stats-panel__empty">—</span>
        {:else}
          {#each s.peer_mcp_status as peer (peer.name)}
            <div class="vm-stats-panel__peer-status">
              <span
                class="vm-stats-panel__dot {peer.available
                  ? 'vm-stats-panel__dot--ok'
                  : 'vm-stats-panel__dot--fail'}"
                data-testid={peer.available ? "peer-dot-ok" : "peer-dot-fail"}
              ></span>
              <span>{peer.name}</span>
            </div>
          {/each}
        {/if}
      </dd>

      <dt class="vm-stats-panel__key">Contracts</dt>
      <dd class="vm-stats-panel__value" data-testid="stat-contracts">{s.contract_count}</dd>
    </dl>
  {:else}
    <div class="vm-stats-panel__empty">
      Stats are unavailable while the vault-memory server is starting. Try again in a moment.
    </div>
  {/if}
</div>
