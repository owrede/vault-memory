/**
 * Smoke test: runs a few semantic queries against the live indexed vault
 * and prints top hits. Not part of the test suite — manual verification only.
 *
 * Usage: npx tsx scripts/smoke.ts "your query here"
 */

import { loadConfig } from "../src/config/index.js";
import { VaultManager } from "../src/vault/index.js";
import { OllamaClient } from "../src/ollama/index.js";

const query = process.argv[2] ?? "Buchprojekt INIM Jörg";

const config = await loadConfig();
const manager = new VaultManager();
await manager.loadAll(config.vaults);
const ollama = new OllamaClient({ endpoint: config.server.ollama_endpoint });
const model =
  config.server.default_embedding_model ?? "qwen3-embedding:0.6b";

console.log(`\nQuery: "${query}"`);
console.log(`Model: ${model}\n`);

const embed = await ollama.embed({ model, texts: [query] });
const queryVec = embed.vectors[0]!;

for (const vault of manager.list()) {
  const dbModel = vault.db.models.getActive();
  if (!dbModel) {
    console.log(`(vault ${vault.config.name}: no active model)`);
    continue;
  }
  const hits = vault.db.embeddings.searchSemantic(dbModel.id, queryVec, 5);

  console.log(`Top ${hits.length} hits in vault "${vault.config.name}":`);
  for (const hit of hits) {
    const chunk = vault.db.chunks.getById(hit.chunkId);
    if (!chunk) continue;
    const note = vault.db.notes.getById(chunk.note_id);
    if (!note) continue;
    const preview = chunk.text.slice(0, 140).replace(/\s+/g, " ");
    const sim = (1 / (1 + hit.distance)).toFixed(3);
    console.log(`  [${sim}] ${note.path}${chunk.heading_path ? " · " + chunk.heading_path : ""}`);
    console.log(`         ${preview}…\n`);
  }
}

manager.closeAll();
