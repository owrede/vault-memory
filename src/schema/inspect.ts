import { inspectionBody } from "./body.js";
import { z } from "zod";
import {
  decomposeDocId,
  parseDocId,
  parseSourceHandle,
  type AdapterRegistry,
} from "../adapters/registry.js";
import { getContract, type MemoryContract } from "../memory/contract/index.js";
import { toCitationPacket, displayUrlFor, type CitationPacket } from "../memory/citation-packet.js";
import { parseObservations } from "../observations/parse.js";
import { parseDomainRelations } from "../relations/parse.js";
import { inferFieldProfile, type FieldProfile } from "./profile.js";
import { diffSchema, type SchemaField, type SchemaDrift } from "./drift.js";
import type { DocId } from "../types.js";
export interface InspectSchemaArgs {
  mode: "infer" | "validate" | "diff";
  doc_ids: string[];
  contract?: string;
  strict?: boolean;
}
export interface InspectSchemaDeps {
  adapterRegistry: AdapterRegistry;
  resolveContract?: (name: string, docIds: DocId[]) => Promise<MemoryContract>;
}
export interface ValueProfile {
  value: string;
  present: number;
  total: number;
}
export interface SchemaDiagnostic {
  doc_id: DocId;
  hash: string;
  path: string[];
  code: string;
  message: string;
  value?: string;
  line?: number;
  line_basis?: "source_body" | "rendered_markdown";
}
export interface InspectionResult {
  mode: InspectSchemaArgs["mode"];
  sample_size: number;
  sources: CitationPacket[];
  profiles: FieldProfile[];
  body_projections?: { doc_id: DocId; line_basis: "rendered_markdown" }[];
  categories: ValueProfile[];
  relations: ValueProfile[];
  contract?: { name: string; version: string };
  candidate_only?: true;
  candidates?: SchemaField[];
  passed?: boolean;
  error_count?: number;
  warning_count?: number;
  errors?: SchemaDiagnostic[];
  warnings?: SchemaDiagnostic[];
  drift?: SchemaDrift[];
  category_drift?: { value: string; kind: "unexpected" }[];
  relation_drift?: { value: string; kind: "unexpected" }[];
}
function valueProfiles(rows: string[][]): ValueProfile[] {
  const values = [...new Set(rows.flat())].sort();
  return values.map((value) => ({
    value,
    present: rows.filter((row) => row.includes(value)).length,
    total: rows.length,
  }));
}
function jsonTypes(schema: Record<string, unknown>): string[] {
  const alternatives = (schema.anyOf ?? schema.oneOf) as Record<string, unknown>[] | undefined;
  const types = alternatives
    ? alternatives.flatMap(jsonTypes)
    : Array.isArray(schema.type)
      ? (schema.type as string[])
      : typeof schema.type === "string"
        ? [schema.type]
        : [];
  return [...new Set(types.map((type) => (type === "integer" ? "number" : type)))].sort();
}
/** Required keys come from the explicit contract, never prevalence or Zod defaults. */
function contractFields(contract: MemoryContract): SchemaField[] {
  const schema = z.toJSONSchema(contract.propertiesSchema, { io: "input" });
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties) throw new Error("unsupported_contract_schema");
  const keys = [...new Set([...Object.keys(properties), ...contract.requiredKeys])].sort();
  return keys.map((key) => ({
    key,
    types: Object.hasOwn(properties, key) ? jsonTypes(properties[key]!) : [],
    required: contract.requiredKeys.includes(key),
  }));
}
export async function inspectSchema(
  args: InspectSchemaArgs,
  deps: InspectSchemaDeps,
): Promise<InspectionResult> {
  if (!["infer", "validate", "diff"].includes(args.mode))
    throw new Error("invalid_inspection_mode");
  if (args.mode !== "infer" && !args.contract) throw new Error("contract_required");
  const ids = [...new Set(args.doc_ids)].map(parseDocId);
  const contract = args.contract
    ? await (deps.resolveContract?.(args.contract, ids) ?? getContract(args.contract))
    : undefined;
  const expected = contract ? contractFields(contract) : [];
  const samples = await Promise.all(
    ids.map(async (id) => {
      const { scheme, authority } = decomposeDocId(id);
      const source = deps.adapterRegistry.resolveSource(
        parseSourceHandle(`${scheme}://${authority}`),
      );
      const doc = await source.readDocument(id);
      const body = inspectionBody(doc.blocks);
      const properties = { ...doc.properties };
      if (scheme === "obsidian-fs") delete properties.wikilinks;
      return {
        doc,
        properties,
        line_basis: body.line_basis,
        citation: toCitationPacket(doc, displayUrlFor(id, source)),
        observations: parseObservations(body.text),
        roles: parseDomainRelations(body.text),
      };
    }),
  );
  const profiles = inferFieldProfile(samples.map((sample) => sample.properties));
  const categories = valueProfiles(
    samples.map((sample) => sample.observations.map((row) => row.category)),
  );
  const relations = valueProfiles(samples.map((sample) => sample.roles.map((row) => row.rel)));
  const result: InspectionResult = {
    mode: args.mode,
    sample_size: samples.length,
    sources: samples.map((sample) => sample.citation),
    profiles,
    categories,
    relations,
    ...(contract ? { contract: { name: contract.name, version: contract.version } } : {}),
  };
  const rendered = samples.filter((sample) => sample.line_basis === "rendered_markdown");
  if (rendered.length)
    result.body_projections = rendered.map((sample) => ({
      doc_id: sample.doc.id,
      line_basis: "rendered_markdown",
    }));
  if (args.mode === "infer") {
    result.candidate_only = true;
    result.candidates = [
      ...expected,
      ...profiles
        .filter((profile) => !expected.some((field) => field.key === profile.key))
        .map((profile) => ({ key: profile.key, types: profile.types, required: false })),
    ].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return result;
  }
  const categoryDrift = categories
    .filter(
      (row) =>
        contract!.observationCategories && !contract!.observationCategories.includes(row.value),
    )
    .map((row) => ({ value: row.value, kind: "unexpected" as const }));
  const relationDrift = relations
    .filter((row) => contract!.relationRoles && !contract!.relationRoles.includes(row.value))
    .map((row) => ({ value: row.value, kind: "unexpected" as const }));
  if (args.mode === "diff")
    return {
      ...result,
      drift: diffSchema(expected, profiles),
      category_drift: categoryDrift,
      relation_drift: relationDrift,
    };
  const errors: SchemaDiagnostic[] = [],
    warnings: SchemaDiagnostic[] = [];
  for (const sample of samples) {
    const { doc, properties } = sample;
    const diagnostic = (
      path: string[],
      code: string,
      message: string,
      extras: Partial<SchemaDiagnostic> = {},
    ): SchemaDiagnostic => ({ doc_id: doc.id, hash: doc.hash, path, code, message, ...extras });
    const missing = contract!.requiredKeys.filter(
      (key) => !Object.hasOwn(properties, key) || properties[key] === undefined,
    );
    for (const key of missing)
      errors.push(diagnostic([key], "missing_required", `Required property '${key}' is absent`));
    const parsed = contract!.propertiesSchema.safeParse(properties);
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        if (issue.path.length === 1 && missing.includes(String(issue.path[0]))) continue;
        errors.push(diagnostic(issue.path.map(String), issue.code, issue.message));
      }
    const schemaWarnings: SchemaDiagnostic[] = [];
    for (const key of Object.keys(properties).sort())
      if (!expected.some((field) => field.key === key))
        schemaWarnings.push(
          diagnostic([key], "unexpected_field", `Property '${key}' is not declared`),
        );
    for (const row of sample.observations)
      if (
        contract!.observationCategories &&
        !contract!.observationCategories.includes(row.category)
      )
        schemaWarnings.push(
          diagnostic(
            ["observations"],
            "unknown_category",
            `Category '${row.category}' is not declared`,
            { value: row.category, line: row.line_start, line_basis: sample.line_basis },
          ),
        );
    for (const row of sample.roles)
      if (contract!.relationRoles && !contract!.relationRoles.includes(row.rel))
        schemaWarnings.push(
          diagnostic(["relations"], "unknown_relation", `Role '${row.rel}' is not declared`, {
            value: row.rel,
            line: row.line,
            line_basis: sample.line_basis,
          }),
        );
    (args.strict ? errors : warnings).push(...schemaWarnings);
  }
  return {
    ...result,
    passed: errors.length === 0,
    error_count: errors.length,
    warning_count: warnings.length,
    errors,
    warnings,
  };
}
