/* One-shot arity normalizer for src/scripts/self-test.ts.
 * Ground truth parms (from node signature dump of src/lib/etims.ts):
 *   buildEtimsPayloadForOrder(order, items)                        -> 2 args
 *   registerEtimsInvoice(payload, seller, invoiceNo)               -> 3 args
 */
import { readFileSync, writeFileSync } from "node:fs";

const path = "src/scripts/self-test.ts";
let t = readFileSync(path, "utf8");

/* normalize buildEtimsPayloadForOrder calls to exactly 2 args (drop seller) */
let buildCount = 0;
t = t.replace(/buildEtimsPayloadForOrder\(([^,()]+),\s*([^,()]+)(?:,\s*[^,()]+)?\)/g, (m, a, b) => {
  buildCount++;
  return `buildEtimsPayloadForOrder(${a}, ${b})`;
});

/* normalize registerEtimsInvoice calls to exactly 3 args (add invoice number) */
let regCount = 0;
t = t.replace(/registerEtimsInvoice\(([^,()]+),\s*([^,()]+)(?:,\s*[^,()]+)?\)/g, (m, a, b) => {
  regCount++;
  const inv = `INV-SELFTEST-${String(regCount).padStart(4, "0")}`;
  return `registerEtimsInvoice(${a}, ${b}, "${inv}")`;
});

writeFileSync(path, t, "utf8");
console.log(`buildEtimsPayloadForOrder normalized: ${buildCount}`);
console.log(`registerEtimsInvoice normalized: ${regCount}`);
