<!--
  StepNode — custom Svelte Flow node for the Variant C contract editor.

  Phase 7 / Plan 07-05 / D-UI / UI-SPEC §"Canvas Interaction Grammar".

  Renders one assembly step as a 220x120 card:
    - top-left status dot (●/⚠/✕) wired via `data.status`.
    - alias in mono semibold (top row).
    - verb in mono regular (second row).
    - left handle (target / read_back input).
    - right handle (source / output to downstream steps).

  Visual contract per UI-SPEC §StepNode:
    - background: var(--background-secondary)
    - border: 1px solid var(--background-modifier-border) (idle)
    - border: 1px solid var(--interactive-accent) (selected)
    - border: 1px solid var(--text-error) (validation error)
  All color tokens are Obsidian variables — no hex literals.
-->

<script lang="ts">
  import { Handle, Position } from "@xyflow/svelte";

  let {
    data,
    selected = false,
  }: {
    data: { alias: string; verb: string; status?: "ok" | "warning" | "error" };
    selected?: boolean;
  } = $props();

  const statusDot = $derived(
    data.status === "warning"
      ? "warn"
      : data.status === "error"
        ? "err"
        : "ok",
  );
</script>

<div
  class="vm-step-node"
  class:vm-selected={selected}
  class:vm-status-error={data.status === "error"}
  data-verb={data.verb}
>
  <Handle type="target" position={Position.Left} />
  <div class="header">
    <span class="dot dot-{statusDot}" aria-hidden="true"></span>
    <span class="alias">{data.alias}</span>
  </div>
  <div class="verb">{data.verb}</div>
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .vm-step-node {
    width: 220px;
    height: 120px;
    box-sizing: border-box;
    padding: var(--size-4-3, 12px) var(--size-4-4, 16px);
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    color: var(--text-normal);
    font-family: var(--font-monospace);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2, 8px);
  }
  .vm-step-node.vm-selected {
    border-color: var(--interactive-accent);
  }
  .vm-step-node.vm-status-error {
    border-color: var(--text-error);
  }
  .header {
    display: flex;
    align-items: center;
    gap: var(--size-4-2, 8px);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dot-ok {
    background: var(--text-success);
  }
  .dot-warn {
    background: var(--text-warning);
  }
  .dot-err {
    background: var(--text-error);
  }
  .alias {
    font-weight: 600;
    font-size: 13px;
    line-height: 1.4;
    color: var(--text-normal);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .verb {
    font-weight: 400;
    font-size: 12px;
    line-height: 1.45;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
