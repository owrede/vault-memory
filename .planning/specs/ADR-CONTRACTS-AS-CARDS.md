# ADR — Contracts as Composable Cards

- **Status:** Proposed
- **Date:** 2026-05-22
- **Author:** owrede@gmail.com (drafted by agent)
- **Supersedes / extends:** ADR-006 (Task Contract DSL) — additive only
- **Affects:** `src/contracts/schema.ts`, `src/contracts/runner.ts` (instantiate path), `plugin/src/views/contract-editor/**`, `plugin/src/shared-types.ts`
- **Scope:** Local-first composition only. Remote-library composition is sketched, not designed.

---

## 1. Context

### 1.1 Where we are today

The contract DSL shipped in Phase 6 (ADR-006) treats a `.contract` file as an **atomic, non-composable** procedure: one closed-enum verb per step, one `write_back` block at the end. The closed set is

```
search_hybrid · expand · cluster · recall · compile_brief · get_brief ·
query_frontmatter · list_backlinks · get_outline · search_sections ·
read_note · literal · mcp://<server>/<tool>
```

Every step is a leaf — it dispatches to a single vault-memory or peer-MCP tool. There is no way for one contract to invoke another contract as a single step. The result, observed in the three production examples
(`meeting-prep`, `code-review-brief`, `project-status`):

- The `expand` → `cluster` → `compile_brief` chain is duplicated almost verbatim across all three contracts.
- `read_note → search_hybrid → compile_brief` is duplicated between `code-review-brief` and any future "review-with-context" contract.
- An agent who wanted a "Q2 OKR review" contract would have to inline-copy 12 steps from `meeting-prep` plus 4 from `project-status`, then diverge by 3 lines.

This is the **DRY-violation-at-the-DSL-layer** symptom. The contract DSL is currently a *macro language without subroutines*. ADR-006 §Decision 1 framed this as acceptable for v2.0.0 in exchange for a closed-enum safety surface, with the understanding that composition would be revisited.

### 1.2 The user's mental model

The user has framed contracts as functions:

> "A contract is like a function, that could be used in a more abstract higher-level contract. So if there is a contract for 'identify-participants' then a 'meeting-prep' contract could just use the 'identify-participants' contract."

This is the right framing. A contract has:

- a name (`identify-participants`) — function symbol,
- an `inputs` schema — typed parameters,
- an `output_shape` — return type,
- an `assembly` — body,
- a `write_back` — side-effect declaration.

The only piece missing for the function metaphor to close is **call by name**.

### 1.3 The bigger arc

Local composition is also the prerequisite for the **org-wide Contract Library** the user described:

> "Further down the line: it could be local contracts but also remote ones in a organisation-wide 'Contract Library' that would need to be exposed via MCP."

Once the call-by-name machinery exists locally, the only thing that distinguishes a remote contract is the **resolver** — the bit that turns a name into a parsed `ContractFileShape`. Designing the local case carefully now makes the remote case incremental, not architectural.

### 1.4 Why now

Three pressures align:

1. **UX**: the redesign Slices A/B/C (palette / canvas / inspector) ship in 2.0.0–2.3.0. Adding a "Local contracts" source-type to the palette is a strictly additive UI affordance, easier to land now than after the palette ossifies.
2. **DSL**: ADR-006 reserves `mcp://<server>/<tool>` as an extension pattern. We can mirror it with `contract://<name>` without breaking the closed-enum invariant (C-1 from ADR-006).
3. **Memory namespace**: the safety invariant (writes only via `DeliveryAdapter` to a labeled `MemorySink`) is **strengthened** by composition — a called contract's `write_back` is checked by the same validator as a top-level contract's. Composition does *not* require relaxing C-3.

---

## 2. Decision

### 2.1 In one sentence

**A contract step MAY invoke another contract by name. The call appears in the assembly as a verb of the form `contract://<kebab-case-name>`. The called contract's `inputs` map to the calling step's `args`. The called contract's `output_shape` is what subsequent steps see via `{{<alias>.<field>}}`.**

### 2.2 Why a `contract://` verb form, not a new top-level step kind

Two designs were considered:

| Option | Shape | Pros | Cons |
|---|---|---|---|
| **A. New verb form `contract://<name>`** | `{ as: "participants", verb: "contract://identify-participants", args: {...} }` | Zero new step shapes. Mirrors `mcp://`. Same alias / args / `{{}}` rules. One Zod union widening. Existing canvas drop-handler works with one branch added. | Verb URL gets longer; `contract://` is *not* an MCP tool name. |
| **B. New top-level `call` field** | `{ as: "participants", call: "identify-participants", args: {...} }` | Visually clear; "call" reads like a function call. | Two divergent step shapes (`verb` vs `call`). Every consumer (runner, canvas, inspector, frontmatter-suggester, eval harness) gets a discriminated-union branch. YAML round-trip rules double. Backward-compat surface doubles. |

