/**
 * ModelsQueries tests — focused on Phase 7c additions:
 *   - setActive flips the active flag atomically (exactly one active row).
 *   - upsert with active:false registers a shadow model without disturbing
 *     the current primary.
 *   - getByName lookup.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "../database.js";

describe("ModelsQueries — shadow + setActive (Phase 7c)", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("setActive atomically marks exactly one model active", () => {
    const a = db.models.upsert({ name: "qwen3", provider: "ollama", dim: 1024 });
    const b = db.models.upsert({
      name: "bge-m3",
      provider: "ollama",
      dim: 1024,
      active: false,
    });
    // Initially: a is active, b is not.
    expect(db.models.getActive()?.id).toBe(a.id);

    db.models.setActive(b.id);

    const all = db.models.listAll();
    const activeRows = all.filter((m) => m.active === 1);
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0]!.id).toBe(b.id);
    expect(db.models.getActive()?.id).toBe(b.id);
  });

  it("upsert with active:false leaves the existing active model untouched", () => {
    const primary = db.models.upsert({
      name: "qwen3",
      provider: "ollama",
      dim: 1024,
    });
    const shadow = db.models.upsert({
      name: "embeddinggemma",
      provider: "ollama",
      dim: 768,
      active: false,
    });

    expect(db.models.getActive()?.id).toBe(primary.id);
    expect(shadow.active).toBe(0);
    // Re-upserting the shadow is a no-op (returns existing row).
    const again = db.models.upsert({
      name: "embeddinggemma",
      provider: "ollama",
      dim: 768,
      active: false,
    });
    expect(again.id).toBe(shadow.id);
    expect(db.models.getActive()?.id).toBe(primary.id);
  });

  it("getByName returns null for unknown models", () => {
    expect(db.models.getByName("nonexistent")).toBeNull();
    const m = db.models.upsert({ name: "qwen3", provider: "ollama", dim: 1024 });
    expect(db.models.getByName("qwen3")?.id).toBe(m.id);
  });
});
