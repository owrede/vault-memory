<!--
  inspector-pane — right pane of the contract editor (Slice C, Phase B redesign).

  Terminology (user-facing) in this file:
    "verb"  → "action"
    "args"  → "inputs"
    "alias" → "step name"
    "handle"→ "connection"
    "DocId" → "note"
    {{alias}} mustache → "use the result of <step name>"
  ("contract" stays as "contract".)

  Two modes:

    Mode A (step selected):
      - Coloured header: category icon, plain-language title, small
        muted monospace badge with the canonical action name.
      - Collapsible "What does this step do?" longDescription.
      - Step-name editor with kebab/snake-case validation + auto-fix.
      - Inputs section, split into Required (always visible) and
        Optional (collapsed by default). Each input has a Mode toggle:
          [ Use upstream ] [ Fixed value ]
        Upstream mode renders a two-level picker (step → field). Fixed
        value mode renders a typed control based on doc.shape.
        Internal __ref_* keys are filtered out.
      - "Connected to" footer: every downstream step that references
        this step via {{step-name.field}} in its inputs.
      - "Output preview" collapsed details.

    Mode B (nothing selected):
      - Contract overview.
      - Name + description with help via "?" tooltip chips and inline
        auto-fix suggestion for invalid names.
      - At-a-glance stats, Tips, etc.
-->

