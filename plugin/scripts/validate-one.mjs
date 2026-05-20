import { readFile } from "node:fs/promises";
import { ContractDocumentSchema } from "../../src/contracts/contract-file-schema.ts";

const path = process.argv[2];
if (!path) { console.error("usage: validate-one <path>"); process.exit(1); }
const text = await readFile(path, "utf8");
let env;
try { env = JSON.parse(text); } catch (e) { console.error("JSON:", e.message); process.exit(1); }
const res = ContractDocumentSchema.safeParse(env);
if (res.success) console.log("✓ valid");
else {
  console.log("✗ INVALID:");
  for (const i of res.error.issues) console.log(`  ${i.path.join(".")}: ${i.message}`);
  process.exit(1);
}