**Recommendation: Option A.**

The win on Option A is **structural homogeneity**: every step is still `{as, verb, args?, value?}`. The only thing that changes is the regex on `verb`. Every downstream consumer that already handles `mcp://` gets `contract://` "for free", and the canvas/inspector get a category-discriminator (`contract-call`) without needing a step-kind tag. The closed-enum safety surface (C-1) is preserved: `contract://` is as enumerable and as inspectable as `mcp://`.

The cost on Option A is purely cosmetic — a power user reading the YAML sees `verb: contract://identify-participants`, which is slightly weirder than `call: identify-participants` but unambiguous and grep-friendly.

### 2.3 Calling convention

Given a callee contract `identify-participants` declared as:

```yaml
# _contracts/identify-participants.contract
version: 1
name: identify-participants
inputs:
  meeting_doc_id: { $ref: "#/types/DocId" }
  hops: { type: integer, default: 1 }
required: [meeting_doc_id]
assembly:
  - as: meeting
    verb: read_note
    args: { doc_id: "{{inputs.meeting_doc_id}}" }
  - as: linked
    verb: expand
    args:
      seed_doc_ids: ["{{inputs.meeting_doc_id}}"]
      hops: "{{inputs.hops}}"
output_shape:
  participants: { type: array }
```

A caller invokes it as:

```yaml
# _contracts/meeting-prep.contract
assembly:
  - as: participants
    verb: contract://identify-participants
    args:
      meeting_doc_id: "{{inputs.meeting_doc_id}}"
      hops: 1
  - as: brief
    verb: compile_brief
    args:
      source_doc_ids: "{{participants.participants}}"
      purpose: "Meeting prep"
```

Calling rules:

1. **Arg keys MUST be a subset of the callee's `inputs` keys.** Validated at edit time (canvas validation) and at instantiate time (runner). Unknown keys produce a typed error pointing at the offending key.
2. **Every callee `required` input MUST have a corresponding caller arg.** Same validation surface.
3. **The callee's `output_shape` becomes the alias's accessible shape.** `{{participants.participants}}` resolves to `output_shape.participants` of the callee's last-step return.
4. **The callee's `write_back`, if present, fires when the call executes.** The caller does NOT see write-back output via the alias; it sees `output_shape`. Write-back is a side effect, not a return.
5. **The callee's `sources` / `sinks` are scoped to the callee invocation.** The caller cannot rebind them at the call site in v1; they're resolved from the callee file's own declarations. (See §9 for the open question on rebindable sinks.)

### 2.4 Visual representation

On the canvas, a contract-call step is a **distinct node category** rendered alongside the existing 6 verb categories. Specifically:

- New `VerbCategory` value: `"contract-call"`.
- Icon: `git-branch` (Lucide).
- Colour: a new CSS var assignment — `--color-pink` (Obsidian ships it) — visibly different from the existing 6.
- Visual differentiator: the node renders with a **double-bordered frame** (a 2px outer outline at 4px offset from the standard node border). The doubled frame reads as "this is a container, not a leaf step" at a glance.
- Badge: bottom-right corner of the node shows `↳ contract` with the callee's name (kebab-case, ≤ 24 chars, ellipsis on overflow).

Selection of a contract-call node opens an inspector pane (see §6.4) with the called contract's name, version, source path, input args (editable), and an **"Edit this contract"** button.

### 2.5 Zoom-in navigation

Double-clicking a contract-call node "zooms in":

- Opens the called `.contract` file in a new contract-editor tab (Obsidian leaf).
- The new tab's title bar shows a breadcrumb: `meeting-prep › identify-participants`.
- Breadcrumb segments are clickable: clicking `meeting-prep` returns to the parent (does not close the child).
- The child tab is a real Obsidian leaf; closing it returns focus to the parent.
- The breadcrumb tracks a session-scoped navigation stack stored on the editor view instance — it is NOT persisted to the `.contract` file.

The zoom-in is **read-by-default, edit-by-confirmation**. The child editor opens in read-only mode with an "Edit" button in the toolbar that flips it to write mode. This prevents accidental mutation of a shared callee when the user only wanted to peek.

---

## 3. Schema changes

### 3.1 `VerbSchema` widening

Current (`src/contracts/schema.ts:39-48`):

```typescript
const MCP_VERB_RE = /^mcp:\/\/[a-z][a-z0-9_-]*\/[a-z][a-z0-9_-]*$/;

const VerbSchema = z.union([
  z.enum([...BASELINE_VERBS, "literal"]),
  z.string().regex(MCP_VERB_RE),
]);
```

Proposed:

