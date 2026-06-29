/**
 * ContextFit CLI wrapper — the pinned subprocess contract (ADR-008).
 *
 * ContextFit (https://github.com/ContextFit/cf) is a Python, CPU-only,
 * token-native retrieval engine. vault-memory is Node/ESM, so we integrate
 * out-of-process by spawning the `contextfit` binary — no daemon, no shell.
 *
 * This module is the SOLE place that knows ContextFit's CLI flags and
 * `--json` output shape. The `parseQueryOutput` contract is asserted by
 * `cli.contract.test.ts` so an upstream change fails loudly rather than
 * silently mis-parsing.
 *
 * # Adapter-seam carve-out (ADR-002)
 * - `child_process` + raw path handling are ALLOWED inside this directory
 *   (same class as `src/contracts/mcp-clients.ts` peer-MCP spawning). The
 *   rest of the codebase reaches ContextFit only through `ContextFitBackend`.
 *
 * # CLI contract (contextfit 0.1.0, pinned)
 *   contextfit --kb <dir> ingest <source> --rebuild-index-after-ingest
 *   contextfit --kb <dir> query "<text>" --top-k <n> --method <m> --json
 *   contextfit --kb <dir> stats
 */

// cross-spawn (not node:child_process) — its spawn wrapper handles the fd /
// argument edge cases that make raw `spawn` throw `EBADF` when vault-memory
// runs as an MCP **stdio server** (the SDK transport holds the parent's
// stdio fds). This is the same library the MCP SDK itself spawns through.
import spawn from "cross-spawn";

/** A single retrieved chunk from `contextfit query --json` → `chunks[]`. */
export interface ContextFitChunk {
  rank: number;
  chunk_id: number;
  score: number;
  level: number;
  parent_id: number | null;
  token_count: number;
  semantic_id?: number[];
  /** `metadata.source` is the ABSOLUTE filesystem path ContextFit ingested. */
  metadata: { source?: string } & Record<string, unknown>;
  /** Decoded chunk text preview — used as the SearchHit chunkText. */
  preview: string;
  tokens?: number[];
}

/** Parsed shape of `contextfit query --json` (only the fields we consume). */
export interface ContextFitQueryResult {
  query: string;
  method: string;
  retrieved_chunks: number;
  chunks: ContextFitChunk[];
}

export type ContextFitMethod = "exact" | "bm25" | "sid" | "graph" | "hierarchy" | "hybrid";

export interface ContextFitCliConfig {
  /** The `contextfit` executable (bare name on PATH, or absolute path). */
  command: string;
  /** Knowledge-base / index directory passed via `--kb`. Per-vault. */
  kbPath: string;
  /** Tokenizer (default cl100k_base). Passed via `--tokenizer`. */
  tokenizer?: string;
  /** Spawn timeout per call (ms). Default 120_000 for ingest, callers override. */
  timeoutMs?: number;
}

export class ContextFitError extends Error {
  override readonly name = "ContextFitError";
  constructor(
    message: string,
    readonly code: "ENOENT" | "NONZERO_EXIT" | "BAD_JSON" | "TIMEOUT" = "NONZERO_EXIT",
  ) {
    super(message);
  }
}

interface RunResult {
  stdout: string;
  stderr: string;
}

/**
 * Spawn `contextfit` with the given args (no shell). Resolves with stdout on
 * exit code 0; rejects with a typed ContextFitError otherwise. `--kb` and
 * `--tokenizer` are global flags and must precede the subcommand.
 */
function runContextFit(
  cfg: ContextFitCliConfig,
  subcommandArgs: string[],
  timeoutMs: number,
): Promise<RunResult> {
  const globalArgs = ["--kb", cfg.kbPath];
  if (cfg.tokenizer) globalArgs.push("--tokenizer", cfg.tokenizer);
  const args = [...globalArgs, ...subcommandArgs];

  return new Promise((resolve, reject) => {
    // Pipe all three streams (via cross-spawn) and close stdin — contextfit
    // reads none. cross-spawn avoids the `spawn EBADF` the raw node spawn hits
    // under the MCP stdio server's fd state.
    let child;
    try {
      child = spawn(cfg.command, args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      // `spawn` can throw SYNCHRONOUSLY (e.g. EBADF under heavy fd pressure
      // when many vault watchers are live). Surface a typed error; the caller
      // (runContextFitWithRetry) retries transient EBADF.
      const e = err as NodeJS.ErrnoException;
      reject(
        new ContextFitError(
          `contextfit spawn failed: ${e.message}`,
          e.code === "ENOENT" ? "ENOENT" : "NONZERO_EXIT",
        ),
      );
      return;
    }
    child.stdin?.end();
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new ContextFitError(`contextfit timed out after ${timeoutMs}ms`, "TIMEOUT"));
    }, timeoutMs);

    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(
          new ContextFitError(
            `contextfit not found (tried '${cfg.command}'). Install it with ` +
              `\`pipx install contextfit\` (or pip), or set the command path.`,
            "ENOENT",
          ),
        );
      } else {
        reject(new ContextFitError(`contextfit spawn failed: ${err.message}`));
      }
    });
    child.on("close", (codeNum: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (codeNum === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new ContextFitError(
            `contextfit exited ${codeNum}: ${stderr.trim() || stdout.trim() || "(no output)"}`,
            "NONZERO_EXIT",
          ),
        );
      }
    });
  });
}

