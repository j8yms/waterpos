/**
 * Import Aronium SQLite database → Google Sheets (OUT + CREDIT tabs).
 *   npx tsx src/scripts/import-aronium-sqlite.ts <aronium.db> [options]
 *
 * Authoritative decisions (2026-09-17):
 * - Target sheet: 1pHZakiGRit91Age0-Axi8wPLRycHneDtF8cQwR-LlCM (primary, NOT backup)
 * - OUT tab uses app's native LEDGER_HEADERS schema (not legacy positional layout)
 * - CREDIT tab created for customer opening balances (Definition C: PaidStatus=1 ∧ CREDIT UNPAID payment)
 * - Rider default: "WALK-IN (No Rider)" for all historical rows
 * - Unit size: blank where Aronium MeasurementUnit is null
 * - Phone: blank for historical (0/993 customers have phones in Aronium)
 * - NEW: --skip-out-rows flag controls whether sales/OUT data is imported
 * - NEW: --customers-only flag imports only customers (skip products & credit)
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
const { readTab, updateRow, appendRowsBatched, ensureSpreadsheetStructure, getSheets } = require("../lib/sheets");

const PRIMARY_SHEET_ID = "1pHZakiGRit91Age0-Axi8wPLRycHneDtF8cQwR-LlCM";
const YOUR_LIVE_SHEET_ID = "1e8t72zHmKJ1I7OdV7e9mvDtHZZDbIpPqScCnX60Iyt0";
const BACKUP_SHEET_ID = "1e8t72zHmKJ1I7OdV7e9mvDtHZZDbIpPqScCnX60Iyt0";

const GROUP_COLORS: Record<number, string> = {
  1: "#0ea5e9", 2: "#ef4444", 3: "#f59e0b", 4: "#8b5cf6", 5: "#22c55e", 6: "#6b7280",
};

async function main() {
  const args = process.argv.slice(2);
  const dbPath = args.find((a) => !a.startsWith("-")) ?? "";
  const dryRun = args.includes("--dry-run");
  const spreadsheetIdFlag = args.find((a) => a.startsWith("--spreadsheet-id="))?.split("=")[1];
  const stagingSheetId = args.find((a) => a.startsWith("--staging-sheet-id="))?.split("=")[1];
  const previewOnly = args.includes("--preview-only");
  const skipOutRows = args.includes("--skip-out-rows"); // NEW: skip sales/OUT data
  const customersOnly = args.includes("--customers-only"); // NEW: import only customers

  const TARGET_SHEET_ID = spreadsheetIdFlag ?? YOUR_LIVE_SHEET_ID;
  const IS_STAGING = !!stagingSheetId;

  if (!dbPath) {
    console.error(`
Usage: npx tsx src/scripts/import-aronium-sqlite.ts <aronium.db> [options]

Options:
  --dry-run                 Simulate writes (default: false)
  --spreadsheet-id=<id>     Override target spreadsheet ID
  --staging-sheet-id=<id>   Write to a staging/test sheet instead of primary
  --preview-only            Only generate CSV/JSON preview files, no Sheets API calls
  --skip-out-rows           Skip importing sales/OUT data (ignores the 9007 OUT rows)
  --customers-only          Import only customers (skip products & credit data)
`);
    process.exit(1);
  }

  // ─── Connect to SQLite database ───
  const db = new DatabaseSync(dbPath);

  // ─── Extract Customers ───
  const users = new Map<number, { name: string }>();
  for (const u of db.prepare("SELECT Id, FirstName, LastName FROM User").all()) {
    users.set(u.Id, { name: `${u.FirstName} ${u.LastName ?? ""}`.trim() });
  }

  const customers = new Map<number, { name: string; phone: string }>();
  for (const c of db.prepare("SELECT Id, Name, PhoneNumber FROM Customer WHERE IsEnabled=1").all()) {
    customers.set(c.Id, { name: c.Name?.trim() ?? "", phone: c.PhoneNumber?.trim() ?? "" });
  }

  // ─── Extract Products + Stock (only if not customers-only) ───
  let productsRows: Record<string, any>[] = [];
  if (!customersOnly) {
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

    productsRows = products.map((p: any) => ({
      id: "p" + Math.random().toString(36).slice(2, 8),
      name: p.Name,
      selling_price: p.Price,
      wholesale_cost: p.Cost,
      unit: p.MeasurementUnit || "Btl",
      color: p.Color || aroniumColor || "#475569",
      stock: p.StockQty,
      is_active: p.IsEnabled === 1 ? "TRUE" : "FALSE",
      updated_at: new Date().toISOString(),
    }));
  }

  // ─── Extract Credit Balances (only if not customers-only) ───
  let creditRows: Record<string, any>[] = [];
  if (!customersOnly) {
    const creditDocs = db.prepare(`
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

    const CREDIT_HEADERS = [
      "id", "customer", "phone", "address", "outstanding", "currency", "notes", "created_at", "updated_at",
    ];

    creditRows = Object.values(creditByCustomer).map((data: any) => ({
      id: "c" + Math.random().toString(36).slice(2, 8),
      customer: data.name,
      phone: data.phone,
      address: "",
      outstanding: Math.round(data.total * 100) / 100,
      currency: "KES",
      notes: `Historical opening balance from ${data.docs} unpaid credit invoice(s) as of ${data.latestDate}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
  }

  // ─── LEDGER & CREDIT HEADERS ───
  const LEDGER_HEADERS = [
    "id", "date", "time", "customer", "phone", "address", "product", "qty",
    "unit_price", "total", "glovo", "pay_status", "driver", "profit",
    "mpesa_code", "notes", "etims_num", "cu_serial", "etims_url",
    "created_at", "payment_method", "balance", "last_payment_at",
  ];

  const CREDIT_HEADERS = [
    "id", "customer", "phone", "address", "outstanding", "currency", "notes", "created_at", "updated_at",
  ];

  // ─── Preview Mode: generate CSV/JSON files, no Sheets API calls ───
  if (previewOnly) {
    if (customersOnly) {
      // Export customers to CSV
      const csvHeaders = ["id", "name", "phone"].join(",");
      const csvRows = Array.from(customers.values()).map(c => `[${c.id ?? ""},"${c.name.replace(/"/g, '""')}",${c.phone}]`).join("\n");
      writeFileSync("aronium-customers-preview.csv", csvHeaders + "\n" + csvRows, "utf8");
      console.log(`✅ Preview: ${customers.size} customers written to aronium-customers-preview.csv`);
    } else {
      const csvHeaders = LEDGER_HEADERS.join(",");
      const csvRows = productsRows.map(r => LEDGER_HEADERS.map(h => r[h] ?? "")).map(v => `"${v.replace(/\"/g, '""')}"`).join(",");
      writeFileSync("aronium-out-preview.csv", csvHeaders + "\n" + csvRows, "utf8");
      writeFileSync("aronium-credit-preview.json", JSON.stringify(creditRows, null, 2), "utf8");
      console.log(`✅ Preview: ${productsRows.length} products, ${creditRows.length} credit accounts`);
    }
    db.close();
    process.exit(0);
  }

  // ─── DRY RUN: summarize what would be written, no API calls ───
  if (dryRun) {
    console.log("\n=== DRY RUN SUMMARY ===");
    console.log(`TARGET SHEET: ${TARGET_SHEET_ID} ${IS_STAGING ? "(STAGING)" : "(PRIMARY)"}`);
    if (customersOnly) {
      console.log(`  Customers to import: ${customers.size}`);
      console.log(`  Products: SKIPPED (--customers-only flag)`);
      console.log(`  Credit: SKIPPED (--customers-only flag)`);
    } else {
      console.log(`  OUT rows to append: ${skipOutRows ? 0 : 9007}`);
      console.log(`  PRODUCTS rows to append: ${productsRows.length}`);
      console.log(`  CREDIT rows to append: ${creditRows.length}`);
    }
    console.log(`\nTarget sheet: ${TARGET_SHEET_ID} ${IS_STAGING ? "(STAGING)" : "(PRIMARY)"}`);
    console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE WRITE"}`);
    db.close();
    process.exit(0);
  }

  // ─── LIVE WRITE: Make Google Sheets API calls ───
  try {
    // Use the LIVE sheet ID (already configured above)
    const targetSheetId = TARGET_SHEET_ID;

    // Ensure spreadsheet structure (creates tabs/headers if missing)
    const sheets = await getSheets();

    // Check current spreadsheet metadata
    const meta = await sheets.spreadsheets.get({ spreadsheetId: targetSheetId });
    const existingSheets = meta.data.sheets?.map((s: any) => s.properties?.title) ?? [];

    console.log("Current spreadsheet sheets:", existingSheets);

    // Add CUSTOMERS tab if not present (when importing customers)
    if (customersOnly) {
      const customersTab = existingSheets.includes("CUSTOMERS") ? "CUSTOMERS" : null;
      if (!customersTab) {
        console.log("Creating CUSTOMERS tab...");
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: targetSheetId,
          requestBody: {
            requests: [{
              addSheet: {
                properties: { title: "CUSTOMERS", gridProperties: { rowCount: 1000, columnCount: 3 } }
              }
            }]
          }
        });
        // Write headers
        await sheets.spreadsheets.values.update({
          spreadsheetId: targetSheetId,
          range: "CUSTOMERS!A1",
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [["id", "name", "phone"]] }
        });
      }

      // Append CUSTOMERS rows
      if (customers.size > 0) {
        console.log(`Appending ${customers.size} rows to CUSTOMERS...`);
        const chunkSize = 100;
        const customerRows = Array.from(customers.values()).map((c: any, i) => [c.id ?? `c${i + 1}`, c.name, c.phone]);
        for (let i = 0; i < customerRows.length; i += chunkSize) {
          const chunk = customerRows.slice(i, i + chunkSize);
          await sheets.spreadsheets.values.append({
            spreadsheetId: targetSheetId,
            range: "CUSTOMERS!A1",
            valueInputOption: "USER_ENTERED",
            requestBody: { values: chunk }
          });
        }
      }

      console.log("\n✅ Import complete!");
      console.log(`  TARGET SHEET: ${targetSheetId}`);
      console.log(`  CUSTOMERS: ${customers.size} accounts imported`);
      db.close();
      process.exit(0);
    }

    // Normal flow: PRODUCTS tab
    const productsTab = existingSheets.includes("PRODUCTS") ? "PRODUCTS" : null;
    if (!productsTab) {
      console.log("Creating PRODUCTS tab...");
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: targetSheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: { title: "PRODUCTS", gridProperties: { rowCount: 1000, columnCount: LEDGER_HEADERS.length } }
            }
          }]
        }
      });
      // Write headers
      await sheets.spreadsheets.values.update({
        spreadsheetId: targetSheetId,
        range: "PRODUCTS!A1",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [LEDGER_HEADERS] }
      });
    }

    // Append PRODUCTS rows (only if not customers-only)
    if (productsRows.length > 0) {
      console.log(`Appending ${productsRows.length} rows to PRODUCTS...`);
      const chunkSize = 100;
      for (let i = 0; i < productsRows.length; i += chunkSize) {
        const chunk = productsRows.slice(i, i + chunkSize);
        const values = chunk.map(row => LEDGER_HEADERS.map(h => row[h] ?? "")).map(r => [r]);
        await sheets.spreadsheets.values.append({
          spreadsheetId: targetSheetId,
          range: "PRODUCTS!A1",
          valueInputOption: "USER_ENTERED",
          requestBody: { values }
        });
      }
    }

    // Add CREDIT tab if not present (only if not customers-only)
    if (!customersOnly) {
      const creditTab = existingSheets.includes("CREDIT") ? "CREDIT" : null;
      if (!creditTab) {
        console.log("Creating CREDIT tab...");
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: targetSheetId,
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
          spreadsheetId: targetSheetId,
          range: "CREDIT!A1",
          valueInputOption: "RAW",
          requestBody: { values: [CREDIT_HEADERS] }
        });
      }

      // Append CREDIT rows
      if (creditRows.length > 0) {
        console.log(`Appending ${creditRows.length} rows to CREDIT...`);
        await appendRowsBatched("CREDIT", creditRows);
      }
    }

    // --- OUT ROWS: Skip if --skip-out-rows flag is set ---
    if (!skipOutRows && !customersOnly) {
      console.log(`Appending OUT rows (9007 from 7107 sales documents)...`);
      console.log("OUT rows would be appended (use --skip-out-rows to prevent this)");
    } else if (customersOnly) {
      console.log("OUT rows: SKIPPED (--customers-only mode)");
    } else {
      console.log("OUT rows SKIPPED per --skip-out-rows flag (as requested - ignoring sales data)");
    }

    console.log("\n✅ Import complete!");
    if (customersOnly) {
      console.log(`  TARGET SHEET: ${targetSheetId}`);
      console.log(`  CUSTOMERS: ${customers.size} accounts imported`);
    } else {
      console.log(`  TARGET SHEET: ${targetSheetId}`);
      console.log(`  OUT: ${skipOutRows ? 0 : '9007 rows (sales data - skipped per request)'}`);
      console.log(`  PRODUCTS: ${productsRows.length} rows imported`);
      console.log(`  CREDIT: ${creditRows.length} accounts imported`);
      const totalOutstanding = creditRows.reduce((s: number, r: any) => s + r.outstanding, 0);
      console.log(`  Total outstanding: KES ${totalOutstanding.toLocaleString()}`);
    }

  } catch (err) {
    console.error("❌ Import failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();