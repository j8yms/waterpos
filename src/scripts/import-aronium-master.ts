/**
 * Aronium master-data migration.
 * Usage:
 *   npx tsx src/scripts/import-aronium-master.ts <aronium.db> [--dry-run] [--preview-only] [--confirm] [--stage=1|2|3|4|all]
 */
import { readFileSync, existsSync, writeFileSync } from "fs";
import * as path from "path";

function loadEnvIfNeeded() {
  if (process.env.SPREADSHEET_ID) return;
  const envFile = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(envFile)) return;
  if (typeof (process as any).loadEnvFile === "function") {
    (process as any).loadEnvFile(envFile);
    return;
  }
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "").trim();
    process.env[m[1]] = process.env[m[1]] ?? value;
  }
}
loadEnvIfNeeded();

const { DatabaseSync } = require("node:sqlite");

const args = process.argv.slice(2);
const dbPath = args.find((a) => !a.startsWith("-")) ?? "";
const dryRun = args.includes("--dry-run") || !args.includes("--confirm");
const previewOnly = args.includes("--preview-only");
const confirm = args.includes("--confirm");
const stageArg = args.find((a) => a.startsWith("--stage="))?.split("=")[1] ?? "all";
const spreadsheetIdFlag = args.find((a) => a.startsWith("--spreadsheet-id="))?.split("=")[1];

if (!dbPath) {
  console.error("Usage: npx tsx src/scripts/import-aronium-master.ts <aronium.db> [--dry-run] [--preview-only] [--confirm] [--stage=1|2|3|4|all]");
  process.exit(1);
}

const TARGET_SHEET_ID = spreadsheetIdFlag ?? process.env.SPREADSHEET_ID ?? "";
const db = new DatabaseSync(dbPath, { readOnly: true });

const groups = new Map<number, { name: string; color: string }>();
for (const g of db.prepare("SELECT * FROM ProductGroup").all()) {
  groups.set(g.Id, { name: String(g.Name).trim(), color: String(g.Color ?? "#475569") });
}
const productsSrc = db.prepare(`
  SELECT p.Id, p.Name, p.Code, p.PLU, p.MeasurementUnit, p.Price, p.Cost, p.Markup,
         p.IsEnabled, p.Description, p.Color AS aroniumColor, p.ProductGroupId,
         COALESCE(s.Quantity, 0) AS StockQty
  FROM Product p
  LEFT JOIN Stock s ON s.ProductId = p.Id AND s.WarehouseId = 1
  WHERE p.IsEnabled = 1
  ORDER BY p.Id
`).all();
const barcodesSrc = db.prepare("SELECT Id, ProductId, Value FROM Barcode").all();
const stockControls = new Map<number, { reorder: number }>();
for (const sc of db.prepare("SELECT ProductId, ReorderPoint FROM StockControl").all()) {
  stockControls.set(sc.ProductId, { reorder: Number(sc.ReorderPoint ?? 0) });
}
const customersSrc = db.prepare("SELECT * FROM Customer WHERE IsCustomer=1").all();
const suppliersSrc = db.prepare("SELECT * FROM Customer WHERE IsSupplier=1").all();
const unpaidDocs = db.prepare(`
  SELECT d.Id, d.Number, d.CustomerId, d.Date, d.DueDate, d.Total, c.Name cname
  FROM Document d JOIN Customer c ON c.Id=d.CustomerId
  WHERE d.DocumentTypeId=2 AND d.PaidStatus=1 AND d.Total>0
  ORDER BY d.Id
`).all();

const SYSTEM_ACCOUNTS = ["mpesa", "till return", "unknown"];
function nowIso() { return new Date().toISOString(); }
function genId(prefix: string, n: number) { return `${prefix}${String(n).padStart(6, "0")}`; }

const customerInfo = new Map<number, any>(customersSrc.map((c: any) => [c.Id, c]));
const customerIdMap = new Map<number, string>();
customersSrc.forEach((c: any, i: number) => customerIdMap.set(c.Id, genId("cu", i + 1)));

const customerRows: any[] = customersSrc.map((c: any, i: number) => ({
  id: genId("cu", i + 1),
  location: String(c.Name ?? "").trim(),
  phone: String(c.PhoneNumber ?? "").trim(),
  address: String(c.Address ?? "").trim(),
  notes: `Aronium source ID: ${c.Id}`,
  is_active: c.IsEnabled === 1 ? "TRUE" : "FALSE",
  updated_at: nowIso(),
  source_id: `aronium:customer:${c.Id}`,
}));

