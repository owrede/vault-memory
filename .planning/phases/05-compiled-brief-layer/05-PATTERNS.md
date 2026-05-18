# Phase 5: Compiled Brief Layer — Pattern Map

**Mapped:** 2026-05-18
**Files analyzed:** 14 new + 7 extensions to existing files + 9 co-located tests
**Closest analogs:** All have either exact or role-match analogs in v1.x / v2 Phases 0–4. Zero "no analog" files.

This map answers: *for every new file in Phase 5, what existing file does it copy patterns from, and at what line numbers?* The planner consumes this verbatim into `## Action` sections of each plan.

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `docs/v2/adr/005-brief-compile-strategy.md` | ADR | docs | `docs/v2/adr/004-memory-sink-handles.md` | exact |
| `src/brief/compile.ts` | controller (MCP tool) | request-response + delivery write | `src/memory/tools/record-observation.ts` + `src/memory/tools/supersede.ts` | exact |
| `src/brief/get.ts` | controller (MCP tool) | request-response | `src/memory/tools/recall.ts` (decision-tree shape) + `src/memory/tools/supersede.ts` (read via SourceConnector) | exact |
| `src/brief/daemon.ts` | service (in-process daemon) | event-driven (ChangeFeed subscriber) | `src/watcher/watcher.ts` (`VaultWatcher` start/drain/stop lifecycle) + `src/adapters/change-feed/obsidian-fs/change-feed.ts` (subscriber pattern) | role-match |
| `src/brief/source-hashes.ts` | utility | transform | `src/sections/anchor.ts` (sha256 + NFC) + new logic | role-match |
| `src/brief/body-validator.ts` | utility | transform | `src/indexer/extract-edges.ts` (wikilink regex extraction) + `src/memory/tools/record-observation.ts` slugify pattern (pure transform) | role-match |
| `src/brief/lock.ts` | utility (process state) | file-I/O (carve-out) | NEW pattern — closest analog is `src/audit/` / `src/db/` (legitimate `~/.vault-memory/` access); no direct analog | partial |
| `src/brief/chunk-id.ts` | utility (branded ID) | transform | `src/adapters/registry.ts:67-94` `parseDocId` brand pattern | exact |
| `src/brief/llm-ladder.ts` | service (capability dispatch) | request-response | `src/rerank/reranker.ts` (interface + dispatch) + new SDK Sampling integration | role-match |
| `src/brief/resources.ts` | MCP Resource handler | request-response (read-only) | `src/memory/resources/list-sinks.ts` | exact |
| `src/memory/contract/default-brief-v1.ts` | contract / Zod schema | validation | `src/memory/contract/default-v1.ts` | exact |
| `src/db/queries/brief_sources.ts` | model (query namespace) | CRUD | `src/db/queries/wikilinks.ts` (INSERT OR IGNORE + batch tx) | exact |
| `src/db/queries/daemon_state.ts` | model (query namespace) | CRUD (single-row upsert) | `src/db/queries/models.ts` (`getActive`/single-row idiom) — see "Reusable Helpers" | role-match |
| Migration 013 in `src/db/schema.ts` | migration | batch | `runMigration008` at `:443-464` (chunked backfill) + `runMigration011` at `:641-726` (multi-table DDL + chunked copy) | exact |
| `evals/fixtures/v2-test-vault/_queries/briefs-curated.yaml` | eval fixture | declarative | `evals/fixtures/v2-test-vault/_queries/brief.yaml` (existing) + `cluster.yaml` (snapshot shape) | exact |
| `evals/fixtures/v2-test-vault/_queries/briefs-from-cluster.yaml` | eval fixture | declarative | same as above | exact |
| `evals/fixtures/v2-test-vault/_queries/briefs-staleness-stub.yaml` | eval fixture (conformance) | declarative | `src/adapters/source/conformance.test.ts` parametric input | role-match |
| **Extensions (read pattern, then extend)** | | | | |
| `src/ollama/client.ts` (add `chat()`) | service extension | request-response | EXISTING `embed()` at `:81-138` (same retry / timeout / Zod parse) | exact |
| `src/chunker/` (compute `chunk_id_fragment`) | utility extension | transform | `src/sections/anchor.ts:37-41` (NFC + sha256 idiom) | exact |
| `src/server.ts` (daemon bootstrap + Resource + tool registration) | bootstrap | composition | EXISTING `:200-330` (watcher/feed registration) + `:1022-1061` (Resource registration) + `:989-1012` (tool registration) | exact |
| `src/tool-registry.ts` (register 2 tools) | bootstrap | composition | EXISTING `:41-916` `TOOLS` array; `:961` `TOOL_SCHEMAS` map | exact |
| `src/adapters/source/conformance.test.ts` (extend) | conformance | declarative | EXISTING `describe.each` parametric pattern at top of file | exact |
| `evals/v1-baseline/tools-list.snapshot.json` | snapshot | data | EXISTING file (32 entries today; additive +2) | exact |
| `src/memory/registry.ts` (sub-folder sink ordering) | bootstrap | composition | EXISTING `findSinkContaining` at `:190-202` (`startsWith` over insertion order) | exact |
| `src/types.ts` (add `Brief`, `ChunkId`, `BriefStatus`, `BriefSourceHash`) | type definitions | data | EXISTING branded types at `:347` `DocId` and `:367` `MemorySinkHandle` | exact |

---

## Pattern Assignments

Every section below names the analog, the line range to read, and the specific lines/idioms the new code copies. The planner cites these verbatim in plan `## Action` sections.

---

### `docs/v2/adr/005-brief-compile-strategy.md` (ADR — D-10/D-11/D-12)

**Analog:** `docs/v2/adr/004-memory-sink-handles.md` (Phase 2 ADR, similar scope: ships a new contract + sub-namespace).

**Why this analog:** Phase 2/3/4 ADRs follow the same skeleton — Context → Decision → Invariants (H-*) → Rationale (rejected alternatives) → Forward compatibility. ADR-004 specifically introduces the `_memory/_briefs/` sub-namespace concept that ADR-005 builds on.

**Sections to copy verbatim from ADR-004:**
- `## Context` (motivation; ADR-005 cites the 85%-rediscovery failure mode)
- `## Decision` block per gray-area (one per D-10 / D-11 / D-12 plus the new contract section)
- `## Invariants` numbered list (H-style identifiers; ADR-005 adds e.g. `B-1` `compile_brief` source-set is closed; `B-2` LLM ladder is capability-first; `B-3` recompile is auto-supersede)
- `## Rationale (rejected alternatives)` (one paragraph per option B/C/D rejected per CONTEXT)
- `## Forward compatibility` (Phase 10 Notion adapter; v3 block-level staleness)

**Phase 5-specific sections to add (no analog — author from CONTEXT §<decisions>):**
- `### Capability-first LLM ladder` (D-10) — four-tier dispatch table
- `### Chunk-level source_hashes` (D-04, D-05) — re-references ADR-003 H-5
- `### Recompile chain` (D-12) — auto-supersede semantics
- `### Brief body shape` (D-11) — wikilink-in-body + Sources footer
- `### Rename handling` (BRF-08) — grace-window heuristic (per RESEARCH §Pattern: Rename Survival)
- `### Lockfile carve-out` (per RESEARCH A5) — `src/brief/lock.ts` exemption from adapter-seam lint
- `### Never bundle remote LLM SDK` invariant — D-10 tier-4 structured-error story

---

### `src/brief/compile.ts` (MCP tool controller, request-response → DeliveryAdapter)