```typescript
const MCP_VERB_RE = /^mcp:\/\/[a-z][a-z0-9_-]*\/[a-z][a-z0-9_-]*$/;
const CONTRACT_VERB_RE = /^contract:\/\/[a-z][a-z0-9-]*$/;

const VerbSchema = z.union([
  z.enum([...BASELINE_VERBS, "literal"]),
  z.string().regex(MCP_VERB_RE),
  z.string().regex(CONTRACT_VERB_RE),
]);
```

The regex deliberately matches the **same kebab-case constraint** already enforced on the `name` field of `ContractFileSchema` (`/^[a-z][a-z0-9-]*$/`). This means: if it parses as a valid contract name, it can appear after `contract://`.

### 3.2 Helper exports

Add to `src/contracts/schema.ts`:

```typescript
export const CONTRACT_VERB_PREFIX = "contract://" as const;

/** Returns the callee name if `verb` is a contract-call, else null. */
export function parseContractCall(verb: string): string | null {
  if (!verb.startsWith(CONTRACT_VERB_PREFIX)) return null;
  const name = verb.slice(CONTRACT_VERB_PREFIX.length);
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return null;
  return name;
}

/** True iff this step invokes another contract. */
export function isContractCall(step: { verb: string }): boolean {
  return parseContractCall(step.verb) !== null;
}
```

These helpers are pure and live in the schema module — they have zero adapter dependencies and can be imported anywhere (server, runner, plugin, eval harness).

### 3.3 No changes to `StepSchema`

`StepSchema` is unchanged. Its shape (`{as, verb, args?, value?}`) already accommodates the new verb form because `verb: VerbSchema` admits the new pattern automatically.

### 3.4 No changes to `WriteBackSchema`

A contract-call step cannot itself declare a `write_back` — the *callee's* `write_back` fires on invocation, and the *caller's* top-level `write_back` (if any) fires at the end of the caller's assembly. Two write-back blocks per invocation are explicitly OK and intentional: they go to different sinks declared by different files, validated by the same `DeliveryAdapter`.

### 3.5 Backward compatibility

Every existing `.contract` file MUST continue to parse without modification.

**Verification:** the change to `VerbSchema` is a `z.union` widening — strictly additive. No existing verb matches `CONTRACT_VERB_RE` (the `mcp://` prefix doesn't match, and the closed enum entries don't match because they lack `://`). The Phase 6 invariant test (`src/contracts/schema.test.ts:*round-trip*`) will pass unchanged.

A new test will assert:

```typescript
it("rejects a contract-call verb with invalid name shape", () => {
  expect(() => VerbSchema.parse("contract://Bad_Name")).toThrow();
  expect(() => VerbSchema.parse("contract://")).toThrow();
  expect(() => VerbSchema.parse("contract:///foo")).toThrow();
});

it("accepts a well-formed contract-call verb", () => {
  expect(VerbSchema.parse("contract://identify-participants"))
    .toBe("contract://identify-participants");
});
```

### 3.6 YAML round-trip

A contract-call step in YAML looks like any other step:

```yaml
- as: participants
  verb: contract://identify-participants
  args:
    meeting_doc_id: "{{inputs.meeting_doc_id}}"
    hops: 1
```

The existing YAML loader (`src/contracts/yaml-loader.ts`) calls `ContractFileSchema.parse(parseDocument(text).toJS())` and is therefore unaffected. The companion `.contract` JSON envelope used by the plugin (`plugin/src/shared-types.ts` `ContractDocumentShape`) embeds `ContractFileShape` directly via `contract:` and likewise needs no envelope change.

The Slice B canvas-pane drop handler does not need a YAML-comment hook — the verb string itself carries the call.

---

## 4. Cycle detection

A contract that directly or transitively calls itself would loop forever. Cycle detection is **enforced in two places**, with the canvas refusing the operation before save and the runner refusing the operation before execution.

### 4.1 At edit time (canvas)

When the user drags a contract card onto the canvas, the canvas validation runs **before** committing the step to `file.contract.assembly`:

1. Read the callee contract from the vault.
2. Walk the callee's `assembly` BFS, collecting every transitive `contract://` reference.
3. If the *current contract's name* appears anywhere in that walk → reject the drop.

The rejection is visual: the dragged ghost-card displays a red `⊘` overlay during drag-over, the drop event is consumed but no step is appended, and a Notice fires:

> "Cannot add `identify-participants` here — it would create a cycle (identify-participants → meeting-prep → identify-participants)."

The cycle path is computed and shown so the user understands *why*. Implementation lives in `plugin/src/views/contract-editor/canvas/cycle-check.ts` (new file).

### 4.2 At instantiate time (runner)

The MCP server's `instantiate_contract` handler (in `src/contracts/instantiate.ts`) performs the same BFS walk before any verb dispatches. On detection:

