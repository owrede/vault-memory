/**
 * instantiateContract — Phase 6 / CON-06 / D-A4a/b/c / Q-OUTPUT.
 *
 * The L4 orchestrator: takes a contract name + inputs (+ optional
 * source/sink overrides), executes the full 7-step pipeline from
 * RESEARCH §Architecture, and returns either the shaped bundle or a
 * structured `InstantiateError` envelope.
 *
 * # Pipeline (RESEARCH §Architecture (1)-(7))
 *
 *   (1) Lookup contract → `unknown_contract` if missing.
 *   (2) Zod-validate inputs against `parsed.inputZodSchema` (Pitfall F2:
 *       additionalProperties:false rejects typos) → `invalid_inputs`.
 *   (3) Resolve override handles. Reject unknown handles (validated
 *       against `parsed.sources`/`parsed.sinks` keys). Sinks ADDITIONALLY
 *       validate through `MemorySinkRegistry.resolveMemorySink` (D-A4c
 *       — MEM-05 invariant un-bypassable). Default chain per D-A4b:
 *       explicit override → config default → contract YAML literal →
 *       error if required.
 *   (4) Build template bindings: `inputs` carries the caller's data PLUS
 *       resolved source/sink handles (so `{{default_source}}` works);
 *       `steps` starts empty and accumulates as the loop runs.
 *   (5) For each assembly step:
 *         a. Resolve `{{templates}}` in step.args + step.value via
 *            `resolveTemplate`. Unresolved → `unresolved_template`.
 *         b. Dispatch via `verbDispatcher`. Thrown errors caught and
 *            surfaced as `assembly_step_failed`. Structured-error
 *            envelopes (`verb_not_available`, `mcp_client_unavailable`)
 *            from the dispatcher pass through directly.
 *         c. Write a `contract_audit kind:'contract_step'` row REGARDLESS
 *            of success/failure (payload-free per C-5).
 *         d. Bind output under `step.as` in `bindings.steps`.
 *   (6) If `parsed.write_back` exists: resolve templates on `sink`,
 *       `body_from`, `properties` and route through
 *       `DeliveryAdapter.write` (MEM-05 chokepoint). Thrown → `write_back_failed`.
 *   (7) If `parsed.output_shape` exists: build a Zod schema via
 *       `z.fromJSONSchema(parsed.output_shape)` and `safeParse` the
 *       `{steps, write_back}` bundle (Q-OUTPUT). Mismatch →
 *       `validation_failed_on_output_shape`. Parse failure inside the
 *       Zod build → stderr WARN + skip (graceful degradation).
 *
 * # Invariants (ADR-006)
 *
 *   - C-1: The verb enum has NO write verbs. The dispatcher's `default`
 *     branch rejects unknown verbs (defense-in-depth).
 *   - C-2: All sinks pass through `MemorySinkRegistry.resolveMemorySink`
 *     before the write_back path runs. Tested in Test 7.
 *   - C-3: Only `DeliveryAdapter.write()`'s return value populates
 *     `bundle.write_back.doc_id`. Peer-MCP outputs are advisory step
 *     bindings — they cannot fabricate a DocId.
 *   - C-5: `recordContractStep` is payload-free; its TypeScript
 *     signature excludes any output/payload field.
 *   - C-7: User-supplied input values are NEVER re-evaluated as
 *     templates (verified in templates.test.ts Test 13).
 *
 * # Adapter-seam discipline
 *
 *   Imports zod + sibling contracts modules + MemorySinkRegistry type +
 *   DeliveryAdapter type. Zero `fs` / `path` / `gray-matter` /
 *   `chokidar` / `yaml` imports.
 */

import { z } from "zod";
import type { ContractRegistry } from "./registry.js";
import type {
  InstantiateError,
  OverrideMap,
  ContractStep,
} from "./types.js";
import { resolveTemplate, type TemplateBindings } from "./templates.js";
import { verbDispatcher, type VerbDeps } from "./verbs/index.js";
import { recordContractStep, type ContractAuditDeps } from "./audit.js";
import type { MemorySinkRegistry } from "../memory/registry.js";
import type { DeliveryAdapter } from "../adapters/delivery/types.js";
import type { Vault } from "../vault/index.js";
import type { Document, DocId } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────────────────