**Primary analog:** `src/memory/tools/record-observation.ts` (lines 1–120 for file header + protected-keys pattern + Deps shape).
**Secondary analog:** `src/memory/tools/supersede.ts` (lines 53–121 for D-12 auto-supersede; mirrors `expectedHash` OCC).

**Imports pattern** (copy from `record-observation.ts:28-37`):
```typescript
import { createHash, randomBytes } from "node:crypto";
import type {
  DeliveryAdapter,
  WriteResult,
} from "../../adapters/delivery/types.js";
import { formatDocId, parseDocId, decomposeDocId } from "../../adapters/registry.js";
import type { SourceConnector } from "../../adapters/source/types.js";
import type { Document } from "../../types.js";
import type { VaultManager } from "../../vault/index.js";
import type { MemorySinkRegistry } from "../registry.js";
```

**Deps interface pattern** (copy from `record-observation.ts:73-89`):
```typescript
export interface CompileBriefDeps {
  memorySinkRegistry: MemorySinkRegistry;
  manager: VaultManager;
  deliveryAdapterFor: (vaultName: string) => DeliveryAdapter;
  sourceConnectorFor: (vaultName: string) => SourceConnector;
  // Phase 5 additions:
  server: McpServer;                // D-10 tier 1 Sampling
  ollama: OllamaClient;             // D-10 tier 2
  computeBodyForBrief: typeof compileWithLlm;  // ladder dispatch (llm-ladder.ts)
}
```

**Args interface pattern** (copy from `record-observation.ts:91-104`, replace observation sugars with brief sugars):
```typescript
export interface CompileBriefArgs {
  target: string;                   // BRF-03 stable handle
  source_doc_ids: string[];         // D-01 caller-supplied
  purpose: string;
  max_tokens?: number;              // default 2000 per RESEARCH discretion
  prepared_text?: string;           // D-10 tier 3
  sink?: string;                    // defaults to `_memory/_briefs/` sink
  vault?: string;
}
```

**D-12 supersede chain pattern** (copy directly from `supersede.ts:53-121`):
- Use `deps.memorySinkRegistry.findSinkContaining(oldId)` to validate enclosing sink (`supersede.ts:69`).
- Read OLD doc via `deps.sourceConnectorFor(vaultName).readDocument(oldId)` (`supersede.ts:93`).
- Strip adapter-injected `wikilinks` array before merging (`supersede.ts:100-103`).
- Call `delivery.update(oldId, patch, {expectedHash: oldDoc.hash, sink: sink.handle})` (`supersede.ts:117-120`).
- **Critical** — pass the FULL property bag merged with `{status: "superseded", superseded_by: newDocId, superseded_reason: "recompiled"}`, NOT a minimal patch (per the comment at `supersede.ts:82-91` — validator runs schema against patch alone).

**Write the new brief** (mirror `record-observation.ts` write flow): call `delivery.write({...}, {sink: briefSink.handle})` — exact signature to be verified from `src/adapters/delivery/types.ts` `DeliveryAdapter.write` (the same chokepoint `supersede.update` routes through).

**`brief_sources` population pattern** (after successful write, populate the reverse index):
- Pure DB call: `vault.db.briefSources.insertBatch(briefDocId, sourceHashes)` (new namespace; INSERT OR IGNORE pattern from `wikilinks.ts:74-87`).

**Naming for the timestamped slug** (D-12; copy ISO compact form pattern from `record-observation.ts` slugify but with timestamp suffix):
```typescript
const slug = `${target}--${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 13)}`;
// e.g. "atlas-q3-status--20260518T1430"
```

**Error handling** (copy discriminated-union pattern from existing tools — see CONVENTIONS.md §Error Handling §1):
```typescript
type CompileBriefResult =
  | { ok: true; doc_id: string; supersededPrior?: string }
  | { ok: false; reason: "no_llm_strategy_available"; attempted: string[]; hint: string }
  | { ok: false; reason: "too_many_sources"; limit: number; hint: string }
  | { ok: false; reason: "cross_vault_sources"; offending: string[] }
  | { ok: false; reason: "sampling_refused" };
```

---

### `src/brief/get.ts` (MCP tool controller, request-response, decision tree)

**Primary analog:** `src/memory/tools/recall.ts` (lines 1–160 for Deps + Args shape; same controller-purity rules).
**Secondary:** `src/memory/tools/supersede.ts:92-93` for the SourceConnector-read pattern.

**File header / purity comment** — copy verbatim from `recall.ts:1-45`, swap "Retrieves memory documents" for "Looks up a brief by target slug and applies D-13 decision tree."

**Deps interface** (copy from `recall.ts:70-77`):
```typescript
export interface GetBriefDeps {
  memorySinkRegistry: MemorySinkRegistry;
  manager: VaultManager;
  sourceConnectorFor: (vaultName: string) => SourceConnector;
  // Phase 5 addition — looks up briefs by `target` property
  findBriefByTarget: (vault: Vault, target: string) => Promise<Document | null>;
}
```

**Args interface** (copy from `recall.ts:79-87`):
```typescript
export interface GetBriefArgs {
  target: string;
  max_age_days?: number;
  allow_stale?: boolean;
  vault?: string;
}
```

**D-13 decision tree** — pseudocode is in CONTEXT.md D-13 (lines 98–105). Implement as discriminated union return:
```typescript
type GetBriefResult =
  | { brief: Document; stale: false; too_old: false }
  | { brief: Document; stale: true; too_old: boolean; changed_sources: string[] }  // allow_stale: true
  | { brief: null; stale: true; changed_sources: string[]; reason: "stale_blocked" }
  | { brief: null; stale: false; too_old: true; age_days: number; reason: "too_old_blocked" }
  | { brief: null; reason: "not_found" };
```

**Follow-supersede-chain pattern** — when looked-up brief has `status: superseded`, follow `superseded_by` until terminal (forward-only invariant from Phase 2 D-03). Walk pattern: read brief → if `superseded_by` non-null, `parseDocId` and re-read via `SourceConnector.readDocument` → loop with cycle guard (max 100 hops). No analog for the loop itself — write fresh, but the read mechanism is `supersede.ts:93`.

---

### `src/brief/daemon.ts` (service, event-driven)

**Primary analog:** `src/watcher/watcher.ts` `VaultWatcher` class (full file). Mirror its `start()` / `drain()` / `stop()` lifecycle and Disposable management.
**Secondary analog:** `src/adapters/change-feed/obsidian-fs/change-feed.ts:96-234` (the handler fan-out semantics that the daemon piggybacks on).

**Class shape pattern** (mirror `VaultWatcher`):
```typescript
export class BriefStalenessDaemon {
  private disposable: Disposable | null = null;
  private vault!: Vault;

  async start(vault: Vault, feed: ChangeFeed): Promise<void> { ... }
  async shutdown(): Promise<void> { ... }
}
```

**Daemon startup ordering** (RESEARCH §Pattern: Hybrid Replay):
1. `tryAcquireLock(vault.config.name)` — if `acquired: false`, log structured WARN to stderr and return early (per D-08).
2. Read `vault.db.daemonState.getCursor(vault.config.name)` for diagnostics.
3. **Full scan** (correctness floor): iterate `vault.db.briefSources.listBriefDocIds()`, recompute hashes via `source-hashes.ts`, mark divergent briefs stale via `delivery.update()` (NOT direct DB write — see Anti-Patterns).
4. Subscribe to `feed.subscribe(handler)`; store the returned `Disposable` for shutdown.

