# ADR-022 — Typed cross-contract edges

**Status:** Proposed
**Date:** 2026-05-21
**Phase:** post-v2.0.0 (v2.x extension; touches indexer, graph, and search)
**Supersedes:** —
**Superseded by:** —
**Related:** ADR-003 (Document shape), ADR-006 (Task Contract DSL), ADR-020 (Contract as first-class type), ADR-021 (Authority and staleness as ranking inputs).

---

## Context

vault-memory v1 ships a `wikilinks` table populated by parsing
`[[Target]]` and `[[Target|alias]]` markers from note body. The
`list_backlinks` and `expand` tools traverse it. The graph is **untyped**
— an edge is just *"note A mentions note B"*.

Contracts introduce a stronger notion: a typed field reference.
`discovery-call.company: ref(Company)` is not a wikilink — it is a
*declaration that this field, by contract, points to a Company*. The same
distinction holds for `participants: list(ref(Person))`, for
`superseded_by: ref(DiscoveryCall)`, and so on.

Queries the typed edge unlocks that the untyped graph cannot:

1. *"All DiscoveryCalls where `company` is a Company tagged `segment:
   healthcare`."* — two-hop typed traversal.
2. *"All Persons referenced as `participants` of any DiscoveryCall in
   `qual` stage."* — reverse typed traversal with a predicate on the
   source side.
3. *"What contracts depend on `Company`?"* — schema-level introspection
   (which contracts declare a `ref(Company)` field).

Plain wikilinks cannot answer these. The edge `Sales/Calls/acme.md →
Companies/acme.md` is the same edge regardless of whether it appears in a
sentence ("called Acme today") or as the `company` field of a
DiscoveryCall instance. The semantic role is lost at parse time.

---

## Decision

Introduce a parallel `typed_refs` edge table populated at instance write
time, alongside the existing `wikilinks` table. Both tables coexist; they
serve different purposes.

### Persistence

```sql
CREATE TABLE typed_refs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_doc_id TEXT NOT NULL,        -- the instance that holds the field
  source_kind   TEXT NOT NULL,        -- contract name (e.g., 'discovery-call')
  field_path    TEXT NOT NULL,        -- e.g., 'company' or 'participants[2]'
  target_doc_id TEXT NOT NULL,        -- the document pointed to
  target_kind   TEXT,                 -- contract name of target, if known
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_typed_refs_source ON typed_refs(source_doc_id);
CREATE INDEX idx_typed_refs_target ON typed_refs(target_doc_id);
CREATE INDEX idx_typed_refs_source_kind_field ON typed_refs(source_kind, field_path);
CREATE INDEX idx_typed_refs_target_kind ON typed_refs(target_kind);
```

The four indexes cover the three query classes above:

- `idx_typed_refs_source` → "what does this instance point to?"
- `idx_typed_refs_target` → "what points to this document?"
- `idx_typed_refs_source_kind_field` → "all DiscoveryCalls where
  `company` = X" (with a join on `target_doc_id`).
- `idx_typed_refs_target_kind` → "all Persons referenced by any
  DiscoveryCall."

### Population

Typed refs are extracted **at contract instance write time**, not at
parse time. The flow:

1. Caller invokes `instantiate_contract`, the agent fills the contract,
   the DeliveryAdapter writes the instance via `writeNote`.
2. `writeNote` calls `extractTypedRefs(contract, instance)` —
   a pure function that walks the contract schema, finds every
   `ref(Kind)` field, resolves the target DocId, and returns a list of
   `{field_path, target_doc_id, target_kind}` rows.
3. The rows are written to `typed_refs` in the same transaction as the
   note write.

A contract change (ADR-006 hot reload) does NOT retroactively rewrite
existing typed_refs. The rows reflect the contract version at write
time. If the contract is later revised, the eval harness flags instances
whose typed_refs no longer satisfy the new schema (ADR-020
`validate_against_contract`).

### Coexistence with wikilinks

`wikilinks` is unchanged: every `[[Target]]` in body still produces a
`wikilinks` row. `typed_refs` is additive. A field that contains a
wikilink to a target will produce both rows: one in `wikilinks` (parsed
from body) and one in `typed_refs` (extracted from the contract field).
The two tables answer different questions and a tool that needs both
joins them explicitly.

### MCP surface

Two new tools, additive to the existing `list_backlinks` / `expand`:

| Tool | Purpose |
|---|---|
| `query_typed_refs({source_kind?, field_path?, target_kind?, target_doc_id?, source_doc_id?, vault?})` | Filtered enumeration |
| `expand_typed({doc_id, follow: [{field_path, max_hops}], vault?})` | Multi-hop typed traversal |

`expand_typed` is the typed analog of the existing `expand` verb. The
`follow` argument is explicit — a caller must declare which fields to
traverse, with a hop limit per field. This prevents the
"follow-everything blow up" failure mode that untyped graph traversal is
prone to.

### Schema-level queries

`get_contract` (ADR-020) gains a computed field `referenced_kinds:
string[]` — the set of kinds this contract references via `ref()`
fields. This is the schema-level introspection that answers "what
contracts depend on Company?" via `list_contracts` + filter.

---

## Invariants

| ID | Statement | Enforced by |
|---|---|---|
| C-22-1 | Typed refs are populated only by `writeNote` extracting from a contract instance — never by body parsing. | `extractTypedRefs` is called only from `src/write/write.ts`; no parser writes to `typed_refs`. |
| C-22-2 | `typed_refs` rows reflect the contract version at write time. Contract hot reload does NOT retroactively rewrite them. | No `UPDATE` or backfill on contract reload; the loader writes only to `contracts` table (ADR-020). |
| C-22-3 | `expand_typed` requires explicit `follow` paths with hop limits — there is no "follow everything" mode. | Zod schema requires non-empty `follow` array. |
| C-22-4 | A contract field declared `ref(Kind)` whose target DocId cannot be resolved at write time produces `target_kind = null` and surfaces in `query_typed_refs(unresolved: true)`. | `extractTypedRefs` returns rows with null `target_kind` when resolution fails; the row is NOT dropped. |
| C-22-5 | Deletion of an instance (`deleteNote`) cascades `typed_refs WHERE source_doc_id = ?` in the same transaction. | FK-like behavior implemented in `deleteNote`; no orphan rows. |

---

## Examples

### Find all DiscoveryCalls whose company is in healthcare

```jsonc
// Step 1: find Company instances in healthcare
query_frontmatter({ kind: "company", segment: "healthcare" })
// → [obsidian://my-vault/Companies/acme.md, obsidian://my-vault/Companies/medco.md]

