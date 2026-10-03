import type { DocId } from "../types.js";
import type { VaultManager } from "../vault/index.js";
import type { OllamaClient } from "../ollama/index.js";
import { decomposeDocId } from "../adapters/registry.js";
import { indexNote } from "../indexer/single.js";
import { safeJoinInsideVault } from "../adapters/delivery/obsidian-fs/fs.js";
export interface RefreshDeps {
  manager: VaultManager;
  ollama?: OllamaClient;
  defaultModel: string;
}
export async function refreshEditedDocument(deps: RefreshDeps, id: DocId): Promise<void> {
  const { scheme, authority, resource } = decomposeDocId(id);
  if (scheme !== "obsidian-fs") return;
  const vault = deps.manager.require(authority);
  const contextFit = vault.config.backend === "contextfit";
  const active = vault.db.models.getActive();
  try {
    const result = await indexNote({
      vault,
      absolutePath: await safeJoinInsideVault(vault.config.path, resource),
      embeddingModel: active?.name ?? vault.config.embedding_model ?? deps.defaultModel,
      secondaryEmbeddingModel: vault.config.secondary_embedding_model,
      ...(contextFit || !active ? { embeddings: "none" as const } : { ollama: deps.ollama }),
    });
    if (result.status !== "indexed" && result.status !== "unchanged") {
      throw new Error(`Index refresh: ${result.status}`);
    }
    if (contextFit) {
      const { indexVaultWithContextFit } =
        await import("../adapters/retrieval/contextfit/index.js");
      const refresh = await indexVaultWithContextFit(vault.config, {});
      if (refresh.status === "failed")
        throw new Error(refresh.error ?? "ContextFit refresh failed");
      if (refresh.status === "skipped")
        throw new Error("ContextFit refresh queued by another ingest");
    }
  } catch (error) {
    const row = vault.db.notes.getByPath(resource);
    if (row) vault.db.notes.invalidateIndex(row.id);
    throw error;
  }
}
