import BetterSqlite3 from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

import { MIGRATIONS } from "./schema.js";
import { NotesQueries } from "./queries/notes.js";
import { ChunksQueries } from "./queries/chunks.js";
import { EmbeddingsQueries } from "./queries/embeddings.js";
import { WikilinksQueries } from "./queries/wikilinks.js";
import { AuditQueries } from "./queries/audit.js";
import { ModelsQueries } from "./queries/models.js";
import { FtsQueries } from "./queries/fts.js";

/**
 * SQLite wrapper for a single vault.
 *
 * One Database instance corresponds to one vault DB file (or `:memory:` for tests).
 * Construction is synchronous; the static `open()` is provided for symmetry
 * with future async hooks (e.g. migration backups) — it currently just wraps
 * the constructor + migrate().
 */
export class Database {
  readonly handle: BetterSqlite3.Database;

  readonly notes: NotesQueries;
  readonly chunks: ChunksQueries;
  readonly embeddings: EmbeddingsQueries;
  readonly wikilinks: WikilinksQueries;
  readonly audit: AuditQueries;
  readonly models: ModelsQueries;
  readonly fts: FtsQueries;

  constructor(dbPath: string) {
    this.handle = new BetterSqlite3(dbPath);
    // WAL is invalid for :memory: databases — skip it there.
    if (dbPath !== ":memory:") {
      this.handle.pragma("journal_mode = WAL");
    }
    this.handle.pragma("foreign_keys = ON");
    this.handle.pragma("synchronous = NORMAL");

    loadSqliteVec(this.handle);

    // Apply schema BEFORE preparing statements — query classes prepare against
    // tables that must already exist.
    this.migrateInternal();

    this.notes = new NotesQueries(this.handle);
    this.chunks = new ChunksQueries(this.handle);
    this.embeddings = new EmbeddingsQueries(this.handle);
    this.wikilinks = new WikilinksQueries(this.handle);
    this.audit = new AuditQueries(this.handle);
    this.models = new ModelsQueries(this.handle);
    this.fts = new FtsQueries(this.handle);
  }

  static async open(dbPath: string): Promise<Database> {
    return new Database(dbPath);
  }

  close(): void {
    this.handle.close();
  }

  getSchemaVersion(): number {
    const row = this.handle.pragma("user_version") as Array<{
      user_version: number;
    }>;
    return row[0]?.user_version ?? 0;
  }

  /**
   * Idempotent: applies pending migrations and bumps PRAGMA user_version.
   * Called automatically during construction; safe to call again.
   */
  migrate(): void {
    this.migrateInternal();
  }

  private migrateInternal(): void {
    const current = this.getSchemaVersion();
    const pending = MIGRATIONS.filter((m) => m.version > current).sort(
      (a, b) => a.version - b.version,
    );
    if (pending.length === 0) return;

    let highest = current;
    const tx = this.handle.transaction(() => {
      for (const m of pending) {
        this.handle.exec(m.sql);
        highest = m.version;
      }
    });
    tx();
    // PRAGMA cannot be bound; safe because `highest` is a number we control.
    this.handle.pragma(`user_version = ${highest}`);
  }

  transaction<T>(fn: () => T): T {
    return this.handle.transaction(fn)();
  }
}

function loadSqliteVec(db: BetterSqlite3.Database): void {
  try {
    sqliteVec.load(db);
  } catch (err) {
    const arch = process.arch;
    const platform = process.platform;
    const msg =
      `Failed to load sqlite-vec extension (platform=${platform}, arch=${arch}). ` +
      `Ensure the matching prebuilt binary (sqlite-vec-${platform}-${arch}) is installed. ` +
      `On Apple Silicon, install sqlite-vec-darwin-arm64.`;
    throw new Error(`${msg}\nOriginal: ${(err as Error).message}`);
  }
}
