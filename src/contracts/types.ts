/**
 * Foundation types for Phase 6 task contracts (ADR-006).
 *
 * Pure type module — zero runtime imports. Plan 06-02/03/04 build on
 * these types; the loader/instantiator/describer land in later slices.
 *
 * Naming convention (CLAUDE.md): PascalCase types, snake_case YAML keys
 * (stored verbatim), `step_alias` is the YAML form; `stepAlias` is the
 * camelCase form at row boundary in `ContractAuditRow`.
 */

import type { z } from "zod";

/**
 * Closed assembly-verb set (ADR-006 §Decision 2 / D-A2a / C-1).
 *
 * 11 baseline verbs + `"literal"` escape + `mcp://<server>/<tool>` peer.
 *
 * No write verbs in the set — writes happen exclusively via the
 * structurally-separate `write_back:` block. Promoting a peer-MCP verb
 * into the baseline enum is a v2.x decision driven by `aggregateVerbUsage`
 * data (D-A2b).
 */
export type AssemblyVerb =
  | "search_hybrid"
  | "expand"
  | "cluster"
  | "recall"
  | "compile_brief"
  | "get_brief"
  | "query_frontmatter"
  | "list_backlinks"
  | "get_outline"
  | "search_sections"
  | "read_note"
  | "literal"
  | `mcp://${string}/${string}`;

/**
 * Path-matcher constant for the loader scan + ChangeFeed dispatch
 * (Pitfall F3 — non-recursive; `_contracts/memory/*.yaml` belongs to
 * the Phase 2 MemoryContract loader).
 */
export const CONTRACT_PATH_REGEX = /^_contracts\/[^/]+\.yaml$/;

/**
 * A single step in an `assembly:` array. `as:` is the alias under which
 * the step's output is bound in the template environment.
 *
 * `value:` is populated ONLY when `verb === "literal"` (escape hatch
 * for hard-coded fixtures).
 */
export interface ContractStep {
  as: string;
  verb: AssemblyVerb;
  args?: Record<string, unknown>;
  value?: unknown;
}

/**
 * Contract-declared source / sink handle entry.
 *
 * `handle` is the literal URI shown in the YAML (e.g.
 * `"obsidian-fs://my-vault"`). `required` defaults to true; when false,
 * a missing override + missing default is not an error.
 */
export interface ContractHandleDecl {
  handle: string;
  required: boolean;
}

/** Backwards-compat alias — sources and sinks share the same shape today. */
export type ContractSourceDecl = ContractHandleDecl;
export type ContractSinkDecl = ContractHandleDecl;

/**
 * Write-back spec — the chokepoint that produces a real DocId via
 * DeliveryAdapter.write (Invariant C-3, Pitfall F6).
 */
export interface WriteBackSpec {
  /** Sink handle (template expression or literal). */
  sink: string;
  document_kind: "brief" | "observation" | "custom";
  properties: Record<string, unknown>;
  /** Template expression that resolves to the body string. */
  body_from: string;
}

/** YAML inputs flat form: `{ <fieldName>: <jsonSchemaFragment> }`. */
export type ContractInputs = Record<string, unknown>;

/**
 * Parsed-and-validated contract — registry entry shape.
 *
 * Caches the built input schema so `describe_contract` and
 * `instantiate_contract` skip the buildInputSchema round-trip.
 */
export interface ParsedContract {
  version: 1;
  name: string;
  description: string;
  inputs: ContractInputs;
  required: string[];
  sources: Record<string, ContractSourceDecl>;
  sinks: Record<string, ContractSinkDecl>;
  assembly: ContractStep[];
  output_shape?: object;
  write_back?: WriteBackSpec;
  /** Built once at load time — `z.fromJSONSchema(inputJsonSchema)`. */
  inputZodSchema: z.ZodObject<z.ZodRawShape>;
  /** Built once at load time — passed verbatim to MCP `tools/list`. */
  inputJsonSchema: object;
}

/** Caller-supplied override map keyed by handle name (not URI scheme). */
export type OverrideMap = Record<string, string>;

/**
 * Closed error envelope (ADR-006 §Decision 7 + Q-OUTPUT + WARNING-6).
 *
 * 12 reasons, sealed for v2.0.0. The first 11 are orchestrator-level;
 * `ambiguous_vault` is server-dispatch-level (caller omitted `vault` and
 * multiple vaults are configured — surfaced in the same closed union to
 * keep callers parsing one discriminated type).
 */
export type InstantiateError =
  | { ok: false; reason: "unknown_contract"; name: string }
  | { ok: false; reason: "invalid_inputs"; issues: unknown }
  | {
      ok: false;
      reason: "unknown_override_handle";
      handle: string;
      valid_handles: string[];
    }
  | { ok: false; reason: "missing_required_source"; handle: string; hint: string }
  | {
      ok: false;
      reason: "sink_override_not_a_memory_sink";
      target: string;
      hint: string;
    }
  | { ok: false; reason: "unresolved_template"; expression: string }
  | { ok: false; reason: "verb_not_available"; verb: string }
  | {
      ok: false;
      reason: "mcp_client_unavailable";
      verb: string;
      client_name: string;
    }
  | { ok: false; reason: "assembly_step_failed"; step_alias: string; cause: string }
  | { ok: false; reason: "write_back_failed"; cause: string }
  | { ok: false; reason: "validation_failed_on_output_shape"; issues: unknown }
  | { ok: false; reason: "ambiguous_vault"; available_vaults: string[] };

/**
 * Re-export of the DB row type for convenience — Plan 06-02/03 import
 * this name (NOT from `src/db/queries/contract-audit.js`) so the
 * dependency graph stays cleanly directed (contracts → db).
 */
export interface ContractAuditRow {
  kind: "contract_step" | "contract_load_error";
  contract?: string;
  verb?: string;
  stepAlias?: string;
  vault?: string;
  ts: number;
  errorMessage?: string;
}