/**
 * Run `contextfit` with one retry on a transient EBADF. `uv_spawn` can fail
 * with EBADF when the process is under heavy file-descriptor pressure (e.g.
 * many chokidar vault watchers churning the fd table at the moment of spawn);
 * the condition is transient, so a short-delayed retry usually succeeds. Other
 * errors (ENOENT, non-zero exit, bad JSON) are NOT retried.
 */
async function runContextFitWithRetry(
  cfg: ContextFitCliConfig,
  subcommandArgs: string[],
  timeoutMs: number,
): Promise<RunResult> {
  try {
    return await runContextFit(cfg, subcommandArgs, timeoutMs);
  } catch (err) {
    const isEbadf = err instanceof ContextFitError && /EBADF/.test(err.message);
    if (!isEbadf) throw err;
    await new Promise((r) => setTimeout(r, 50));
    return runContextFit(cfg, subcommandArgs, timeoutMs);
  }
}

/**
 * `contextfit ingest <source>` — (re)build the KB from a directory of files.
 * `--rebuild-index-after-ingest` ensures the BM25/SID indexes are queryable
 * immediately. Returns ContextFit's stdout (human-readable stats) for logging.
 */
export async function contextFitIngest(
  cfg: ContextFitCliConfig,
  source: string,
  opts: { chunkSize?: number; overlap?: number } = {},
): Promise<string> {
  const args = ["ingest", source, "--rebuild-index-after-ingest"];
  if (opts.chunkSize !== undefined) args.push("--chunk-size", String(opts.chunkSize));
  if (opts.overlap !== undefined) args.push("--overlap", String(opts.overlap));
  const { stdout } = await runContextFitWithRetry(cfg, args, cfg.timeoutMs ?? 600_000);
  return stdout;
}

/**
 * `contextfit query "<text>" --json` — retrieve top-k chunks. Parses the
 * `chunks[]` array out of the JSON envelope. ContextFit prints a non-JSON
 * "Loading LSH from disk..." preamble to stdout before the JSON object, so we
 * slice from the first `{` to be robust.
 */
export async function contextFitQuery(
  cfg: ContextFitCliConfig,
  query: string,
  opts: { topK?: number; method?: ContextFitMethod } = {},
): Promise<ContextFitQueryResult> {
  const args = ["query", query, "--json"];
  if (opts.topK !== undefined) args.push("--top-k", String(opts.topK));
  if (opts.method !== undefined) args.push("--method", opts.method);
  const { stdout } = await runContextFitWithRetry(cfg, args, cfg.timeoutMs ?? 30_000);
  return parseQueryOutput(stdout);
}

/**
 * Parse the JSON object out of `contextfit query --json` stdout. Tolerates a
 * non-JSON preamble (e.g. "Loading LSH from disk...") by slicing from the
 * first `{`. Throws ContextFitError("BAD_JSON") on a malformed/empty result.
 * Exported for the contract test.
 */
export function parseQueryOutput(stdout: string): ContextFitQueryResult {
  const start = stdout.indexOf("{");
  if (start === -1) {
    throw new ContextFitError(
      `contextfit query produced no JSON: ${stdout.slice(0, 200)}`,
      "BAD_JSON",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ContextFitError(`contextfit query JSON parse failed: ${msg}`, "BAD_JSON");
  }
  const obj = parsed as Partial<ContextFitQueryResult>;
  if (!Array.isArray(obj.chunks)) {
    throw new ContextFitError(
      `contextfit query JSON missing 'chunks' array (got keys: ${Object.keys(obj ?? {}).join(", ")})`,
      "BAD_JSON",
    );
  }
  return {
    query: typeof obj.query === "string" ? obj.query : "",
    method: typeof obj.method === "string" ? obj.method : "hybrid",
    retrieved_chunks:
      typeof obj.retrieved_chunks === "number" ? obj.retrieved_chunks : obj.chunks.length,
    chunks: obj.chunks as ContextFitChunk[],
  };
}

/** Probe: is the `contextfit` binary runnable? Returns version string or null. */
export async function contextFitProbe(cfg: Pick<ContextFitCliConfig, "command">): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      // All-piped (not "ignore") to avoid `spawn EBADF` under the MCP stdio
      // server's fd state — same rationale as runContextFit above.
      const child = spawn(cfg.command, ["--help"], { stdio: ["pipe", "pipe", "pipe"] });
      child.stdin?.end();
      child.on("error", reject);
      child.on("close", (c: number | null) =>
        c === 0 ? resolve() : reject(new Error(`exit ${c}`)),
      );
    });
    return true;
  } catch {
    return false;
  }
}
