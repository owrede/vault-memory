/**
 * Vault Manager — holds one Database per configured vault.
 *
 * Responsibilities:
 *  - Open DBs on demand under ~/.vault-memory/vaults/<name>.db
 *  - Apply migrations on first open
 *  - Provide resolved Vault objects (config + db handle) to consumers
 *  - Clean shutdown
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { Database } from "../db/index.js";
import type { VaultConfig } from "../types.js";

export interface Vault {
  readonly config: VaultConfig;
  readonly db: Database;
  readonly dbPath: string;
}

export class VaultManager {
  private readonly vaults = new Map<string, Vault>();

  static dbDirectory(): string {
    return join(homedir(), ".vault-memory", "vaults");
  }

  static dbPathFor(vaultName: string): string {
    return join(VaultManager.dbDirectory(), `${vaultName}.db`);
  }

  /**
   * Initialize all vaults from config. Creates DB files if missing, runs
   * migrations. Idempotent — safe to call multiple times.
   */
  async loadAll(configs: readonly VaultConfig[]): Promise<void> {
    await mkdir(VaultManager.dbDirectory(), { recursive: true });

    for (const cfg of configs) {
      if (this.vaults.has(cfg.name)) continue;

      const dbPath = VaultManager.dbPathFor(cfg.name);
      const db = new Database(dbPath);
      db.migrate();

      this.vaults.set(cfg.name, { config: cfg, db, dbPath });
    }
  }

  get(name: string): Vault | null {
    return this.vaults.get(name) ?? null;
  }

  /**
   * Get a vault or throw with a helpful message.
   */
  require(name: string): Vault {
    const v = this.vaults.get(name);
    if (!v) {
      const known = [...this.vaults.keys()].join(", ") || "(none)";
      throw new Error(
        `Unknown vault: "${name}". Configured vaults: ${known}`,
      );
    }
    return v;
  }

  list(): Vault[] {
    return [...this.vaults.values()];
  }

  closeAll(): void {
    for (const v of this.vaults.values()) {
      v.db.close();
    }
    this.vaults.clear();
  }
}
