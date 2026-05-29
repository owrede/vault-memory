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
import { existsSync, readFileSync } from "node:fs";
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
  de_only: {
    sqlite_vec: summarizeFiltered(byBackend["sqlite-vec"], (r) => r.lang === "de"),
    contextfit: summarizeFiltered(byBackend["contextfit"], (r) => r.lang === "de"),
  },
  en_control: {
    sqlite_vec: summarizeFiltered(byBackend["sqlite-vec"], (r) => r.lang === "en"),
    contextfit: summarizeFiltered(byBackend["contextfit"], (r) => r.lang === "en"),
  },
  mixed_codeswitching: {
    sqlite_vec: summarizeFiltered(byBackend["sqlite-vec"], (r) => r.lang === "mixed"),
    contextfit: summarizeFiltered(byBackend["contextfit"], (r) => r.lang === "mixed"),
  },
};

// ─── OBJECTIVE recall from expected_paths (ground truth) ─────────────
// Independent of manual scoring: read the raw hit lists, normalize paths
// to vault-relative, and check whether each query's known-good anchor
// notes appear in the top-K. Only queries with expected_paths count here.
summary.ground_truth = computeGroundTruthRecall();

function normalizeHitPath(p) {
  if (!p) return null;
  // contextfit emits absolute paths; sqlite-vec emits vault-relative.
  // Reduce to the segment after the vault folder name so both compare equal.
  const marker = "INIM-VM-TEST/";
  const idx = p.indexOf(marker);
  let rel = idx >= 0 ? p.slice(idx + marker.length) : p;
  return rel.replace(/^\/+/, "");
}

function loadRaw(name) {
  const path = join(SPIKE_DIR, `results/${name}`);
  if (!existsSync(path)) return new Map();
  const arr = JSON.parse(readFileSync(path, "utf8"));
  return new Map(arr.map((r) => [r.id, r]));
}

function computeGroundTruthRecall() {
  const sqRaw = loadRaw("sqlite-vec-raw.json");
  const cfRaw = loadRaw("contextfit-raw.json");
  const gtQueries = queries.filter((q) => Array.isArray(q.expected_paths) && q.expected_paths.length);
  if (gtQueries.length === 0) return null;

  const scoreBackend = (raw) => {
    const rows = [];
    for (const q of gtQueries) {
      const r = raw.get(q.id);
      const hitPaths = (r?.hits ?? []).map((h) => normalizeHitPath(h.path));
      const expected = q.expected_paths.map((p) => p.replace(/^\/+/, ""));
      // a hit matches an anchor if normalized paths are equal (note-level;
      // contextfit returns chunk hits but path is the source note)
      const firstHitRank = (() => {
        for (let i = 0; i < hitPaths.length; i++) {
          if (expected.includes(hitPaths[i])) return i + 1;
        }
        return 0;
      })();
      const inTop = (k) => hitPaths.slice(0, k).some((hp) => expected.includes(hp));
      rows.push({
        qid: q.id,
        lang: q.lang,
        intent: q.intent,
        n_expected: expected.length,
        recall_at_3: inTop(3) ? 1 : 0,
        recall_at_5: inTop(5) ? 1 : 0,
        recall_at_10: inTop(10) ? 1 : 0,
        mrr: firstHitRank ? 1 / firstHitRank : 0,
      });
    }
    return rows;
  };

  const sq = scoreBackend(sqRaw);
  const cf = scoreBackend(cfRaw);
  const agg = (rows) => ({
    n: rows.length,
    recall_at_3: rows.reduce((a, b) => a + b.recall_at_3, 0) / rows.length,
    recall_at_5: rows.reduce((a, b) => a + b.recall_at_5, 0) / rows.length,
    recall_at_10: rows.reduce((a, b) => a + b.recall_at_10, 0) / rows.length,
    mrr: rows.reduce((a, b) => a + b.mrr, 0) / rows.length,
  });
  return {
    n_queries: gtQueries.length,
    sqlite_vec: agg(sq),
    contextfit: agg(cf),
    per_query: gtQueries.map((q, i) => ({
      qid: q.id,
      lang: q.lang,
      sqlite_recall_5: sq[i].recall_at_5,
      contextfit_recall_5: cf[i].recall_at_5,
    })),
  };
}

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
p("> **Zwei Messmethoden:** *Ground-Truth* (objektiv, aus `expected_paths` —");
p("> unabhängig von der manuellen Bewertung) und *manuelle Bewertung* (alle");
p("> Queries, aus den `[x]/[~]/[ ]`-Checkboxen im report.md).");
p("");

