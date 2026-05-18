import { describe, it, expect, beforeEach } from "vitest";
import { Database } from "../database.js";

describe("DaemonStateQueries (Phase 5 / D-09)", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  it("migration 013: daemon_state table exists with documented columns", () => {
    const cols = db.handle.prepare("PRAGMA table_info(daemon_state)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;
    const byName = new Map(cols.map((c) => [c.name, c] as const));
    expect(byName.get("vault_name")).toBeDefined();
    expect(byName.get("vault_name")?.pk).toBe(1); // PRIMARY KEY
    expect(byName.get("last_seen_doc_mtime")?.notnull).toBe(1);
  });

  it("getCursor returns null for a fresh vault (no row yet)", () => {
    expect(db.daemonState.getCursor("fresh-vault")).toBeNull();
  });

  it("setCursor + getCursor round-trip", () => {
    db.daemonState.setCursor("vault-a", 12345);
    expect(db.daemonState.getCursor("vault-a")).toBe(12345);
  });

  it("setCursor on existing vault upserts via ON CONFLICT", () => {
    db.daemonState.setCursor("vault-a", 12345);
    db.daemonState.setCursor("vault-a", 67890);
    expect(db.daemonState.getCursor("vault-a")).toBe(67890);

    // Only one row per vault (PRIMARY KEY invariant).
    const count = db.handle
      .prepare<[], { c: number }>(
        "SELECT COUNT(*) AS c FROM daemon_state WHERE vault_name = ?",
      )
      .get("vault-a");
    expect(count?.c).toBe(1);
  });

  it("each vault has an independent cursor", () => {
    db.daemonState.setCursor("vault-a", 100);
    db.daemonState.setCursor("vault-b", 200);
    expect(db.daemonState.getCursor("vault-a")).toBe(100);
    expect(db.daemonState.getCursor("vault-b")).toBe(200);
  });
});
