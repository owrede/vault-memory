import type BetterSqlite3 from "better-sqlite3";
import { isProcessAlive } from "../../brief/lock.js";
export interface Reservation {
  sink_handle: string;
  checkpoint_key: string;
  payload_hash: string;
  owner: string;
  owner_pid: number;
  lease_until: number;
  doc_id: string | null;
  state: "pending" | "complete";
}
export class CheckpointQueries {
  constructor(private db: BetterSqlite3.Database) {}
  acquire(
    sink: string,
    key: string,
    payload: string,
    owner: string,
  ): "acquired" | "busy" | "mismatch" | "complete" {
    return this.db
      .transaction(() => {
        const row = this.db
          .prepare("SELECT * FROM checkpoint_reservations WHERE sink_handle=? AND checkpoint_key=?")
          .get(sink, key) as Reservation | undefined;
        if (row) {
          if (row.payload_hash !== payload) return "mismatch";
          if (row.state === "complete") return "complete";
          if (row.lease_until >= Date.now() || isProcessAlive(row.owner_pid)) return "busy";
        }
        this.db
          .prepare(
            "INSERT INTO checkpoint_reservations(sink_handle,checkpoint_key,payload_hash,owner,owner_pid,lease_until,state) VALUES(?,?,?,?,?,?,'pending') ON CONFLICT(sink_handle,checkpoint_key) DO UPDATE SET owner=excluded.owner,owner_pid=excluded.owner_pid,lease_until=excluded.lease_until,state='pending',doc_id=NULL",
          )
          .run(sink, key, payload, owner, process.pid, Date.now() + 300000);
        return "acquired";
      })
      .immediate();
  }
  complete(sink: string, key: string, owner: string, doc: string): void {
    if (
      this.db
        .prepare(
          "UPDATE checkpoint_reservations SET state='complete',doc_id=? WHERE sink_handle=? AND checkpoint_key=? AND owner=?",
        )
        .run(doc, sink, key, owner).changes !== 1
    )
      throw new Error("Checkpoint reservation ownership lost");
  }
  release(sink: string, key: string, owner: string): void {
    this.db
      .prepare(
        "DELETE FROM checkpoint_reservations WHERE sink_handle=? AND checkpoint_key=? AND owner=? AND state='pending'",
      )
      .run(sink, key, owner);
  }
}