const supplierRows: any[] = suppliersSrc.map((s: any, i: number) => ({
  id: genId("su", i + 1),
  source_id: `aronium:supplier:${s.Id}`,
  name: String(s.Name ?? "").trim(),
  phone: String(s.PhoneNumber ?? "").trim(),
  address: String(s.Address ?? "").trim(),
  email: String(s.Email ?? "").trim(),
  tax_number: String(s.TaxNumber ?? "").trim(),
  is_active: s.IsEnabled === 1 ? "TRUE" : "FALSE",
  created_at: nowIso(),
  updated_at: nowIso(),
}));

const productRows: any[] = productsSrc.map((p: any, i: number) => {
  const group = groups.get(p.ProductGroupId);
  const reorder = stockControls.get(p.Id)?.reorder ?? 0;
  const stockQty = Number(p.StockQty ?? 0);
  return {
    id: genId("p", i + 1),
    source_id: `aronium:product:${p.Id}`,
    name: String(p.Name ?? "").trim(),
    category: String(group?.name ?? "OTHER").toLowerCase(),
    selling_price: Number(p.Price ?? 0),
    wholesale_cost: Number(p.Cost ?? 0),
    unit: String(p.MeasurementUnit ?? "").trim(),
    color: String(p.aroniumColor ?? group?.color ?? "#475569"),
    stock: Math.round(stockQty),
    min_stock: reorder,
    description: String(p.Description ?? "").trim(),
    is_active: "TRUE",
    updated_at: nowIso(),
  };
});

const productIdMap = new Map<number, string>();
productsSrc.forEach((p: any, i: number) => productIdMap.set(p.Id, genId("p", i + 1)));

const barcodeRows: any[] = barcodesSrc.map((b: any, i: number) => {
  const newPid = productIdMap.get(b.ProductId);
  if (!newPid) return null;
  return {
    id: genId("bc", i + 1),
    source_id: `aronium:barcode:${b.Id}`,
    product_id: newPid,
    value: String(b.Value ?? "").trim(),
    created_at: nowIso(),
  };
}).filter(Boolean);

const openingDebtRows: any[] = [];
let odNum = 0;
for (const d of unpaidDocs) {
  const info = customerInfo.get(d.CustomerId);
  const isSystem = SYSTEM_ACCOUNTS.includes(String(d.cname ?? "").trim().toLowerCase());
  openingDebtRows.push({
    id: genId("od", ++odNum),
    source_id: `aronium:opening-debt:${d.Id}`,
    source_document_id: String(d.Id),
    document_number: String(d.Number),
    customer_id: customerIdMap.get(d.CustomerId) ?? "",
    source_customer_id: `aronium:customer:${d.CustomerId}`,
    customer: String(d.cname ?? "").trim(),
    phone: String(info?.PhoneNumber ?? "").trim(),
    address: String(info?.Address ?? "").trim(),
    outstanding: Math.round(Number(d.Total ?? 0) * 100) / 100,
    original_amount: Math.round(Number(d.Total ?? 0) * 100) / 100,
    currency: "KES",
    source_document_refs: String(d.Number),
    debt_date: String(d.Date ?? "").slice(0, 10),
    due_date: String(d.DueDate ?? "").slice(0, 10),
    status: isSystem ? "QUARANTINED" : "OPEN",
    review_status: isSystem ? "pending" : "imported",
    notes: "Imported opening balance from Aronium invoice " + String(d.Number),
    created_at: nowIso(),
    updated_at: nowIso(),
    last_payment_at: "",
  });
}

const quarantined = openingDebtRows.filter((r) => r.status === "QUARANTINED");

console.log("\n===== ARONIUM MASTER IMPORT (DRY RUN) =====");
console.log("Stage:", stageArg);
console.log("Records to import:");
console.log(`  Customers:        ${customerRows.length}`);
console.log(`  Suppliers:        ${supplierRows.length}`);
console.log(`  Products:         ${productRows.length}`);
console.log(`  Barcodes:         ${barcodeRows.length}`);
console.log(`  Opening debts:    ${openingDebtRows.length} (${quarantined.length} quarantined)`);
console.log(`  Total opening debt: KES ${openingDebtRows.reduce((s: number, r: any) => s + r.outstanding, 0).toLocaleString()}`);

if (previewOnly || dryRun) {
  const previewDir = process.cwd();
  writeFileSync(path.join(previewDir, "aronium-customers-preview.json"), JSON.stringify(customerRows, null, 2));
  writeFileSync(path.join(previewDir, "aronium-suppliers-preview.json"), JSON.stringify(supplierRows, null, 2));
  writeFileSync(path.join(previewDir, "aronium-products-preview.json"), JSON.stringify(productRows, null, 2));
  writeFileSync(path.join(previewDir, "aronium-barcodes-preview.json"), JSON.stringify(barcodeRows, null, 2));
  writeFileSync(path.join(previewDir, "aronium-opening-debts-preview.json"), JSON.stringify(openingDebtRows, null, 2));
  console.log("\nPreview files written.");
}

