/* eslint-disable no-console */
/**
 * Temporary data migration tool: import Aronium product catalogs (XML or CSV
 * backup files) straight into the Google Sheets PRODUCTS tab.
 *
 *   npx tsx src/scripts/import-aronium.ts <backup.xml|csv> [--dry-run]
 *
 * Supported inputs:
 *   - Aronium CSV exports with a header row (Name, Price, Cost, Quantity,
 *     Measurement Unit, SKU, Barcode, Enabled, ...) — the standard Aronium
 *     "Import products using CSV" layout.
 *   - Aronium XML backups containing <Product>/<Item> records with child
 *     elements such as <Name>, <Price>, <Cost>, <Quantity>, <Unit>.
 *     (E.g. a database export where each product lives in a Product element.)
 *
 * Products already present (matched by normalized name) are skipped unless
 * --overwrite is passed, in which case their price/cost/stock are updated.
 * Existing stock is ADDED to (import quantity is treated as an addition).
 *
 * Credentials come from the environment: GOOGLE_CREDENTIALS (service-account
 * JSON) or GOOGLE_APPLICATION_CREDENTIALS, plus SPREADSHEET_ID.
 */
import { readFileSync } from "fs";
import { appendRow, readTab, updateRow } from "../lib/sheets";
import { toNumber } from "../lib/numbers";
import type { Product } from "../lib/types";

const COLORS = ["#0ea5e9", "#22c55e", "#f59e0b", "#8b5cf6", "#14b8a6", "#ec4899", "#f43f5e", "#eab308"];

interface AroniumItem {
  name: string;
  price: number;
  cost: number;
  stock: number;
  unit: string;
  active: boolean;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(field.trim());
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field.trim());
  return out;
}

function pick(cols: string[], headers: string[], keys: string[]): string {
  const idx = headers.findIndex((h) => keys.includes(h.toLowerCase()));
  return idx >= 0 ? (cols[idx] ?? "").trim() : "";
}

function parseCsv(text: string): AroniumItem[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error("CSV file is empty.");
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const items: AroniumItem[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const name = pick(cols, headers, ["name", "product name", "item name"]);
    if (!name) continue;
    const price = num(pick(cols, headers, ["price", "sell price", "selling price", "retail"]));
    const cost = num(pick(cols, headers, ["cost", "purchase price", "supply price", "wholesale"]));
    const stock = num(pick(cols, headers, ["quantity", "stock", "on hand", "quantity on hand"]));
    const unit = pick(cols, headers, ["measurement unit", "unit", "uom"]) || "Btl";
    const active = String(pick(cols, headers, ["enabled", "active"]) || "1") !== "0";
    items.push({ name, price, cost, stock, unit, active });
  }
  return items;
}

function extractBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) blocks.push(m[1]);
  return blocks;
}

function child(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}

function parseXml(text: string): AroniumItem[] {
  // Aronium exports may use <Product>, <Item> or <ArrayOfProduct><Product>.
  const blocks = [
    ...extractBlocks(text, "Product"),
    ...extractBlocks(text, "Item"),
  ];
  if (!blocks.length) {
    // Some exports wrap records in a <Products>/<Items> array — fall back to
    // splitting on any repeated element that looks like a record.
    throw new Error("No <Product> or <Item> records found in the XML backup.");
  }
  const items: AroniumItem[] = [];
  for (const block of blocks) {
    const name =
      child(block, "Name") || child(block, "ProductName") || child(block, "ItemName");
    if (!name) continue;
    items.push({
      name,
      price: num(child(block, "Price") || child(block, "SalePrice") || child(block, "SellingPrice")),
      cost: num(child(block, "Cost") || child(block, "PurchasePrice") || child(block, "WholesaleCost")),
      stock: num(child(block, "Quantity") || child(block, "Stock") || child(block, "OnHand")),
      unit: child(block, "Unit") || child(block, "MeasurementUnit") || "Btl",
      active: String(child(block, "Enabled") || child(block, "Active") || "1") !== "0",
    });
  }
  return items;
}

