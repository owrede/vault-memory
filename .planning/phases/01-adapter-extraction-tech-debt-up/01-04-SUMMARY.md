---
phase: 01
plan: 04
plan_id: 01-04
subsystem: adapters
status: in-progress
tags: [adapters, delivery, obsidian-fs, conformance, stub, client-info, display-url]
requirements: [ADP-02, ADP-06, ADP-13]
---

# Phase 01 Plan 04: Delivery adapter extraction + D-01 formatDisplayUrl rewire + D-02 client_info capture + StubDelivery + conformance

DeliveryAdapter seam landed end-to-end: src/write/* relocated to
src/adapters/delivery/obsidian-fs/, wrapped in an ObsidianFsDelivery facade,
write/update/delete tool handlers route through registry.resolveDelivery, MCP
client_info captured to replace the "claude-code" hardcode (D-02), obsidianUrl
helper deleted in favor of source.formatDisplayUrl (D-01), conformance proven by
parameterized test bank over [obsidian-fs, stub] adapters.

## URL encoding parity

**Audit of v1 `obsidianUrl()` at `src/server.ts:957`** (the helper being deleted
in Task 06 step D, per D-01):

```typescript
export function obsidianUrl(vaultName: string, notePath: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(notePath)}`;
}
```

Behavior:
- Uses `encodeURIComponent` per-segment (`vaultName` and `notePath` are each
  encoded independently).
- Spaces become `%20`; `#` becomes `%23`; `?` becomes `%3F`; `/` becomes `%2F`.
- Per-segment encoding (NOT whole-URL `encodeURI`).

**Comparison against 01-03's `ObsidianFsSource.formatDisplayUrl`** at
`src/adapters/source/obsidian-fs/index.ts:154`:

```typescript
formatDisplayUrl(id: DocId): string {
  const rel = this.docIdToPath(id);
  const vault = encodeURIComponent(this.vault.name);
  const file = encodeURIComponent(rel);
  return `obsidian://open?vault=${vault}&file=${file}`;
}
```

**Verdict: byte-for-byte identical.** Both use `encodeURIComponent` per-segment
on the same two fields (`vault.name`, `rel` path) and produce the exact same
template string `obsidian://open?vault=${vault}&file=${file}`.

**Reconciliation strategy chosen: (a) — preserve byte-for-byte.**

No adjustment needed in `src/adapters/source/obsidian-fs/index.ts`. Task 06
step D can delete `obsidianUrl()` and rewire call sites to
`source.formatDisplayUrl(docId)` without any change to the eval baseline's
`url` field. `npm run eval:baseline` will be re-run as part of Task 06 step E
to confirm; if any drift surfaces (e.g. from a hidden edge case in `docIdToPath`
normalization), strategy (a) remains preferred and we adjust `formatDisplayUrl`
to match v1 exactly.

(Strategy (b) — regenerating the v1-baseline `url` fixtures with maintainer
sign-off — is the explicit fallback if (a) cannot be made to work for some
unforeseen case. We do NOT expect to need it.)
