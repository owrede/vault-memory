# UX Redesign — Contract Editor (Inspector + Canvas + Palette)

**Status:** Design spec, ready for implementation hand-off
**Scope:** `plugin/src/views/contract-editor/{palette,canvas,inspector}/`
**Out of scope:** Contracts-as-cards (hierarchical contracts), backend / Zod schema changes
**Persistence layer:** unchanged — current `ContractFileSchema` remains the source of truth on disk

---

## 0. The one-sentence thesis

> The contract editor should let a user **drop boxes, draw lines between them, and pick from menus** — never type syntax. The DSL (`{{alias.field}}`, `__ref_*`, `?` placeholders, kebab-case rules) must live entirely below the UI surface; it should be an emission detail of the editor, not a vocabulary the user has to learn.

If a user ever sees a curly brace, an underscore-prefixed key, or has to manually edit `?{{inputs.doc_id}}--brief`, the redesign has failed.

---

## 1. Audience & first-principles

### 1.1 Who is the target user?

The target user is a **mid-experience Obsidian user**. They:

- Know how to make a note, add frontmatter, and use wikilinks.
- Have heard of "AI agents" and have at least one MCP client (Claude Desktop, Claude Code, ChatGPT Custom Connectors).
- Want to build a repeatable workflow — e.g. "every Monday, gather last week's meeting notes and write a status brief" — and have it triggered by an agent.
- Have **never** read the vault-memory contract DSL.
- Have **no** mental model of DAGs, mustache templating, JSON schemas, or topological sorting.

They are not a developer. They are not stupid. They have built a Notion database with formulas before and abandoned a Zapier zap because it got too fiddly.

### 1.2 The "child could learn this" test

A 12-year-old who can already use Obsidian should be able to:

1. Open the contract editor.
2. Recognise the three regions (palette / canvas / inspector) without instruction.
3. Drop **two** boxes onto the canvas (e.g. "Search the vault" → "Compile a brief").
4. Draw a line from one to the other.
5. Fill in the prompt-shaped inputs.
6. Save.
7. Run the contract from an agent.

…all in under five minutes, with no docs, no syntax, and no error states they can't fix from context alone.

Concretely, that means:

- **Every input field has a default that already works.** Defaults must be valid, not `?` placeholders.
- **Every connection point physically invites a drag.** Visible handles, hover affordances, cursor changes.
- **Errors are inline and reversible.** Never a Notice toast that disappears; never a silent rejection.
- **The vocabulary is what they already know.** "Search", "Note", "Brief", "Use the result of…". Never "alias", "verb", "mustache", "schema".

### 1.3 What knowledge we may assume

| Assume | Don't assume |
|---|---|
| How Obsidian notes, frontmatter, wikilinks work | What an MCP server is |
| What "search" means | What "hybrid retrieval" means |
| That an AI agent can "do something" with their vault | What a DAG / topological sort is |
| Drag-and-drop in general | Curly-brace template syntax |
| The concept of "input" and "output" | The terms `alias`, `verb`, `args`, `handle`, `sink`, `source`, `write_back` |

---

## 2. Conceptual model the user should hold

### 2.1 The new metaphor: **Recipe → Steps → Ingredients → Result**

A contract is a **recipe** the user writes once and an AI agent can cook again and again. It has:

- A **name** ("monday-status").
- A **purpose** in one sentence ("Gather last week's meetings and draft a status brief").
- A list of **steps** the agent runs in order.
- A **result** that gets saved to a folder in the vault.

Each **step** is a small action — search the vault, read a note, write a brief — with a few **settings** the user fills in. Steps can **use the result of a previous step** as one of their settings.

That's it. No DAGs, no schemas, no compilation language.

### 2.2 Glossary — current term → user-facing term

