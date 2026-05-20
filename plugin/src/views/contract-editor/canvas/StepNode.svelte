<!--
  StepNode — visual contract step on the canvas (Slice B).

  Visual contract for each assembly step:
    - 4px coloured strip on the left edge — category hint from
      verb-catalog (matches the palette card border).
    - Header row: Lucide icon + plain-language title (e.g. "Read a note")
      with the canonical verb in a small monospace badge to the right.
    - Body: snake_case alias as the prominent line (this is what
      `{{alias.field}}` references downstream); one-line arg preview
      derived from step.args so users can read the graph at a glance
      without opening the inspector.
    - Status dot (top-right): ●/⚠/✕ — wired via data.status by canvas-pane
      validation pass (Slice C).
    - Left / right handles (Svelte Flow) for `{{ref}}` wiring.
    - NodeResizer enables user-driven resize when the node is selected.

  All colours resolve to Obsidian CSS variables. The category colour
  comes from a CSS custom property set by canvas-pane via the node's
  style attribute — so changing the verb on this node updates the strip
  reactively.
-->

<script lang="ts">
  import { Handle, Position, NodeResizer } from "@xyflow/svelte";
  import { onMount } from "svelte";
  import { setIcon } from "obsidian";
  import { lookupVerb, VERB_CATEGORY_META } from "../palette/verb-catalog.js";

  let {
    data,
    selected = false,
  }: {
    data: {
      alias: string;
      verb: string;
      args?: Record<string, unknown>;
      status?: "ok" | "warning" | "error";
    };
    selected?: boolean;
  } = $props();

  const meta = $derived(lookupVerb(data.verb));
  const categoryMeta = $derived(
    meta ? VERB_CATEGORY_META[meta.category] : VERB_CATEGORY_META["escape"],
  );

  /** Plain-language title; falls back to the raw verb if not catalogued. */
  const title = $derived(meta?.title ?? data.verb);

  /**
   * One-line preview of step.args. Compacts common shapes:
   *   - {{alias.field}} mustaches → `← alias`
   *   - "?" placeholders         → `(empty)`
   *   - long strings             → first 32 chars + ellipsis
   *   - objects / arrays         → `n items`
   * Empty / missing args → empty preview (so the node looks calm).
   */
  function argSummary(args: Record<string, unknown> | undefined): string {
    if (!args || Object.keys(args).length === 0) return "";
    const parts: string[] = [];
    for (const [key, value] of Object.entries(args)) {
      const compact = compactValue(value);
      parts.push(`${key}: ${compact}`);
      if (parts.join(", ").length > 48) break;
    }
    let s = parts.join(", ");
    if (s.length > 56) s = s.slice(0, 53) + "…";
    return s;
  }

  function compactValue(value: unknown): string {
    if (value === null) return "null";
    if (typeof value === "string") {
      // `{{alias.field}}` → display as `←alias` so the upstream link reads naturally.
      const m = value.match(/^\{\{\s*([a-z_][a-z0-9_]*)/i);
      if (m) return `←${m[1]}`;
      if (value === "?" || value.startsWith("?")) return "(empty)";
      return value.length > 24 ? `"${value.slice(0, 21)}…"` : `"${value}"`;
    }
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return `[${value.length}]`;
    if (typeof value === "object") return `{${Object.keys(value as object).length}}`;
    return String(value);
  }

  const argsPreview = $derived(argSummary(data.args));

  /**
   * Mount a Lucide icon into the element via Obsidian's setIcon.
   * Re-mounts on iconName change.
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

  // Forward-compat: status defaults to ok so existing contracts render
  // without explicit annotation. Slice C will populate this with the
  // result of an in-editor validation pass.
  const status = $derived(data.status ?? "ok");
</script>

<div
  class="vm-step-node"
  class:vm-selected={selected}
  class:vm-status-warning={status === "warning"}
  class:vm-status-error={status === "error"}
  style:--vm-cat-color="var({categoryMeta.colorVar})"
  data-verb={data.verb}
  data-category={categoryMeta.id}
>
  <NodeResizer
    minWidth={180}
    minHeight={90}
    isVisible={selected}
    lineClassName="vm-resize-line"
    handleClassName="vm-resize-handle"
  />
  <Handle type="target" position={Position.Left} />

  <header class="vm-step-node__header">
    <span class="vm-step-node__icon" use:lucideIcon={categoryMeta.icon} aria-hidden="true"></span>
    <span class="vm-step-node__title">{title}</span>
    <span class="vm-step-node__status vm-step-node__status--{status}" aria-label={status}></span>
  </header>

  <div class="vm-step-node__alias">{data.alias}</div>
  <div class="vm-step-node__verb">{data.verb}</div>

  {#if argsPreview}
    <div class="vm-step-node__args" title={argsPreview}>{argsPreview}</div>
  {/if}

  <Handle type="source" position={Position.Right} />
</div>

<style>
  .vm-step-node {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: var(--size-4-2) var(--size-4-3);
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-left: 4px solid var(--vm-cat-color, var(--text-muted));
    border-radius: var(--radius-m);
    color: var(--text-normal);
    font-family: var(--font-interface);
    font-size: var(--font-ui-small);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: var(--size-2-1);
    box-shadow: var(--shadow-s, 0 1px 2px rgba(0, 0, 0, 0.06));
    transition: border-color 80ms ease-out, box-shadow 80ms ease-out;
  }
  .vm-step-node:hover {
    box-shadow: var(--shadow-l, 0 2px 6px rgba(0, 0, 0, 0.1));
  }
  .vm-step-node.vm-selected {
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--interactive-accent) 30%, transparent);
  }
  .vm-step-node.vm-status-warning {
    border-color: var(--text-warning);
  }
  .vm-step-node.vm-status-error {
    border-color: var(--text-error);
  }

  /* Header */
  .vm-step-node__header {
    display: flex;
    align-items: center;
    gap: var(--size-2-2);
    min-width: 0;
  }
  .vm-step-node__icon {
    display: inline-flex;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    color: var(--vm-cat-color, var(--text-muted));
  }
  .vm-step-node__icon :global(svg) {
    width: 16px;
    height: 16px;
  }
  .vm-step-node__title {
    flex: 1;
    min-width: 0;
    font-weight: var(--font-medium);
    font-size: var(--font-ui-small);
    color: var(--text-normal);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
  }
  .vm-step-node__status {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .vm-step-node__status--ok {
    background: var(--text-success);
  }
  .vm-step-node__status--warning {
    background: var(--text-warning);
  }
  .vm-step-node__status--error {
    background: var(--text-error);
  }

  /* Alias — the snake_case identifier used by `{{alias.field}}` references. */
  .vm-step-node__alias {
    font-family: var(--font-monospace);
    font-size: var(--font-ui-medium);
    font-weight: var(--font-semibold);
    color: var(--text-normal);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Canonical verb name — small accent line. */
  .vm-step-node__verb {
    font-family: var(--font-monospace);
    font-size: var(--font-smaller);
    color: var(--text-accent);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Arg preview — what this step will run on. */
  .vm-step-node__args {
    margin-top: auto;
    font-family: var(--font-monospace);
    font-size: var(--font-smaller);
    color: var(--text-muted);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-top: 1px dashed var(--background-modifier-border);
    padding-top: var(--size-2-1);
  }

  /* NodeResizer styling — xyflow's default looks foreign. */
  :global(.vm-resize-line) {
    border-color: var(--interactive-accent);
  }
  :global(.vm-resize-handle) {
    background: var(--interactive-accent);
    border: 2px solid var(--background-primary);
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
</style>
