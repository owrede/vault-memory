<!--
  Connectors panel — Phase 7 / 07-10 / PLG-05 / ADR-007 §D-CHROME-CONNECTORS.

  Pattern F: thin Svelte view delegating to `connectors-controller.ts`
  for unit-testability (see connectors-panel.test.ts).

  # What this renders

  - "Refresh" button + auto-load on mount
  - List of peer-MCP clients fetched via `set_mcp_client({list: true})`
    (the 07-04 inventory-read variant — NO direct config.toml access)
  - Per-row: name · command · args preview · env_secrets (key-list) ·
    [Test] [Remove] buttons; test result badge (green/red) inline
  - "Add connector" form with name + command + args + env_secrets
    (env_secret values support `${secret:name}` references chosen from
    a dropdown populated by SecretsStore.list())
  - Re-enter prompt banner when `${secret:name}` resolution surfaces a
    `safe_storage_unavailable` or `secret_not_found` reason (CONTEXT
    D-CHROME-SECRETS: no plugin-side plaintext-fallback path; user is
    routed to Settings → Secrets)

  # Color rules

  Test-connection badges use `var(--text-success)` / `var(--text-error)`
  per UI-SPEC §"Color" — NOT `--interactive-accent`.

  # MCP contracts

  Every state mutation goes through `set_mcp_client` (server owns
  ~/.vault-memory/config.toml). Secrets resolve via the plugin's
  safeStorage decrypt + the server's `resolve_secret` tool. There is
  NO direct config.toml read or write in this file.