```json
{
  "ok": false,
  "error": "contract_cycle",
  "message": "Contract 'identify-participants' calls itself transitively via: identify-participants → meeting-prep → identify-participants",
  "cycle": ["identify-participants", "meeting-prep", "identify-participants"]
}
```

This is the second line of defence: an externally-edited `.contract` file (one not authored through the canvas) is caught at runtime even if the canvas check is bypassed.

### 4.3 Detection algorithm

```typescript
// src/contracts/cycle.ts (new)
export function detectCycle(
  rootName: string,
  resolve: (name: string) => ContractFileShape | null,
): { hasCycle: boolean; path: string[] } {
  const visiting = new Set<string>();
  const path: string[] = [];

  function dfs(name: string): boolean {
    if (visiting.has(name)) {
      path.push(name);
      return true;
    }
    const callee = resolve(name);
    if (!callee) return false; // unresolved callee is a different error
    visiting.add(name);
    path.push(name);
    for (const step of callee.assembly) {
      const called = parseContractCall(step.verb);
      if (called && dfs(called)) return true;
    }
    visiting.delete(name);
    path.pop();
    return false;
  }

  return { hasCycle: dfs(rootName), path };
}
```

The check is **synchronous and pure** — it operates on parsed `ContractFileShape` objects provided by an injected `resolve` function. The resolver knows how to find a contract by name (filesystem on the server, vault scan in the plugin). Cycle detection itself is adapter-free.

### 4.4 Detection by name, not by content

Cycles are detected by **callee name**. Renaming a contract that participates in a cycle (e.g. renaming `identify-participants` to `find-participants`) does not paper over the cycle — the next save or instantiate triggers the detection on the renamed graph. Stale references to the old name surface as "callee not found" errors, which is correct behaviour (rename support is a separate concern; see §9).

---

## 5. Resolution & scoping

### 5.1 How a name resolves

A contract reference like `contract://identify-participants` resolves to a `.contract` file via a layered lookup:

1. **Vault-local first.** The plugin scans every `*.contract` file under the active vault for one whose `contract.name === "identify-participants"`. The canonical location is `_contracts/` at the vault root, but ad-hoc placement is allowed.
2. **(Future) Remote registry.** If not found locally and a remote registry is configured, query the registry. Out of scope for Phase 1–5; see §8.
3. **Else error.** Resolution failure is a typed error (`unresolved_callee`) returned both at edit time and at instantiate time.

### 5.2 Precedence on collision

What if two `.contract` files in the same vault both declare `name: identify-participants`?

**Recommendation: enforce vault-wide uniqueness at save time.**

The plugin's contract-editor save path runs a duplicate check before committing:

```typescript
// plugin/src/views/contract-editor/save.ts (new check)
async function checkNameUniqueness(name: string, currentPath: string): Promise<void> {
  const conflict = await scanVaultForContractByName(name, { excludePath: currentPath });
  if (conflict) {
    throw new ContractSaveError(
      `A contract named '${name}' already exists at ${conflict.path}. ` +
      `Rename one of them before saving.`,
    );
  }
}
```

The MCP server's contract loader applies the same check at startup: if duplicates are detected, the server logs a warning and uses the **lexicographically-first path** as authoritative, but `list_contracts` returns both with a `shadowed: true` flag on the loser.

Rationale: a contract's name is its function symbol. Shadowing semantics in a function-symbol space are confusing and rarely what the user wants. Enforcing uniqueness at the canvas save path catches the issue at authoring time when it's cheap to fix.

### 5.3 What is NOT versioned

In v1 of this feature, callees are resolved by **name only** — there is no `contract://identify-participants@1.2.0` pinning. A caller always picks up the current version of the callee. This is consistent with how today's contracts treat MCP tool calls (no version pin on `mcp://server/tool`). Versioning is on the open-questions list (§9).

### 5.4 Resolution caching

The plugin maintains an in-memory `Map<string, { path: string; contract: ContractFileShape }>` keyed by contract name. The map is rebuilt on:

