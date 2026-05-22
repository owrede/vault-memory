/**
 * Tests for the contract MCP Resources — Plan 06-04 Task 3
 * (CON-04 + D-A2b). Fills the Plan 06-01 Wave-0 stub.
 *
 * The handlers are pure functions over `ContractRegistry` +
 * `ContractAuditQueries`. Tests use real `:memory:` SQLite for
 * contractAudit so the listByKind / aggregateVerbUsage queries are
 * exercised end-to-end.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Database } from "../db/database.js";
import { ContractRegistry } from "./registry.js";
import { buildInputSchema } from "./input-schema.js";
import { readListContracts, readListContractVerbs, BASELINE_VERBS } from "./resources.js";
import type { ParsedContract } from "./types.js";

function makeContract(opts: {
  name: string;
  description?: string;
  sources?: Record<string, { handle: string; required: boolean }>;
  sinks?: Record<string, { handle: string; required: boolean }>;
  write_back?: boolean;
}): ParsedContract {
  const inputs = {};
  const required: string[] = [];
  const built = buildInputSchema(inputs, required);
  return {
    version: 1,
    name: opts.name,
    description: opts.description ?? "",
    inputs,
    required,
    sources: opts.sources ?? {},
    sinks: opts.sinks ?? {},
    assembly: [{ as: "step1", verb: "literal", value: "x" }],
    inputZodSchema: built.zodSchema,
    inputJsonSchema: built.jsonSchema,
    ...(opts.write_back
      ? {
          write_back: {
            sink: "{{default_sink}}",
            document_kind: "brief" as const,
            properties: {},
            body_from: "x",
          },
        }
      : {}),
  };
}

describe("readListContracts (CON-04)", () => {
  it("Test 1 (shape): returns total + per-contract entry shape", () => {
    const reg = new ContractRegistry();
    reg.set(
      "c1",
      makeContract({
        name: "c1",
        description: "first",
        sources: { default_source: { handle: "obsidian-fs://v", required: true } },
        sinks: { default_sink: { handle: "_memory/_briefs", required: true } },
        write_back: true,
      }),
    );
    reg.set(
      "c2",
      makeContract({
        name: "c2",
        description: "second",
      }),
    );

    const result = readListContracts({ registry: reg, vaultName: "v" });

    expect(result.total).toBe(2);
    expect(result.contracts).toHaveLength(2);
    const c1 = result.contracts.find((c) => c.name === "c1")!;
    expect(c1).toEqual({
      name: "c1",
      description: "first",
      vault: "v",
      source_count: 1,
      sink_count: 1,
      write_back: true,
    });
    const c2 = result.contracts.find((c) => c.name === "c2")!;
    expect(c2.write_back).toBe(false);
    expect(c2.source_count).toBe(0);
    expect(c2.sink_count).toBe(0);
  });

  it("Test 2 (source filter): filters by source-handle prefix", () => {
    const reg = new ContractRegistry();
    reg.set(
      "obsi-contract",
      makeContract({
        name: "obsi-contract",
        sources: { default_source: { handle: "obsidian-fs://v", required: true } },
      }),
    );
    reg.set(
      "notion-contract",
      makeContract({
        name: "notion-contract",
        sources: { default_source: { handle: "notion-api://workspace", required: true } },
      }),
    );

    const obsiOnly = readListContracts(
      { registry: reg, vaultName: "v" },
      { source: "obsidian-fs://" },
    );
    expect(obsiOnly.total).toBe(1);
    expect(obsiOnly.contracts[0]?.name).toBe("obsi-contract");
  });

  it("Test 3 (empty registry): returns total=0 + empty list", () => {
    const reg = new ContractRegistry();
    const result = readListContracts({ registry: reg, vaultName: "v" });
    expect(result.total).toBe(0);
    expect(result.contracts).toEqual([]);
  });
});

describe("readListContractVerbs (D-A2b)", () => {
  let db: Database;
  beforeEach(() => {
    db = new Database(":memory:");
  });

  it("Test 4 (baseline section): returns the 11 baseline verbs", () => {
    const result = readListContractVerbs({
      contractAudit: db.contractAudit,
      vaultName: "v",
    });
    expect(result.baseline).toEqual(BASELINE_VERBS);
    expect(result.baseline).toHaveLength(11);
    expect(result.baseline).toContain("search_hybrid");
    expect(result.baseline).toContain("read_note");
    // `literal` is NOT in baseline (it's an escape-hatch, not a verb).
    expect(result.baseline).not.toContain("literal");
  });

  it("Test 5 (empty custom): returns empty custom list when no mcp:// usage", () => {
    // Seed a baseline-verb row only — should NOT appear in custom.
    db.contractAudit.insert({
      kind: "contract_step",
      contract: "c1",
      verb: "search_hybrid",
      stepAlias: "s1",
      vault: "v",
      ts: 1000,
    });
    const result = readListContractVerbs({
      contractAudit: db.contractAudit,
      vaultName: "v",
    });
    expect(result.custom).toEqual([]);
  });

  it("Test 6 (custom usage): aggregates mcp:// invocations with counts + last_seen", () => {
    // Seed 3 rows for mcp://gh/list_issues across two contracts.
    db.contractAudit.insert({
      kind: "contract_step",
      contract: "c1",
      verb: "mcp://gh/list_issues",
      stepAlias: "s1",
      vault: "v",
      ts: 100,
    });
    db.contractAudit.insert({
      kind: "contract_step",
      contract: "c1",
      verb: "mcp://gh/list_issues",
      stepAlias: "s2",
      vault: "v",
      ts: 200,
    });
    db.contractAudit.insert({
      kind: "contract_step",
      contract: "c2",
      verb: "mcp://gh/list_issues",
      stepAlias: "s3",
      vault: "v",
      ts: 300,
    });
    // Add a baseline row that must be excluded from custom.
    db.contractAudit.insert({
      kind: "contract_step",
      contract: "c1",
      verb: "search_hybrid",
      stepAlias: "s4",
      vault: "v",
      ts: 400,
    });

    const result = readListContractVerbs({
      contractAudit: db.contractAudit,
      vaultName: "v",
    });
    expect(result.custom).toHaveLength(1);
    const entry = result.custom[0]!;
    expect(entry.verb).toBe("mcp://gh/list_issues");
    expect(entry.declared_in).toBe("[contracts.mcp_clients.gh]");
    expect(entry.invocation_count).toBe(3);
    expect(entry.last_seen).toBe(300);
    expect(entry.used_by_contracts.sort()).toEqual(["c1", "c2"]);
  });

  it("Test 7 (vault-scoped): rows from other vaults don't leak", () => {
    db.contractAudit.insert({
      kind: "contract_step",
      contract: "c1",
      verb: "mcp://gh/list_issues",
      stepAlias: "s1",
      vault: "v1",
      ts: 100,
    });
    db.contractAudit.insert({
      kind: "contract_step",
      contract: "c2",
      verb: "mcp://gh/list_issues",
      stepAlias: "s2",
      vault: "v2",
      ts: 200,
    });
    const v1 = readListContractVerbs({
      contractAudit: db.contractAudit,
      vaultName: "v1",
    });
    expect(v1.custom).toHaveLength(1);
    expect(v1.custom[0]?.invocation_count).toBe(1);
    expect(v1.custom[0]?.used_by_contracts).toEqual(["c1"]);
  });
});