| Internal term | User-facing term | Where it appears in UI |
|---|---|---|
| Contract | **Recipe** | Editor title bar, palette empty state |
| `name` (kebab-case) | **Recipe name** | Inspector overview |
| `description` | **What this recipe does** | Inspector overview |
| `assembly` | **Steps** | Section title in inspector overview; canvas-level label |
| Step / `as` (alias) | **Step name** | Inspector |
| `verb` | **Action** | Header of selected step ("This step does: Search the vault") |
| `args` | **Settings** | Section title in step inspector |
| `inputs` | **Recipe inputs** ("things the agent supplies when it runs the recipe") | Inspector overview |
| `required` | (toggle on each input: "Agent must supply this") | Inspector |
| `sources` | **Where notes come from** (advanced) | Collapsed by default |
| `sinks` | **Where to save the result** | Surfaced under "Result" |
| `write_back` | **Save the result** (with a destination picker) | Bottom of inspector overview, distinct section |
| `handle` (in sinks) | **Destination folder** | Picker in "Save the result" |
| `DocId` | **Note** | Doc-picker labels |
| `{{alias.field}}` | **(rendered visually as a pill labelled "← Step name → field")** | Inputs in step inspector |
| `?` placeholder | **(rendered as empty field with subdued "Choose…" hint)** | Inputs |
| `MemorySink` | **Memory folder** (or just "save folder") | Save-result section |
| Mustache reference | **"Use the result of…"** | Toggle label on an input |
| Literal value (verb) | **Fixed value** (a yellow chip you can drop in) | Palette |
| "Compose" category | **Write something new** | Palette section title |
| "Read a document" | **Pull from one note** | Palette section |
| "Search the vault" | **Find notes** | Palette section |
| "Navigate the graph" | **Follow links between notes** | Palette section |
| "Reference earlier work" | **Look up past results** | Palette section |
| "Escape-hatch" | **Advanced** | Palette section |

**Justification for the most contested choices:**

- **"Recipe" over "contract"** — "contract" reads as legal/financial in plain English. "Recipe" maps onto exactly the same shape (named, reusable, has inputs and a result) and is what the user already says when they describe what they're building: "I want a recipe for status reports."
- **"Action" over "verb"** — "verb" leaks the implementation. "Action" is what end-users in low-code tools (Zapier, n8n, Shortcuts) already say.
- **"Step name" over "alias"** — "alias" is a database concept. The step has a name; that name is how other steps refer to it. No new word needed.
- **"Use the result of…" over "mustache reference"** — describes the behaviour, not the syntax. The user never sees the syntax.

We pick one term per concept and use it consistently. No alternates, no synonyms in tooltips.

### 2.3 What the editor shows vs what gets saved

```
On disk (unchanged):                In the UI:

contract:                           Recipe: monday-status
  name: monday-status               What this recipe does: …
  description: …
  inputs:                           Recipe inputs:
    week_of:                          - week_of (Date) [required]
      type: date
  required: [week_of]
  assembly:                         Steps:
    - as: find_meetings               [Box: "Find notes"]
      verb: search_hybrid                "Find: 'meetings from {{week_of}}'"  ← rendered as pill
      args:
        query: "meetings from {{week_of}}"
    - as: brief                       [Box: "Write a brief"]
      verb: compile_brief                "Bundle: ← find_meetings"           ← rendered as pill
      args:
        source_doc_ids: "{{find_meetings.docs}}"
  write_back:                       Save result:
    handle: _memory/_briefs           folder: Memory / Briefs (picker)
```

The right column is the only thing the user ever sees. The left column is an emission detail.

---

## 3. The "no syntax in inputs" principle (load-bearing)

This is the single non-negotiable design rule.

### 3.1 Rules

1. The user **never** types `{{…}}` into a field.
2. The user **never** sees a key starting with `__` (e.g. `__ref_step1`). Such keys are an internal canvas implementation detail; they must be hidden from the inspector entirely.
3. The user **never** sees `?` as a value. Empty fields render as empty controls with placeholder hint text — not as the literal string `?`.
4. Composite values like `?{{inputs.doc_id}}--brief` **never appear as a single text field**. They are decomposed into UI atoms (a reference pill + a literal suffix field) and recomposed on save.
5. Validation that depends on syntax (kebab-case, JSON parseability) **never** surfaces as syntax errors. It surfaces as "Use lowercase letters and hyphens — like `monday-status`."

### 3.2 The per-input affordance model

Every settings field on a step is one of three control types, decided by the arg's declared `shape` (extended; see §4) and whether the arg accepts a reference:

**Type A — Literal-only field**
A plain typed input matching the shape: `text`, `number`, `textarea`, `bool` toggle, `enum` dropdown, `docId` picker, `json` editor (only behind "Advanced" disclosure). No reference affordance, because the field doesn't accept upstream values.

**Type B — Reference-only field**
A pill-shaped selector: clicking opens a popover listing every upstream step and (for each) every named output field. Selecting one stamps a pill into the field. No free text. Used for fields like `source_doc_ids` that semantically only make sense as a reference.

**Type C — Either literal or reference (the common case)**
A field with two clearly separated affordances:

```
┌─────────────────────────────────────────────────┐
│ Search query                                    │
│ ┌─[Type: ● fixed text  ○ from a previous step]┐ │
│ │                                              │ │
│ │ [text field appears here]                    │ │
│ └──────────────────────────────────────────────┘ │
│ A search query. Examples: "Acme onboarding"     │
└─────────────────────────────────────────────────┘
```

