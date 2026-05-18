# Phase 6: Task contract DSL - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-18
**Phase:** 06-task-contract-dsl
**Areas discussed:** MCP surface model (CON-11 ADR), Assembly verb vocabulary, Input schema mechanism, `source_overrides` / `sink_overrides` semantics, Contract loading lifecycle (orthogonal follow-up)

---

## Gray Area Selection

Four gray areas presented as discuss-candidates. User selected ALL four.

| Option | Description | Selected |
|--------|-------------|----------|
| MCP surface — Tools vs Prompts vs both (CON-11 ADR) | How contracts surface to MCP clients | ✓ |
| Assembly step vocabulary — what verbs can a contract chain? | DSL's expressive ceiling | ✓ |
| Input schema mechanism — how `inputs:` is declared & validated | Author ergonomics + MCP `inputSchema` pass-through | ✓ |
| `source_overrides` / `sink_overrides` semantics (CON-10 handle portability) | v3 multi-source template | ✓ |

---

## Area 1: MCP Surface Model (CON-11 ADR)

### 1a — Primary surface

| Option | Description | Selected |
|--------|-------------|----------|
| Generic tool only | `instantiate_contract({name, inputs, ...})` is the sole entry point. Contracts discovered via `list_contracts` Resource + `describe_contract`. tools/list stays small. Less native discoverability. | |
| Auto-register each contract as its own MCP Tool | Three contracts → three new tools in tools/list, each with the contract's `inputs` as `inputSchema`. Maximum discoverability; REL-08 budget pressure; vault-dependent snapshot. | |
| Auto-register each contract as an MCP Prompt | MCP Prompts surface (`prompts/list` + `prompts/get`). Slash-command UX in Claude Desktop. ChatGPT Custom Connector does not consume MCP Prompts (kills CON-09). | |
| **Both — generic tool AND auto-register each contract as a Tool** | Belt-and-suspenders. Maximum reach, doubles surface area per contract. | ✓ |

**User's choice:** Option 4 (Both) with a user-controllable switch for auto-register AND a command to trigger registering of contracts as tools when auto-register is OFF.

**Notes:** User refined the recommendation — wants both surfaces but with explicit operator control over when auto-register fires. The follow-up question on the config gate captured the switch location.

### 1b — Config gate

| Option | Description | Selected |
|--------|-------------|----------|
| **Per-vault config `[contracts] auto_register_tools = false` (default OFF)** | Default OFF preserves stable tools/list + clean snapshot + REL-08 headroom. User opts in per vault. ChangeFeed events re-scan when ON. Manual `register_contracts_as_tools()` tool always available. | ✓ |
| Global config + manual command always available | Same semantics, global section. Less granular. | |
| Default ON for the three reference contracts only | Hybrid; reference 3 always tools, user-authored opt-in. Harder to explain. | |

**User's choice:** Option 1 (per-vault default OFF + always-callable manual command).

### 1c — Tool name prefix

| Option | Description | Selected |
|--------|-------------|----------|
| Prefix with `contract_` | Reserved prefix; fixed; collision-safe. | |
| No prefix — contract `name` becomes tool name directly | Shared namespace with built-ins; collision risk. | |
| **User-controlled prefix in config (default `vm_`)** | `[contracts] tool_prefix` with `"vm_"` default for "vault-memory". Brandable. | ✓ |

**User's choice:** Option 3 with default prefix `vm_` (short for "vault-memory").

**Notes:** Departure from recommended (option 1). Cost: one extra config knob. Payoff: deployments can rebrand; `vm_` reads better in audit logs than `contract_meeting_prep`.

---

## Area 2: Assembly Verb Vocabulary

### 2a — Verb set (after clarification request from user)

User asked for clarification before answering. Claude re-explained the four options in plain language (closed list / open / option-1-but-LLM-called-out / closed+literal-escape) with side-by-side pros/cons. Then user picked.

| Option | Description | Selected |
|--------|-------------|----------|
| Closed Zod-enum of L0–L4 retrieval/assembly verbs | Hard-coded enum (11 verbs). No write verbs. Predictable. | |
| Open `tool: <any-registered-tool-name>` | Maximum flexibility. **Breaks memory-namespace invariant** (could call `write_note` directly). Vault-dependent behavior. | |
| Closed enum BUT include compile_brief as the only LLM-touching verb | Same as option 1 with explicit ADR framing. Functionally identical. | |
| **Closed enum + escape-hatch `literal` step (no LLM call)** | Closed list + `literal` verb injecting a pre-computed value. Required for CON-10 stub-parity (deterministic input). Lets non-LLM deployments produce shaped output. | ✓ |

