import { google, type sheets_v4 } from "googleapis";
import { existsSync } from "fs";
import crypto from "crypto";
import { DEFAULT_CUSTOMERS, DEFAULT_PRODUCTS, DEFAULT_STAFF, SEED_TABS, TABS } from "./config";
import type { Customer, DispatchOrder, Product, Role } from "./types";
import { toNumber } from "./numbers";

/** Simple in-memory cache with TTL for read-heavy tabs */
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const readCache = new Map<string, CacheEntry<any>>();
const CACHE_TTL_MS = 30_000; // 30 seconds

function getCached<T>(key: string): T | null {
  const entry = readCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    readCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: any): void {
  readCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function invalidateCache(key?: string): void {
  if (key) {
    readCache.delete(key);
  } else {
    readCache.clear();
  }
}

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

  // Reconcile: append any missing headers to the end of row 1 (keeps existing rows aligned).
  for (const tab of SEED_TABS) {
    const desired = TABS[tab] ?? [];
    if (!desired.length) continue;
    const read = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A1:ZZ1`,
    });
    const existing = (read.data.values?.[0] ?? []).map((c) => normalizeHeader(String(c)));
    const missing = desired.filter((h) => !existing.includes(normalizeHeader(h)));
    if (missing.length) {
      const startCol = columnName(existing.length + 1);
      const endCol = columnName(existing.length + missing.length);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tab}!${startCol}1:${endCol}1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [missing] },
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

export function resolveUpdateColumns(headers: string[], changes: Record<string, any>): { col: number; value: any }[] {
  const result: { col: number; value: any }[] = [];
  for (const h of Object.keys(changes)) {
    const nh = normalizeHeader(h);
    const col = headers.indexOf(nh) + 1;
    if (col > 0 && changes[h] !== undefined) {
      result.push({ col, value: changes[h] });
    } else if (changes[h] !== undefined) {
      console.warn(`resolveUpdateColumns: field ${h} not found in live header`);
    }
  }
  return result;
}

/** Invalidate cached reads for a tab (call after writes). */
export { invalidateCache };

export interface TabRead {
  headers: string[];
  columnsByKey: Map<string, number>;
  rows: Record<string, any>[];
  rowNumbers: number[];
}

export async function readTab(tabName: string): Promise<TabRead> {
  const cacheKey = `tab:${tabName}`;
  const cached = getCached<TabRead>(cacheKey);
  if (cached) return cached;

  const sheets = await getSheets();
  const spreadsheetId = getSpreadsheetId();

  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!A1:ZZ`,
    });
  } catch (err: any) {
    const msg = String(err?.message ?? err ?? "");
    if (msg.includes("Unable to parse range") || msg.includes("not found") || msg.includes("SHEET_NOT_FOUND")) {
      const empty: TabRead = { headers: [], columnsByKey: new Map(), rows: [], rowNumbers: [] };
      setCache(cacheKey, empty);
      return empty;
    }
    throw err;
  }
  const values = res.data.values ?? [];

  if (!values.length) {
    const empty: TabRead = { headers: [], columnsByKey: new Map(), rows: [], rowNumbers: [] };
    setCache(cacheKey, empty);
    return empty;
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

  const result: TabRead = { headers, columnsByKey, rows, rowNumbers };
  setCache(cacheKey, result);
  return result;
}

export async function appendRow(tabName: string, record: Record<string, any>): Promise<void> {
  const sheets = await getSheets();
  const spreadsheetId = getSpreadsheetId();
  const liveRead = await readTab(tabName);
  let headers = liveRead.headers;
  if (!headers.length) {
    headers = (TABS[tabName] ?? []).map((h: string) => normalizeHeader(h));
    if (headers.length) {
      console.warn(`appendRow: no live header for ${tabName}; using TABS fallback (new tab?)`);
    }
  }
  if (!headers.length) throw new Error(`No header definition for tab ${tabName}`);

  const configHeaders = (TABS[tabName] ?? []).map((h: string) => normalizeHeader(h));
  if (configHeaders.length && JSON.stringify(configHeaders) !== JSON.stringify(headers)) {
    console.warn(`appendRow: live header for ${tabName} differs from TABS config`);
  }

  const values = headers.map((h) => record[h] ?? "");
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] },
  });
  // Update the cached TabRead directly.
  const cached = getCached<TabRead>(`tab:${tabName}`);
  if (cached) {
    const record: Record<string, any> = {};
    headers.forEach((h, i) => {
      record[h] = values[i] ?? "";
    });
    cached.rows.push(record);
    cached.rowNumbers.push(cached.rowNumbers.length > 0 ? cached.rowNumbers[cached.rowNumbers.length - 1] + 1 : 2);
    setCache(`tab:${tabName}`, cached);
  } else {
    invalidateCache(`tab:${tabName}`);
  }
}