-->

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    createConnectorsController,
    type ConnectorsController,
    type ConnectorsControllerDeps,
    type ConnectorsState,
  } from "./connectors-controller.js";
  import type { SecretsStore } from "../services/secrets-store.js";

  // Props passed by ChromeView. `secretsStore` powers the env-secret
  // dropdown helper (names only — ciphertext never touches the UI).
  let {
    mcpClient,
    secretsStore,
    safeStorage,
  }: {
    mcpClient: ConnectorsControllerDeps["mcpClient"];
    secretsStore: SecretsStore;
    safeStorage: ConnectorsControllerDeps["safeStorage"];
  } = $props();

  const controller: ConnectorsController = createConnectorsController({
    mcpClient,
    secretsStore: { getCiphertext: (n) => secretsStore.getCiphertext(n) },
    safeStorage,
  });

  let state: ConnectorsState = $state(controller.getState());
  const off = controller.subscribe((s) => {
    state = s;
  });
  onMount(() => {
    void controller.refresh();
  });
  onDestroy(off);

  // ---- "Add connector" form bindings ----------------------------------------
  let newName = $state("");
  let newCommand = $state("");
  let newArgsRaw = $state(""); // space-separated; parsed on submit
  // env_secrets are stored as a list of {key, value} so adding/removing rows
  // does not require object-key gymnastics. Value strings may carry
  // ${secret:name} placeholders.
  type EnvRow = { key: string; value: string };
  let envRows: EnvRow[] = $state([]);

  function addEnvRow(): void {
    envRows = [...envRows, { key: "", value: "" }];
  }
  function removeEnvRow(idx: number): void {
    envRows = envRows.filter((_, i) => i !== idx);
  }

  /**
   * Helper: insert `${secret:name}` into the row's value field. Bound
   * to a `<select>` in the env-row template — the user picks a stored
   * secret by name; the placeholder text is appended (or replaces the
   * current value if empty).
   */
  function insertSecretRef(idx: number, secretName: string): void {
    if (!secretName) return;
    const placeholder = `\${secret:${secretName}}`;
    const row = envRows[idx];
    if (!row) return;
    envRows = envRows.map((r, i) =>
      i === idx
        ? { ...r, value: r.value ? `${r.value}${placeholder}` : placeholder }
        : r,
    );
  }

  function parseArgs(raw: string): string[] {
    // Simple whitespace split — same trust scope as `serverCommand` in
    // settings (07-08). Quoted-string args are out of scope here.
    return raw
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  function envRowsToMap(rows: EnvRow[]): Record<string, string> {
    const m: Record<string, string> = {};
    for (const r of rows) {
      if (r.key) m[r.key] = r.value;
    }
    return m;
  }

  async function handleAdd(): Promise<void> {
    if (!newName || !newCommand) return;
    await controller.addConnector({
      name: newName,
      command: newCommand,
      args: parseArgs(newArgsRaw),
      envSecrets: envRowsToMap(envRows),
    });
    if (controller.getState().reEnterPrompt === null && !controller.getState().formError) {
      // Clear form on success only.
      newName = "";
      newCommand = "";
      newArgsRaw = "";
      envRows = [];
    }
  }

  async function handleRemove(name: string): Promise<void> {
    if (
      !window.confirm(
        `Remove peer-MCP connector "${name}"? Any agent calling it will fail until re-added.`,
      )
    ) {
      return;
    }
    await controller.removeConnector(name);
  }

  async function handleTest(name: string): Promise<void> {
    await controller.testConnector(name);
  }

  function handleDismissPrompt(): void {
    controller.dismissReEnterPrompt();
  }

  function argsPreview(args: readonly string[]): string {
    return args.length === 0 ? "—" : args.join(" ");
  }
</script>

<div class="vm-connectors-panel" data-testid="connectors-panel">
  <div class="vm-connectors-panel__header">
    <button
      type="button"
      class="vm-connectors-panel__refresh"
      disabled={state.loading}
      onclick={() => controller.refresh()}
      data-testid="connectors-refresh"
    >
      {state.loading ? "Loading…" : "Refresh"}
    </button>
  </div>

  {#if state.loadError}
    <div class="vm-connectors-panel__error" data-testid="connectors-load-error">
      Could not load connectors: {state.loadError}
    </div>
  {/if}

  {#if state.reEnterPrompt}
    <div
      class="vm-connectors-panel__reenter"
      role="alertdialog"
      data-testid="connectors-reenter-prompt"
    >
      {#if state.reEnterPrompt.reason === "secret_not_found"}
        <p>
          Secret "<strong>{state.reEnterPrompt.secretName}</strong>" was not
          found. Add it in <em>Settings → Secrets</em>, then retry.
        </p>
      {:else}
        <p>
          Secret "<strong>{state.reEnterPrompt.secretName}</strong>" could not
          be decrypted on this device — re-enter it in
          <em>Settings → Secrets</em>.
        </p>
      {/if}
      <button onclick={handleDismissPrompt}>Dismiss</button>
    </div>
  {/if}

  {#if state.entries.length === 0 && !state.loading}
    <div class="vm-connectors-panel__empty" data-testid="connectors-empty">
      No peer-MCP connectors configured. Use the form below to add one.
    </div>
  {:else}
    <div class="vm-connectors-panel__list" data-testid="connectors-list">
      {#each state.entries as entry (entry.name)}
        {@const r = state.testResults[entry.name]}
        <div
          class="vm-connectors-row"
          data-testid={`connector-row-${entry.name}`}
        >
          <div class="vm-connectors-row__head">
            <span class="vm-connectors-row__name">{entry.name}</span>
            {#if r !== undefined}
              <span
                class={r.ok
                  ? "vm-connectors-row__badge vm-connectors-row__badge--ok"
                  : "vm-connectors-row__badge vm-connectors-row__badge--fail"}
                data-testid={r.ok ? "test-badge-ok" : "test-badge-fail"}
                title={r.error ?? "Test passed"}
              >
                {r.ok ? "✓ ok" : "✗ fail"}
              </span>
            {/if}
          </div>
          <div class="vm-connectors-row__meta">
            <code class="vm-connectors-row__cmd">{entry.command}</code>
            <span class="vm-connectors-row__args">{argsPreview(entry.args)}</span>
          </div>
          {#if entry.env_secrets.length > 0}
            <div class="vm-connectors-row__secrets">
              env secrets:
              {#each entry.env_secrets as sn (sn)}
                <code>{sn}</code>
              {/each}
            </div>
          {/if}
          <div class="vm-connectors-row__actions">
            <button
              type="button"
              onclick={() => handleTest(entry.name)}
              data-testid={`connector-test-${entry.name}`}
            >
              Test
            </button>
            <button
              type="button"
              class="vm-connectors-row__remove"
              onclick={() => handleRemove(entry.name)}
              data-testid={`connector-remove-${entry.name}`}
            >
              Remove
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <form
    class="vm-connectors-panel__add"
    data-testid="connectors-add-form"
    onsubmit={(e) => {
      e.preventDefault();
      void handleAdd();
    }}
  >
    <h4>Add connector</h4>
    <label>
      Name
      <input
        type="text"
        placeholder="my-mcp"
        bind:value={newName}
        data-testid="connector-add-name"
      />
    </label>
    <label>
      Command
      <input
        type="text"
        placeholder="/usr/local/bin/my-mcp"
        bind:value={newCommand}
        data-testid="connector-add-command"
      />
    </label>
    <label>
      Args (space-separated)
      <input
        type="text"
        placeholder="--port 9099"
        bind:value={newArgsRaw}
        data-testid="connector-add-args"
      />
    </label>

    <fieldset class="vm-connectors-panel__env-rows">
      <legend>Environment secrets</legend>
      {#each envRows as row, idx (idx)}
        <div class="vm-connectors-panel__env-row" data-testid={`env-row-${idx}`}>
          <input
            type="text"
            placeholder="ENV_NAME"
            bind:value={row.key}
            data-testid={`env-row-key-${idx}`}
          />
          <input
            type="text"
            placeholder={"${secret:name} or literal"}
            bind:value={row.value}
            data-testid={`env-row-value-${idx}`}
          />
          <select
            data-testid={`env-row-secret-select-${idx}`}
            onchange={(e) => {
              const target = e.currentTarget as HTMLSelectElement;
              insertSecretRef(idx, target.value);
              target.value = "";
            }}
          >
            <option value="">Insert secret…</option>
            {#each secretsStore.list() as s (s.name)}
              <option value={s.name}>{s.name}</option>
            {/each}
          </select>
          <button
            type="button"
            onclick={() => removeEnvRow(idx)}
            data-testid={`env-row-remove-${idx}`}
          >
            ×
          </button>
        </div>
      {/each}
      <button
        type="button"
        onclick={addEnvRow}
        data-testid="env-row-add"
      >
        + add env secret
      </button>
    </fieldset>

    {#if state.formError}
      <div
        class="vm-connectors-panel__form-error"
        data-testid="connectors-form-error"
      >
        {state.formError}
      </div>
    {/if}

    <button
      type="submit"
      class="mod-cta"
      disabled={!newName || !newCommand}
      data-testid="connector-add-submit"
    >
      Add connector
    </button>
  </form>
</div>
