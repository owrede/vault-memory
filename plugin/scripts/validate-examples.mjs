/**
 * validate-examples.mjs — sanity-check the bundled .contract examples
 * against ContractDocumentSchema before shipping.
 *
 * Run from the plugin/ directory:
 *
 *   npx tsx scripts/validate-examples.mjs
 *
 * Exits 0 if every plugin/examples/_contracts/*.contract file parses
 * AND validates against the schema; exits 1 listing the failures
 * otherwise.
 *
 * Use this after running scripts/yaml-to-contract.mjs to catch schema
 * regressions before they reach a published plugin tarball.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ContractDocumentSchema } from "../../src/contracts/contract-file-schema.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, "..", "examples", "_contracts");

const files = (await readdir(dir)).filter((f) => f.endsWith(".contract"));
let bad = 0;
for (const f of files) {
  const text = await readFile(join(dir, f), "utf8");
  let env;
  try {
    env = JSON.parse(text);
  } catch (err) {
    console.error(`✗ ${f}: JSON parse failed — ${err.message}`);
    bad++;
    continue;
  }
  const res = ContractDocumentSchema.safeParse(env);
  if (res.success) {
    console.log(`✓ ${f}`);
  } else {
    console.error(`✗ ${f}:`);
    for (const issue of res.error.issues.slice(0, 8)) {
      console.error(`    ${issue.path.join(".")}: ${issue.message}`);
    }
    bad++;
  }
}
process.exit(bad ? 1 : 0);
