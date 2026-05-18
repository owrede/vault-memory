---
phase: 06-task-contract-dsl
reviewed: 2026-05-18T00:00:00Z
depth: standard
files_reviewed: 56
files_reviewed_list:
  - docs/v2/PHASE-6-SIGN-OFF.md
  - docs/v2/adr/006-task-contract-dsl.md
  - evals/fixtures/v2-test-vault/_contracts/code-review-brief.yaml
  - evals/fixtures/v2-test-vault/_contracts/meeting-prep.yaml
  - evals/fixtures/v2-test-vault/_contracts/project-status.yaml
  - evals/fixtures/v2-test-vault/_contracts/smoketest-trivial.yaml
  - evals/fixtures/v2-test-vault/_queries/contracts-code-review-brief.yaml
  - evals/fixtures/v2-test-vault/_queries/contracts-meeting-prep.yaml
  - evals/fixtures/v2-test-vault/_queries/contracts-project-status.yaml
  - evals/fixtures/v2-test-vault/_queries/contracts-stub-parity.yaml
  - evals/v1-baseline/baseline.test.ts
  - evals/v1-baseline/tools-list.snapshot.json
  - src/config/loader.test.ts
  - src/config/loader.ts
  - src/contracts/audit.test.ts
  - src/contracts/audit.ts
  - src/contracts/auto-register.test.ts
  - src/contracts/auto-register.ts
  - src/contracts/describe.test.ts
  - src/contracts/describe.ts
  - src/contracts/eval-runner.test.ts
  - src/contracts/index.ts
  - src/contracts/input-schema.test.ts
  - src/contracts/input-schema.ts
  - src/contracts/instantiate.test.ts
  - src/contracts/instantiate.ts
  - src/contracts/json-schema-ref.test.ts
  - src/contracts/json-schema-ref.ts
  - src/contracts/loader.test.ts
  - src/contracts/loader.ts
  - src/contracts/mcp-clients.test.ts
  - src/contracts/mcp-clients.ts
  - src/contracts/reference-contracts.test.ts
  - src/contracts/registry.test.ts
  - src/contracts/registry.ts
  - src/contracts/resources.test.ts
  - src/contracts/resources.ts
  - src/contracts/schema.test.ts
  - src/contracts/schema.ts
  - src/contracts/slug.test.ts
  - src/contracts/slug.ts
  - src/contracts/templates.test.ts
  - src/contracts/templates.ts
  - src/contracts/types-catalog.test.ts
  - src/contracts/types-catalog.ts
  - src/contracts/types.ts
  - src/contracts/verbs/index.test.ts
  - src/contracts/verbs/index.ts
  - src/contracts/verbs/mcp-extension.test.ts
  - src/contracts/verbs/mcp-extension.ts
  - src/db/database.ts
  - src/db/queries/contract-audit.test.ts
  - src/db/queries/contract-audit.ts
  - src/db/schema.ts
  - src/server.test.ts
  - src/server.ts
  - src/tool-registry.test.ts
  - src/tool-registry.ts
  - src/types.ts
findings:
  critical: 0
  warning: 7
  info: 6
  total: 13
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-05-18T00:00:00Z
**Depth:** standard
**Files Reviewed:** 56
**Status:** issues_found

## Summary

Phase 6 (Task Contract DSL) delivers the contract loader, registry, orchestrator (`instantiateContract`), template resolver, peer-MCP client registry, auto-register pipeline, and contract audit substrate. The security invariants advertised in ADR-006 are well-defended structurally — `resolveTemplate` is a pure substitution function with no eval, `DeliveryAdapter.write` is the only path to a real DocId, the assembly verb enum has no write verbs, `$ref` resolution is sealed to `#/types/<name>`, `contract_audit` schema excludes a payload column at the type level, peer-MCP calls are wrapped in Q-TIMEOUT, and child processes are disposed via `Symbol.dispose` + SIGTERM/SIGINT handlers.

No BLOCKER-class defects were identified. Findings are concentrated in two areas:
1. Several closed-error envelopes in `instantiate.ts` are reachable with the wrong `reason` discriminator (handle-resolution code path mis-tags sink errors as `missing_required_source`).
2. A handful of medium-impact robustness gaps around binding-namespace collisions, peer-MCP timeout floor, output-shape graceful degradation, and a doc/code drift in the JSDoc adapter-seam claim for `loader.ts` (imports `yaml`).

