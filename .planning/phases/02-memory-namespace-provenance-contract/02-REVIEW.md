---
phase: 02-memory-namespace-provenance-contract
reviewed: 2026-05-16T00:00:00Z
depth: standard
files_reviewed: 31
files_reviewed_list:
  - src/adapters/delivery/obsidian-fs/contract-yaml-read.ts
  - src/adapters/delivery/obsidian-fs/index.ts
  - src/adapters/delivery/obsidian-fs/path.ts
  - src/adapters/delivery/obsidian-fs/sentinel.ts
  - src/adapters/delivery/obsidian-fs/write.ts
  - src/adapters/registry.ts
  - src/adapters/stub/delivery.ts
  - src/audit/audit.ts
  - src/db/queries/audit.ts
  - src/db/queries/notes.ts
  - src/db/schema.ts
  - src/db/types.ts
  - src/memory/citation-packet.ts
  - src/memory/contract/default-v1.ts
  - src/memory/contract/index.ts
  - src/memory/contract/loader.ts
  - src/memory/contract/schema.ts
  - src/memory/contract/types.ts
  - src/memory/index.ts
  - src/memory/registry.ts
  - src/memory/resources/index.ts
  - src/memory/resources/list-sinks.ts
  - src/memory/resources/memory-stats.ts
  - src/memory/sink.ts
  - src/memory/tools/index.ts
  - src/memory/tools/recall.ts
  - src/memory/tools/record-observation.ts
  - src/memory/tools/supersede.ts
  - src/memory/validator.ts
  - src/server.ts
  - src/tool-registry.ts
findings:
  critical: 3
  warning: 8
  info: 5
  total: 16
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-16
**Depth:** standard
**Files Reviewed:** 31
**Status:** issues_found

## Summary

The Phase 2 memory namespace and provenance contract is architecturally well-organized: the validator chokepoint at `DeliveryAdapter.write/update/delete` is correctly wired with defense-in-depth Guards at the v1 entry points, the contract loader pipes YAML → Zod via a clean two-phase build, and the audit schema correctly adds the `is_memory_sink_write` discriminator with a partial index. The seam-preservation discipline (confining `node:fs` / `node:path` / `gray-matter` to the obsidian-fs adapter directory) is intact.

That said, three correctness-or-safety defects can let writes bypass — or be mis-classified by — the safety invariant:

