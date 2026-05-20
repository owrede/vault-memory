<script lang="ts">
  /**
   * ContractsPanel — first section of the side panel ChromeView.
   *
   * Lists every .contract and _contracts/*.yaml file in the active vault.
   * Click on a row opens it in ContractEditorView (the existing canvas
   * editor registered against the .contract extension).
   *
   * The user's complaint that drove this: opening the side panel showed
   * only Operations/Stats/Connectors (admin-y stuff). They expected the
   * side panel to surface the agentic-contract management workflow,
   * which is the actual product. This panel fixes that.
   *
   * Data source: scan TFiles via the Obsidian Vault API. We don't go
   * through MCP for this — the file list is local and trivially derived
   * from the open vault. Refresh on `vault.on('create' | 'delete' | 'rename')`.
   */
  import { onDestroy, onMount } from "svelte";
  import type { App, TAbstractFile, TFile } from "obsidian";

  let {
    app,
    onOpenContract,
  }: {
    app: App;
    onOpenContract: (path: string) => Promise<void> | void;
  } = $props();

  type Row = {
    path: string;
    name: string;
    kind: "contract" | "yaml";
    /** Mtime in ms for the "(recent)" sort. */
    mtime: number;
  };

  let rows: Row[] = $state([]);
  let loadError: string | null = $state(null);

  function isContractFile(file: TAbstractFile): boolean {
    if (!("extension" in file)) return false;
    const f = file as TFile;
    if (f.extension === "contract") return true;
    // Treat _contracts/<name>.yaml as a contract entry.
    if (f.extension === "yaml" || f.extension === "yml") {
      return f.path.includes("_contracts/");
    }
    return false;
  }

  function classify(file: TFile): "contract" | "yaml" {
    return file.extension === "contract" ? "contract" : "yaml";
  }

  function refresh(): void {
    try {
      const all = app.vault.getFiles();
      rows = all
        .filter(isContractFile)
        .map((f) => ({
          path: f.path,
          name: f.basename,
          kind: classify(f),
          mtime: f.stat.mtime,
        }))
        .sort((a, b) => b.mtime - a.mtime);
      loadError = null;
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  // Hook into the vault's create/delete/rename events so the list stays
  // fresh while the panel is open. The handlers are detached on destroy.
  const handlers: Array<{ event: string; ref: unknown }> = [];

  onMount(() => {
    refresh();
    for (const event of ["create", "delete", "rename", "modify"] as const) {
      // Cast through unknown because Obsidian's typed event signatures
      // vary per event; we only need to know the file changed.
      const ref = app.vault.on(event as "create", () => refresh());
      handlers.push({ event, ref });
    }
  });

  onDestroy(() => {
    for (const { ref } of handlers) {
      try {
        app.vault.offref(ref as never);
      } catch {
        // Best-effort
      }
    }
  });

  async function open(path: string): Promise<void> {
    try {
      await onOpenContract(path);
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<div class="vm-contracts-panel">
  {#if loadError}
    <div class="vm-contracts-panel__error">
      Could not list contracts: {loadError}
    </div>
  {:else if rows.length === 0}
    <div class="vm-contracts-panel__empty">
      <p>No contracts in this vault yet.</p>
      <p>
        Contracts are reusable agent workflows. Create a new <code>.contract</code>
        file anywhere, or run <code>/vmem:install</code> to drop example
        contracts into <code>_contracts/examples/</code>.
      </p>
    </div>
  {:else}
    <ul class="vm-contracts-panel__list">
      {#each rows as row (row.path)}
        <li class="vm-contracts-panel__row">
          <button
            type="button"
            class="vm-contracts-panel__open"
            onclick={() => open(row.path)}
            title={row.path}
          >
            <span class="vm-contracts-panel__name">{row.name}</span>
            <span class="vm-contracts-panel__kind">{row.kind === "contract" ? ".contract" : ".yaml"}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .vm-contracts-panel {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2);
  }
  .vm-contracts-panel__empty {
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    line-height: 1.5;
  }
  .vm-contracts-panel__empty code {
    font-family: var(--font-monospace);
    font-size: 0.95em;
  }
  .vm-contracts-panel__error {
    color: var(--text-error);
    font-size: var(--font-ui-smaller);
  }
  .vm-contracts-panel__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--size-2-1);
  }
  .vm-contracts-panel__open {
    width: 100%;
    text-align: left;
    background: none;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    padding: var(--size-2-2) var(--size-4-1);
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--size-4-1);
  }
  .vm-contracts-panel__open:hover {
    background: var(--background-modifier-hover);
  }
  .vm-contracts-panel__name {
    font-weight: var(--font-medium);
    color: var(--text-normal);
  }
  .vm-contracts-panel__kind {
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    font-family: var(--font-monospace);
  }
</style>