- vault file-watcher event for `*.contract` files (Obsidian's `vault.on("create"|"delete"|"rename"|"modify")`),
- editor-tab open (defensive — costs a few file reads),
- explicit user action via the palette refresh button.

This keeps the canvas-drag cycle-check responsive (no I/O during drag-over) and the inspector's "open callee" button fast.

---

## 6. UI changes

### 6.1 Palette: new "Local contracts" source-type

The Slice A palette has a SOURCES dropdown listing MCP servers. We add a sibling source-type:

```
SOURCES
├─ Verbs (built-in)                ← always present
├─ MCP servers
│  ├─ filesystem                   ← existing
│  └─ git                          ← existing
└─ Contracts
   ├─ Local                        ← NEW
   └─ Remote: my-org-library       ← FUTURE (§8)
```

Selecting "Contracts > Local" populates the palette body with one card per `.contract` file in the vault, grouped under a single section heading "Local contracts" (no further sub-grouping for now). Each card shows:

- The contract's `name` (kebab-case, large).
- A muted-text path (`_contracts/identify-participants.contract`).
- The `description` field's first line, ellipsized at ~80 chars.
- Hover: full description + input-schema preview in a tooltip.

The cards use the new `contract-call` category styling (double border, `git-branch` icon, `--color-pink`). They are draggable in exactly the same way as verb cards — via the `application/x-vault-memory-verb` MIME type, with the verb string set to `contract://<name>`.

Implementation lives in `plugin/src/views/contract-editor/palette/contract-source.ts` (new file). The catalog of local contracts is provided by the same in-memory map as §5.4.

### 6.2 Drag-from-file-explorer

The user can also drag a `.contract` file directly from Obsidian's native File Explorer onto the canvas. This works because Obsidian sets a known MIME on file drags. The canvas drop handler is extended:

```typescript
function onDrop(event: DragEvent): void {
  event.preventDefault();

  // Existing path: a palette verb drag.
  const verb = event.dataTransfer?.getData("application/x-vault-memory-verb");
  if (verb) { /* … existing logic … */ return; }

  // NEW path: a file-explorer drag of one or more files.
  const obsidianPath = event.dataTransfer?.getData("text/plain");
  if (obsidianPath && obsidianPath.endsWith(".contract")) {
    const calleeName = readContractNameFromPath(obsidianPath);
    if (!calleeName) return;
    if (calleeName === file.contract.name) {
      new Notice("Cannot drop a contract onto itself.");
      return;
    }
    // Cycle check (see §4.1).
    const { hasCycle, path } = detectCycle(calleeName, resolveByName);
    if (hasCycle) { new Notice(`Cycle: ${path.join(" → ")}`); return; }

    const alias = nextAlias(file.contract.assembly.map((s) => s.as));
    const newStep = {
      as: alias,
      verb: `contract://${calleeName}`,
      args: defaultArgsFromCalleeInputs(calleeName),
    };
    // … same insertion as verb-drop branch …
  }
}
```

`readContractNameFromPath` reads the file via the plugin's already-cached map. `defaultArgsFromCalleeInputs` populates `args` with `?{{inputs.<key>}}` placeholders for each of the callee's `required` inputs, mirroring how verb-catalog `defaultArgs` work today.

### 6.3 Canvas card visual

A contract-call step renders via a new Svelte component `plugin/src/views/contract-editor/canvas/ContractCallNode.svelte`. It is wired into the canvas alongside `StepNode` and `CommentNode`:

```typescript
const nodeTypes = {
  step: StepNode,
  comment: CommentNode,
  "contract-call": ContractCallNode,  // NEW
} as const;
```

The canvas `buildNodes` function picks the type based on `parseContractCall(step.verb)`:

```typescript
const id = `step:${step.as}`;
const isCall = parseContractCall(step.verb) !== null;
return {
  id,
  type: isCall ? "contract-call" : "step",
  // … rest unchanged …
};
```

`ContractCallNode.svelte` renders:

- A `git-branch` Lucide icon at the standard top-left position.
- The alias as the primary label (same as `StepNode`).
- The callee name (`identify-participants`) in the secondary label position where `StepNode` shows the verb.
- A second border (2px solid `--color-pink`, 4px offset) around the whole node.
- A `↳ contract` badge in the bottom-right corner.
- The standard left/right xyflow handles for connection.

### 6.4 Inspector for a contract-call step

When a contract-call node is selected, the inspector (Slice C) renders a specialized panel:

```
┌─────────────────────────────────────┐
│  ↳ Calls: identify-participants v1  │
│  Source: _contracts/identify-…       │
│  [Open in new tab]                  │
├─────────────────────────────────────┤
│  Description (from callee):         │
│  "Return the participant DocIds…"   │
├─────────────────────────────────────┤
│  Inputs                             │
│  ┌─ meeting_doc_id (required) ──┐   │
│  │ {{inputs.meeting_doc_id}}    │   │
│  └──────────────────────────────┘   │
│  ┌─ hops (optional, default 1) ─┐   │
│  │ 1                            │   │
│  └──────────────────────────────┘   │
├─────────────────────────────────────┤
│  Returns                            │
│  { participants: array }            │
└─────────────────────────────────────┘
```

The "Open in new tab" button triggers the zoom-in navigation (§2.5). The inputs section is dynamically generated from the callee's `inputs` Zod schema (mirroring how today's inspector generates fields from `verb-catalog.argDocs`). Each input field shows the callee's declared type and default value as placeholder.

### 6.5 Breadcrumb navigation

The breadcrumb is rendered as a thin strip above the canvas, in the editor view:

```
meeting-prep  ›  identify-participants
```

Each segment is a button. Clicking returns to that level by activating that tab (which is still open). Visually, the current segment is bold; ancestors are muted-foreground.

The navigation stack is held on the editor view as `private navStack: string[]` (vault-relative paths). Zoom-in pushes; closing the child tab pops; clicking an ancestor segment activates without popping (so the user can dive back in). The stack does NOT persist across Obsidian restarts — it is session-scoped, by design (persisting it would conflate "where did I came from" with "what is this contract").

---

## 7. Implementation phases

Each phase ships independently as its own PR. Phases 1 and 2 are blocking for any user-visible composition; Phases 3–5 are progressive UX polish. Phase 6 is a separate v3 effort.

### Phase 1 — Schema + parser support (no UI)

Widen `VerbSchema` to accept `contract://<name>`, add the `parseContractCall` / `isContractCall` helpers, add the cycle-detection function in `src/contracts/cycle.ts`, and wire the runner (`src/contracts/instantiate.ts`) to recognise the new verb form. The runner's behaviour:

