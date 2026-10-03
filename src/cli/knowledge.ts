import { timestampMillis } from "../memory/valid-time.js";
export interface KnowledgeArgs {
  command: "search" | "read" | "edit" | "man";
  vault?: string;
  query?: string;
  doc_id?: string;
  expected_hash?: string;
  json: boolean;
  patch_file?: string;
  topic?: string;
  projection?: "full" | "metadata" | "sections";
  as_of?: string;
}
export function parseKnowledgeArgs(args: string[]): KnowledgeArgs {
  const command = args[0];
  if (!command || !["search", "read", "edit", "man"].includes(command))
    throw new Error("Unknown knowledge command");
  const result: KnowledgeArgs = { command: command as KnowledgeArgs["command"], json: false };
  const flags: Record<string, string> = {
    "--vault": "vault",
    "--query": "query",
    "--doc-id": "doc_id",
    "--expected-hash": "expected_hash",
    "--patch-file": "patch_file",
    "--projection": "projection",
    "--as-of": "as_of",
  };
  const allowed: Record<string, string[]> = {
    search: ["vault", "query", "as_of"],
    read: ["doc_id", "projection", "as_of"],
    edit: ["doc_id", "expected_hash", "patch_file"],
    man: [],
  };
  const seen = new Set<string>();
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") {
      if (seen.has(arg)) throw new Error("Duplicate --json");
      seen.add(arg);
      result.json = true;
      continue;
    }
    if (command === "man" && !arg.startsWith("-") && !result.topic) {
      result.topic = arg;
      continue;
    }
    const key = flags[arg];
    if (!key || !allowed[command]!.includes(key) || seen.has(arg))
      throw new Error(`Invalid flag ${arg}`);
    seen.add(arg);
    const value = args[++i];
    if (!value || value.startsWith("--") || value === "-")
      throw new Error(`Missing value for ${arg}; stdin is not supported`);
    (result as unknown as Record<string, unknown>)[key] = value;
  }
  const required =
    command === "search"
      ? ["query"]
      : command === "edit"
        ? ["doc_id", "expected_hash", "patch_file"]
        : command === "read"
          ? ["doc_id"]
          : ["topic"];
  for (const key of required)
    if (!(result as unknown as Record<string, unknown>)[key])
      throw new Error(`Missing --${key.replaceAll("_", "-")}`);
  if (result.projection && !["full", "metadata"].includes(result.projection))
    throw new Error("--projection supports full or metadata");
  if (result.as_of && timestampMillis(result.as_of) === null) throw new Error("invalid --as-of");
  return result;
}

export interface KnowledgeDeps {
  search: (args: KnowledgeArgs) => Promise<unknown>;
  read: (args: KnowledgeArgs) => Promise<unknown>;
  edit: (args: KnowledgeArgs, patch: unknown) => Promise<{ ok: boolean; reason?: string }>;
  readPatchFile: (path: string) => Promise<string>;
  manual: (topic: string) => unknown;
}
export async function runKnowledgeCommand(
  args: KnowledgeArgs,
  deps: KnowledgeDeps,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
): Promise<number> {
  try {
    let result: unknown;
    if (args.command === "man") result = deps.manual(args.topic!);
    else if (args.command === "read") result = await deps.read(args);
    else if (args.command === "search") result = await deps.search(args);
    else {
      let patch: unknown;
      try {
        patch = JSON.parse(await deps.readPatchFile(args.patch_file!));
      } catch (error) {
        io.stderr(`Invalid patch file: ${String(error)}\n`);
        if (args.json) io.stdout(JSON.stringify({ ok: false, reason: "invalid_patch" }) + "\n");
        return 2;
      }
      result = await deps.edit(args, patch);
    }
    io.stdout(
      (args.json
        ? JSON.stringify(result)
        : typeof result === "string"
          ? result
          : JSON.stringify(result, null, 2)) + "\n",
    );
    const status = result as { ok?: boolean; reason?: string };
    if (status?.ok === false) {
      io.stderr(`${status.reason ?? "conflict"}\n`);
      return status.reason === "not_found" ? 3 : status.reason === "invalid_patch" ? 2 : 4;
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missing = message.includes("doc_not_found") || message.includes("Unknown manual topic");
    const invalid =
      message.includes("invalid as_of") ||
      message.includes("invalid_validity") ||
      message.includes("Invalid DocId");
    const code = missing ? 3 : invalid ? 2 : 5;
    io.stderr(message + "\n");
    if (args.json) io.stdout(JSON.stringify({ ok: false, error: message }) + "\n");
    return code;
  }
}