// Step 2: find all DiscoveryCalls pointing at those companies via `company` field
query_typed_refs({
  source_kind: "discovery-call",
  field_path: "company",
  target_doc_id: ["obsidian://my-vault/Companies/acme.md", "obsidian://my-vault/Companies/medco.md"]
})
// → [{ source_doc_id: "obsidian://my-vault/Sales/Calls/2026-05-19-acme.md", ... }, ...]
```

The query is *typed* — it would not pick up a DiscoveryCall that mentions
`acme.md` only via a body wikilink (e.g., "see also [[acme]]").

### Reverse: find all Persons referenced as participants in any qual-stage call

```jsonc
// Step 1: find qual-stage calls
query_frontmatter({ kind: "discovery-call", stage: "qual" })
// → [doc_a, doc_b, ...]

// Step 2: pull their participants
query_typed_refs({
  source_doc_id: [doc_a, doc_b, ...],
  field_path: "participants[*]"     // glob — matches participants[0], participants[1], …
})
// → [{ target_doc_id: "obsidian://my-vault/People/alice.md" }, ...]
```

### Schema introspection: what depends on Company?

```jsonc
list_contracts({})
// → [discovery-call, deal-review, account-plan, ...]

// Each ContractRecord exposes `referenced_kinds`:
// discovery-call.referenced_kinds → ["company", "person", "recording"]
// → filter to those containing "company"
```

---

## Consequences

**Positive.**

- Two-hop typed queries become tractable in SQL, no LLM in the loop.
- The graph stops being a flat name space. A query like "all
  participants of qual-stage healthcare calls" is one join chain, not
  an LLM prompt.
- The eval harness can assert structural properties:
  *"every DiscoveryCall must have a resolved `company` ref"* becomes
  `SELECT * FROM typed_refs WHERE source_kind = 'discovery-call' AND
  field_path = 'company' AND target_kind IS NULL`.

**Negative.**

- One new table, one new extraction step at write time, two new MCP
  tools. The write path gets ~1 ms slower per typed field. Empirically
  negligible against the FS + embed cost.
- Typed refs are write-time. A bulk reindex DOES NOT rebuild them
  automatically — that would require re-parsing every note against its
  current contract. The migration utility `vault-memory contract
  backfill-refs` lives outside the hot path; users opt in.
- The `follow` argument on `expand_typed` is a UX papercut. A
  multi-hop typed query needs the caller to know the field path. The
  documented `referenced_kinds` field on `get_contract` is the
  discovery aid.

**Neutral.**

- `wikilinks` and `list_backlinks` are unchanged. Existing tooling that
  uses them keeps working.

---

## Open follow-ups

- **Backfill utility.** `vault-memory contract backfill-refs` walks
  every Document whose `kind` matches a loaded contract and populates
  `typed_refs`. Useful for retrofitting onto an existing vault. Lands
  v2.1.
- **Glob field paths in writes.** Today `field_path` is stored as a
  literal path (`participants[0]`). A future iteration may store
  `participants[*]` for list-valued fields to compress storage. Defer
  until volume forces the optimization.
- **Cross-vault typed refs.** A `ref(Kind)` whose target lives in a
  different vault. ADR-001 makes DocIds globally unique, so the storage
  works. The semantic question is whether contracts should be allowed
  to declare cross-vault refs at all. Decision deferred to Phase 10.

---

## References

- ADR-001 — opaque DocId identity; ref targets are DocIds.
- ADR-003 — Document shape; `properties` is where the field values live.
- ADR-006 — Task Contract DSL; `ref(Kind)` is a contract field type.
- ADR-020 — Contract as first-class type; `referenced_kinds` is the
  schema-introspection enabler.
- ADR-021 — Authority and staleness as ranking inputs; typed_refs may
  feed a future "fresh ref-target" signal.
- `src/db/queries/wikilinks.ts` — analog query pattern.