**Subscribe pattern** (RESEARCH-verified at `change-feed.ts:216` — handlers run synchronously via fanout with async-error catch):
```typescript
this.disposable = feed.subscribe(async (event: ChangeEvent) => {
  try {
    switch (event.kind) {
      case "create":
      case "update":
        await this.evaluateChangedDocId(this.vault, event.id);
        break;
      case "delete":
        await this.markStaleByDocId(this.vault, event.id, "source_deleted");
        break;
      case "rename":
        await this.handleRename(this.vault, event.old_id, event.new_id);
        break;
    }
    this.vault.db.daemonState.setCursor(this.vault.config.name, Date.now());
  } catch (err) {
    // log + write audit_log; never crash the daemon (per Claude's discretion)
    this.vault.db.audit.recordWrite({ ...kind: "brief_staleness_error"... });
  }
});
```

**Disposable lifecycle** (per `change-feed.ts:138-141` and types.ts `Disposable`):
```typescript
async shutdown(): Promise<void> {
  if (this.disposable) {
    this.disposable[Symbol.dispose]();
    this.disposable = null;
  }
  await releaseLock(this.vault.config.name);  // LAST so a crashed shutdown leaves the lock for stale-detection
}
```

**Hot loop on `evaluateChangedDocId`** — pattern is pure DB lookup:
- `vault.db.briefSources.listBriefsForChunkDocId(event.id)` returns brief doc IDs affected by changed source.
- For each, fetch current chunks via `vault.db.chunks.getByNote(noteId)` and compare against `brief_sources.recorded_hash` for each `chunk_id_fragment`.
- Divergence → call `delivery.update(briefId, {properties: {status: "stale", changed_sources: [...]}}, {expectedHash: briefDoc.hash, sink: ...})`.

---

### `src/brief/source-hashes.ts` (utility, transform)

**Analog:** `src/sections/anchor.ts:37-41` (the canonical NFC + sha256 + utf8 idiom).

**Imports pattern** (copy verbatim from `anchor.ts:16-17`):
```typescript
import { createHash } from "node:crypto";
import type { ChunkId, DocId } from "../types.js";
```

**Canonical hash function** (RESEARCH §Pitfall 8 — add explicit LF + trim normalization beyond what `anchor.ts` does):
```typescript
export function computeChunkHash(text: string): string {
  // ADR-003 H-3 (NFC) + H-4 (LF) + RESEARCH Pitfall 8 (trim trailing ws)
  const canonical = text.replace(/\r\n/g, "\n").trimEnd().normalize("NFC");
  return "sha256:" + createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function computeChunkIdFragment(text: string): string {
  return computeChunkHash(text).slice("sha256:".length, "sha256:".length + 7);
}
```

**Build source_hashes map** — for each `source_doc_id`, query `vault.db.chunks.getByNote(noteId)`, build the map keyed by `formatChunkId(docId, fragment)` to full hash.

**Pure-function discipline** — no `fs`, no `gray-matter`, no `path`. Identical to `anchor.ts`.

---

### `src/brief/body-validator.ts` (utility, transform)

**Analog:** `src/indexer/extract-edges.ts` (wikilink regex extraction; used by Phase 4 D-02 indexer pass).

**Pattern:** Run a regex match for `[[<text>]]` against the LLM-emitted body; for each `source_doc_id` not represented in the matches (either by title or by full DocId), append it to a `## Sources` footer:

```typescript
const WIKILINK_RE = /\[\[([^\]]+?)(?:\|[^\]]+)?(?:#[^\]]+)?\]\]/g;

export function validateAndPatchBody(
  body: string,
  sourceDocIds: DocId[],
  resolveTitle: (id: DocId) => string,  // from chunks/notes
): string {
  const cited = new Set<string>();
  for (const m of body.matchAll(WIKILINK_RE)) cited.add(m[1]!);
  const missing = sourceDocIds.filter(
    (id) => !cited.has(resolveTitle(id)) && !cited.has(id),
  );
  if (missing.length === 0) return body;
  const footer = "\n\n## Sources\n" + missing.map((id) => `- [[${resolveTitle(id)}]]`).join("\n");
  return body + footer;
}
```

---

### `src/brief/lock.ts` (utility, file-I/O — carve-out from adapter-seam discipline)

**Analog:** No direct analog in `src/brief/` peer dirs. Pattern matches the legitimate-`fs` carve-outs in `src/audit/` and `src/db/` (which touch `~/.vault-memory/` for process state, not vault content).

**RESEARCH-verified code sketch (copy verbatim from RESEARCH §Pattern: Lock Acquire, lines 429-513).** That sketch is already correct, well-commented, and uses only Node stdlib. The planner should paste it into `src/brief/lock.ts` with a single change: add an escape comment at the top of the file mirroring `scripts/lint-adapters.sh:33` `ESCAPE_MARK='vault-memory:claude-ok'`:

```typescript
// vault-memory:claude-ok — process state (~/.vault-memory/locks/) not vault content.
// See ADR-005 §"Lockfile carve-out" for the rationale.
```

**Imports** (per RESEARCH sketch):
```typescript
import { open, readFile, unlink, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
```

**Exports:** `tryAcquireLock(vaultName) → Promise<LockResult>`, `releaseLock(vaultName) → Promise<void>`, `isProcessAlive(pid) → boolean` (the last private internal).

---

### `src/brief/chunk-id.ts` (utility, branded ID)

**Analog:** `src/adapters/registry.ts:67-94` (`parseDocId` IIFE-closed brand minting).

**Code sketch already in RESEARCH §Code Examples lines 921-960** — `formatChunkId` / `parseChunkId` / `decomposeChunkId` with FRAGMENT_REGEX. Copy verbatim.

**Brand declaration pattern** (copy from `registry.ts:347` and `:367`):
```typescript
export type ChunkId = string & { readonly __brand: "ChunkId" };
```

**Brand-closure pattern** (mirror `registry.ts:76-94` — the IIFE that closes `mintDocId`):
```typescript
const { parseChunkId } = (() => {
  // PATTERN_REGEX is the single source of truth.
  function parse(s: string): ChunkId { /* validation */ return s as ChunkId; }
  return { parseChunkId: parse };
})();
export { parseChunkId };
```

---

### `src/brief/llm-ladder.ts` (service, capability dispatch)

**Analog:** `src/rerank/reranker.ts` (interface + multiple-backend dispatch) — pattern of "tagged union of strategies, dispatch on `.kind`".

**RESEARCH-verified code sketch** (lines 287-389 of RESEARCH.md). Copy the `LlmStrategy` discriminated union, `resolveLlmStrategy` function, and `compileWithLlm` dispatch verbatim.

**Imports verified by RESEARCH at `node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.d.ts:140-150`:**
```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import type { CreateMessageResult } from "@modelcontextprotocol/sdk/types.js";
```

**Tier-1 Sampling capability detection** (RESEARCH-verified at `types.d.ts:572`):
```typescript
const caps = server.server.getClientCapabilities();
if (caps?.sampling) return { kind: "sampling" };
```

**Critical error handling** — RESEARCH §Pattern: LLM Ladder §"Error semantics on client refusal": wrap `createMessage` in try/catch and translate any throw to `BriefLlmSamplingRefusedError`. This is the only domain-specific error class the file needs.

---

### `src/brief/resources.ts` (MCP Resource handler)

**Analog:** `src/memory/resources/list-sinks.ts` (entire file, ~55 lines).

**Pattern:** Pure function over `MemorySinkRegistry` + `VaultManager`. No `fs`, no `gray-matter`, no DB write — read-only enumeration.