The orchestrator's happy path, error envelopes, and security chokepoints are exercised by 20 instantiation tests + 13 template tests + dedicated registry/loader/auto-register/dispatch suites; the eval-runner runs all 4 reference contracts through a full mocked pipeline.

## Warnings

### WR-01: `missing_required_source` reason is used for missing required SINKS

**File:** `src/contracts/instantiate.ts:177-183`
**Issue:** When a required sink has no override, no config default, and no contract literal, the orchestrator returns `{reason: "missing_required_source", ...}` with a hint that mentions `sink_overrides` — but the discriminator is wrong. The `InstantiateError` union (types.ts:135) only defines `missing_required_source` as a reason; there is no `missing_required_sink`. Callers matching on the closed enum cannot distinguish a missing source from a missing sink, and tooling that surfaces the error to users gets a mismatched `reason ↔ hint` pair (reason says "source", hint says "sink_overrides").
**Fix:** Either (a) introduce a separate `missing_required_sink` reason in the closed `InstantiateError` union (preferred — ADR-006 §Decision 7 says the union is sealed for v2.0.0, so this is a v2.x additive change) or (b) rename the unified reason to something neutral like `missing_required_handle` with a `kind: "source" | "sink"` discriminator field. At minimum, document the overload explicitly in `types.ts:135` so the closed-enum claim is accurate.

```typescript
// Today (instantiate.ts:177-182) returns the SOURCE reason for a missing SINK:
if (v === undefined && decl.required) {
  return {
    ok: false,
    reason: "missing_required_source",  // ← misleading
    handle,
    hint: `pass via sink_overrides or set [contracts.defaults.${handle}] in config.toml`,
  };
}
```

### WR-02: Source/sink handle resolution silently overwrites caller-supplied inputs of the same name

**File:** `src/contracts/instantiate.ts:211-215`
**Issue:** The bindings construction is:
```typescript
const bindings: TemplateBindings = {
  inputs: { ...inputCheck.data, ...resolvedSources, ...resolvedSinks },
  ...
};
```
The spread order means resolved source/sink URIs overwrite caller inputs of the same name. The inline comment claims this is impossible because "Zod additionalProperties:false rejects unknown keys at input validation" — but that protection only applies to keys NOT declared in the contract's `inputs:`. If a contract author declares an input named `default_source` (e.g. for an unrelated string-typed parameter) AND a source named `default_source`, the user-supplied input is silently shadowed by the resolved URI. The author gets no diagnostic.
**Fix:** At contract-load time (`schema.ts` superRefine), reject contracts where any key in `inputs` collides with a key in `sources` or `sinks`. This is structurally analogous to the existing duplicate-step-alias check.

```typescript
.superRefine((data, ctx) => {
  const inputKeys = new Set(Object.keys(data.inputs ?? {}));
  for (const k of Object.keys(data.sources ?? {})) {
    if (inputKeys.has(k)) {
      ctx.addIssue({ code: "custom", path: ["sources", k],
        message: `handle '${k}' collides with an input field of the same name` });
    }
  }
  // ...same for sinks
});
```

### WR-03: `output_shape` parse failure silently degrades (graceful-degradation hides authoring bugs)