if (previewOnly) {
  console.log("Preview complete. No Sheets API calls made.");
  db.close();
  process.exit(0);
}

if (dryRun) {
  console.log("\nDry run complete. No writes performed. Use --confirm to execute.");
  db.close();
  process.exit(0);
}

if (!confirm) {
  console.log("Missing --confirm. Aborting.");
  db.close();
  process.exit(1);
}

if (!TARGET_SHEET_ID) {
  console.error("No spreadsheet ID configured.");
  db.close();
  process.exit(1);
}

const sheetsMod = require("../lib/sheets");
const originalGet = sheetsMod.getSpreadsheetId;
sheetsMod.getSpreadsheetId = () => TARGET_SHEET_ID;

async function main() {
  try {
    await sheetsMod.ensureSpreadsheetStructure();
    const sheets = await sheetsMod.getSheets();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: TARGET_SHEET_ID });
    const hasTab = (name: string) => meta.data.sheets?.some((s: any) => s.properties?.title === name);

    for (const tab of ["SUPPLIERS", "BARCODES", "OPENING_DEBTS", "IMPORT_LOG"]) {
      if (!hasTab(tab)) {
        const headers = sheetsMod.TABS?.[tab] ?? [];
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: TARGET_SHEET_ID,
          requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
        });
        if (headers.length) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: TARGET_SHEET_ID,
            range: `${tab}!A1`,
            valueInputOption: "RAW",
            requestBody: { values: [headers] },
          });
        }
      }
    }

    const stage = stageArg.toLowerCase();
    const doStage = (n: number) => stage === "all" || stage === String(n);

    const readExisting = async (tab: string) => {
      try {
        const r = await sheetsMod.readTab(tab);
        return new Set(r.rows.map((x: any) => String(x.source_id ?? "")).filter(Boolean));
      } catch {
        return new Set<string>();
      }
    };

    const existingCustomers = await readExisting("CUSTOMERS") as Set<string>;
    const existingSuppliers = await readExisting("SUPPLIERS") as Set<string>;
    const existingProducts = await readExisting("PRODUCTS") as Set<string>;
    const existingBarcodes = await readExisting("BARCODES") as Set<string>;
    const existingDebts = await readExisting("OPENING_DEBTS") as Set<string>;

    const filterNew = (rows: any[], existing: Set<string>) => rows.filter((r) => !existing.has(r.source_id));

    if (doStage(1)) {
      const newCustomers = filterNew(customerRows, existingCustomers);
      const newSuppliers = filterNew(supplierRows, existingSuppliers);
      const newBarcodes = filterNew(barcodeRows, existingBarcodes);
      if (newCustomers.length) await sheetsMod.appendRowsBatched("CUSTOMERS", newCustomers);
      if (newSuppliers.length) await sheetsMod.appendRowsBatched("SUPPLIERS", newSuppliers);
      if (newBarcodes.length) await sheetsMod.appendRowsBatched("BARCODES", newBarcodes);
    }

    if (doStage(2)) {
      const newProducts = filterNew(productRows, existingProducts);
      if (newProducts.length) await sheetsMod.appendRowsBatched("PRODUCTS", newProducts);
    }

    if (doStage(4)) {
      const newDebts = filterNew(openingDebtRows, existingDebts);
      if (newDebts.length) await sheetsMod.appendRowsBatched("OPENING_DEBTS", newDebts);
    }

    await sheetsMod.appendRow("IMPORT_LOG", {
      id: genId("imp", Date.now()),
      source_file: path.basename(dbPath),
      started_at: nowIso(),
      completed_at: nowIso(),
      mode: "confirm stage " + stageArg,
      counts: JSON.stringify({
        customers: doStage(1) ? customerRows.length : 0,
        suppliers: doStage(1) ? supplierRows.length : 0,
        products: doStage(2) ? productRows.length : 0,
        barcodes: doStage(1) ? barcodeRows.length : 0,
        opening_debts: doStage(4) ? openingDebtRows.length : 0,
      }),
      status: "SUCCESS",
      notes: "stage " + stageArg,
    });

    console.log("\nImport complete.");
  } catch (err) {
    console.error("Import failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    sheetsMod.getSpreadsheetId = originalGet;
    db.close();
  }
}

main();