**Imports** (copy from `list-sinks.ts:14`):
```typescript
import type { MemorySinkRegistry } from "../memory/registry.js";
import type { VaultManager } from "../vault/index.js";
```

**Return type** (mirror `ListSinksResource` at `list-sinks.ts:17-21`):
```typescript
export interface ListBriefsResource {
  total: number;
  briefs: ListBriefEntry[];
}

export interface ListBriefEntry {
  doc_id: string;
  target: string;
  purpose: string;
  compiled_at: string;
  status: "active" | "stale" | "superseded" | "archived";
  source_count: number;
  age_days: number;
  vault: string;
}
```

**Handler** — enumerate `_memory/_briefs/*.md` via `SourceConnector.listDocuments` (NOT raw `fs`). Filter to `properties.type === "brief"`. Project to `ListBriefEntry`.

**Registration in `src/server.ts`** — RESEARCH-verified pattern at `server.ts:1022-1041`:
```typescript
server.registerResource(
  "briefs",
  RESOURCE_URI_LIST_BRIEFS,           // = "vault-memory://briefs"
  { title: "Compiled briefs", description: "...", mimeType: "application/json" },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json",
      text: JSON.stringify(readListBriefs(memorySinkRegistry, manager), null, 2) }],
  }),
);
```

**Where the constant lives** — add to `src/memory/resources/index.ts:19-20` (existing pattern):
```typescript
export const RESOURCE_URI_LIST_BRIEFS = "vault-memory://briefs";
```

---

### `src/memory/contract/default-brief-v1.ts` (Zod schema contract)

**Analog:** `src/memory/contract/default-v1.ts` (entire 83-line file — direct mirror).

**Skeleton (copy from `default-v1.ts:1-83`):**
- Same header comment (swap `default-memory-v1` for `default-brief-v1`; explain why this contract exists per Pitfall 1).
- Same `requiredKeys` tuple shape (extend with brief-specific keys).
- Same `.passthrough()` + `.superRefine()` cross-field invariant pattern.

**Required-keys extension** (additions over `default-v1.ts:25-33`):
```typescript
const requiredKeys = [
  "source", "confidence", "evidence", "status", "observed_at",
  "superseded_by", "type",
  // Brief-specific:
  "target", "purpose", "compiled_from", "compiled_at", "source_hashes",
] as const;
```

**Status enum widening** (the key Phase 5 change vs. `default-v1.ts:40`):
```typescript
status: z.enum(["active", "stale", "superseded", "archived"]).default("active"),
```

**Brief-specific properties** (add to `baseShape`):
```typescript
target: z.string().min(1),
purpose: z.string().min(1).max(500),                              // soft cap per RESEARCH discretion
compiled_from: z.array(z.string()).min(1),
compiled_at: z.string().datetime({ offset: true }),
source_hashes: z.record(z.string()).optional(),                   // Record<ChunkId, ChunkHash>
changed_sources: z.array(z.string()).optional(),                  // populated by daemon
```

**Cross-field invariant additions** (extend `.superRefine` at `default-v1.ts:52-72`):
```typescript
.superRefine((data, ctx) => {
  // ... existing superseded invariant from default-v1.ts:52-72 ...
  // Phase 5 addition: when status is "stale", source_hashes must be present
  if (data.status === "stale" && !data.source_hashes) {
    ctx.addIssue({ code: "custom", path: ["source_hashes"],
      message: "Required when status is 'stale' (daemon needs hashes to recompute)." });
  }
});
```

**Export** (mirror `default-v1.ts:74-83`):
```typescript
export const DEFAULT_BRIEF_V1: MemoryContract = {
  name: "default-brief-v1",
  version: "1.0",
  propertiesSchema: baseShape,
  requiredKeys,
  naming: {
    strategy: "slug-timestamp",
    pattern: "{target}--{compiled_at:YYYYMMDDTHHmm}.md",   // D-12 timestamped slug
  },
};
```

**Wire into the contract loader** — extend `src/memory/contract/index.ts` to register `DEFAULT_BRIEF_V1` alongside `DEFAULT_MEMORY_V1`.

---

### `src/db/queries/brief_sources.ts` (new query namespace)

**Analog:** `src/db/queries/wikilinks.ts` (entire 117-line file — direct mirror of statement-prepare + insertBatch transaction pattern).

**Imports** (copy from `wikilinks.ts:1`):
```typescript
import type BetterSqlite3 from "better-sqlite3";
```

**Input interface pattern** (mirror `WikilinkInput` at `wikilinks.ts:3-9`):
```typescript
export interface BriefSourceInput {
  briefDocId: string;
  chunkIdFragment: string;
  chunkDocId: string;
  recordedHash: string;
}
```

**Class shape** (copy structure from `wikilinks.ts:29-72`):
```typescript
export class BriefSourcesQueries {
  private readonly _insert: BetterSqlite3.Statement;
  private readonly _deleteByBrief: BetterSqlite3.Statement<[string]>;
  private readonly _listBriefDocIds: BetterSqlite3.Statement<[], { brief_doc_id: string }>;
  private readonly _briefsForChunkDoc: BetterSqlite3.Statement<[string], { brief_doc_id: string; chunk_id_fragment: string; recorded_hash: string }>;
  private readonly _sourcesForBrief: BetterSqlite3.Statement<[string], { chunk_id_fragment: string; chunk_doc_id: string; recorded_hash: string }>;

  constructor(private readonly db: BetterSqlite3.Database) {
    this._insert = db.prepare(`
      INSERT OR IGNORE INTO brief_sources
        (brief_doc_id, chunk_id_fragment, chunk_doc_id, recorded_hash)
      VALUES (@brief_doc_id, @chunk_id_fragment, @chunk_doc_id, @recorded_hash)
    `);
    // ... mirror wikilinks.ts:50-71
  }
  // ... insertBatch / deleteByBrief / listBriefDocIds / etc. mirroring wikilinks.ts:74-116
}
```

**`INSERT OR IGNORE` discipline** (RESEARCH-emphasized at `wikilinks.ts:51-55`) — UNIQUE constraint on `(brief_doc_id, chunk_id_fragment)` from migration 013 + `INSERT OR IGNORE` makes idempotent on re-write (BRF-08 rename grace-window re-runs).

**Batch transaction pattern** (copy verbatim from `wikilinks.ts:74-87`):
```typescript
insertBatch(briefDocId: string, sources: BriefSourceInput[]): void {
  const tx = this.db.transaction((xs: BriefSourceInput[]) => {
    for (const x of xs) this._insert.run({ ...x });
  });
  tx(sources);
}
```

---

### `src/db/queries/daemon_state.ts` (new query namespace, single-row-per-vault)

**Analog:** `src/db/queries/models.ts` `getActive()` / `setActive()` single-row idiom (single-active-row pattern; closest cousin to single-row-per-vault). No exact 1:1 analog — the namespace is small.

**Imports** (same as other query files):
```typescript
import type BetterSqlite3 from "better-sqlite3";
```

**Class skeleton:**
```typescript
export class DaemonStateQueries {
  private readonly _getCursor: BetterSqlite3.Statement<[string], { last_seen_doc_mtime: number }>;
  private readonly _setCursor: BetterSqlite3.Statement;

  constructor(private readonly db: BetterSqlite3.Database) {
    this._getCursor = db.prepare<[string], { last_seen_doc_mtime: number }>(
      "SELECT last_seen_doc_mtime FROM daemon_state WHERE vault_name = ?",
    );
    // Upsert via INSERT ... ON CONFLICT (standard SQLite idiom)
    this._setCursor = db.prepare(`
      INSERT INTO daemon_state (vault_name, last_seen_doc_mtime)
      VALUES (@vault_name, @mtime)
      ON CONFLICT(vault_name) DO UPDATE SET last_seen_doc_mtime = excluded.last_seen_doc_mtime
    `);
  }

  getCursor(vaultName: string): number | null {
    return this._getCursor.get(vaultName)?.last_seen_doc_mtime ?? null;
  }

  setCursor(vaultName: string, mtime: number): void {
    this._setCursor.run({ vault_name: vaultName, mtime });
  }
}
```