<script lang="ts">
  import { setIcon } from "obsidian";
  import { lookupVerb, VERB_CATEGORY_META } from "../palette/verb-catalog.js";
  import type { ArgDoc, VerbMeta } from "../palette/verb-catalog.js";
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
   * Downstream steps that reference `selectedAlias` via {{step-name.field}}.
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

  // ─── Name field — commit on blur with inline validation + auto-fix ──
  let nameDraft = $state(file.contract.name);
  let nameError = $state<string | null>(null);
  let nameSuggestion = $state<string | null>(null);
  $effect(() => {
    nameDraft = file.contract.name;
    nameError = null;
    nameSuggestion = null;
  });
  const NAME_RE = /^[a-z][a-z0-9-]*$/;

  /** Slugify into a valid contract name: lowercase, [a-z0-9-], collapse `-`. */
  function slugifyName(raw: string): string {
    let s = raw.trim().toLowerCase();
    s = s.replace(/[^a-z0-9-]+/g, "-");
    s = s.replace(/-+/g, "-");
    s = s.replace(/^-+|-+$/g, "");
    // Must start with a letter — if it starts with a digit, prefix.
    if (s.length > 0 && !/^[a-z]/.test(s)) {
      s = "r-" + s;
    }
    return s;
  }

  function commitName(): void {
    const trimmed = nameDraft.trim();
    if (trimmed.length === 0) {
      nameError = "Name is required.";
      nameSuggestion = null;
      return;
    }
    if (!NAME_RE.test(trimmed)) {
      nameError = 'Use lowercase letters, digits, and hyphens — like "monday-status".';
      const slug = slugifyName(trimmed);
      nameSuggestion = slug.length > 0 && slug !== trimmed ? slug : null;
      return;
    }
    nameError = null;
    nameSuggestion = null;
    if (trimmed !== file.contract.name) {
      setContractField("name", trimmed);
    }
  }

  function applyNameSuggestion(): void {
    if (!nameSuggestion) return;
    nameDraft = nameSuggestion;
    commitName();
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

  // ─── Step name (alias) — with auto-fix suggestion ───────────────────
  let aliasDraft = $state<string>(selectedStep?.as ?? "");
  let aliasError = $state<string | null>(null);
  let aliasSuggestion = $state<string | null>(null);
  $effect(() => {
    // Re-sync when selection changes.
    aliasDraft = selectedStep?.as ?? "";
    aliasError = null;
    aliasSuggestion = null;
  });
  const ALIAS_RE = /^[a-z][a-z0-9_]*$/;

  function slugifyAlias(raw: string): string {
    let s = raw.trim().toLowerCase();
    s = s.replace(/[^a-z0-9_]+/g, "_");
    s = s.replace(/_+/g, "_");
    s = s.replace(/^_+|_+$/g, "");
    if (s.length > 0 && !/^[a-z]/.test(s)) {
      s = "s_" + s;
    }
    return s;
  }

  function commitStepName(): void {
    if (!selectedStep) return;
    const trimmed = aliasDraft.trim();
    if (trimmed.length === 0) {
      aliasError = "Step name is required.";
      aliasSuggestion = null;
      return;
    }
    if (trimmed === selectedStep.as) {
      aliasError = null;
      aliasSuggestion = null;
      return;
    }
    if (!ALIAS_RE.test(trimmed)) {
      aliasError = 'Use lowercase letters, digits, and underscores — like "find_meetings".';
      const slug = slugifyAlias(trimmed);
      aliasSuggestion = slug.length > 0 && slug !== trimmed ? slug : null;
      return;
    }
    aliasError = null;
    aliasSuggestion = null;
    setStepAlias(selectedStep.as, trimmed);
  }

  function applyAliasSuggestion(): void {
    if (!aliasSuggestion || !selectedStep) return;
    aliasDraft = aliasSuggestion;
    commitStepName();
  }

  function setStepAlias(oldAlias: string, nextRaw: string): void {
    // Slug the next step name so the schema regex doesn't reject.
    const next = nextRaw
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!next || next === oldAlias) return;

    // Renaming must cascade:
    //   (a) `editor.nodes[i].id` from `step:<old>` → `step:<new>` so
    //       the node's saved (x,y,w,h) carry over to the new id.
    //   (b) `__ref_<old>` arg keys on every OTHER step → `__ref_<new>`
    //   (c) any `{{old}}` / `{{old.field}}` in OTHER steps' inputs
    //       (these stay in the on-disk YAML; the user only sees the
    //       step-name picker UI but the underlying ref-string must
    //       survive a rename).
    const refRe = new RegExp(
      `\\{\\{\\s*${oldAlias}((?:\\.[^}]*)?)\\s*\\}\\}`,
      "g",
    );
    const renameMustachesIn = (value: unknown): unknown => {
      if (typeof value === "string") {
        return value.replace(refRe, (_m, tail: string) => `{{${next}${tail}}}`);
      }
      if (Array.isArray(value)) return value.map(renameMustachesIn);
      if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          out[k] = renameMustachesIn(v);
        }
        return out;
      }
      return value;
    };
    const renameArgKeys = (
      args: Record<string, unknown> | undefined,
    ): Record<string, unknown> | undefined => {
      if (!args) return args;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) {
        const newKey = k === `__ref_${oldAlias}` ? `__ref_${next}` : k;
        out[newKey] = v;
      }
      return out;
    };

    const newAssembly = file.contract.assembly.map((s) => {
      if (s.as === oldAlias) {
        return { ...s, as: next };
      }
      const renamedArgs = renameArgKeys(s.args);
      const remappedArgs = renamedArgs
        ? (renameMustachesIn(renamedArgs) as Record<string, unknown>)
        : renamedArgs;
      const remappedValue =
        s.value !== undefined ? renameMustachesIn(s.value) : s.value;
      return {
        ...s,
        ...(remappedArgs !== undefined ? { args: remappedArgs } : {}),
        ...(s.value !== undefined ? { value: remappedValue } : {}),
      };
    });

    const newEditorNodes = file.editor.nodes.map((n) =>
      n.id === `step:${oldAlias}` ? { ...n, id: `step:${next}` } : n,
    );

    onChange({
      ...file,
      contract: { ...file.contract, assembly: newAssembly },
      editor: { ...file.editor, nodes: newEditorNodes },
    });
  }

  // ─── Reference detection + output-field parsing ──────────────────────
  /**
   * Parse a value like `{{step.field}}` into { step, field }. Returns
   * null when the value isn't a single-token reference.
   */
  function parseRef(value: unknown): { step: string; field: string | null } | null {
    if (typeof value !== "string") return null;
    const m = value.match(/^\{\{\s*([a-z_][a-z0-9_]*)(?:\.([^}]+))?\s*\}\}\s*$/i);
    if (!m) return null;
    return { step: m[1]!, field: (m[2] ?? null)?.trim() || null };
  }

  function isPlaceholder(value: unknown): boolean {
    return typeof value === "string" && (value === "?" || value.startsWith("?"));
  }

  /**
   * Parse named fields out of an `outputShape` string. Looks for
   * `{ key: ..., ... }` patterns and returns the keys. Falls back to
   * an empty list for strings that don't fit the pattern (e.g. literal
   * "The value, as-is.").
   */
  function parseOutputFields(outputShape: string | undefined): string[] {
    if (!outputShape) return [];
    // Grab the contents of the outermost {...} if present.
    const m = outputShape.match(/\{([\s\S]*)\}/);
    if (!m) return [];
    const inner = m[1] ?? "";
    const keys: string[] = [];
    // Match `key:` at depth 0 (skip nested braces / arrays).
    let depth = 0;
    let token = "";
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === "{" || ch === "[" || ch === "<") depth++;
      else if (ch === "}" || ch === "]" || ch === ">") depth = Math.max(0, depth - 1);
      else if (ch === "," && depth === 0) {
        const kv = token.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
        if (kv) keys.push(kv[1]!);
        token = "";
        continue;
      }
      token += ch;
    }
    const kv = token.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
    if (kv) keys.push(kv[1]!);
    return keys;
  }

  /** Upstream steps available to the currently-selected step. */
  const upstreamSteps = $derived.by(() => {
    if (!selectedStep) return [] as Array<{ as: string; verb: string; meta: VerbMeta | undefined; fields: string[] }>;
    const idx = file.contract.assembly.findIndex((s) => s.as === selectedStep.as);
    if (idx < 0) return [];
    return file.contract.assembly.slice(0, idx).map((s) => {
      const meta = lookupVerb(s.verb);
      const fields = parseOutputFields(meta?.outputShape);
      return { as: s.as, verb: s.verb, meta, fields };
    });
  });

  /** Format a literal value back to text for display in a fixed-value control. */
  function valueToInput(value: unknown): string {
    if (typeof value === "string") {
      if (value === "?" || value.startsWith("?")) return "";
      return value;
    }
    if (value === undefined || value === null) return "";
    return JSON.stringify(value);
  }

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

  // ─── Per-arg mode toggle (Use upstream | Fixed value) ────────────────
  /**
   * Derive the initial mode for an arg from its current value. We use
   * a `Record<argKey, "ref"|"lit">` map keyed inside the step so the
   * user's chosen mode survives in-component toggling even when the
   * stored value hasn't changed yet.
   */
  type ArgMode = "ref" | "lit";
  let modeOverrides = $state<Record<string, ArgMode>>({});
  $effect(() => {
    // Clear overrides when the selected step changes.
    void selectedStep?.as;
    modeOverrides = {};
  });

  function argMode(argKey: string, value: unknown): ArgMode {
    if (modeOverrides[argKey]) return modeOverrides[argKey]!;
    return parseRef(value) ? "ref" : "lit";
  }

  function setArgMode(argKey: string, mode: ArgMode): void {
    modeOverrides = { ...modeOverrides, [argKey]: mode };
    // Toggling to lit doesn't clear an existing ref value automatically;
    // the user can edit the input. Toggling to ref with no existing ref
    // leaves the value alone — the picker has its own "(pick a step)"
    // empty state that maps to no write until both selects are filled.
  }

  function commitRefPick(argKey: string, step: string, field: string | null): void {
    if (!selectedStep) return;
    if (!step) return;
    const v = field ? `{{${step}.${field}}}` : `{{${step}}}`;
    setStepArg(selectedStep.as, argKey, v);
  }

  // ─── Required / optional split ──────────────────────────────────────
  function argDocFor(meta: VerbMeta | null, key: string): ArgDoc | undefined {
    return meta?.argDocs?.[key];
  }

  /**
   * Returns visible arg keys split into required + optional. Keys
   * starting with `__` are filtered out (internal canvas placeholders).
   * Documented keys come first in argDocs declaration order; undocumented
   * keys go after, treated as optional.
   */
  function orderedArgKeys(
    step: { args?: Record<string, unknown> } | null,
  ): { required: string[]; optional: string[] } {
    if (!step) return { required: [], optional: [] };
    const args = step.args ?? {};
    const docs = selectedMeta?.argDocs ?? {};
    const docKeys = Object.keys(docs);
    const argKeys = Object.keys(args);
    const isInternal = (k: string): boolean => k.startsWith("__");
    const documented = docKeys.filter((k) => k in args && !isInternal(k));
    const undocumented = argKeys.filter((k) => !(k in docs) && !isInternal(k));
    const required = documented.filter((k) => docs[k]?.required === true);
    const optionalDoc = documented.filter((k) => docs[k]?.required !== true);
    return { required, optional: [...optionalDoc, ...undocumented] };
  }

  const argSplit = $derived(orderedArgKeys(selectedStep));

  // ─── Good-contract tips (Mode B) ─────────────────────────────────
  const tips = $derived.by(() => {
    const out: Array<{ kind: "warn" | "info"; text: string }> = [];
    const c = file.contract;
    if (!c.description || c.description.trim().length === 0) {
      out.push({
        kind: "warn",
        text: "Add a one-paragraph description — it helps agents pick the right contract.",
      });
    }
    if (!c.required || c.required.length === 0) {
      out.push({
        kind: "info",
        text: "No required contract inputs declared. Agents may call the contract without supplying any — usually you want at least one.",
      });
    }
    const composeSteps = c.assembly.filter((s) => lookupVerb(s.verb)?.category === "compose");
    if (composeSteps.length === 0 && c.assembly.length > 0) {
      out.push({
        kind: "info",
        text: "Most contracts end with a Compose step. Yours has none — the agent gets raw retrieval results.",
      });
    }
    if (!c.write_back) {
      out.push({
        kind: "warn",
        text: "No save-the-result block. The contract reads from the vault but never writes anything back.",
      });
    }
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
        text: `Steps with empty required inputs: ${unfilled.join(", ")}. Fill them before the contract can run.`,
      });
    }
    return out;
  });
