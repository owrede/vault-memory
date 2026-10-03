import { readFile } from "node:fs/promises";
import { loadConfig } from "../../../config/index.js";
import { VaultManager } from "../../../vault/index.js";
import { AdapterRegistry, decomposeDocId, parseDocId, parseSourceHandle } from "../../registry.js";
import { ObsidianFsSource } from "./index.js";
import { ObsidianFsDelivery } from "../../delivery/obsidian-fs/index.js";
import { setupMemorySinks } from "../../../server.js";
import { OllamaClient } from "../../../ollama/index.js";
import { hybridSearch } from "../../../search/hybrid.js";
import { inspectionBody } from "../../../schema/body.js";
import { documentContext, takeContext } from "../../../assembly/selection.js";
import { displayUrlFor, toCitationPacket } from "../../../memory/citation-packet.js";
import { applyDocumentPatch } from "../../../edit/apply.js";
import { FEATURE_TOOLS } from "../../../server/feature-tools.js";
import { manualTopic } from "../../../manual/catalog.js";
import { runKnowledgeCommand, type KnowledgeArgs } from "../../../cli/knowledge.js";
import { refreshEditedDocument } from "../../../edit/refresh.js";
import {
  resolveAsOf,
  parseValidity,
  isValidAt,
  InvalidValidityError,
} from "../../../memory/valid-time.js";
export async function runLocalKnowledge(args: KnowledgeArgs): Promise<number> {
  const io = {
    stdout: (s: string) => process.stdout.write(s),
    stderr: (s: string) => process.stderr.write(s),
  };
  if (args.command === "man")
    return runKnowledgeCommand(args, { manual: manualTopic } as never, io);
  const config = await loadConfig();
  const manager = new VaultManager();
  try {
    await manager.loadAll(config.vaults);
    const sinks = await setupMemorySinks(config, manager);
    const registry = new AdapterRegistry();
    for (const vault of manager.list()) {
      const source = new ObsidianFsSource(vault.config);
      const delivery = new ObsidianFsDelivery(vault, "vault-memory-cli", sinks);
      registry.registerSource(source.handle, source);
      registry.registerDelivery(delivery.handle, delivery);
    }
    const sourceFor = (id: string) => {
      const parsed = parseDocId(id);
      const d = decomposeDocId(parsed);
      return {
        id: parsed,
        source: registry.resolveSource(parseSourceHandle(`${d.scheme}://${d.authority}`)),
      };
    };
    return await runKnowledgeCommand(
      args,
      {
        manual: manualTopic,
        readPatchFile: (path) => readFile(path, "utf8"),
        search: async (input) => {
          const vaults = input.vault ? [manager.require(input.vault)] : manager.list();
          const results = await hybridSearch({
            query: input.query!,
            vaults,
            embeddingModel: config.server.default_embedding_model ?? "qwen3-embedding:0.6b",
            ollama: new OllamaClient({ endpoint: config.server.ollama_endpoint }),
            asOf: input.as_of,
          });
          return { results, count: results.length };
        },
        read: async (input) => {
          const { id, source } = sourceFor(input.doc_id!);
          if (!(await source.exists(id))) throw new Error("doc_not_found");
          const doc = await source.readDocument(id);
          const url = displayUrlFor(id, source);
          const bounds = parseValidity(doc.properties);
          if (!bounds.ok) throw new InvalidValidityError(bounds.key, id);
          const asOf = resolveAsOf(input.as_of);
          const packet = toCitationPacket(doc, url);
          const context = documentContext(doc, url, {
            projection: input.projection ?? "full",
            max_chars: 6000,
          })!;
          if (context.projection === "full") {
            const body = inspectionBody(doc.blocks);
            const excerpt = takeContext(context, body.text);
            context.slices.push({
              ...packet,
              ...excerpt,
              start_offset: 0,
              end_offset: excerpt.text.length,
              line_start: 1,
              line_end: excerpt.text.split("\n").length,
            });
          }
          return {
            ...packet,
            context,
            ...(input.as_of || Object.keys(bounds.validity).length
              ? {
                  as_of: asOf,
                  validity: bounds.validity,
                  valid_at: isValidAt(bounds.validity, asOf),
                }
              : {}),
          };
        },
        edit: async (input, patch) => {
          if (!config.server.features?.includes("document_edit"))
            throw new Error("document_edit feature is disabled");
          const parsed = FEATURE_TOOLS.document_edit.schema.safeParse({
            doc_id: input.doc_id,
            expected_hash: input.expected_hash,
            patch,
          });
          if (!parsed.success) return { ok: false, reason: "invalid_patch" };
          const { id, source } = sourceFor(input.doc_id!);
          const d = decomposeDocId(id);
          const result = await applyDocumentPatch(
            { source, delivery: registry.resolveDelivery(source.handle) },
            { ...parsed.data, doc_id: id },
          );
          if (result.ok && result.newHash !== input.expected_hash) {
            try {
              await refreshEditedDocument(
                {
                  manager,
                  defaultModel: config.server.default_embedding_model ?? "qwen3-embedding:0.6b",
                },
                id,
              );
            } catch (error) {
              return { ...result, index_refresh: "pending", warning: String(error) };
            }
          }
          return result;
        },
      },
      io,
    );
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    if (args.json) io.stdout(JSON.stringify({ ok: false, error: String(error) }) + "\n");
    return 5;
  } finally {
    manager.closeAll();
  }
}
