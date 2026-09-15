import { google, type sheets_v4 } from "googleapis";
import { existsSync } from "fs";
import crypto from "crypto";
import { DEFAULT_CUSTOMERS, DEFAULT_PRODUCTS, DEFAULT_STAFF, SEED_TABS, TABS } from "./config";
import type { Customer, DispatchOrder, Product } from "./types";
import { toNumber } from "./numbers";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

let cached: sheets_v4.Sheets | null = null;
let lastClientError: string | null = null;
let lastClientFailureAt = 0;

export class SheetsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SheetsConfigError";
  }
}

function getSpreadsheetId(): string {
  const id = process.env.SPREADSHEET_ID;
  if (!id) {
    throw new SheetsConfigError(
      "SPREADSHEET_ID is missing. Add it to .env.local (the id is the long token in the spreadsheet URL)."
    );
  }
  return id;
}

export function sheetsAreConfigured(): boolean {
  return Boolean(process.env.SPREADSHEET_ID);
}

async function buildAuth() {
  const credFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credFile && existsSync(credFile)) {
    return new google.auth.GoogleAuth({
      keyFile: credFile,
      scopes: SCOPES,
    });
  }

  const inlineJson = process.env.GOOGLE_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (inlineJson) {
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(inlineJson);
    } catch {
      throw new SheetsConfigError("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
    return new google.auth.JWT({
      email: parsed.client_email,
      key: parsed.private_key,
      scopes: SCOPES,
    });
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (email && key) {
    return new google.auth.JWT({
      email,
      key: key.replace(/\\n/g, "\n"),
      scopes: SCOPES,
    });
  }

  if (process.env.GOOGLE_API_KEY) {
    return process.env.GOOGLE_API_KEY;
  }

  throw new SheetsConfigError(
    "No Google credentials found. Set GOOGLE_CREDENTIALS (service account JSON block) or GOOGLE_APPLICATION_CREDENTIALS (path to service-account.json). See README."
  );
}

export async function getSheets(): Promise<sheets_v4.Sheets> {
  if (cached) return cached;
  // Throttle repeated failures so the local app stays responsive while misconfigured.
  if (Date.now() - lastClientFailureAt < 10_000) {
    throw new SheetsConfigError(
      lastClientError || "Sheets client unavailable (recent auth failure)."
    );
  }
  try {
    const auth = await buildAuth();
    cached = google.sheets({ version: "v4", auth });
    lastClientFailureAt = 0;
    lastClientError = null;
    return cached;
  } catch (err) {
    lastClientFailureAt = Date.now();
    lastClientError = err instanceof Error ? err.message : "Sheets client failed to initialize.";
    throw err;
  }
}

export async function ensureSpreadsheetStructure(): Promise<void> {
  const sheets = await getSheets();
  const spreadsheetId = getSpreadsheetId();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Set(meta.data.sheets?.map((s) => s.properties?.title) ?? []);

  for (const tab of SEED_TABS) {
    if (!existing.has(tab)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: tab } } }],
        },
      });
    }
  }

  // Write headers on any tab that has an empty first row / missing headers.
  for (const tab of SEED_TABS) {
    const headers = TABS[tab] ?? [];
    if (!headers.length) continue;
    const read = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A1:${columnName(headers.length)}1`,
    });
    const firstRow = read.data.values?.[0] ?? [];
    const hasContent = firstRow.some((cell) => String(cell).trim() !== "");
    if (!hasContent) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tab}!A1:${columnName(headers.length)}1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [headers] },
      });
    }
  }
}

export function columnName(index: number): string {
  let col = "";
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

export function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

export interface TabRead {
  headers: string[];
  columnsByKey: Map<string, number>;
  rows: Record<string, any>[];
  rowNumbers: number[];
}

export async function readTab(tabName: string): Promise<TabRead> {
  const sheets = await getSheets();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A1:ZZ`,
  });
  const values = res.data.values ?? [];

  if (!values.length) {
    return { headers: [], columnsByKey: new Map(), rows: [], rowNumbers: [] };
  }

  const headers = values[0].map((h) => normalizeHeader(String(h)));
  const columnsByKey = new Map<string, number>();
  headers.forEach((h, i) => {
    if (h) columnsByKey.set(h, i);
  });

  const rows: Record<string, any>[] = [];
  const rowNumbers: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const rowValues = values[i];
    if (!rowValues.some((cell) => String(cell).trim() !== "")) continue;
    const record: Record<string, any> = {};
    headers.forEach((h, idx) => {
      record[h] = rowValues[idx] ?? "";
    });
    rows.push(record);
    rowNumbers.push(i + 1);
  }

  return { headers, columnsByKey, rows, rowNumbers };
}

export async function appendRow(tabName: string, record: Record<string, any>): Promise<void> {
  const sheets = await getSheets();
  const spreadsheetId = getSpreadsheetId();
  const headers = TABS[tabName] ?? [];
  if (!headers.length) throw new Error(`No header definition for tab ${tabName}`);

  const values = headers.map((h) => record[h] ?? "");
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] },
  });
}

