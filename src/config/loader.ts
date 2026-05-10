/**
 * Configuration loader.
 *
 * Reads `~/.vault-memory/config.toml`. Returns sensible defaults when the
 * file does not exist (empty vault list, default Ollama endpoint). Validates
 * shape with Zod.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import type { AppConfig } from "../types.js";

const ServerConfigSchema = z.object({
  log_level: z.enum(["debug", "info", "warn", "error"]).optional(),
  ollama_endpoint: z.string().url().optional(),
  default_embedding_model: z.string().optional(),
  reranker_model: z.string().optional(),
  reranker_backend: z.enum(["onnx", "ollama"]).optional(),
  reranker_model_dir: z.string().optional(),
});

const VaultConfigSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  embedding_model: z.string().optional(),
  secondary_embedding_model: z.string().optional(),
  write_enabled: z.boolean().optional(),
  exclude_globs: z.array(z.string()).optional(),
});

const AppConfigSchema = z.object({
  server: ServerConfigSchema.optional().default({}),
  vaults: z.array(VaultConfigSchema).optional().default([]),
});

const DEFAULT_CONFIG: AppConfig = {
  server: {
    log_level: "info",
    ollama_endpoint: "http://localhost:11434",
    default_embedding_model: "qwen3-embedding",
  },
  vaults: [],
};

export function configPath(): string {
  return join(homedir(), ".vault-memory", "config.toml");
}

export async function loadConfig(path: string = configPath()): Promise<AppConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return DEFAULT_CONFIG;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = parseToml(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse TOML at ${path}: ${(err as Error).message}`,
    );
  }

  const validated = AppConfigSchema.parse(parsed);

  return {
    server: {
      ...DEFAULT_CONFIG.server,
      ...validated.server,
    },
    vaults: validated.vaults,
  };
}
