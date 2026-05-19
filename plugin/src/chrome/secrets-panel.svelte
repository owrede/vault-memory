<!--
  Secrets panel — list + add + delete UI for PLG-02.

  Phase 7 / 07-08 / D-CHROME-SECRETS.

  Presentation-only: every state mutation goes through `SecretsPanelController`
  so the panel is testable without spinning up a Svelte compiler in vitest
  (07-08-PLAN.md Task 3 §test cases — the test file targets the controller).

  Layout (UI-SPEC §"Tone & Copy" L138–140):
    - basic_text warning banner (Linux fallback, only when applicable)
    - rows of `{name} · {createdAt} · [delete]`
    - empty-state copy when no secrets stored
    - add form (name + value + add button)
    - confirm modal for Linux basic_text fallback (in-flow div; the
      settings tab's containing context provides modal styling — keeping
      Obsidian's `Modal` class for the destructive delete confirm only,
      since the consent flow can be inline without a full modal).
-->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    SecretsPanelController,
    type SecretsPanelView,
    type SecretsPanelProps,
  } from "./secrets-panel-controller.js";

  // Svelte 5 runes-style props. The `store` and `safeStorage` are passed
  // by reference from the settings tab and never change during the
  // component's lifetime, so capturing them once at controller
  // construction is intentional (the `state_referenced_locally` warning
  // emitted by esbuild-svelte is informational).
  const props: SecretsPanelProps = $props();
  const controller = new SecretsPanelController({
    store: props.store,
    safeStorage: props.safeStorage,
  });

  let view = $state<SecretsPanelView>(controller.snapshot());
  let newName = $state("");
  let newValue = $state("");
  let unsubscribe: (() => void) | null = null;

  onMount(() => {
    unsubscribe = controller.subscribe((next) => {
      view = next;
    });
  });

  onDestroy(() => {
    unsubscribe?.();
  });

  async function handleAdd() {
    if (!newName || !newValue) return;
    await controller.addSecret(newName, newValue);
    if (controller.snapshot().pendingConsent === null) {
      // No consent gate triggered → clear inputs immediately.
      newName = "";
      newValue = "";
    }
  }

  async function handleConfirmBasicText() {
    await controller.confirmBasicText();
    newName = "";
    newValue = "";
  }

  function handleCancelBasicText() {
    controller.cancelBasicText();
  }

  async function handleDelete(name: string) {
    if (
      !window.confirm(
        `Delete secret "${name}"? Connectors referencing this secret will fail until re-added.`,
      )
    ) {
      return;
    }
    await controller.deleteSecret(name);
  }
</script>

<div class="vm-secrets-panel" data-testid="secrets-panel">
  {#if view.showBasicTextWarning}
    <div class="vm-secrets-backend-warning" data-testid="basic-text-warning">
      On this Linux session, Electron cannot reach an OS keyring
      (libsecret/kwallet). Secrets will be stored in cleartext fallback.
      Install <code>gnome-libsecret</code> or <code>kwallet</code> for
      encrypted storage.
    </div>
  {/if}

  {#if view.entries.length === 0}
    <div class="vm-secrets-empty" data-testid="secrets-empty">
      <strong>No secrets stored</strong>
      <p>
        Secrets are encrypted with your operating system's keychain. They are
        local to this device — secrets you add here will not work on another
        machine until you re-enter them.
      </p>
    </div>
  {:else}
    <div class="vm-secrets-list" data-testid="secrets-list">
      {#each view.entries as entry (entry.name)}
        <div class="vm-secrets-row" data-testid={`secret-row-${entry.name}`}>
          <span class="vm-secrets-name">{entry.name}</span>
          <span class="vm-secrets-date">
            {new Date(entry.createdAt).toISOString().slice(0, 10)}
          </span>
          <button
            class="vm-secrets-delete"
            onclick={() => handleDelete(entry.name)}
            data-testid={`secret-delete-${entry.name}`}
          >
            Delete
          </button>
        </div>
      {/each}
    </div>
  {/if}

  {#if view.pendingConsent}
    <div
      class="vm-secrets-backend-warning"
      data-testid="basic-text-consent"
      role="alertdialog"
    >
      <p>
        <strong>Linux keyring not available.</strong>
        Store secret "{view.pendingConsent.name}" in cleartext fallback?
      </p>
      <button onclick={handleConfirmBasicText}>Store anyway</button>
      <button onclick={handleCancelBasicText}>Cancel</button>
    </div>
  {/if}

  {#if view.lastError}
    <div class="vm-secrets-backend-warning" data-testid="secrets-error">
      {view.lastError}
    </div>
  {/if}

  <div class="vm-secrets-add" data-testid="secrets-add">
    <input
      type="text"
      placeholder="Name (kebab-case)"
      bind:value={newName}
      data-testid="secret-name-input"
    />
    <input
      type="password"
      placeholder="Value"
      bind:value={newValue}
      data-testid="secret-value-input"
    />
    <button
      onclick={handleAdd}
      disabled={!newName || !newValue}
      data-testid="secret-add-button"
    >
      Add secret
    </button>
  </div>
</div>
