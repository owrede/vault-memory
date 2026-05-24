# ADR-020 — Contract as a first-class persisted type

**Status:** Proposed
**Date:** 2026-05-21
**Phase:** post-v2.0.0 (v2.x extension; informs v2.1 work)
**Supersedes:** —
**Superseded by:** —
**Related:** ADR-003 (Document shape), ADR-004 (Memory Sink Handles), ADR-006 (Task Contract DSL), ADR-023 (Contracts as MCP Resources).

---

## Context

ADR-003 establishes `Document` as the canonical content type with
`properties: Record<string, unknown>` as the property bag. ADR-006 lands
the `ContractFileSchema` Zod and the `_contracts/*.yaml` loader, exposing
contracts to agents via two MCP verbs (`describe_contract`,
`instantiate_contract`).

That surface treats a contract as *configuration that the loader parses*,
not as a first-class persisted thing the rest of the system reasons over.
Operationally, several questions have no clean home today:

1. *"Show me every contract in this vault, grouped by owner."*
2. *"Which `discovery-call` contract version did this instance validate
   against?"*
3. *"What contracts reference `Company` as a `$ref` type?"*
4. *"What is the diff between this contract and its version on main?"*

These are typed queries over the *set* of contracts. ADR-006's
`ContractRegistry` is the in-memory authoritative state but is not itself
queryable from outside the loader, and `_contracts/*.yaml` files are
indexed as opaque notes (their structure is not exposed to
`queryFrontmatter` beyond raw frontmatter strings).

The v2 brief's framing is that `Document` is the canonical content type.
A contract is **not a Document** — it is a *type* over Documents, the
SQL-table-definition to the Document-row. Treating it as a peer rather
than a special note unlocks the queries above without overloading
`Document` semantics.

---

## Decision

Introduce `Contract` as a first-class persisted type with its own table,
its own query namespace, and its own MCP surface, parallel to `Document`
and never confused with it.

### Persistence

A new SQLite table `contracts` per-vault:

```sql
CREATE TABLE contracts (
  name              TEXT PRIMARY KEY,
  version           INTEGER NOT NULL,
  yaml_source_path  TEXT NOT NULL,          -- _contracts/<name>.yaml
  yaml_hash         TEXT NOT NULL,           -- sha256 of canonical YAML
  parsed_json       TEXT NOT NULL,           -- ContractFileSchema-validated JSON
  input_schema_json TEXT NOT NULL,           -- buildInputSchema output
  owner             TEXT,
  description       TEXT,
  loaded_at         INTEGER NOT NULL,        -- epoch ms
  load_status       TEXT NOT NULL            -- 'loaded' | 'parse_error' | 'duplicate_name'
);
CREATE INDEX idx_contracts_owner ON contracts(owner);
CREATE INDEX idx_contracts_load_status ON contracts(load_status);
```

The table is populated by the existing ADR-006 ChangeFeed dispatch. The
loader's existing `ContractRegistry` becomes a thin read-through cache
over this table; the table is the *durable* state.

### MCP surface

Three new tools, additive to the ADR-006 dual surface:

| Tool | Purpose |
|---|---|
| `list_contracts({vault?, owner?, status?})` | Enumerate contracts with summary fields |
| `get_contract({name, vault?})` | Full contract record (parsed JSON + schema) |
| `validate_against_contract({doc_id, contract_name})` | Check whether a Document satisfies a contract |

`describe_contract` (ADR-006) and `get_contract` look near-duplicate but
are not: `describe_contract` returns the human-rendered markdown summary
for an agent about to *instantiate* the contract; `get_contract` returns
the raw record for an agent or UI *reasoning over* contracts as data.
Both surfaces stay. Phase 8 REL-08 reconciliation may collapse them.

### Distinct from Document

A `Contract` is **not** a `Document` and MUST NOT be returned by `search`,
`fetch`, `read_note`, or `get_document_bundle`. Three structural reasons:

1. **Different identity scheme.** Contract names are `kebab-case`
   identifiers, not URIs. They are unique per vault, not globally.
2. **Different lifecycle.** Contracts version with the codebase; Documents
   version with user editing.
3. **Different write authority.** Contracts are user-or-developer-authored
   (or written via the canvas editor, ADR-007). Agents MUST NOT write
   contracts via the MemorySink path; the contract-write path is a
   distinct MCP capability gated separately and currently scoped to the
   plugin (ADR-007).

### Validation

`validate_against_contract({doc_id, contract_name})` runs the contract's
`output_shape` Zod schema against the Document's `properties`. Returns
`{ok: true}` or `{ok: false, issues}` mirroring ADR-006's closed error
envelope. Pure function, no side effects.

This makes contract conformance a **query**, not a write-time
side-effect. An eval scenario can scan every Document with
`kind: discovery-call` and assert that all of them still satisfy
`discovery-call@v2`.

