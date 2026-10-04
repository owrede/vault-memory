import { expect, it } from "vitest";
import { Database } from "../database.js";
import { CheckpointQueries } from "./checkpoints.js";
it("migrates v18 without canonical index loss and replays migration idempotently", () => {
  const db = new Database(":memory:", "lab");
  try {
    db.handle.exec("DROP TABLE checkpoint_reservations; PRAGMA user_version=18;");
    const id = db.notes.upsertByPath({
      path: "Source.md",
      content: "evidence",
      frontmatter: null,
      title: "Source",
      hash: "h",
      bodyHash: "b",
      mtime: 1,
      wordCount: 1,
    }).id;
    db.migrate();
    expect(db.getSchemaVersion()).toBe(19);
    expect(db.notes.getById(id)?.hash).toBe("h");
    db.migrate();
    expect(db.getSchemaVersion()).toBe(19);
    const store = new CheckpointQueries(db.handle);
    expect(store.acquire("sink", "key", "payload", "owner")).toBe("acquired");
    expect(store.acquire("sink", "key", "payload", "other")).toBe("busy");
  } finally {
    db.close();
  }
});
it("recovers expired dead owners while refusing to steal from a living process", () => {
  const db = new Database(":memory:", "lab");
  try {
    const store = new CheckpointQueries(db.handle);
    store.acquire("sink", "key", "payload", "old");
    db.handle.prepare("UPDATE checkpoint_reservations SET lease_until=0").run();
    expect(store.acquire("sink", "key", "payload", "new")).toBe("busy");
    db.handle.prepare("UPDATE checkpoint_reservations SET owner_pid=?").run(1073741824);
    expect(store.acquire("sink", "key", "payload", "new")).toBe("acquired");
    store.release("sink", "key", "old");
    expect(store.acquire("sink", "key", "payload", "third")).toBe("busy");
    store.complete("sink", "key", "new", "doc");
    expect(store.acquire("sink", "key", "payload", "third")).toBe("complete");
    expect(store.acquire("sink", "key", "different", "third")).toBe("mismatch");
  } finally {
    db.close();
  }
});