---

### Migration 013 in `src/db/schema.ts`

**Primary analog:** `runMigration008` at `src/db/schema.ts:443-464` (chunked backfill with zero-row short-circuit).
**Secondary analog:** `runMigration011` at `:641-726` (multi-table DDL + chunked backfill in one function).

**The complete RESEARCH-verified sketch is at RESEARCH §Pattern: Migration 013 Backfill (lines 591-680).** That sketch is already correct and idempotent. Copy verbatim with these specific re-checks:

**Steps mirroring `runMigration008` and `runMigration011`:**
- Step A: PRAGMA table_info introspection + `ALTER TABLE ADD COLUMN ... DEFAULT ''` (matches `runMigration009:489-497` idempotency).
- Step B: `CREATE TABLE IF NOT EXISTS brief_sources (...)` + `CREATE TABLE IF NOT EXISTS daemon_state (...)` + indexes.
- Step C: Zero-row short-circuit (matches `runMigration008:447-450`):
  ```typescript
  const pending = db.prepare<[], { c: number }>(
    "SELECT COUNT(*) AS c FROM chunks WHERE chunk_id_fragment = ''"
  ).get();
  if (!pending || pending.c === 0) return;
  ```
- Step D: Chunked backfill at `CHUNK = 10_000` (matches `runMigration011:701` exactly):
  ```typescript
  const CHUNK = 10_000;
  // SELECT pagination via id > ? + ORDER BY id ASC + LIMIT CHUNK
  // For each batch: compute fragment via computeChunkIdFragment(row.text), UPDATE id = row.id
  ```

**Register in MIGRATIONS array** at `src/db/schema.ts:837-901` (append a new entry with `version: 13`):
```typescript
{
  version: 13,
  description: "chunks.chunk_id_fragment + brief_sources + daemon_state (Phase 5 / BRF-* / D-04..D-06)",
  run: runMigration013,
},
```

**Adapter-seam discipline reminder** (per `runMigration011` comment at `:639`): "No `fs`, `path.join`, or `gray-matter` imports anywhere in this function" — same applies to `runMigration013`.

---

### Eval YAML files (`evals/fixtures/v2-test-vault/_queries/`)

**Analog:** `evals/fixtures/v2-test-vault/_queries/brief.yaml` (existing 54-line file — current brief eval); `cluster.yaml` for the determinism-pin / snapshot shape.

**Pattern from `brief.yaml`:**
```yaml
queries:
- id: <slug>
  query: "<natural-language>"
  expected_doc_ids:
  - <vault-relative-path>
  expected_must_contain:
  - "<substring>"
  rationale: >
    Multi-line description.
```

**`briefs-curated.yaml` (BRF-10 primary, D-02)** — extend `brief.yaml` by adding `source_doc_ids: DocId[]` per query (hand-curated). The test runner reads this YAML and calls `compile_brief({target, source_doc_ids, purpose, max_tokens})` directly per query. Atlas Robotics fixture has 20 docs in `_memory/` — use those.

**`briefs-from-cluster.yaml` (D-02 integration)** — same shape but each query first calls `cluster({seed_doc_ids: [...]})` to produce sources, then passes the cluster's `member_doc_ids` to `compile_brief`. Snapshot the expected cluster shape per `cluster.yaml:32-40` discipline.

**`briefs-staleness-stub.yaml` (BRF-11 cross-adapter)** — parametric over `obsidian-fs` AND `StubChangeFeed`. Shape: declare a sequence of `events: [{type: "compile", ...}, {type: "modify_source", ...}, {type: "expect_stale", ...}]` plus `expected_changed_sources: [...]`. The runner replays events through both adapter implementations and asserts identical outcomes (RESEARCH §Validation Architecture).

---

### `src/ollama/client.ts` (add `chat()` method)

**Analog:** EXISTING `embed()` method at `src/ollama/client.ts:81-138` — same retry / timeout / Zod-validation / batching pattern.

**RESEARCH-verified code sketch at lines 962-1031** — copy verbatim. The pattern is:
1. Zod schema for response (mirror `EmbedResponseSchema` at `:21-24`).
2. Interface for `ChatRequest` / `ChatResponse` / `ChatMessage`.
3. Inside the class: `chat(request)` method using `withRetry` + `fetchWithTimeout` (existing private helpers).
4. Throw `OllamaHttpError` on non-2xx (existing error class at `:37`).
5. Use existing `isRetryable` predicate at `:46`.

**No new imports needed** — `withRetry` (`./retry.js`) is already imported.

---

### `src/chunker/` (compute `chunk_id_fragment`)

**Analog:** `src/sections/anchor.ts:37-41` (the canonical NFC + sha256 idiom that the existing codebase uses).

**Where to add:** Inside `src/chunker/chunker.ts` (mainline `chunkNote` function) or as a sibling `src/chunker/chunk-id.ts` re-exported from `src/chunker/index.ts`. **RESEARCH-recommended location** (Anti-Patterns): centralize in `src/chunker/chunk-id.ts` and re-export from the chunker barrel.

**Hook site:** Wherever `chunkNote` is called (`src/indexer/indexer.ts`, `src/indexer/single.ts`, `src/indexer/catchup.ts`), the produced `Chunk[]` is then handed to `vault.db.chunks.insertBatch`. The fragment must be computed BETWEEN those two steps so the `ChunkInput` passed to `insertBatch` carries `chunkIdFragment`. This requires:
1. Adding `chunkIdFragment: string` to `ChunkInput` (`src/db/queries/chunks.ts:4-11`).
2. Adding `chunk_id_fragment` to the INSERT SQL at `chunks.ts:20-23`.
3. Computing fragment from `c.text` in each call site OR (cleaner) in the chunker's internal loop.

---

### `src/server.ts` (daemon bootstrap)

**Analog:** EXISTING `src/server.ts:200-330` (watcher / change-feed registration) and `:1063-1068` (post-handshake fire-and-forget catchup).

**Code sketch from RESEARCH §Code Examples lines 1042-1073** — copy verbatim. The pattern:
1. Build `briefDaemons: Map<string, BriefStalenessDaemon>` AFTER `startCatchupAndWatchers` (so watcher subscribes first per RESEARCH §Pattern: ChangeFeed Multi-Handler Fan-Out).
2. For each vault: `daemon.start(vault, feed)` where `feed = changeFeeds.get(vault.config.name)` (same map populated at `:229`).
3. Extend the existing `shutdown` closure (at `:332`) to dispose all daemons before disposing watchers + feeds.

---

### `src/tool-registry.ts` (add 2 tools)

**Analog:** EXISTING `TOOLS` array at `:41` and `TOOL_SCHEMAS` at `:961`. Every existing entry is the pattern to copy.

