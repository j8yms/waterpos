/**
 * Import Aronium SQLite database products + stock into Google Sheets PRODUCTS tab.
 *   npx tsx src/scripts/import-aronium-sqlite.ts [path-to-db] [--dry-run] [--overwrite]
 */
import { readFileSync, existsSync } from "fs";
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
const { readTab, updateRow, appendRowsBatched } = require("../lib/sheets");

const GROUP_COLORS: Record<number, string> = {
  1: "#0ea5e9", // WATER
  2: "#ef4444", // GAS
  3: "#f59e0b", // SOFT DRINKS
  4: "#8b5cf6", // TOILETRIES
  5: "#22c55e", // FOOD
  6: "#6b7280", // OTHERS
};

const args = process.argv.slice(2);
const dbPath = args.find((a) => !a.startsWith("-")) ?? "";
const dryRun = args.includes("--dry-run");
const overwrite = args.includes("--overwrite");

if (!dbPath) {
  console.error("Usage: npx tsx src/scripts/import-aronium-sqlite.ts <aronium.db> [--dry-run] [--overwrite]");
  process.exit(1);
}

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
db.close();

console.log(`Loaded ${products.length} products from ${dbPath}`);

function rowPayload(p: any, now: string) {
  return {
    name: p.Name.trim(),
    selling_price: p.Price,
    wholesale_cost: p.Cost,
    unit: p.MeasurementUnit || "Btl",
    color: GROUP_COLORS[p.ProductGroupId] ?? "#6b7280",
    stock: Math.max(0, Math.round(p.StockQty)),
    is_active: p.IsEnabled ? "TRUE" : "FALSE",
    updated_at: now,
  };
}

async function main() {
  const now = new Date().toISOString();
  const existing = dryRun ? null : await readTab("PRODUCTS");
  const existingMap = new Map<string, number>();
  if (existing) {
    existing.rows.forEach((row: any, i: number) => {
      if (row?.name) existingMap.set(String(row.name).trim().toLowerCase(), existing.rowNumbers[i]);
    });
  }

  const toAdd: Record<string, any>[] = [];
  let updated = 0;
  let skipped = 0;

  for (const p of products) {
    const name = p.Name?.trim();
    if (!name) { skipped++; continue; }
    const key = name.toLowerCase();

    if (dryRun) {
      toAdd.push(rowPayload(p, now));
      continue;
    }

    const existingRow = existingMap.get(key);
    if (existingRow && !overwrite) {
      skipped++;
      continue;
    }

    if (existingRow) {
      await updateRow("PRODUCTS", existingRow, {
        ...rowPayload(p, now),
        id: undefined,
      });
      updated++;
    } else {
      toAdd.push({ id: "a" + String(p.Id).padStart(4, "0"), ...rowPayload(p, now) });
    }
  }

  if (toAdd.length) {
    await appendRowsBatched("PRODUCTS", toAdd);
  }

  console.log(`\n── Aronium import summary (${dryRun ? "DRY RUN" : "written to PRODUCTS"}) ──`);
  console.log(`  added:   ${toAdd.length}`);
  console.log(`  updated: ${updated}`);
  console.log(`  skipped: ${skipped}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});