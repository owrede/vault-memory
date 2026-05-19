<!--
  Reindex panel — Phase 7 / 07-09 / PLG-03 / ADR-007 §D-CHROME-REINDEX.

  Pattern F: thin Svelte view delegating to a pure-TS controller
  (`reindex-controller.ts`) for unit-testability. Behaviors covered by
  `reindex-panel.test.ts` via the controller surface.

  # What this renders
  - "Reindex this vault" CTA (primary) — disabled when activeVault===null
  - "Reindex all vaults" CTA (secondary)
  - Live progress bar bound to `state.progress / state.total` — when
    `total` is undefined renders an indeterminate stripe
  - Inline status line ("Reindex complete — N vaults processed" | error
    message) per UI-SPEC copy table §"Editor surface".

  # Color rule
  Progress bar fill uses `var(--interactive-accent)` per
  UI-SPEC §"Color" rule 6 ("progress bar fill in the reindex toast").

  # MCP contracts
  - Calls `trigger_reindex` tool (`src/plugin-tools/trigger-reindex.ts`).
  - Subscribes to `onProgress(token, ...)` for live updates.
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import { Notice } from "obsidian";
  import {
    createReindexController,
    type ReindexController,
    type ReindexControllerDeps,
    type ReindexState,
  } from "./reindex-controller.js";

  // Props: pass the live mcpClient + active vault name. Optional
  // `newProgressToken` is exposed for tests that bypass crypto.
  let {
    mcpClient,
    activeVault,
    newProgressToken,
  }: {
    mcpClient: ReindexControllerDeps["mcpClient"];
    activeVault: string | null;
    newProgressToken?: () => string;
  } = $props();

  const controller: ReindexController = createReindexController({
    mcpClient,
    activeVault,
    newProgressToken: newProgressToken ?? (() => crypto.randomUUID()),
  });

  let state: ReindexState = $state(controller.getState());
  const off = controller.subscribe((s) => {
    state = s;
  });
  onDestroy(off);

  async function onClickThis(): Promise<void> {
    await controller.reindexThis();
    if (state.status === "complete") {
      new Notice(
        `Reindex complete — ${state.completedVaults.length} vault${
          state.completedVaults.length === 1 ? "" : "s"
        } processed`,
        5000,
      );
    }
  }

  async function onClickAll(): Promise<void> {
    await controller.reindexAll();
    if (state.status === "complete") {
      new Notice(
        `Reindex complete — ${state.completedVaults.length} vault${
          state.completedVaults.length === 1 ? "" : "s"
        } processed`,
        5000,
      );
    }
  }
</script>

<div class="vm-reindex-panel">
  <div class="vm-reindex-panel__actions">
    <button
      type="button"
      class="mod-cta vm-reindex-panel__cta-primary"
      disabled={state.busy || !state.canReindexThis}
      onclick={onClickThis}
      data-testid="reindex-this"
    >
      Reindex this vault
    </button>
    <button
      type="button"
      class="vm-reindex-panel__cta-secondary"
      disabled={state.busy}
      onclick={onClickAll}
      data-testid="reindex-all"
    >
      Reindex all vaults
    </button>
  </div>

  {#if state.status === "running"}
    <div class="vm-reindex-panel__progress" role="progressbar"
      aria-valuemin="0"
      aria-valuemax={state.total ?? undefined}
      aria-valuenow={state.progress}
    >
      {#if state.total !== undefined && state.total > 0}
        <div
          class="vm-reindex-panel__progress-fill"
          data-testid="progress-fill"
          style="width: {Math.min(100, (state.progress / state.total) * 100)}%"
        ></div>
      {:else}
        <div class="vm-reindex-panel__progress-fill vm-reindex-panel__progress-fill--indeterminate"
          data-testid="progress-fill"
        ></div>
      {/if}
    </div>
    <div class="vm-reindex-panel__status">
      Reindexing: {state.progress}{state.total !== undefined ? ` / ${state.total}` : ""} chunks
    </div>
  {:else if state.status === "complete"}
    <div class="vm-reindex-panel__status vm-reindex-panel__status--success">
      Reindex complete — {state.completedVaults.length} vault{state.completedVaults.length === 1
        ? ""
        : "s"} processed
    </div>
  {:else if state.status === "error"}
    <div class="vm-reindex-panel__status vm-reindex-panel__status--error">
      Reindex failed: {state.error}. See vault-memory log for details.
    </div>
  {/if}
</div>