**Pattern for each new tool entry** (mirror `read_note` at `:48-61`):
```typescript
{
  name: "compile_brief",
  description: "Compile a brief from caller-supplied sources. ...",
  inputSchema: {
    type: "object",
    required: ["target", "source_doc_ids", "purpose"],
    properties: {
      target: { type: "string", description: "Stable cross-version handle for the brief." },
      source_doc_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50 },
      purpose: { type: "string", maxLength: 500 },
      max_tokens: { type: "integer", minimum: 1, default: 2000 },
      prepared_text: { type: "string", description: "D-10 tier 3 fallback when no LLM available." },
    },
  },
},
```

**`TOOL_SCHEMAS` entry** (mirror existing per-tool Zod shapes at `:961+`) — the runtime Zod schema used in the SDK's `registerTool`. For full-shape examples see `cluster` / `suggest_frontmatter` which have refinement layers.

---

### `src/adapters/source/conformance.test.ts` (extend with brief assertions)

**Analog:** EXISTING file's `describe.each` parametric setup at top (lines 14-58).

**Pattern:** Add a new `describe("compile_brief + staleness", () => { ... })` block inside the existing `describe.each([ObsidianFsSource, StubSource])` wrapper. Assertions per BRF-11:
1. Write a brief via `delivery.write({...})`.
2. Modify a source doc.
3. Replay the ChangeEvent through the daemon's handler.
4. Assert brief's `status` flipped to `"stale"`.
5. Assert `changed_sources` array contains the modified DocId.

The block reuses existing fixture imports (`ATLAS_0_DOC_ID`, `MEMORY_INNER_DOC_ID`, etc. from `src/adapters/stub/assembly-fixture.js`).

---

### `evals/v1-baseline/tools-list.snapshot.json` (additive regen)

**Analog:** EXISTING 32-entry snapshot. Pattern is `npm test -- evals/v1-baseline/baseline.test.ts` regenerates if `--update-snapshots` is passed.

**Phase 5 diff:** Add `compile_brief` and `get_brief` entries; `list_briefs` is a Resource and stays out of this snapshot file. Per RESEARCH §Tool Budget Headroom, this lifts tool count from 32 → 34 — call out in plan 05-01 ADR with Phase 8 cleanup commitment.

---

### `src/memory/registry.ts` (sink ordering for `_memory/_briefs/`)

**Analog:** EXISTING `findSinkContaining` at `:190-202` (`startsWith` over insertion order).

**Pattern reminder** (RESEARCH §Pitfall 1 step 2): the registry's `findSinkContaining` returns the FIRST matching sink in insertion order. Therefore the more specific sink (`_memory/_briefs/`) MUST be registered before the broader parent (`_memory/`). This is a **config ordering concern**, not a code change to `registry.ts` itself — `setupMemorySinks` (called at server bootstrap) must order the `[[memory_sinks]]` array correctly. See "Wiring Checklist".

---

### `src/types.ts` (add new types)

**Analog:** EXISTING brand declarations at `:347` (`DocId`) and `:367` (`MemorySinkHandle`).

**New exports** (additive — no breaking changes to existing union types):
```typescript
export type ChunkId = string & { readonly __brand: "ChunkId" };
export type BriefStatus = "active" | "stale" | "superseded" | "archived";
export type BriefSourceHash = string;   // "sha256:<hex>"

export interface Brief {
  // Identity
  doc_id: DocId;
  target: string;
  // Provenance (D-11 / contract default-brief-v1)
  purpose: string;
  compiled_from: DocId[];
  compiled_at: string;
  source_hashes: Record<ChunkId, BriefSourceHash>;
  // Lifecycle
  status: BriefStatus;
  superseded_by: DocId | null;
  // Optional staleness annotation (daemon-set)
  changed_sources?: DocId[];
}
```

**Critically:** the planner may decide to NOT add a dedicated `Brief` interface and instead rely on `Document` with brief-shaped `properties` (per the choice noted in CONTEXT canonical_refs line 165: "or reuses `Document` with brief-shaped properties — planner picks"). Both approaches are valid; this map documents the type names for either choice.

---

## Reusable Helpers

Existing functions / classes / Zod schemas the new code MUST call rather than reimplement:

| Helper | Source | Use in Phase 5 |
|---|---|---|
| `parseDocId(s)` | `src/adapters/registry.ts:94` | Validate every DocId arriving in `compile_brief` args |
| `decomposeDocId(id) → {scheme, authority, resource}` | `src/adapters/registry.ts:132-148` | Verify `source_doc_ids` all in same vault as `target` (Open Q3) |
| `formatDocId(scheme, authority, resource)` | `src/adapters/registry.ts:100-102` | Mint the new brief's DocId from sink + slug |
| `parseSourceHandle(s)` | `src/adapters/registry.ts:154` | If `Brief` carries `source: SourceHandle` |
| `MemorySinkRegistry.findSinkContaining(docId)` | `src/memory/registry.ts:190-202` | Verify brief writes land inside `_memory/_briefs/` sink |
| `MemorySinkRegistry.resolveMemorySink(nameOrHandle)` | `src/memory/registry.ts:142-160` | Resolve `args.sink` (default-brief sink) |
| Phase 2 `handleSupersede(deps, args)` | `src/memory/tools/supersede.ts:53-121` | D-12 calls this directly with `{doc_id: oldBriefId, replacement_doc_id: newBriefId, reason: "recompiled"}` |
| `SourceConnector.readDocument(id)` | `src/adapters/source/types.ts:137` | Read OLD brief for supersede chain + read source chunks for staleness check |
| `SourceConnector.listDocuments(opts)` | `src/adapters/source/types.ts:130` | `list_briefs` Resource enumerates `_memory/_briefs/*.md` |
| `DeliveryAdapter.write(doc, opts)` | `src/adapters/delivery/types.ts` (chokepoint) | All brief writes route through here — Phase 2 invariant |
| `DeliveryAdapter.update(id, patch, {expectedHash, sink})` | `src/adapters/delivery/types.ts` | Daemon's "mark stale" + D-12 supersede |
| `ChangeFeed.subscribe(handler) → Disposable` | `src/adapters/change-feed/types.ts:98` | Daemon registers handler; stores `Disposable` for shutdown |
| `OllamaClient` instance | `src/ollama/client.ts:62` | D-10 tier 2 — call new `chat()` method (Phase 5 extension) |
| `withRetry(...)` | `src/ollama/retry.js` (existing) | Reused for `chat()` retry policy |
| `OllamaHttpError` | `src/ollama/client.ts:37` | Reused; no new error class |
| `createHash("sha256")` + `.normalize("NFC")` | Node stdlib (used in `src/sections/anchor.ts:39`) | `chunk_id_fragment` + brief hash computation |
| `McpServer.server.getClientCapabilities()` | `@modelcontextprotocol/sdk` (verified `types.d.ts:572`) | D-10 tier 1 detection |
| `server.createMessage(params)` | `@modelcontextprotocol/sdk` (`server/index.d.ts:140`) | D-10 tier 1 dispatch |
| `server.registerTool(name, {description, inputSchema}, handler)` | SDK; pattern at `src/server.ts:989-1012` | Register `compile_brief`, `get_brief` |
| `server.registerResource(name, uri, metadata, handler)` | SDK; pattern at `src/server.ts:1022-1041` | Register `list_briefs` |
| `vault.db.audit.recordWrite({kind: "..."})` | `src/db/queries/audit.ts:19-35` | Daemon writes structured WARN on brief-staleness errors |
| `chunkNote(content, options) → Chunk[]` | `src/chunker/chunker.ts` | Existing chunker; extension Phase 5 adds is computing the fragment alongside |
| `process.kill(pid, 0)` | Node stdlib | D-08 PID liveness probe (RESEARCH-verified on darwin) |
| `fs.open(path, "wx")` | `node:fs/promises` | D-08 atomic exclusive create |
| `getContract(name)` | `src/memory/contract/index.ts` | Resolve the contract registered for a sink (slice 1 extends to register `default-brief-v1`) |
| `Phase 4 indexer wikilink extraction` | `src/indexer/resolver.ts` / `src/indexer/extract-edges.ts` | **No new code in Phase 5** — Phase 4 D-02 picks up `[[wikilinks]]` from brief body automatically on `add` events; brief layer relies on this for back-edges |

