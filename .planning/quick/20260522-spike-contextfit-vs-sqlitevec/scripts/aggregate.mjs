#!/usr/bin/env node
/**
 * Parse the manually-evaluated results/report.md and compute Recall@5,
 * Precision@5, and MRR per backend, broken down by language and intent.
 *
 * Each Top-5 list in report.md is preceded by a marker comment:
 *   <!-- bewertung-block: <backend>/<query-id> -->
 *
 * Items are markdown lines like:
 *   1. [x] `path/to/note.md` · score 0.612
 *   2. [~] `other.md` · score 0.55
 *   3. [ ] `irrelevant.md` · score 0.4
 *
 * We weight: [x] = 1.0 (full relevance), [~] = 0.5 (partial), [ ] = 0.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SPIKE_DIR = process.env.SPIKE_DIR;
if (!SPIKE_DIR) {
  console.error("SPIKE_DIR env var required");
  process.exit(2);
}

const reportPath = join(SPIKE_DIR, "results/report.md");
const report = await readFile(reportPath, "utf8");
const queriesYaml = await readFile(join(SPIKE_DIR, "queries.yaml"), "utf8");
const queries = parseQueriesYaml(queriesYaml);
const queryMeta = new Map(queries.map((q) => [q.id, q]));

const blockRegex = /<!-- bewertung-block: ([a-z-]+)\/([a-z0-9]+) -->\n([\s\S]*?)(?=\n#### |\n### |\n---|\n## |$)/g;
const itemRegex = /^\s*\d+\.\s+\[([x~ ])\]/gm;

const evals = []; // {backend, qid, ratings: number[]}
let m;
while ((m = blockRegex.exec(report)) !== null) {
  const [, backend, qid, body] = m;
  const ratings = [];
  let mm;
  itemRegex.lastIndex = 0;
  while ((mm = itemRegex.exec(body)) !== null) {
    const mark = mm[1];
    if (mark === "x") ratings.push(1.0);
    else if (mark === "~") ratings.push(0.5);
    else ratings.push(0.0);
    if (ratings.length >= 5) break;
  }
  while (ratings.length < 5) ratings.push(0.0);
  evals.push({ backend, qid, ratings });
}

if (evals.length === 0) {
  console.error("No <!-- bewertung-block --> markers found. Run render.mjs first?");
  process.exit(2);
}

// ─── aggregate ──────────────────────────────────────────────────────
function recallAt(ratings, k) {
  // "any relevant hit in top-K" — binary: 1 if any rating > 0 in top-k, else 0
  return ratings.slice(0, k).some((r) => r > 0) ? 1 : 0;
}
function precisionAt(ratings, k) {
  // average relevance weight over top-k
  return ratings.slice(0, k).reduce((a, b) => a + b, 0) / k;
}
function mrr(ratings) {
  // reciprocal rank of first relevant (rating > 0)
  for (let i = 0; i < ratings.length; i++) {
    if (ratings[i] > 0) return 1 / (i + 1);
  }
  return 0;
}

const byBackend = { "sqlite-vec": [], contextfit: [] };
for (const e of evals) {
  if (!byBackend[e.backend]) continue;
  const meta = queryMeta.get(e.qid) ?? { lang: "?", intent: "?" };
  byBackend[e.backend].push({
    qid: e.qid,
    lang: meta.lang,
    intent: meta.intent,
    ratings: e.ratings,
    recall_at_5: recallAt(e.ratings, 5),
    recall_at_3: recallAt(e.ratings, 3),
    precision_at_5: precisionAt(e.ratings, 5),
    mrr: mrr(e.ratings),
  });
}

function summarize(rows) {
  if (rows.length === 0) return null;
  const avg = (k) => rows.reduce((a, b) => a + b[k], 0) / rows.length;
  return {
    n: rows.length,
    recall_at_3: avg("recall_at_3"),
    recall_at_5: avg("recall_at_5"),
    precision_at_5: avg("precision_at_5"),
    mrr: avg("mrr"),
  };
}

function summarizeFiltered(rows, predicate) {
  return summarize(rows.filter(predicate));
}

const summary = {
  generated_at: new Date().toISOString(),
  overall: {
    sqlite_vec: summarize(byBackend["sqlite-vec"]),
    contextfit: summarize(byBackend["contextfit"]),
  },
  en_only: {
    sqlite_vec: summarizeFiltered(byBackend["sqlite-vec"], (r) => r.lang === "en"),
    contextfit: summarizeFiltered(byBackend["contextfit"], (r) => r.lang === "en"),
  },
  de_adversarials: {
    sqlite_vec: summarizeFiltered(byBackend["sqlite-vec"], (r) => r.lang === "de"),
    contextfit: summarizeFiltered(byBackend["contextfit"], (r) => r.lang === "de"),
  },
};

// Per-intent breakdown
const intents = new Set([...byBackend["sqlite-vec"], ...byBackend.contextfit].map((r) => r.intent));
summary.by_intent = {};
for (const intent of intents) {
  summary.by_intent[intent] = {
    sqlite_vec: summarizeFiltered(byBackend["sqlite-vec"], (r) => r.intent === intent),
    contextfit: summarizeFiltered(byBackend["contextfit"], (r) => r.intent === intent),
  };
}

await writeFile(
  join(SPIKE_DIR, "results/metrics.json"),
  JSON.stringify(summary, null, 2),
);

// ─── render metrics.md ──────────────────────────────────────────────
const out = [];
const p = (s) => out.push(s);

p("# Spike Metrics — contextfit vs. sqlite-vec");
p("");
p(`Aggregated from ${reportPath} at ${summary.generated_at}.`);
p("");
p("## Overall");
p("");
p(renderTable(summary.overall));
p("");
p("## EN only");
p("");
p(renderTable(summary.en_only));
p("");
p("## DE adversarials");
p("");
p(renderTable(summary.de_adversarials));
p("");
p("## By intent");
p("");
for (const [intent, data] of Object.entries(summary.by_intent)) {
  p(`### ${intent}`);
  p("");
  p(renderTable(data));
  p("");
}

p("## Verdict-Schablone (manuell auszufüllen in SUMMARY.md)");
p("");
p("Aus dem Spike-README:");
p("");
p("- **GO**: contextfit ≥ 90% der sqlite-vec Recall@5 *und* DE-Recall@5 ≥ 70% *und* Latenz- oder Storage-Vorteil.");
p("- **NO-GO**: contextfit < 70% EN Recall@5 *oder* < 50% DE Recall@5.");
p("- **DEFER**: Werte dazwischen — siehe README für Folge-Fragen.");
p("");

const ratio = (a, b) => (a && b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const ovS = summary.overall.sqlite_vec;
const ovC = summary.overall.contextfit;
const enS = summary.en_only.sqlite_vec;
const enC = summary.en_only.contextfit;
const deS = summary.de_adversarials.sqlite_vec;
const deC = summary.de_adversarials.contextfit;

p("### Berechnete Vergleichszahlen");
p("");
p("| Vergleich | contextfit / sqlite-vec |");
p("|---|---|");
p(`| Overall Recall@5 | ${ratio(ovC?.recall_at_5, ovS?.recall_at_5)} |`);
p(`| EN Recall@5 | ${ratio(enC?.recall_at_5, enS?.recall_at_5)} |`);
p(`| DE Recall@5 | ${ratio(deC?.recall_at_5, deS?.recall_at_5)} |`);
p(`| Overall MRR | ${ratio(ovC?.mrr, ovS?.mrr)} |`);
p("");

await writeFile(join(SPIKE_DIR, "results/metrics.md"), out.join("\n"));
console.error(`✓ Wrote ${join(SPIKE_DIR, "results/metrics.md")}`);
console.error(`✓ Wrote ${join(SPIKE_DIR, "results/metrics.json")}`);

function renderTable(data) {
  const s = data.sqlite_vec;
  const c = data.contextfit;
  const lines = [];
  lines.push("| Metric | sqlite-vec | contextfit |");
  lines.push("|---|---|---|");
  lines.push(`| n queries | ${s?.n ?? 0} | ${c?.n ?? 0} |`);
  lines.push(`| Recall@3 | ${pct(s?.recall_at_3)} | ${pct(c?.recall_at_3)} |`);
  lines.push(`| Recall@5 | ${pct(s?.recall_at_5)} | ${pct(c?.recall_at_5)} |`);
  lines.push(`| Precision@5 | ${pct(s?.precision_at_5)} | ${pct(c?.precision_at_5)} |`);
  lines.push(`| MRR | ${fmtFloat(s?.mrr)} | ${fmtFloat(c?.mrr)} |`);
  return lines.join("\n");
}
function pct(v) {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}
function fmtFloat(v) {
  return v == null ? "—" : v.toFixed(3);
}

function parseQueriesYaml(text) {
  // Minimal block-style YAML parser sufficient for our schema. Avoids
  // pulling in the `yaml` lib for the aggregate step (this script runs
  // standalone after manual editing — keep it dep-free).
  const rows = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "");
    const itemStart = /^\s*-\s+id:\s*(\S+)/.exec(line);
    if (itemStart) {
      if (current) rows.push(current);
      current = { id: itemStart[1] };
      continue;
    }
    const kv = /^\s+([a-z_]+):\s*(.+?)\s*$/i.exec(line);
    if (kv && current) {
      let v = kv[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      current[kv[1]] = v;
    }
  }
  if (current) rows.push(current);
  return rows;
}
