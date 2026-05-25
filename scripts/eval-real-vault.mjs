#!/usr/bin/env node
/**
 * Real-vault retrieval eval — reproducible MRR@10 over a user's actual vault.
 *
 * Where the v1-baseline suite proves *tool shape* against the fixture vault,
 * this driver answers the operational question "does retrieval actually find
 * the right note in MY vault?" — and does it head-to-head with and without the
 * ONNX reranker, the comparison the manual eval-v4 left open.
 *
 * It drives the built MCP server (dist/cli.js) over stdio against the user's
 * real ~/.vault-memory/config.toml — so sqlite-vec, the embedding model, and
 * the ONNX reranker load exactly as in production. No internal API is reached
 * into; the server is exercised as any MCP client would.
 *
 * Query set + ground truth: evals/real-vault/queries.<vault>.json. A hit counts
 * as relevant when its notePath contains any of the query's
 * expected_path_substrings (case-insensitive). Results dedupe to note level
 * (best chunk rank per note) before ranking, matching how the manual evals were
 * scored.
 *
 * Usage:
 *   node scripts/eval-real-vault.mjs [evals/real-vault/queries.inim.json]
 *   node scripts/eval-real-vault.mjs --rerank-only        # skip the no-rerank pass
 *   node scripts/eval-real-vault.mjs --md > report.md     # markdown report to stdout
 *
 * Exit code is always 0 on a completed run (this is a measurement tool, not a
 * gate). Server/transport failures exit 1.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const MD = args.includes("--md");
const RERANK_ONLY = args.includes("--rerank-only");
const SPEC_PATH = resolve(
  args.find((a) => !a.startsWith("--")) ?? "evals/real-vault/queries.inim.json",
);
const CLI = resolve("dist/cli.js");

const spec = JSON.parse(readFileSync(SPEC_PATH, "utf8"));
const TOP_K = spec.top_k ?? 10;

// stderr for progress so --md stdout stays clean.
const log = (...a) => console.error(...a);

function rankOf(hits, expectedSubstrings) {
  // Dedupe to note level: first (best-ranked) chunk per notePath wins.
  const seen = new Set();
  let rank = 0;
  for (const h of hits) {
    const path = h.notePath ?? h.note_path ?? "";
    if (seen.has(path)) continue;
    seen.add(path);
    rank += 1;
    const lc = path.toLowerCase();
    if (expectedSubstrings.some((s) => lc.includes(s.toLowerCase()))) {
      return rank; // 1-indexed note rank
    }
  }
  return null; // not found in returned notes
}

function symbol(rank) {
  if (rank === null) return "❌";
  if (rank === 1) return "✅";
  if (rank <= 3) return "🟡";
  if (rank <= 5) return "🟠";
  return "⚫";
}

async function runPass(client, rerank, callOpts) {
  const rows = [];
  for (const q of spec.queries) {
    const res = await client.callTool(
      {
        name: "search_hybrid",
        arguments: {
          query: q.query,
          vaults: spec.vault ? [spec.vault] : undefined,
          top_k: TOP_K,
          exclude_paths: spec.exclude_paths,
          rerank,
        },
      },
      undefined,
      callOpts,
    );
    let hits = [];
    try {
      const text = res.content?.[0]?.text ?? "[]";
      const parsed = JSON.parse(text);
      hits = Array.isArray(parsed) ? parsed : (parsed.hits ?? parsed.results ?? []);
    } catch (err) {
      log(`  ! ${q.id} parse error: ${err.message}`);
    }
    const rank = rankOf(hits, q.expected_path_substrings);
    const topPath = hits[0]?.notePath ?? hits[0]?.note_path ?? "(none)";
    rows.push({ ...q, rank, topPath, returned: hits.length });
    log(`  ${rerank ? "D′" : "C "} ${q.id} ${symbol(rank)} rank=${rank ?? "—"}  top=${topPath}`);
  }
  return rows;
}

// Primary MRR excludes known_gap queries — those measure a vault structure
// gap (no target document exists), not retrieval quality. They are reported
// separately so the headline number reflects what the indexer can actually do.
function mrr(rows, { includeKnownGaps = false } = {}) {
  const scored = includeKnownGaps ? rows : rows.filter((r) => !r.known_gap);
  const sum = scored.reduce((acc, r) => acc + (r.rank ? 1 / r.rank : 0), 0);
  return scored.length ? sum / scored.length : 0;
}

function byCategory(rows) {
  const cats = {};
  for (const r of rows) {
    (cats[r.category] ??= []).push(r);
  }
  return Object.fromEntries(
    Object.entries(cats).map(([c, rs]) => [c, mrr(rs)]),
  );
}

function renderMarkdown(passes) {
  const { noRerank, rerank } = passes;
  const lines = [];
  lines.push(`# Real-vault retrieval eval — ${spec.vault}`);
  lines.push("");
  lines.push(`- Query set: \`${SPEC_PATH}\` (${spec.queries.length} queries)`);
  lines.push(`- top_k: ${TOP_K} · exclude_paths: ${JSON.stringify(spec.exclude_paths ?? [])}`);
  lines.push(`- Run: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("Rank legend: ✅ 1 · 🟡 2-3 · 🟠 4-5 · ⚫ 6-10 · ❌ not in top-10");
  lines.push("");
  lines.push(`| # | Cat | Query | ${noRerank ? "C (no rerank) | " : ""}D′ (rerank) |`);
  lines.push(`|---|-----|-------|${noRerank ? "------|" : ""}------|`);
  for (let i = 0; i < rerank.length; i++) {
    const r = rerank[i];
    const c = noRerank?.[i];
    const gap = r.known_gap ? " ⚠️gap" : "";
    const cCell = noRerank ? ` ${symbol(c.rank)} ${c.rank ?? "—"} |` : "";
    lines.push(
      `| ${r.id}${gap} | ${r.category} | ${r.query.slice(0, 48)} |${cCell} ${symbol(r.rank)} ${r.rank ?? "—"} |`,
    );
  }
  lines.push("");
  const gapRows = rerank.filter((r) => r.known_gap);
  if (gapRows.length) {
    lines.push(
      `⚠️ ${gapRows.length} query/queries (${gapRows.map((r) => r.id).join(", ")}) marked \`known_gap\` ` +
        `(no canonical target note exists in the vault) are EXCLUDED from the primary MRR below.`,
    );
    lines.push("");
  }
  lines.push("## MRR@10 (excluding known vault-structure gaps)");
  lines.push("");
  lines.push(`| Config | MRR@10 |`);
  lines.push(`|--------|--------|`);
  if (noRerank) lines.push(`| C — bge-m3, no rerank | ${mrr(noRerank).toFixed(3)} |`);
  lines.push(`| D′ — bge-m3 + ONNX rerank | ${mrr(rerank).toFixed(3)} |`);
  lines.push("");
  lines.push(`_v4 manual baseline (whole set, incl. gaps): bge-m3 0.82._`);
  lines.push("");
  lines.push("## MRR@10 by category");
  lines.push("");
  const catR = byCategory(rerank);
  const catC = noRerank ? byCategory(noRerank) : null;
  lines.push(`| Category | ${noRerank ? "C | " : ""}D′ |`);
  lines.push(`|----------|${noRerank ? "---|" : ""}---|`);
  for (const cat of Object.keys(catR).sort()) {
    const cCell = catC ? ` ${catC[cat].toFixed(3)} |` : "";
    lines.push(`| ${cat} |${cCell} ${catR[cat].toFixed(3)} |`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  log(`Real-vault eval → vault="${spec.vault}", ${spec.queries.length} queries, top_k=${TOP_K}`);
  log(`Server: ${CLI}`);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, "serve"],
  });
  const client = new Client({ name: "real-vault-eval", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  log("Connected. Giving the server a moment to open vault DBs…");
  await new Promise((r) => setTimeout(r, 1500));

  // Per-call timeout must clear the ONNX reranker's cold start (570 MB model
  // load + cross-encoding ~50 chunks). The SDK default is 60s, too tight for
  // the first reranked call. 180s with a warmup below keeps every call safe.
  const CALL_OPTS = { timeout: 180_000 };

  let noRerank = null;
  if (!RERANK_ONLY) {
    log("\n— Pass C: no rerank —");
    noRerank = await runPass(client, false, CALL_OPTS);
  }

  log("\n— Warmup: priming the ONNX reranker (cold model load) —");
  try {
    await client.callTool(
      {
        name: "search_hybrid",
        arguments: {
          query: spec.queries[0].query,
          vaults: spec.vault ? [spec.vault] : undefined,
          top_k: TOP_K,
          exclude_paths: spec.exclude_paths,
          rerank: true,
        },
      },
      undefined,
      CALL_OPTS,
    );
    log("  reranker warm.");
  } catch (err) {
    log(`  warmup failed (continuing): ${err.message}`);
  }

  log("\n— Pass D′: ONNX rerank —");
  const rerank = await runPass(client, true, CALL_OPTS);

  await client.close();

  const passes = { noRerank, rerank };
  if (MD) {
    console.log(renderMarkdown(passes));
  } else {
    log("\n=== MRR@10 ===");
    if (noRerank) log(`  C  (no rerank): ${mrr(noRerank).toFixed(3)}`);
    log(`  D′ (rerank)   : ${mrr(rerank).toFixed(3)}`);
    log("\nRun with --md to emit a full markdown report.");
  }

  // measurement tool, not a gate
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
