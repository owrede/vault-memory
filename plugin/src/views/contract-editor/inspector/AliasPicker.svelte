<!--
  AliasPicker — typeahead widget for `{{alias.field}}` references.

  Phase 7 / Plan 07-05 / D-FORMAT-SCHEMA / UI-SPEC §"Reference picker".

  Inputs:
    - `value: string`          — current field value (may already be a
                                  `{{alias.field}}` token or free text).
    - `aliases: readonly string[]` — in-scope alias names (earlier
                                       steps' `as` values, from the
                                       inspector's scope computation).
    - `onChange(next: string)` — emit on every keystroke.

  Behavior:
    - Plain mono `<input>` shows the current value.
    - When the user types `{{` an inline dropdown lists `aliases`.
    - Selecting an alias inserts `{{alias}}` (no field suffix in v2.0.0
      because the verb's output-shape introspection lives in plan 07-06+).
    - Picker button `[…]` opens the same list as a popover.
-->

<script lang="ts">
  let {
    value,
    aliases,
    onChange,
  }: {
    value: string;
    aliases: readonly string[];
    onChange: (next: string) => void;
  } = $props();

  let pickerOpen = $state(false);

  function showSuggestions(): boolean {
    return value.includes("{{") && !value.match(/\{\{\s*[a-z_][a-z0-9_]*\s*\}\}/);
  }

  function selectAlias(alias: string): void {
    // Replace the trailing `{{` (and any partial alias being typed)
    // with the chosen full reference.
    const next = value.replace(/\{\{[a-z0-9_]*$/i, `{{${alias}}}`);
    onChange(next);
    pickerOpen = false;
  }

  function openPicker(): void {
    pickerOpen = !pickerOpen;
  }
</script>

<div class="vm-alias-picker">
  <input
    type="text"
    class="vm-alias-input"
    {value}
    placeholder="{{alias.field}}"
    oninput={(e) => onChange((e.target as HTMLInputElement).value)}
  />
  <button
    type="button"
    class="vm-alias-button"
    aria-label="Pick alias"
    onclick={openPicker}
  >
    …
  </button>
  {#if pickerOpen || showSuggestions()}
    <ul class="vm-alias-suggestions" role="listbox">
      {#if aliases.length === 0}
        <li class="vm-alias-empty">No in-scope aliases yet</li>
      {/if}
      {#each aliases as alias (alias)}
        <li>
          <button
            type="button"
            class="vm-alias-option"
            onclick={() => selectAlias(alias)}
          >
            {alias}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .vm-alias-picker {
    position: relative;
    display: flex;
    gap: var(--size-4-1, 4px);
    align-items: stretch;
  }
  .vm-alias-input {
    flex: 1;
    font-family: var(--font-monospace);
    font-size: 13px;
    padding: var(--size-4-2, 8px);
    background: var(--background-primary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
  }
  .vm-alias-button {
    padding: 0 var(--size-4-2, 8px);
    background: var(--background-secondary);
    color: var(--text-muted);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    cursor: pointer;
  }
  .vm-alias-button:hover {
    background: var(--background-modifier-hover);
  }
  .vm-alias-suggestions {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    list-style: none;
    margin: var(--size-4-1, 4px) 0 0 0;
    padding: var(--size-4-1, 4px) 0;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    z-index: 10;
  }
  .vm-alias-option {
    width: 100%;
    text-align: left;
    padding: var(--size-4-2, 8px) var(--size-4-3, 12px);
    background: transparent;
    border: none;
    color: var(--text-normal);
    font-family: var(--font-monospace);
    font-size: 13px;
    cursor: pointer;
  }
  .vm-alias-option:hover {
    background: var(--background-modifier-hover);
  }
  .vm-alias-empty {
    padding: var(--size-4-2, 8px) var(--size-4-3, 12px);
    color: var(--text-muted);
    font-size: 13px;
    font-style: italic;
  }
</style>
