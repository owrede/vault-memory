<!--
  inspector-pane — right pane of the Variant C three-pane editor.

  Phase 7 / Plan 07-05 / D-FORMAT-SCHEMA / UI-SPEC §"Properties Inspector".

  Modes:
    A. One step selected      → Zod-form for that verb's args.
    B. Nothing selected       → Contract-level form (name, description,
                                 inputs, sources, sinks, write_back).
    C. Multiple selected      → "{N} steps selected" + Delete/Group.
                                 (multi-select is plan 07-06+ — for now
                                 this pane only handles A and B.)

  Form generation:
    The verb's input schema lives server-side. Plan 07-05 ships a
    permissive fallback: when no schema is available, we render the
    step's existing `args` keys as plain text fields. Plan 07-06+ wires
    schema fetching via MCP. The generator from `zod-to-form.ts` is
    consumed when a Zod schema is in scope — exercised by the
    contract-level form's hand-written demonstration below.
-->

<script lang="ts">
  import { z } from "zod";
  import { zodToForm } from "./zod-to-form.js";
  import AliasPicker from "./AliasPicker.svelte";
  import type { ContractDocumentShape } from "../../../shared-types.js";

  let {
    file,
    selectedAlias,
    onChange,
  }: {
    file: ContractDocumentShape;
    selectedAlias: string | null;
    onChange: (next: ContractDocumentShape) => void;
  } = $props();

  // Contract-level schema (Mode B). Plan 07-05 demos zodToForm against
  // a small contract-meta schema — verb-specific schemas land in 07-06.
  const ContractMetaSchema = z.object({
    name: z.string().describe("Contract name (kebab-case)"),
    description: z.string().optional().describe("Free-text description"),
  });

  const contractForm = zodToForm(ContractMetaSchema);

  const selectedStep = $derived(
    selectedAlias
      ? file.contract.assembly.find((s) => s.as === selectedAlias) ?? null
      : null,
  );

  // In-scope aliases = aliases declared earlier than the selected step.
  const aliasesInScope = $derived(
    selectedStep
      ? file.contract.assembly
          .slice(
            0,
            file.contract.assembly.findIndex((s) => s.as === selectedStep.as),
          )
          .map((s) => s.as)
      : [],
  );

  function setContractField(key: "name" | "description", value: string): void {
    onChange({
      ...file,
      contract: { ...file.contract, [key]: value },
    });
  }

  function setStepArg(stepAlias: string, argKey: string, value: string): void {
    const newAssembly = file.contract.assembly.map((s) => {
      if (s.as !== stepAlias) return s;
      return { ...s, args: { ...(s.args ?? {}), [argKey]: value } };
    });
    onChange({
      ...file,
      contract: { ...file.contract, assembly: newAssembly },
    });
  }

  function setStepAlias(oldAlias: string, newAlias: string): void {
    const newAssembly = file.contract.assembly.map((s) =>
      s.as === oldAlias ? { ...s, as: newAlias } : s,
    );
    onChange({
      ...file,
      contract: { ...file.contract, assembly: newAssembly },
    });
  }
</script>

<aside class="vm-inspector-pane" aria-label="Properties inspector">
  {#if selectedStep}
    <header class="vm-inspector-header">
      <h2 class="vm-inspector-step-title">
        <span class="vm-mono">{selectedStep.as}</span>
        <span class="vm-verb-badge">{selectedStep.verb}</span>
      </h2>
    </header>
    <section class="vm-inspector-fields">
      <label class="vm-field">
        <span class="vm-field-label">as</span>
        <input
          type="text"
          class="vm-text-input"
          value={selectedStep.as}
          onchange={(e) =>
            setStepAlias(selectedStep.as, (e.target as HTMLInputElement).value)}
        />
      </label>

      {#each Object.entries(selectedStep.args ?? {}) as [key, value] (key)}
        <div class="vm-field">
          <span class="vm-field-label">{key}</span>
          <AliasPicker
            value={typeof value === "string" ? value : JSON.stringify(value)}
            aliases={aliasesInScope}
            onChange={(next) => setStepArg(selectedStep.as, key, next)}
          />
        </div>
      {/each}

      {#if Object.keys(selectedStep.args ?? {}).length === 0}
        <p class="vm-empty-hint">
          No args declared. Connect an upstream step on the canvas to add
          a read-back reference, or edit the underlying contract directly.
        </p>
      {/if}
    </section>
  {:else}
    <header class="vm-inspector-header">
      <h2>Contract details</h2>
    </header>
    <section class="vm-inspector-fields">
      {#each contractForm.fields as field (field.key)}
        <label class="vm-field">
          <span class="vm-field-label">
            {field.key}
            {#if field.required}<span class="vm-required" aria-hidden="true">*</span>{/if}
          </span>
          {#if field.type === "string" || field.type === "alias-ref"}
            <input
              type="text"
              class="vm-text-input"
              value={field.key === "name"
                ? file.contract.name
                : (file.contract.description ?? "")}
              placeholder={field.description ?? ""}
              oninput={(e) =>
                setContractField(
                  field.key as "name" | "description",
                  (e.target as HTMLInputElement).value,
                )}
            />
          {:else}
            <input
              type="text"
              class="vm-text-input"
              placeholder="(unsupported field type: {field.type})"
              disabled
            />
          {/if}
          {#if field.description}
            <span class="vm-field-help">{field.description}</span>
          {/if}
        </label>
      {/each}
    </section>
  {/if}
</aside>

<style>
  .vm-inspector-pane {
    background: var(--background-secondary);
    color: var(--text-normal);
    font-family: var(--font-interface);
    padding: var(--size-4-4, 16px);
    height: 100%;
    overflow-y: auto;
    border-left: 1px solid var(--background-modifier-border);
  }
  .vm-inspector-header h2 {
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 var(--size-4-4, 16px) 0;
  }
  .vm-inspector-step-title {
    display: flex;
    align-items: baseline;
    gap: var(--size-4-2, 8px);
  }
  .vm-mono {
    font-family: var(--font-monospace);
    color: var(--text-normal);
  }
  .vm-verb-badge {
    font-family: var(--font-monospace);
    font-size: 12px;
    color: var(--text-muted);
    padding: 2px var(--size-4-2, 8px);
    background: var(--background-modifier-hover);
    border-radius: 4px;
  }
  .vm-inspector-fields {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-4, 16px);
  }
  .vm-field {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-1, 4px);
  }
  .vm-field-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
    font-family: var(--font-monospace);
  }
  .vm-required {
    color: var(--text-error);
    margin-left: 2px;
  }
  .vm-text-input {
    padding: var(--size-4-2, 8px);
    background: var(--background-primary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    font-family: var(--font-interface);
    font-size: 14px;
  }
  .vm-text-input:disabled {
    color: var(--text-muted);
    cursor: not-allowed;
  }
  .vm-field-help {
    font-size: 12px;
    color: var(--text-muted);
  }
  .vm-empty-hint {
    font-size: 13px;
    color: var(--text-muted);
    font-style: italic;
    margin: 0;
  }
</style>