export async function updateRow(
  tabName: string,
  rowNumber: number,
  changes: Record<string, any>
): Promise<void> {
  const sheets = await getSheets();
  const spreadsheetId = getSpreadsheetId();
  const headers = TABS[tabName] ?? [];
  if (!headers.length) throw new Error(`No header definition for tab ${tabName}`);

  const positions: number[] = [];
  const selectedHeaders: string[] = [];
  for (const h of headers) {
    if (h in changes && changes[h] !== undefined) {
      selectedHeaders.push(h);
      positions.push(headers.indexOf(h) + 1);
    }
  }
  if (!positions.length) return;

  const startCol = Math.min(...positions);
  const values = selectedHeaders.map((h) => changes[h] ?? "");
  const range = `${tabName}!${columnName(startCol)}${rowNumber}:${columnName(
    startCol + values.length - 1
  )}${rowNumber}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] },
  });
}

export async function seedInitialData(): Promise<boolean> {
  const required = ["PRODUCTS", "CUSTOMERS"];
  let wrote = false;
  for (const tab of required) {
    const read = await readTab(tab);
    if (!read.rows.length) {
      if (tab === "PRODUCTS") {
        for (const p of DEFAULT_PRODUCTS) {
          await appendRow("PRODUCTS", {
            ...p,
            wholesale_cost: p.wholesale_cost,
            selling_price: p.selling_price,
            is_active: p.is_active ? "TRUE" : "FALSE",
            updated_at: new Date().toISOString(),
          });
        }
      } else if (tab === "CUSTOMERS") {
        for (const c of DEFAULT_CUSTOMERS) {
          await appendRow("CUSTOMERS", {
            id: crypto.randomUUID(),
            ...c,
            is_active: "TRUE",
            updated_at: new Date().toISOString(),
          });
        }
      }
      wrote = true;
    }
  }
  return wrote;
}

export async function getUsersFromSheet() {
  try {
    const read = await readTab("USERS");
    if (read.rows.length) {
      const pinOverrides: Record<string, string> = {};
      DEFAULT_STAFF.forEach((s) => {
        const envPin = process.env[`PIN_${s.id.toUpperCase()}`];
        if (envPin) pinOverrides[s.id] = envPin;
      });
      const users = read.rows
        .filter((r) => String(r.active ?? "TRUE").toUpperCase() !== "FALSE")
        .map((r) => {
          const base = DEFAULT_STAFF.find((s) => s.name.toLowerCase() === String(r.name).trim().toLowerCase());
          const role: "management" | "rider" = String(r.role || "").toLowerCase().includes("rider")
            ? "rider"
            : "management";
          const pin = String(r.pin || "").trim() || base?.pin || "0000";
          return {
            id: String(r.id || crypto.randomUUID()),
            name: String(r.name).trim(),
            role,
            pin,
          };
        });
      if (users.length) {
        return users.map((u) => ({
          ...u,
          pin: pinOverrides[u.id] || u.pin,
        }));
      }
    }
  } catch {
    // fall through to defaults on any failure
  }
  return DEFAULT_STAFF;
}

export function rowToProduct(r: Record<string, any>): Product {
  return {
    id: String(r.id ?? crypto.randomUUID()),
    name: String(r.name ?? ""),
    selling_price: toNumber(r.selling_price),
    wholesale_cost: toNumber(r.wholesale_cost),
    unit: String(r.unit ?? ""),
    color: String(r.color ?? "#475569"),
    stock: Math.round(toNumber(r.stock)),
    is_active: !["false", "0", "no", ""].includes(String(r.is_active).trim().toLowerCase()),
  };
}

export function rowToCustomer(r: Record<string, any>): Customer {
  return {
    id: String(r.id ?? crypto.randomUUID()),
    location: String(r.location ?? ""),
    phone: String(r.phone ?? ""),
    address: String(r.address ?? ""),
    notes: String(r.notes ?? ""),
    is_active: !["false", "0", "no", ""].includes(String(r.is_active).trim().toLowerCase()),
  };
}

export function rowToOrder(r: Record<string, any>, rowNumber: number): DispatchOrder {
  return {
    id: String(r.id ?? ""),
    date: String(r.date ?? ""),
    time: String(r.time ?? ""),
    customer: String(r.customer ?? ""),
    phone: String(r.phone ?? ""),
    address: String(r.address ?? ""),
    product: String(r.product ?? ""),
    qty: Math.round(toNumber(r.qty)),
    unit_price: toNumber(r.unit_price),
    total: toNumber(r.total),
    glovo: String(r.glovo).trim().toUpperCase() === "TRUE",
    pay_status: String(r.pay_status ?? "PENDING").toUpperCase() === "PAID" ? "PAID" : "PENDING",
    driver: String(r.driver ?? ""),
    profit: toNumber(r.profit),
    mpesa_code: String(r.mpesa_code ?? ""),
    etims_num: String(r.etims_num ?? ""),
    cu_serial: String(r.cu_serial ?? ""),
    etims_url: String(r.etims_url ?? ""),
    notes: String(r.notes ?? ""),
    created_at: String(r.created_at ?? ""),
    _row: rowNumber,
  } as DispatchOrder & { _row: number };
}