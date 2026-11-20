import { GLOVO_COMMISSION, VAT_RATE } from "./config";
import type { DispatchOrder, TicketItem, VatSplits } from "./types";
import { toNumber } from "./numbers";

export interface TicketTotals {
  items: TicketItem[];
  subtotal: number;
  cost: number;
  profit: number;
  glovoFee: number;
  finalProfit: number;
}

/**
 * Profit = Σ (Selling Price - Wholesale Cost) × Quantity
 * When GLOVO is active, deduct 20% commission from the computed profit.
 */
export function computeTicket(items: TicketItem[], glovo: boolean): TicketTotals {
  const subtotal = items.reduce((sum, it) => sum + it.unitPrice * it.qty, 0);
  const cost = items.reduce((sum, it) => sum + (it.cost ?? 0) * it.qty, 0);
  const profit = items.reduce((sum, it) => sum + (it.unitPrice - (it.cost ?? 0)) * it.qty, 0);
  const glovoFee = glovo ? profit * GLOVO_COMMISSION : 0;
  const finalProfit = glovo ? profit * (1 - GLOVO_COMMISSION) : profit;

  return { items, subtotal, cost, profit, glovoFee, finalProfit };
}

export function money(n: number): string {
  const val = (n === null || n === undefined || !Number.isFinite(n)) ? 0 : n;
  return `Ksh ${val.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** VAT-inclusive price split: total = net + 16% VAT (Kenya). */
export function splitVat(total: number): VatSplits {
  const gross = Math.round(total * 100) / 100;
  const vat = Math.round((gross * VAT_RATE) / (1 + VAT_RATE) * 100) / 100;
  const net = Math.round((gross - vat) * 100) / 100;
  return { gross, net, vat };
}

export function nairobiDate(time: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(time)
    .replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$2-$1");
}

export function nairobiTime(time: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(time);
}

/**
 * Normalize any date string a Google Sheet might hold back into the canonical
 * YYYY-MM-DD key used by nairobiDate(). Sheets users enter dates as text, and
 * the API returns whatever layout the editor used (e.g. "2026-09-15",
 * "9/15/2026", "15/09/2026", "15-Sep-2026", "15-sep-26").
 */
export function normalizeSheetDate(raw: string, dayFirst?: boolean): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "";

  // YYYY-MM-DD or YYYY/MM/DD (already canonical = app-written records).
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;

  // M/D/YYYY, D/M/YYYY, M-D-YYYY ... (two-digit year tolerated).
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let a = +m[1];
    let b = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
    const first = a;
    const second = b;
    if (dayFirst === undefined) {
      // Ambiguous text date ("9/15" vs "15/9"): if the first part exceeds 12 it
      // must be the day; otherwise assume month-first (US Sheets default).
      dayFirst = first > 12;
    }
    const [month, day] = dayFirst ? [second, first] : [first, second];
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    return `${y}-${pad2(month)}-${pad2(day)}`;
  }

  // "15-Sep-2026", "September 15, 2026"
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  m = s.match(/(\d{1,2})[-\s]*([a-z]{3,})[a-z]*[-\s,]*(\d{2,4})/);
  if (m) {
    const day = +m[1];
    const mon = monthNames.indexOf(m[2].slice(0, 3)) + 1;
    let y = +m[3];
    if (y < 100) y += 2000;
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return `${y}-${pad2(mon)}-${pad2(day)}`;
  }

  return "";
}

function pad2(n: number | string): string {
  return String(n).padStart(2, "0");
}

export function normalizeCustomerName(
  raw: string,
  customers: { location: string; phone: string; address: string }[]
): {
  customer: string;
  phone: string;
  address: string;
} {
  const q = String(raw || "").trim().toLowerCase();
  if (!q) return { customer: "", phone: "", address: "" };

  // Exact / substring match on location name (autocomplete already prevents typos).
  const direct = customers.find((c) => c.location.toLowerCase() === q);
  if (direct) return { customer: direct.location, phone: direct.phone, address: direct.address };

  const partial = customers.find((c) => {
    const loc = c.location.toLowerCase();
    return loc.includes(q) || q.split(/\s+/).every((w) => loc.includes(w));
  });
  if (partial) return { customer: partial.location, phone: partial.phone, address: partial.address };

  // Free text: keep the typed value, uppercase for the ledger.
  return { customer: String(raw).toUpperCase().trim(), phone: "", address: "" };
}

export function orderSummaryPublic(order: DispatchOrder) {
  return {
    id: order.id,
    date: order.date,
    time: order.time,
    customer: order.customer,
    phone: order.phone,
    address: order.address,
    product: order.product,
    qty: order.qty,
    unit_price: order.unit_price,
    total: order.total,
    pay_status: order.pay_status,
    payment_method: order.payment_method,
    driver: order.driver,
    mpesa_code: order.mpesa_code,
  };
}

export function normalizeAmountInput(v: any): number {
  return toNumber(v);
}

/**
 * Parse the ledger's compact product summary ("2 x QUENCHER 18.9L + 1 x ...")
 * back into structured line items so a saved order can be reloaded into the
 * active cart for editing / completion.
 */
export function parseProductLine(raw: string): { qty: number; name: string }[] {
  const items: { qty: number; name: string }[] = [];
  for (const part of String(raw || "").split("+")) {
    const m = part.trim().match(/^(\d+)\s*x\s*(.+)$/);
    if (!m) continue;
    const qty = parseInt(m[1], 10) || 1;
    const name = m[2].trim();
    if (name) items.push({ qty, name });
  }
  return items;
}