---

## Anti-Patterns to Avoid in Phase 5

Specific things the codebase will fight us on (verified via RESEARCH and codebase scout):

1. **Direct `fs` / `path.join` / `gray-matter` / `chokidar` inside `src/brief/`** — CI grep `scripts/lint-adapters.sh` (ESCAPE_MARK pattern at `:33`) enforces zero hits. **Single carve-out:** `src/brief/lock.ts` is process state at `~/.vault-memory/locks/`, NOT vault content — add `// vault-memory:claude-ok` escape comment per the script's existing convention. ADR-005 must document the carve-out.

2. **Daemon writing brief frontmatter directly to disk** — must route through `DeliveryAdapter.update(briefId, {properties: {status: "stale", changed_sources}}, {expectedHash, sink})` to satisfy MEM-05 validator + audit_log + suppression-set integration. Mirror `supersede.ts:117` exact signature.

3. **Holding a single SQLite transaction across migration 013 backfill** — chunk at 10k rows per `runMigration008` and `runMigration011` patterns. A 100k-chunk vault completes the backfill in ~1 second per RESEARCH; chunking keeps the transaction small if a much larger vault appears.

4. **Skipping `INSERT OR IGNORE` on `brief_sources`** — UNIQUE constraint on `(brief_doc_id, chunk_id_fragment)` + `INSERT OR IGNORE` makes idempotent on rename grace-window re-writes. Copy the `wikilinks.ts:51-55` discipline verbatim.

5. **Writing brief audit_log entries through any path other than `vault.db.audit.*`** — daemon's structured WARN for brief-staleness errors goes through `vault.db.audit.recordWrite(...)`, NOT raw stderr (stderr is fine for the lock-contention WARN per D-08 but persistent failures need the audit log per Claude's discretion in CONTEXT).

6. **`compile_brief` baking in `cluster()` or `expand()` calls** — D-01 explicit. `src/brief/compile.ts` MUST NOT import from `src/graph/`. Plan checker assertion required in slice 2.

7. **Storing `chunks.id` (AUTOINCREMENT integer) inside `brief_sources`** — RESEARCH §Pitfall 5 / Rename Survival shows this breaks on chokidar unlink+add. Use `chunk_id_fragment` (content-stable per D-04) + `chunk_doc_id` (the source `doc_uri`).

8. **Computing `chunk_id_fragment` outside `src/chunker/`** — centralize in `src/chunker/chunk-id.ts` and re-export from the chunker barrel. Anti-pattern: scattered `createHash` calls per call site.

9. **Using the v1 `default-memory-v1` contract for briefs** — RESEARCH §Pitfall 1: closed-enum on `status` rejects `status: stale`. Must register `_memory/_briefs/` as a separate sink with the new `default-brief-v1` contract.

10. **Registering `_memory/` BEFORE `_memory/_briefs/` in MemorySinkRegistry** — `findSinkContaining` returns the first match by insertion order via `startsWith`. The more specific path MUST be registered first. The fix lives at the config-loading level, not in `registry.ts`.

11. **Treating CONTEXT.md "migration 012" literally** — Phase 4 CR-01 already shipped migration 012 (`runMigration012` at `src/db/schema.ts:768`). Phase 5 uses **migration 013**. (RESEARCH A1.)

12. **Re-bumping `default-memory-v1.status` enum to include "stale"** — RESEARCH A2 considered this as an alternative. Rejected: requires a Phase 2 ADR amendment, broader blast radius than a new contract. New contract (`default-brief-v1`) is the chosen path.

13. **Writing `source_hashes` as a deeply nested YAML object without round-trip test** — RESEARCH §Pitfall 4. Keys contain `#` and `:`. Slice-2 MUST ship a round-trip test (`compile.test.ts`); fallback to stringified-JSON value if it fails.

14. **Trusting `chunks.text` to be whitespace-stable for the fragment hash** — RESEARCH §Pitfall 8. Use the explicit normalization recipe: `text.replace(/\r\n/g, "\n").trimEnd().normalize("NFC")`. Slice 1 ADR documents this; slice 1 includes a test that `"# Hello\n\n"` and `"# Hello"` produce the same fragment.

15. **Daemon writes triggering phantom staleness re-checks via its own ChangeFeed event** — RESEARCH §Pitfall 3 verifies the suppression set at `change-feed.ts:198-201` already prevents this; slice 3 ships an integration test that confirms (no logic change needed but the test must exist).

16. **Skipping the daemon-startup full scan in favor of cursor-only replay** — D-09 hybrid is explicit: scan is the correctness floor. Cursor is diagnostics + future Phase 10 hook only. Don't optimize away the scan in v2.0.0.

---

## Naming Conventions

Pulled from `.planning/codebase/CONVENTIONS.md` and verified against Phase 0-4 code:

| Element | Convention | Phase 5 Examples |
|---|---|---|
| Source files | `kebab-case.ts` | `compile.ts`, `get.ts`, `daemon.ts`, `body-validator.ts`, `chunk-id.ts`, `llm-ladder.ts`, `source-hashes.ts`, `brief_sources.ts` (DB-table mirror), `daemon_state.ts` |
| Test files | `*.test.ts` co-located with source | `compile.test.ts`, etc. |
| Barrels | `index.ts` in every directory | `src/brief/index.ts` |
| Functions | `camelCase` verbs | `compileBrief`, `handleGetBrief`, `tryAcquireLock`, `releaseLock`, `computeChunkIdFragment`, `validateAndPatchBody`, `resolveLlmStrategy`, `evaluateChangedDocId` |
| Async functions | `camelCase` (no async prefix) | `handleCompileBrief`, `acquireLock`, `evaluateBrief` |
| Classes | `PascalCase` | `BriefStalenessDaemon`, `BriefSourcesQueries`, `DaemonStateQueries`, `OllamaClient` (existing) |
| Query namespace classes | `*Queries` suffix | `BriefSourcesQueries`, `DaemonStateQueries` |
| Types / interfaces | `PascalCase` | `Brief`, `BriefStatus`, `BriefSourceHash`, `ChunkId`, `LlmStrategy`, `LockResult`, `CompileBriefArgs`, `GetBriefArgs`, `BriefStalenessDaemon` |
| MCP Zod input schemas | `*Args` suffix in `tool-registry.ts` | `CompileBriefArgs`, `GetBriefArgs` (mirror existing `SearchArgs`, `WriteNoteArgs`) |
| DB row types | `*Row` suffix | `BriefSourceRow`, `DaemonStateRow` (if exposed; otherwise inline) |
| Input structs | `*Input` suffix | `BriefSourceInput`, `ChatRequest` (existing convention) |
| Branded types | `string & { readonly __brand: "X" }` | `ChunkId` |
| Constants | `camelCase` (NOT SCREAMING_SNAKE_CASE) | Local consts inside functions; module-level constants follow `camelCase` too per CONVENTIONS.md §"Local constants follow the same rule" |
| Resource URI constants | `UPPER_SNAKE_CASE` | `RESOURCE_URI_LIST_BRIEFS` (matches existing `RESOURCE_URI_LIST_SINKS` at `src/memory/resources/index.ts:19`) |
| Migration runners | `runMigration<NNN>` | `runMigration013` |
| ADR slugs | `<NNN>-<kebab-slug>.md` | `005-brief-compile-strategy.md` |

