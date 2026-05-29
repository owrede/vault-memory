#!/usr/bin/env node
/**
 * Drive both retrieval backends with the same query set; record raw outputs.
 *
 * Env contract (set by run.sh):
 *   VAULT_PATH        — absolute path to the user vault
 *   SANDBOX           — temp $HOME for the sqlite-vec backend
 *   CONTEXTFIT_BIN    — path to the contextfit executable
 *   EMBEDDING_MODEL   — Ollama model name for vault-memory
 *   SPIKE_DIR         — this spike's root directory
 *   REPO_ROOT         — vault-memory repo root
 *   WITH_RERANKER     — "1" to enable ONNX cross-encoder reranker (annex mode)
 *
 * Output:
 *   results/contextfit-raw.json
 *   results/sqlite-vec-raw.json
 *   results/query-metrics.json (latency P50/P95 per backend)
 */

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import YAML from "yaml";

const SPIKE_DIR = process.env.SPIKE_DIR;
const REPO_ROOT = process.env.REPO_ROOT;
const VAULT_PATH = process.env.VAULT_PATH;
const SANDBOX = process.env.SANDBOX;
const CONTEXTFIT_BIN = process.env.CONTEXTFIT_BIN;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "bge-m3";
const WITH_RERANKER = process.env.WITH_RERANKER === "1";
const TOP_K = 10;
const REPS = 3;

if (!SPIKE_DIR || !REPO_ROOT || !VAULT_PATH || !SANDBOX || !CONTEXTFIT_BIN) {
  console.error("Missing required env vars. Run via run.sh.");
  process.exit(2);
}

// ─── Load queries ────────────────────────────────────────────────────
const queriesYaml = await readFile(join(SPIKE_DIR, "queries.yaml"), "utf8");
const { queries } = YAML.parse(queriesYaml);
if (!Array.isArray(queries) || queries.length === 0) {
  console.error("queries.yaml: no queries found");
  process.exit(2);
}
console.error(`→ Loaded ${queries.length} queries from queries.yaml`);

// ─── Backend A: sqlite-vec via vault-memory MCP stdio ────────────────
async function querySqliteVec(queryTexts) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [join(REPO_ROOT, "dist/cli.js"), "serve"],
    env: { ...process.env, HOME: SANDBOX },
  });
  const client = new Client(
    { name: "spike-driver", version: "0.0.1" },
    { capabilities: {} },
  );
  await client.connect(transport);

  // First a probe call to warm caches (model load, vault open, FTS cache).
  console.error("  warming sqlite-vec backend ...");
  await client.callTool({
    name: "search_hybrid",
    arguments: { query: "warmup", top_k: 1 },
  });

  const out = [];
  for (const q of queryTexts) {
    const latencies = [];
    let lastResult = null;
    for (let rep = 0; rep < REPS; rep++) {
      const t0 = performance.now();
      const resp = await client.callTool({
        name: "search_hybrid",
        arguments: { query: q.text, top_k: TOP_K },
      });
      const t1 = performance.now();
      latencies.push(t1 - t0);
      lastResult = resp;
    }
    const parsed = parseEnvelope(lastResult);
    out.push({
      id: q.id,
      lang: q.lang,
      text: q.text,
      hits: parsed.hits ?? [],
      latencies_ms: latencies,
      backend: "sqlite-vec",
    });
    process.stderr.write(".");
  }
  process.stderr.write("\n");

  await client.close();
  return out;
}

function parseEnvelope(mcpResp) {
  // search_hybrid response: { content: [{ type:"text", text: "<JSON>"}] }
  // The JSON is a SearchHit[] in v1 or {hits: SearchHit[]} in newer phases.
  const text = mcpResp?.content?.[0]?.text;
  if (!text) return { hits: [] };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { hits: [] };
  }
  const hits = Array.isArray(raw) ? raw : raw.hits ?? raw.results ?? [];
  return {
    hits: hits.map((h, idx) => ({
      rank: idx + 1,
      path: h.notePath ?? h.note_path ?? h.path ?? null,
      doc_id: h.doc_id ?? h.docId ?? null,
      score: h.score ?? null,
      score_breakdown: h.scoreBreakdown ?? h.score_breakdown ?? null,
      heading_path: h.headingPath ?? h.heading_path ?? null,
      snippet: (h.chunkText ?? h.snippet ?? h.text ?? "").slice(0, 280),
    })),
  };
}

// ─── Backend B: contextfit via PERSISTENT query server ───────────────
// Earlier this drove the `contextfit` CLI once per query. That made every
// measured latency include ~0.7s of Python-interpreter startup +
// `import contextfit` + RetrievalEngine.load() — a harness artifact, not a
// property of token-native retrieval. We now load the engine ONCE in a
// long-lived python server (scripts/contextfit-server.py) and stream
// queries over stdin/stdout JSONL, exactly mirroring how vault-memory's MCP
// server stays warm. Measured query latency now reflects the retrieval
// algorithm, not cold-start. CONTEXTFIT_PY (the venv python) runs the
// server; it falls back to deriving the interpreter from CONTEXTFIT_BIN's
// directory, then to `python3`.
function resolveContextfitPython() {
  if (process.env.CONTEXTFIT_PY) return process.env.CONTEXTFIT_PY;
  if (CONTEXTFIT_BIN) {
    // venv layout: <venv>/bin/contextfit -> <venv>/bin/python3
    const py = join(CONTEXTFIT_BIN, "..", "python3");
    return py;
  }
  return "python3";
}

class ContextfitServer {
  constructor(kb) {
    this.kb = kb;
    this.proc = null;
    this.buf = "";
    this.queue = []; // pending {resolve, reject}
    this.ready = null;
  }

