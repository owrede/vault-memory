#!/usr/bin/env node
/**
 * Reproducible contextfit tuning benchmark.
 *
 * Answers: "Can contextfit be tuned to retrieve better?" — specifically tests
 * the multi-query strategy (exploit contextfit's speed advantage by issuing
 * several query reformulations and merging the results), against the single-
 * query Spike baseline. Measured objectively over the queries that carry
 * `expected_paths` ground-truth anchors in queries.yaml.
 *
 * Why a separate script: the main harness (query-both.mjs) measures the two
 * backends head-to-head with ONE query each. This script isolates the
 * contextfit-side tuning question and reports Recall@5 per strategy + the
 * latency cost, so the "multi-query" claim in SUMMARY.md is reproducible.
 *
 * Strategies tested:
 *   - single                : one query, hybrid (= Spike baseline)
 *   - multi_keywords        : original + keyword-only variant (blind, no target knowledge)
 *   - method_bm25 / sid     : single query, alternate retrieval method
 *
 * Merge rule for multi-query: union of hits across variants, each note scored
 * by its BEST score across variants, then re-sorted. Cheapest sensible fusion
 * (no RRF) — deliberately simple so the result is a floor, not a tuned ceiling.
 *
 * Env (set by run.sh / shared with the spike):
 *   SANDBOX         — sandbox $HOME containing contextfit_kb
 *   CONTEXTFIT_PY   — venv python with contextfit installed
 *   SPIKE_DIR       — this spike dir (defaults to script's ../)
 *   VAULT_NAME      — vault folder name for path normalization (default INIM-VM-TEST)
 *
 * Output: results/tuning-metrics.json + console table.
 */

import { spawn } from "node:child_process";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SPIKE_DIR = process.env.SPIKE_DIR || join(dirname(fileURLToPath(import.meta.url)), "..");
const SANDBOX = process.env.SANDBOX || readSandbox();
const CONTEXTFIT_PY = process.env.CONTEXTFIT_PY || derivePy();
const VAULT_NAME = process.env.VAULT_NAME || "INIM-VM-TEST";
const KB = join(SANDBOX, "contextfit_kb");
const TOP_K = 10;

function readSandbox() {
  const p = join(SPIKE_DIR, "results/.sandbox");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  throw new Error("No SANDBOX env and no results/.sandbox — run ./run.sh setup first.");
}
function derivePy() {
  const envPath = join(SPIKE_DIR, "results/.env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^CONTEXTFIT_PY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return "python3";
}

// ─── ground-truth queries from queries.yaml ──────────────────────────
function parseAnchorQueries() {
  const text = readFileSync(join(SPIKE_DIR, "queries.yaml"), "utf8");
  const rows = [];
  let cur = null;
  let inPaths = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "");
    const id = /^\s*-\s+id:\s*(\S+)/.exec(line);
    if (id) {
      if (cur?.expected_paths?.length) rows.push(cur);
      cur = { id: id[1], expected_paths: [] };
      inPaths = false;
      continue;
    }
    if (!cur) continue;
    const t = /^\s+text:\s*"(.+)"/.exec(line);
    if (t) cur.text = t[1];
    if (/^\s+expected_paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (inPaths) {
      const p = /^\s+-\s+"(.+)"\s*$/.exec(line);
      if (p) cur.expected_paths.push(p[1]);
      else if (/^\s+\w+:/.test(line)) inPaths = false;
    }
  }
  if (cur?.expected_paths?.length) rows.push(cur);
  return rows;
}

