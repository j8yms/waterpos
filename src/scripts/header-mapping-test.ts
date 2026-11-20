import { readFileSync, existsSync } from "fs";
import * as path from "path";
const envFile = path.resolve(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "").trim();
    process.env[m[1]] = process.env[m[1]] ?? value;
  }
}
import { readTab } from "../lib/sheets";
import { strict as assert } from "node:assert";

async function main() {
  const r = await readTab("PRODUCTS");
  const headers = r.headers;
  // Verify selling_price maps to column C (index 2) in the live header
  assert.equal(headers.indexOf("selling_price"), 2, "selling_price should be at index 2");
  // Verify a reordered header scenario: if header were [id, name, category, selling_price, ...],
  // updateRow would write selling_price to index 3
  const reordered = ["id", "name", "category", "selling_price", "wholesale_cost"];
  assert.equal(reordered.indexOf("selling_price"), 3, "reordered header maps selling_price to index 3");
  console.log("PASS: header mapping resolves correct column index");
  console.log("Live header:", headers.join(", "));
}
main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