- On encountering a `contract://` step, resolve the callee from disk (or fail with `unresolved_callee`).
- Run the cycle check; fail fast if cyclic.
- Map the calling step's `args` to the callee's `inputs`; validate required inputs are present.
- Execute the callee's assembly inline in the parent's execution context (a single instantiate call internally; do **not** start a new MCP request).
- Bind the callee's final-step output to the calling step's alias.
- If the callee has a `write_back`, fire it before returning.

Ship with unit tests covering: verb shape, cycle detection (1-cycle and 3-cycle), args validation, output binding, and write-back firing. No plugin changes in this phase; tests use programmatic instantiation.

### Phase 2 — Canvas drop-from-file-explorer + contract-call node rendering

Add `ContractCallNode.svelte`, register the node type, extend `buildNodes` to pick the right type via `parseContractCall`, and extend the drop handler to accept Obsidian file drags. Ship the cycle-check on drop. Existing palette is unchanged in this phase — users can only add contract-call steps by drag-from-file-explorer.

This phase is intentionally the smallest possible shippable slice that exposes composition to the user. Before Phase 3 lands, contracts authored on the canvas can already invoke other contracts; only the palette discovery affordance is missing.

### Phase 3 — Palette "Local contracts" source

Add the new source-type to the palette SOURCES dropdown, implement the local-contracts scanner (vault scan + cache), and render contract cards using the existing palette-card pattern. The same `application/x-vault-memory-verb` MIME is reused with the verb string set to `contract://<name>`. The drop path in canvas-pane requires no further changes — it already handles `contract://` verbs from Phase 2's drop handler.

### Phase 4 — Inspector + zoom-in navigation

Add the `ContractCallInspector` Svelte component, wire it into `inspector-pane.svelte` based on the selected step's verb shape, and implement the breadcrumb + tab-stack navigation. Read-by-default-edit-by-confirm semantics for the child tab. Ship a "Back" hotkey (cmd-[ on macOS) for stack-pop convenience.

### Phase 5 — Cycle detection at edit time