---

## Invariants

| ID | Statement | Enforced by |
|---|---|---|
| C-20-1 | `Contract` is never returned by `Document`-shaped tools (`search`, `fetch`, `read_note`, `get_document_bundle`). | Tool handler type signatures (`Document[]` return) + integration test. |
| C-20-2 | The `contracts` table is updated only by the ADR-006 loader; no other code path writes to it. | Module boundary — only `src/contracts/registry-db.ts` exposes a writer. |
| C-20-3 | `validate_against_contract` is a pure function with no side effects (no `audit_log` row, no write). | TypeScript signature returns a result; no Database mutator imports in `src/contracts/validate.ts`. |
| C-20-4 | A contract whose `load_status != 'loaded'` is omitted from `list_contracts` results unless `status: 'all'` is explicitly passed. | Default predicate `WHERE load_status = 'loaded'` in `list_contracts` query. |
| C-20-5 | Contract names are unique per vault (table PK); collision policy is first-wins per ADR-006 §C-4 — second loader row writes `load_status: 'duplicate_name'`. | PK constraint + ADR-006 `ContractRegistry.set` collision branch. |

---

## Examples

### List all contracts owned by the sales team

```jsonc
// Call
list_contracts({ owner: "sales-team" })

// Response
{
  "ok": true,
  "contracts": [
    { "name": "discovery-call", "version": 2, "description": "...", "loaded_at": 1716300000000 },
    { "name": "deal-review",    "version": 1, "description": "...", "loaded_at": 1716300000000 }
  ]
}
```

### Validate an instance against its declared contract

```jsonc
validate_against_contract({
  doc_id: "obsidian://my-vault/Sales/Calls/2026-05-21-acme.md",
  contract_name: "discovery-call"
})

// Response
{
  "ok": false,
  "issues": [
    { "path": ["next_step"], "code": "invalid_type", "expected": "string", "received": "undefined" }
  ]
}
```

### Two-source equivalence (forward to Phase 10 Notion adapter)

The same `Contract` definition validates instances persisted as Obsidian
markdown notes *and* as Notion pages — the validator runs on
`Document.properties`, which both adapters populate. No Notion-specific
code path appears in `src/contracts/`.

---

## Consequences

**Positive.**

- Contracts become queryable as data. `list_contracts`, `get_contract`,
  and `validate_against_contract` cover the operational questions in
  §Context without overloading `Document`.
- The persisted table makes the contract surface diff-able across server
  restarts and across vaults — an eval can compare contract sets
  between two vaults.
- Phase 10 Notion adapter inherits the typing for free: a Notion page
  with `kind: discovery-call` validates against the same contract.

**Negative.**

- One new table, one new module (`src/contracts/registry-db.ts`), three
  new MCP tools. Tool budget rises by 3 to 40 (ADR-006 baseline 37).
  Phase 8 REL-08 reconciliation may collapse `describe_contract` and
  `get_contract`.
- The loader becomes responsible for keeping the table consistent with
  `_contracts/*.yaml`. Existing ADR-006 ChangeFeed semantics cover
  create / update / delete; rename is unlink + add per ADR-006.
- The boot scan grows by one SQLite write per contract. Empirically
  trivial (<5 ms per file at vault sizes we care about).

**Neutral.**

- The plugin's canvas editor (ADR-007) does not change — it still writes
  `.contract` JSON and emits canonical YAML. The new table catches the
  YAML at the ChangeFeed boundary.

---

## Open follow-ups

- **`describe_contract` vs `get_contract` reconciliation** — decide at
  Phase 8 REL-08 whether to collapse them with a `format: "summary" |
  "json"` arg.
- **Notion adapter ports `_contracts/`** — ADR-014 (Open) needs to
  declare where contracts live when the source is Notion. Provisional
  answer: a Notion database tagged `kind: contracts`, with one page per
  contract; the contract YAML lives in a `body` block.
- **Contract-level audit log** — should a `contract_audit kind: 'contract_loaded'`
  row land on every successful load? ADR-006's `contract_audit` table
  currently only records steps and load errors. Decided no for v2.x;
  successful loads are deducible from the table's `loaded_at` column.

---

## References

- ADR-003 — Document shape; `properties: Record<string, unknown>` is the
  property bag that `validate_against_contract` checks against.
- ADR-004 — MemorySink invariants; contract instances land in
  MemorySinks; contracts themselves do not.
- ADR-006 — Task Contract DSL; this ADR builds on its `ContractRegistry`
  and `ContractFileSchema`.
- ADR-007 — Contract Editor; the canvas writes `.contract` JSON and
  emits canonical YAML that this ADR's loader reads.
- ADR-023 — Contracts as MCP Resources; complements this ADR by exposing
  the same `Contract` records as MCP resources, not just tools.