if (summary.ground_truth) {
  const gt = summary.ground_truth;
  p("## Ground-Truth Recall (objektiv, aus expected_paths)");
  p("");
  p(`Basis: ${gt.n_queries} Queries mit bekannten Anker-Notizen.`);
  p("");
  p("| Metric | sqlite-vec | contextfit |");
  p("|---|---|---|");
  p(`| Recall@3 | ${pct(gt.sqlite_vec.recall_at_3)} | ${pct(gt.contextfit.recall_at_3)} |`);
  p(`| Recall@5 | ${pct(gt.sqlite_vec.recall_at_5)} | ${pct(gt.contextfit.recall_at_5)} |`);
  p(`| Recall@10 | ${pct(gt.sqlite_vec.recall_at_10)} | ${pct(gt.contextfit.recall_at_10)} |`);
  p(`| MRR | ${fmtFloat(gt.sqlite_vec.mrr)} | ${fmtFloat(gt.contextfit.mrr)} |`);
  p("");
  p("### Pro Anker-Query (Recall@5: 1 = Anker im Top-5)");
  p("");
  p("| Query | Sprache | sqlite-vec | contextfit |");
  p("|---|---|---|---|");
  for (const r of gt.per_query) {
    p(`| ${r.qid} | ${r.lang} | ${r.sqlite_recall_5} | ${r.contextfit_recall_5} |`);
  }
  p("");
}

p("## Overall (manuelle Bewertung)");
p("");
p(renderTable(summary.overall));
p("");
p("## DE (Hauptset)");
p("");
p(renderTable(summary.de_only));
p("");
p("## EN (Kontrollgruppe)");
p("");
p(renderTable(summary.en_control));
p("");
p("## Mixed (DE/EN Code-Switching)");
p("");
p(renderTable(summary.mixed_codeswitching));
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

const ratio = (a, b) => (a != null && b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const ovS = summary.overall.sqlite_vec;
const ovC = summary.overall.contextfit;
const deS = summary.de_only.sqlite_vec;
const deC = summary.de_only.contextfit;
const gt = summary.ground_truth;

p("### Berechnete Vergleichszahlen (contextfit relativ zu sqlite-vec)");
p("");
p("| Vergleich | contextfit / sqlite-vec |");
p("|---|---|");
if (gt) {
  p(`| Ground-Truth Recall@5 | ${ratio(gt.contextfit.recall_at_5, gt.sqlite_vec.recall_at_5)} |`);
  p(`| Ground-Truth MRR | ${ratio(gt.contextfit.mrr, gt.sqlite_vec.mrr)} |`);
}
p(`| Overall Recall@5 (manuell) | ${ratio(ovC?.recall_at_5, ovS?.recall_at_5)} |`);
p(`| DE Recall@5 (manuell) | ${ratio(deC?.recall_at_5, deS?.recall_at_5)} |`);
p(`| Overall MRR (manuell) | ${ratio(ovC?.mrr, ovS?.mrr)} |`);
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
  // standalone after manual editing — keep it dep-free). Handles scalar
  // `key: value` plus the one list field we use, `expected_paths:`.
  const rows = [];
  let current = null;
  let inExpectedPaths = false;
  const unquote = (v) => {
    v = v.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1);
    }
    return v;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "");
    const itemStart = /^\s*-\s+id:\s*(\S+)/.exec(line);
    if (itemStart) {
      if (current) rows.push(current);
      current = { id: itemStart[1] };
      inExpectedPaths = false;
      continue;
    }
    if (/^\s+expected_paths:\s*$/.test(line) && current) {
      current.expected_paths = [];
      inExpectedPaths = true;
      continue;
    }
    if (inExpectedPaths) {
      const pathItem = /^\s+-\s+(.+?)\s*$/.exec(line);
      if (pathItem) {
        current.expected_paths.push(unquote(pathItem[1]));
        continue;
      }
      inExpectedPaths = false; // any non-list line ends the block
    }
    const kv = /^\s+([a-z_]+):\s*(.+?)\s*$/i.exec(line);
    if (kv && current) {
      current[kv[1]] = unquote(kv[2]);
    }
  }
  if (current) rows.push(current);
  return rows;
}
