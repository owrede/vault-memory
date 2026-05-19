<!--
  StepNode — custom Svelte Flow node for the contract editor spike.
  Renders the step's `as` alias (mono semibold) + verb name (mono regular)
  with a single input handle (left) and output handle (right), styled
  using Obsidian CSS variables per UI-SPEC §"Design System".

  Plan 07-01 ships the minimum surface — status dots, validation borders,
  and the full inspector wiring land in plan 07-03.
-->

<script lang="ts">
  import { Handle, Position } from "@xyflow/svelte";

  let { data }: { data: { alias: string; verb: string } } = $props();
</script>

<div class="vm-step-node" data-verb={data.verb}>
  <Handle type="target" position={Position.Left} />
  <div class="alias">{data.alias}</div>
  <div class="verb">{data.verb}</div>
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .vm-step-node {
    width: 220px;
    height: 120px;
    box-sizing: border-box;
    padding: 12px 16px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    color: var(--text-normal);
    font-family: var(--font-monospace);
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
  }
  .alias {
    font-weight: 600;
    font-size: 13px;
  }
  .verb {
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
