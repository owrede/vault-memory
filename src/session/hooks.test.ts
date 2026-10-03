import { expect, it } from "vitest";
import { parseSessionEvent } from "./hooks.js";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
it("accepts only versioned explicit lifecycle payloads and rejects transcript fields", () => {
  expect(
    parseSessionEvent({
      schema_version: 1,
      event: "session_start",
      input: { vault: "lab", topic: "Project", max_chars: 3 },
    }),
  ).toMatchObject({ event: "session_start" });
  for (const payload of [
    { schema_version: 2, event: "session_start", input: { vault: "lab", topic: "x" } },
    { schema_version: 1, event: "session_checkpoint", input: { transcript: "secret" } },
    {
      schema_version: 1,
      event: "session_start",
      input: { vault: "lab", topic: "x" },
      transcript: "secret",
    },
  ])
    expect(() => parseSessionEvent(payload)).toThrow();
});
it("executes the host bridge and kills a delayed process before any write", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "vm-hook-"));
  try {
    const delayed = join(root, "delayed.mjs"),
      target = join(root, "halfwrite");
    await fs.writeFile(
      delayed,
      `import {writeFileSync} from 'node:fs';setTimeout(()=>{writeFileSync(${JSON.stringify(target)},'written');},2000);`,
    );
    const child = spawn(
      process.execPath,
      ["examples/hooks/neutral-session.mjs", join(root, "payload.json")],
      { env: { ...process.env, VM_HOOK_CLI: delayed, VM_HOOK_TIMEOUT_MS: "100" } },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    expect(code).toBe(5);
    expect(JSON.parse(out)).toEqual({ ok: false, reason: "hook_timeout" });
    await expect(fs.stat(target)).rejects.toThrow();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