**User's choice:** Option 4, AND with the addition that authors should be able to include their own tools in contracts, BUT with a housekeeping mechanism to list custom tools and expose what users do beyond the baseline as a signal for improving the baseline.

**Notes:** The user expanded the answer beyond the four options — they wanted both the closed safety set AND extensibility, with usage telemetry. This drove two follow-up questions (custom-tool source + housekeeping surface).

### 2a-follow-up — Custom-tool source

| Option | Description | Selected |
|--------|-------------|----------|
| **Other MCP servers attached to the same client** | `verb: mcp://<server-name>/<tool-name>`. vault-memory acts as MCP client to peers. `[contracts.mcp_clients]` config. Zero new code for contract author beyond running another MCP server. | ✓ |
| User-authored TypeScript plugins in `_contracts/_tools/` | In-process JS modules. Big security surface; compilation step; scope creep. | |
| Custom tools as YAML macros over baseline | Named sub-contracts. Safer but limited to baseline-verb combinations. | |
| Defer custom tools to v2.x | Ship baseline only. PRINCIPLES YAGNI. | |

**User's choice:** Option 1 (peer MCP servers via `mcp://` URI scheme).

### 2b — Housekeeping for custom-verb usage signal

| Option | Description | Selected |
|--------|-------------|----------|
| **`list_contract_verbs` MCP Resource + audit_log integration** | Resource aggregates `audit_log` `kind: "contract_step"` rows by verb. Zero new tables; usage signal answerable in-product. | ✓ |
| Dedicated `contract_telemetry` table + `verb_usage_report` tool | New schema; duplicates audit_log; premature optimization. | |
| Resource only, no audit integration | Kills the usage-signal idea. | |
| Resource + audit + CLI `vault-memory contract-verbs --report` | Same as option 1 plus CLI summary. Extra surface. | |

**User's choice:** Option 1 (Resource + audit_log integration).

### 2c — Step composition / data flow

| Option | Description | Selected |
|--------|-------------|----------|
| **Named bindings — each step has `as:` alias, referenced via `{{alias.field}}`** | Mustache-style templates; ~50 LOC resolver. Explicit data flow, supports reordering and fan-out. | ✓ |
| Implicit `$prev` only | Cannot fan-out; forces ordering. | |
| Both | Two ways to do one thing; complexity. | |

**User's choice:** Option 1 (named bindings + mustache).

---

## Area 3: Input Schema Mechanism

### 3a — Declaration style

| Option | Description | Selected |
|--------|-------------|----------|
| **JSON Schema subset embedded in YAML** | Pass-through to MCP `inputSchema` is byte-equivalent. Standard, widely-known. Zod 4 parses JSON Schema. Verbose. | ✓ |
| Tiny TypeScript-ish notation | Terse; new grammar to parse; doesn't translate cleanly to MCP `inputSchema`. | |
| Zod schemas as YAML expression strings | Eval-as-data security risk; string-encoded code hard to read. | |
| Reuse MCP `inputSchema` shape directly | Byte-equal MCP pass-through; even more verbose than option 1. | |

**User's choice:** Option 1 (JSON Schema subset in YAML).

### 3b — Named types sugar

| Option | Description | Selected |
|--------|-------------|----------|
| **Yes — `$ref: '#/types/DocId'` resolves to a known JSON Schema catalog** | Fixed catalog ships in code (`DocId`, `Handle`, `ChunkId`, `MemorySink`). ~20 LOC resolver. Additive evolution. | ✓ |
| No sugar — full JSON Schema pattern every time | Repetitive; copy-paste errors if patterns change. | |
| Sugar via `format:` (JSON Schema extension) | Standards-aligned but advisory; tools may ignore. | |

**User's choice:** Option 1 (`$ref` to typed catalog).

---

## Area 4: `source_overrides` / `sink_overrides` Semantics

### 4a — Override target

| Option | Description | Selected |
|--------|-------------|----------|
| **By variable handle name** | Contract declares `sources: { default_source: ..., audit: ... }`. Overrides target handle names. Matches `{{default_source}}` pattern. | ✓ |
| By URI scheme | Override every `obsidian-fs://*`. Coarse. Can't selectively target one of two same-scheme sources. | |
| Both — handle name precedence, scheme fallback | Complexity; precedence surprises. CON-10 doesn't need it. | |

**User's choice:** Option 1 (handle name).

### 4b — Override validation

| Option | Description | Selected |
|--------|-------------|----------|
| **Strict — unknown handle = error; missing required = error** | Structured error envelopes; predictable. CON-10 stable. | ✓ |
| Lenient — silent ignore + global default fallback | Typos pass silently. CON-10 could pass against wrong source if typo. | |
| Warn-not-error on unknown; strict on missing | Warnings often ignored. | |

