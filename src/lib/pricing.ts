import { GLOVO_COMMISSION } from "./config";
import type { DispatchOrder, TicketItem } from "./types";
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
  return `Ksh ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
    driver: order.driver,
    mpesa_code: order.mpesa_code,
  };
}

export function normalizeAmountInput(v: any): number {
  return toNumber(v);
}