/**
 * Read a memory-contract YAML file from disk.
 *
 * The disk read lives here (under `src/adapters/delivery/obsidian-fs/`)
 * because ADR-002 I-2 confines `node:fs` to the licensed adapter
 * directories. The pure contract logic (`src/memory/contract/`) calls
 * this helper through the `loader.ts` indirection so it remains
 * filesystem-ignorant.
 *
 * Path resolution uses `joinVaultPath` from this same directory's
 * `path.ts` so the seam-preservation CI grep stays happy.
 */

import { readFile } from "node:fs/promises";
import { joinVaultPath } from "./path.js";

/** Marker error: contract YAML file does not exist at the resolved path. */
export class ContractYamlNotFoundError extends Error {
  override readonly name = "ContractYamlNotFoundError";
  constructor(
    public readonly path: string,
    message?: string,
  ) {
    super(message ?? `Contract YAML not found at ${path}`);
  }
}

/**
 * Read `<vaultPath>/_contracts/memory/<contractName>.yaml` as a UTF-8
 * string. Throws `ContractYamlNotFoundError` on ENOENT (so the caller
 * can distinguish "no file" from "file present but malformed").
 *
 * Returns both the resolved absolute path (for diagnostics) and the
 * raw text contents.
 */
export async function readContractYaml(
  vaultPath: string,
  contractName: string,
): Promise<{ path: string; text: string }> {
  const yamlPath = joinVaultPath(vaultPath, `_contracts/memory/${contractName}.yaml`);
  try {
    const text = await readFile(yamlPath, "utf-8");
    return { path: yamlPath, text };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new ContractYamlNotFoundError(yamlPath);
    }
    throw err;
  }
}
