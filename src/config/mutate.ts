/**
 * Config-file mutation helpers — the canonical TOML read/write site.
 *
 * `src/config/` is the single seam-licensed entry point for
 * `~/.vault-memory/config.toml` reads and writes (ADR-002 §I-2 + §I-6
 * allow-list `src/config/`). Plugin tools and other callers that need
 * to mutate config.toml route through these helpers instead of
 * importing `node:fs/promises` directly — keeps the I-2 invariant clean
 * without expanding the allow-list to every new src/ subdirectory.
 *
 * Round-trip preserves field types (TOML strings stay strings, booleans
 * stay booleans, integers stay integers). Comments and blank lines are
 * NOT preserved — documented in the ADR-007 threat model under "TOML
 * round-trip side effects".
 */

import { readFile, writeFile } from "node:fs/promises";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

/**
 * Read and parse a TOML config file. Returns `{}` if the file does not
 * exist (ENOENT) — convenient for callers that want to write a fresh
 * file without a pre-existence check.
 */
export async function readConfigToml(configPath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(configPath, "utf-8");
    return parseToml(raw) as Record<string, unknown>;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return {};
    throw err;
  }
}

/** Serialize and write a TOML config root. */
export async function writeConfigToml(
  configPath: string,
  root: Record<string, unknown>,
): Promise<void> {
  await writeFile(configPath, stringifyToml(root), "utf-8");
}
