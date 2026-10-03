import { readFile } from "node:fs/promises";
import { loadConfig } from "../../../config/index.js";
import { VaultManager } from "../../../vault/index.js";
import { AdapterRegistry, parseSourceHandle } from "../../registry.js";
import { ObsidianFsSource } from "./index.js";
import { ObsidianFsDelivery } from "../../delivery/obsidian-fs/index.js";
import { MemorySinkRegistry } from "../../../memory/registry.js";
import { discoverMemorySinks } from "../../../server.js";
import { startSession, recordCheckpoint } from "../../../session/lifecycle.js";
import { CheckpointSchema, parseSessionEvent } from "../../../session/hooks.js";
import type { SessionCLIArgs } from "../../../cli/session.js";
export async function runLocalSession(args: SessionCLIArgs): Promise<number> {
  const manager = new VaultManager();
  try {
    const config = await loadConfig();
    if (!config.server.features?.includes("session_lifecycle"))
      throw new Error("session_lifecycle feature is disabled");
    let event;
    if (args.command === "hook")
      event = parseSessionEvent(JSON.parse(await readFile(args.input!, "utf8")));
    else if (args.command === "checkpoint")
      event = {
        event: "session_checkpoint" as const,
        input: CheckpointSchema.parse(JSON.parse(await readFile(args.input!, "utf8"))),
      };
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
        delivery = new ObsidianFsDelivery(vault, "vault-memory-session", sinks);
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
    let result;
    if (event?.event === "session_checkpoint") result = await recordCheckpoint(event.input, deps);
    else {
      const vault =
        args.vault ?? (manager.list().length === 1 ? manager.list()[0]!.config.name : undefined);
      if (!event && !vault) throw new Error("Specify --vault for multiple configured vaults");
      result = await startSession(
        event?.input ?? {
          vault: vault!,
          topic: args.topic!,
          sink: args.sink,
          max_chars: args.max_chars,
          as_of: args.as_of,
        },
        deps,
      );
    }
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
    return error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")
      ? 2
      : 5;
  } finally {
    manager.closeAll();
  }
}