Move cycle detection from "fail at save" to "fail at drag-over". The drop handler computes the cycle path during `ondragover` (cheap on a cached resolver) and applies a red `⊘` overlay to the drag ghost. The Notice on drop is preserved as a fallback for keyboard-driven drops (which don't have a visible ghost).

This phase also adds vault-wide uniqueness enforcement at save (§5.2) and the duplicate-name warning at server startup.

### Phase 6 (later, v3) — Remote contract registry

Out of scope for this ADR's deep design. See §8 for direction-setting.

---

## 8. Remote contracts — future direction (sketch)

The user's longer-term vision is an org-wide Contract Library. Detailed design is deferred to v3, but a few principles must be honoured by the v2 local-only design so we don't paint ourselves into a corner.

### 8.1 Protocol

**MCP, not HTTP/JSON.** A remote contract library is an MCP server exposing two tools:

- `list_contracts() → ContractSummary[]` — returns name, description, version, input shape.
- `fetch_contract(name, version?) → ContractFileShape` — returns the full parsed contract.

This means a remote library is configured exactly like an MCP server today (`~/.vault-memory/config.toml` `[mcp]` section) and the existing MCP discovery surface works. The plugin's palette "Remote: my-org-library" source-type is just the local-contracts panel pointed at a different resolver.

### 8.2 Auth

Per-user opaque token in `~/.vault-memory/config.toml`. SSO is the org's problem upstream of the MCP server. The plugin never sees the token directly — it goes through the vault-memory daemon's MCP client.

### 8.3 Trust model

Two layers:

- **Org-vetted contracts** are signed by an org-controlled key. The fetch returns a signature; the daemon verifies. Unsigned contracts from a configured "vetted" registry are rejected.
- **Community contracts** (out of scope for v3 but mentioned for completeness): unsigned but tagged, opt-in per-contract. The UI badges them with a "community" warning.

### 8.4 Versioning

When remote contracts arrive, the `contract://<name>` form is extended to `contract://<name>@<version>`. The version segment is optional; absent means "latest from the registry that resolved the name". Local contracts will accept the `@version` suffix too — it just becomes an assertion checked against the file's `version` field, which then needs to grow from `z.literal(1)` to a semver string. This change is out of scope for v2 but is **forward-compatible**: today's `version: 1` files continue to parse, and tomorrow's `version: "1.2.0"` files extend additively.

### 8.5 Discovery

The remote library's `list_contracts` is paged + searchable by name/description. The palette's "Remote" section gets a search box and an infinite-scroll list. Caching is identical to the local case (a Map keyed by name), with a TTL.

### 8.6 What the v2 local design must NOT preclude

- **Resolver pluggability**: the `resolve(name) → ContractFileShape | null` interface must be the only thing the cycle detector, the runner, and the canvas know about. They MUST NOT bake in "scan the vault filesystem" as their resolution strategy. Phase 1 ships this resolver as a single function passed through; the remote case substitutes a different function.
- **No file-system identity assumption**: a callee does not necessarily have a vault path. The inspector's "Source:" line must accept `(local) _contracts/identify-participants.contract` *or* `(remote) my-org-library/identify-participants@1.2.0` interchangeably.
- **No assumption of synchronous resolution**: a remote resolver is async. The local resolver is async-by-courtesy (it reads files, even if cached). All resolver call sites use `await`.

---

## 9. Risks & open questions

### 9.1 Schema drift between caller and callee

If `identify-participants` adds a new required input but `meeting-prep` doesn't update its call, the runner fails at instantiate time with a `missing_required_input` error. This is correct but unfriendly. Mitigation: the inspector should surface a "schema drift" warning on the calling step when the callee's `inputs` shape no longer matches the caller's `args`, with a one-click "fill defaults" remediation. Tracked as a Phase 4 stretch item.

### 9.2 Recursion depth limit

A non-cyclic but deep call graph (A→B→C→D→…) could still blow the JavaScript stack. **Recommendation: hard cap at depth 16** at the runner. Rationale: real-world contracts compose 2–4 levels deep; 16 is comfortable headroom; the stack frame per call is small but non-trivial (BFS visit + arg-map + output-binding). The cap is enforced in `instantiate.ts` with a `depth: number` accumulator threaded through invocation; exceeding it returns:

```json
{ "ok": false, "error": "max_depth_exceeded", "limit": 16, "path": [...] }
```

The cap should be configurable in `~/.vault-memory/config.toml` `[contracts]` for power users.

### 9.3 Performance of the expanded call graph

A contract that calls 3 sub-contracts, each calling 4 verbs, expands to 12 verb dispatches at runtime. The number can grow geometrically. **Mitigation**: vault-memory's verb dispatcher already batches embedding calls and reuses SQLite connections; the per-verb fixed cost is small. We add a `contracts.call_count` metric to the audit log so we can observe real-world depth/fanout and tune later. No hard limit on fanout in v1 beyond the depth cap.

### 9.4 Privacy / data leakage to remote contracts

A remote contract sees the caller's inputs and writes to the caller's sinks. This is a *significant* trust-model question — out of scope for v2 but worth flagging now. The v3 design must include:

- An "outbound input filter" listing input keys allowed to leave the vault.
- A consent prompt on first use of any remote contract.
- A per-contract privacy summary surfaced in the inspector ("this contract sends meeting_doc_id and your hops parameter to my-org-library").

### 9.5 Sink rebinding at the call site

The current decision is: the callee's sinks are resolved from the callee file. But there are realistic cases where a caller wants to redirect the callee's write_back to a different sink (e.g. write the briefs to `_memory/_team-briefs` instead of `_memory/_briefs` when called from a team-prep contract).

**Open question.** Recommendation: defer. If a user needs this, they can:

- Inline the assembly (deliberate denormalization), or
- Add a `sink_override` input to the callee and reference it in its `write_back: sink: "{{inputs.sink_override}}"`.

The second pattern is already supported today. Adding call-site sink rebinding is a feature for v3 once we have evidence of real demand.

### 9.6 Rename support

Renaming a contract today is a manual find-and-replace across the vault. After composition lands, rename becomes load-bearing: a rename of `identify-participants` would silently break every caller. **Open question.** Recommendation: add a "Rename contract" command in the editor that performs an in-vault find-and-replace of `contract://<old>` → `contract://<new>` across all `.contract` files, scoped to the active vault. Track as a Phase 5 stretch item.

### 9.7 Mocking for tests

Eval fixtures from Phase 0 may want to mock a sub-contract — e.g. test `meeting-prep` against a deterministic stub of `identify-participants`. **Open question.** Recommendation: the eval harness already consumes `Document` objects (per CLAUDE.md constraints), so the resolver interface can be swapped out at eval-harness construction time. A `MockResolver` that maps names to fixture contracts is a few lines. No schema change needed.

### 9.8 What is the precise semantics of "the callee's output_shape becomes the alias's shape"?

Today's runner returns the *last step's output* as the implicit contract output. Once a contract has a declared `output_shape`, that shape is the contract's return — but the runner does not currently enforce it. **Open question.** Recommendation: before Phase 1 ships, decide whether `output_shape` is **declarative-only** (for documentation + caller inspector hints) or **runtime-validated** (Zod-parsed on return). Runtime validation is safer but introduces a new failure mode. Lean toward **declarative-only in Phase 1, runtime-validated in Phase 4** so callers can rely on the shape during inspector codegen.

### 9.9 Provenance through the call

The memory namespace invariant requires every agent-authored document to carry provenance properties. When a callee writes a brief via its `write_back`, the brief should carry provenance pointing at BOTH the caller and the callee. **Decision (not open):** the `DeliveryAdapter` extends provenance properties to include `compiled_by_contract: [<caller-name>, <callee-name>]` as an ordered array. This is a small write-back layer change tracked in Phase 1.

---

## 10. Out of scope

- **General UX redesign** — terminology, picker UI, sidebar reflow. Tracked in a separate spec drafted in parallel.
- **Bug fixes** — Phase A another agent is consolidating outstanding bug fixes; composition is orthogonal to those.
- **Implementation** — this is a spec. Phases 1–6 are the implementation plan; each lands as its own PR with its own tests.
- **Remote contract deep design** — §8 is direction-setting only. The detailed protocol, auth, signing, and discovery story is v3.
- **Versioned callees** — `contract://name@version` is forward-compatible per §8.4 but not implemented in v2.
- **Sink rebinding at call site** — §9.5 deferred; pattern via `sink_override` input exists today.

---

## 11. Consequences

### 11.1 Positive

- **Composition.** The DSL gains the missing function-call primitive. Three of the existing examples collapse to ~30% of their current size when refactored.
- **Discoverability.** The palette's "Local contracts" source-type makes shareable workflows visible to users browsing for affordances.
- **Forward-compat with remote.** The resolver abstraction means the same UI affordances work locally and remotely; we don't repaint the palette in v3.
- **No new failure modes for v1 users.** The schema change is purely additive; existing contracts are unaffected and untouched.

### 11.2 Negative

- **One more verb shape.** Maintainers of `verb-catalog.ts`, `inspector-pane.svelte`, and the canvas all need to handle a third branch (`baseline | mcp:// | contract://`). The cost is small but real.
- **Cycle detection surface.** A new class of error (`contract_cycle`) needs error messages, UI affordances, and documentation. Two places to fail (canvas + runner) means two places to keep in sync.
- **Resolution cost.** Every contract editor open now scans the vault for contract files. Cached, but a freshly-opened vault with 1000+ contracts pays a one-time cost on first open of any contract.
- **Versioning debt.** Not having `@version` from day one means a future schema migration to versioned references. The migration is documented in §8.4 but it is a migration.

### 11.3 Neutral

- **Memory-namespace invariant unchanged.** Composition flows write-backs through the same `DeliveryAdapter` chokepoint. C-3 holds.
- **Test count rises.** Each phase adds ~5–10 unit tests + 1–2 eval fixtures. Aggregate impact ~30 tests over the rollout.
- **Document-identity invariant unchanged.** A contract is still identified by its kebab-case `name` (server-side) or by `obsidian://<vault>/<path>` (when treated as a vault document). Composition references go by name; storage references go by URI; no collision.

---

## 12. Decision summary (TL;DR)

1. Add `contract://<kebab-case-name>` as a third arm of `VerbSchema`. Single Zod-union widening; nothing else in the schema changes.
2. Resolve callees by vault-local name lookup, with a pluggable resolver interface to make remote registries a future drop-in.
3. Detect cycles in two places (canvas drop + runner instantiate) using a depth-first walk on the resolved graph.
4. Render contract-call steps as a distinct canvas node with a doubled border, a `↳ contract` badge, and a `git-branch` icon.
5. Provide drag-from-file-explorer and a new "Local contracts" palette source-type as discovery affordances.
6. Open contract-call steps in a child tab via a session-scoped breadcrumb; default read-only with edit-on-confirm.
7. Cap recursion depth at 16. Enforce vault-wide name uniqueness at save time.
8. Ship in 5 phases; Phase 1 (schema + runner) is the smallest standalone slice; Phase 2 (drop-from-file-explorer) is the smallest user-visible slice.

Forward path to remote contract libraries is preserved by treating the resolver as the only adapter boundary — every other piece of this design works identically against a remote MCP source in v3.