**User's choice:** Option 1 (strict).

### 4c — Sink invariant

| Option | Description | Selected |
|--------|-------------|----------|
| **Yes — every `sink_overrides` MUST resolve to a registered MemorySink** | `MemorySinkRegistry.resolveMemorySink()` validation. Memory-namespace invariant un-bypassable. | ✓ |
| Soft — warn but allow | Breaks Phase 2 invariant. Not viable. | |
| No `write_back` in v2.0.0 — read-only assembly | Drops a CON-01 schema field; defers actual workflow utility. | |

**User's choice:** Option 1 (strict MemorySink resolution).

---

## Orthogonal Follow-Up: Contract Loading Lifecycle

### Loading model

| Option | Description | Selected |
|--------|-------------|----------|
| **Hot reload via `ChangeFeed` subscription** | Boot scan + runtime ChangeFeed handler. Matches Phase 5 daemon pattern. Live iteration. ~30 LOC. | ✓ |
| Boot-time only — restart for changes | Kills iteration loop; against Phase 4/5 live-indexing precedent. | |
| Lazy — parse on first call, cache until restart | Errors surface late; no `list_contracts` aggregation. | |

**User's choice:** Option 1 (hot reload via ChangeFeed).

---

## Claude's Discretion

Areas the user deliberately delegated — researcher/planner choose during plan 06-01 ADR drafting:

- Exact YAML schema of `output_shape:` (likely JSON Schema subset + `$ref` catalog, matching `inputs:`)
- Where peer-MCP client sessions are held (likely `src/contracts/mcp-clients.ts` with SDK `Client` lifecycle)
- `yaml ^2.6` round-trip mode specifics (parseDocument + Document.toString; comment-preservation verification)
- Error envelope closed-enum reasons (full list pinned in Phase 6 ADR)
- `describe_contract` Zod-to-human summary shape (json_schema + markdown summary)
- Concurrent `instantiate_contract` semantics (no mutex; Phase 5 D-12 chain handles same-target writes)
- Step-level timeout default (`[contracts] step_timeout_seconds = 30` lean)
- Exact assembly DAGs for three reference contracts (drafted in plan 06-02/06-03 against Atlas Robotics)
- CON-09 canonical "non-Claude" MCP client (Inspector + ChatGPT Custom Connector adapter both pass)
- `audit_log` retention for `contract_step` rows (Phase 2 default; revisit if balloons)
- `tools-list.snapshot.json` regen — additive diff in Phase 6 PR; one regen

---

## Deferred Ideas

Captured for future phases / minor releases:

- **Macros / sub-contracts** — `verb: macro:<name>` resolving to `_contracts/_macros/<name>.yaml`. Out of v2.0.0; revisit if real-world authors compose verb chains repeatedly.
- **In-process TypeScript plugins** — rejected for v2 (security surface). Probably out of v3 too.
- **Per-call LLM strategy override on `compile_brief`** — Phase 5 deferred; Phase 6 inherits the deferral.
- **MCP Prompts surface** — rejected for v2 (ChatGPT Custom Connector doesn't consume MCP Prompts).
- **Cross-vault contracts** — out of v2.0.0; revisit when Phase 10 Notion connector lands.
- **Per-step retries / circuit breakers** — single attempt + structured error in v2.
- **`audit_log` retention policy for `contract_step` rows** — same as Phase 2 default; future migration if needed.
- **Per-vault `tools-list.snapshot.json` variants** — v2.x may add a CLI flag if maintainers need them.
- **LLM-generated `list_contracts` summaries** — v2.x if real UX demands it.
- **Contract versioning / migration** — `version: 1` only in v2.0.0.
- **GraphQL-style query language for assembly** — far out of v2.0.0.
- **Contract composition** (`verb: contract:<name>`) — macros cover the common case.

---

## Process Notes

- User asked for clarification on Area 2 (assembly verb vocabulary) before answering. Claude re-explained the options in plain English with side-by-side pros/cons. This produced a richer answer than the original menu — the user added a custom-tool requirement that drove two follow-up sub-questions.
- All other areas were answered on first pass.
- Five total areas captured (4 selected + 1 orthogonal follow-up on loading lifecycle).
- Twelve sub-decisions captured: D-A1, D-A1b, D-A1c, D-A2a (verb set), D-A2a (custom-tool source), D-A2b, D-A2c, D-A3a, D-A3b, D-A4a, D-A4b, D-A4c, D-LOAD.
