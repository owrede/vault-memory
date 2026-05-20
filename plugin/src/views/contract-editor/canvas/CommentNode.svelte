<!--
  CommentNode — borderless free-text annotation on the canvas (Slice B).

  Purpose: let users drop "post-it" style notes anywhere on the canvas
  to explain WHAT the contract does and WHY certain steps are wired the
  way they are. Comment nodes are NOT part of the contract semantics —
  they live entirely in `editor.nodes[]` with `kind: "comment"` and
  `text: "..."` fields (passthrough fields on NodePositionSchema).

  Visual contract:
    - No border (transparent background); muted text colour so the
      comment doesn't compete with the actual step nodes for attention.
    - Italic to signal "this is a remark, not a contract step".
    - Single-click → select (selected outline appears so the user knows
      they can drag / delete it).
    - Double-click → enter edit mode; <textarea> replaces the text and
      auto-focuses.
    - Blur or Esc → commit and exit edit mode.
    - NO handles — comments don't participate in the flow graph.

  Persistence: text is stored on the editor.nodes entry as
  `text: string`. canvas-pane reads it from data.text and writes it back
  through onChange.
-->

<script lang="ts">
  import { NodeResizer } from "@xyflow/svelte";

  let {
    data,
    selected = false,
  }: {
    data: {
      text: string;
      /**
       * Called by the canvas wrapper when the user edits the comment text.
       * canvas-pane wires this through onChange so the change persists.
       */
      onTextChange?: (next: string) => void;
    };
    selected?: boolean;
  } = $props();

  let editing = $state(false);
  let draft = $state(data.text);
  let textareaEl: HTMLTextAreaElement | null = $state(null);

  // Re-sync the draft when the upstream text changes (e.g. external
  // edit via the YAML companion) and we're not currently editing.
  $effect(() => {
    if (!editing) draft = data.text;
  });

  function enterEdit(event: MouseEvent): void {
    event.stopPropagation();
    editing = true;
    // Focus the textarea on the next tick — Svelte's bind:this hasn't
    // resolved yet at the dispatch time of the dblclick event.
    queueMicrotask(() => {
      textareaEl?.focus();
      textareaEl?.select();
    });
  }

  function commit(): void {
    editing = false;
    const next = draft.trim();
    if (next === data.text) return;
    data.onTextChange?.(next);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      draft = data.text; // discard
      editing = false;
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      commit();
    }
  }
</script>

<div
  class="vm-comment-node"
  class:vm-selected={selected}
  class:vm-editing={editing}
  ondblclick={enterEdit}
  role="note"
>
  <NodeResizer
    minWidth={120}
    minHeight={40}
    isVisible={selected}
    lineClassName="vm-resize-line"
    handleClassName="vm-resize-handle"
  />
  {#if editing}
    <textarea
      class="vm-comment-node__edit"
      bind:value={draft}
      bind:this={textareaEl}
      onblur={commit}
      onkeydown={onKeyDown}
      placeholder="Write a comment… (⌘↵ or click outside to save, Esc to cancel)"
    ></textarea>
  {:else}
    <div class="vm-comment-node__text">
      {#if data.text.length === 0}
        <span class="vm-comment-node__placeholder">Double-click to edit</span>
      {:else}
        {data.text}
      {/if}
    </div>
  {/if}
</div>

<style>
  .vm-comment-node {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: var(--size-2-2) var(--size-2-3);
    background: transparent;
    border: 1px dashed transparent;
    border-radius: var(--radius-s);
    color: var(--text-muted);
    font-family: var(--font-interface);
    font-size: var(--font-ui-small);
    font-style: italic;
    line-height: 1.45;
    cursor: pointer;
    /* Show a faint background only on hover so the comment is calm at rest. */
    transition: background 120ms ease-out, border-color 120ms ease-out;
  }
  .vm-comment-node:hover {
    background: color-mix(in srgb, var(--background-modifier-hover) 50%, transparent);
    border-color: var(--background-modifier-border);
  }
  .vm-comment-node.vm-selected {
    background: color-mix(in srgb, var(--interactive-accent) 8%, transparent);
    border-color: var(--interactive-accent);
    border-style: solid;
  }
  .vm-comment-node.vm-editing {
    cursor: text;
    border-color: var(--interactive-accent);
    border-style: solid;
    background: var(--background-primary);
    color: var(--text-normal);
    font-style: normal;
  }
  .vm-comment-node__text {
    width: 100%;
    height: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    /* Allow soft wrap; keep up to ~6 lines visible inside the node. */
    display: -webkit-box;
    -webkit-line-clamp: 6;
    line-clamp: 6;
    -webkit-box-orient: vertical;
  }
  .vm-comment-node__placeholder {
    color: var(--text-faint);
  }
  .vm-comment-node__edit {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    border: none;
    outline: none;
    resize: none;
    background: transparent;
    color: var(--text-normal);
    font: inherit;
    font-style: normal;
    padding: 0;
  }
</style>
