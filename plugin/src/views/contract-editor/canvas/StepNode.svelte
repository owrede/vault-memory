<!--
  StepNode — visual contract step on the canvas.

  Visual contract for each assembly step:
    - 4px coloured strip on the left edge + 1px full coloured border
      (category hint from verb-catalog).
    - Header row: Lucide icon + plain-language title (e.g. "Read a note")
      + status dot on the right.
    - Step name line: the user-given step name (alias), shown bolder
      because this is what the user reads and references.
    - Plain-language description line: translates the step's intent
      using the upstream connections + literal inputs into a single
      readable sentence ("← uses results from find_meetings"). The raw
      action key (verb) is demoted to a small monospace tag.
    - Larger, hover-pulsing connection handles on left + right edges.
    - NodeResizer enables user-driven resize when the node is selected.

  All colours resolve to Obsidian CSS variables. The category colour
  comes from a CSS custom property set by canvas-pane via the node's
  style attribute — so changing the action on this node updates the
  strip reactively.
-->

<script lang="ts">
  import { Handle, NodeResizer, Position } from "@xyflow/svelte";
  import { setIcon } from "obsidian";
  import {
    lookupVerb,
    VERB_CATEGORY_META,
    verbAcceptedInputs,
  } from "../palette/verb-catalog.js";

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

  /** Plain-language title; falls back to the raw action name if not catalogued. */
  const title = $derived(meta?.title ?? data.verb);

  /**
   * Build a plain-language description line for the card.
   *
   * Rules:
   *   - Skip internal `__ref_*` keys (canvas bookkeeping).
   *   - If every required input comes from an upstream step (mustache
   *     reference), show "← uses results from <names>".
   *   - If some inputs are literal values, show "← from <upstream>;
   *     <key>: <value>".
   *   - If the step has no inputs at all (or all inputs unfilled),
   *     show "needs setup" so the user knows to click in.
   */
  function describeStep(args: Record<string, unknown> | undefined): {
    text: string;
    needsSetup: boolean;
  } {
    if (!args || Object.keys(args).length === 0) {
      return { text: "no inputs yet", needsSetup: false };
    }

    const upstreamNames = new Set<string>();
    const literals: Array<{ key: string; value: string }> = [];
    let unfilled = 0;
    let totalUserKeys = 0;

    for (const [key, value] of Object.entries(args)) {
      // Skip internal canvas bookkeeping keys.
      if (key.startsWith("__")) {
        // But still extract the upstream name if present.
        if (typeof value === "string") {
          const m = value.match(/\{\{\s*([a-z_][a-z0-9_]*)/i);
          if (m && m[1]) upstreamNames.add(m[1]);
        }
        continue;
      }
      totalUserKeys += 1;

      if (typeof value === "string") {
        // Mustache reference → upstream step.
        const m = value.match(/\{\{\s*([a-z_][a-z0-9_]*)/i);
        if (m && m[1]) {
          upstreamNames.add(m[1]);
          continue;
        }
        // Empty / "?" placeholder → unfilled.
        if (value === "" || value === "?" || value.startsWith("?")) {
          unfilled += 1;
          continue;
        }
        literals.push({ key, value: compactValue(value) });
      } else if (value === null || value === undefined) {
        unfilled += 1;
      } else {
        literals.push({ key, value: compactValue(value) });
      }
    }

    if (totalUserKeys === 0 && upstreamNames.size === 0) {
      return { text: "needs setup", needsSetup: true };
    }
    if (totalUserKeys > 0 && unfilled === totalUserKeys && upstreamNames.size === 0) {
      return { text: "needs setup", needsSetup: true };
    }

    const upstream = Array.from(upstreamNames);
    if (upstream.length > 0 && literals.length === 0) {
      const list = upstream.slice(0, 3).join(", ");
      const more = upstream.length > 3 ? "…" : "";
      return { text: `← uses results from ${list}${more}`, needsSetup: false };
    }
    if (upstream.length > 0 && literals.length > 0) {
      const lit = literals[0];
      const litStr = lit ? `; ${lit.key}: ${lit.value}` : "";
      return { text: `← from ${upstream[0]}${litStr}`, needsSetup: false };
    }
    // Pure literals.
    const first = literals[0];
    if (!first) {
      return { text: "needs setup", needsSetup: true };
    }
    let s = `${first.key}: ${first.value}`;
    if (literals.length > 1) s += ` · +${literals.length - 1} more`;
    return { text: s, needsSetup: false };
  }

  function compactValue(value: unknown): string {
    if (value === null) return "—";
    if (typeof value === "string") {
      if (value.length > 28) return `"${value.slice(0, 25)}…"`;
      return `"${value}"`;
    }
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return value.length === 0 ? "empty list" : `${value.length} items`;
    if (typeof value === "object") return `${Object.keys(value as object).length} fields`;
    return String(value);
  }

  const summary = $derived(describeStep(data.args));

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
  // without explicit annotation. Validation pass populates this.
  const status = $derived(data.status ?? "ok");

  // Connection-compatibility data-attributes. Canvas-pane scopes the
  // "hide incompatible handles during drag" CSS rules against these.
  const outputType = $derived(meta?.outputType ?? "any");
  const acceptedInputs = $derived(
    meta ? Array.from(verbAcceptedInputs(meta)).join(" ") : "any",
  );
</script>

<div
  class="vm-step-node"
  class:vm-selected={selected}
  class:vm-status-warning={status === "warning"}
  class:vm-status-error={status === "error"}
  style:--vm-cat-color="var({categoryMeta.colorVar})"
  data-verb={data.verb}
  data-category={categoryMeta.id}
  data-output-type={outputType}
  data-accepted-inputs={acceptedInputs}
  data-alias={data.alias}
>
  <NodeResizer
    minWidth={240}
    minHeight={96}
    isVisible={selected}
    lineClassName="vm-resize-line"
    handleClassName="vm-resize-handle"
  />
  <!-- data-output-type / data-accepted-inputs let canvas-level CSS gate
       handle visibility during drag (xyflow toggles
       .svelte-flow__handle.connecting on the in-flight handle; the rest
       can be matched via attribute selectors on the host node). -->
  <Handle
    type="target"
    position={Position.Left}
    class="vm-step-node__handle vm-step-node__handle--target"
    aria-label="Receive a result here"
  />

  <header class="vm-step-node__header">
    <span class="vm-step-node__icon" use:lucideIcon={categoryMeta.icon} aria-hidden="true"></span>
    <span class="vm-step-node__title">{title}</span>
    <span class="vm-step-node__status vm-step-node__status--{status}" aria-label={status}></span>
  </header>

  <div
    class="vm-step-node__alias"
    class:vm-step-node__alias--default={/^step\d+$/.test(data.alias)}
    title="Step name: {data.alias}"
  >
    {data.alias}
  </div>

  <div
    class="vm-step-node__summary"
    class:vm-step-node__summary--warn={summary.needsSetup}
    title={summary.text}
  >
    {summary.text}
  </div>

  <span class="vm-step-node__verb-tag" title="Action: {data.verb}">{data.verb}</span>

  <Handle
    type="source"
    position={Position.Right}
    class="vm-step-node__handle vm-step-node__handle--source"
    aria-label="Send this step's result somewhere"
  />
</div>

<style>
  .vm-step-node {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: var(--size-4-2) var(--size-4-3);
    padding-bottom: calc(var(--size-4-3) + 4px);
    background: var(--background-primary);
    /* Border = 25% category colour mixed with the canvas background.
       The 4px left edge stays at full saturation so the category cue is
       readable at small zooms. color-mix beats rgba/opacity here because
       it produces an actual solid colour (no see-through edges crossing
       other nodes) and adapts to both light + dark themes naturally. */
    border: 1px solid
      color-mix(in srgb, var(--vm-cat-color, var(--background-modifier-border)) 25%, var(--background-primary));
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
    position: relative;
  }
  .vm-step-node:hover {
    box-shadow: var(--shadow-l, 0 2px 6px rgba(0, 0, 0, 0.1));
  }
  .vm-step-node.vm-selected {
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--interactive-accent) 35%, transparent),
      0 0 12px color-mix(in srgb, var(--interactive-accent) 25%, transparent);
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

  /* Step name — the user-given identifier this step is referenced by. */
  .vm-step-node__alias {
    font-family: var(--font-interface);
    font-size: var(--font-ui-medium);
    font-weight: var(--font-semibold);
    color: var(--text-normal);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Muted when the step still has the default placeholder name. */
  .vm-step-node__alias--default {
    color: var(--text-muted);
    font-weight: var(--font-medium);
    font-style: italic;
  }

  /* Plain-language description of what this step will do. */
  .vm-step-node__summary {
    margin-top: auto;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    padding-top: var(--size-2-1);
  }
  .vm-step-node__summary--warn {
    color: var(--text-warning);
    font-weight: var(--font-medium);
  }

  /* Small monospace tag in the bottom-right showing the canonical
     action name. Faint by default; only there for advanced users who
     need to know the underlying tool. */
  .vm-step-node__verb-tag {
    position: absolute;
    right: var(--size-4-2);
    bottom: 2px;
    font-family: var(--font-monospace);
    font-size: 9px;
    color: var(--text-faint);
    pointer-events: none;
    user-select: none;
    letter-spacing: 0;
    line-height: 1;
  }

  /* Connection handles — large, hover-pulse, crosshair cursor.
     xyflow ships its own .svelte-flow__handle styles; we override
     using the class we passed through the Handle prop. */
  :global(.vm-step-node__handle.svelte-flow__handle) {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--vm-cat-color, var(--text-muted));
    border: 2px solid var(--background-primary);
    box-shadow: 0 0 0 1px var(--background-modifier-border);
    cursor: crosshair;
    transition: transform 120ms ease-out, box-shadow 120ms ease-out;
  }
  /* Hover-grow MUST preserve xyflow's translate(±50%, -50%) — that's
     what centers the handle on the node edge. A bare `transform: scale(...)`
     overwrites the translate and the handle drifts inward + down. We
     compose translate THEN scale, keyed per side. */
  :global(.vm-step-node:hover .vm-step-node__handle.svelte-flow__handle-left) {
    transform: translate(-50%, -50%) scale(1.15);
  }
  :global(.vm-step-node:hover .vm-step-node__handle.svelte-flow__handle-right) {
    transform: translate(50%, -50%) scale(1.15);
  }
  :global(.vm-step-node:hover .vm-step-node__handle.svelte-flow__handle) {
    box-shadow: 0 0 0 1px var(--background-modifier-border),
      0 0 0 4px color-mix(in srgb, var(--vm-cat-color, var(--interactive-accent)) 25%, transparent);
  }
  :global(.vm-step-node__handle.svelte-flow__handle-left:hover) {
    transform: translate(-50%, -50%) scale(1.3);
  }
  :global(.vm-step-node__handle.svelte-flow__handle-right:hover) {
    transform: translate(50%, -50%) scale(1.3);
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