  start() {
    const py = resolveContextfitPython();
    const server = join(SPIKE_DIR, "scripts/contextfit-server.py");
    this.proc = spawn(py, [server, "--kb", this.kb], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");

    this.proc.stdout.on("data", (chunk) => this._onStdout(chunk));

    let stderrBuf = "";
    this.ready = new Promise((resolve, reject) => {
      this.proc.stderr.on("data", (d) => {
        stderrBuf += d;
        if (stderrBuf.includes("READY")) resolve();
      });
      this.proc.on("exit", (code) => {
        const err = new Error(
          `contextfit-server exited (code ${code}): ${stderrBuf.slice(-400)}`,
        );
        reject(err);
        // fail any in-flight requests
        for (const { reject: rj } of this.queue.splice(0)) rj(err);
      });
    });
    return this.ready;
  }

  _onStdout(chunk) {
    this.buf += chunk;
    let nl;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      const pending = this.queue.shift();
      if (!pending) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (e) {
        pending.reject(new Error(`server JSON parse: ${e.message} / ${line.slice(0, 200)}`));
        continue;
      }
      if (parsed.ok) pending.resolve(parsed.result);
      else pending.reject(new Error(`contextfit query error: ${parsed.error}`));
    }
  }

  query(text) {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.proc.stdin.write(
        JSON.stringify({ query: text, top_k: TOP_K, method: "hybrid" }) + "\n",
      );
    });
  }

  async stop() {
    if (!this.proc) return;
    try {
      this.proc.stdin.write(JSON.stringify({ cmd: "quit" }) + "\n");
    } catch {
      // ignore — process may already be gone
    }
    await new Promise((r) => {
      this.proc.on("exit", r);
      setTimeout(() => {
        try {
          this.proc.kill();
        } catch {
          // ignore
        }
        r();
      }, 2000);
    });
  }
}

async function queryContextfit(queryTexts) {
  const KB = join(SANDBOX, "contextfit_kb");
  const server = new ContextfitServer(KB);
  console.error("  warming contextfit backend (loading engine once) ...");
  await server.start();
  await server.query("warmup"); // first real query — primes lazy postings/sid caches

  const out = [];
  try {
    for (const q of queryTexts) {
      const latencies = [];
      let lastResult = null;
      for (let rep = 0; rep < REPS; rep++) {
        const t0 = performance.now();
        const json = await server.query(q.text);
        const t1 = performance.now();
        latencies.push(t1 - t0);
        lastResult = json;
      }
      out.push({
        id: q.id,
        lang: q.lang,
        text: q.text,
        hits: parseContextfit(lastResult),
        latencies_ms: latencies,
        backend: "contextfit",
      });
      process.stderr.write(".");
    }
    process.stderr.write("\n");
  } finally {
    await server.stop();
  }
  return out;
}

function parseContextfit(json) {
  // Verified against contextfit 0.1.0 cli.py `_query_to_json` / `_chunk_to_json`:
  //   { query, method, query_tokens, retrieved_chunks, input_token_count,
  //     input_ids, sid_predictions, chunks: [ { rank, chunk_id, score, level,
  //     parent_id, token_count, semantic_id, metadata, preview, tokens } ] }
  // NOTE: score lives PER CHUNK (`chunk.score`) — there is NO top-level
  // `scores` array. `metadata` defaults to `{ source: <file path> }`
  // (cli.py:522 `metadata=result.get("file_meta", {"source": str(path)})`).
  const chunks = json?.chunks ?? [];
  return chunks.map((c, idx) => ({
    rank: c.rank ?? idx + 1,
    path: c.metadata?.source ?? c.metadata?.path ?? c.metadata?.file ?? null,
    doc_id: c.chunk_id != null ? `contextfit://${c.chunk_id}` : null,
    score: c.score ?? null,
    score_breakdown: null,
    heading_path: c.metadata?.heading_path ?? c.metadata?.section ?? null,
    snippet: (c.preview ?? c.text ?? "").slice(0, 280),
  }));
}

// ─── Latency stats ───────────────────────────────────────────────────
function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}

function summarizeLatency(rows) {
  const all = rows.flatMap((r) => r.latencies_ms);
  return {
    n_queries: rows.length,
    n_samples: all.length,
    p50_ms: Math.round(percentile(all, 50)),
    p95_ms: Math.round(percentile(all, 95)),
    mean_ms: Math.round(all.reduce((a, b) => a + b, 0) / all.length),
  };
}

// ─── Drive ───────────────────────────────────────────────────────────
console.error(`\n→ Querying sqlite-vec backend (${REPS} reps × ${queries.length} queries)`);
const sqliteVec = await querySqliteVec(queries);
await writeFile(
  join(SPIKE_DIR, "results/sqlite-vec-raw.json"),
  JSON.stringify(sqliteVec, null, 2),
);

console.error(`→ Querying contextfit backend (${REPS} reps × ${queries.length} queries)`);
const contextfit = await queryContextfit(queries);
await writeFile(
  join(SPIKE_DIR, "results/contextfit-raw.json"),
  JSON.stringify(contextfit, null, 2),
);

const metrics = {
  sqlite_vec: summarizeLatency(sqliteVec),
  contextfit: summarizeLatency(contextfit),
  with_reranker: WITH_RERANKER,
  generated_at: new Date().toISOString(),
};
await writeFile(
  join(SPIKE_DIR, "results/query-metrics.json"),
  JSON.stringify(metrics, null, 2),
);

console.error(
  `\n✓ sqlite-vec  P50 ${metrics.sqlite_vec.p50_ms}ms / P95 ${metrics.sqlite_vec.p95_ms}ms`,
);
console.error(
  `✓ contextfit  P50 ${metrics.contextfit.p50_ms}ms / P95 ${metrics.contextfit.p95_ms}ms`,
);
