import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createVaultFixture } from "../../tests/helpers/vault-fixture.js";
import { indexVault } from "../indexer/indexer.js";
beforeAll(() => {
  const build = spawnSync(process.execPath, ["node_modules/tsup/dist/cli-default.js"], {
    encoding: "utf8",
    timeout: 30000,
  });
  if (build.status !== 0) throw new Error(build.stderr);
});
let f: Awaited<ReturnType<typeof createVaultFixture>>, configDir: string;
beforeEach(async () => {
  f = await createVaultFixture();
  configDir = join(f.root, "config");
  await fs.mkdir(join(configDir, "vaults"), { recursive: true });
  await fs.writeFile(
    join(f.root, "A B.md"),
    "---\nsource: user\n---\n# Über Jörg\nOriginal Budget",
  );
  await indexVault(f.vault, { embeddings: "none", embeddingModel: "unused" });
  await f.vault.db.handle.backup(join(configDir, "vaults", "lab.db"));
  await fs.writeFile(
    join(configDir, "config.toml"),
    `[server]\nfeatures=["document_edit"]\n[[vaults]]\nname="lab"\npath=${JSON.stringify(f.root)}\nwrite_enabled=true\n`,
  );
});
afterEach(async () => f.cleanup());
function run(...args: string[]) {
  const p = spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: { ...process.env, VM_CONFIG_DIR: configDir },
    timeout: 15000,
  });
  return { code: p.status, stdout: p.stdout, stderr: p.stderr };
}
it("searches, reads and patches through the built CLI with isolated config and JSON stdout", async () => {
  const first = run("read", "--doc-id", f.id("A B.md"), "--projection", "metadata", "--json");
  expect(first.code).toBe(0);
  const doc = JSON.parse(first.stdout);
  expect(doc).toMatchObject({
    doc_id: f.id("A B.md"),
    properties: { source: "user" },
    context: { projection: "metadata", budget_used: 0 },
  });
  const search = run("search", "--vault", "lab", "--query", "Budget", "--json");
  expect(search.code).toBe(0);
  expect(JSON.parse(search.stdout).results).toMatchObject([{ doc_id: f.id("A B.md") }]);
  await fs.writeFile(
    join(f.root, "patch.json"),
    JSON.stringify({ kind: "replace", old_text: "Original", new_text: "Updated" }),
  );
  const patch = run(
    "edit",
    "--doc-id",
    doc.doc_id,
    "--expected-hash",
    doc.hash,
    "--patch-file",
    join(f.root, "patch.json"),
    "--json",
  );
  expect(patch.code).toBe(0);
  expect(JSON.parse(patch.stdout).ok).toBe(true);
  const second = run("read", "--doc-id", doc.doc_id, "--projection", "full", "--json");
  expect(second.code).toBe(0);
  expect(JSON.parse(second.stdout).context.slices[0].text).toContain("Updated");
  const conflict = run(
    "edit",
    "--doc-id",
    doc.doc_id,
    "--expected-hash",
    doc.hash,
    "--patch-file",
    join(f.root, "patch.json"),
    "--json",
  );
  expect(conflict.code).toBe(4);
  expect(JSON.parse(conflict.stdout).reason).toBe("hash_mismatch");
  expect(conflict.stderr).toContain("hash_mismatch");
});
it("refuses locked files and invalid options and exposes the versioned manual", async () => {
  await fs.writeFile(join(f.root, "A B.md"), "---\nlocked: true\n---\n# A\nOriginal");
  const original = await f.source.readDocument(f.id("A B.md"));
  await fs.writeFile(
    join(f.root, "patch.json"),
    JSON.stringify({ kind: "replace", old_text: "Original", new_text: "Updated" }),
  );
  const result = run(
    "edit",
    "--doc-id",
    original.id,
    "--expected-hash",
    original.hash,
    "--patch-file",
    join(f.root, "patch.json"),
    "--json",
  );
  expect(result.code).toBe(4);
  expect(JSON.parse(result.stdout).reason).toBe("document_locked");
  expect((await f.source.readDocument(original.id)).hash).toBe(original.hash);
  expect(run("search", "--query", "Q", "--typo").code).toBe(2);
  const manual = run("man", "edit_document", "--json");
  expect(manual.code).toBe(0);
  expect(JSON.parse(manual.stdout)).toMatchObject({ schema_version: 1, topic: "edit_document" });
});
it("refreshes edited semantic and FTS indexes with the configured embedding client", async () => {
  const { createServer } = await import("node:http");
  const service = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const parsed = JSON.parse(body);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ embeddings: parsed.input.map(() => [1, 0]) }));
    });
  });
  await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve));
  try {
    const address = service.address() as { port: number };
    await fs.writeFile(
      join(configDir, "config.toml"),
      `[server]\nfeatures=["document_edit"]\nollama_endpoint="http://127.0.0.1:${address.port}"\n[[vaults]]\nname="lab"\npath=${JSON.stringify(f.root)}\nwrite_enabled=true\n`,
    );
    const { Database } = await import("../db/database.js");
    const db = new Database(join(configDir, "vaults", "lab.db"), "lab");
    db.models.upsert({ name: "fixture", provider: "ollama", dim: 2 });
    db.close();
    const original = await f.source.readDocument(f.id("A B.md"));
    await fs.writeFile(
      join(f.root, "patch.json"),
      JSON.stringify({ kind: "replace", old_text: "Original", new_text: "Updated" }),
    );
    // Async child lets the local fixture server answer its request.
    const { spawn } = await import("node:child_process");
    const result = await new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "dist/cli.js",
          "edit",
          "--doc-id",
          original.id,
          "--expected-hash",
          original.hash,
          "--patch-file",
          join(f.root, "patch.json"),
          "--json",
        ],
        { env: { ...process.env, VM_CONFIG_DIR: configDir } },
      );
      let stdout = "";
      child.stdout.on("data", (data) => (stdout += data));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout }));
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).index_refresh).toBeUndefined();
    const updated = new Database(join(configDir, "vaults", "lab.db"), "lab");
    try {
      expect(updated.fts.search("Updated", 10)).toHaveLength(1);
      expect(updated.notes.getByPath("A B.md")!.body_hash).not.toBeNull();
    } finally {
      updated.close();
    }
  } finally {
    await new Promise<void>((resolve) => service.close(() => resolve()));
  }
});
it("routes ContextFit vaults through their configured backend", async () => {
  await fs.writeFile(
    join(configDir, "config.toml"),
    `[[vaults]]\nname="lab"\npath=${JSON.stringify(f.root)}\nbackend="contextfit"\n[vaults.contextfit]\ncommand="/nonexistent-contextfit-fixture"\n`,
  );
  const result = run("search", "--vault", "lab", "--query", "Budget", "--json");
  expect(result.code).toBe(5);
  expect(result.stderr).toContain("ContextFit");
  expect(JSON.parse(result.stdout).ok).toBe(false);
});
it("does not provision a missing memory sink during source reads", async () => {
  await fs.writeFile(
    join(configDir, "config.toml"),
    `[[vaults]]\nname="lab"\npath=${JSON.stringify(f.root)}\nwrite_enabled=false\n[[memory_sinks]]\nname="memory"\nhandle="obsidian-fs://lab/_memory/"\ncontract="default-memory-v1"\n`,
  );
  const result = run("read", "--doc-id", f.id("A B.md"), "--projection", "metadata", "--json");
  expect(result.code).toBe(0);
  await expect(fs.stat(join(f.root, "_memory", ".memory-sink"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it("indexes and searches using configured native ONNX without an Ollama service", async () => {
  const modelPath = new URL("../../tests/fixtures/tiny-embedding/", import.meta.url).pathname;
  await fs.writeFile(join(f.root, "Alpha.md"), "# Alpha\nAlpha");
  await fs.writeFile(
    join(configDir, "config.toml"),
    `[server]\nembedding_provider="onnx"\nmodel_path=${JSON.stringify(modelPath)}\n[[vaults]]\nname="lab"\npath=${JSON.stringify(f.root)}\nwrite_enabled=true\n`,
  );
  const indexed = run("index", "--vault", "lab", "--full");
  expect(indexed.code).toBe(0);
  const result = run("search", "--vault", "lab", "--query", "Alpha", "--json");
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout).results[0]).toMatchObject({ notePath: "Alpha.md" });
});
it("reads source metadata even when optional ONNX assets are unavailable", async () => {
  await fs.writeFile(
    join(configDir, "config.toml"),
    `[server]\nembedding_provider="onnx"\nmodel_path="/missing-model-assets-fixture"\n[[vaults]]\nname="lab"\npath=${JSON.stringify(f.root)}\n`,
  );
  expect(run("read", "--doc-id", f.id("A B.md"), "--projection", "metadata", "--json").code).toBe(
    0,
  );
});
it("records session checkpoints through the built opt-in CLI without embeddings and executes a neutral host hook", async () => {
  const { provisionSink } = await import("../adapters/delivery/obsidian-fs/sentinel.js");
  await f.memorySinkRegistry.registerMemorySinks(
    [{ name: "memory", handle: "obsidian-fs://lab/_memory/", contract: "default-memory-v1" }],
    {
      resolveVaultAbsolutePath: () => f.root,
      provisioner: (sink, root) => provisionSink(sink, root, { version: "test" }),
    },
  );
  await fs.writeFile(
    join(configDir, "config.toml"),
    `[server]\nfeatures=["session_lifecycle"]\nembedding_provider="onnx"\nmodel_path="/missing-assets"\n[[vaults]]\nname="lab"\npath=${JSON.stringify(f.root)}\nwrite_enabled=true\n[[memory_sinks]]\nname="memory"\nhandle="obsidian-fs://lab/_memory/"\ncontract="default-memory-v1"\n`,
  );
  const input = {
    session_id: "cli",
    event_id: "checkpoint",
    sink: "memory",
    summary: "Finished a task",
    source_doc_ids: [f.id("A B.md")],
    observed_at: "2026-10-03T10:00:00Z",
  };
  const path = join(f.root, "checkpoint.json");
  await fs.writeFile(path, JSON.stringify(input));
  const first = run("session", "checkpoint", "--input", path, "--json");
  expect(first.code).toBe(0);
  const result = JSON.parse(first.stdout);
  expect(result.ok).toBe(true);
  expect(JSON.parse(run("session", "checkpoint", "--input", path, "--json").stdout)).toMatchObject({
    doc_id: result.doc_id,
    reused: true,
  });
  await fs.writeFile(
    path,
    JSON.stringify({ schema_version: 1, event: "session_checkpoint", input }),
  );
  const hook = spawnSync(process.execPath, ["examples/hooks/neutral-session.mjs", path], {
    encoding: "utf8",
    env: { ...process.env, VM_CONFIG_DIR: configDir },
    timeout: 15000,
  });
  expect(hook.status).toBe(0);
  expect(JSON.parse(hook.stdout)).toMatchObject({ doc_id: result.doc_id, reused: true });
  const invalid = run("session", "start", "--topic", "x", "--max-chars", "-1", "--json");
  expect(invalid.code).toBe(2);
});
it("previews and commits conversation sources through the built CLI and promotes evidence separately", async () => {
  const { provisionSink } = await import("../adapters/delivery/obsidian-fs/sentinel.js");
  await f.memorySinkRegistry.registerMemorySinks(
    [{ name: "memory", handle: "obsidian-fs://lab/_memory/", contract: "default-memory-v1" }],
    {
      resolveVaultAbsolutePath: () => f.root,
      provisioner: (sink, root) => provisionSink(sink, root, { version: "test" }),
    },
  );
  await fs.writeFile(
    join(configDir, "config.toml"),
    `[server]\nfeatures=["conversation_import"]\n[[vaults]]\nname="lab"\npath=${JSON.stringify(f.root)}\nwrite_enabled=true\n[[memory_sinks]]\nname="memory"\nhandle="obsidian-fs://lab/_memory/"\ncontract="default-memory-v1"\n`,
  );
  const input = join(f.root, "conversation.json"),
    manifestFile = join(f.root, "manifest.json");
  await fs.writeFile(
    input,
    JSON.stringify([
      {
        provider: "neutral",
        external_id: "cli-chat",
        messages: [{ id: "message1", role: "user", text: "Two pilots" }],
      },
    ]),
  );
  const preview = run(
    "import",
    "--format",
    "neutral",
    "--input",
    input,
    "--target",
    "obsidian-fs://lab/imports/",
    "--json",
  );
  expect(preview.code).toBe(0);
  const manifest = JSON.parse(preview.stdout);
  expect(manifest.items).toHaveLength(1);
  expect(await f.source.exists(manifest.items[0].target)).toBe(false);
  await fs.writeFile(manifestFile, preview.stdout);
  const commit = run("import", "--commit", manifestFile, "--json");
  expect(commit.code).toBe(0);
  expect(JSON.parse(commit.stdout).ok).toBe(true);
  const doc = await f.source.readDocument(manifest.items[0].target);
  expect(doc.properties.source).toBe("imported");
  expect(JSON.parse(run("import", "--commit", manifestFile, "--json").stdout)).toMatchObject({
    results: [{ reused: true }],
  });
  const promotion = join(f.root, "promotion.json");
  await fs.writeFile(
    promotion,
    JSON.stringify({
      doc_id: doc.id,
      expected_hash: doc.hash,
      message_ids: ["message1"],
      claim: "Two pilots",
      mode: "quote",
      sink: "memory",
      observed_at: "2026-10-03T12:00:00Z",
    }),
  );
  const result = run("promote-conversation", "--input", promotion, "--json");
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout).ok).toBe(true);
  const unsupported = run(
    "import",
    "--format",
    "chatgpt",
    "--input",
    input,
    "--target",
    "obsidian-fs://lab/imports/",
    "--json",
  );
  expect(unsupported.code).toBe(2);
  expect(unsupported.stdout).toContain("unsupported_format");
});
