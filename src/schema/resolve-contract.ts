import type { DocId } from "../types.js";
import type { VaultManager } from "../vault/index.js";
import { decomposeDocId } from "../adapters/registry.js";
import {
  getContract,
  loadContractFromDisk,
  type MemoryContract,
} from "../memory/contract/index.js";
/** Use registered contracts first; disk fallback needs one explicit filesystem vault. */
export async function resolveInspectionContract(
  manager: VaultManager,
  name: string,
  ids: DocId[],
): Promise<MemoryContract> {
  try {
    return getContract(name);
  } catch {
    const scopes = ids.map(decomposeDocId);
    const authorities = new Set(scopes.map((scope) => scope.authority));
    if (
      !scopes.length ||
      authorities.size !== 1 ||
      scopes.some((scope) => scope.scheme !== "obsidian-fs")
    )
      throw new Error("contract_scope_required: unregistered contract needs one filesystem vault");
    return loadContractFromDisk(name, manager.require(scopes[0]!.authority).config.path);
  }
}
