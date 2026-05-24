<script lang="ts">
  /**
   * ContractsPanel — first section of the side panel ChromeView.
   *
   * Lists every .contract and _contracts/*.yaml file in the active vault.
   * Each row surfaces three pieces of contract metadata parsed from the
   * file body: the first assembly verb, the source handle, and the sink
   * handle. Click on a row opens the file in the appropriate view
   * (ContractEditorView for .contract; the OS file opener / text view
   * for .yaml — though for .yaml we suggest using the example .contract
   * files that ship with the plugin).
   *
   * Includes a "New contract" button that creates an untitled.contract
   * file with a minimal valid scaffold and opens it in the canvas editor.
   *
   * Data source: scan TFiles via Obsidian's Vault API. Metadata is
   * extracted by reading the first ~2 KB of each file (cheap), then
   * doing a regex-based extraction of the YAML/JSON keys we surface.
   * We deliberately do NOT run the full contract validator here — the
   * side-panel display is informational and tolerant of malformed files;
   * the canvas editor handles validation when the file is opened.
   */
  import { onDestroy, onMount } from "svelte";
  import type { App, TAbstractFile, TFile } from "obsidian";

  let {
    app,
    onOpenContract,
    onCreateContract,
  }: {
    app: App;
    onOpenContract: (path: string) => Promise<void> | void;
    onCreateContract: () => Promise<void> | void;
  } = $props();

  type Row = {
    path: string;
    name: string;
    kind: "contract" | "yaml";
    /** Mtime in ms for the "(recent)" sort. */
    mtime: number;
    /** Number of assembly steps (null = couldn't parse). */
    steps: number | null;
    /** Name of the first verb in the assembly (null = couldn't parse). */
    firstVerb: string | null;
    /** Source handle string (null = couldn't parse / missing). */
    source: string | null;
    /** Sink handle string (null = couldn't parse / missing). */
    sink: string | null;
  };

  let rows: Row[] = $state([]);
  let loadError: string | null = $state(null);
  let creating: boolean = $state(false);

  function isContractFile(file: TAbstractFile): boolean {
    if (!("extension" in file)) return false;
    const f = file as TFile;
    if (f.extension === "contract") return true;
    if (f.extension === "yaml" || f.extension === "yml") {
      return f.path.includes("_contracts/");
    }
    return false;
  }

  function classify(file: TFile): "contract" | "yaml" {
    return file.extension === "contract" ? "contract" : "yaml";
  }

  /**
   * Best-effort metadata extraction. Reads the file's text content and
   * pulls out:
   *   - assembly[].verb count + first verb (regex on `- verb:` lines for
   *     YAML, walk the JSON envelope for .contract)
   *   - top-level `source:` field
   *   - top-level `sink:` field
   *
   * Returns nulls for anything we can't determine — safe and informative.
   */
  async function extractMetadata(file: TFile): Promise<Pick<Row, "steps" | "firstVerb" | "source" | "sink">> {
    const empty = { steps: null, firstVerb: null, source: null, sink: null };
    try {
      const text = await app.vault.cachedRead(file);
      if (file.extension === "contract") {
        try {
          const env = JSON.parse(text);
          const contract = env?.contract;
          if (!contract) return empty;
          const assembly = Array.isArray(contract.assembly) ? contract.assembly : [];
          const firstStep = assembly[0];
          return {
            steps: assembly.length,
            firstVerb: typeof firstStep?.verb === "string" ? firstStep.verb : null,
            source: typeof contract.source === "string" ? contract.source : null,
            sink: typeof contract.sink === "string" ? contract.sink : null,
          };
        } catch {
          return empty;
        }
      }
      // YAML: regex-based extraction. Tolerant of indentation/quoting variants.
      const verbMatches = Array.from(text.matchAll(/^\s*-\s*verb:\s*(\S+)/gm));
      const steps = verbMatches.length > 0 ? verbMatches.length : null;
      const firstVerb = verbMatches[0] ? verbMatches[0]![1] ?? null : null;
      const sourceMatch = text.match(/^source:\s*"?([^"\n]+)"?\s*$/m);
      const sinkMatch = text.match(/^sink:\s*"?([^"\n]+)"?\s*$/m);
      return {
        steps,
        firstVerb,
        source: sourceMatch ? sourceMatch[1]!.trim() : null,
        sink: sinkMatch ? sinkMatch[1]!.trim() : null,
      };
    } catch {
      return empty;
    }
  }

  async function refresh(): Promise<void> {
    try {
      const all = app.vault.getFiles();
      const contracts = all.filter(isContractFile);
      const newRows: Row[] = [];
      for (const f of contracts) {
        const meta = await extractMetadata(f);
        newRows.push({
          path: f.path,
          name: f.basename,
          kind: classify(f),
          mtime: f.stat.mtime,
          ...meta,
        });
      }
      newRows.sort((a, b) => b.mtime - a.mtime);
      rows = newRows;
      loadError = null;
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  const handlers: Array<{ event: string; ref: unknown }> = [];

  onMount(() => {
    void refresh();
    for (const event of ["create", "delete", "rename", "modify"] as const) {
      const ref = app.vault.on(event as "create", () => void refresh());
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

  async function newContract(): Promise<void> {
    if (creating) return;
    creating = true;
    try {
      await onCreateContract();
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    } finally {
      creating = false;
    }
  }
</script>

<div class="vm-contracts-panel">
  <div class="vm-contracts-panel__toolbar">
    <button
      type="button"
      class="vm-contracts-panel__new"
      onclick={() => void newContract()}
      disabled={creating}
      title="Create a new contract and open it in the canvas editor"
    >
      {creating ? "Creating…" : "+ New contract"}
    </button>
  </div>

  {#if loadError}
    <div class="vm-contracts-panel__error">
      Couldn't list your contracts: {loadError}
    </div>
  {:else if rows.length === 0}
    <div class="vm-contracts-panel__empty">
      <p>No contracts in this vault yet.</p>
      <p>
        Contracts are reusable agent workflows. Click <strong>+ New contract</strong>
        above to start one, or run <code>/vmem:install</code> to drop the
        bundled examples into <code>_contracts/examples/</code>.
      </p>
    </div>
  {:else}
    <ul class="vm-contracts-panel__list">
      {#each rows as row (row.path)}
        <li class="vm-contracts-panel__row">
          <button
            type="button"
            class="vm-contracts-panel__open"
            onclick={() => void open(row.path)}
            title={row.path}
          >
            <span class="vm-contracts-panel__row-head">
              <span class="vm-contracts-panel__name">{row.name}</span>
              <span class="vm-contracts-panel__kind">{row.kind === "contract" ? ".contract" : ".yaml"}</span>
            </span>
            {#if row.firstVerb || row.source || row.sink || row.steps !== null}
              <span class="vm-contracts-panel__meta">
                {#if row.steps !== null}
                  <span class="vm-contracts-panel__pill" title="Number of steps in this contract">
                    {row.steps} step{row.steps === 1 ? "" : "s"}
                  </span>
                {/if}
                {#if row.firstVerb}
                  <span class="vm-contracts-panel__pill vm-contracts-panel__pill--verb" title="First action in this contract">
                    {row.firstVerb}
                  </span>
                {/if}
                {#if row.source}
                  <span class="vm-contracts-panel__pill vm-contracts-panel__pill--src" title="Where notes come from">
                    from: {row.source}
                  </span>
                {/if}
                {#if row.sink}
                  <span class="vm-contracts-panel__pill vm-contracts-panel__pill--sink" title="Where the result is saved">
                    saves to: {row.sink}
                  </span>
                {/if}
              </span>
            {/if}
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
  .vm-contracts-panel__toolbar {
    display: flex;
    gap: var(--size-2-1);
  }
  .vm-contracts-panel__new {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: var(--radius-s);
    padding: var(--size-2-2) var(--size-4-2);
    cursor: pointer;
    font-weight: var(--font-medium);
  }
  .vm-contracts-panel__new:hover {
    background: var(--interactive-accent-hover);
  }
  .vm-contracts-panel__new:disabled {
    opacity: 0.6;
    cursor: not-allowed;
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
    flex-direction: column;
    gap: var(--size-2-1);
  }
  .vm-contracts-panel__open:hover {
    background: var(--background-modifier-hover);
  }
  .vm-contracts-panel__row-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--size-4-1);
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
  .vm-contracts-panel__meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-2-1);
    font-size: var(--font-ui-smaller);
  }
  .vm-contracts-panel__pill {
    background: var(--background-secondary);
    color: var(--text-muted);
    border-radius: var(--radius-s);
    padding: 0 var(--size-2-1);
    font-family: var(--font-monospace);
    font-size: var(--font-ui-smaller);
    white-space: nowrap;
  }
  .vm-contracts-panel__pill--verb {
    background: var(--color-blue);
    color: var(--text-on-accent);
  }
  .vm-contracts-panel__pill--src {
    background: var(--color-purple);
    color: var(--text-on-accent);
  }
  .vm-contracts-panel__pill--sink {
    background: var(--color-green);
    color: var(--text-on-accent);
  }
</style>