</script>

<aside class="vm-inspector-pane" aria-label="Properties inspector">
  {#if selectedStep && selectedMeta && selectedCategoryMeta}
    <!-- Mode A: step selected.
         {#key selectedStep.as} forces a fresh mount per selection so
         Svelte 5 $derived re-evaluates even when verbs share the same
         catalog row (e.g. two literal steps in a row). -->
    {#key selectedStep.as}
    <header
      class="vm-inspector-header"
      style:--vm-cat-color="var({selectedCategoryMeta.colorVar})"
    >
      <div class="vm-inspector-header-row">
        <span class="vm-inspector-header-icon" use:lucideIcon={selectedCategoryMeta.icon}></span>
        <div class="vm-inspector-header-titles">
          <h2 class="vm-inspector-step-title">
            {selectedMeta.title}
            <span class="vm-inspector-step-verb-badge" title="Internal action name">{selectedStep.verb}</span>
          </h2>
        </div>
      </div>
      <details class="vm-inspector-details">
        <summary class="vm-inspector-details-summary">What does this step do?</summary>
        <p class="vm-inspector-details-body">{selectedMeta.longDescription}</p>
      </details>
    </header>

    <section class="vm-inspector-section">
      <h3 class="vm-inspector-section-title">
        <span class="vm-inspector-section-title-text">Step name</span>
        <span
          class="vm-inspector-help-icon"
          role="img"
          tabindex="0"
          aria-label="Other steps can use the result of this step by its step name. Use a short name like find_meetings."
          title="Other steps can use the result of this step by its step name. Use a short name like find_meetings.">?</span>
      </h3>
      <input
        type="text"
        class="vm-text-input"
        class:vm-text-input--invalid={aliasError !== null}
        bind:value={aliasDraft}
        onblur={commitStepName}
        onkeydown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {#if aliasError}
        <p class="vm-inspector-inline-error" role="alert">{aliasError}</p>
        {#if aliasSuggestion}
          <button
            type="button"
            class="vm-inspector-fix-chip"
            onclick={applyAliasSuggestion}
          >Did you mean: <code>{aliasSuggestion}</code>?</button>
        {/if}
      {/if}
    </section>

    <section class="vm-inspector-section">
      <h3 class="vm-inspector-section-title">
        <span class="vm-inspector-section-title-text">Required inputs</span>
        <span
          class="vm-inspector-help-icon"
          role="img"
          tabindex="0"
          aria-label="These inputs must be set before the step can run."
          title="These inputs must be set before the step can run.">?</span>
      </h3>
      {#if argSplit.required.length === 0}
        <p class="vm-inspector-empty">This step has no required inputs.</p>
      {/if}
      {#each argSplit.required as key (key)}
        {@const value = selectedStep.args?.[key]}
        {@const doc = argDocFor(selectedMeta, key)}
        {@const mode = argMode(key, value)}
        {@const ref = parseRef(value)}
        <div class="vm-inspector-arg">
          <div class="vm-inspector-arg-label">
            <span class="vm-inspector-arg-label-text">
              {doc?.label ?? key}
              {#if doc?.required}<span class="vm-inspector-required" aria-hidden="true">*</span>{/if}
              {#if doc?.help}
                <span
                  class="vm-inspector-help-icon"
                  role="img"
                  tabindex="0"
                  aria-label={doc.help}
                  title={doc.help}>?</span>
              {/if}
            </span>
          </div>

          <div class="vm-mode-toggle" role="tablist" aria-label="Input mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "ref"}
              class:vm-mode-toggle-btn--active={mode === "ref"}
              class="vm-mode-toggle-btn"
              onclick={() => setArgMode(key, "ref")}
              disabled={upstreamSteps.length === 0 && mode !== "ref"}
              title={upstreamSteps.length === 0 ? "No earlier steps to use the result of." : ""}
            >Use upstream</button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "lit"}
              class:vm-mode-toggle-btn--active={mode === "lit"}
              class="vm-mode-toggle-btn"
              onclick={() => setArgMode(key, "lit")}
            >Fixed value</button>
          </div>

          {#if mode === "ref"}
            {@const currentStep = ref?.step ?? ""}
            {@const currentField = ref?.field ?? ""}
            {@const chosen = upstreamSteps.find((u) => u.as === currentStep)}
            <div class="vm-ref-picker">
              <label class="vm-ref-picker-row">
                <span class="vm-ref-picker-label">Use the result of…</span>
                <select
                  class="vm-text-input"
                  value={currentStep}
                  onchange={(e) => {
                    const v = (e.target as HTMLSelectElement).value;
                    if (!v) return;
                    commitRefPick(key, v, null);
                  }}
                >
                  <option value="" disabled>(pick a step)</option>
                  {#each upstreamSteps as up (up.as)}
                    <option value={up.as}>{up.as}</option>
                  {/each}
                </select>
              </label>
              {#if chosen}
                <label class="vm-ref-picker-row">
                  <span class="vm-ref-picker-label">Which part of its output?</span>
                  <select
                    class="vm-text-input"
                    value={currentField}
                    onchange={(e) => {
                      const v = (e.target as HTMLSelectElement).value;
                      commitRefPick(key, currentStep, v || null);
                    }}
                  >
                    <option value="">whole output</option>
                    {#each chosen.fields as f (f)}
                      <option value={f}>{f}</option>
                    {/each}
                  </select>
                </label>
                <p class="vm-ref-picker-caption">
                  This step will receive the {currentField || "whole output"} of {currentStep}.
                </p>
              {:else if upstreamSteps.length === 0}
                <p class="vm-ref-picker-caption">No earlier steps yet. Add one before this step to use its result here.</p>
              {/if}
            </div>
          {:else}
            <!-- Fixed value: typed control per shape -->
            {#if doc?.shape === "number"}
              <input
                type="number"
                class="vm-text-input"
                value={typeof value === "number" ? value : ""}
                onchange={(e) =>
                  setStepArg(selectedStep.as, key, parseInputValue((e.target as HTMLInputElement).value, doc))}
              />
            {:else if doc?.shape === "bool"}
              <label class="vm-bool-toggle">
                <input
                  type="checkbox"
                  checked={value === true}
                  onchange={(e) => setStepArg(selectedStep.as, key, (e.target as HTMLInputElement).checked)}
                />
                <span>{value === true ? "Yes" : "No"}</span>
              </label>
            {:else if doc?.shape === "enum"}
              <select
                class="vm-text-input"
                value={typeof value === "string" ? value : ""}
                onchange={(e) => setStepArg(selectedStep.as, key, (e.target as HTMLSelectElement).value)}
              >
                <option value="" disabled>(choose…)</option>
                {#each doc.enumOptions ?? [] as opt (opt.value)}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            {:else if doc?.shape === "textarea"}
              <textarea
                class="vm-text-input vm-text-area"
                value={valueToInput(value)}
                rows={3}
                onchange={(e) =>
                  setStepArg(selectedStep.as, key, parseInputValue((e.target as HTMLTextAreaElement).value, doc))}
              ></textarea>
            {:else if doc?.shape === "docId"}
              <!-- TODO: replace with an Obsidian-style note picker using
                   the plugin instance's vault.getFiles(). Stubbed for
                   the Phase B batch as a text input with a placeholder. -->
              <input
                type="text"
                class="vm-text-input"
                placeholder="Type a note path…"
                value={typeof value === "string" ? (isPlaceholder(value) ? "" : value) : ""}
                onchange={(e) => setStepArg(selectedStep.as, key, (e.target as HTMLInputElement).value)}
              />
            {:else if doc?.shape === "docList"}
              {@const list = Array.isArray(value) ? value : []}
              <div class="vm-doc-list">
                {#if list.length === 0}
                  <p class="vm-inspector-empty">No notes yet.</p>
                {/if}
                {#each list as entry, i (i)}
                  <div class="vm-doc-list-row">
                    <!-- TODO: replace with Obsidian note picker -->
                    <input
                      type="text"
                      class="vm-text-input"
                      placeholder="Type a note path…"
                      value={typeof entry === "string" ? (isPlaceholder(entry) ? "" : entry) : ""}
                      onchange={(e) => {
                        const next = [...list];
                        next[i] = (e.target as HTMLInputElement).value;
                        setStepArg(selectedStep.as, key, next);
                      }}
                    />
                    <button
                      type="button"
                      class="vm-inspector-mini-btn"
                      title="Remove this note"
                      onclick={() => {
                        const next = list.filter((_, j) => j !== i);
                        setStepArg(selectedStep.as, key, next);
                      }}
                    >×</button>
                  </div>
                {/each}
                <button
                  type="button"
                  class="vm-inspector-mini-btn"
                  onclick={() => setStepArg(selectedStep.as, key, [...list, ""])}
                >+ Add note</button>
              </div>
            {:else if doc?.shape === "composite"}
              <div class="vm-inspector-advanced-chip">Advanced: raw value, no picker yet</div>
              <textarea
                class="vm-text-input vm-text-area"
                value={valueToInput(value)}
                rows={2}
                onchange={(e) => setStepArg(selectedStep.as, key, (e.target as HTMLTextAreaElement).value)}
              ></textarea>
            {:else if doc?.shape === "json"}
              <div class="vm-inspector-advanced-chip">Advanced — JSON value</div>
              <textarea
                class="vm-text-input vm-text-area vm-text-input--mono"
                value={valueToInput(value)}
                rows={3}
                onchange={(e) => setStepArg(selectedStep.as, key, parseInputValue((e.target as HTMLTextAreaElement).value, doc))}
              ></textarea>
            {:else}
              <input
                type="text"
                class="vm-text-input"
                value={valueToInput(value)}
                placeholder={isPlaceholder(value) ? "(empty — fill me)" : ""}
                onchange={(e) =>
                  setStepArg(selectedStep.as, key, parseInputValue((e.target as HTMLInputElement).value, doc))}
              />
            {/if}
          {/if}
        </div>
      {/each}
    </section>

    {#if argSplit.optional.length > 0}
      <section class="vm-inspector-section">
        <details class="vm-inspector-details">
          <summary class="vm-inspector-section-title vm-inspector-section-title--summary">
            <span class="vm-inspector-section-title-text">Optional inputs</span>
            <span class="vm-inspector-count-chip">{argSplit.optional.length}</span>
          </summary>
          <div class="vm-inspector-details-body">
            {#each argSplit.optional as key (key)}
              {@const value = selectedStep.args?.[key]}
              {@const doc = argDocFor(selectedMeta, key)}
              {@const mode = argMode(key, value)}
              {@const ref = parseRef(value)}
              <div class="vm-inspector-arg">
                <div class="vm-inspector-arg-label">
                  <span class="vm-inspector-arg-label-text">
                    {doc?.label ?? key}
                    {#if doc?.help}
                      <span
                        class="vm-inspector-help-icon"
                        role="img"
                        tabindex="0"
                        aria-label={doc.help}
                        title={doc.help}>?</span>
                    {/if}
                  </span>
                </div>

                <div class="vm-mode-toggle" role="tablist" aria-label="Input mode">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === "ref"}
                    class:vm-mode-toggle-btn--active={mode === "ref"}
                    class="vm-mode-toggle-btn"
                    onclick={() => setArgMode(key, "ref")}
                    disabled={upstreamSteps.length === 0 && mode !== "ref"}
                  >Use upstream</button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === "lit"}
                    class:vm-mode-toggle-btn--active={mode === "lit"}
                    class="vm-mode-toggle-btn"
                    onclick={() => setArgMode(key, "lit")}
                  >Fixed value</button>
                </div>

                {#if mode === "ref"}
                  {@const currentStep = ref?.step ?? ""}
                  {@const currentField = ref?.field ?? ""}
                  {@const chosen = upstreamSteps.find((u) => u.as === currentStep)}
                  <div class="vm-ref-picker">
                    <label class="vm-ref-picker-row">
                      <span class="vm-ref-picker-label">Use the result of…</span>
                      <select
                        class="vm-text-input"
                        value={currentStep}
                        onchange={(e) => {
                          const v = (e.target as HTMLSelectElement).value;
                          if (!v) return;
                          commitRefPick(key, v, null);
                        }}
                      >
                        <option value="" disabled>(pick a step)</option>
                        {#each upstreamSteps as up (up.as)}
                          <option value={up.as}>{up.as}</option>
                        {/each}
                      </select>
                    </label>
                    {#if chosen}
                      <label class="vm-ref-picker-row">
                        <span class="vm-ref-picker-label">Which part of its output?</span>
                        <select
                          class="vm-text-input"
                          value={currentField}
                          onchange={(e) => {
                            const v = (e.target as HTMLSelectElement).value;
                            commitRefPick(key, currentStep, v || null);
                          }}
                        >
                          <option value="">whole output</option>
                          {#each chosen.fields as f (f)}
                            <option value={f}>{f}</option>
                          {/each}
                        </select>
                      </label>
                      <p class="vm-ref-picker-caption">
                        This step will receive the {currentField || "whole output"} of {currentStep}.
                      </p>
                    {/if}
                  </div>
                {:else}
                  {#if doc?.shape === "number"}
                    <input
                      type="number"
                      class="vm-text-input"
                      value={typeof value === "number" ? value : ""}
                      onchange={(e) => setStepArg(selectedStep.as, key, parseInputValue((e.target as HTMLInputElement).value, doc))}
                    />
                  {:else if doc?.shape === "bool"}
                    <label class="vm-bool-toggle">
                      <input
                        type="checkbox"
                        checked={value === true}
                        onchange={(e) => setStepArg(selectedStep.as, key, (e.target as HTMLInputElement).checked)}
                      />
                      <span>{value === true ? "Yes" : "No"}</span>
                    </label>
                  {:else if doc?.shape === "enum"}
                    <select
                      class="vm-text-input"
                      value={typeof value === "string" ? value : ""}
                      onchange={(e) => setStepArg(selectedStep.as, key, (e.target as HTMLSelectElement).value)}
                    >
                      <option value="" disabled>(choose…)</option>
                      {#each doc.enumOptions ?? [] as opt (opt.value)}
                        <option value={opt.value}>{opt.label}</option>
                      {/each}
                    </select>
                  {:else if doc?.shape === "textarea"}
                    <textarea
                      class="vm-text-input vm-text-area"
                      value={valueToInput(value)}
                      rows={3}
                      onchange={(e) => setStepArg(selectedStep.as, key, parseInputValue((e.target as HTMLTextAreaElement).value, doc))}
                    ></textarea>
                  {:else if doc?.shape === "docId"}
                    <input
                      type="text"
                      class="vm-text-input"
                      placeholder="Type a note path…"
                      value={typeof value === "string" ? (isPlaceholder(value) ? "" : value) : ""}
                      onchange={(e) => setStepArg(selectedStep.as, key, (e.target as HTMLInputElement).value)}
                    />
                  {:else if doc?.shape === "docList"}
                    {@const list = Array.isArray(value) ? value : []}
                    <div class="vm-doc-list">
                      {#if list.length === 0}
                        <p class="vm-inspector-empty">No notes yet.</p>
                      {/if}
                      {#each list as entry, i (i)}
                        <div class="vm-doc-list-row">
                          <input
                            type="text"
                            class="vm-text-input"
                            placeholder="Type a note path…"
                            value={typeof entry === "string" ? (isPlaceholder(entry) ? "" : entry) : ""}
                            onchange={(e) => {
                              const next = [...list];
                              next[i] = (e.target as HTMLInputElement).value;
                              setStepArg(selectedStep.as, key, next);
                            }}
                          />
                          <button
                            type="button"
                            class="vm-inspector-mini-btn"
                            title="Remove this note"
                            onclick={() => {
                              const next = list.filter((_, j) => j !== i);
                              setStepArg(selectedStep.as, key, next);
                            }}
                          >×</button>
                        </div>
                      {/each}
                      <button
                        type="button"
                        class="vm-inspector-mini-btn"
                        onclick={() => setStepArg(selectedStep.as, key, [...list, ""])}
                      >+ Add note</button>
                    </div>
                  {:else if doc?.shape === "composite"}
                    <div class="vm-inspector-advanced-chip">Advanced: raw value, no picker yet</div>
                    <textarea
                      class="vm-text-input vm-text-area"
                      value={valueToInput(value)}
                      rows={2}
                      onchange={(e) => setStepArg(selectedStep.as, key, (e.target as HTMLTextAreaElement).value)}
                    ></textarea>
                  {:else if doc?.shape === "json"}
                    <div class="vm-inspector-advanced-chip">Advanced — JSON value</div>
                    <textarea
                      class="vm-text-input vm-text-area vm-text-input--mono"
                      value={valueToInput(value)}
                      rows={3}
                      onchange={(e) => setStepArg(selectedStep.as, key, parseInputValue((e.target as HTMLTextAreaElement).value, doc))}
                    ></textarea>
                  {:else}
                    <input
                      type="text"
                      class="vm-text-input"
                      value={valueToInput(value)}
                      placeholder={isPlaceholder(value) ? "(empty — fill me)" : ""}
                      onchange={(e) => setStepArg(selectedStep.as, key, parseInputValue((e.target as HTMLInputElement).value, doc))}
                    />
                  {/if}
                {/if}
              </div>
            {/each}
          </div>
        </details>
      </section>
    {/if}

    <section class="vm-inspector-section">
      <h3 class="vm-inspector-section-title">
        <span class="vm-inspector-section-title-text">Connected to</span>
        <span
          class="vm-inspector-help-icon"
          role="img"
          tabindex="0"
          aria-label="Other steps that use the result of this step."
          title="Other steps that use the result of this step.">?</span>
      </h3>
      {#if usedBy.length === 0}
        <p class="vm-inspector-empty">No downstream step uses this step yet. Connect this step's right connection to another step on the canvas to feed its output forward.</p>
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

    <section class="vm-inspector-section">
      <details class="vm-inspector-details">
        <summary class="vm-inspector-section-title vm-inspector-section-title--summary">
          <span class="vm-inspector-section-title-text">Output preview</span>
        </summary>
        <p class="vm-inspector-details-body">
          <code class="vm-inspector-step-output-shape">{selectedMeta.outputShape}</code>
        </p>
      </details>
    </section>
    {/key}
  {:else}
    <!-- ─── Mode B: contract overview ─── -->
    <header class="vm-inspector-header">
      <h2 class="vm-inspector-step-title">Contract overview</h2>
      <p class="vm-inspector-step-subtitle">A workflow your AI agent can run on this vault.</p>
      <details class="vm-inspector-details">
        <summary class="vm-inspector-details-summary">What is a contract?</summary>
        <p class="vm-inspector-details-body">
          Pick one or more steps from the left palette, drag them onto the canvas, connect them,
          and define inputs. Then any MCP-aware agent can invoke it by name.
        </p>
      </details>
    </header>

    <section class="vm-inspector-section">
      <h3 class="vm-inspector-section-title">
        <span class="vm-inspector-section-title-text">Name</span>
        <span
          class="vm-inspector-help-icon"
          role="img"
          tabindex="0"
          aria-label={`Lowercase letters and hyphens — like "monday-status". Must be unique in the vault. This is the name agents use to call the contract.`}
          title={`Lowercase letters and hyphens — like "monday-status". Must be unique in the vault. This is the name agents use to call the contract.`}>?</span>
      </h3>
      <input
        type="text"
        class="vm-text-input"
        class:vm-text-input--invalid={nameError !== null}
        bind:value={nameDraft}
        onblur={commitName}
        onkeydown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {#if nameError}
        <p class="vm-inspector-inline-error" role="alert">{nameError}</p>
        {#if nameSuggestion}
          <button
            type="button"
            class="vm-inspector-fix-chip"
            onclick={applyNameSuggestion}
          >Did you mean: <code>{nameSuggestion}</code>?</button>
        {/if}
      {/if}
    </section>

    <section class="vm-inspector-section">
      <h3 class="vm-inspector-section-title">
        <span class="vm-inspector-section-title-text">Description</span>
        <span
          class="vm-inspector-help-icon"
          role="img"
          tabindex="0"
          aria-label={'One paragraph. State what the contract DOES (e.g. "Compile a meeting-prep brief from linked context") — not how. Agents see this when choosing which contract to run.'}
          title={'One paragraph. State what the contract DOES (e.g. "Compile a meeting-prep brief from linked context") — not how. Agents see this when choosing which contract to run.'}>?</span>
      </h3>
      <textarea
        class="vm-text-input vm-text-area"
        value={file.contract.description ?? ""}
        rows={3}
        oninput={(e) => setContractField("description", (e.target as HTMLTextAreaElement).value)}
      ></textarea>
    </section>

    <section class="vm-inspector-section">
      <h3 class="vm-inspector-section-title">
        <span class="vm-inspector-section-title-text">At a glance</span>
        <span
          class="vm-inspector-help-icon"
          role="img"
          tabindex="0"
          aria-label="Quick counts of the contract's pieces."
          title="Quick counts of the contract's pieces.">?</span>
      </h3>
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
          <span class="vm-inspector-stats-label">save result</span>
        </li>
      </ul>
    </section>

    {#if tips.length > 0}
      <section class="vm-inspector-section">
        <h3 class="vm-inspector-section-title">
          <span class="vm-inspector-section-title-text">Tips</span>
        </h3>
        <ul class="vm-inspector-tips">
          {#each tips as tip (tip.text)}
            <li class="vm-inspector-tip vm-inspector-tip--{tip.kind}">{tip.text}</li>
          {/each}
        </ul>
      </section>
    {/if}
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
    display: flex;
    align-items: center;
    gap: var(--size-2-2);
    flex-wrap: wrap;
  }
  .vm-inspector-step-verb-badge {
    font-family: var(--font-monospace);
    font-size: var(--font-smaller);
    color: var(--text-faint);
    background: var(--background-modifier-border);
    padding: 1px 6px;
    border-radius: var(--radius-s);
    font-weight: var(--font-normal);
  }
  .vm-inspector-step-output-shape {
    font-family: var(--font-monospace);
    font-size: var(--font-smaller);
    color: var(--text-muted);
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
    display: flex;
    align-items: center;
    gap: var(--size-2-2);
    font-size: var(--font-ui-smaller);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .vm-inspector-section-title--summary {
    cursor: pointer;
    user-select: none;
  }
  .vm-inspector-section-title--summary:hover {
    color: var(--text-normal);
  }
  .vm-inspector-section-title-text {
    flex: 0 0 auto;
  }
  .vm-inspector-count-chip {
    margin-left: auto;
    background: var(--background-modifier-border);
    color: var(--text-muted);
    border-radius: 999px;
    padding: 0 var(--size-2-2);
    font-size: var(--font-smaller);
    font-weight: var(--font-normal);
    text-transform: none;
    letter-spacing: 0;
  }
  .vm-inspector-help-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--background-modifier-border);
    color: var(--text-muted);
    font-size: 10px;
    font-weight: var(--font-semibold);
    cursor: help;
    text-transform: none;
    user-select: none;
  }
  .vm-inspector-help-icon:hover,
  .vm-inspector-help-icon:focus-visible {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    outline: none;
  }
  .vm-inspector-details {
    margin-top: var(--size-2-3);
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    line-height: 1.45;
  }
  .vm-inspector-details-summary {
    cursor: pointer;
    color: var(--text-muted);
    font-weight: var(--font-medium);
    user-select: none;
  }
  .vm-inspector-details-summary:hover {
    color: var(--text-normal);
  }
  .vm-inspector-details-body {
    margin: var(--size-2-2) 0 0;
    color: var(--text-muted);
  }
  .vm-inspector-step-subtitle {
    margin: var(--size-2-2) 0 0;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    line-height: 1.45;
  }
  .vm-inspector-empty {
    margin: 0;
    color: var(--text-faint);
    font-size: var(--font-ui-smaller);
    font-style: italic;
    line-height: 1.5;
  }
  .vm-inspector-inline-error {
    margin: var(--size-2-2) 0 0;
    color: var(--text-error);
    font-size: var(--font-ui-smaller);
    line-height: 1.4;
  }
  .vm-inspector-fix-chip {
    margin: var(--size-2-2) 0 0;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px var(--size-2-2);
    background: color-mix(in srgb, var(--interactive-accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--interactive-accent) 40%, transparent);
    border-radius: var(--radius-s);
    font-size: var(--font-ui-smaller);
    color: var(--text-normal);
    cursor: pointer;
  }
  .vm-inspector-fix-chip code {
    font-family: var(--font-monospace);
    color: var(--text-accent);
  }
  .vm-inspector-fix-chip:hover {
    background: color-mix(in srgb, var(--interactive-accent) 22%, transparent);
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
  .vm-inspector-required {
    color: var(--text-error);
    margin-left: 2px;
  }

  /* ── Mode toggle ── */
  .vm-mode-toggle {
    display: inline-flex;
    gap: 2px;
    background: var(--background-modifier-border);
    padding: 2px;
    border-radius: var(--radius-s);
    width: fit-content;
  }
  .vm-mode-toggle-btn {
    border: none;
    background: transparent;
    padding: 2px var(--size-2-2);
    font-size: var(--font-smaller);
    color: var(--text-muted);
    cursor: pointer;
    border-radius: var(--radius-s);
  }
  .vm-mode-toggle-btn:hover:not(:disabled) {
    color: var(--text-normal);
  }
  .vm-mode-toggle-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .vm-mode-toggle-btn--active {
    background: var(--background-primary);
    color: var(--text-normal);
    box-shadow: 0 0 0 1px var(--background-modifier-border);
  }

  /* ── Reference picker ── */
  .vm-ref-picker {
    display: flex;
    flex-direction: column;
    gap: var(--size-2-2);
    padding: var(--size-2-2);
    background: color-mix(in srgb, var(--interactive-accent) 6%, transparent);
    border: 1px solid color-mix(in srgb, var(--interactive-accent) 25%, transparent);
    border-radius: var(--radius-s);
  }
  .vm-ref-picker-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .vm-ref-picker-label {
    font-size: var(--font-smaller);
    color: var(--text-muted);
  }
  .vm-ref-picker-caption {
    margin: 0;
    font-size: var(--font-smaller);
    color: var(--text-faint);
    font-style: italic;
  }

  /* ── Doc list ── */
  .vm-doc-list {
    display: flex;
    flex-direction: column;
    gap: var(--size-2-1);
  }
  .vm-doc-list-row {
    display: flex;
    align-items: center;
    gap: var(--size-2-2);
  }
  .vm-doc-list-row .vm-text-input {
    flex: 1;
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
  .vm-text-input--invalid {
    border-color: var(--text-error);
  }
  .vm-text-input--mono {
    font-family: var(--font-monospace);
  }
  .vm-text-area {
    resize: vertical;
    min-height: 4em;
    font-family: var(--font-interface);
  }

  .vm-bool-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--size-2-2);
    color: var(--text-normal);
  }

  .vm-inspector-mini-btn {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    color: var(--text-muted);
    padding: 2px var(--size-2-2);
    font-size: var(--font-smaller);
    cursor: pointer;
    width: fit-content;
  }
  .vm-inspector-mini-btn:hover {
    color: var(--text-normal);
    background: var(--background-secondary);
  }

  .vm-inspector-advanced-chip {
    display: inline-flex;
    align-items: center;
    padding: 1px var(--size-2-2);
    background: color-mix(in srgb, var(--text-warning) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--text-warning) 35%, transparent);
    color: var(--text-warning);
    border-radius: var(--radius-s);
    font-size: var(--font-smaller);
    width: fit-content;
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