/**
 * Append many rows in small batches with retry/backoff. The Sheets API rate
 * limits writes per minute, so a large one-off migration (e.g. Aronium import)
 * must spread requests out instead of firing 200+ calls in a single burst.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function appendRowsBatched(
  tabName: string,
  records: Record<string, any>[],
  chunkSize = 25
): Promise<void> {
  const sheets = await getSheets();
  const spreadsheetId = getSpreadsheetId();
  const headers = TABS[tabName] ?? [];
  if (!headers.length) throw new Error(`No header definition for tab ${tabName}`);

  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const values = chunk.map((record) => headers.map((h) => record[h] ?? ""));

    let attempts = 0;
    for (;;) {
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${tabName}!A1`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values },
        });
        break;
      } catch (err: any) {
        attempts++;
        const msg = String(err?.message ?? err ?? "");
        const quota = /quota|rate.?limit|429|RESOURCE_EXHAUSTED/i.test(msg);
        if (!quota || attempts >= 6) throw err;
        // Back off: 5s, 10s, 20s, 40s, 80s
        await sleep(5000 * 2 ** (attempts - 1));
      }
    }

    if (i + chunkSize < records.length) await sleep(2000);
  }
  invalidateCache(`tab:${tabName}`);
}

export async function updateRow(
  tabName: string,
  rowNumber: number,
  changes: Record<string, any>
): Promise<void> {
  const sheets = await getSheets();
  const spreadsheetId = getSpreadsheetId();
  const liveRead = await readTab(tabName);
  const headers = liveRead.headers.length ? liveRead.headers : null;
  if (!headers || !headers.length) {
    throw new Error(`No live header row found for tab ${tabName}; refusing to write by position.`);
  }

  const configHeaders = (TABS[tabName] ?? []).map((h: string) => normalizeHeader(h));
  if (configHeaders.length && JSON.stringify(configHeaders) !== JSON.stringify(headers)) {
    console.warn(`updateRow: live header for ${tabName} differs from TABS config`);
  }

  const resolved = resolveUpdateColumns(headers, changes);
  const data: { range: string; values: any[][] }[] = resolved.map(({ col, value }) => ({
    range: `${tabName}!${columnName(col)}${rowNumber}:${columnName(col)}${rowNumber}`,
    values: [[value]],
  }));
  if (!data.length) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data,
    },
  });
  // Update the cached TabRead directly so the next readTab returns the new value
  // immediately, bypassing Google Sheets API read latency.
  const cached = getCached<TabRead>(`tab:${tabName}`);
  if (cached) {
    const idx = cached.rowNumbers.indexOf(rowNumber);
    if (idx >= 0) {
      for (const h of Object.keys(changes)) {
        if (changes[h] !== undefined) {
          cached.rows[idx][h] = changes[h];
        }
      }
      setCache(`tab:${tabName}`, cached);
    } else {
      invalidateCache(`tab:${tabName}`);
    }
  } else {
    invalidateCache(`tab:${tabName}`);
  }
}

/**
 * Permanently remove a data row (not the header) from a tab. Used by void /
 * catalog-power operations so stale pending orders and removed products are
 * fully purged rather than hidden.
 */
export async function deleteRow(tabName: string, rowNumber: number): Promise<void> {
  const sheets = await getSheets();
  const spreadsheetId = getSpreadsheetId();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title)",
  });
  const sheet = meta.data.sheets?.find((s) => s.properties?.title === tabName);
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId == null) throw new Error(`Sheet ${tabName} not found.`);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });
  invalidateCache(`tab:${tabName}`);
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
          const is_reset_pending = String(r.is_reset_pending ?? "").trim().toUpperCase() === "TRUE";
          const isSuspended = String(r.isSuspended ?? "").trim().toUpperCase() === "TRUE";
          const pin = is_reset_pending ? "" : String(r.pin || "").trim() || base?.pin || "0000";
          return {
            id: String(r.id || crypto.randomUUID()),
            name: String(r.name).trim(),
            role,
            pin,
            is_reset_pending,
            isSuspended,
          };
        });
      if (users.length) {
        return users.map((u) => ({
          ...u,
          pin: u.is_reset_pending ? "" : pinOverrides[u.id] || u.pin,
        }));
      }
    }
  } catch {
    // fall through to defaults on any failure
  }
  return DEFAULT_STAFF.map((s) => ({ ...s }));
}

export interface StaffUser {
  id: string;
  name: string;
  role: Role;
  is_reset_pending: boolean;
  isSuspended: boolean;
  rowNumber: number | null;
}

/**
 * Full staff directory for the Admin Staff Management panel. Returns every
 * registered employee (management + riders) with their reset flag and the
 * sheet row needed to update them. The hidden master account is never stored
 * in the USERS sheet, so it can never appear here.
 */
