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
import { AliasesQueries } from "./queries/aliases.js";

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
  readonly aliases: AliasesQueries;

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
    // models must be constructed before embeddings — embeddings looks up
    // dim via models.getById() for routing to the correct embeddings_<dim>
    // virtual table.
    this.models = new ModelsQueries(this.handle);
    this.embeddings = new EmbeddingsQueries(this.handle, this.models);
    this.wikilinks = new WikilinksQueries(this.handle);
    this.audit = new AuditQueries(this.handle);
    this.fts = new FtsQueries(this.handle);
    this.aliases = new AliasesQueries(this.handle);
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

    // SQLite's recommended table-rebuild pattern (CREATE *_new, INSERT,
    // DROP, RENAME) trips foreign-key checks mid-transaction even when
    // the data itself is consistent. The official guidance is to disable
    // FKs around the migration and verify with PRAGMA foreign_key_check
    // afterwards. PRAGMA foreign_keys cannot be toggled inside an active
    // transaction, so the toggle wraps the transactional batch.
    const fkWasOn = (this.handle.pragma("foreign_keys", { simple: true }) as number) === 1;
    if (fkWasOn) this.handle.pragma("foreign_keys = OFF");

    let highest = current;
    try {
      const tx = this.handle.transaction(() => {
        for (const m of pending) {
          if ("sql" in m) {
            this.handle.exec(m.sql);
          } else {
            m.run(this.handle);
          }
          highest = m.version;
        }
      });
      tx();
      // Verify referential integrity post-migration. Any violation raises
      // a sqlite-error here; the migration is already committed, but at
      // least we know about the inconsistency.
      const violations = this.handle.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) {
        throw new Error(
          `Migration to v${highest} produced foreign-key violations: ${JSON.stringify(violations)}`,
        );
      }
      // PRAGMA cannot be bound; safe because `highest` is a number we control.
      this.handle.pragma(`user_version = ${highest}`);
    } finally {
      if (fkWasOn) this.handle.pragma("foreign_keys = ON");
    }
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