function num(v: string): number {
  const n = parseFloat(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

interface ImportReport {
  added: { name: string; price: number }[];
  updated: { name: string; price: number; stock: number }[];
  skipped: string[];
  dryRun: boolean;
}

async function main() {
  const args = process.argv.slice(2);
  const fileArg = args.find((a) => !a.startsWith("-"));
  const dryRun = args.includes("--dry-run");
  const overwrite = args.includes("--overwrite");
  if (!fileArg) {
    console.error(
      "Usage: npx tsx src/scripts/import-aronium.ts <backup.xml|csv> [--dry-run] [--overwrite]"
    );
    process.exit(1);
  }

  const text = readFileSync(fileArg, "utf8");
  const isXml = /\.xml$/i.test(fileArg) || text.trimStart().startsWith("<");
  const items = isXml ? parseXml(text) : parseCsv(text);
  console.log(`Parsed ${items.length} product records from ${fileArg} (${isXml ? "XML" : "CSV"}).`);
  if (!items.length) {
    console.error("No parseable products found — aborting.");
    process.exit(1);
  }

  const report: ImportReport = { added: [], updated: [], skipped: [], dryRun };

  if (!dryRun) {
    if (!process.env.SPREADSHEET_ID) {
      console.error("SPREADSHEET_ID is not set. Configure GOOGLE_CREDENTIALS + SPREADSHEET_ID first.");
      process.exit(1);
    }
    const existing = await readTab("PRODUCTS");
    const existingMap = new Map<string, { row: number; product: Product }>();
    existing.rows.forEach((raw, i) => {
      if (!raw.name) return;
      existingMap.set(norm(String(raw.name)), { row: existing.rowNumbers[i], product: toProduct(raw) });
    });

    let colorIdx = existing.rows.length;
    for (const it of items) {
      const key = norm(it.name);
      const found = existingMap.get(key);
      const color = COLORS[colorIdx % COLORS.length];
      colorIdx++;
      if (found) {
        if (!overwrite) {
          report.skipped.push(it.name);
          continue;
        }
        await updateProductRow(existing, found.row, it, color);
        report.updated.push({ name: it.name, price: it.price, stock: it.stock });
      } else {
        await appendRow("PRODUCTS", {
          id: "p" + Math.random().toString(36).slice(2, 8),
          name: it.name,
          selling_price: it.price,
          wholesale_cost: it.cost,
          unit: it.unit,
          color,
          stock: it.stock,
          is_active: it.active ? "TRUE" : "FALSE",
          updated_at: new Date().toISOString(),
        });
        report.added.push({ name: it.name, price: it.price });
      }
    }
  } else {
    for (const it of items) {
      report.added.push({ name: it.name, price: it.price });
    }
  }

  console.log(`\n── Import summary (${dryRun ? "DRY RUN — nothing written" : "written to PRODUCTS"}) ──`);
  console.log(`  added:   ${report.added.length}`);
  console.log(`  updated: ${report.updated.length}`);
  console.log(`  skipped (already exist): ${report.skipped.length}`);
  if (report.skipped.length && !overwrite) {
    console.log("  Tip: pass --overwrite to refresh price/cost/stock for existing names.");
  }
  console.log(
    `  first items: ${[...report.added, ...report.updated]
      .slice(0, 10)
      .map((r) => r.name)
      .join(", ") || "—"}`
  );
}

function toProduct(raw: Record<string, any>): Product {
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    selling_price: toNumber(raw.selling_price),
    wholesale_cost: toNumber(raw.wholesale_cost),
    unit: String(raw.unit ?? "Btl"),
    color: String(raw.color ?? "#475569"),
    stock: Math.round(toNumber(raw.stock)),
    is_active: !["false", "0", "no", ""].includes(String(raw.is_active).trim().toLowerCase()),
  };
}

async function updateProductRow(
  existing: Awaited<ReturnType<typeof readTab>>,
  rowNumber: number,
  it: AroniumItem,
  color: string
) {
  const changes: Record<string, any> = {
    selling_price: it.price,
    wholesale_cost: it.cost,
    unit: it.unit,
    color,
    stock: stockAfter(existing, rowNumber, it.stock),
    updated_at: new Date().toISOString(),
  };
  await updateRow("PRODUCTS", rowNumber, changes);
}

function stockAfter(
  existing: Awaited<ReturnType<typeof readTab>>,
  rowNumber: number,
  incoming: number
): number {
  const idx = existing.rowNumbers.indexOf(rowNumber);
  const row = idx >= 0 ? existing.rows[idx] : null;
  const current = row ? Math.round(toNumber(row.stock)) : 0;
  return current + incoming;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});