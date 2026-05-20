<!--
  inspector-pane — right pane of the contract editor (Slice C redesign).

  Two modes:

    Mode A (step selected):
      - Category-coloured header with Lucide icon, plain-language title,
        canonical verb in monospace badge.
      - Paragraph explanation pulled from verb-catalog.longDescription.
      - "Output shape" line.
      - Alias field (editable, kebab/snake_case validated visually).
      - "Inputs" section with one card per arg key:
          - Plain-language label from argDocs[key].label
          - Help text from argDocs[key].help
          - Required-star when argDocs[key].required
          - Mustache-aware: when value starts with `{{`, render a small
            "uses ←alias" badge and a link to the upstream step's row.
      - "Used by" list — every downstream step that references this
        step's alias via `{{alias.field}}` in its args.

    Mode B (nothing selected):
      - "Contract overview" header.
      - Name + description fields with help text.
      - At-a-glance summary: # of inputs, # of sources, # of sinks,
        # of assembly steps, has_write_back flag.
      - Inline "good contract" tips, computed from what's missing:
          - no description
          - no required inputs
          - assembly has no compose step
          - assembly has no write_back
          - assembly has steps with `?` placeholders unfilled
-->

<script lang="ts">
  import { setIcon } from "obsidian";
  import { lookupVerb, VERB_CATEGORY_META } from "../palette/verb-catalog.js";
  import type { ArgDoc } from "../palette/verb-catalog.js";
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

  const selectedStep = $derived(
    selectedAlias
      ? file.contract.assembly.find((s) => s.as === selectedAlias) ?? null
      : null,
  );

  const selectedMeta = $derived(selectedStep ? lookupVerb(selectedStep.verb) : null);
  const selectedCategoryMeta = $derived(
    selectedMeta ? VERB_CATEGORY_META[selectedMeta.category] : null,
  );

  /**
   * Downstream steps that reference `selectedAlias` via {{alias.field}}.
   * Computed via the same alias-regex used by the canvas edge builder.
   */
  const usedBy = $derived.by(() => {
    if (!selectedAlias) return [] as Array<{ as: string; verb: string }>;
    const refRe = new RegExp(`\\{\\{\\s*${selectedAlias}(?:\\.[^}]*)?\\s*\\}\\}`);
    const consumers: Array<{ as: string; verb: string }> = [];
    for (const step of file.contract.assembly) {
      if (step.as === selectedAlias) continue;
      const text = JSON.stringify(step.args ?? {}) + JSON.stringify(step.value ?? "");
      if (refRe.test(text)) {
        consumers.push({ as: step.as, verb: step.verb });
      }
    }
    return consumers;
  });

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

  function setContractField(key: "name" | "description", value: string): void {
    onChange({
      ...file,
      contract: { ...file.contract, [key]: value },
    });
  }

  function setStepArg(stepAlias: string, argKey: string, value: unknown): void {
    const newAssembly = file.contract.assembly.map((s) => {
      if (s.as !== stepAlias) return s;
      return { ...s, args: { ...(s.args ?? {}), [argKey]: value } };
    });
    onChange({
      ...file,
      contract: { ...file.contract, assembly: newAssembly },
    });
  }

  function setStepAlias(oldAlias: string, nextRaw: string): void {
    // Slug the next alias to snake_case so the schema regex doesn't reject.
    const next = nextRaw
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!next || next === oldAlias) return;
    const newAssembly = file.contract.assembly.map((s) =>
      s.as === oldAlias ? { ...s, as: next } : s,
    );
    onChange({
      ...file,
      contract: { ...file.contract, assembly: newAssembly },
    });
  }

  /**
   * Extract the alias referenced by a `{{alias.field}}` value. Returns
   * null if the value isn't a mustache template.
   */
  function mustacheRef(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const m = value.match(/^\{\{\s*([a-z_][a-z0-9_]*)(?:\.[^}]*)?\s*\}\}\s*$/i);
    return m ? m[1]! : null;
  }

  function isPlaceholder(value: unknown): boolean {
    return typeof value === "string" && (value === "?" || value.startsWith("?"));
  }

  /**
   * Render an arg's value as a string for the text-input control. JSON
   * shapes become JSON; mustache strings stay as-is.
   */
  function valueToInput(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === undefined || value === null) return "";
    return JSON.stringify(value);
  }

  /**
   * Parse user input back into the right type for an arg. Numbers parse
   * to number; valid JSON parses to object/array; everything else stays
   * as a string. Mustache strings always stay strings.
   */
  function parseInputValue(raw: string, doc: ArgDoc | undefined): unknown {
    if (doc?.shape === "number") {
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    if (doc?.shape === "json") {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  }

  // ─── Good-contract tips (Mode B) ─────────────────────────────────
  const tips = $derived.by(() => {
    const out: Array<{ kind: "warn" | "info"; text: string }> = [];
    const c = file.contract;
    if (!c.description || c.description.trim().length === 0) {
      out.push({
        kind: "warn",
        text: "Add a one-paragraph description — it appears in describe_contract output and helps agents pick the right contract.",
      });
    }
    if (!c.required || c.required.length === 0) {
      out.push({
        kind: "info",
        text: "No required inputs declared. Agents may call the contract without supplying inputs — usually you want at least one (e.g. a DocId).",
      });
    }
    const composeSteps = c.assembly.filter((s) => lookupVerb(s.verb)?.category === "compose");
    if (composeSteps.length === 0 && c.assembly.length > 0) {
      out.push({
        kind: "info",
        text: "Most contracts end with a Compose step (e.g. compile_brief). Yours has none — the agent gets raw retrieval results.",
      });
    }
    if (!c.write_back) {
      out.push({
        kind: "warn",
        text: "No write_back block. The contract reads from the vault but never writes anything back — usually you want write_back to a MemorySink so the agent's output persists.",
      });
    }
    // Steps with unfilled `?` placeholders
    const unfilled: string[] = [];
    for (const step of c.assembly) {
      for (const [, v] of Object.entries(step.args ?? {})) {
        if (isPlaceholder(v)) {
          unfilled.push(step.as);
          break;
        }
      }
    }
    if (unfilled.length > 0) {
      out.push({
        kind: "warn",
        text: `Steps with unfilled placeholders: ${unfilled.join(", ")}. Replace each "?" with a value or {{ref}} before the contract can run.`,
      });
    }
    if (out.length === 0) {
      out.push({
        kind: "info",
        text: "Contract looks complete. Test it by calling instantiate_contract from an MCP-aware agent.",
      });
    }
    return out;
  });

  // ─── Step-arg ordering: argDocs key order > unknown keys at the end ─
  function orderedArgKeys(step: { args?: Record<string, unknown> } | null): string[] {
    if (!step) return [];
    const args = step.args ?? {};
    const docs = selectedMeta?.argDocs ?? {};
    const docKeys = Object.keys(docs);
    const argKeys = Object.keys(args);
    const documented = docKeys.filter((k) => k in args);
    const undocumented = argKeys.filter((k) => !(k in docs));
    return [...documented, ...undocumented];
  }
</script>

<aside class="vm-inspector-pane" aria-label="Properties inspector">
  {#if selectedStep && selectedMeta && selectedCategoryMeta}
    <!-- ─── Mode A: step selected ─── -->
    <header
      class="vm-inspector-header"
      style:--vm-cat-color="var({selectedCategoryMeta.colorVar})"
    >
      <div class="vm-inspector-header-row">
        <span class="vm-inspector-header-icon" use:lucideIcon={selectedCategoryMeta.icon}></span>
        <div class="vm-inspector-header-titles">
          <h2 class="vm-inspector-step-title">{selectedMeta.title}</h2>
          <span class="vm-inspector-step-verb">{selectedStep.verb}</span>
        </div>
      </div>
      <p class="vm-inspector-step-desc">{selectedMeta.longDescription}</p>
      <p class="vm-inspector-step-output">
        <span class="vm-inspector-step-output-label">Output:</span>
        <span class="vm-inspector-step-output-shape">{selectedMeta.outputShape}</span>
      </p>
    </header>

    <section class="vm-inspector-section">
      <h3 class="vm-inspector-section-title">Step name (alias)</h3>
      <p class="vm-inspector-section-help">
        Other steps reference this step's output as
        <code>&#123;&#123;{selectedStep.as}.field&#125;&#125;</code>. Use a short snake_case name.
      </p>
      <input
        type="text"
        class="vm-text-input"
        value={selectedStep.as}
        onchange={(e) => setStepAlias(selectedStep.as, (e.target as HTMLInputElement).value)}
      />
    </section>

    <section class="vm-inspector-section">
      <h3 class="vm-inspector-section-title">Inputs</h3>
      {#if orderedArgKeys(selectedStep).length === 0}
        <p class="vm-inspector-empty">This step has no args declared. Drag from another step's right handle into this step's left handle on the canvas to add a `{{ref}}` input.</p>
      {/if}
      {#each orderedArgKeys(selectedStep) as key (key)}
        {@const value = selectedStep.args?.[key]}
        {@const doc = selectedMeta.argDocs[key]}
        {@const ref = mustacheRef(value)}
        {@const placeholder = isPlaceholder(value)}
        <div class="vm-inspector-arg" class:vm-inspector-arg--placeholder={placeholder}>
          <label class="vm-inspector-arg-label">
            <span class="vm-inspector-arg-label-text">
              {doc?.label ?? key}
              {#if doc?.required}<span class="vm-inspector-required" aria-hidden="true">*</span>{/if}
            </span>
            <span class="vm-inspector-arg-key">{key}</span>
          </label>
          {#if doc?.help}
            <p class="vm-inspector-arg-help">{doc.help}</p>
          {/if}
          {#if ref}
            <div class="vm-inspector-arg-ref" title="Receives output from step `{ref}`">
              <span class="vm-inspector-arg-ref-arrow">←</span>
              <code>{ref}</code>
              <span class="vm-inspector-arg-ref-suffix">(uses upstream step's output)</span>
            </div>
            <input
              type="text"
              class="vm-text-input vm-text-input--mustache"
              value={valueToInput(value)}
              onchange={(e) =>
                setStepArg(
                  selectedStep.as,
                  key,
                  parseInputValue((e.target as HTMLInputElement).value, doc),
                )}
            />
          {:else if doc?.shape === "textarea"}
            <textarea
              class="vm-text-input vm-text-area"
              value={valueToInput(value)}
              rows={3}
              onchange={(e) =>
                setStepArg(
                  selectedStep.as,
                  key,
                  parseInputValue((e.target as HTMLTextAreaElement).value, doc),
                )}
            ></textarea>
          {:else}
            <input
              type="text"
              class="vm-text-input"
              value={valueToInput(value)}
              placeholder={placeholder ? "(empty — fill me)" : ""}
              onchange={(e) =>
                setStepArg(
                  selectedStep.as,
                  key,
                  parseInputValue((e.target as HTMLInputElement).value, doc),
                )}
            />
          {/if}
        </div>
      {/each}
    </section>

    <section class="vm-inspector-section">
      <h3 class="vm-inspector-section-title">Used by</h3>
      {#if usedBy.length === 0}
        <p class="vm-inspector-empty">No downstream step references this step yet. Connect this step's right handle to another step on the canvas to feed its output forward.</p>
      {:else}
        <ul class="vm-inspector-usedby">
          {#each usedBy as consumer (consumer.as)}
            <li class="vm-inspector-usedby-item">
              <span class="vm-inspector-usedby-alias">{consumer.as}</span>
              <span class="vm-inspector-usedby-verb">{consumer.verb}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {:else}
    <!-- ─── Mode B: contract overview ─── -->
    <header class="vm-inspector-header">
      <h2 class="vm-inspector-step-title">Contract overview</h2>
      <p class="vm-inspector-step-desc">
        A contract is a workflow your AI agent can run on this vault. Pick one or more steps from
        the left palette, drag them onto the canvas, connect them, and define inputs. Then any
        MCP-aware agent can invoke it by name.
      </p>
    </header>

    <section class="vm-inspector-section">
      <h3 class="vm-inspector-section-title">Name</h3>
      <p class="vm-inspector-section-help">
        kebab-case. Must be unique in the vault. This is the name agents call:
        <code>instantiate_contract(&#123;name: "{file.contract.name}"&#125;)</code>.
      </p>
      <input
        type="text"
        class="vm-text-input"
        value={file.contract.name}
        oninput={(e) => setContractField("name", (e.target as HTMLInputElement).value)}
      />
    </section>

    <section class="vm-inspector-section">
      <h3 class="vm-inspector-section-title">Description</h3>
      <p class="vm-inspector-section-help">
        One paragraph. Agents see this in <code>describe_contract</code>. State what the contract
        DOES (e.g. "Compile a meeting-prep brief from linked context") — not how.
      </p>
      <textarea
        class="vm-text-input vm-text-area"
        value={file.contract.description ?? ""}
        rows={3}
        oninput={(e) => setContractField("description", (e.target as HTMLTextAreaElement).value)}
      ></textarea>
    </section>

    <section class="vm-inspector-section">
      <h3 class="vm-inspector-section-title">At a glance</h3>
      <ul class="vm-inspector-stats">
        <li>
          <span class="vm-inspector-stats-num">{Object.keys(file.contract.inputs ?? {}).length}</span>
          <span class="vm-inspector-stats-label">inputs</span>
        </li>
        <li>
          <span class="vm-inspector-stats-num">{(file.contract.required ?? []).length}</span>
          <span class="vm-inspector-stats-label">required</span>
        </li>
        <li>
          <span class="vm-inspector-stats-num">{Object.keys(file.contract.sources ?? {}).length}</span>
          <span class="vm-inspector-stats-label">sources</span>
        </li>
        <li>
          <span class="vm-inspector-stats-num">{Object.keys(file.contract.sinks ?? {}).length}</span>
          <span class="vm-inspector-stats-label">sinks</span>
        </li>
        <li>
          <span class="vm-inspector-stats-num">{file.contract.assembly.length}</span>
          <span class="vm-inspector-stats-label">steps</span>
        </li>
        <li>
          <span class="vm-inspector-stats-num">{file.contract.write_back ? "✓" : "—"}</span>
          <span class="vm-inspector-stats-label">write_back</span>
        </li>
      </ul>
    </section>

    <section class="vm-inspector-section">
      <h3 class="vm-inspector-section-title">Tips</h3>
      <ul class="vm-inspector-tips">
        {#each tips as tip (tip.text)}
          <li class="vm-inspector-tip vm-inspector-tip--{tip.kind}">{tip.text}</li>
        {/each}
      </ul>
    </section>
  {/if}
</aside>

<style>
  .vm-inspector-pane {
    background: var(--background-secondary);
    color: var(--text-normal);
    font-family: var(--font-interface);
    font-size: var(--font-ui-small);
    height: 100%;
    overflow-y: auto;
    border-left: 1px solid var(--background-modifier-border);
  }

  /* ── Header ── */
  .vm-inspector-header {
    padding: var(--size-4-3) var(--size-4-3) var(--size-4-2);
    border-bottom: 1px solid var(--background-modifier-border);
    border-left: 4px solid var(--vm-cat-color, transparent);
    background: var(--background-secondary-alt, var(--background-secondary));
  }
  .vm-inspector-header-row {
    display: flex;
    align-items: center;
    gap: var(--size-2-3);
    margin-bottom: var(--size-2-2);
  }
  .vm-inspector-header-icon {
    display: inline-flex;
    width: 20px;
    height: 20px;
    color: var(--vm-cat-color, var(--text-muted));
  }
  .vm-inspector-header-icon :global(svg) {
    width: 20px;
    height: 20px;
  }
  .vm-inspector-header-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .vm-inspector-step-title {
    margin: 0;
    font-size: var(--font-ui-medium);
    font-weight: var(--font-semibold);
    color: var(--text-normal);
    line-height: 1.2;
  }
  .vm-inspector-step-verb {
    font-family: var(--font-monospace);
    font-size: var(--font-smaller);
    color: var(--text-accent);
  }
  .vm-inspector-step-desc {
    margin: 0 0 var(--size-2-2) 0;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    line-height: 1.5;
  }
  .vm-inspector-step-output {
    margin: 0;
    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
  }
  .vm-inspector-step-output-label {
    color: var(--text-muted);
    font-weight: var(--font-medium);
    margin-right: var(--size-2-1);
  }
  .vm-inspector-step-output-shape {
    font-family: var(--font-monospace);
    font-size: var(--font-smaller);
  }

  /* ── Section ── */
  .vm-inspector-section {
    padding: var(--size-4-3);
    border-bottom: 1px solid var(--background-modifier-border);
  }
  .vm-inspector-section:last-child {
    border-bottom: none;
  }
  .vm-inspector-section-title {
    margin: 0 0 var(--size-2-2) 0;
    font-size: var(--font-ui-smaller);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .vm-inspector-section-help {
    margin: 0 0 var(--size-2-3) 0;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    line-height: 1.45;
  }
  .vm-inspector-section-help code {
    font-family: var(--font-monospace);
    color: var(--text-accent);
    font-size: 0.95em;
  }
  .vm-inspector-empty {
    margin: 0;
    color: var(--text-faint);
    font-size: var(--font-ui-smaller);
    font-style: italic;
    line-height: 1.5;
  }

  /* ── Arg cards ── */
  .vm-inspector-arg {
    display: flex;
    flex-direction: column;
    gap: var(--size-2-1);
    margin-bottom: var(--size-4-3);
  }
  .vm-inspector-arg:last-child {
    margin-bottom: 0;
  }
  .vm-inspector-arg--placeholder .vm-text-input {
    border-color: var(--text-warning);
  }
  .vm-inspector-arg-label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--size-2-2);
  }
  .vm-inspector-arg-label-text {
    font-size: var(--font-ui-small);
    font-weight: var(--font-medium);
    color: var(--text-normal);
  }
  .vm-inspector-arg-key {
    font-family: var(--font-monospace);
    font-size: var(--font-smaller);
    color: var(--text-faint);
  }
  .vm-inspector-required {
    color: var(--text-error);
    margin-left: 2px;
  }
  .vm-inspector-arg-help {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    line-height: 1.4;
  }
  .vm-inspector-arg-ref {
    display: flex;
    align-items: center;
    gap: var(--size-2-1);
    padding: var(--size-2-1) var(--size-2-2);
    background: color-mix(in srgb, var(--interactive-accent) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--interactive-accent) 30%, transparent);
    border-radius: var(--radius-s);
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }
  .vm-inspector-arg-ref-arrow {
    color: var(--interactive-accent);
    font-weight: var(--font-semibold);
  }
  .vm-inspector-arg-ref code {
    font-family: var(--font-monospace);
    color: var(--text-accent);
  }

  /* ── Form inputs ── */
  .vm-text-input {
    width: 100%;
    box-sizing: border-box;
    padding: var(--size-2-2) var(--size-2-3);
    background: var(--background-primary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    font-family: var(--font-interface);
    font-size: var(--font-ui-small);
  }
  .vm-text-input:focus {
    outline: 2px solid var(--interactive-accent);
    outline-offset: -1px;
  }
  .vm-text-input--mustache {
    font-family: var(--font-monospace);
    color: var(--text-accent);
  }
  .vm-text-area {
    resize: vertical;
    min-height: 4em;
    font-family: var(--font-interface);
  }

  /* ── Used-by list ── */
  .vm-inspector-usedby {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--size-2-1);
  }
  .vm-inspector-usedby-item {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: var(--size-2-2) var(--size-2-3);
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
  }
  .vm-inspector-usedby-alias {
    font-family: var(--font-monospace);
    font-weight: var(--font-semibold);
    color: var(--text-normal);
  }
  .vm-inspector-usedby-verb {
    font-family: var(--font-monospace);
    font-size: var(--font-smaller);
    color: var(--text-accent);
  }

  /* ── At-a-glance stats ── */
  .vm-inspector-stats {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--size-2-2);
  }
  .vm-inspector-stats li {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--size-2-2);
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
  }
  .vm-inspector-stats-num {
    font-size: var(--font-ui-medium);
    font-weight: var(--font-semibold);
    color: var(--text-normal);
  }
  .vm-inspector-stats-label {
    font-size: var(--font-smaller);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  /* ── Tips ── */
  .vm-inspector-tips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--size-2-2);
  }
  .vm-inspector-tip {
    padding: var(--size-2-2) var(--size-2-3);
    border-radius: var(--radius-s);
    font-size: var(--font-ui-smaller);
    line-height: 1.4;
    border-left: 3px solid;
  }
  .vm-inspector-tip--warn {
    border-left-color: var(--text-warning);
    background: color-mix(in srgb, var(--text-warning) 8%, transparent);
    color: var(--text-normal);
  }
  .vm-inspector-tip--info {
    border-left-color: var(--interactive-accent);
    background: color-mix(in srgb, var(--interactive-accent) 6%, transparent);
    color: var(--text-muted);
  }
</style>
