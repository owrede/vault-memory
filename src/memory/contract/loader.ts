/**
 * YAML → Zod-validated → `MemoryContract` pipeline.
 *
 * The disk read is delegated to
 * `src/adapters/delivery/obsidian-fs/contract-yaml-read.ts` so this
 * module remains free of `node:fs` / `node:path` imports (ADR-002 I-2
 * confines those to the licensed adapter directory).
 *
 * Cache: contracts are cached by name on first successful load. The
 * cache key is the contract `name` (not the file path), so a contract
 * with the same name in different vaults would conflict — in Phase 2
 * this is fine because contracts are server-process global; Phase 5/6
 * may need to introduce per-vault scoping.
 *
 * Public symbols are re-exported from `./index.ts`.
 */

import { parse as parseYaml } from "yaml";
import { z, type ZodType } from "zod";
import {
  readContractYaml,
  ContractYamlNotFoundError,
} from "../../adapters/delivery/obsidian-fs/contract-yaml-read.js";
import {
  MemoryContractYamlSchema,
  type MemoryContractYaml,
  type PropertyRule,
} from "./schema.js";
import type { MemoryContract } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public errors
// ─────────────────────────────────────────────────────────────────────────────

export class MemoryContractNotFoundError extends Error {
  override readonly name = "MemoryContractNotFoundError";
}

export class MemoryContractInvalidError extends Error {
  override readonly name = "MemoryContractInvalidError";
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level cache (process lifetime)
// ─────────────────────────────────────────────────────────────────────────────

const contractCache = new Map<string, MemoryContract>();

/** Test-only: drop the cache so a `beforeEach` can re-seed contracts. */
export function __clearContractCache(): void {
  contractCache.clear();
}

/** Internal: insert a contract into the cache by name. Used by `index.ts`. */
export function __cacheContract(name: string, contract: MemoryContract): void {
  contractCache.set(name, contract);
}

/** Internal: read a contract from the cache by name. Returns `undefined`. */
export function __getCachedContract(name: string): MemoryContract | undefined {
  return contractCache.get(name);
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema builder — converts a validated MemoryContractYaml into a Zod
// schema for validating `Document.properties` payloads at write time.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a YAML `PropertyRule` to a Zod schema for a single property
 * value. The mapping is intentionally narrow — Phase 2 supports the
 * types listed in `PropertyRuleSchema` and nothing more. Future
 * contracts that need new types must extend `schema.ts` first.
 */
function ruleToZod(rule: PropertyRule): ZodType {
  let schema: ZodType;
  switch (rule.type) {
    case "string":
      schema =
        rule.min_length !== undefined
          ? z.string().min(rule.min_length)
          : z.string();
      break;
    case "datetime":
    case "date":
      schema = z.string().datetime({ offset: true });
      break;
    case "array":
      schema = z.array(z.string());
      break;
    case "reference":
    case "doc_id":
      // Reference / doc_id is structurally a string at the Zod level;
      // the validator performs DocId parsing separately when callers
      // need branded values.
      schema = z.string();
      break;
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    default:
      // The schema validator already constrained `rule.type` to the
      // enum above, so this branch is unreachable at runtime. The
      // exhaustive check helps the TypeScript compiler.
      schema = z.unknown();
      break;
  }
  if (rule.allowed && rule.allowed.length > 0) {
    // Override the base schema with an enum when allowed is present;
    // `z.enum` requires a non-empty tuple, which the YAML schema
    // does not enforce at parse time, so we guard with a length check.
    schema = z.enum(rule.allowed as [string, ...string[]]);
  }
  if (rule.nullable) {
    schema = schema.nullable();
  }
  if (rule.default !== undefined) {
    schema = schema.default(rule.default);
  }
  return schema;
}

/**
 * Build the `propertiesSchema` Zod schema from a validated YAML
 * contract. Required keys are added as required object members;
 * optional keys are wrapped in `.optional()`; cross-field rules are
 * encoded via `.superRefine()`.
 */
function buildPropertiesSchema(yaml: MemoryContractYaml): ZodType {
  const shape: Record<string, ZodType> = {};
  for (const [key, rule] of Object.entries(yaml.required_properties)) {
    shape[key] = ruleToZod(rule);
  }
  for (const [key, rule] of Object.entries(yaml.optional_properties)) {
    shape[key] = ruleToZod(rule).optional();
  }
  let obj: ZodType = z.object(shape).passthrough();

  if (yaml.cross_field_rules.length > 0) {
    obj = (obj as z.ZodObject<Record<string, ZodType>>).superRefine((data, ctx) => {
      for (const rule of yaml.cross_field_rules) {
        // Phase 2 supports a single declarative form:
        //   `<key> == '<value>'` for `when`,
        //   `<key1> && <key2>` (or single key) for `require`.
        // The default-memory-v1 contract uses this form; other forms
        // are rejected at contract-load time (see notes).
        const whenMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*==\s*'([^']+)'$/.exec(rule.when);
        if (!whenMatch) continue;
        const [, whenKey, whenValue] = whenMatch;
        if (whenKey === undefined || whenValue === undefined) continue;
        if ((data as Record<string, unknown>)[whenKey] !== whenValue) continue;
        const requiredKeys = rule.require.split(/&&|,/).map((k) => k.trim()).filter(Boolean);
        for (const key of requiredKeys) {
          const value = (data as Record<string, unknown>)[key];
          if (value === undefined || value === null || value === "") {
            ctx.addIssue({
              code: "custom",
              path: [key],
              message: `Required when ${whenKey} == '${whenValue}'`,
            });
          }
        }
      }
    });
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public loader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load a `MemoryContract` from `<vaultPath>/_contracts/memory/<name>.yaml`.
 * Cached on success; re-loading the same name returns the cached
 * instance (referential equality holds).
 *
 * Errors:
 *   - `MemoryContractNotFoundError` — file does not exist.
 *   - `MemoryContractInvalidError` — file exists but cannot be parsed
 *     or fails Zod validation. The error message includes the file
 *     path for diagnostics.
 */
export async function loadContractFromDisk(
  name: string,
  vaultPath: string,
): Promise<MemoryContract> {
  const cached = contractCache.get(name);
  if (cached) return cached;

  let yamlPath: string;
  let text: string;
  try {
    const read = await readContractYaml(vaultPath, name);
    yamlPath = read.path;
    text = read.text;
  } catch (err) {
    if (err instanceof ContractYamlNotFoundError) {
      throw new MemoryContractNotFoundError(
        `Memory contract "${name}" not found at ${err.path}`,
      );
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    throw new MemoryContractInvalidError(
      `Failed to parse YAML at ${yamlPath}: ${(err as Error).message}`,
    );
  }

  let validated: MemoryContractYaml;
  try {
    validated = MemoryContractYamlSchema.parse(parsed);
  } catch (err) {
    throw new MemoryContractInvalidError(
      `Contract at ${yamlPath} failed validation: ${(err as Error).message}`,
    );
  }

  const propertiesSchema = buildPropertiesSchema(validated);
  const contract: MemoryContract = {
    name: validated.name,
    version: validated.version,
    propertiesSchema,
    requiredKeys: Object.keys(validated.required_properties),
    naming: validated.naming,
  };
  contractCache.set(name, contract);
  // ALSO cache under the contract's declared `name` field (which may
  // differ from the file-stem `name` parameter — e.g. the shipped
  // `default-memory-v1` YAML always self-declares as
  // `default-memory-v1` regardless of the file name used to load it).
  if (validated.name !== name) {
    contractCache.set(validated.name, contract);
  }
  return contract;
}