When the user flips to "from a previous step", the text field becomes a picker. When they flip back, the previous text re-appears.

**Composite values** (e.g. `{{inputs.doc_id}}--brief`) are handled by a special "Build a name" control: a horizontal strip of chips the user can add to — each chip is either a pill (selected from a picker) or a literal text fragment they type. This control is only shown for fields whose `shape` is `"composite"` (a new shape we add — see §4). For 95% of cases the user never sees it.

### 3.3 Concrete worked example: `compile_brief.target`

**Today's UX:** Single text input pre-filled with `?{{inputs.doc_id}}--brief`. User has to know what `?` means, what `{{…}}` means, and what `--brief` is.

**New UX:** This field has `shape: "composite"`. The control renders as:

```
Where to save this brief
[← inputs.doc_id ▾] [--brief                  ]
[+ add another part]

ⓘ The agent picks the document ID at run time;
  "--brief" gets appended so the result has a
  predictable name.
```

The default already works. The user can replace the literal "--brief" with anything, or remove the pill, or pick a different upstream value from the dropdown — but they never see a brace, an underscore, or the word "mustache".

### 3.4 Where reference-pickers get their data

Every step in the assembly has a known `outputShape` (already declared in `verb-catalog.ts`). The inspector extracts the **named output fields** from this string and shows them as a two-level picker:

```
Pick a value to use:

  ▾ find_meetings  (Find notes)
       • docs       — array of notes
       • count      — number of results
  ▾ first_meeting  (Pull from one note)
       • body       — note text
       • frontmatter — note's properties
       • doc_id     — the note's ID

  · · · Recipe inputs · · ·
       • week_of    — date (provided by agent)
```

Recipe-level `inputs` appear at the bottom of the same picker as a separate section. The user never knows they're conceptually different — they're just "things you can use."

### 3.5 The `__ref_*` problem

The current canvas stores phantom args like `__ref_step1` to remember that an edge exists even when the downstream step's args haven't yet been wired. **This is an editor implementation detail and must not leak.**

The redesign:

1. Strips all `__ref_*` keys from what the inspector iterates over.
2. Keeps them in the assembly JSON for the canvas's own bookkeeping (no schema break).
3. When a downstream step has an unwired edge (a `__ref_x` key but no matching `{{x…}}` in args), the inspector shows a special card at the top of "Settings":
   > **Connected from `find_meetings`, but not used yet.**
   > Pick which setting should receive its result: [Settings dropdown ▾]

This converts a confusing leaked key into an explicit user choice.

---

## 4. Per-arg shape catalog

We extend `ArgDoc.shape` to a richer enum and define what each one renders as. The catalog (`verb-catalog.ts`) will need a small migration to use the new shapes; the migration is mechanical and described inline.