**Imports:** Node built-ins first (`import { open } from "node:fs/promises"`) → third-party (`import { z } from "zod"`) → local relative (`import { ... } from "./x.js"`) → type-only imports last (`import type { ... } from "./y.js"`). All local imports use `.js` extensions per ESM resolution.

**Prettier:** Double quotes, trailing commas, 100-char width, 2-space indent, always-parenthesized arrow functions.

---

## Wiring Checklist

Every place a new Phase 5 module gets imported / registered. Planner cross-references each plan against this list to ensure no module is orphaned.

### 1. `src/db/database.ts` — query namespace wiring
**Location:** lines 1-80.
**Add:**
- `import { BriefSourcesQueries } from "./queries/brief_sources.js";` (mirror `:9` `EdgesQueries` import).
- `import { DaemonStateQueries } from "./queries/daemon_state.js";`
- `readonly briefSources: BriefSourcesQueries;` (mirror `:32` `edges` field).
- `readonly daemonState: DaemonStateQueries;`
- In the constructor (after `:79` `this.sections = new SectionsQueries(...)`):
  ```typescript
  this.briefSources = new BriefSourcesQueries(this.handle);
  this.daemonState = new DaemonStateQueries(this.handle);
  ```

### 2. `src/db/schema.ts` — migration registration
**Location:** lines 837-901 (`MIGRATIONS` array).
**Add:** new `{ version: 13, description: "...", run: runMigration013 }` entry at the end. Function `runMigration013` defined above the array per `runMigration012`'s placement at `:768`.

### 3. `src/server.ts` — daemon bootstrap + Resource registration + extended shutdown
**Locations:**
- After `:329` (post `startCatchupAndWatchers` watcher start, inside the same loop or a parallel loop): instantiate `BriefStalenessDaemon` per vault and call `daemon.start(vault, feed)`. Map them in `briefDaemons: Map<string, BriefStalenessDaemon>`.
- At `:332` (existing `shutdown` closure): add `for (const d of briefDaemons.values()) await d.shutdown();` BEFORE the existing watcher/feed disposals.
- After `:1061` (post `memory-stats` resource registration): add `server.registerResource("briefs", RESOURCE_URI_LIST_BRIEFS, {...}, async (uri) => ({contents: [...]}))`.
- The 2 new tools register automatically via the existing `:972-1012` loop once they're added to `TOOLS` + `TOOL_SCHEMAS` + `handlers` table.

### 4. `src/tool-registry.ts` — tool registration
**Location:** lines 41-916 (`TOOLS` array) and `:961+` (`TOOL_SCHEMAS` map).
**Add:** two new entries (`compile_brief`, `get_brief`) per the patterns in §"Pattern Assignments" above.

**Handler dispatch table** in `src/server.ts` (the `handlers` map consumed at `:980`) — add `compile_brief: handleCompileBrief(...)` and `get_brief: handleGetBrief(...)` entries.

### 5. `src/memory/registry.ts` (NO CODE CHANGE) — sink registration order
**Concern, not code change:** the config-loading step that calls `MemorySinkRegistry.registerMemorySinks(configs, opts)` MUST pass `configs` ordered with `_memory/_briefs/` BEFORE `_memory/`. The bootstrap site is `setupMemorySinks` in `src/server.ts` (called at `:164`). Verify the config-loader (`src/config/loader.ts`) preserves the order from `~/.vault-memory/config.toml`'s `[[memory_sinks]]` array.

**If a separate `[memory.sinks.briefs]` TOML key is added instead** (planner discretion call per CONTEXT line 174): the loader merges it as the first entry in the configs array passed to `registerMemorySinks`.

### 6. `src/memory/contract/index.ts` — contract registration
**Action:** Register `DEFAULT_BRIEF_V1` alongside `DEFAULT_MEMORY_V1` so `getContract("default-brief-v1")` resolves it. Same export/import pattern.

### 7. `src/memory/resources/index.ts` — Resource URI constant
**Add** at line 21 (after existing constants):
```typescript
export const RESOURCE_URI_LIST_BRIEFS = "vault-memory://briefs";
```

### 8. `src/types.ts` — type exports
**Add** at appropriate location (next to `DocId` at `:347` and `MemorySinkHandle` at `:367`):
- `ChunkId` brand
- `BriefStatus` union
- `BriefSourceHash` alias
- `Brief` interface (or document that `Document` with brief-shaped `properties` is the canonical form)

### 9. `evals/v1-baseline/tools-list.snapshot.json` — additive regen
**Single regen at Phase 5 PR end:** `npm test -- --update-snapshots` after adding `compile_brief` and `get_brief` to `TOOLS`. Diff is +2 entries. `list_briefs` is a Resource and stays out of the tools snapshot.

### 10. `src/chunker/index.ts` — barrel re-export
**Add** `chunk_id_fragment` computation helper (`src/chunker/chunk-id.ts` if introduced separately):
```typescript
export { computeChunkIdFragment } from "./chunk-id.js";
```

### 11. `src/brief/index.ts` (NEW barrel)
**Create** with re-exports of the public surface:
```typescript
export { handleCompileBrief } from "./compile.js";
export { handleGetBrief } from "./get.js";
export { BriefStalenessDaemon } from "./daemon.js";
export { readListBriefs } from "./resources.js";
export type { ChunkId } from "./chunk-id.js";
```

### 12. `docs/v2/adr/005-brief-compile-strategy.md` (NEW)
**Authored in slice 1 (plan 05-01).** This is the BRF-02 gate: ADR exists in git history BEFORE any `src/brief/*.ts` commit.

### 13. `evals/fixtures/v2-test-vault/_queries/` — 3 new YAMLs
- `briefs-curated.yaml` (D-02 primary, BRF-10) — slice 2 / 3.
- `briefs-from-cluster.yaml` (D-02 integration) — slice 4.
- `briefs-staleness-stub.yaml` (BRF-11 cross-adapter) — slice 4.

### 14. `src/adapters/source/conformance.test.ts` — parametric extension
**Extend** the existing `describe.each` block with brief + staleness assertions for both `obsidian-fs` and `StubSource`. New tests live inside the same parametric wrapper.

### 15. Config loader extension (`src/config/loader.ts`)
**Add** optional per-vault `brief?: { ollama?: { model: string } }` to the Zod `VaultConfig` schema for D-10 tier 2 dispatch.

---

## Metadata

**Analog search scope:** `src/memory/`, `src/adapters/`, `src/db/`, `src/ollama/`, `src/sections/`, `src/watcher/`, `src/server.ts`, `src/tool-registry.ts`, `src/types.ts`, `evals/fixtures/v2-test-vault/_queries/`, `docs/v2/adr/`.
**Files scanned:** ~30 (representative subset of ~150 source files).
**Pattern extraction date:** 2026-05-18.
**Key research output consulted:** `.planning/phases/05-compiled-brief-layer/05-RESEARCH.md` (1261 lines; HIGH-confidence load-bearing claims verified against codebase or SDK type definitions).
**Critical corrections from CONTEXT.md applied:** migration version 012 → **013** (Phase 4 CR-01 already shipped 012; verified at `src/db/schema.ts:899`); new `default-brief-v1` contract (avoids Pitfall 1 closed-enum conflict).
