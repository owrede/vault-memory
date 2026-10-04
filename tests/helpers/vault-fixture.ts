import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../../src/db/index.js";
import { VaultManager, type Vault } from "../../src/vault/index.js";
import { AdapterRegistry, formatDocId } from "../../src/adapters/registry.js";
import { ObsidianFsSource } from "../../src/adapters/source/obsidian-fs/index.js";
import { ObsidianFsDelivery } from "../../src/adapters/delivery/obsidian-fs/index.js";
import { provisionSink } from "../../src/adapters/delivery/obsidian-fs/sentinel.js";
import { MemorySinkRegistry } from "../../src/memory/index.js";
import { SuppressionSet } from "../../src/adapters/change-feed/obsidian-fs/suppression.js";

export async function createVaultFixture(
  options: { memorySink?: boolean; writeEnabled?: boolean } = {},
) {
  const root = await fs.mkdtemp(join(tmpdir(), "vm-feature-"));
  const vault: Vault = {
    config: { name: "lab", path: root, write_enabled: options.writeEnabled ?? true },
    db: new Database(":memory:", "lab"),
    dbPath: ":memory:",
  };
  const manager = new VaultManager();
  (manager as unknown as { vaults: Map<string, Vault> }).vaults.set("lab", vault);
  const memorySinkRegistry = new MemorySinkRegistry();
  if (options.memorySink) {
    await memorySinkRegistry.registerMemorySinks(
      [{ name: "memory", handle: "obsidian-fs://lab/_memory/", contract: "default-memory-v1" }],
      {
        resolveVaultAbsolutePath: () => root,
        provisioner: (sink, absolute) => provisionSink(sink, absolute, { version: "test" }),
      },
    );
  }
  const source = new ObsidianFsSource(vault.config);
  const delivery = new ObsidianFsDelivery(vault, "feature-test", memorySinkRegistry);
  const adapterRegistry = new AdapterRegistry();
  adapterRegistry.registerSource(source.handle, source);
  adapterRegistry.registerDelivery(delivery.handle, delivery);
  const suppression = new SuppressionSet();
  return {
    root,
    vault,
    manager,
    source,
    delivery,
    adapterRegistry,
    memorySinkRegistry,
    suppression,
    id: (resource: string) => formatDocId("obsidian-fs", "lab", resource),
    cleanup: async () => {
      vault.db.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