| Shape | Renders as | Accepts reference? | Empty behaviour | Used for |
|---|---|---|---|---|
| `text` | Single-line input | Yes (Type C) | Empty input, "Enter text…" hint, validates non-empty if required | Search queries, free-form labels |
| `textarea` | Multi-line input | Yes (Type C) | Empty area, "Describe…" hint, no required-min-length | Purpose, prompts, descriptions |
| `number` | Numeric stepper | Yes (Type C, rare) | Greyed default value visible (e.g. "20"), labelled "default" | `limit`, `max_tokens`, `hops` |
| `bool` (new) | Switch | No | Defaults to `false` (or the verb's declared default) | Optional behaviour toggles |
| `enum` (new) | Radio chips or dropdown | No | Defaults to first option | `direction: in/out/both`, `method: edge-community` |
| `docId` | Note-picker modal (Obsidian's built-in file picker) | Yes (Type C) | "Choose a note…" button | Single note targets |
| `docList` (new) | Pill list, with "Add note" → picker, or "From step…" → reference | Yes (always Type C, list semantics) | Empty list with `[+ Add note]` and `[+ Use a step's result]` buttons | `seed_doc_ids`, `source_doc_ids` |
| `composite` (new) | Chips strip (see §3.3) | Embedded refs inside | Default chips from `defaultArgs` | `target`, file-naming patterns |
| `json` | Advanced disclosure: structured key-value editor | No | "+ Add property" button | `where:` filter, raw escape |
| `mustache` (removed) | — | — | — | The shape `"mustache"` is **removed** from the catalog. Any field that previously used it becomes Type C with an underlying shape of `text`. |

### 4.1 Per-shape failure modes

- **Empty required field:** field gets a yellow left-border, an inline message "This setting is needed", AND the step gets a ⚠ on the canvas.
- **Wrong type via reference:** if the user picks an upstream `count` (a number) into a `docList`, the picker greys out incompatible fields with a tooltip ("This is a number; this setting needs notes.")
- **Broken reference:** if a referenced step is deleted or renamed, the pill turns red with a "✕ This step is gone — pick a different value" message. (Today: silently broken mustache string.)

### 4.2 How the UI explains the arg's purpose

Each field shows:

- **Label** (e.g. "What to search for") — large, regular weight.
- **Inline help** (e.g. "A few words about what you're looking for. The agent finds notes that match.") — small, one line, below the input.
- **Examples** (in the inline help, where the verb catalog supplies them).

Tooltips and `?` icons are **removed**. All help is visible by default. (Hidden help is help that doesn't exist.)

---

## 5. Inspector layout redesign

### 5.1 Current vs proposed

**Current — step selected:** Header with verb badge in monospace, paragraph explanation, "Output shape" line in monospace, alias field at the same prominence as primary args, every arg always visible at full depth, mustache pills mixed in with raw text inputs, "Used by" list with monospace identifiers, no advanced disclosure.

**Proposed — step selected:** Header is plain-language. Primary settings only above the fold. Advanced collapsed. Step-name editing demoted to a tiny secondary control. Output shape removed (the user doesn't think in shapes; references show what they need). "Used by" replaced with a quieter "Connected to …" footer.

### 5.2 Proposed Mode A layout (step selected)

```
┌─────────────────────────────────────────────────────┐
│ ▌ 🔍  Find notes                                    │  ← coloured stripe, icon, plain title
│ ▌ This step searches your vault and returns the    │  ← description from longDescription, lightly edited
│ ▌ most relevant notes.                              │
└─────────────────────────────────────────────────────┘

  Step name                              find_meetings  ▾  ← rendered as small inline, click-to-edit
                                                              with auto-slug on commit

  ───────────────────────────────────────────────────
  SETTINGS
  ───────────────────────────────────────────────────

  What to search for                                  [required]
  ┌─[ ● Fixed text  ○ From a previous step ]──────┐
  │ meetings from last week                        │
  └────────────────────────────────────────────────┘
  Examples: "Acme onboarding", "Q2 OKRs"

  How many results
  ┌────────────────────────────────────┐
  │  20                                │  ← number, with "default: 20" hint subdued
  └────────────────────────────────────┘

  ───────────────────────────────────────────────────
  ▸ ADVANCED                                          ← collapsed by default
  ───────────────────────────────────────────────────

  ───────────────────────────────────────────────────
  CONNECTED TO
  ───────────────────────────────────────────────────
  brief — "Write a brief"          [view step →]
  ───────────────────────────────────────────────────

  ▸ DELETE THIS STEP                                  ← collapsed, requires confirm
```

### 5.3 Proposed Mode B layout (nothing selected, recipe overview)

```
┌─────────────────────────────────────────────────────┐
│ 📋  Recipe overview                                 │
│ A workflow your AI agent can run on this vault.    │
└─────────────────────────────────────────────────────┘

  Recipe name                                         [required]
  ┌────────────────────────────────────┐
  │ monday-status                       │
  └────────────────────────────────────┘
  Lowercase letters and hyphens only — like
  "monday-status" or "meeting-prep".
  ⚠ "Monday Status" is not valid — try "monday-status"?  ← live, inline, with auto-fix suggestion

  What this recipe does                              [required]
  ┌────────────────────────────────────┐
  │ Gather last week's meetings and    │
  │ draft a status brief.              │
  └────────────────────────────────────┘
  One sentence. The agent sees this when it
  chooses which recipe to run.

  ───────────────────────────────────────────────────
  RECIPE INPUTS                                       [+ Add input]
  ───────────────────────────────────────────────────
  week_of          Date            [required] [↗]
                                          ↑
                                          opens an edit popover with:
                                            name, type, description, required toggle

  ───────────────────────────────────────────────────
  SAVE THE RESULT
  ───────────────────────────────────────────────────
  Folder to save into:
  ┌─────────────────────────────────┐ [browse…]
  │ Memory / Briefs                  │
  └─────────────────────────────────┘
  ☑ Add a note about which steps fed into this result
    (helps you trust what the agent produced)

  ───────────────────────────────────────────────────
  ▸ ADVANCED: Where notes come from                   ← collapsed by default
  ───────────────────────────────────────────────────

  ───────────────────────────────────────────────────
  HOW THIS LOOKS                                      ← lightweight rollup
  ───────────────────────────────────────────────────
  3 steps. Saves to Memory / Briefs.
  Agent supplies: week_of.
  Last edited 2 minutes ago.

  ───────────────────────────────────────────────────
  TIPS                                                ← only when something actionable
  ───────────────────────────────────────────────────
  ⚠ Step "brief" has an empty setting:
    "Purpose". Click the step to fill it in.

  ───────────────────────────────────────────────────
  ▸ DANGER ZONE                                       ← collapsed
  ───────────────────────────────────────────────────
   [ Delete this recipe ]
```

### 5.4 Removals

- "Output shape" (`{ body: string, frontmatter: object, doc_id: string }`) — gone from primary view. Move to advanced section IF anyone misses it; default is to remove entirely.
- Monospace verb badge (`search_hybrid`) — gone from header. Optional: shown as a footer line "Powered by `search_hybrid` (vault-memory)" in Advanced.
- "Used by" — renamed to "Connected to"; uses step names not aliases.
- "At a glance" stats grid (6 numeric tiles) — replaced with a single human sentence under "How this looks".
- All `?` help icons — replaced by always-visible inline help text.

### 5.5 Progressive disclosure rules

- **Above the fold:** name, description, primary actions (Settings, Result, Tips).
- **One click away** (chevron expand): Advanced settings on a step, "Where notes come from", footer telemetry.
- **Two clicks away** (chevron then confirm): Delete step, Delete recipe.

---

## 6. Canvas card redesign

### 6.1 What the card shows

The card today shows: icon, title, alias (large monospace), verb (monospace), one-line arg summary. Too much information; the alias dominates visually but is meaningless to the user.

**Proposed card content** (top to bottom):

1. **Coloured stripe** — left edge, 4px, category colour. Unchanged.
2. **Icon + plain-language title** — e.g. `🔍 Find notes`. Unchanged.
3. **Step name** — the editable identifier, BUT rendered as a small caption-style label below the title (not the dominant line), in regular weight. Example: `find_meetings`. If the user hasn't renamed it from the default, render as muted.
4. **One-line description of what this step will do** — using a templated sentence from the verb meta:
   - "Find notes" → "Searching for: meetings from last week"
   - "Pull from one note" → "Reading: ← inputs.doc_id"
   - "Compile a brief" → "Bundling: ← find_meetings · purpose: …"
   - Reference pills inline (small, coloured by the source step's category).
5. **Status dot** — top right. Green/yellow/red.

**Removed from the card:**

- The bottom monospace `args` JSON-ish summary line (`query: "?", limit: 20`) — replaced by the readable one-liner above.
- The separate monospace verb name line.

### 6.2 Selection affordance

- Selected: 2px accent-coloured ring around the card, plus a subtle accent-tinted background.
- Hover (not selected): card lifts (existing shadow transition), handles glow.
- Drag-over (target of a connection): card border becomes accent-coloured dashed.

### 6.3 Connection handles

Today: Svelte Flow default handles (small circles on left/right). Users don't see them as draggable.

**Proposed:**
- Handles render as larger (8px) coloured dots with a subtle outline.
- On card hover, handles grow to 12px and animate a faint pulse.
- Cursor changes to grab when over a handle.
- Handles get tooltips: left = "Receive a result here", right = "Send this step's result somewhere".
- When a handle is being dragged from, the canvas highlights every compatible target handle (cards whose unconnected required inputs match the dragged step's output type).

### 6.4 Drag, drop, error states

- **Idle hover:** soft shadow + handles surface.
- **Selected:** accent ring.
- **Being dragged:** card opacity 0.7, no shadow.
- **Error (broken reference or missing required setting):** red left stripe overlaying the category colour, red status dot, and a small badge "1 issue" in the bottom-right. Clicking the badge opens the inspector scrolled to the broken field.
- **Warning (e.g. empty optional setting, no upstream connection):** yellow status dot only. No badge.

### 6.5 Edges

Edges between cards should:

- Be coloured by the source step's category (matches the stripe).
- Be labelled (subtly, at midpoint) with the field name they feed into when there's exactly one such field. E.g. an edge labelled `→ source_doc_ids`. Today no label, which makes it ambiguous when a step has multiple inputs.
- Have a "delete" affordance on hover (small × near the midpoint).

---

## 7. Palette redesign continuation

### 7.1 Keep

- Source dropdown at top (vault-memory + peer MCPs).
- Collapsible categories.
- Per-card drag with MIME `application/x-vault-memory-verb`.
- Coloured left stripe per category.

### 7.2 Add

**Search field at the top of the palette.** Filters across title, description, and category. Survives across sessions. Empty by default.

**"Recently used" pinned section.** Top of the palette under search. Up to 6 verbs most recently dragged onto a canvas in this vault. Persisted in plugin data.

**Hover preview.** Hover a card for ~400ms → small floating tooltip card appears to the right with:
- Icon + title
- Long description (the same `longDescription` the inspector uses)
- "Inputs" list — one line per arg with its label
- "Outputs" list — one line per named output field
- "Drag onto canvas →" hint

No need to open inspector to know what a step does.

**Empty-state "I don't know where to start" CTA.** When the canvas has zero steps, the palette shows a banner at the top:
> **New to recipes?** Start with one of these:
> [Open an example: Meeting prep] [Open an example: Status brief]

These insert a fully-wired example assembly onto the canvas.

### 7.3 Category renames

(Already covered in §2.2, repeated here for the palette's section labels.)

- "Read a document" → **Pull from one note**
- "Search the vault" → **Find notes**
- "Navigate the graph" → **Follow links between notes**
- "Reference earlier work" → **Look up past results**
- "Compose a new artifact" → **Write something new**
- "Escape-hatch" → **Advanced**

### 7.4 Cards: visible content

Today: grip dots, title, monospace verb at the right.

Proposed:
- Grip dots (kept)
- Title (kept)
- A one-line plain description (NEW — replaces the right-side verb monospace; verb name moves into hover preview)

This shifts the per-row content from "what is this called internally" to "what does it do".

---

## 8. Error model

### 8.1 Principles

- **Inline first, modal never.** No `Notice` toasts for validation. Notices remain only for genuinely transient I/O outcomes (save failure, MCP server unreachable).
- **Live validation while the user types**, debounced at 250ms.
- **Auto-fix offers** wherever the fix is mechanical and unambiguous.
- **Errors never block typing.** Field accepts what you type; validation surfaces beside it. The save button is the gate.

### 8.2 Field-level

Per-field state machine: `idle → editing → validating → (valid | invalid)`. Invalid state shows:

```
Recipe name                                         [required]
┌────────────────────────────────────┐
│ Monday Status                       │
└────────────────────────────────────┘
Lowercase letters and hyphens only — like "monday-status".
⚠  "Monday Status" isn't valid.  [Use "monday-status" instead]
```

The auto-fix button is a single click. Implementation: slugify, commit, clear error.

### 8.3 Step-level

Each step has a derived status: `ok | warning | error`.

- **`error`** — required setting empty AND no upstream connection wired into it; OR a referenced step has been deleted; OR a referenced step's named field doesn't exist anymore.
- **`warning`** — optional setting empty; OR no downstream connections (terminal step that isn't a Compose/Write step).
- **`ok`** — otherwise.

Surfaced as the card's status dot, plus a count in the bottom-right ("2 issues") for `error` cards. Clicking opens the inspector with the first problem scrolled into view and focused.

### 8.4 Recipe-level

The save button shows:
- `Save` when all steps are `ok`.
- `Save (3 warnings)` when only warnings exist.
- `Save anyway (2 errors)` — same colour, slightly louder treatment — when errors exist. **Save is not blocked.** vault-memory loads the file anyway and surfaces errors at run time; but the contract is unrunnable until fixed. The UI is honest about this.

A "Tips" section in the overview inspector aggregates contract-level guidance, replacing the current tips block:
- "Most recipes end with a 'Write something new' step. Yours doesn't — the agent gets raw results."
- "You haven't set up a save location. The result will be returned but not saved to the vault."
- (Quiet on success — silence is good news.)

---

## 9. Onboarding & empty states

### 9.1 First-open of a brand-new recipe

When a recipe file is created with one default literal step (the existing canvas behaviour), the canvas shows:

```
┌─────────────────────────────────────────────────┐
│                                                 │
│       ╔═══════════════════════════════════╗    │
│       ║                                   ║    │
│       ║   You're building a recipe.       ║    │
│       ║                                   ║    │
│       ║   Drag a step from the left to    ║    │
│       ║   begin. Connect steps by         ║    │
│       ║   drawing a line between them.    ║    │
│       ║                                   ║    │
│       ║   [Open an example] [Tour]        ║    │
│       ║                                   ║    │
│       ╚═══════════════════════════════════╝    │
│                                                 │
│       [Find notes]──→ ?                         │
│                                                 │
└─────────────────────────────────────────────────┘
```

The default literal-value step is **removed** as the initial-state canvas content. Instead the canvas starts genuinely empty, with the welcome overlay above. The overlay dismisses on first drop.

### 9.2 Tour

A skippable 4-step coachmark tour:

1. "This is your palette. Drag a step onto the canvas." — points at palette.
2. "This is your canvas. Steps live here; drag between handles to connect them." — points at canvas.
3. "This is the inspector. Click any step to edit its settings." — points at inspector.
4. "When you're ready, click Save. Your recipe is now available to any AI agent." — points at save button.

Persisted as "tour seen" in plugin data so it doesn't re-show. Re-runnable from a "Help" button in the editor header.

### 9.3 "What is a recipe?" disclosure

A quiet `?` icon in the top-left of the editor header opens an `<aside>` overlay (not a modal) with:
- Two-paragraph plain-language explanation.
- A link to "Examples" — lists built-in examples that can be inserted.
- A link to "How agents call this recipe" — explains MCP discovery in 3 sentences.

### 9.4 Empty palette source

When the user picks a peer MCP that has no tools, palette already shows "This source has no tools." — keep that, but add: "Connect another MCP server in Obsidian's settings to see more here."

---

## 10. Acceptance criteria

A redesign PR is "done" when **all** of the following are true:

1. **5-minute first-success.** A new Obsidian user, given the editor and no docs, can: drop two steps onto the canvas, draw a connection, fill in defaults, save, and trigger the recipe from a connected MCP client — within 5 minutes. Measured by usability test.
2. **Zero-syntax UI.** Grep the rendered UI (HTML strings + text content of every label, hint, placeholder, and tooltip across `palette/`, `canvas/`, `inspector/`). Result must contain **zero** occurrences of: `{{`, `}}`, `mustache`, `alias`, `verb`, `DSL`, `schema`, `kebab-case`, `snake_case`, `JSON`, `__ref`, `?{{`. (Edge case: the word "snake" / "kebab" should never appear except in an "Examples" sub-hint and even there is preferred replaced with a literal example like `monday-status`.)
3. **No raw curly-brace inputs.** Every settings field is one of: typed input, picker, switch, dropdown, pill-strip, JSON editor (advanced only). Free-text fields exist, but their value is interpreted as a literal — not as a template — unless the user has flipped the field into "From a previous step" mode, in which case the field becomes a picker, not a text box.
4. **No `__ref_*` keys visible.** Inspector iteration filters them out. Canvas keeps them in storage but renders them as the explicit "Connected from X, not used yet" card described in §3.5.
5. **Inline errors only.** No new `new Notice(...)` calls for validation. Saves with errors are allowed (with a louder button); load-time errors are surfaced inline on next open.
6. **Auto-fix path for invalid name.** Typing a Title-Case or spaced name into the recipe name field produces a "Use ‘…’ instead" button that commits the slug in one click.
7. **Hover-preview parity.** Every palette card has a hover preview that lists its inputs and outputs in plain language.
8. **Empty canvas onboarding.** First-open of a new recipe shows the welcome overlay; the default literal step is no longer auto-inserted.
9. **Connection labels.** Edges between cards are labelled with the field they feed into when unambiguous.
10. **Tests.** Each of the above is covered by at least one Vitest unit or Playwright integration test under `plugin/src/views/contract-editor/__tests__/`. No regression in existing 324-test suite.

---

## 11. Out of scope

- **Contracts-as-cards / hierarchical contracts.** A separate spec covers letting a step call another contract as a sub-recipe. The data model here must not preclude it (the `verb` field stays a string, so a future `verb: "contract:other-recipe-name"` is fine), but no UI for it lands in this redesign.
- **Backend schema changes.** `ContractFileSchema` (`src/contracts/schema.ts`) stays untouched. All UI changes emit the same on-disk shape. Migration of `verb-catalog.ts` to the new `shape` enum (`bool`, `enum`, `docList`, `composite`) is a UI-side change only — the disk YAML stays as-is.
- **Per-step preview / dry-run.** A "what would this step actually do" preview belongs in a later release.
- **Real-time collaborative editing.** Single-user assumption stands.
- **Visual theme overrides.** Editor inherits Obsidian's theme variables; no custom palette work.
- **Translation / i18n.** All copy is English. The spec uses American spelling; the implementation should match Obsidian's locale convention if it ever differs.
- **Peer MCP tool argument introspection.** Today peer-MCP verbs in the palette are bare names with no `argDocs`. They get a generic "Settings" editor (key-value pairs, JSON values). This is a known degradation and acceptable for v2.0.

---

## 12. Open questions

1. **"Recipe" vs "Workflow" vs "Contract".** Spec picks "Recipe". Worth a 5-user gut check before implementation. If users say "workflow" unprompted when shown the editor, switch. The codebase / on-disk schema continues to say `contract`.
2. **Composite control complexity.** §3.3's "Build a name" chips control is the most ambitious new control. Do we ship a v1 that simply hides composite values behind an "Advanced: edit raw" disclosure, and add the chips control in a follow-up? Cost/value tradeoff to be discussed.
3. **`literal` verb visibility.** Currently in the "Escape-hatch" category (renamed "Advanced"). Should fixed values be a step at all, or should they be inlined as just-another-settings-value type at the field level (no card on the canvas)? Spec assumes "card stays, in Advanced section". Worth a second look.
4. **`json` shape for `where` filter.** The `query_frontmatter` verb's `where` argument is structurally a key-value map. Today shape is `json` and the user types JSON. Should we instead render a key-value pair builder ("Find notes where: [key dropdown] [op] [value]")? Strictly better UX, but tied to having a list of frontmatter keys to suggest — which we have via the schema-inference module. Out of scope to build now, but the redesign should not block it.
5. **Save destination — folder picker UX.** Obsidian's file-explorer-style picker for folders requires custom UI (no built-in modal for folder-only picking). Acceptable interim: text input with autocomplete from existing folder paths in the vault.
6. **Examples.** Which concrete example recipes do we bundle for the "Open an example" CTA? Suggested seed: `meeting-prep`, `monday-status`, `find-stale-notes`. Needs PM/UX sign-off.
7. **Renaming a step.** Today renaming a step's identifier triggers a complex cascade (alias rewrite + `__ref_*` rewrite + mustache rewrite + editor node id rewrite). The redesign preserves the cascade but pushes the rename UI behind a "edit name" affordance instead of a top-level input. Confirm this is OK.
8. **Required-input editor for recipe inputs.** The spec sketches a popover for adding/editing inputs. Detailed design (validation, type selection beyond `text`/`number`/`date`/`docId`, default values) deferred — please flag if you need it for implementation.

---

## Appendix A — Migration plan for `verb-catalog.ts`

The shape enum changes from `text | number | textarea | docId | mustache | json` to:

`text | textarea | number | bool | enum | docId | docList | composite | json`

(`mustache` removed.)

Per-verb migration:

| Verb | Field | Old shape | New shape | Notes |
|---|---|---|---|---|
| `read_note` | `doc_id` | `docId` | `docId` | — |
| `get_outline` | `doc_id` | `docId` | `docId` | — |
| `search_sections` | `doc_id` | `docId` | `docId` | — |
| `search_sections` | `query` | `text` | `text` | — |
| `search_hybrid` | `query` | `text` | `text` | — |
| `search_hybrid` | `limit` | `number` | `number` | — |
| `query_frontmatter` | `where` | `json` | `json` | Future: replace with kv-builder |
| `expand` | `seed_doc_ids` | `json` | `docList` | — |
| `expand` | `hops` | `number` | `number` | — |
| `expand` | `direction` | `text` | `enum` | Options: `in`, `out`, `both` |
| `cluster` | `seed_doc_ids` | `json` | `docList` | — |
| `cluster` | `method` | `text` | `enum` | Options: `edge-community` |
| `list_backlinks` | `target_doc_id` | `docId` | `docId` | — |
| `recall` | `handle` | `text` | `text` | — |
| `recall` | `since_days` | `number` | `number` | — |
| `get_brief` | `handle` | `docId` | `docId` | — |
| `compile_brief` | `target` | `text` | `composite` | The flagship use case for `composite` |
| `compile_brief` | `source_doc_ids` | `json` | `docList` | — |
| `compile_brief` | `purpose` | `textarea` | `textarea` | — |
| `compile_brief` | `max_tokens` | `number` | `number` | — |
| `literal` | `value` | `json` | `json` | (Behind Advanced) |

Default args also change: every `?` placeholder and every `?{{…}}` becomes a typed default (e.g. `limit: 20` is fine; `query: ""` for `search_hybrid`; `purpose: ""` for `compile_brief`). The UI shows empty-but-valid controls instead of literal `?` strings.

---

## Appendix B — Mockup colour key (used in ASCII sketches)

- ▌ = coloured stripe (category accent)
- ▾ = dropdown/expand affordance
- ← = reference pill ("uses the result of")
- ⓘ = inline help icon (not interactive in redesign; help is always visible)
- ⚠ = warning glyph
- ✕ = error glyph
- ☑ / ☐ = toggle
- [+ ...] = action affordance ("add")
- [browse…] = file/folder picker trigger

— end of spec —