// ─── persistent contextfit server (reuse the spike's server) ─────────
class CF {
  constructor() {
    this.buf = "";
    this.queue = [];
  }
  start() {
    const server = join(SPIKE_DIR, "scripts/contextfit-server.py");
    this.proc = spawn(CONTEXTFIT_PY, [server, "--kb", KB], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");
    this.proc.stdout.on("data", (c) => this._on(c));
    let err = "";
    return new Promise((resolve, reject) => {
      this.proc.stderr.on("data", (d) => {
        err += d;
        if (err.includes("READY")) resolve();
      });
      this.proc.on("exit", (code) => reject(new Error(`server exit ${code}: ${err.slice(-300)}`)));
    });
  }
  _on(c) {
    this.buf += c;
    let nl;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      const p = this.queue.shift();
      if (!p) continue;
      try {
        const r = JSON.parse(line);
        r.ok ? p.resolve(r.result) : p.reject(new Error(r.error));
      } catch (e) {
        p.reject(e);
      }
    }
  }
  query(text, method = "hybrid") {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.proc.stdin.write(JSON.stringify({ query: text, top_k: TOP_K, method }) + "\n");
    });
  }
  stop() {
    try {
      this.proc.stdin.write(JSON.stringify({ cmd: "quit" }) + "\n");
    } catch {
      /* ignore */
    }
  }
}

// ─── helpers ─────────────────────────────────────────────────────────
const MARK = `${VAULT_NAME}/`;
function normPath(p) {
  if (!p) return "";
  const i = p.indexOf(MARK);
  return (i >= 0 ? p.slice(i + MARK.length) : p).replace(/^\/+/, "");
}
function hitsOf(result) {
  // server returns _query_to_json dict: { chunks: [{ score, metadata:{source} }] }
  return (result.chunks ?? []).map((c) => ({
    path: normPath(c.metadata?.source ?? ""),
    score: c.score ?? 0,
  }));
}
function recallAt5(rankedPaths, expected) {
  const top5 = rankedPaths.slice(0, 5);
  return top5.some((p) => expected.includes(p)) ? 1 : 0;
}
function keywordVariant(q) {
  return q
    .replace(/[?.,]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 4)
    .join(" ");
}

async function mergeQueries(cf, variants) {
  const best = new Map();
  for (const v of variants) {
    for (const h of hitsOf(await cf.query(v))) {
      if (!best.has(h.path) || h.score > best.get(h.path)) best.set(h.path, h.score);
    }
  }
  return [...best.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

// ─── run ─────────────────────────────────────────────────────────────
const anchors = parseAnchorQueries();
console.error(`→ ${anchors.length} Anker-Queries (mit expected_paths)`);
const cf = new CF();
await cf.start();
console.error("→ contextfit engine geladen");

const strategies = {
  "single (Spike-Baseline)": async (q) => hitsOf(await cf.query(q.text)).map((h) => h.path),
  "multi_keywords (2x, blind)": async (q) => mergeQueries(cf, [q.text, keywordVariant(q.text)]),
  method_bm25: async (q) => hitsOf(await cf.query(q.text, "bm25")).map((h) => h.path),
  method_sid: async (q) => hitsOf(await cf.query(q.text, "sid")).map((h) => h.path),
};

const results = {};
for (const [name, fn] of Object.entries(strategies)) {
  let hits = 0;
  const t0 = performance.now();
  for (const q of anchors) {
    const ranked = await fn(q);
    hits += recallAt5(ranked, q.expected_paths);
  }
  const ms = performance.now() - t0;
  results[name] = {
    recall_at_5: hits / anchors.length,
    hits,
    n: anchors.length,
    total_ms: Math.round(ms),
    ms_per_query: +(ms / anchors.length).toFixed(1),
  };
}
cf.stop();

// ─── report ──────────────────────────────────────────────────────────
const out = {
  n_anchor_queries: anchors.length,
  sqlite_vec_baseline_recall_at_5: 0.5, // from results/metrics.json ground_truth
  strategies: results,
};
writeFileSync(join(SPIKE_DIR, "results/tuning-metrics.json"), JSON.stringify(out, null, 2));

console.error("\n=== contextfit Tuning — Recall@5 über " + anchors.length + " Anker ===");
for (const [name, r] of Object.entries(results)) {
  console.error(
    `  ${name.padEnd(28)} ${(r.recall_at_5 * 100).toFixed(1)}%  (${r.hits}/${r.n})  ${r.ms_per_query}ms/query`,
  );
}
console.error(`  ${"sqlite-vec (Referenz)".padEnd(28)} 50.0%`);
console.error(`\n✓ ${join(SPIKE_DIR, "results/tuning-metrics.json")}`);
