import { SessionStartSchema } from "../session/hooks.js";
export type SessionCLIArgs = {
  command: "start" | "checkpoint" | "hook";
  json: boolean;
  input?: string;
  vault?: string;
  topic?: string;
  sink?: string;
  max_chars?: number;
  as_of?: string;
};
export function parseSessionArgs(args: string[]): SessionCLIArgs {
  const command = args[1];
  if (!["start", "checkpoint", "hook"].includes(command ?? ""))
    throw new Error("Expected session start|checkpoint|hook");
  const result: SessionCLIArgs = { command: command as SessionCLIArgs["command"], json: false };
  const seen = new Set<string>();
  const flags: Record<string, string> = {
    "--input": "input",
    "--vault": "vault",
    "--topic": "topic",
    "--sink": "sink",
    "--max-chars": "max_chars",
    "--as-of": "as_of",
  };
  for (let i = 2; i < args.length; i++) {
    const flag = args[i]!;
    if (seen.has(flag)) throw new Error(`Duplicate ${flag}`);
    seen.add(flag);
    if (flag === "--json") {
      result.json = true;
      continue;
    }
    const key = flags[flag];
    if (!key || (command === "start" ? key === "input" : key !== "input"))
      throw new Error(`Invalid flag ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith("--") || value === "-")
      throw new Error(`Missing value for ${flag}`);
    (result as unknown as Record<string, unknown>)[key] =
      key === "max_chars" ? Number(value) : value;
  }
  if (command !== "start" && !result.input) throw new Error("Missing --input");
  if (command === "start")
    SessionStartSchema.parse({
      vault: result.vault ?? "selected",
      topic: result.topic,
      sink: result.sink,
      max_chars: result.max_chars,
      as_of: result.as_of,
    });
  return result;
}
