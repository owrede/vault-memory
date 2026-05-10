import type BetterSqlite3 from "better-sqlite3";
import type { ModelRow } from "../../types.js";

export interface UpsertModelInput {
  name: string;
  provider: string;
  dim: number;
  /** When true (default), newly-inserted rows are marked active=1, matching
   *  the historical contract: the first model to index a vault is the
   *  active one. Set to false to register a shadow / secondary model
   *  without disturbing the currently-active one. Existing rows keep
   *  their active flag — upsert never flips active. */
  active?: boolean;
}

export class ModelsQueries {
  private readonly _selectByName: BetterSqlite3.Statement<[string], ModelRow>;
  private readonly _selectActive: BetterSqlite3.Statement<[], ModelRow>;
  private readonly _selectById: BetterSqlite3.Statement<[number], ModelRow>;
  private readonly _insert: BetterSqlite3.Statement;
  private readonly _deactivateAll: BetterSqlite3.Statement;
  private readonly _activate: BetterSqlite3.Statement<[number]>;
  private readonly _listAll: BetterSqlite3.Statement<[], ModelRow>;

  constructor(private readonly db: BetterSqlite3.Database) {
    this._selectByName = db.prepare<[string], ModelRow>(
      "SELECT * FROM models WHERE name = ?",
    );
    this._selectActive = db.prepare<[], ModelRow>(
      "SELECT * FROM models WHERE active = 1 ORDER BY id DESC LIMIT 1",
    );
    this._selectById = db.prepare<[number], ModelRow>(
      "SELECT * FROM models WHERE id = ?",
    );
    this._insert = db.prepare(`
      INSERT INTO models (name, provider, dim, created_at, active)
      VALUES (@name, @provider, @dim, @created_at, @active)
    `);
    this._deactivateAll = db.prepare("UPDATE models SET active = 0");
    this._activate = db.prepare<[number]>(
      "UPDATE models SET active = 1 WHERE id = ?",
    );
    this._listAll = db.prepare<[], ModelRow>(
      "SELECT * FROM models ORDER BY id",
    );
  }

  upsert(input: UpsertModelInput): ModelRow {
    const existing = this._selectByName.get(input.name);
    if (existing) return existing;
    const info = this._insert.run({
      name: input.name,
      provider: input.provider,
      dim: input.dim,
      created_at: Date.now(),
      active: input.active === false ? 0 : 1,
    });
    const row = this._selectById.get(Number(info.lastInsertRowid));
    if (!row) {
      throw new Error("models.upsert: row vanished after insert");
    }
    return row;
  }

  getById(modelId: number): ModelRow | null {
    return this._selectById.get(modelId) ?? null;
  }

  getByName(name: string): ModelRow | null {
    return this._selectByName.get(name) ?? null;
  }

  getActive(): ModelRow | null {
    return this._selectActive.get() ?? null;
  }

  setActive(modelId: number): void {
    const tx = this.db.transaction(() => {
      this._deactivateAll.run();
      this._activate.run(modelId);
    });
    tx();
  }

  listAll(): ModelRow[] {
    return this._listAll.all();
  }
}
