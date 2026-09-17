/**
 * Import Aronium SQLite database → Google Sheets (OUT + CREDIT tabs).
 *   npx tsx src/scripts/import-aronium-sqlite.ts <aronium.db> [--dry-run] [--spreadsheet-id <id>] [--staging-sheet-id <id>]
 *
 * Authoritative decisions (2026-09-17):
 * - Target sheet: 1pHZakiGRit91Age0-Axi8wPLRycHneDtF8cQwR-LlCM (primary, NOT backup)
 * - OUT tab uses app's native LEDGER_HEADERS schema (not legacy positional layout)
 * - CREDIT tab created for customer opening balances (Definition C: PaidStatus=1 ∧ CREDIT UNPAID payment)
 * - Rider default: "WALK-IN (No Rider)" for all historical rows
 * - Unit size: blank where Aronium MeasurementUnit is null
 * - Phone: blank for historical (0/993 customers have phones in Aronium)
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
const { readTab, updateRow, appendRowsBatched, ensureSpreadsheetStructure, getSheetsClient } = require("../lib/sheets");

const PRIMARY_SHEET_ID = "1pHZakiGRit91Age0-Axi8wPLRycHneDtF8cQwR-LlCM";
const BACKUP_SHEET_ID = "1e8t72zHmKJ1I7OdV7e9mvDtHZZDbIpPqScCnX60Iyt0";

const GROUP_COLORS: Record<number, string> = {
  1: "#0ea5e9", 2: "#ef4444", 3: "#f59e0b", 4: "#8b5cf6", 5: "#22c55e", 6: "#6b7280",
};

const args = process.argv.slice(2);
const dbPath = args.find((a) => !a.startsWith("-")) ?? "";
const dryRun = args.includes("--dry-run");
const spreadsheetIdFlag = args.find((a) => a.startsWith("--spreadsheet-id="))?.split("=")[1];
const stagingSheetId = args.find((a) => a.startsWith("--staging-sheet-id="))?.split("=")[1];
const previewOnly = args.includes("--preview-only");
const outputPreview = args.includes("--output-preview");

if (!dbPath) {
  console.error(`
Usage: npx tsx src/scripts/import-aronium-sqlite.ts <aronium.db> [options]

Options:
  --dry-run                 Simulate writes (default: false)
  --spreadsheet-id=<id>     Override target spreadsheet ID
  --staging-sheet-id=<id>   Write to a staging/test sheet instead of primary
  --preview-only            Only generate CSV/JSON preview files, no Sheets API calls
  --output-preview          Write preview files (aronium-out-preview.csv, aronium-credit-preview.json)
`);
  process.exit(1);
}

const TARGET_SHEET_ID = spreadsheetIdFlag ?? (stagingSheetId ?? PRIMARY_SHEET_ID);
const IS_STAGING = !!stagingSheetId;

const db = new DatabaseSync(dbPath);

const products = db.prepare(`
  SELECT p.Id, p.Name, p.Code, p.PLU, p.MeasurementUnit, p.Price, p.Cost, p.Markup,
         p.IsEnabled, p.Color AS aroniumColor, p.ProductGroupId,
         COALESCE(s.Quantity, 0) AS StockQty
  FROM Product p
  LEFT JOIN Stock s ON s.ProductId = p.Id AND s.WarehouseId = 1
  WHERE p.IsEnabled = 1
  ORDER BY p.ProductGroupId, p.Name
`).all();

const groups = new Map<number, { name: string; color: string }>();
for (const g of db.prepare("SELECT * FROM ProductGroup").all()) {
  groups.set(g.Id, { name: g.Name, color: g.Color });
}

const users = new Map<number, { name: string }>();
for (const u of db.prepare("SELECT Id, FirstName, LastName FROM User").all()) {
  users.set(u.Id, { name: `${u.FirstName} ${u.LastName ?? ""}`.trim() });
}

const customers = new Map<number, { name: string; phone: string }>();
for (const c of db.prepare("SELECT Id, Name, PhoneNumber FROM Customer WHERE IsEnabled=1").all()) {
  customers.set(c.Id, { name: c.Name?.trim() ?? "", phone: c.PhoneNumber?.trim() ?? "" });
}

const productCostMap = new Map<number, number>();
for (const p of products) {
  productCostMap.set(p.Id, Number(p.Cost ?? 0));
}

db.close();

console.log(`Loaded ${products.length} products, ${users.size} cashiers, ${customers.size} customers`);
console.log(`Target sheet: ${TARGET_SHEET_ID} ${IS_STAGING ? "(STAGING)" : "(PRIMARY)"}`);
console.log(`Mode: ${dryRun ? "DRY RUN" : previewOnly ? "PREVIEW ONLY" : "LIVE WRITE"}`);

const LEDGER_HEADERS = [
  "id", "date", "time", "customer", "phone", "address", "product", "qty",
  "unit_price", "total", "glovo", "pay_status", "driver", "profit",
  "mpesa_code", "notes", "etims_num", "cu_serial", "etims_url",
  "created_at", "payment_method", "balance", "last_payment_at",
];

const CREDIT_HEADERS = [
  "id", "customer", "phone", "address", "outstanding", "currency", "notes", "created_at", "updated_at",
];

function nairobiDateStr(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
}
function nairobiTimeStr(d: Date): string {
  return d.toLocaleTimeString("en-GB", { timeZone: "Africa/Nairobi", hour12: false, hour: "2-digit", minute: "2-digit" });
}

function genId(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(6, "0")}`;
}

async function main() {
  const db2 = new DatabaseSync(dbPath);

  // ─── Extract Sales (DocumentType=2 "Sales") ───
  const salesDocs = db2.prepare(`
    SELECT d.Id, d.Number, d.UserId, d.CustomerId, d.OrderNumber, d.Date, d.Total,
           d.DocumentTypeId, d.PaidStatus, d.DueDate, d.Note, d.InternalNote,
           d.ReferenceDocumentNumber
    FROM Document d
    WHERE d.DocumentTypeId = 2 AND d.Total > 0
    ORDER BY d.Id
  `).all();

  // ─── Extract Sale Items for these docs ───
  const docIds = salesDocs.map((d: any) => d.Id);
  const placeholders = docIds.map(() => "?").join(",");
  const saleItems = db2.prepare(`
    SELECT di.Id, di.DocumentId, di.ProductId, di.Quantity, di.Price, di.ProductCost,
           di.Total, di.TotalAfterDocumentDiscount
    FROM DocumentItem di
    WHERE di.DocumentId IN (${placeholders})
  `).all(...docIds);

  // Group items by document
  const itemsByDoc = new Map<number, typeof saleItems>();
  for (const item of saleItems) {
    const arr = itemsByDoc.get(item.DocumentId) ?? [];
    arr.push(item);
    itemsByDoc.set(item.DocumentId, arr);
  }

  // ─── Build OUT rows (LEDGER_HEADERS schema) ───
  const outRows: Record<string, any>[] = [];
  let outRowNum = 0;

  for (const doc of salesDocs) {
    const items = itemsByDoc.get(doc.Id) ?? [];
    const cashier = users.get(doc.UserId)?.name ?? "Unknown";
    const cust = customers.get(doc.CustomerId) ?? { name: "WALK-IN CUSTOMER", phone: "" };
    const docDate = new Date(doc.Date);
    const dateStr = nairobiDateStr(docDate);
    const timeStr = nairobiTimeStr(docDate);

    for (const item of items) {
      const productName = products.find((p: any) => p.Id === item.ProductId)?.Name?.trim() ?? `Product-${item.ProductId}`;
      const unitPrice = Number(item.Price ?? 0);
      const qty = Number(item.Quantity ?? 0);
      const total = Number(item.Total ?? 0);
      const cost = Number(item.ProductCost ?? productCostMap.get(item.ProductId) ?? 0);
      const profit = Math.round((unitPrice - cost) * qty * 100) / 100;

      const unitSize = products.find((p: any) => p.Id === item.ProductId)?.MeasurementUnit ?? "";

      outRowNum++;
      outRows.push({
        id: genId("H", outRowNum),
        date: dateStr,
        time: timeStr,
        customer: cust.name,
        phone: cust.phone,
        address: "", // Aronium has no address on Document
        product: productName,
        qty,
        unit_price: unitPrice,
        total,
        glovo: false,
        pay_status: doc.PaidStatus === 1 ? "PENDING" : "PAID",
        driver: "WALK-IN (No Rider)",
        profit,
        mpesa_code: "",
        notes: doc.Note ?? doc.InternalNote ?? "",
        etims_num: "",
        cu_serial: "",
        etims_url: "",
        created_at: new Date().toISOString(),
        payment_method: doc.PaidStatus === 1 ? "CREDIT" : "CASH",
        balance: doc.PaidStatus === 1 ? total : 0,
        last_payment_at: "",
      });
    }
  }

  console.log(`\nBuilt ${outRows.length} OUT rows from ${salesDocs.length} sales documents`);

  // ─── Extract Credit Balances (Definition C: PaidStatus=1 ∧ CREDIT UNPAID payment) ───
  const creditDocs = db2.prepare(`
    SELECT d.Id, d.Number, d.CustomerId, d.Date, d.Total, d.PaidStatus, d.Note
    FROM Document d
    JOIN Payment p ON p.DocumentId = d.Id
    JOIN PaymentType pt ON pt.Id = p.PaymentTypeId
    WHERE d.DocumentTypeId = 2
      AND d.PaidStatus = 1
      AND pt.Name = 'CREDIT UNPAID'
      AND d.Total > 0
    ORDER BY d.Id
  `).all();

  // Aggregate by customer
  const creditByCustomer = new Map<number, { name: string; phone: string; total: number; docs: number; latestDate: string }>();
  for (const doc of creditDocs) {
    const cust = customers.get(doc.CustomerId) ?? { name: "WALK-IN CUSTOMER", phone: "" };
    const existing = creditByCustomer.get(doc.CustomerId) ?? { name: cust.name, phone: cust.phone, total: 0, docs: 0, latestDate: "" };
    existing.total += Number(doc.Total ?? 0);
    existing.docs += 1;
    if (doc.Date > existing.latestDate) existing.latestDate = doc.Date;
    creditByCustomer.set(doc.CustomerId, existing);
  }

  const creditRows: Record<string, any>[] = [];
  let creditRowNum = 0;
  for (const [custId, data] of creditByCustomer) {
    creditRowNum++;
    creditRows.push({
      id: genId("C", creditRowNum),
      customer: data.name,
      phone: data.phone,
      address: "",
      outstanding: Math.round(data.total * 100) / 100,
      currency: "KES",
      notes: `Historical opening balance from ${data.docs} unpaid credit invoice(s) as of ${data.latestDate}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  console.log(`Built ${creditRows.length} CREDIT accounts from ${creditDocs.length} Definition C documents`);
  console.log(`Total outstanding: KES ${creditRows.reduce((s, r) => s + r.outstanding, 0).toLocaleString()}`);

  // ─── Preview Output ───
  if (outputPreview || previewOnly) {
    // CSV for OUT
    const csvHeaders = LEDGER_HEADERS.join(",");
    const csvRows = outRows.map(r => LEDGER_HEADERS.map(h => {
      const v = r[h];
      if (v === undefined || v === null) return "";
      if (typeof v === "string" && (v.includes(",") || v.includes('"') || v.includes("\n"))) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return String(v);
    }).join(","));
    const csvContent = [csvHeaders, ...csvRows].join("\n");
    writeFileSync("aronium-out-preview.csv", csvContent, "utf8");
    console.log("\nWritten aronium-out-preview.csv");

    // JSON for CREDIT
    writeFileSync("aronium-credit-preview.json", JSON.stringify(creditRows, null, 2), "utf8");
    console.log("Written aronium-credit-preview.json");
  }

  if (previewOnly) {
    console.log("\n✅ Preview complete. No Sheets API calls made.");
    return;
  }

  // ─── Sheets API Operations ───
  if (dryRun) {
    console.log("\n=== DRY RUN SUMMARY ===");
    console.log(`OUT rows to append: ${outRows.length}`);
    console.log(`CREDIT rows to append: ${creditRows.length}`);
    console.log(`Target sheet: ${TARGET_SHEET_ID}`);
    return;
  }

  // Ensure spreadsheet structure (creates tabs/headers if missing)
  // We need to temporarily override the spreadsheet ID for the sheets module
  const originalGetSpreadsheetId = require("../lib/sheets").getSpreadsheetId;
  require("../lib/sheets").getSpreadsheetId = () => TARGET_SHEET_ID;

  try {
    console.log("\nEnsuring spreadsheet structure...");
    await ensureSpreadsheetStructure();

    // Add CREDIT tab to TABS if not present (ensureSpreadsheetStructure uses TABS from config)
    // Since we can't easily modify config at runtime, we'll ensure CREDIT tab exists manually
    const sheets = await getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: TARGET_SHEET_ID });
    const hasCreditTab = meta.data.sheets?.some((s: any) => s.properties?.title === "CREDIT");
    if (!hasCreditTab) {
      console.log("Creating CREDIT tab...");
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: TARGET_SHEET_ID,
        requestBody: {
          requests: [{
            addSheet: {
              properties: { title: "CREDIT", gridProperties: { rowCount: 1000, columnCount: CREDIT_HEADERS.length } }
            }
          }]
        }
      });
      // Write headers
      await sheets.spreadsheets.values.update({
        spreadsheetId: TARGET_SHEET_ID,
        range: "CREDIT!A1",
        valueInputOption: "RAW",
        requestBody: { values: [CREDIT_HEADERS] }
      });
    }

    // Append OUT rows
    if (outRows.length) {
      console.log(`Appending ${outRows.length} rows to OUT...`);
      await appendRowsBatched("OUT", outRows);
    }

    // Append CREDIT rows
    if (creditRows.length) {
      console.log(`Appending ${creditRows.length} rows to CREDIT...`);
      await appendRowsBatched("CREDIT", creditRows);
    }

    console.log("\n✅ Import complete!");
    console.log(`  OUT: ${outRows.length} rows`);
    console.log(`  CREDIT: ${creditRows.length} accounts`);
  } catch (err) {
    console.error("❌ Import failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    require("../lib/sheets").getSpreadsheetId = originalGetSpreadsheetId;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});