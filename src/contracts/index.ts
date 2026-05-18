/**
 * src/contracts barrel — Plan 06-01 surface only.
 *
 * Loader, templates, mcp-clients, verbs, instantiate, describe,
 * auto-register, resources, eval-runner land in Plans 06-02/03/04 and
 * are NOT re-exported here yet.
 */

export type {
  AssemblyVerb,
  ContractStep,
  ContractHandleDecl,
  ContractSourceDecl,
  ContractSinkDecl,
  WriteBackSpec,
  ContractInputs,
  ParsedContract,
  OverrideMap,
  InstantiateError,
  ContractAuditRow,
} from "./types.js";
export { CONTRACT_PATH_REGEX } from "./types.js";

export { TYPES_CATALOG } from "./types-catalog.js";
export { resolveRefs } from "./json-schema-ref.js";
export { buildInputSchema, type BuiltInputSchema } from "./input-schema.js";
export { ContractRegistry, type RegistrySetResult } from "./registry.js";
export { slugify } from "./slug.js";
export {
  recordContractStep,
  recordContractLoadError,
  aggregateVerbUsage,
  type ContractAuditDeps,
  type RecordContractStepArgs,
  type RecordContractLoadErrorArgs,
  type VerbUsageRow,
} from "./audit.js";
export { ContractFileSchema, type ContractFileShape } from "./schema.js";
export {
  startContractRegistry,
  type StartContractRegistryOpts,
  type StartedContractRegistry,
  type RegistryChangeKind,
} from "./loader.js";
export {
  syncAutoRegistered,
  type SyncAutoRegisteredOpts,
} from "./auto-register.js";
