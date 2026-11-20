import { strict as assert } from "node:assert";
import { resolveUpdateColumns, normalizeHeader } from "../lib/sheets";

let passed = 0, failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.error("FAIL  " + name + "\n  " + (e instanceof Error ? e.message : String(e))); }
}

check("normalizeHeader lowercases and replaces non-alnum", () => {
  assert.equal(normalizeHeader("Selling Price"), "selling_price");
  assert.equal(normalizeHeader("min-stock"), "min_stock");
});

check("reordered header: selling_price resolves to live column", () => {
  const liveHeader = ["id", "name", "category", "selling_price", "wholesale_cost"];
  const resolved = resolveUpdateColumns(liveHeader, { selling_price: 1234 });
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].col, 4); // 1-based
  assert.equal(resolved[0].value, 1234);
});

check("unknown field is skipped", () => {
  const liveHeader = ["id", "name", "selling_price"];
  const resolved = resolveUpdateColumns(liveHeader, { foo: "bar", selling_price: 5 });
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].col, 3);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
