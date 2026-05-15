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

// Phase 2: optional [memory] and [[memory_sinks]] blocks.
//
// The handle string is intentionally NOT validated against
// MEMORY_SINK_HANDLE_PATTERN here — the brand-cast (and resulting
// throw on malformed input) happens in `MemorySinkRegistry`. Keeping
// the config loader free of `src/memory/*` imports preserves the
// ADR-002 layering (config is infrastructure; memory is a domain
// module that depends on config, not the other way around).
const MemorySinkConfigSchema = z.object({
  name: z.string().min(1),
  handle: z.string().min(1),
  contract: z.string().min(1).default("default-memory-v1"),
});

const MemoryConfigSchema = z.object({
  default_sink: z.string().min(1).optional(),
});

const AppConfigSchema = z.object({
  server: ServerConfigSchema.optional().default({}),
  vaults: z.array(VaultConfigSchema).optional().default([]),
  memory: MemoryConfigSchema.optional(),
  memory_sinks: z.array(MemorySinkConfigSchema).optional().default([]),
});

const DEFAULT_CONFIG: AppConfig = {
  server: {
    log_level: "info",
    ollama_endpoint: "http://localhost:11434",
    default_embedding_model: "qwen3-embedding",
  },
  vaults: [],
  memory_sinks: [],
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
    throw new Error(`Failed to parse TOML at ${path}: ${(err as Error).message}`);
  }

  const validated = AppConfigSchema.parse(parsed);

  return {
    server: {
      ...DEFAULT_CONFIG.server,
      ...validated.server,
    },
    vaults: validated.vaults,
    memory: validated.memory,
    memory_sinks: validated.memory_sinks,
  };
}