**File:** `src/contracts/instantiate.ts:319-339`
**Issue:** When `z.fromJSONSchema(parsed.output_shape)` throws (malformed JSON Schema), the orchestrator writes a single line to stderr and returns the bundle as if validation succeeded. This is documented as intentional graceful degradation, but it means a contract author who ships a typo'd `output_shape` gets no error — every instantiation will appear to succeed, and the failure is only observable in the running server's stderr log. There is no audit row for the validation skip.
**Fix:** At minimum, write a `contract_audit kind:'contract_load_error'` row when an output_shape build fails (the failure mode is constant per contract, so emit once at load time — `loader.ts`'s `buildParsedContract` should attempt the build and surface the error there). Alternatively, fail-loud at load time and reject the contract entirely. Today's only diagnostic is a stderr line that vanishes between server restarts.

### WR-04: `Q-TIMEOUT` minimum floors silently at 1 ms — no validation of `step_timeout_seconds > 0`

**File:** `src/contracts/verbs/mcp-extension.ts:72`
**Issue:** `const timeoutMs = Math.max(1, Math.floor(opts.timeoutSeconds * 1000));` silently coerces zero / negative / NaN timeouts to 1 ms. The config schema's `z.number().int().positive()` (config/loader.ts:91-92) covers config-driven values, but `InstantiateDeps.stepTimeoutSeconds` is `number` (instantiate.ts:90) with no runtime check. A test injecting `stepTimeoutSeconds: 0` would cause every peer-MCP call to time out in 1 ms, surfaced only as `assembly_step_failed { cause: 'timeout' }` — no clear signal that the configuration is invalid.
**Fix:** Either narrow the type to a branded `PositiveSeconds` validated at `buildInstantiateDeps`, or add an explicit assert at the top of `callMcpVerb` that throws on non-positive `timeoutSeconds`. The current floor masks misconfiguration.

### WR-05: `loader.ts` JSDoc claims "zero `yaml` imports" but the file imports `yaml`

**File:** `src/contracts/loader.ts:21-26, 40`
**Issue:** The adapter-seam discipline JSDoc says "Zero `fs` / `path.join` / `gray-matter` / `chokidar` imports" — and at line 40 the file imports `parseDocument` from `yaml`. The lint script may be passing because `yaml` is not in its denylist, but the JSDoc itself is internally inconsistent if you read the surrounding text which adds "yaml's parseDocument operates on text already read by the source, not the filesystem" — that's a justification, not an absence. Reviewers grepping for "yaml" against the JSDoc claim get a false signal.
**Fix:** Adjust the JSDoc to explicitly state which deps ARE allowed (`yaml` for text parsing, no FS connectors) rather than overclaiming zero-yaml. Apply the same fix to any other contracts-module JSDocs that overclaim. `lint-adapters.sh` should reflect the actual policy.

### WR-06: `placeholderName` strips characters but does not enforce non-empty result

**File:** `src/contracts/instantiate.ts:288-291`
**Issue:** `const placeholderName = String(parsed.name).replace(/[^a-z0-9-]/gi, "_");` — if a contract name (hypothetically) consisted of only non-allowed characters (e.g. `"_"` or empty), `placeholderName` becomes `"_"` or `""`. The `parsed.name` is constrained by the load-time regex `/^[a-z][a-z0-9-]*$/`, so this is defense-in-depth, but the placeholder DocId construction (`obsidian-fs://<vault>/<sinkResource><placeholderName>`) could in principle produce an invalid DocId (`obsidian-fs://vault/folder/` ending in `/`). The orchestrator passes this to `DeliveryAdapter.write`, which the adapter is supposed to rewrite via `NAMING-AUTO`. If the adapter ever falls back to using the placeholder verbatim, an empty filename could land. Today's code is safe by virtue of the schema regex, but the dependency is implicit.
**Fix:** Either assert non-empty `placeholderName` (and throw a clear `write_back_failed { cause: 'invalid contract name produced empty placeholder' }`), or reuse a constant fixed placeholder like `"_brief"` that is independent of the contract name. Cuts a class of subtle DocId-shape bugs.

### WR-07: `resolveContractVault` ambiguity check returns `available_vaults: []` when zero vaults are configured

**File:** `src/server.ts:881-893`
**Issue:** When `manager.list()` is empty, the code returns `{ ok: false, reason: "ambiguous_vault", available_vaults: [] }`. The `ambiguous_vault` reason is documented (types.ts:151) as "multiple vaults are configured and the caller omitted `vault`". An empty list isn't ambiguous — it's the no-vault-configured error. Returning `ambiguous_vault` here is misleading; the caller sees an empty available_vaults list and cannot tell whether their config is empty vs. their vault list was somehow mis-loaded.
**Fix:** Differentiate. Introduce a `no_vaults_configured` reason in the closed `InstantiateError` union, or short-circuit before reaching `resolveContractVault` so the empty-vault case never produces a misleading discriminator. Keeps the closed-enum contract honest.

## Info

### IN-01: `WHOLE_STRING_RE` and `TOKEN_RE` use `[^}]+`, which would reject single-`}` content inside paths

**File:** `src/contracts/templates.ts:69-71`
**Issue:** Both regexes use `[^}]+` to capture the path. This means a template like `{{inputs.foo}}` matches, but a hypothetical path containing a literal `}` cannot. Today's lookup paths are dot/index syntax over identifier strings, so this is fine. A future extension supporting JS-object-literal-style paths would silently fail to match. Document the constraint in the JSDoc or assert it explicitly.

### IN-02: `bindings.handles` is documented but the optional path is inconsistently used

**File:** `src/contracts/templates.ts:51-56, 88-96`; `src/contracts/instantiate.ts:214`
**Issue:** `TemplateBindings.handles` is declared optional, but the orchestrator always populates it. Tests in `templates.test.ts` never exercise the `handles` namespace explicitly (Test 1-13 only use `inputs` + `steps`). The orchestrator merges handles into bindings.inputs AS WELL via the spread at line 212. Two code paths to reach the same handle (`{{default_sink}}` via handles, `{{inputs.default_sink}}` via inputs). The duplication is intentional but the test coverage doesn't pin the equivalence — a future refactor could break one path without failing tests.
**Fix:** Add an explicit test that both `{{default_sink}}` and `{{inputs.default_sink}}` resolve to the same URI.

### IN-03: `instantiateContract` test 20 casts `"write_note"` past the type system to test the runtime backstop

**File:** `src/contracts/instantiate.test.ts:658-676`
**Issue:** Test 20 deliberately bypasses the Zod gate via `as unknown as ContractStep["verb"]` to verify the dispatcher's `default` branch returns `verb_not_available`. This is the right defense-in-depth test, but the cast pattern is brittle — a future refactor of `ContractStep["verb"]` to a tagged union would silently make the cast a runtime no-op. Consider a comment block explaining why the cast is intentional and a helper (`buildBypassContract`) to centralize the pattern.

### IN-04: `extractText` in `loader.ts` joins paragraph blocks with `\n` but contracts are YAML text

**File:** `src/contracts/loader.ts:344-360`
**Issue:** The fallback path (multiple `paragraph` blocks) joins with a single `\n`. If a future adapter splits YAML across blocks at arbitrary boundaries (e.g. mid-line), the resulting text will be malformed YAML and parse will fail at the same `parseDocument` step downstream — the error message is generic ("yaml parse failed"), making the multi-block edge case hard to diagnose. Document the expectation that contract YAML is always a single block, or add a defensive check.

### IN-05: `decomposeDocId` and `CONTRACT_PATH_REGEX` apply to vault relative path — non-`obsidian-fs` schemes silently miss

**File:** `src/contracts/loader.ts:128-130, 174-175`
**Issue:** The boot scan and event handler both run `decomposeDocId(ref.id)` to get a resource string, then test against `CONTRACT_PATH_REGEX`. Any future source connector that ships DocIds with a `<scheme>://` other than `obsidian-fs` would pass through `decomposeDocId` (which is scheme-agnostic) and may not surface contract files because the resource path conventions differ. This is the loader's documented v2.0 scope (obsidian-fs only) but the dependency on `decomposeDocId` shape is implicit.
**Fix:** Either assert the scheme inside `loader.ts` (and add a TODO when widening) or add a JSDoc note that `CONTRACT_PATH_REGEX` assumes obsidian-fs conventions.

### IN-06: Tests rely on `JSON.parse(first.text)` peeling — a peer that returns markdown returns the raw string

**File:** `src/contracts/mcp-clients.ts:156-164`
**Issue:** The envelope peel logic returns parsed JSON if `first.text` parses, else the raw text. A peer-MCP that returns Markdown will surface as a raw string, and a contract author who consumes `{{step.field}}` against it will get `unresolved_template`. This is intentional but the failure mode is implicit. Document in the JSDoc that template-binding expansion (`{{verb_output.field}}`) requires the peer to return a JSON-parseable response — and structurally this is what `parseDocument`-style YAML peers will need too.

---

_Reviewed: 2026-05-18T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
