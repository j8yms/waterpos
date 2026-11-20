import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import * as path from "path";

const { DatabaseSync } = require("node:sqlite");
const DB = "C:/Users/PC/Downloads/aronium-database-2026-11-18-09-13.db";
const db = new DatabaseSync(DB, { readOnly: true });

let passed = 0, failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.error("FAIL  " + name + "\n  " + (e instanceof Error ? e.message : String(e))); }
}

check("customers: 1081 total (incl. 2 disabled)", () => {
  const c = db.prepare("SELECT COUNT(*) c FROM Customer WHERE IsCustomer=1").get().c;
  assert.equal(c, 1081);
});

check("suppliers: 1101 total (incl. 2 disabled)", () => {
  const c = db.prepare("SELECT COUNT(*) c FROM Customer WHERE IsSupplier=1").get().c;
  assert.equal(c, 1101);
});

check("products: 220", () => {
  const c = db.prepare("SELECT COUNT(*) c FROM Product").get().c;
  assert.equal(c, 220);
});

check("barcodes: 206", () => {
  const c = db.prepare("SELECT COUNT(*) c FROM Barcode").get().c;
  assert.equal(c, 206);
});

check("unpaid sales docs: 346", () => {
  const c = db.prepare("SELECT COUNT(*) c FROM Document WHERE DocumentTypeId=2 AND PaidStatus=1 AND Total>0").get().c;
  assert.equal(c, 346);
});

check("customers with unpaid docs: 185", () => {
  const c = db.prepare("SELECT COUNT(DISTINCT CustomerId) c FROM Document WHERE DocumentTypeId=2 AND PaidStatus=1 AND Total>0").get().c;
  assert.equal(c, 185);
});

check("total opening debt: 549620", () => {
  const t = db.prepare("SELECT COALESCE(SUM(Total),0) t FROM Document WHERE DocumentTypeId=2 AND PaidStatus=1 AND Total>0").get().t;
  assert.equal(Math.round(t), 549620);
});

check("negative stock products: 71", () => {
  const c = db.prepare("SELECT COUNT(*) c FROM Product p JOIN Stock s ON s.ProductId=p.Id WHERE p.IsEnabled=1 AND s.Quantity<0").get().c;
  assert.equal(c, 71);
});

check("products missing stock row: 12", () => {
  const c = db.prepare("SELECT COUNT(*) c FROM Product p LEFT JOIN Stock s ON s.ProductId=p.Id WHERE p.IsEnabled=1 AND s.Id IS NULL").get().c;
  assert.equal(c, 12);
});

check("quarantined accounts: 3", () => {
  const names = ["mpesa", "till return", "unknown"];
  const rows = db.prepare("SELECT c.Name FROM Customer c WHERE c.IsCustomer=1").all();
  const matched = rows.filter((r: any) => names.includes(String(r.Name).trim().toLowerCase()));
  assert.equal(matched.length, 3);
});

check("disabled suppliers included: 2", () => {
  const c = db.prepare("SELECT COUNT(*) c FROM Customer WHERE IsSupplier=1 AND IsEnabled=0").get().c;
  assert.equal(c, 2);
});

check("preview files exist", () => {
  for (const f of ["aronium-customers-preview.json","aronium-suppliers-preview.json","aronium-products-preview.json","aronium-barcodes-preview.json","aronium-opening-debts-preview.json"]) {
    assert.ok(existsSync(path.resolve(process.cwd(), f)), f);
  }
});

check("opening-debts preview: 346 rows", () => {
  const data = JSON.parse(readFileSync(path.resolve(process.cwd(), "aronium-opening-debts-preview.json"), "utf8"));
  assert.equal(data.length, 346);
});

check("opening-debts preview: 61 quarantined", () => {
  const data = JSON.parse(readFileSync(path.resolve(process.cwd(), "aronium-opening-debts-preview.json"), "utf8"));
  assert.equal(data.filter((d: any) => d.status === "QUARANTINED").length, 61);
});

check("source IDs unique in opening-debts preview", () => {
  const data = JSON.parse(readFileSync(path.resolve(process.cwd(), "aronium-opening-debts-preview.json"), "utf8"));
  const ids = data.map((d: any) => d.source_id);
  assert.equal(new Set(ids).size, ids.length);
});

db.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