- The `MemorySinkHandle` regex permits `..` segments in the `resolveToRelativePath`, allowing a misconfigured `[[memory_sinks]]` handle (or an attacker who controls config.toml) to point a "sink" at a folder outside the vault root and have writes resolved via `path.join`. The provisioner will happily create `.memory-sink` outside the vault.
- The `provisionSink` heuristic treats ANY `.md` file as "expected sink content," meaning a `[[memory_sinks]]` handle pointed at an existing user folder full of notes will silently absorb those notes into the sink — making them subject to `sink_write_blocked` for v1 write tools (user can no longer edit their own notes via the v1 API). The inverse safety direction breaks.
- `pathInSink` and `joinVaultPath` use `node:path.join`, which on Windows emits backslash-separated paths. Downstream comparisons (`findSinkContaining`, `lastMemoryWriteAtForPathPrefix`, `countByPathPrefix`, `recall`'s `notePath.startsWith`) all use the forward-slash form. On Windows the sentinel/provisioning paths would be `\` while the sink-prefix matching uses `/`, so `findSinkContaining` would return `null` for paths inside a sink — defeating Guard B.

The validator code itself is sound (Guards A/B firing order is correct, "missing vs. invalid" disambiguation handles Zod 4's `invalid_type`/`invalid_value` quirk). The structural finding to flag is that the regex/heuristic substrate the validator sits on top of has gaps.

## Critical Issues

### CR-01: `MEMORY_SINK_HANDLE_PATTERN` permits path-traversal segments in the sink resource

**File:** `src/memory/sink.ts:50-51`
**Issue:** The regex `/^obsidian-fs:\/\/[a-z0-9][a-z0-9-]*\/[^\s]+\/$/` allows any non-whitespace characters in the resource segment, including `..`, `./`, leading `/`, and embedded `\0`. A `[[memory_sinks]]` entry with handle `obsidian-fs://atlas/../../etc/passwd-fake/` parses cleanly; the resulting `sink.resolveToRelativePath` is `../../etc/passwd-fake/`. `pathInSink(vaultAbs, sink)` calls `path.join`, which collapses the `..` segments and escapes the vault root. `provisionSink` will then create a `.memory-sink` file outside the vault, and subsequent `record_observation` writes resolve outside the vault as well. The same gap lets a sink shadow another sink (`_memory/` and `_memory/../_memory/` both resolve to `_memory/` after `path.join` normalization, but `findSinkContaining` matches them by *string prefix* before normalization — opening up handle-routing confusion). This is the substrate the safety invariant sits on; without validating the path here, every Guard downstream operates on adversarially-shaped inputs.
**Fix:** Tighten the regex AND add an explicit segment check in `parseMemorySinkHandle` so the resource may not contain `..`, may not start with `/`, may not contain consecutive `//`, and may not contain control characters or backslashes. Example:

```ts
const SEGMENT = /^[A-Za-z0-9._\-]+$/;
export const MEMORY_SINK_HANDLE_PATTERN =
  /^obsidian-fs:\/\/[a-z0-9][a-z0-9-]*\/[^\s]+\/$/;

const parse = (s: string): MemorySinkHandle => {
  if (!MEMORY_SINK_HANDLE_PATTERN.test(s)) throw /* ... */;
  const resource = s.slice(s.indexOf("/", "obsidian-fs://".length) + 1, -1);
  for (const seg of resource.split("/")) {
    if (seg.length === 0 || seg === "." || seg === ".." || !SEGMENT.test(seg)) {
      throw new Error(
        `Invalid MemorySinkHandle: ${JSON.stringify(s)}. ` +
          `Resource path segments must be plain ASCII alnum + '.', '_', '-' (no '..', no '/').`,
      );
    }
  }
  return mint(s);
};
```

The same defensive split-and-validate belongs in `decomposeDocId` for the resource path (or, more cleanly, in `formatDocId` so callers minting a DocId from `(vault, relativePath)` get the rejection at the seam).

---

### CR-02: `provisionSink` silently absorbs existing user `.md` files into a new memory sink

**File:** `src/adapters/delivery/obsidian-fs/sentinel.ts:65-72, 137-146`
**Issue:** `isExpectedSinkContent(entry)` returns `true` for *any* file whose name ends in `.md`. When a user (or an attacker who can edit `config.toml`) configures `[[memory_sinks]]` with `handle = "obsidian-fs://atlas/Daily Notes/"` and that folder is full of the user's existing journal, `provisionSink` finds only `.md` entries (no foreign types), declares the folder "safe to label," and writes `.memory-sink` into it. From that moment forward every existing note in `Daily Notes/` is "inside a registered sink." The defense-in-depth Guards in `writeNote`/`deleteNote`/`update_frontmatter` will refuse v1 writes against those paths with `sink_write_blocked` — i.e. the user can no longer edit their own notes through the public MCP API. The CLAUDE.md non-negotiable says "agents never write silently into user notes"; the *inverse* direction (the sink swallows user notes) is not covered by the guards but is equally damaging because it stops legitimate writes. Note the comment on line 63 explicitly claims this is intended ("intentionally narrow — anything else trips SinkProvisioningError"), but `.md` is the dominant file type in any Obsidian vault, so the check is effectively a pass-through.
**Fix:** Don't treat plain `.md` files as expected content; require the folder to be empty, contain ONLY the sentinel, or contain ONLY the three known sink subfolders (`observations/`, `_briefs/`, `status-updates/`). If `.md` files are present at the sink root, refuse with `SinkProvisioningError` and require the user to either move them out or pick a different handle.

```ts
function isExpectedSinkContent(entry: string): boolean {
  if (entry === SENTINEL_FILENAME) return true;
  if (entry === "observations" || entry === "_briefs" || entry === "status-updates") {
    return true;
  }
  // Plain .md files at the sink root are NOT expected — they are almost
  // certainly user notes. Forcing a SinkProvisioningError here surfaces
  // the misconfiguration loudly instead of silently absorbing the folder.
  return false;
}
```

---

### CR-03: Path-separator mismatch on Windows breaks sink-membership checks (Guard B becomes ineffective)

**File:** `src/adapters/delivery/obsidian-fs/path.ts:31-33, 56-62`; `src/memory/registry.ts:190-202`; `src/audit/audit.ts` + `src/db/queries/notes.ts`; `src/memory/tools/recall.ts:170-174`
**Issue:** `joinVaultPath` and `pathInSink` use `node:path.join`. On Windows that produces backslash-separated absolute paths (`C:\vault\_memory\.memory-sink`), but `findSinkContaining`, `notePath.startsWith(prefix)` in `handleRecall`, `lastMemoryWriteAtForPathPrefix` (LIKE `_memory/%`), and `countByPathPrefix` (LIKE `_memory/%`) all assume forward-slash paths. The DocId resource is always forward-slash (the regex and the obsidian-fs adapter store paths that way), so the sink's `resolveToRelativePath` (e.g. `_memory/`) compared via `resource.startsWith` is fine on either OS — but the SQL `LIKE '_memory/%'` matches against `notes.path` which is populated by the indexer from `node:path`-relative segments on Windows (likely backslashes). The result: on Windows, `findSinkContaining` correctly identifies sink membership (because both sides use `/` from the DocId), but `lastMemoryWriteAtForPathPrefix` and `countByPathPrefix` return zero/null even when the sink has writes, and `recall`'s post-filter rejects every candidate. More damaging: the sentinel-existence check `pathInSink(vaultAbsolutePath, sink, SENTINEL_FILENAME)` returns a path with mixed separators on Windows (`C:\vault\_memory/.memory-sink` via `path.join` actually normalizes, so OK there). The real exposure is in any future code that takes a sink resource and tries to assemble vault-relative paths via `joinVaultPath` and then compares them against forward-slash DocIds.
**Fix:** Either (a) restrict the codebase to POSIX semantics by using `path.posix.join` everywhere `joinVaultPath` is called (and document the contract that vault-relative paths are always forward-slash), or (b) add an explicit POSIX-normalization step at the boundary between filesystem paths and DocId resources. Recommendation: switch `joinVaultPath` to `path.posix.join` for the vault-relative-path consumers (the SQL prefix lookups, `findSinkContaining`), and keep `path.join` only for the absolute on-disk paths the FS calls actually consume. Add a unit test that runs the sink-membership matrix with backslashed inputs to lock the behavior.

```ts
// path.ts
import path from "node:path";

/** Absolute on-disk join — used by fs calls. OS-native separators OK. */
export function joinVaultPathAbsolute(vaultRoot: string, relPath: string): string {
  return path.join(vaultRoot, relPath);
}

/** Vault-relative join — used for prefix matching against DocId resources.
 *  Always emits forward-slash so it round-trips with the DocId resource form. */
export function joinVaultPathPosix(...segments: string[]): string {
  return path.posix.join(...segments);
}
```

---

## Warnings

### WR-01: `ruleToZod` silently drops `items.type` for arrays

**File:** `src/memory/contract/loader.ts:88-89`
**Issue:** A YAML contract that declares `type: array` with `items: { type: "number" }` is mapped to `z.array(z.string())` unconditionally. The `items` field is read by the YAML schema validator but never consulted. Contract authors get silent type drift: validation passes for string arrays and rejects number arrays even when the contract says otherwise.
**Fix:** Switch on `rule.items?.type` and emit the appropriate `z.array(...)` element schema. Reject unsupported element types at contract-load time so the misconfiguration surfaces loudly.

---

### WR-02: `ruleToZod` `allowed` overrides the declared `type` entirely

**File:** `src/memory/contract/loader.ts:111-116`
**Issue:** A rule `{ type: "number", allowed: ["1", "2"] }` ends up as `z.enum(["1","2"])` — losing the numeric type. The `allowed` field is documented in `schema.ts` as `z.array(z.string()).optional()`, so it is string-only by schema, but the override is unconditional regardless of the declared `type`. A future contract attempting `type: "number"` with an enum of numeric strings cannot work without code change. Either reject the combination at contract-parse time or apply `allowed` as a `.refine()` on top of the base schema.
**Fix:**

```ts
if (rule.allowed && rule.allowed.length > 0) {
  if (rule.type !== "string") {
    throw new Error(
      `Property rule with allowed=[...] must declare type:'string' (got '${rule.type}')`,
    );
  }
  schema = z.enum(rule.allowed as [string, ...string[]]);
}
```

---

### WR-03: Cross-field rule `when`-expressions that don't match the regex are silently skipped

**File:** `src/memory/contract/loader.ts:148-167`
**Issue:** The cross-field-rules walker parses `when` with `/^([A-Za-z_][A-Za-z0-9_]*)\s*==\s*'([^']+)'$/` and does `if (!whenMatch) continue;` — any unsupported form (typos, double-quoted values, `!=` operator, multi-clause expressions) is silently dropped from validation. A contract author who writes `when: status = 'superseded'` (single `=`) gets a rule that does nothing, with no warning at load time. Cross-field rules are how the contract enforces invariants like "superseded requires reason"; silent dropouts undermine the contract guarantee.
**Fix:** Reject unrecognized `when` forms at contract-load time inside `buildPropertiesSchema` (before returning the assembled schema). Throw a `MemoryContractInvalidError` with the offending rule echoed back.

---

### WR-04: `MAX_COLLISION_RETRIES = 3` returns misleading `permission_denied` on exhaustion

**File:** `src/memory/tools/record-observation.ts:38, 206-210`
**Issue:** When `record_observation` cannot mint a unique DocId in 3 tries (same `claim` + same `observed_at` + 3 deterministic hash salts), it returns `{ ok: false, reason: "permission_denied", ... }`. The `permission_denied` code in `WriteConflict` means "vault is read-only" everywhere else in the codebase; using it here is observably wrong — an agent doing automatic retry logic on `permission_denied` will assume the vault is write-disabled and stop trying, when in reality a different reason (collision exhaustion) should prompt different recovery (vary the claim or wait). Also: with deterministic salts `"0"`, `"1"`, `"2"`, retries are not random — three calls in the same millisecond with the same claim ALL produce identical collision chains. There is no real entropy.
**Fix:** Add a dedicated `WriteConflict` reason (`collision_retry_exhausted`) or use the closest existing match (`hash_mismatch` is even worse; consider returning a generic error response instead of a `WriteConflict`). Replace the deterministic salt with `randomBytes(3).toString("hex")` so each retry is genuinely fresh.

---

### WR-05: `update()` silently fabricates `expectedHash` when the caller omits it

**File:** `src/adapters/delivery/obsidian-fs/index.ts:295-299`
**Issue:** When `update()` is called without `opts.expectedHash`, the adapter reads the current on-disk hash and passes it as `effectiveExpectedHash` so the internal `writeNote` accepts the overwrite. This is a deliberate footgun: the caller intended OCC but is given a "best-effort" overwrite that races with concurrent edits between the `readFile` and the `atomicWriteFile`. The `hashProtected: "strong"` capability descriptor (line 97) is then a lie for callers that go through `update()`. The TSDoc acknowledges this ("Callers can override by passing opts.expectedHash") but the default is unsafe.
**Fix:** Return `{ ok: false, reason: "hash_mismatch", message: "update() requires opts.expectedHash for hashProtected='strong' adapters" }` when `opts.expectedHash` is missing (mirroring the `delete()` path on line 360). Force the caller to read first.

---

### WR-06: `assertSentinelExists` collapses every error to "missing"

**File:** `src/adapters/delivery/obsidian-fs/sentinel.ts:154-165`
**Issue:** `assertSentinelExists` returns `false` on any thrown error from `fs.access`, including `EACCES` (sentinel exists but is unreadable), `EIO` (disk error), and `ENAMETOOLONG`. The caller in `ObsidianFsDelivery.preflight` then refuses the write with `sentinel_missing` and the suggestion "restart the server" — which won't help if the underlying cause is a permissions or disk issue. Failing closed is correct, but the diagnostic is misleading.
**Fix:** Catch `ENOENT` specifically; on any other error, re-throw (or surface a distinct `sentinel_check_failed` reason in `WriteConflict` so the caller learns the real cause).

```ts
try {
  await fs.access(sentinelPath);
  return true;
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return false;
  throw err;
}
```

---

### WR-07: `record_observation` `properties` escape-hatch lets the caller weaken provenance

**File:** `src/memory/tools/record-observation.ts:148-160`
**Issue:** Sugar properties (`source: "agent"`, `evidence: args.evidence`, `confidence: args.confidence`, `type: args.type`, `superseded_by: null`) are merged FIRST, then `args.properties` LAST so caller-supplied keys win — the documented D-02 escape hatch. But that means a caller can pass `properties: { evidence: [], confidence: "direct" }` and clobber the validated MCP-level `args.confidence: "uncertain"`. The validator never sees the original sugar values; the audit trail then says "direct" provenance for a claim the caller's input was "uncertain." Worse, `properties.source` can be set to anything — `source: "agent"` is forced by sugar, but the caller can override it to `"user"`, which Guard B then catches as `non_agent_write_inside_sink` (good!) — except the override of `evidence` to `[]` does not trigger any guard since `z.array(z.string())` accepts empty arrays.
**Fix:** Restrict the escape-hatch merge to KEYS NOT IN the sugar set, or move the sugar-merge AFTER the caller-properties merge for security-critical keys (`source`, `confidence`, `evidence`, `type`, `observed_at`, `status`). The MEMORY_CONTRACT comment in the file header says "caller-supplied keys win over sugar defaults" — that contract is unsafe for the provenance fields. Lock them server-side:

```ts
const callerExtras = { ...(args.properties ?? {}) };
delete callerExtras.source;
delete callerExtras.confidence;
delete callerExtras.evidence;
delete callerExtras.type;
delete callerExtras.status;
delete callerExtras.observed_at;
delete callerExtras.superseded_by;
const properties: Record<string, unknown> = { ...callerExtras, ...sugarProps };
```

---

### WR-08: `update_frontmatter` and `delete_note` audit rows always record `is_memory_sink_write = false`

**File:** `src/adapters/delivery/obsidian-fs/index.ts:229, 313, 375` (per-write); `src/db/queries/audit.ts:134` (defaulting)
**Issue:** `isMemorySinkWrite` in the audit row is derived from `opts.sink !== undefined`. For v1 paths (`write_note`, `update_frontmatter`, `delete_note`) the entry-point Guard or facade preflight REFUSES the write before reaching audit, so the flag is academic. But for the *successful* paths in those v1 handlers, `opts.sink` is never set (only `record_observation` and `supersede` set it). Therefore: any write that DOES land inside a memory sink (e.g. via the legacy `writeNote` if `registry` is undefined, or via any future code path that bypasses preflight) records `is_memory_sink_write = false`, and the audit log under-reports memory-sink mutation activity. This is a defense-in-depth weakness in the auditing layer specifically: the flag is set based on *intent* (caller routed through a sink-aware path) rather than on *resolved target* (the docId lands inside a sink). The two signals diverge whenever an audit-relevant bypass happens.
**Fix:** Derive `is_memory_sink_write` from `registry.findSinkContaining(docId) !== null` instead of from `opts.sink !== undefined`. The validator chokepoint already does this resolution; thread the result through to `writeNote`'s `isMemorySinkWrite` field. This way the flag reflects the resolved truth even if a future entry-point bypasses the facade.

---

## Info

### IN-01: `decomposeDocId` re-validates via `parseDocId` on every call (defensive, but doubles regex work)

**File:** `src/adapters/registry.ts:122-138`
**Issue:** `decomposeDocId` calls `parseDocId(docId)` which runs the regex; then the function indexes `docId.indexOf("://")` etc. itself. Since `DocId` is branded, the input is guaranteed to be valid by construction, and the defensive re-validation is a micro-cost. Acceptable for safety but worth noting if `decomposeDocId` ever ends up on a hot path (`findSinkContaining` calls it per registered sink per validator invocation).
**Fix:** Optional — accept the cost for safety. Document that the re-validation is defense against `as DocId` casts smuggled in test code.

---

### IN-02: `__clearContractCache` is re-exported from `src/memory/contract/index.ts` without a test-only marker

**File:** `src/memory/contract/index.ts:72-75`
**Issue:** `__clearContractCache` is documented as "Test-only" but is freely exported and re-exported through `src/memory/index.ts` only via internal use. Production code could call it and wipe contracts at runtime, causing subsequent `getContract("default-memory-v1")` calls to fail (the re-seed of `DEFAULT_MEMORY_V1` happens on module-load only — the function itself re-seeds, but a caller passing a custom contract afterward would also clear those). The double-underscore prefix is convention-only, not an access control.
**Fix:** Add `@internal` JSDoc tag and exclude from the package's public types. Or split a `contract/__testing__.ts` submodule that tests import via deep import path and that is not re-exported from the barrel.

---

### IN-03: `memory-stats` listByPathPrefix default cap (10_000) silently truncates `by_type` / `by_status` aggregates

**File:** `src/db/queries/notes.ts:164-170`; `src/memory/resources/memory-stats.ts:82-89`
**Issue:** `doc_count` uses `countByPathPrefix` which is accurate, but `by_type` / `by_status` aggregate by scanning rows returned from `listByPathPrefix(prefix, /* limit= */ 10_000)`. A user (or an agent in a loop) who fills a sink with >10_000 observations sees `doc_count: 12_345` but `by_type` adds up to only 10_000. The MCP resource is then arithmetically inconsistent, which a discerning client will flag as a bug.
**Fix:** Either iterate with paged queries inside the resource handler until exhausted (acceptable since the resource is polled, not on a tight latency budget), or do the `by_type`/`by_status` aggregation in SQL with `json_extract` and `GROUP BY` so the cap is irrelevant.

---

### IN-04: Slug regex strips combining diacritical marks via a literal Unicode range that some editors render ambiguously

**File:** `src/memory/tools/record-observation.ts:91-92`
**Issue:** `.replace(/[̀-ͯ]/g, "")` uses literal combining-mark characters in the character class. Renders fine in monospace editors but copy/paste through some tooling (terminals, log aggregators) can drop the marks and silently produce `/[]/g` → matches nothing. The intent (strip U+0300..U+036F) is correct; the literal form is fragile.
**Fix:** Use the explicit Unicode escape: `.replace(/[̀-ͯ]/g, "")`. Functionally identical, robust to editor mishandling.

---

### IN-05: `discoverMemorySinks` hardcodes `_memory` as the only auto-discovery target

**File:** `src/server.ts:96-114`
**Issue:** Auto-discovery looks for `<vault>/_memory/.memory-sink` and synthesizes a `default-memory-v1`-bound sink. A vault using a different convention (e.g. `_agent-memory/`, `memory/`, multiple sinks) gets no auto-discovery. Not a defect against any documented contract but worth flagging: the "default sink" magic only works for the exact `_memory` folder name.
**Fix:** Document the convention prominently (or scan for any folder containing `.memory-sink` rather than only `_memory`). Behavior is current-as-designed; surfacing it here for future extension.

---

## Structural Findings (fallow)

No structural pre-pass payload was provided with this review — narrative findings only.

---

_Reviewed: 2026-05-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