export async function listStaffUsers(): Promise<StaffUser[]> {
  try {
    const read = await readTab("USERS");
    const staff = read.rows
      .map((r, i): StaffUser | null => {
        const name = String(r.name ?? "").trim();
        if (!name) return null;
        const role: Role = String(r.role || "").toLowerCase().includes("rider") ? "rider" : "management";
        return {
          id: String(r.id || name.toLowerCase()),
          name,
          role,
          is_reset_pending: String(r.is_reset_pending ?? "").trim().toUpperCase() === "TRUE",
          isSuspended: String(r.isSuspended ?? "").trim().toUpperCase() === "TRUE",
          rowNumber: read.rowNumbers[i] ?? null,
        } satisfies StaffUser;
      })
      .filter((s): s is StaffUser => s !== null);
    if (staff.length) return staff;
  } catch {
    // fall through to defaults when the sheet is unreachable/empty
  }
  return DEFAULT_STAFF.map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role,
    is_reset_pending: false,
    isSuspended: false,
    rowNumber: null,
  }));
}

/** Flip a user's reset flag / clear or set their PIN / suspend in the USERS sheet. */
export async function updateStaffCredentials(
  id: string,
  changes: { pin?: string; is_reset_pending?: boolean; isSuspended?: boolean }
): Promise<boolean> {
  const read = await readTab("USERS");
  const idx = read.rows.findIndex((r) => String(r.id) === String(id));
  if (idx < 0) return false;
  const rowNumber = read.rowNumbers[idx];
  const patch: Record<string, string> = {};
  if (changes.pin !== undefined) patch.pin = changes.pin;
  if (changes.is_reset_pending !== undefined) {
    patch.is_reset_pending = changes.is_reset_pending ? "TRUE" : "FALSE";
  }
  if (changes.isSuspended !== undefined) {
    patch.isSuspended = changes.isSuspended ? "TRUE" : "FALSE";
  }
  await updateRow("USERS", rowNumber, patch);
  return true;
}

/** Find a staff member by id and update in a single read+write (quota-friendly). */
export async function findAndUpdateStaff(
  id: string,
  changes: { pin?: string; is_reset_pending?: boolean; isSuspended?: boolean }
): Promise<{ ok: boolean; rowNumber?: number; name?: string }> {
  const read = await readTab("USERS");
  const idx = read.rows.findIndex((r) => String(r.id) === String(id));
  if (idx < 0) return { ok: false };
  const rowNumber = read.rowNumbers[idx];
  const name = String(read.rows[idx].name ?? "");
  const patch: Record<string, string> = {};
  if (changes.pin !== undefined) patch.pin = changes.pin;
  if (changes.is_reset_pending !== undefined) {
    patch.is_reset_pending = changes.is_reset_pending ? "TRUE" : "FALSE";
  }
  if (changes.isSuspended !== undefined) {
    patch.isSuspended = changes.isSuspended ? "TRUE" : "FALSE";
  }
  await updateRow("USERS", rowNumber, patch);
  return { ok: true, rowNumber, name };
}

export function rowToProduct(r: Record<string, any>): Product {
  return {
    id: String(r.id ?? crypto.randomUUID()),
    name: String(r.name ?? ""),
    category: String(r.category ?? ""),
    selling_price: toNumber(r.selling_price),
    wholesale_cost: toNumber(r.wholesale_cost),
    unit: String(r.unit ?? ""),
    color: String(r.color ?? "#475569"),
    stock: Math.round(toNumber(r.stock)),
    min_stock: r.min_stock === "" || r.min_stock === undefined ? undefined : Math.round(toNumber(r.min_stock)),
    description: String(r.description ?? ""),
    is_active: !["false", "0", "no", ""].includes(String(r.is_active ?? "true").trim().toLowerCase()),
    source_id: String(r.source_id ?? ""),
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
    source_id: String(r.source_id ?? ""),
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
    payment_method: String(r.payment_method ?? ""),
    balance: r.balance === undefined || r.balance === "" ? undefined : toNumber(r.balance),
    last_payment_at: String(r.last_payment_at ?? ""),
    _row: rowNumber,
  } as DispatchOrder & { _row: number };
}

export interface LedgerRow {
  order: DispatchOrder & { _row: number };
  tab: string; // "ORDERS" or "OUT" — where the row actually lives
}

/**
 * Read the full sales ledger across both the live ORDERS tab and the legacy
 * OUT tab, deduplicating by order id (newer tab wins on conflict) and
 * remembering which tab each row came from so callers update the right one.
 */
export async function readAllLedgerRows(): Promise<LedgerRow[]> {
  const byId = new Map<string, LedgerRow>();
  for (const tab of ["ORDERS", "OUT"] as const) {
    let read: TabRead;
    try {
      read = await readTab(tab);
    } catch {
      continue;
    }
    if (!read.rows.length) continue;
    read.rows.forEach((raw, i) => {
      const order = rowToOrder(raw, read.rowNumbers[i]) as DispatchOrder & { _row: number };
      const existing = byId.get(order.id);
      // Later tab (ORDERS) wins over legacy OUT when both hold the same id.
      if (!existing || existsInLaterTab(tab, existing.tab)) {
        byId.set(order.id, { order, tab });
      }
    });
  }
  return [...byId.values()];
}

function existsInLaterTab(current: string, existing: string): boolean {
  const order = ["ORDERS", "OUT"];
  return order.indexOf(current) < order.indexOf(existing);
}