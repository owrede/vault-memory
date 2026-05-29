#!/usr/bin/env node
/**
 * Render results/report.md — side-by-side per-query tables with
 * manual-evaluation checkboxes. After you fill the checkboxes,
 * aggregate.mjs parses them into Recall@K / MRR metrics.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SPIKE_DIR = process.env.SPIKE_DIR;
if (!SPIKE_DIR) {
  console.error("SPIKE_DIR env var required");
  process.exit(2);
}

const [sqlite, cf, latency, setup, resource, queriesYaml] = await Promise.all([
  readFile(join(SPIKE_DIR, "results/sqlite-vec-raw.json"), "utf8").then(JSON.parse),
  readFile(join(SPIKE_DIR, "results/contextfit-raw.json"), "utf8").then(JSON.parse),
  readFile(join(SPIKE_DIR, "results/query-metrics.json"), "utf8").then(JSON.parse),
  readFile(join(SPIKE_DIR, "results/setup-metrics.json"), "utf8").then(JSON.parse).catch(() => ({})),
  readFile(join(SPIKE_DIR, "results/resource-metrics.json"), "utf8").then(JSON.parse).catch(() => null),
  readFile(join(SPIKE_DIR, "queries.yaml"), "utf8"),
]);

const cfByQuery = new Map(cf.map((r) => [r.id, r]));
const sqByQuery = new Map(sqlite.map((r) => [r.id, r]));
const queryIds = sqlite.map((r) => r.id);

const lines = [];
const push = (s) => lines.push(s);

push("# Spike Report — contextfit vs. sqlite-vec");
push("");
push(`Generated: ${new Date().toISOString()}`);
push("");
push("## How to use this report");
push("");
push("Pro Query siehst du **zwei Spalten** (sqlite-vec links, contextfit rechts) mit den Top-5-Treffern.");
push("Bewerte jeden Treffer mit einer Checkbox-Markierung **direkt in dieser Datei**:");
push("");
push("- `[x]` = klar relevant, würde ich als Antwort verwenden");
push("- `[~]` = tangential / teilweise relevant");
push("- `[ ]` = irrelevant (Default — keine Markierung nötig)");
push("");
push("Wenn du fertig bist: `./run.sh aggregate` parst die Checkboxen und berechnet Recall@5 / MRR / P@5.");
push("");
push("## Ressourcen- & Indexing-Metriken");
push("");
if (resource) {
  const r = resource;
  push(`Hardware: ${r.hardware?.machine ?? "—"} · Embedding-Modell: ${r.hardware?.embedding_model ?? "—"}`);
  push(`Vault: ${r.vault?.notes ?? "?"} Notizen, ${fmt(r.vault?.markdown_bytes, "bytes")} Markdown`);
  push("");
  push("| Metrik | sqlite-vec (BGE-M3) | contextfit (token-nativ) |");
  push("|---|---|---|");
  push(`| Ingest Wallclock (s) | ${fmt(r.sqlite_vec?.ingest_wallclock_ms, "ms_to_s")} | ${fmt(r.contextfit?.ingest_wallclock_ms, "ms_to_s")} |`);
  push(`| Index-Größe | ${fmt(r.sqlite_vec?.index_bytes, "bytes")} | ${fmt(r.contextfit?.index_bytes, "bytes")} |`);
  push(`| Peak-RSS (Prozess) | ${fmt(r.sqlite_vec?.peak_rss_bytes, "bytes")} | ${fmt(r.contextfit?.peak_rss_bytes, "bytes")} |`);
  push(`| GPU/Modell | ${parseOllamaFootprint(r.hardware?.ollama_footprint)} | keine (CPU only) |`);
  push(`| Chunks | ${r.sqlite_vec?.chunks ?? "?"} | ${r.contextfit?.chunks ?? "?"} |`);
  push(`| Hardware-Pfad | ${r.sqlite_vec?.hardware_path ?? "—"} | ${r.contextfit?.hardware_path ?? "—"} |`);
  push("");
} else {
  push("_(results/resource-metrics.json fehlt — `bash scripts/benchmark-resources.sh` laufen lassen)_");
  push("");
}
push("## Query-Latenz");
push("");
push("| Metrik | sqlite-vec | contextfit |");
push("|---|---|---|");
push(`| P50 (ms) | ${latency.sqlite_vec.p50_ms} | ${latency.contextfit.p50_ms} |`);
push(`| P95 (ms) | ${latency.sqlite_vec.p95_ms} | ${latency.contextfit.p95_ms} |`);
push(`| Mean (ms) | ${latency.sqlite_vec.mean_ms} | ${latency.contextfit.mean_ms} |`);
push("");
push("---");
push("");
push("## Pro-Query Bewertung");
push("");

for (const id of queryIds) {
  const sq = sqByQuery.get(id);
  const c = cfByQuery.get(id);
  if (!sq) continue;

  push(`### ${id} [${sq.lang}] — ${sq.text}`);
  push("");
  push(`Intent: \`${sq.intent ?? "—"}\`${sq.adversarial_for ? ` · adversarial for ${sq.adversarial_for}` : ""}`);
  push("");
  push(`Latenz (P50): sqlite-vec ${percentile(sq.latencies_ms, 50).toFixed(0)}ms · contextfit ${c ? percentile(c.latencies_ms, 50).toFixed(0) : "—"}ms`);
  push("");
  push("#### sqlite-vec Top-5");
  push("");
  push("<!-- bewertung-block: sqlite-vec/" + id + " -->");
  for (let i = 0; i < 5; i++) {
    const hit = sq.hits[i];
    if (!hit) {
      push(`${i + 1}. [ ] _(kein Treffer)_`);
      continue;
    }
    push(`${i + 1}. [ ] \`${truncatePath(hit.path)}\` · score ${fmtScore(hit.score)}`);
    if (hit.heading_path) push(`   · heading: ${hit.heading_path}`);
    if (hit.snippet) push(`   > ${escape(hit.snippet)}`);
  }
  push("");
  push("#### contextfit Top-5");
  push("");
  push("<!-- bewertung-block: contextfit/" + id + " -->");
  for (let i = 0; i < 5; i++) {
    const hit = c?.hits?.[i];
    if (!hit) {
      push(`${i + 1}. [ ] _(kein Treffer)_`);
      continue;
    }
    push(`${i + 1}. [ ] \`${truncatePath(hit.path)}\` · score ${fmtScore(hit.score)}`);
    if (hit.heading_path) push(`   · heading: ${hit.heading_path}`);
    if (hit.snippet) push(`   > ${escape(hit.snippet)}`);
  }
  push("");
  push("**Notiz:** _(optional, freier Text zu dieser Query)_");
  push("");
  push("---");
  push("");
}

await writeFile(join(SPIKE_DIR, "results/report.md"), lines.join("\n"));
console.error(`✓ Wrote ${join(SPIKE_DIR, "results/report.md")}`);
console.error(`  → Bewerte die Treffer in der Datei, dann './run.sh aggregate'.`);

// ─── helpers ────────────────────────────────────────────────────────
function percentile(arr, p) {
  if (!arr?.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor((p / 100) * (sorted.length - 1))];
}
function fmt(v, kind) {
  if (v == null) return "—";
  if (kind === "ms_to_s") return (v / 1000).toFixed(1);
  if (kind === "bytes") {
    if (v < 1024) return `${v} B`;
    if (v < 1024 ** 2) return `${(v / 1024).toFixed(0)} KB`;
    if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} MB`;
    return `${(v / 1024 ** 3).toFixed(2)} GB`;
  }
  return String(v);
}
function fmtScore(s) {
  if (s == null) return "—";
  return typeof s === "number" ? s.toFixed(3) : String(s);
}
function truncatePath(p) {
  if (!p) return "_(kein pfad)_";
  return p.length > 80 ? "…" + p.slice(-77) : p;
}
function escape(s) {
  return s.replace(/[\n\r]+/g, " ").replace(/\s+/g, " ").trim();
}
function parseOllamaFootprint(s) {
  // `ollama ps` row: NAME  ID  SIZE(e.g. "1.3 GB")  PROCESSOR(e.g. "100% GPU") ...
  if (!s) return "Modell auf GPU";
  const size = s.match(/(\d+(?:\.\d+)?\s*[KMG]B)/)?.[1];
  const proc = s.match(/(\d+%\s*(?:GPU|CPU)|GPU|CPU)/)?.[1];
  return [size, proc].filter(Boolean).join(" · ") || "Modell auf GPU";
}
