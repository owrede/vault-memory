export interface ImportCLIArgs {
  command: "import" | "promote-conversation";
  input?: string;
  format?: "neutral" | "chatgpt";
  target?: string;
  commit?: string;
  json: boolean;
}
export function parseImportArgs(args: string[]): ImportCLIArgs {
  const command = args[0];
  if (command !== "import" && command !== "promote-conversation")
    throw new Error("Unknown import command");
  const result: ImportCLIArgs = { command, json: false },
    seen = new Set<string>();
  const flags: Record<string, string> = {
    "--input": "input",
    "--format": "format",
    "--target": "target",
    "--commit": "commit",
  };
  for (let i = 1; i < args.length; i++) {
    const flag = args[i]!;
    if (seen.has(flag)) throw new Error(`Duplicate ${flag}`);
    seen.add(flag);
    if (flag === "--json") {
      result.json = true;
      continue;
    }
    if (flag === "--preview" && command === "import") continue;
    const key = flags[flag];
    if (!key || (command === "promote-conversation" && key !== "input"))
      throw new Error(`Invalid flag ${flag}`);
    const value = args[++i];
    if (!value || value === "-" || value.startsWith("--"))
      throw new Error(`Missing value for ${flag}`);
    (result as unknown as Record<string, unknown>)[key] = value;
  }
  if (result.commit) {
    if (result.input || result.target || result.format || seen.has("--preview"))
      throw new Error("--commit accepts only a manifest file and --json");
  } else if (!result.input || (command === "import" && (!result.target || !result.format)))
    throw new Error("Missing --input/--format/--target");
  if (result.format && !["neutral", "chatgpt"].includes(result.format))
    throw new Error("unsupported_format");
  return result;
}
