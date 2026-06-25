/**
 * Unit tests for contract-audit writers (Phase 6 / C-5 / T-06-01-03).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Database } from "../db/database.js";
import {
  recordContractStep,
  recordContractLoadError,
  aggregateVerbUsage,
  type ContractAuditDeps,
} from "./audit.js";

describe("contract-audit writers (Q-AUD, Invariant C-5)", () => {
  let db: Database;
  let deps: ContractAuditDeps;

  beforeEach(() => {
    db = new Database(":memory:");
    deps = { contractAudit: db.contractAudit };
  });

  it("Test 9: recordContractStep writes one row with kind:'contract_step' and no payload", () => {
    recordContractStep(deps, {
      contract: "meeting-prep",
      verb: "search_hybrid",
      step_alias: "related",
      vault: "my-vault",
    });
    const rows = db.contractAudit.listByKind("contract_step");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe("contract_step");
    expect(row.contract).toBe("meeting-prep");
    expect(row.verb).toBe("search_hybrid");
    expect(row.stepAlias).toBe("related");
    expect(row.vault).toBe("my-vault");
    expect(typeof row.ts).toBe("number");
    // C-5: no error_message + no payload field
    expect(row.errorMessage).toBeUndefined();
  });

  it("Test 10: recordContractLoadError writes kind:'contract_load_error' with file-prefixed error_message", () => {
    recordContractLoadError(deps, {
      file: "_contracts/bad.yaml",
      error_message: "malformed yaml at line 5",
      vault: "my-vault",
    });
    const rows = db.contractAudit.listByKind("contract_load_error");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe("contract_load_error");
    expect(row.vault).toBe("my-vault");
    expect(row.errorMessage).toBe("_contracts/bad.yaml: malformed yaml at line 5");
    expect(row.contract).toBeUndefined();
    expect(row.verb).toBeUndefined();
    expect(row.stepAlias).toBeUndefined();
  });

  it("Test 11: aggregateVerbUsage orders DESC by invocation_count", () => {
    for (let i = 0; i < 3; i++) {
      recordContractStep(deps, {
        contract: "c",
        verb: "search_hybrid",
        step_alias: "x",
        vault: "v",
      });
    }
    for (let i = 0; i < 2; i++) {
      recordContractStep(deps, {
        contract: "c",
        verb: "mcp://gh/list_issues",
        step_alias: "y",
        vault: "v",
      });
    }
    const agg = aggregateVerbUsage(deps, "v");
    expect(agg).toHaveLength(2);
    expect(agg[0]?.verb).toBe("search_hybrid");
    expect(agg[0]?.invocation_count).toBe(3);
    expect(agg[1]?.verb).toBe("mcp://gh/list_issues");
    expect(agg[1]?.invocation_count).toBe(2);
  });

  it("Test 12 (Security C-5): recordContractStep signature MUST NOT accept output/payload — strict tsc rejects, but doc-test the runtime as well", () => {
    // This is the runtime corollary of the compile-time guarantee: even
    // if a caller passes extra keys via `as any`, the rest of the system
    // never reads them back. The audit row shape is the closed
    // ContractAuditRow type.
    type DisallowedShape = Parameters<typeof recordContractStep>[1];
    // @ts-expect-error — output is NOT a valid key on the arg type (C-5).
    const _bad: DisallowedShape = {
      contract: "c",
      verb: "v",
      step_alias: "s",
      vault: "vault",
      output: "secret-PR-text-should-never-land-here",
    };
    void _bad;

    // Runtime corollary: passing extra keys via `as any` does NOT leak them.
    // The audit insert only references the documented fields.
    const bogus = {
      contract: "c",
      verb: "search_hybrid",
      step_alias: "s",
      vault: "v",
      output: "secret",
    };
    recordContractStep(deps, bogus as Parameters<typeof recordContractStep>[1]);
    const rows = db.contractAudit.listByKind("contract_step");
    // The serialized row JSON does NOT contain the 'output' field.
    expect(JSON.stringify(rows[0])).not.toContain("secret");
  });
});
