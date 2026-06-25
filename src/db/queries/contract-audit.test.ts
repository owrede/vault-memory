/**
 * Unit tests for ContractAuditQueries (Phase 6 / Q-AUD / Migration 014).
 *
 * Mirrors `src/db/queries/brief_sources.test.ts` (Phase 5 / D-06) for shape
 * and structure. Uses `:memory:` SQLite + `db.migrate()` per Phase 5 idiom.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Database } from "../database.js";

describe("ContractAuditQueries (Phase 6 / Q-AUD)", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  it("migration 014: contract_audit table exists with documented columns", () => {
    const cols = db.handle.prepare("PRAGMA table_info(contract_audit)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      ["id", "kind", "contract", "verb", "step_alias", "vault", "ts", "error_message"].sort(),
    );
    // kind + ts are NOT NULL
    const kind = cols.find((c) => c.name === "kind");
    const ts = cols.find((c) => c.name === "ts");
    expect(kind?.notnull).toBe(1);
    expect(ts?.notnull).toBe(1);
    // contract / verb / step_alias / vault / error_message are nullable
    const contract = cols.find((c) => c.name === "contract");
    expect(contract?.notnull).toBe(0);
  });

  it("migration 014: documented indexes exist", () => {
    const indexes = db.handle.prepare("PRAGMA index_list(contract_audit)").all() as Array<{
      name: string;
    }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_contract_audit_kind_ts");
    expect(indexNames).toContain("idx_contract_audit_verb");
  });

  it("migration 014: registered as version 14 in MIGRATIONS", async () => {
    const { MIGRATIONS } = await import("../schema.js");
    const m14 = MIGRATIONS.find((m) => m.version === 14);
    expect(m14).toBeDefined();
    expect(m14?.description).toMatch(/contract_audit/);
    // Confirm it's the head — version 14 is the highest.
    const maxVersion = Math.max(...MIGRATIONS.map((m) => m.version));
    expect(maxVersion).toBe(14);
  });

  it("migration 014 is idempotent — a second migrate() does not throw", () => {
    expect(() => db.migrate()).not.toThrow();
    // The table is still there with the same shape.
    const cols = db.handle.prepare("PRAGMA table_info(contract_audit)").all();
    expect(cols).toHaveLength(8);
  });

  it("insert: records contract_step + contract_load_error rows", () => {
    db.contractAudit.insert({
      kind: "contract_step",
      contract: "meeting-prep",
      verb: "search_hybrid",
      stepAlias: "related",
      vault: "my-vault",
      ts: 1700000000,
    });
    db.contractAudit.insert({
      kind: "contract_load_error",
      vault: "my-vault",
      ts: 1700000001,
      errorMessage: "malformed yaml at line 5",
    });

    const steps = db.contractAudit.listByKind("contract_step");
    const errors = db.contractAudit.listByKind("contract_load_error");
    expect(steps).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(steps[0]?.contract).toBe("meeting-prep");
    expect(steps[0]?.verb).toBe("search_hybrid");
    expect(steps[0]?.stepAlias).toBe("related");
    expect(steps[0]?.errorMessage).toBeUndefined();
    expect(errors[0]?.contract).toBeUndefined();
    expect(errors[0]?.verb).toBeUndefined();
    expect(errors[0]?.stepAlias).toBeUndefined();
    expect(errors[0]?.errorMessage).toBe("malformed yaml at line 5");
  });

  it("listByKind: orders by ts DESC", () => {
    db.contractAudit.insert({
      kind: "contract_step",
      contract: "a",
      verb: "v1",
      stepAlias: "s",
      vault: "v",
      ts: 100,
    });
    db.contractAudit.insert({
      kind: "contract_step",
      contract: "b",
      verb: "v2",
      stepAlias: "s",
      vault: "v",
      ts: 300,
    });
    db.contractAudit.insert({
      kind: "contract_step",
      contract: "c",
      verb: "v3",
      stepAlias: "s",
      vault: "v",
      ts: 200,
    });
    const rows = db.contractAudit.listByKind("contract_step");
    expect(rows.map((r) => r.ts)).toEqual([300, 200, 100]);
  });

  it("listByKind: filters by vault when provided", () => {
    db.contractAudit.insert({
      kind: "contract_step",
      contract: "a",
      verb: "v1",
      stepAlias: "s",
      vault: "vault-a",
      ts: 100,
    });
    db.contractAudit.insert({
      kind: "contract_step",
      contract: "b",
      verb: "v2",
      stepAlias: "s",
      vault: "vault-b",
      ts: 200,
    });
    const a = db.contractAudit.listByKind("contract_step", { vault: "vault-a" });
    const b = db.contractAudit.listByKind("contract_step", { vault: "vault-b" });
    expect(a).toHaveLength(1);
    expect(a[0]?.contract).toBe("a");
    expect(b).toHaveLength(1);
    expect(b[0]?.contract).toBe("b");
  });

  it("aggregateVerbUsage: counts and orders DESC by invocation_count", () => {
    const now = Date.now();
    // 3× search_hybrid + 2× mcp://gh/list_issues in vault 'v'
    for (let i = 0; i < 3; i++) {
      db.contractAudit.insert({
        kind: "contract_step",
        contract: "c",
        verb: "search_hybrid",
        stepAlias: "x",
        vault: "v",
        ts: now + i,
      });
    }
    for (let i = 0; i < 2; i++) {
      db.contractAudit.insert({
        kind: "contract_step",
        contract: "c",
        verb: "mcp://gh/list_issues",
        stepAlias: "y",
        vault: "v",
        ts: now + 10 + i,
      });
    }
    // One row in a different vault — must not be counted
    db.contractAudit.insert({
      kind: "contract_step",
      contract: "c",
      verb: "search_hybrid",
      stepAlias: "x",
      vault: "other",
      ts: now + 999,
    });

    const agg = db.contractAudit.aggregateVerbUsage("v");
    expect(agg).toHaveLength(2);
    expect(agg[0]?.verb).toBe("search_hybrid");
    expect(agg[0]?.invocation_count).toBe(3);
    expect(agg[0]?.last_seen).toBe(now + 2);
    expect(agg[1]?.verb).toBe("mcp://gh/list_issues");
    expect(agg[1]?.invocation_count).toBe(2);
    expect(agg[1]?.last_seen).toBe(now + 11);
  });

  it("aggregateVerbUsage: handles baseline + mcp:// verb names uniformly", () => {
    // Regression: the aggregator does not depend on verb-name format.
    const now = Date.now();
    db.contractAudit.insert({
      kind: "contract_step",
      contract: "c",
      verb: "compile_brief",
      stepAlias: "brief",
      vault: "v",
      ts: now,
    });
    db.contractAudit.insert({
      kind: "contract_step",
      contract: "c",
      verb: "mcp://gh/list_issues",
      stepAlias: "issues",
      vault: "v",
      ts: now + 1,
    });
    const agg = db.contractAudit.aggregateVerbUsage("v");
    const verbs = agg.map((r) => r.verb).sort();
    expect(verbs).toEqual(["compile_brief", "mcp://gh/list_issues"]);
  });
});
