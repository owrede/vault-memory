import { readFile } from "node:fs/promises";
import { loadConfig } from "../../../config/index.js";
import { VaultManager } from "../../../vault/index.js";
import { AdapterRegistry, parseSourceHandle } from "../../registry.js";
import { ObsidianFsSource } from "./index.js";
import { ObsidianFsDelivery } from "../../delivery/obsidian-fs/index.js";
import { MemorySinkRegistry } from "../../../memory/registry.js";
import { discoverMemorySinks } from "../../../server.js";
import { commitImport, prepareImport } from "../../../imports/commit.js";
import { parseConversation, ImportError } from "../../../imports/conversation.js";
import { promoteConversation, PromotionSchema } from "../../../imports/promotion.js";
import type { ImportCLIArgs } from "../../../cli/import.js";
export async function runLocalImport(args: ImportCLIArgs): Promise<number> {
  const manager = new VaultManager();
  try {
    const config = await loadConfig();
    if (!config.server.features?.includes("conversation_import"))
      throw new Error("conversation_import feature is disabled");
    const payload = JSON.parse(await readFile(args.commit ?? args.input!, "utf8"));
    const conversations =
      args.command === "import" && !args.commit
        ? parseConversation(payload, args.format!)
        : undefined;
    await manager.loadAll(config.vaults);
    const registry = new AdapterRegistry(),
      sinks = new MemorySinkRegistry();
    await sinks.registerMemorySinks(
      await discoverMemorySinks(
        config.memory_sinks,
        manager.list().map((v) => ({ name: v.config.name, path: v.config.path })),
      ),
      {
        resolveVaultAbsolutePath: (name) => manager.require(name).config.path,
        defaultSinkName: config.memory?.default_sink,
        provisioner: async () => {},
      },
    );
    for (const vault of manager.list()) {
      const source = new ObsidianFsSource(vault.config),
        delivery = new ObsidianFsDelivery(vault, "vault-memory-import", sinks);
      registry.registerSource(source.handle, source);
      registry.registerDelivery(delivery.handle, delivery);
    }
    const deps = {
      manager,
      memorySinkRegistry: sinks,
      adapterRegistry: registry,
      sourceConnectorFor: (name: string) =>
        registry.resolveSource(parseSourceHandle(`obsidian-fs://${name}`)),
      deliveryAdapterFor: (name: string) =>
        registry.resolveDelivery(parseSourceHandle(`obsidian-fs://${name}`)),
    };
    const result =
      args.command === "promote-conversation"
        ? await promoteConversation(PromotionSchema.parse(payload), deps)
        : args.commit
          ? await commitImport(payload, deps)
          : await prepareImport(conversations!, args.target!, new Date().toISOString(), deps);
    process.stdout.write(JSON.stringify(result, null, args.json ? undefined : 2) + "\n");
    if ("ok" in result && !result.ok) {
      process.stderr.write(result.reason + "\n");
      return 4;
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(message + "\n");
    if (args.json) process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n");
    return error instanceof SyntaxError ||
      error instanceof ImportError ||
      (error instanceof Error && error.name === "ZodError")
      ? 2
      : 5;
  } finally {
    manager.closeAll();
  }
}