export interface InstantiateDeps extends VerbDeps, ContractAuditDeps {
  vault: Vault;
  registry: ContractRegistry;
  memorySinks: MemorySinkRegistry;
  delivery: DeliveryAdapter;
  /** From `[contracts.defaults]` — overrides contract YAML literals. */
  configDefaults: Record<string, string>;
  /** Q-TIMEOUT — applied ONLY to peer-MCP verbs. */
  stepTimeoutSeconds: number;
}

export interface InstantiateArgs {
  name: string;
  inputs: Record<string, unknown>;
  source_overrides?: OverrideMap;
  sink_overrides?: OverrideMap;
}

/** Q-OUTPUT — the bundle shape returned to callers on success. */
export interface InstantiateBundle {
  steps: Record<string, unknown>;
  write_back: { doc_id: string; sink: string } | null;
}

export type InstantiateResult =
  | ({ ok: true } & InstantiateBundle)
  | InstantiateError;

// ─────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────

export async function instantiateContract(
  deps: InstantiateDeps,
  args: InstantiateArgs,
): Promise<InstantiateResult> {
  // (1) Lookup.
  const parsed = deps.registry.get(args.name);
  if (!parsed) return { ok: false, reason: "unknown_contract", name: args.name };

  // (2) Zod-validate inputs (Pitfall F2: additionalProperties:false).
  const inputCheck = parsed.inputZodSchema.safeParse(args.inputs);
  if (!inputCheck.success) {
    return { ok: false, reason: "invalid_inputs", issues: inputCheck.error.format() };
  }

  // (3a) Reject unknown override handles for sources.
  const validSourceHandles = Object.keys(parsed.sources);
  for (const handle of Object.keys(args.source_overrides ?? {})) {
    if (!validSourceHandles.includes(handle)) {
      return {
        ok: false,
        reason: "unknown_override_handle",
        handle,
        valid_handles: validSourceHandles,
      };
    }
  }
  // (3b) Reject unknown override handles for sinks.
  const validSinkHandles = Object.keys(parsed.sinks);
  for (const handle of Object.keys(args.sink_overrides ?? {})) {
    if (!validSinkHandles.includes(handle)) {
      return {
        ok: false,
        reason: "unknown_override_handle",
        handle,
        valid_handles: validSinkHandles,
      };
    }
  }

  // (3c) Default chain per D-A4b: explicit → config → contract literal → error if required.
  const resolvedSources: Record<string, string> = {};
  for (const [handle, decl] of Object.entries(parsed.sources)) {
    const v =
      args.source_overrides?.[handle] ??
      deps.configDefaults[handle] ??
      (decl.handle === "" ? undefined : decl.handle);
    if (v === undefined && decl.required) {
      return {
        ok: false,
        reason: "missing_required_source",
        handle,
        hint: `pass via source_overrides or set [contracts.defaults.${handle}] in config.toml`,
      };
    }
    if (v !== undefined) resolvedSources[handle] = v;
  }
  const resolvedSinks: Record<string, string> = {};
  for (const [handle, decl] of Object.entries(parsed.sinks)) {
    const v =
      args.sink_overrides?.[handle] ??
      deps.configDefaults[handle] ??
      (decl.handle === "" ? undefined : decl.handle);
    if (v === undefined && decl.required) {
      return {
        ok: false,
        reason: "missing_required_source",
        handle,
        hint: `pass via sink_overrides or set [contracts.defaults.${handle}] in config.toml`,
      };
    }
    if (v !== undefined) {
      // (4) D-A4c MEM-05 invariant — must resolve through MemorySinkRegistry.
      try {
        deps.memorySinks.resolveMemorySink(v);
      } catch {
        return {
          ok: false,
          reason: "sink_override_not_a_memory_sink",
          target: v,
          hint: "sinks must be a registered MemorySink handle (see list_sinks)",
        };
      }
      resolvedSinks[handle] = v;
    }
  }

  // (5) Build template bindings. The three namespaces are kept separate
  // so the returned `bundle.steps` carries ONLY step outputs (not the
  // resolved source/sink handles). Both access patterns are supported:
  //   - `{{default_sink}}` resolves via the `handles` map (bare name);
  //   - `{{inputs.default_sink}}` resolves via `inputs.<handle>` (a
  //     mirror copy is placed under `inputs` so contract authors who
  //     prefer the explicit path notation are not blocked).
  //   - `{{inputs.x}}` resolves caller-supplied data via `inputs`;
  //   - `{{step1.y}}` resolves accumulated step outputs via `steps`.
  // Caller inputs cannot collide with declared handles (Zod
  // additionalProperties:false rejects unknown keys at input validation).
  const bindings: TemplateBindings = {
    inputs: { ...inputCheck.data, ...resolvedSources, ...resolvedSinks },
    steps: {},
    handles: { ...resolvedSources, ...resolvedSinks },
  };

  // (6) Execute steps.
  for (const step of parsed.assembly) {
    const stepResult = await runStep(deps, parsed.name, step, bindings);
    if ("error" in stepResult) {
      return stepResult.error;
    }
    bindings.steps[step.as] = stepResult.value;
  }

  // (7) Run write_back via DeliveryAdapter.write (MEM-05 chokepoint).
  let writeBackResult: { doc_id: string; sink: string } | null = null;
  if (parsed.write_back) {
    const wb = parsed.write_back;
    const sinkResolved = resolveTemplate(wb.sink, bindings);
    if (!sinkResolved.ok) {
      return { ok: false, reason: "unresolved_template", expression: sinkResolved.expression };
    }
    const bodyResolved = resolveTemplate(wb.body_from, bindings);
    if (!bodyResolved.ok) {
      return { ok: false, reason: "unresolved_template", expression: bodyResolved.expression };
    }
    const propsResolved = resolveTemplate(wb.properties, bindings);
    if (!propsResolved.ok) {
      return { ok: false, reason: "unresolved_template", expression: propsResolved.expression };
    }
    if (typeof bodyResolved.value !== "string") {
      return {
        ok: false,
        reason: "write_back_failed",
        cause: `body_from must resolve to a string, got ${typeof bodyResolved.value}`,
      };
    }
    const sinkResolvedString =
      typeof sinkResolved.value === "string" ? sinkResolved.value : String(sinkResolved.value);
    // Resolve the sink name/handle to its canonical full handle (e.g.
    // `obsidian-fs://test-vault/_memory/`). MemorySinkRegistry accepts
    // either form via resolveMemorySink.
    let sinkObj: { handle: unknown; vault: string; resolveToRelativePath: string };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sinkObj = deps.memorySinks.resolveMemorySink(sinkResolvedString) as any;
    } catch {
      return {
        ok: false,
        reason: "write_back_failed",
        cause: `sink "${sinkResolvedString}" did not resolve to a registered MemorySink`,
      };
    }
    const sinkHandle = sinkObj.handle as unknown as string;
    try {
      // Compose a Document patch — body lives in a single paragraph
      // block; the DeliveryAdapter assigns the final filename via the
      // contract's `naming` strategy.
      const doc: Partial<Document> = {
        blocks: [{ kind: "paragraph", text: bodyResolved.value }],
        properties: propsResolved.value as Record<string, unknown>,
      };
      // Synthesize a real DocId rooted in the sink folder. The
      // obsidian-fs delivery adapter's NAMING-AUTO logic rewrites the
      // last path segment per the bound MemoryContract's naming
      // strategy (date-slug for default-memory-v1, caller-provided for
      // default-brief-v1). We pick a placeholder slug from the
      // contract name + step alias namespace so the DocId is a valid
      // path even before the rewrite. Plan 06-04 may swap this for an
      // adapter-side allocator that returns the final DocId without a
      // placeholder round-trip.
      // Placeholder filename — the obsidian-fs adapter's NAMING-AUTO
      // logic rewrites this per the bound MemoryContract's naming
      // strategy. The extension is adapter-specific (markdown for
      // obsidian-fs) but we never hard-code it here per ADR-002 I-5;
      // the adapter appends the extension when it rewrites the path.
      const placeholderName = String(parsed.name).replace(/[^a-z0-9-]/gi, "_");
      const placeholderResource = sinkObj.resolveToRelativePath + placeholderName;
      const placeholderId =
        `obsidian-fs://${sinkObj.vault}/${placeholderResource}` as unknown as DocId;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const writeRes: any = await deps.delivery.write(placeholderId, doc, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sink: sinkHandle as any,
      });
      if (writeRes && writeRes.ok === false) {
        return {
          ok: false,
          reason: "write_back_failed",
          cause: String(writeRes.reason ?? writeRes.message ?? "unknown write failure"),
        };
      }
      writeBackResult = {
        doc_id: String(writeRes.doc_id),
        sink: sinkHandle,
      };
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: "write_back_failed", cause };
    }
  }

  // (8) Validate bundle against output_shape (Q-OUTPUT).
  const bundle: InstantiateBundle = {
    steps: bindings.steps,
    write_back: writeBackResult,
  };
  if (parsed.output_shape) {
    try {
      const outputSchema = z.fromJSONSchema(
        parsed.output_shape as unknown as Parameters<typeof z.fromJSONSchema>[0],
      );
      const check = outputSchema.safeParse(bundle);
      if (!check.success) {
        return {
          ok: false,
          reason: "validation_failed_on_output_shape",
          issues: check.error.format(),
        };
      }
    } catch (err) {
      // The contract YAML's output_shape is not a Zod-parseable JSON
      // Schema. Log + skip (graceful degradation) — the contract
      // author can iterate without breaking the slice.
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[contracts] output_shape validation skipped: ${msg}\n`);
    }
  }

  return { ok: true, ...bundle };
}

// ─────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────

interface StepValue {
  value: unknown;
}
interface StepError {
  error: InstantiateError;
}

/**
 * Run one assembly step: resolve templates → dispatch → record audit
 * (always) → return the bound output OR a structured error.
 */
async function runStep(
  deps: InstantiateDeps,
  contractName: string,
  step: ContractStep,
  bindings: TemplateBindings,
): Promise<StepValue | StepError> {
  // (a) Resolve templates on args + value.
  const resolvedArgs = step.args
    ? resolveTemplate(step.args, bindings)
    : { ok: true as const, value: undefined };
  if (!resolvedArgs.ok) {
    writeAuditRow(deps, contractName, step);
    return {
      error: {
        ok: false,
        reason: "unresolved_template",
        expression: resolvedArgs.expression,
      },
    };
  }
  const resolvedValue =
    step.value !== undefined
      ? resolveTemplate(step.value, bindings)
      : { ok: true as const, value: undefined };
  if (!resolvedValue.ok) {
    writeAuditRow(deps, contractName, step);
    return {
      error: {
        ok: false,
        reason: "unresolved_template",
        expression: resolvedValue.expression,
      },
    };
  }

  // (b) Dispatch verb.
  let output: unknown;
  try {
    output = await verbDispatcher(
      step.verb,
      resolvedArgs.value as Record<string, unknown> | undefined,
      { value: resolvedValue.value },
      deps,
      { stepAlias: step.as, timeoutSeconds: deps.stepTimeoutSeconds },
    );
  } catch (err) {
    writeAuditRow(deps, contractName, step);
    const cause = err instanceof Error ? err.message : String(err);
    return {
      error: {
        ok: false,
        reason: "assembly_step_failed",
        step_alias: step.as,
        cause,
      },
    };
  }

  // (c) Write audit row.
  writeAuditRow(deps, contractName, step);

  // (d) If the dispatcher returned a structured error envelope, surface it.
  if (
    output !== null &&
    typeof output === "object" &&
    "ok" in (output as Record<string, unknown>) &&
    (output as { ok: boolean }).ok === false
  ) {
    // The dispatcher emits one of:
    //   - {ok:false, reason:"verb_not_available", verb}
    //   - {ok:false, reason:"mcp_client_unavailable", verb, client_name}
    //   - {ok:false, reason:"assembly_step_failed", step_alias, cause}
    // All three are valid InstantiateError reasons.
    return { error: output as InstantiateError };
  }

  return { value: output };
}

function writeAuditRow(
  deps: InstantiateDeps,
  contractName: string,
  step: ContractStep,
): void {
  recordContractStep(deps, {
    contract: contractName,
    verb: step.verb,
    step_alias: step.as,
    vault: deps.vault.config.name,
  });
}
