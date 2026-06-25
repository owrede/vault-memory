/**
 * src/contracts barrel — Plans 06-01 / 06-02 / 06-03 surface.
 *
 * Plan 06-04 adds: resources (vault-memory://contract-verbs/{vault})
 * and the reference-contracts test fixtures.
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
export { syncAutoRegistered, type SyncAutoRegisteredOpts } from "./auto-register.js";
export { resolveTemplate, type TemplateBindings, type TemplateResolveResult } from "./templates.js";
export {
  PeerMcpRegistry,
  type PeerMcpClient,
  type PeerMcpClientConfig,
  type ClientFactory,
} from "./mcp-clients.js";
export { verbDispatcher, type VerbDeps, type VerbDispatchOpts } from "./verbs/index.js";
export { callMcpVerb } from "./verbs/mcp-extension.js";
export {
  instantiateContract,
  type InstantiateDeps,
  type InstantiateArgs,
  type InstantiateBundle,
  type InstantiateResult,
} from "./instantiate.js";
export {
  describeContract,
  type DescribeDeps,
  type DescribeArgs,
  type DescribeResult,
} from "./describe.js";
export {
  readListContracts,
  readListContractVerbs,
  BASELINE_VERBS,
  type ListContractsDeps,
  type ListContractsOpts,
  type ListContractsEntry,
  type ListContractsResource,
  type ListContractVerbsDeps,
  type ListContractVerbsEntry,
  type ListContractVerbsResource,
} from "./resources.js";

export {
  readListSources,
  readSourceTools,
  readSourceTool,
  type SourceConfigMeta,
  type ListSourcesEntry,
  type ListSourcesResource,
  type SourceToolsResource,
  type SourceToolResource,
} from "./sources-resources.js";

export type { PeerMcpTool, PeerMcpStatus, PeerMcpClientInfo } from "./mcp-clients.js";
